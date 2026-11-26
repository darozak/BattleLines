// Rules engine: pure functions only (no database, no email, no clock).
//   resolveTurn(state, ordersByPlayer, seed) -> { state, events, logs }
// The movement/spotting/combat logic below is a PLACEHOLDER that exercises the
// simultaneous-turn pipeline. Replace it as the real rules are written.
import { neighbors, distance, line, inBounds } from './hex.js';
import { terrainAt } from './terrain.js';
import { createRng, type Rng } from './rng.js';
import type {
  AttackEvent, Datasheet, GameEvent, GameState, Ghost, HexKey, PlayerId, PlayerOrders, PlayerView, Unit, UnitId, VisibleUnit,
} from './types.js';

const alive = (state: GameState): Unit[] => state.units.filter((u) => u.strength > 0);
const stats = (state: GameState, unit: { type: string }): Datasheet => state.datasheets[unit.type];

// ---------------------------------------------------------------- spotting

export function canSee(state: GameState, fromHex: HexKey, toHex: HexKey, sight: number): boolean {
  if (distance(fromHex, toHex) > sight) return false;
  const path = line(fromHex, toHex);
  for (let i = 1; i < path.length - 1; i++) {
    if (terrainAt(state.map, path[i]).blocksSight) return false;
  }
  return true;
}

export function visibleHexes(state: GameState, playerId: PlayerId): Set<HexKey> {
  const { cols, rows } = state.map;
  const seen = new Set<HexKey>();
  for (const u of alive(state)) {
    if (u.owner !== playerId) continue;
    const sight = stats(state, u).sight + terrainAt(state.map, u.hex).sightBonus;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const h = `${c},${r}`;
        if (!seen.has(h) && canSee(state, u.hex, h, sight)) seen.add(h);
      }
    }
  }
  return seen;
}

// ---------------------------------------------------------------- orders

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** Only the valid, non-empty orders. */
  orders: PlayerOrders;
}

/** Checks orders submitted by a player. Input is untrusted (it comes from the browser). */
export function validateOrders(state: GameState, playerId: PlayerId, orders: unknown): ValidationResult {
  const errors: string[] = [];
  const clean: PlayerOrders = {};
  const entries = orders && typeof orders === 'object' ? Object.entries(orders as Record<string, unknown>) : [];
  for (const [unitId, order] of entries) {
    const unit = state.units.find((u) => u.id === unitId);
    if (!unit || unit.owner !== playerId || unit.strength <= 0) {
      errors.push(`${unitId}: not your unit`);
      continue;
    }
    const rawPath = (order as { path?: unknown } | null)?.path;
    const path = Array.isArray(rawPath) ? rawPath.map(String) : [];
    let mp = stats(state, unit).move;
    let prev = unit.hex;
    let ok = true;
    for (const h of path) {
      if (!inBounds(h, state.map.cols, state.map.rows) || !neighbors(prev).includes(h)) {
        errors.push(`${unit.name}: path is not continuous`);
        ok = false;
        break;
      }
      const t = terrainAt(state.map, h);
      if (t.impassable) { errors.push(`${unit.name}: cannot enter ${t.name}`); ok = false; break; }
      mp -= t.cost;
      if (mp < 0) { errors.push(`${unit.name}: not enough movement`); ok = false; break; }
      prev = h;
    }
    if (ok && path.length) clean[unitId] = { path };
  }
  return { ok: errors.length === 0, errors, orders: clean };
}

// ---------------------------------------------------------------- resolution

function enemiesAdjacent(units: Unit[], unit: Unit): Unit[] {
  const adj = new Set(neighbors(unit.hex));
  return units.filter((o) => o.owner !== unit.owner && o.strength > 0 && adj.has(o.hex));
}

interface Mover {
  unit: Unit;
  path: HexKey[];
  mp: number;
  traversed: HexKey[];
  stopped: boolean;
  waits: number;
  reason: string | null;
}

function resolveMovement(state: GameState, ordersByPlayer: Record<PlayerId, PlayerOrders>, rng: Rng, events: GameEvent[]): void {
  const units = alive(state);
  const byId = new Map(units.map((u) => [u.id, u]));
  const movers = new Map<UnitId, Mover>();
  for (const orders of Object.values(ordersByPlayer)) {
    for (const [unitId, order] of Object.entries(orders)) {
      const u = byId.get(unitId);
      if (!u) continue;
      movers.set(unitId, { unit: u, path: [...order.path], mp: stats(state, u).move,
        traversed: [u.hex], stopped: false, waits: 0, reason: null });
    }
  }
  const stop = (m: Mover, reason: string) => { if (!m.stopped) { m.stopped = true; m.reason = reason; } };
  const maxImpulses = 3 * Math.max(0, ...[...movers.values()].map((m) => m.path.length));

  for (let impulse = 0; impulse < maxImpulses; impulse++) {
    const active = [...movers.values()].filter((m) => !m.stopped && m.path.length);
    if (!active.length) break;
    const occupant = new Map(units.map((u) => [u.hex, u]));
    const adjBefore = new Map(active.map((m) => [m.unit.id, new Set(enemiesAdjacent(units, m.unit).map((e) => e.id))]));

    // Everyone declares the hex they want to enter this impulse.
    const wants = new Map<HexKey, Mover[]>();
    for (const m of active) {
      const next = m.path[0];
      if (!wants.has(next)) wants.set(next, []);
      wants.get(next)!.push(m);
    }
    const candidate = new Map<HexKey, Mover>(); // hex -> mover allowed to try entering it
    for (const [hex, ms] of [...wants].sort(([a], [b]) => a.localeCompare(b))) {
      const owners = new Set(ms.map((m) => m.unit.owner));
      if (owners.size > 1) {
        for (const m of ms) stop(m, 'clash');
        events.push({ type: 'clash', hex, units: ms.map((m) => m.unit.id) });
        continue;
      }
      ms.sort((a, b) => a.unit.id.localeCompare(b.unit.id));
      candidate.set(hex, ms.length > 1 ? ms[rng.int(ms.length)] : ms[0]);
    }
    // Accept moves into empty hexes, then moves into hexes vacated by accepted friendly moves.
    const accepted = new Set<Mover>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const [hex, m] of candidate) {
        if (accepted.has(m) || m.stopped) continue;
        const occ = occupant.get(hex);
        if (!occ) { accepted.add(m); changed = true; }
        else if (occ.owner !== m.unit.owner) { stop(m, 'blocked by enemy'); }
        else if ([...accepted].some((a) => a.unit === occ)) { accepted.add(m); changed = true; }
      }
    }
    for (const m of accepted) {
      const hex = m.path.shift()!;
      m.unit.hex = hex;
      m.mp -= terrainAt(state.map, hex).cost;
      m.traversed.push(hex);
      m.waits = 0;
    }
    for (const m of active) {
      if (m.stopped || accepted.has(m)) continue;
      if (++m.waits >= 3) stop(m, 'path blocked by a friendly unit');
    }
    // Contact: a moving unit halts when it becomes adjacent to a new enemy.
    for (const m of active) {
      if (m.stopped || !m.path.length) continue;
      const before = adjBefore.get(m.unit.id)!;
      if (enemiesAdjacent(units, m.unit).some((e) => !before.has(e.id))) stop(m, 'contact');
    }
  }

  for (const m of movers.values()) {
    if (m.traversed.length > 1) {
      events.push({ type: 'move', unit: m.unit.id, owner: m.unit.owner, unitType: m.unit.type, path: m.traversed });
    }
    if (m.stopped) events.push({ type: 'halt', unit: m.unit.id, owner: m.unit.owner, hex: m.unit.hex, reason: m.reason! });
  }
}

function resolveCombat(state: GameState, rng: Rng, events: GameEvent[]): void {
  // PLACEHOLDER: every unit adjacent to an enemy attacks the weakest one; 2d6 - cover >= 8 hits.
  const units = alive(state);
  const hits = new Map<UnitId, number>();
  for (const u of units) {
    const targets = enemiesAdjacent(units, u).sort((a, b) => a.strength - b.strength || a.id.localeCompare(b.id));
    if (!targets.length) continue;
    const t = targets[0];
    const dice = [rng.d6(), rng.d6()];
    const cover = terrainAt(state.map, t.hex).defense;
    const hit = dice[0] + dice[1] - cover >= 8;
    events.push({ type: 'attack', attacker: u.id, attackerOwner: u.owner, attackerType: u.type, attackerHex: u.hex,
      target: t.id, targetOwner: t.owner, targetType: t.type, targetHex: t.hex, dice, cover, hit });
    if (hit) hits.set(t.id, (hits.get(t.id) || 0) + 1);
  }
  for (const [id, n] of hits) {
    const u = state.units.find((x) => x.id === id)!;
    u.strength = Math.max(0, u.strength - n);
    if (u.strength === 0) events.push({ type: 'destroyed', unit: u.id, owner: u.owner, unitType: u.type, hex: u.hex });
  }
}

function resolveScoring(state: GameState, events: GameEvent[]): void {
  const units = alive(state);
  for (const hex of state.objectives) {
    const holder = units.find((u) => u.hex === hex);
    if (holder && enemiesAdjacent(units, holder).length === 0) {
      state.scores[holder.owner] += 1;
      events.push({ type: 'score', player: holder.owner, hex, points: 1 });
    }
  }
}

function filterEvents(state: GameState, events: GameEvent[], playerId: PlayerId, seenBefore: Set<HexKey>, seenAfter: Set<HexKey>): GameEvent[] {
  const seen = (h: HexKey) => seenBefore.has(h) || seenAfter.has(h);
  const out: GameEvent[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'move':
        if (e.owner === playerId) out.push(e);
        else {
          const path = e.path.filter((h) => seen(h));
          if (path.length) out.push({ ...e, path, partial: path.length !== e.path.length });
        }
        break;
      case 'halt':
        if (e.owner === playerId) out.push(e);
        break;
      case 'clash':
        if (seenAfter.has(e.hex) || e.units.some((id) => state.units.find((u) => u.id === id)?.owner === playerId)) out.push(e);
        break;
      case 'attack': {
        const visibleAttacker = e.attackerHex !== null && seenAfter.has(e.attackerHex);
        if (e.attackerOwner === playerId || e.targetOwner === playerId || (visibleAttacker && seenAfter.has(e.targetHex))) out.push(e);
        else if (seenAfter.has(e.targetHex)) {
          const hidden: AttackEvent = { ...e, attacker: null, attackerType: null, attackerHex: null, unseenAttacker: true };
          out.push(hidden);
        }
        break;
      }
      case 'destroyed':
        if (e.owner === playerId || seenAfter.has(e.hex)) out.push(e);
        break;
      default:
        out.push(e); // score, gameover: public
    }
  }
  return out;
}

export interface TurnResolution {
  state: GameState;
  /** Everything that happened (for the referee log and the end-of-game replay). */
  events: GameEvent[];
  /** What each player is allowed to know about what happened. */
  logs: Record<PlayerId, GameEvent[]>;
}

export function resolveTurn(prevState: GameState, ordersByPlayer: Record<PlayerId, PlayerOrders>, seed: number): TurnResolution {
  const state = structuredClone(prevState);
  const rng = createRng(seed);
  const events: GameEvent[] = [];
  const seenBefore = Object.fromEntries(state.players.map((p) => [p.id, visibleHexes(state, p.id)]));

  const clean: Record<PlayerId, PlayerOrders> = {};
  for (const p of state.players) clean[p.id] = validateOrders(state, p.id, ordersByPlayer[p.id] || {}).orders;

  resolveMovement(state, clean, rng, events);
  resolveCombat(state, rng, events);
  resolveScoring(state, events);

  const ownersAlive = new Set(alive(state).map((u) => u.owner));
  if (state.turn >= state.turnLimit || ownersAlive.size <= 1) {
    const best = Math.max(...state.players.map((p) => (ownersAlive.has(p.id) ? state.scores[p.id] : -1)));
    const winners = state.players.filter((p) => ownersAlive.has(p.id) && state.scores[p.id] === best).map((p) => p.id);
    state.finished = true;
    state.result = {
      winners,
      reason: ownersAlive.size <= 1 ? 'Only one army remains.' : 'Turn limit reached.',
    };
    events.push({ type: 'gameover', ...state.result });
  }

  const logs: Record<PlayerId, GameEvent[]> = {};
  for (const p of state.players) {
    const seenAfter = visibleHexes(state, p.id);
    logs[p.id] = filterEvents(state, events, p.id, seenBefore[p.id], seenAfter);
    // Update "last seen" markers for enemy units.
    const memory = state.lastSeen[p.id];
    for (const u of state.units) {
      if (u.owner === p.id) continue;
      if (u.strength <= 0) {
        if (logs[p.id].some((e) => e.type === 'destroyed' && e.unit === u.id)) delete memory[u.id];
      } else if (seenAfter.has(u.hex)) {
        memory[u.id] = { hex: u.hex, turn: state.turn, owner: u.owner, type: u.type };
      }
    }
  }
  if (!state.finished) state.turn += 1;
  return { state, events, logs };
}

/** Record what everyone can see at the start of the game. */
export function initialSpotting(state: GameState): GameState {
  for (const p of state.players) {
    const seen = visibleHexes(state, p.id);
    for (const u of state.units) {
      if (u.owner !== p.id && seen.has(u.hex)) {
        state.lastSeen[p.id][u.id] = { hex: u.hex, turn: 0, owner: u.owner, type: u.type };
      }
    }
  }
  return state;
}

/** What a single player is allowed to know. Hidden information never leaves the server. */
export function playerView(state: GameState, playerId: PlayerId): PlayerView {
  const seen = visibleHexes(state, playerId);
  const units: VisibleUnit[] = [];
  for (const u of alive(state)) {
    if (u.owner === playerId) units.push({ ...u, ...stats(state, u), own: true });
    else if (seen.has(u.hex)) units.push({ id: u.id, owner: u.owner, type: u.type, hex: u.hex, strength: u.strength, code: stats(state, u).code, own: false });
  }
  const visibleIds = new Set(units.map((u) => u.id));
  const ghosts: Ghost[] = Object.entries(state.lastSeen[playerId] || {})
    .filter(([id]) => !visibleIds.has(id))
    .map(([id, g]) => ({ id, ...g, code: state.datasheets[g.type].code }));
  return {
    map: state.map,
    objectives: state.objectives,
    datasheets: state.datasheets,
    visibleHexes: [...seen],
    units,
    ghosts,
    scores: state.scores,
    turn: state.turn,
    turnLimit: state.turnLimit,
    finished: state.finished,
    result: state.result,
    eliminated: state.players.filter((p) => !alive(state).some((u) => u.owner === p.id)).map((p) => p.id),
  };
}
