// Rules engine: pure functions only (no I/O, no clock, no randomness). There are no dice: the
// same position and orders always give the same result, so the page can show a player exactly
// what their orders will do before they end their turn.
//   resolvePlayerTurn(state, orders) -> { state, events }
// The movement/combat/scoring numbers below are PLACEHOLDERS until the rules are written.
import { neighbors, distance, line, inBounds, isFacing, facingToward, arcOf } from './hex.js';
import { terrainAt, elevationAt, stepCost, stepProblem, hasRiver, hasBridge, RIVER_ATTACK, BRIDGE_ATTACK } from './terrain.js';
import { HILL_TARGET, FLAG_POINTS } from './setup.js';
import type {
  AttackEvent, Datasheet, Facing, GameEvent, GameState, MoraleEvent, ScoreEvent, TallyLine, HexKey, PlayerId, PlayerOrders, PlayerView, Unit, UnitId, VisibleUnit,
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
    for (const [i, h] of path.entries()) {
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
      const problem = stepProblem(state.map, prev, h, i, mp); // slow ground, roads, rivers and climbs
      if (problem) { errors.push(`${unit.name}: ${problem}`); ok = false; break; }
      mp -= stepCost(state.map, prev, h);
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
  reason: string | null;
  /** Facing before moving, in case the unit is bumped back to where it started. */
  startFacing: Facing;
}

/**
 * The enemies whose front hexes include `hex`: `hex` is next to them, on one of their front three
 * hexsides (#33). A unit entering such a hex is engaged and stops; leaving one draws a free attack.
 */
export function engagedBy(state: GameState, owner: PlayerId, hex: HexKey): Unit[] {
  const adj = new Set(neighbors(hex));
  return alive(state).filter((o) => o.owner !== owner && adj.has(o.hex) && arcOf(o.hex, o.facing, hex) === 'front');
}

function resolveMovement(state: GameState, ordersByPlayer: Record<PlayerId, PlayerOrders>, events: GameEvent[], struck: Set<UnitId>): void {
  const units = alive(state);
  const byId = new Map(units.map((u) => [u.id, u]));
  const movers = new Map<UnitId, Mover>();
  for (const orders of Object.values(ordersByPlayer)) {
    for (const [unitId, order] of Object.entries(orders)) {
      const u = byId.get(unitId);
      if (!u || !order.path.length) continue;
      movers.set(unitId, { unit: u, path: [...order.path], mp: stats(state, u).move,
        traversed: [u.hex], stopped: false, reason: null, startFacing: u.facing });
    }
  }
  const stop = (m: Mover, reason: string) => { if (!m.stopped) { m.stopped = true; m.reason = reason; } };
  const maxImpulses = Math.max(0, ...[...movers.values()].map((m) => m.path.length));

  for (let impulse = 0; impulse < maxImpulses; impulse++) {
    const active = [...movers.values()].filter((m) => !m.stopped && m.path.length);
    if (!active.length) break;
    const occupant = new Map(units.filter((u) => u.strength > 0).map((u) => [u.hex, u]));

    // Everyone declares the hex they want to enter this impulse.
    const wants = new Map<HexKey, Mover[]>();
    for (const m of active) {
      const next = m.path[0];
      if (!wants.has(next)) wants.set(next, []);
      wants.get(next)!.push(m);
    }
    // Friendly units may pass through each other (#23); only enemies block the way.
    const accepted = new Set<Mover>();
    for (const [hex, ms] of [...wants].sort(([a], [b]) => a.localeCompare(b))) {
      const owners = new Set(ms.map((m) => m.unit.owner));
      if (owners.size > 1) {
        for (const m of ms) stop(m, 'clash');
        events.push({ type: 'clash', hex, units: ms.map((m) => m.unit.id) });
        continue;
      }
      for (const m of ms) {
        const occ = occupant.get(hex);
        if (occ && occ.owner !== m.unit.owner) stop(m, 'blocked by enemy');
        else accepted.add(m);
      }
    }
    // Disengaging (#33): each enemy whose front hexes the unit is leaving makes a free close-combat
    // attack on it first. Hits land at once; a unit destroyed this way goes no further.
    for (const m of [...accepted].sort((a, b) => a.unit.id.localeCompare(b.unit.id))) {
      for (const e of engagedBy(state, m.unit.owner, m.unit.hex).sort((a, b) => a.id.localeCompare(b.id))) {
        const result = combatTally(state, e, e.hex, m.unit);
        events.push({ type: 'attack', attacker: e.id, attackerOwner: e.owner, attackerType: e.type, attackerHex: e.hex,
          target: m.unit.id, targetOwner: m.unit.owner, targetType: m.unit.type, targetHex: m.unit.hex, ...result, free: true });
        if (!result.hits) continue;
        struck.add(m.unit.id);
        m.unit.strength = Math.max(0, m.unit.strength - result.hits);
        if (m.unit.strength === 0) {
          events.push({ type: 'destroyed', unit: m.unit.id, owner: m.unit.owner, unitType: m.unit.type, hex: m.unit.hex });
          accepted.delete(m);
          m.stopped = true;
          m.path = [];
          break;
        }
      }
    }
    for (const m of accepted) {
      const hex = m.path.shift()!;
      m.mp -= stepCost(state.map, m.unit.hex, hex);
      m.unit.facing = facingToward(m.unit.hex, hex);
      m.unit.hex = hex;
      m.traversed.push(hex);
    }
    // Engaging (#33): a unit that enters an enemy's front hexes stops there.
    for (const m of accepted) {
      if (m.stopped || !m.path.length) continue;
      const by = engagedBy(state, m.unit.owner, m.unit.hex);
      if (by.length) stop(m, `engaged by ${by.map((e) => e.name).join(' and ')}`);
    }
  }

  // No two friendly units may end their moves in the same hex. A unit that didn't move keeps its
  // hex; otherwise the one that got there first does (ties: roster order), and the other steps back
  // along its route to the last hex where it can stop.
  const rank = new Map(state.units.map((u, i) => [u.id, i]));
  for (;;) {
    const at = new Map<HexKey, { unit: Unit; arrived: number }[]>();
    for (const u of units.filter((x) => x.strength > 0)) { // a unit destroyed while disengaging takes no room
      const m = movers.get(u.id);
      const entry = { unit: u, arrived: m ? m.traversed.length - 1 : -1 };
      if (!at.has(u.hex)) at.set(u.hex, []);
      at.get(u.hex)!.push(entry);
    }
    const crowded = [...at.values()].filter((list) => list.length > 1);
    if (!crowded.length) break;
    for (const list of crowded) {
      list.sort((a, b) => a.arrived - b.arrived || rank.get(a.unit.id)! - rank.get(b.unit.id)!);
      for (const { unit } of list.slice(1)) {
        const m = movers.get(unit.id)!; // only units that moved can be bumped (start hexes never overlap)
        m.traversed.pop();
        unit.hex = m.traversed[m.traversed.length - 1];
        unit.facing = m.traversed.length > 1 ? facingToward(m.traversed[m.traversed.length - 2], unit.hex) : m.startFacing;
        m.stopped = true;
        m.reason = 'no room to stop further on (a friendly unit is there)';
      }
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
/** Defence against a ranged attack, before cover. */
export const FIRE_DEFENCE = 2;
/** Fire at this many hexes or fewer is at full strength; −1 for each hex beyond. */
export const FIRE_FULL_RANGE = 2;

type AttackResult = Pick<AttackEvent, 'ranged' | 'arc' | 'tally' | 'attack' | 'defence' | 'hits'>;

/**
 * The tally sheet for one unit attacking another: attack against defence, every modifier listed.
 * `attackerHex` is where the attacker will be when it attacks (after moving). Next to the target it is
 * close combat; further away it is a ranged attack (fire).
 */
export function combatTally(state: GameState, attacker: Unit, attackerHex: HexKey, target: Unit): AttackResult {
  const arc = arcOf(target.hex, target.facing, attackerHex);
  const cover = terrainAt(state.map, target.hex);
  const range = distance(attackerHex, target.hex);
  const ranged = range > 1;
  const tally: TallyLine[] = ranged
    ? [{ side: 'attack', label: `${attacker.name} fire`, value: stats(state, attacker).fire }]
    : [{ side: 'attack', label: `${attacker.name} strength`, value: attacker.strength }];
  if (ranged && range > FIRE_FULL_RANGE) tally.push({ side: 'attack', label: `range (${range} hexes)`, value: FIRE_FULL_RANGE - range });
  if (ARC_BONUS[arc]) tally.push({ side: 'attack', label: `${arc} attack`, value: ARC_BONUS[arc] });
  if (!ranged && hasBridge(state.map, attackerHex, target.hex)) tally.push({ side: 'attack', label: 'across a bridge', value: BRIDGE_ATTACK });
  else if (!ranged && hasRiver(state.map, attackerHex, target.hex)) tally.push({ side: 'attack', label: 'across a river', value: RIVER_ATTACK });
  const height = elevationAt(state.map, attackerHex) - elevationAt(state.map, target.hex);
  if (height > 0) tally.push({ side: 'attack', label: `higher ground (${height} above)`, value: height });
  if (height < 0) tally.push({ side: 'attack', label: `${ranged ? 'firing' : 'attacking'} uphill (${-height} below)`, value: height });
  tally.push(ranged
    ? { side: 'defence', label: 'base defence against fire', value: FIRE_DEFENCE }
    : { side: 'defence', label: 'base defence', value: BASE_DEFENCE });
  if (cover.defense > 0) tally.push({ side: 'defence', label: `cover (${cover.name.toLowerCase()})`, value: cover.defense });
  if (cover.defense < 0) tally.push({ side: 'defence', label: `exposed (${cover.name.toLowerCase()})`, value: cover.defense });
  const attack = tally.filter((t) => t.side === 'attack').reduce((n, t) => n + t.value, 0);
  const defence = tally.filter((t) => t.side === 'defence').reduce((n, t) => n + t.value, 0);
  return { ranged, arc, tally, attack, defence, hits: Math.max(0, attack - defence) };
}

/** Whether a unit at `hex` facing `facing` can fire at `target`: in range, in its front arc and in sight. */
export function canFireAt(state: GameState, attacker: Unit, hex: HexKey, facing: Facing, target: HexKey): boolean {
  const range = stats(state, attacker).range;
  const d = distance(hex, target);
  return range > 1 && d > 1 && d <= range && arcOf(hex, facing, target) === 'front' && canSee(state, hex, target, range);
}

/**
 * The adjacent enemies that stop a unit at `hex` from firing: those facing it, with the unit on one of
 * their front three hexsides (#32). Enemies showing it their flank or rear don't stop it.
 */
export function pinnedBy(state: GameState, attacker: Unit, hex: HexKey): Unit[] {
  const adj = new Set(neighbors(hex));
  return alive(state).filter((o) => o.owner !== attacker.owner && adj.has(o.hex) && arcOf(o.hex, o.facing, hex) === 'front');
}

/**
 * Enemies a unit could attack from a hex, for the player to pick from: every living enemy next to it
 * (close combat, weakest first), then, unless an adjacent enemy faces it, every enemy it can fire at
 * (nearest first, then weakest).
 */
export function targetsFrom(state: GameState, attacker: Unit, hex: HexKey, facing: Facing = attacker.facing): Unit[] {
  const adj = new Set(neighbors(hex));
  const enemies = alive(state).filter((o) => o.owner !== attacker.owner);
  const close = enemies.filter((o) => adj.has(o.hex)).sort((a, b) => a.strength - b.strength || a.id.localeCompare(b.id));
  if (pinnedBy(state, attacker, hex).length) return close;
  const fire = enemies.filter((o) => canFireAt(state, attacker, hex, facing, o.hex))
    .sort((a, b) => distance(hex, a.hex) - distance(hex, b.hex) || a.strength - b.strength || a.id.localeCompare(b.id));
  return [...close, ...fire];
}

function resolveCombat(state: GameState, attacker: PlayerId, orders: PlayerOrders, events: GameEvent[], struck: Set<UnitId>): void {
  // Attacks are optional and deliberate (#31): a unit attacks only the enemy its orders name, and
  // only if that enemy is in reach after movement: next to it (close combat), or, unless an adjacent
  // enemy faces it (#32), in range, in front and in sight (fire). All attacks land together, after movement.
  const units = alive(state);
  const hits = new Map<UnitId, number>();
  for (const u of units) {
    if (u.owner !== attacker || !orders[u.id]?.target) continue;
    const t = targetsFrom(state, u, u.hex).find((x) => x.id === orders[u.id].target);
    if (!t) continue;
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
  resolveMorale(state, [...new Set([...struck, ...hits.keys()])], events);
}

// ---------------------------------------------------------------- morale (PLACEHOLDER numbers)

/** Rallying units help friends within this many hexes. */
export const RALLY_RANGE = 2;
/** A unit this many hexes or fewer from its army's main body is not isolated. */
export const MAIN_BODY_RANGE = 3;
/** Beyond MAIN_BODY_RANGE, −1 morale for every this many hexes further (or part of it). */
export const ISOLATION_STEP = 3;

/**
 * The centre of a player's army: the living unit with the smallest total distance to the others
 * (ties broken by unit id), or undefined if the player has no units.
 */
export function mainBody(state: GameState, owner: PlayerId): Unit | undefined {
  const army = alive(state).filter((u) => u.owner === owner);
  let best: Unit | undefined;
  let bestSum = Infinity;
  for (const u of [...army].sort((a, b) => a.id.localeCompare(b.id))) {
    const sum = army.reduce((n, o) => n + distance(u.hex, o.hex), 0);
    if (sum < bestSum) { best = u; bestSum = sum; }
  }
  return best;
}

/** Whether a unit with this much strength left must check morale: half its starting strength or less. */
export const mustCheckMorale = (state: GameState, unit: Unit): boolean =>
  unit.strength > 0 && unit.strength * 2 <= stats(state, unit).strength;

/** The morale tally for a unit as things stand: morale, rallying friends and isolation, against losses. */
export function moraleTally(state: GameState, unit: Unit): Pick<MoraleEvent, 'tally' | 'morale' | 'losses' | 'held'> {
  const ds = stats(state, unit);
  const tally: MoraleEvent['tally'] = [{ label: `${ds.name} morale`, value: ds.morale }];
  const friends = alive(state).filter((u) => u.owner === unit.owner && u.id !== unit.id);
  for (const f of friends) {
    const rally = stats(state, f).rally;
    const d = distance(unit.hex, f.hex);
    if (rally > 0 && d <= RALLY_RANGE) tally.push({ label: `rallied by ${f.name} (${d} hex${d === 1 ? '' : 'es'} away)`, value: rally });
  }
  const centre = mainBody(state, unit.owner);
  const far = centre ? distance(unit.hex, centre.hex) - MAIN_BODY_RANGE : 0;
  if (far > 0) {
    tally.push({ label: `isolated (${far + MAIN_BODY_RANGE} hexes from the main body at ${centre!.name})`, value: -Math.ceil(far / ISOLATION_STEP) });
  }
  const morale = tally.reduce((n, t) => n + t.value, 0);
  const losses = ds.strength - unit.strength;
  return { tally, morale, losses, held: morale > losses };
}

function resolveMorale(state: GameState, hitIds: UnitId[], events: GameEvent[]): void {
  // Every unit that took hits this turn and is down to half strength or less checks morale. All
  // checks are made against the battlefield as it stands after the attacks, then failures disband.
  const checks: MoraleEvent[] = [];
  for (const id of [...hitIds].sort()) {
    const u = state.units.find((x) => x.id === id)!;
    if (!mustCheckMorale(state, u)) continue;
    checks.push({ type: 'morale', unit: u.id, owner: u.owner, unitType: u.type, hex: u.hex, ...moraleTally(state, u) });
  }
  for (const c of checks) {
    events.push(c);
    if (!c.held) state.units.find((x) => x.id === c.unit)!.strength = 0;
  }
}

// ---------------------------------------------------------------- scoring and victory, by scenario (#37)

/** The player holding an objective: one of their units is on it with no enemy next to it. */
export function holderOf(state: GameState, hex: HexKey): PlayerId | null {
  const units = alive(state);
  const on = units.find((u) => u.hex === hex);
  return on && enemiesAdjacent(units, on).length === 0 ? on.owner : null;
}

function resolveScoring(state: GameState, scorer: PlayerId, events: GameEvent[]): void {
  const score = (e: Omit<ScoreEvent, 'type'>) => { state.scores[e.player] += e.points; events.push({ type: 'score', ...e }); };
  if (state.scenario === 'hold' || state.scenario === 'hill') {
    for (const hex of state.objectives) if (holderOf(state, hex) === scorer) score({ player: scorer, points: 1, reason: 'hold', hex });
  } else if (state.scenario === 'flags') {
    state.objectives.forEach((hex, i) => {
      const owner = state.objectiveOwners[i];
      if (owner !== scorer && holderOf(state, hex) === scorer) score({ player: scorer, points: FLAG_POINTS, reason: 'flag', hex });
    });
  } else if (state.scenario === 'annihilation') {
    // Every unit lost this turn scores its point value for whoever brought it down: the active player
    // for enemies, or the enemy whose free attack hit one of the active player's moving units.
    for (const e of events) {
      const lost = e.type === 'destroyed' || (e.type === 'morale' && !e.held) ? e : null;
      if (!lost) continue;
      const by = lost.owner !== scorer ? scorer
        : [...events].reverse().find((x): x is AttackEvent => x.type === 'attack' && !!x.free && x.target === lost.unit)?.attackerOwner;
      if (by && by !== lost.owner) score({ player: by, points: state.datasheets[lost.unitType].points, reason: 'kill', unit: lost.unit, unitOwner: lost.owner, unitType: lost.unitType });
    }
  }
  // Decisive Ground scores only when the battle ends (see resolvePlayerTurn).
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
  const struck = new Set<UnitId>(); // units hit by free attacks while moving (#33), for morale
  resolveMovement(state, { [active]: valid }, events, struck);
  resolveCombat(state, active, valid, events, struck);
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
  const hillWon = state.scenario === 'hill' && state.scores[active] >= HILL_TARGET;
  if (ownersAlive.size <= 1 || hillWon || (wrapped && state.turn >= state.turnLimit)) {
    // Decisive Ground: the objectives count once, when the battle ends.
    if (state.scenario === 'decisive') {
      for (const hex of state.objectives) {
        const holder = holderOf(state, hex);
        if (holder) { state.scores[holder] += 1; events.push({ type: 'score', player: holder, points: 1, reason: 'final', hex }); }
      }
    }
    const best = Math.max(...state.players.map((p) => (ownersAlive.has(p.id) ? state.scores[p.id] : -Infinity)));
    const winners = hillWon ? [active] : state.players.filter((p) => ownersAlive.has(p.id) && state.scores[p.id] === best).map((p) => p.id);
    state.finished = true;
    state.result = {
      winners,
      reason: hillWon ? `Held the hill for ${HILL_TARGET} turns.` : ownersAlive.size <= 1 ? 'Only one army remains.' : 'Turn limit reached.',
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
    objectiveOwners: state.objectiveOwners,
    scenario: state.scenario,
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
  /** Which way each of the active player's units would face at the end. */
  endFacing: Record<UnitId, Facing>;
}

/** Run the active player's planned orders through the rules without committing them. */
export function previewTurn(state: GameState, orders: PlayerOrders): TurnPreview {
  const active = currentPlayer(state);
  const { state: after, events } = resolvePlayerTurn(state, orders);
  const mine = after.units.filter((u) => u.owner === active);
  const endHex = Object.fromEntries(mine.map((u) => [u.id, u.hex]));
  const endFacing = Object.fromEntries(mine.map((u) => [u.id, u.facing]));
  return { events, endHex, endFacing };
}

export interface AttackOption extends AttackResult {
  target: Unit;
}

/** Every enemy a unit could attack from `hex`, with the tally sheet for each. */
export function attackOptions(state: GameState, unitId: UnitId, hex: HexKey, facing?: Facing): AttackOption[] {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) return [];
  return targetsFrom(state, unit, hex, facing ?? unit.facing).map((target) => ({ target, ...combatTally(state, unit, hex, target) }));
}
