// Rules engine: pure functions only (no I/O, no clock, no randomness except the seeded dice).
//   resolvePlayerTurn(state, orders) -> { state, events }
// The movement/combat/scoring logic below is a PLACEHOLDER that exercises the game flow.
// Replace it as the real rules are written.
import { neighbors, distance, line, inBounds, isFacing, facingToward, arcOf } from './hex.js';
import { terrainAt } from './terrain.js';
import { createRng, type Rng } from './rng.js';
import type {
  Datasheet, GameEvent, GameState, HexKey, PlayerId, PlayerOrders, PlayerView, Unit, UnitId, VisibleUnit,
} from './types.js';

const alive = (state: GameState): Unit[] => state.units.filter((u) => u.strength > 0);
const stats = (state: GameState, unit: { type: string }): Datasheet => state.datasheets[unit.type];

// ---------------------------------------------------------------- line of sight

/** Whether a unit at fromHex can see toHex (for rules such as ranged fire; there is no fog of war). */

export function canSee(state: GameState, fromHex: HexKey, toHex: HexKey, sight: number): boolean {
  if (distance(fromHex, toHex) > sight) return false;
  const path = line(fromHex, toHex);
  for (let i = 1; i < path.length - 1; i++) {
    if (terrainAt(state.map, path[i]).blocksSight) return false;
  }
  return true;
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
    const facing = (order as { facing?: unknown } | null)?.facing;
    if (facing !== undefined && facing !== null && !isFacing(facing)) {
      errors.push(`${unit.name}: facing must be 0-5`);
      ok = false;
    }
    if (ok && (path.length || isFacing(facing))) clean[unitId] = isFacing(facing) ? { path, facing } : { path };
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
      if (!u || !order.path.length) continue;
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
      m.unit.facing = facingToward(m.unit.hex, hex);
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

  // Units turn to their ordered facing at the end of movement (PLACEHOLDER: turning is free,
  // even for units halted by contact). Otherwise a unit that moved faces its last step.
  for (const orders of Object.values(ordersByPlayer)) {
    for (const [unitId, order] of Object.entries(orders)) {
      const u = byId.get(unitId);
      if (u && order.facing !== undefined && u.facing !== order.facing) {
        u.facing = order.facing;
        if (!movers.has(unitId)) events.push({ type: 'turn', unit: u.id, owner: u.owner, unitType: u.type, hex: u.hex, facing: u.facing });
      }
    }
  }

  for (const m of movers.values()) {
    if (m.traversed.length > 1) {
      events.push({ type: 'move', unit: m.unit.id, owner: m.unit.owner, unitType: m.unit.type, path: m.traversed, facing: m.unit.facing });
    }
    if (m.stopped) events.push({ type: 'halt', unit: m.unit.id, owner: m.unit.owner, hex: m.unit.hex, reason: m.reason! });
  }
}

function resolveCombat(state: GameState, attacker: PlayerId, rng: Rng, events: GameEvent[]): void {
  // PLACEHOLDER: each of the active player's units adjacent to an enemy attacks the weakest one;
  // 2d6 - cover >= 8 hits.
  const units = alive(state);
  const hits = new Map<UnitId, number>();
  for (const u of units) {
    if (u.owner !== attacker) continue;
    const targets = enemiesAdjacent(units, u).sort((a, b) => a.strength - b.strength || a.id.localeCompare(b.id));
    if (!targets.length) continue;
    const t = targets[0];
    const dice = [rng.d6(), rng.d6()];
    const cover = terrainAt(state.map, t.hex).defense;
    const hit = dice[0] + dice[1] - cover >= 8;
    events.push({ type: 'attack', attacker: u.id, attackerOwner: u.owner, attackerType: u.type, attackerHex: u.hex,
      target: t.id, targetOwner: t.owner, targetType: t.type, targetHex: t.hex, arc: arcOf(t.hex, t.facing, u.hex), dice, cover, hit });
    if (hit) hits.set(t.id, (hits.get(t.id) || 0) + 1);
  }
  for (const [id, n] of hits) {
    const u = state.units.find((x) => x.id === id)!;
    u.strength = Math.max(0, u.strength - n);
    if (u.strength === 0) events.push({ type: 'destroyed', unit: u.id, owner: u.owner, unitType: u.type, hex: u.hex });
  }
}

function resolveScoring(state: GameState, scorer: PlayerId, events: GameEvent[]): void {
  // PLACEHOLDER: the active player scores 1 for each objective they occupy with no enemy adjacent.
  const units = alive(state);
  for (const hex of state.objectives) {
    const holder = units.find((u) => u.hex === hex);
    if (holder && holder.owner === scorer && enemiesAdjacent(units, holder).length === 0) {
      state.scores[holder.owner] += 1;
      events.push({ type: 'score', player: holder.owner, hex, points: 1 });
    }
  }
}

export interface TurnResolution {
  state: GameState;
  /** Everything that happened during the turn. */
  events: GameEvent[];
}

/** The dice seed for one player-turn: fixed by the game seed, the round and the player. */
export function turnSeed(state: GameState): number {
  let h = (state.seed ^ Math.imul(state.turn, 0x9e3779b1) ^ Math.imul(state.current + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export const currentPlayer = (state: GameState): PlayerId => state.players[state.current].id;
const hasUnits = (state: GameState, id: PlayerId) => state.units.some((u) => u.owner === id && u.strength > 0);

/**
 * Resolve the current player's turn: their units move (and turn), then attack, then score.
 * Deterministic: the same state and orders always give the same result.
 */
export function resolvePlayerTurn(prevState: GameState, orders: PlayerOrders): TurnResolution {
  if (prevState.finished) throw new Error('The game is over.');
  const state = structuredClone(prevState);
  const active = currentPlayer(state);
  const rng = createRng(turnSeed(state));
  const events: GameEvent[] = [];
  resolveMovement(state, { [active]: validateOrders(state, active, orders).orders }, rng, events);
  resolveCombat(state, active, rng, events);
  resolveScoring(state, active, events);

  // Next player with units left; a new round starts when play wraps around.
  const n = state.players.length;
  let next = state.current;
  let wrapped = false;
  for (let i = 1; i <= n; i++) {
    const idx = (state.current + i) % n;
    if (idx <= state.current) wrapped = true;
    if (hasUnits(state, state.players[idx].id)) { next = idx; break; }
  }
  const ownersAlive = new Set(alive(state).map((u) => u.owner));
  if (ownersAlive.size <= 1 || (wrapped && state.turn >= state.turnLimit)) {
    const best = Math.max(...state.players.map((p) => (ownersAlive.has(p.id) ? state.scores[p.id] : -1)));
    const winners = state.players.filter((p) => ownersAlive.has(p.id) && state.scores[p.id] === best).map((p) => p.id);
    state.finished = true;
    state.result = {
      winners,
      reason: ownersAlive.size <= 1 ? 'Only one army remains.' : 'Turn limit reached.',
    };
    events.push({ type: 'gameover', ...state.result });
  }

  if (!state.finished) {
    if (wrapped) state.turn += 1;
    state.current = next;
  }
  return { state, events };
}

/**
 * The board as seen by `viewer`: everything is visible (there is no fog of war); the viewer's
 * own units carry their full datasheet so they can be given orders.
 */
export function boardView(state: GameState, viewer: PlayerId | null): PlayerView {
  const units: VisibleUnit[] = alive(state).map((u) => (u.owner === viewer
    ? { ...stats(state, u), ...u, own: true as const } // unit's own name/strength win over the datasheet's
    : { id: u.id, owner: u.owner, type: u.type, name: u.name, hex: u.hex, facing: u.facing, strength: u.strength, code: stats(state, u).code, own: false as const }));
  return {
    map: state.map,
    objectives: state.objectives,
    datasheets: state.datasheets,
    units,
    scores: state.scores,
    turn: state.turn,
    turnLimit: state.turnLimit,
    finished: state.finished,
    result: state.result,
    eliminated: state.players.filter((p) => !alive(state).some((u) => u.owner === p.id)).map((p) => p.id),
  };
}
