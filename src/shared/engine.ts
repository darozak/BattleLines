// Rules engine: pure functions only (no I/O, no clock, no randomness). There are no dice: the
// same position and orders always give the same result, so the page can show a player exactly
// what their orders will do before they end their turn.
//   resolvePlayerTurn(state, orders) -> { state, events }
// The movement/combat/scoring numbers below are PLACEHOLDERS until the rules are written.
import { neighbors, distance, line, inBounds, isFacing, facingToward, arcOf } from './hex.js';
import { terrainAt, elevationAt } from './terrain.js';
import type {
  AttackEvent, Datasheet, GameEvent, GameState, TallyLine, HexKey, PlayerId, PlayerOrders, PlayerView, Unit, UnitId, VisibleUnit,
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
      const rise = elevationAt(state.map, h) - elevationAt(state.map, prev);
      if (Math.abs(rise) > stats(state, unit).climb) {
        errors.push(`${unit.name}: can't ${rise > 0 ? 'climb' : 'descend'} ${Math.abs(rise)} levels in one step (climb ${stats(state, unit).climb})`);
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
    const target = (order as { target?: unknown } | null)?.target;
    if (target !== undefined && target !== null) {
      const t = state.units.find((u) => u.id === target);
      if (!t || t.owner === playerId || t.strength <= 0) { errors.push(`${unit.name}: can only target an enemy unit`); ok = false; }
    }
    if (ok && (path.length || isFacing(facing) || typeof target === 'string')) {
      clean[unitId] = { path, ...(isFacing(facing) ? { facing } : {}), ...(typeof target === 'string' ? { target } : {}) };
    }
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

function resolveMovement(state: GameState, ordersByPlayer: Record<PlayerId, PlayerOrders>, events: GameEvent[]): void {
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
      candidate.set(hex, ms[0]); // several of one player's units want the same hex: the first in roster order goes
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

// ---------------------------------------------------------------- combat (PLACEHOLDER numbers)

export const BASE_DEFENCE = 3;
export const ARC_BONUS = { front: 0, flank: 1, rear: 2 } as const;

/**
 * The tally sheet for one unit attacking another: attack against defence, every modifier listed.
 * `attackerHex` is where the attacker will be when it attacks (after moving).
 */
export function combatTally(state: GameState, attacker: Unit, attackerHex: HexKey, target: Unit): Pick<AttackEvent, 'arc' | 'tally' | 'attack' | 'defence' | 'hits'> {
  const arc = arcOf(target.hex, target.facing, attackerHex);
  const cover = terrainAt(state.map, target.hex);
  const tally: TallyLine[] = [
    { side: 'attack', label: `${attacker.name} strength`, value: attacker.strength },
  ];
  if (ARC_BONUS[arc]) tally.push({ side: 'attack', label: `${arc} attack`, value: ARC_BONUS[arc] });
  const height = elevationAt(state.map, attackerHex) - elevationAt(state.map, target.hex);
  if (height > 0) tally.push({ side: 'attack', label: `higher ground (${height} above)`, value: height });
  if (height < 0) tally.push({ side: 'attack', label: `attacking uphill (${-height} below)`, value: height });
  tally.push({ side: 'defence', label: 'base defence', value: BASE_DEFENCE });
  if (cover.defense) tally.push({ side: 'defence', label: `cover (${cover.name.toLowerCase()})`, value: cover.defense });
  const attack = tally.filter((t) => t.side === 'attack').reduce((n, t) => n + t.value, 0);
  const defence = tally.filter((t) => t.side === 'defence').reduce((n, t) => n + t.value, 0);
  return { arc, tally, attack, defence, hits: Math.max(0, attack - defence) };
}

/** Enemies a unit could attack from a hex: every living enemy next to it. */
export function targetsFrom(state: GameState, attacker: Unit, hex: HexKey): Unit[] {
  const adj = new Set(neighbors(hex));
  return alive(state)
    .filter((o) => o.owner !== attacker.owner && adj.has(o.hex))
    .sort((a, b) => a.strength - b.strength || a.id.localeCompare(b.id));
}

function resolveCombat(state: GameState, attacker: PlayerId, orders: PlayerOrders, events: GameEvent[]): void {
  // Each of the active player's units next to an enemy attacks it: the ordered target if it is in
  // reach, otherwise the weakest. All attacks land together, after movement.
  const units = alive(state);
  const hits = new Map<UnitId, number>();
  for (const u of units) {
    if (u.owner !== attacker) continue;
    const targets = targetsFrom(state, u, u.hex);
    if (!targets.length) continue;
    const t = targets.find((x) => x.id === orders[u.id]?.target) ?? targets[0];
    const result = combatTally(state, u, u.hex, t);
    events.push({ type: 'attack', attacker: u.id, attackerOwner: u.owner, attackerType: u.type, attackerHex: u.hex,
      target: t.id, targetOwner: t.owner, targetType: t.type, targetHex: t.hex, ...result });
    if (result.hits) hits.set(t.id, (hits.get(t.id) || 0) + result.hits);
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

export const currentPlayer = (state: GameState): PlayerId => state.players[state.current].id;
const hasUnits = (state: GameState, id: PlayerId) => state.units.some((u) => u.owner === id && u.strength > 0);

/**
 * Resolve the current player's turn: their units move (and turn), then attack, then score.
 * Deterministic: the same state and orders always give the same result, so it doubles as a preview.
 */
export function resolvePlayerTurn(prevState: GameState, orders: PlayerOrders): TurnResolution {
  if (prevState.finished) throw new Error('The game is over.');
  if (prevState.phase === 'deploy') throw new Error('Players are still deploying.');
  const state = structuredClone(prevState);
  const active = currentPlayer(state);
  const events: GameEvent[] = [];
  const valid = validateOrders(state, active, orders).orders;
  resolveMovement(state, { [active]: valid }, events);
  resolveCombat(state, active, valid, events);
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
    eliminated: state.phase === 'deploy' ? [] : state.players.filter((p) => !alive(state).some((u) => u.owner === p.id)).map((p) => p.id),
  };
}

// ---------------------------------------------------------------- preview

export interface TurnPreview {
  /** Exactly what ending the turn with these orders would do. */
  events: GameEvent[];
  /** Where each of the active player's units would end up. */
  endHex: Record<UnitId, HexKey>;
}

/** Run the active player's planned orders through the rules without committing them. */
export function previewTurn(state: GameState, orders: PlayerOrders): TurnPreview {
  const active = currentPlayer(state);
  const { state: after, events } = resolvePlayerTurn(state, orders);
  const endHex = Object.fromEntries(after.units.filter((u) => u.owner === active).map((u) => [u.id, u.hex]));
  return { events, endHex };
}

export interface AttackOption extends Pick<AttackEvent, 'arc' | 'tally' | 'attack' | 'defence' | 'hits'> {
  target: Unit;
}

/** Every enemy a unit could attack from `hex`, with the tally sheet for each. */
export function attackOptions(state: GameState, unitId: UnitId, hex: HexKey): AttackOption[] {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) return [];
  return targetsFrom(state, unit, hex).map((target) => ({ target, ...combatTally(state, unit, hex, target) }));
}
