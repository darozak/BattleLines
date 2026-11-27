import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbors, distance, line, label, facingToward, arcOf, FACING_NAMES, inBounds } from '../src/shared/hex.js';
import { edgeKey, stepCost, hasBridge, RIVER_CROSSING_COST, ROAD_STEP_COST, CLIMB_COST, RIVER_ATTACK, BRIDGE_ATTACK } from '../src/shared/terrain.js';
import { createSetupState, resolveDeployment, validateDeployment, startingZone, zoneOf, ERAS, MAP_SIZES, eraDatasheets } from '../src/shared/setup.js';
import { resolvePlayerTurn, validateOrders, boardView, canSee, combatTally, previewTurn, attackOptions, BASE_DEFENCE, FIRE_DEFENCE, ARC_BONUS, canFireAt, moraleTally, mustCheckMorale, mainBody } from '../src/shared/engine.js';
import type { AttackEvent, MoraleEvent, Datasheet, GameState, HexKey, PlayerOrders, Unit } from '../src/shared/types.js';

/** Simple unit types for rule tests (the eras' own units are tested separately). */
const TEST_UNITS: Record<string, Datasheet> = {
  infantry: { name: 'Infantry', code: 'I', points: 20, move: 4, sight: 5, strength: 4, climb: 1, morale: 3, rally: 0, fire: 0, range: 0 },
  scout: { name: 'Scout', code: 'S', points: 15, move: 6, sight: 7, strength: 2, climb: 2, morale: 2, rally: 0, fire: 0, range: 0 },
  heavy: { name: 'Heavy', code: 'H', points: 40, move: 3, sight: 4, strength: 6, climb: 1, morale: 4, rally: 1, fire: 0, range: 0 },
  rifle: { name: 'Rifles', code: 'R', points: 20, move: 4, sight: 6, strength: 3, climb: 1, morale: 3, rally: 0, fire: 4, range: 4 },
};
const START = [
  ['1,4', '1,7', '2,5', '0,6'], ['14,4', '14,7', '13,6', '15,5'], ['6,1', '9,1', '7,2', '8,0'], ['6,10', '9,10', '8,9', '7,11'],
];
const ROSTER = ['infantry', 'infantry', 'scout', 'heavy'];

/** A battle on a flat, open 16×12 map, each player with four units at fixed hexes. */
function openState(players = 2): GameState {
  const s = createSetupState('ww2', 'small', 150, Array.from({ length: players }, (_, i) => ({ id: `p${i}`, side: i })), 42);
  s.map.terrain.fill('open');
  s.map.elevation.fill(0);
  s.map.roads = [];
  s.map.rivers = [];
  s.datasheets = TEST_UNITS;
  s.phase = 'battle';
  s.turn = 1;
  let n = 0;
  s.units = s.players.flatMap((p) => START[p.side].map((hex, i) => ({
    id: `u${++n}`, owner: p.id, type: ROSTER[i], name: `${TEST_UNITS[ROSTER[i]].name} ${i + 1}`, hex, facing: facingToward(hex, '8,6'), strength: TEST_UNITS[ROSTER[i]].strength,
  })));
  return s;
}

const unit = (id: string, owner: string, type: string, hex: HexKey, extra: Partial<Unit> = {}): Unit =>
  ({ id, owner, type, name: id.toUpperCase(), hex, facing: 0, strength: { infantry: 4, scout: 2, heavy: 6, rifle: 3 }[type]!, ...extra });

/** Orders for unit `a` to attack unit `b`, staying put. */
const hit = (a: string, b: string): PlayerOrders => ({ [a]: { path: [], target: b } });

/** Resolve a turn for a given player (whatever the state says). */
function play(s: GameState, player: number, orders: PlayerOrders) {
  return resolvePlayerTurn({ ...s, current: player }, orders);
}

test('hex math', () => {
  assert.equal(neighbors('3,3').length, 6);
  assert.equal(neighbors('0,0', 10, 10).length, 2);
  for (const n of neighbors('4,5')) assert.equal(distance('4,5', n), 1);
  assert.equal(distance('0,0', '5,0'), 5);
  assert.equal(line('0,0', '4,0').length, 5);
  assert.equal(label('3,6'), 'D7');
});

test('validateOrders rejects foreign units, gaps and overlong paths', () => {
  const s = openState();
  const mine = s.units.find((u) => u.owner === 'p0' && u.type === 'heavy')!; // move 3
  const theirs = s.units.find((u) => u.owner === 'p1')!;
  assert.equal(validateOrders(s, 'p0', { [theirs.id]: { path: [neighbors(theirs.hex)[0]] } }).ok, false);
  assert.equal(validateOrders(s, 'p0', { [mine.id]: { path: ['9,9'] } }).ok, false);
  let h = mine.hex; const path: HexKey[] = [];
  for (let i = 0; i < 4; i++) { h = neighbors(h, 16, 12).find((n) => !path.includes(n) && n !== mine.hex)!; path.push(h); }
  assert.equal(validateOrders(s, 'p0', { [mine.id]: { path: path.slice(0, 3) } }).ok, true);
  assert.equal(validateOrders(s, 'p0', { [mine.id]: { path } }).ok, false);
});

test('a player turn: ordered units move, others hold, play passes on', () => {
  const s = openState();
  const u = s.units.find((x) => x.owner === 'p0' && x.type === 'infantry')!;
  const { state, events } = resolvePlayerTurn(s, { [u.id]: { path: ['2,4', '3,4'] } });
  assert.equal(state.units.find((x) => x.id === u.id)!.hex, '3,4');
  assert.ok(events.some((e) => e.type === 'move' && e.unit === u.id));
  assert.equal(state.current, 1, "now it is player 2's turn");
  assert.equal(state.turn, 1, 'same round');
  assert.equal(s.units.find((x) => x.id === u.id)!.hex, u.hex, 'input state is not mutated');
  const next = resolvePlayerTurn(state, {}).state;
  assert.equal(next.current, 0);
  assert.equal(next.turn, 2, 'a new round starts when play returns to player 1');
});

test('orders for another player\'s units are ignored', () => {
  const s = openState();
  const theirs = s.units.find((x) => x.owner === 'p1')!;
  const { state } = resolvePlayerTurn(s, { [theirs.id]: { path: [neighbors(theirs.hex, 16, 12)[0]] } });
  assert.equal(state.units.find((x) => x.id === theirs.id)!.hex, theirs.hex);
});

test('a unit cannot move into an enemy', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'infantry', '5,5'), unit('b', 'p1', 'infantry', '7,5')];
  const { state, events } = play(s, 0, { a: { path: ['6,5', '7,5'] } });
  assert.equal(state.units.find((u) => u.id === 'a')!.hex, '6,5');
  assert.ok(events.some((e) => e.type === 'halt' && e.unit === 'a'));
});

test('a friendly column can follow its leader', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'infantry', '3,5'), unit('b', 'p0', 'infantry', '2,5'), unit('z', 'p1', 'infantry', '15,11')];
  const { state } = play(s, 0, { a: { path: ['4,5', '5,5'] }, b: { path: ['3,5', '4,5'] } });
  assert.equal(state.units.find((u) => u.id === 'a')!.hex, '5,5');
  assert.equal(state.units.find((u) => u.id === 'b')!.hex, '4,5');
});

test('friendly units pass through each other, but never end a move in the same hex', () => {
  const s = openState();
  const z = unit('z', 'p1', 'infantry', '15,11');
  // Through a unit that stays put.
  s.units = [unit('a', 'p0', 'infantry', '3,5'), unit('still', 'p0', 'heavy', '4,5'), z];
  let r = play(s, 0, { a: { path: ['4,5', '5,5'] } });
  assert.equal(r.state.units.find((u) => u.id === 'a')!.hex, '5,5');
  assert.ok(!r.events.some((e) => e.type === 'halt'));
  // Crossing routes: a goes east along row 5, b goes north across it at the same moment.
  s.units = [unit('a', 'p0', 'infantry', '2,5'), unit('b', 'p0', 'infantry', '4,6'), z];
  r = play(s, 0, { a: { path: ['3,5', '4,5', '5,5'] }, b: { path: ['4,5', '4,4'] } });
  assert.equal(r.state.units.find((u) => u.id === 'a')!.hex, '5,5');
  assert.equal(r.state.units.find((u) => u.id === 'b')!.hex, '4,4');
  // Ending on a unit that stays put: step back to the last free hex of the route.
  s.units = [unit('a', 'p0', 'infantry', '2,5'), unit('still', 'p0', 'heavy', '4,5'), z];
  r = play(s, 0, { a: { path: ['3,5', '4,5'] } });
  assert.equal(r.state.units.find((u) => u.id === 'a')!.hex, '3,5');
  assert.ok(r.events.some((e) => e.type === 'halt' && e.unit === 'a' && /no room/.test(e.reason)));
  // Two units ending in the same hex: the one that got there first keeps it.
  s.units = [unit('far', 'p0', 'infantry', '1,5'), unit('near', 'p0', 'infantry', '4,6'), z];
  r = play(s, 0, { far: { path: ['2,5', '3,5', '4,5'] }, near: { path: ['4,5'] } });
  assert.equal(r.state.units.find((u) => u.id === 'near')!.hex, '4,5', 'arrived first');
  assert.equal(r.state.units.find((u) => u.id === 'far')!.hex, '3,5', 'stepped back one hex');
  assert.equal(new Set(r.state.units.map((u) => u.hex)).size, r.state.units.length);
  // Enemies still block.
  s.units = [unit('a', 'p0', 'infantry', '2,5'), unit('e', 'p1', 'infantry', '4,5')];
  r = play(s, 0, { a: { path: ['3,5', '4,5', '5,5'] } });
  assert.equal(r.state.units.find((u) => u.id === 'a')!.hex, '3,5');
});

test('movement halts on contact with a new enemy', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'scout', '2,5'), unit('b', 'p1', 'heavy', '6,5')];
  const { state } = play(s, 0, { a: { path: ['3,5', '4,5', '5,5', '5,4'] } });
  assert.equal(state.units.find((u) => u.id === 'a')!.hex, '5,5');
});

test('only the active player attacks', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'heavy', '5,5'), unit('b', 'p1', 'heavy', '6,5')];
  assert.equal(play(s, 0, {}).events.some((e) => e.type === 'attack'), false, 'attacks are optional: no orders, no attack');
  assert.equal(play(s, 0, hit('b', 'a')).events.some((e) => e.type === 'attack'), false, 'only your own units take orders');
  const { events } = play(s, 0, hit('a', 'b'));
  const attacks = events.filter((e): e is AttackEvent => e.type === 'attack');
  assert.equal(attacks.length, 1);
  assert.equal(attacks[0].attacker, 'a');
});

test('everyone sees the whole board; only the viewer\'s own units get orders data', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'infantry', '2,5'), unit('far', 'p1', 'infantry', '14,5'), unit('dead', 'p1', 'scout', '9,9', { strength: 0 })];
  const v = boardView(s, 'p0');
  assert.deepEqual(v.units.map((u) => u.id), ['a', 'far'], 'all living units, however far away');
  const own = v.units.find((u) => u.id === 'a')!;
  assert.ok(own.own && own.move === 4);
  assert.equal(own.own && own.name, 'A', 'unit name is not replaced by the datasheet name');
  assert.ok(boardView(s, null).units.every((u) => !u.own));
});

test('line of sight is blocked by dense forest, not light forest (kept for future rules)', () => {
  const s = openState();
  assert.ok(canSee(s, '2,5', '2,9', 5));
  s.map.terrain[7 * 16 + 1] = 'light_forest';
  s.map.terrain[7 * 16 + 2] = 'light_forest';
  s.map.terrain[7 * 16 + 3] = 'light_forest';
  assert.ok(canSee(s, '2,5', '2,9', 5), 'light forest: still in sight');
  s.map.terrain[7 * 16 + 1] = 'dense_forest';
  s.map.terrain[7 * 16 + 2] = 'dense_forest';
  s.map.terrain[7 * 16 + 3] = 'dense_forest';
  assert.ok(!canSee(s, '2,5', '2,9', 5));
});

test('resolution is deterministic: same state and orders give the same result', () => {
  const s = openState(4);
  const orders = { u1: { path: ['2,4', '3,4'] } };
  assert.deepEqual(resolvePlayerTurn(s, orders), resolvePlayerTurn(s, orders));
});

test('two of your units wanting the same hex: the first in roster order goes, every time', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'infantry', '3,5'), unit('b', 'p0', 'infantry', '5,5'), unit('z', 'p1', 'infantry', '15,11')];
  for (let i = 0; i < 3; i++) {
    const { state } = play(s, 0, { a: { path: ['4,5'] }, b: { path: ['4,5'] } });
    assert.equal(state.units.find((u) => u.id === 'a')!.hex, '4,5');
    assert.equal(state.units.find((u) => u.id === 'b')!.hex, '5,5');
  }
});

test('game ends after the last player of the final round', () => {
  const s = openState();
  s.turn = s.turnLimit;
  const mid = resolvePlayerTurn(s, {}).state;
  assert.ok(!mid.finished, 'player 2 still gets their last turn');
  const { state, events } = resolvePlayerTurn(mid, {});
  assert.ok(state.finished);
  assert.ok(events.some((e) => e.type === 'gameover'));
});

test('facing: directions and arcs', () => {
  neighbors('5,5').forEach((n, i) => assert.equal(facingToward('5,5', n), i, `toward neighbour ${i}`));
  const arcs = neighbors('5,5').map((n) => arcOf('5,5', 0, n));
  assert.deepEqual(arcs, ['front', 'front', 'flank', 'rear', 'flank', 'front']);
  assert.equal(FACING_NAMES[facingToward('0,5', '9,5')], 'E');
});

test('facing: moving units face their last step unless ordered otherwise', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'infantry', '3,5', { facing: 3 }), unit('b', 'p0', 'infantry', '3,8'),
    unit('c', 'p0', 'infantry', '3,2'), unit('z', 'p1', 'infantry', '15,11', { facing: 3 })];
  const { state, events } = play(s, 0, {
    a: { path: ['4,5', '5,5'] },          // moves east, no facing given
    b: { path: ['4,8'], facing: 2 },      // moves east, then turns NW
    c: { path: [], facing: 4 },           // turns SW without moving
  });
  const f = (id: string) => state.units.find((u) => u.id === id)!.facing;
  assert.equal(f('a'), 0);
  assert.equal(f('b'), 2);
  assert.equal(f('c'), 4);
  assert.equal(f('z'), 3, 'units without orders keep their facing');
  assert.ok(events.some((e) => e.type === 'turn' && e.unit === 'c'));
  assert.equal(validateOrders(s, 'p0', { a: { path: [], facing: 6 } }).ok, false);
  assert.equal(validateOrders(s, 'p0', { a: { path: [], facing: 1 } }).ok, true);
});

test('combat: no dice, hits = attack - defence, every modifier on the tally', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'heavy', '5,5'), unit('b', 'p1', 'scout', '6,5')]; // a is directly behind b
  const onB = play(s, 0, hit('a', 'b')).events.find((e): e is AttackEvent => e.type === 'attack')!;
  assert.equal(onB.arc, 'rear');
  assert.deepEqual(onB.tally.map((l) => [l.side, l.label, l.value]), [
    ['attack', 'A strength', 6], ['attack', 'rear attack', 2], ['defence', 'base defence', BASE_DEFENCE]]);
  assert.equal(onB.attack, 8);
  assert.equal(onB.defence, 3);
  assert.equal(onB.hits, 5);
  assert.equal(play(s, 0, hit('a', 'b')).state.units.find((u) => u.id === 'b')!.strength, 0, 'scout destroyed');
  // From b's side: a front attack on the heavy, in the open. 2 - 3 is below 0: no hits.
  const onA = play(s, 1, hit('b', 'a')).events.find((e): e is AttackEvent => e.type === 'attack')!;
  assert.equal(onA.arc, 'front');
  assert.equal(onA.hits, 0);
  // Cover adds to defence.
  s.map.terrain[5 * 16 + 6] = 'light_forest';
  const inWoods = combatTally(s, s.units[0], '5,5', s.units[1]);
  assert.ok(inWoods.tally.some((l) => l.side === 'defence' && l.label === 'cover (light forest)' && l.value === 1));
  // Dense forest gives more cover.
  s.map.terrain[5 * 16 + 6] = 'dense_forest';
  assert.equal(combatTally(s, s.units[0], '5,5', s.units[1]).defence, BASE_DEFENCE + 2);
  assert.equal(inWoods.hits, 4);
});

test('ranged attacks: fire at an enemy in range, in the front arc and in sight', () => {
  const s = openState();
  const shooter = unit('a', 'p0', 'rifle', '4,5', { facing: facingToward('4,5', '7,5') });
  s.units = [shooter, unit('b', 'p1', 'infantry', '7,5')];
  const shot = play(s, 0, hit('a', 'b')).events.find((e): e is AttackEvent => e.type === 'attack')!;
  assert.equal(shot.ranged, true);
  assert.deepEqual(shot.tally.filter((l) => l.side === 'attack').slice(0, 2).map((l) => [l.label, l.value]), [['A fire', 4], ['range (3 hexes)', -1]]);
  assert.equal(shot.attack, 4 - 1 + ARC_BONUS[shot.arc]);
  assert.deepEqual(shot.tally.filter((l) => l.side === 'defence').map((l) => [l.label, l.value]), [['base defence against fire', FIRE_DEFENCE]]);
  assert.equal(shot.hits, Math.max(0, shot.attack - shot.defence));
  // Out of range, behind the shooter, or out of sight: no shot.
  assert.equal(play(s, 0, {}).events.some((e) => e.type === 'attack'), false, 'no order, no shot');
  const noShot = (st: GameState) => !play(st, 0, hit('a', 'b')).events.some((e) => e.type === 'attack');
  assert.ok(noShot({ ...s, units: [shooter, unit('b', 'p1', 'infantry', '9,5')] }), 'five hexes: out of range');
  assert.ok(noShot({ ...s, units: [{ ...shooter, facing: facingToward('4,5', '1,5') }, unit('b', 'p1', 'infantry', '7,5')] }), 'behind');
  const blocked = structuredClone(s);
  const mid = line('4,5', '7,5')[1];
  blocked.map.terrain[Number(mid.split(',')[1]) * 16 + Number(mid.split(',')[0])] = 'dense_forest';
  assert.ok(noShot(blocked), 'dense forest in the way');
  assert.equal(canFireAt(s, shooter, '4,5', shooter.facing, '7,5'), true);
  // Units without a range never fire.
  assert.ok(noShot({ ...s, units: [{ ...shooter, type: 'infantry' }, unit('b', 'p1', 'infantry', '6,5')] }));
});

test('ranged attacks: the player picks the target; an enemy next to the unit means close combat', () => {
  const s = openState();
  const shooter = unit('a', 'p0', 'rifle', '4,5', { facing: facingToward('4,5', '7,5') });
  s.units = [shooter, unit('near', 'p1', 'infantry', '6,5'), unit('far', 'p1', 'scout', '8,5')];
  const atk = (orders: PlayerOrders) => play(s, 0, orders).events.find((e): e is AttackEvent => e.type === 'attack')!;
  assert.equal(atk({ a: { path: [], target: 'near' } }).target, 'near');
  assert.equal(atk({ a: { path: [], target: 'far' } }).target, 'far', 'the ordered target');
  assert.deepEqual(attackOptions(s, 'a', '4,5').map((o) => o.target.id), ['near', 'far'], 'options nearest first');
  s.units.push(unit('adj', 'p1', 'infantry', '5,5'));
  assert.equal(play(s, 0, { a: { path: [], target: 'far' } }).events.some((e) => e.type === 'attack'), false, "can't fire past an enemy next to it");
  const close = atk({ a: { path: [], target: 'adj' } });
  assert.deepEqual([close.target, close.ranged, close.tally[0].label], ['adj', false, 'A strength']);
});

test('morale: a unit at half strength or less holds only while its morale beats its losses', () => {
  const s = openState();
  const b = unit('b', 'p1', 'infantry', '8,5'); // morale 3, strength 4
  s.units = [unit('a', 'p0', 'heavy', '2,2'), b];
  assert.equal(mustCheckMorale(s, { ...b, strength: 3 }), false);
  assert.equal(mustCheckMorale(s, { ...b, strength: 2 }), true);
  assert.equal(moraleTally(s, { ...b, strength: 2 }).held, true, '3 morale beats 2 losses');
  const shaken = moraleTally(s, { ...b, strength: 1 });
  assert.deepEqual([shaken.morale, shaken.losses, shaken.held], [3, 3, false], '3 morale does not beat 3 losses');
  // A rallying friend within two hexes adds its rally value; one further away does not.
  s.units.push(unit('c', 'p1', 'heavy', '10,5'));
  const rallied = moraleTally(s, { ...b, strength: 1 });
  assert.deepEqual(rallied.tally.map((t) => t.value), [3, 1]);
  assert.equal(rallied.held, true);
  s.units[2].hex = '11,5';
  assert.equal(moraleTally(s, { ...b, strength: 1 }).held, false);
});

test('morale: distance from the army\'s main body weakens morale', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'infantry', '0,0'),
    unit('m1', 'p1', 'infantry', '2,6'), unit('m2', 'p1', 'infantry', '2,7'), unit('m3', 'p1', 'infantry', '3,6'),
    unit('far', 'p1', 'infantry', '12,6', { strength: 2 })];
  const centre = mainBody(s, 'p1')!;
  assert.ok(['m1', 'm2', 'm3'].includes(centre.id));
  const d = distance('12,6', centre.hex);
  const t = moraleTally(s, s.units[4]);
  assert.deepEqual(t.tally[1].value, -Math.ceil((d - 3) / 3));
  assert.ok(t.tally[1].label.startsWith(`isolated (${d} hexes`));
  assert.equal(t.held, false, 'isolated: 3 - 3 does not beat 2 losses');
  // Close to the main body there is no penalty.
  assert.equal(moraleTally(s, { ...s.units[4], hex: '5,6' }).tally.length, 1);
});

test('morale: badly damaged units check after the attacks, and disband if they fail', () => {
  const s = openState();
  s.map.terrain[5 * 16 + 6] = 'dense_forest'; // the heavy's rear attack: 8 against 5, 3 hits
  s.units = [unit('a', 'p0', 'heavy', '5,5'), unit('b', 'p1', 'infantry', '6,5')];
  const r = play(s, 0, hit('a', 'b'));
  const m = r.events.find((e): e is MoraleEvent => e.type === 'morale')!;
  assert.deepEqual([m.unit, m.morale, m.losses, m.held], ['b', 3, 3, false]);
  assert.equal(r.state.units.find((u) => u.id === 'b')!.strength, 0, 'b disbands');
  // The preview shows the same check before the turn ends.
  assert.deepEqual(previewTurn(s, hit('a', 'b')).events.filter((e) => e.type === 'morale'), [m]);
  // A rallying heavy next to b keeps it in the fight.
  s.units.push(unit('d', 'p1', 'heavy', '7,5'));
  const r2 = play(s, 0, hit('a', 'b'));
  const m2 = r2.events.find((e): e is MoraleEvent => e.type === 'morale')!;
  assert.deepEqual([m2.morale, m2.held], [4, true]);
  assert.equal(r2.state.units.find((u) => u.id === 'b')!.strength, 1);
  // A unit still above half strength does not check: an infantry attack does 1 hit (6 against 5).
  s.units[0].type = 'infantry'; s.units[0].strength = 4;
  assert.equal(play(s, 0, hit('a', 'b')).events.some((e) => e.type === 'morale'), false);
});

test('combat: only the ordered target is attacked, and only if it is in reach', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'heavy', '5,5'), unit('weak', 'p1', 'scout', '6,5'), unit('strong', 'p1', 'infantry', '4,5')];
  const target = (orders: PlayerOrders) => play(s, 0, orders).events.find((e): e is AttackEvent => e.type === 'attack')!.target;
  const attacks = (orders: PlayerOrders) => play(s, 0, orders).events.filter((e) => e.type === 'attack').length;
  assert.equal(attacks({}), 0, 'no order, no attack');
  assert.equal(target({ a: { path: [], target: 'weak' } }), 'weak');
  assert.equal(target({ a: { path: [], target: 'strong' } }), 'strong');
  assert.equal(attacks({ a: { path: [], target: 'nobody' } }), 0, 'invalid targets are dropped by validation');
  assert.equal(attacks({ a: { path: ['5,6', '5,7'], target: 'strong' } }), 0, 'moved out of reach: no attack');
  assert.equal(validateOrders(s, 'p0', { a: { path: [], target: 'a' } }).ok, false, 'cannot target your own unit');
});

test('preview: exactly what ending the turn will do, and the options for each unit', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'heavy', '3,5'), unit('weak', 'p1', 'scout', '6,5'), unit('strong', 'p1', 'infantry', '6,4')];
  const orders = { a: { path: ['4,5', '5,5'] } };
  const pv = previewTurn(s, orders);
  assert.deepEqual(pv.events, play(s, 0, orders).events, 'the preview is the real result');
  assert.equal(pv.endHex.a, '5,5');
  const opts = attackOptions(s, 'a', pv.endHex.a);
  assert.deepEqual(opts.map((o) => o.target.id), ['weak', 'strong']);
  assert.ok(opts.every((o) => o.hits === o.attack - o.defence || (o.hits === 0 && o.attack < o.defence)));
  assert.deepEqual(attackOptions(s, 'a', '1,1'), [], 'nothing in reach');
});

test('elevation: units climb or descend at most their climb value per step', () => {
  const s = openState();
  s.units = [unit('inf', 'p0', 'infantry', '3,5'), unit('sc', 'p0', 'scout', '3,7'), unit('z', 'p1', 'infantry', '15,11')];
  const at = (hex: HexKey) => { const [c, r] = hex.split(',').map(Number); return r * 16 + c; };
  s.map.elevation[at('4,5')] = 1;  // a gentle rise: fine for everyone
  s.map.elevation[at('5,5')] = 3;  // then a cliff of 2
  s.map.elevation[at('4,7')] = 2;  // a 2-level step: only the scout (climb 2) can make it
  assert.equal(validateOrders(s, 'p0', { inf: { path: ['4,5'] } }).ok, true);
  assert.match(validateOrders(s, 'p0', { inf: { path: ['4,5', '5,5'] } }).errors[0], /can't climb 2 levels/);
  assert.equal(validateOrders(s, 'p0', { sc: { path: ['4,7'] } }).ok, true, 'scouts climb 2');
  s.units[0].hex = '5,5';
  assert.match(validateOrders(s, 'p0', { inf: { path: ['6,5'] } }).errors[0], /can't descend 3 levels/);
  // Invalid orders are dropped when the turn is resolved: the unit stays put.
  assert.equal(play(s, 0, { inf: { path: ['6,5'] } }).state.units.find((u) => u.id === 'inf')!.hex, '5,5');
});

test('elevation: higher ground adds to the attack, attacking uphill takes away', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'heavy', '5,5', { facing: 0 }), unit('b', 'p1', 'infantry', '6,5', { facing: 3 })]; // face to face: E and W
  const at = (hex: HexKey) => { const [c, r] = hex.split(',').map(Number); return r * 16 + c; };
  s.map.elevation[at('5,5')] = 2;
  s.map.elevation[at('6,5')] = 0;
  const down = combatTally(s, s.units[0], '5,5', s.units[1]);
  assert.ok(down.tally.some((l) => l.label === 'higher ground (2 above)' && l.value === 2));
  assert.equal(down.attack, 8);
  const up = combatTally(s, s.units[1], '6,5', s.units[0]);
  assert.ok(up.tally.some((l) => l.label === 'attacking uphill (2 below)' && l.value === -2));
  assert.equal(up.attack, 2);
  assert.equal(up.hits, 0);
  s.map.elevation[at('5,5')] = 0;
  assert.ok(!combatTally(s, s.units[0], '5,5', s.units[1]).tally.some((l) => /ground|uphill/.test(l.label)), 'level ground: no modifier');
});

test('elevation: generated with the map, the same for the same seed, hills higher', () => {
  const players = [{ id: 'p0', side: 0 }, { id: 'p1', side: 1 }];
  const a = createSetupState('ww2', 'large', 150, players, 11).map;
  const b = createSetupState('ww2', 'large', 150, players, 11).map;
  assert.deepEqual(a.elevation, b.elevation);
  assert.equal(a.elevation.length, a.cols * a.rows);
  assert.ok(a.elevation.every((e) => Number.isInteger(e) && e >= 0 && e <= 4));
  assert.ok(new Set(a.elevation).size >= 3, 'the ground varies');
  a.terrain.forEach((t, i) => { if (t === 'water') assert.equal(a.elevation[i], 0); });
});

test('roads: following one costs ½ a step whatever the terrain', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'heavy', '2,5'), unit('z', 'p1', 'infantry', '15,11')]; // move 3
  for (const h of ['3,5', '4,5', '5,5']) s.map.terrain[Number(h.split(',')[1]) * 16 + Number(h.split(',')[0])] = 'dense_forest';
  const path = ['3,5', '4,5', '5,5'];
  assert.equal(validateOrders(s, 'p0', { a: { path } }).ok, false, 'three hexes of dense forest: 9 points');
  s.map.roads = [edgeKey('2,5', '3,5'), edgeKey('3,5', '4,5'), edgeKey('4,5', '5,5')];
  assert.equal(validateOrders(s, 'p0', { a: { path } }).ok, true, 'along the road: 1½ points');
  assert.equal(play(s, 0, { a: { path } }).state.units[0].hex, '5,5');
  assert.equal(stepCost(s.map, '5,5', '6,5'), 1, 'leaving the road: the terrain cost again (open)');
  // A road doubles a unit's move: six hexes for a move of 3.
  const long = ['3,5', '4,5', '5,5', '6,5', '7,5', '8,5'];
  s.map.roads = long.map((h, i) => edgeKey(i ? long[i - 1] : '2,5', h));
  assert.equal(validateOrders(s, 'p0', { a: { path: long } }).ok, true);
  assert.equal(validateOrders(s, 'p0', { a: { path: [...long, '9,5'] } }).ok, false, 'off the road: no movement left');
});

test('movement: marshes and woods are slow, climbs cost extra, and the first step is always allowed', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'heavy', '4,5'), unit('z', 'p1', 'infantry', '15,11')]; // move 3
  const set = (h: string, t: GameState['map']['terrain'][number], e = 0) => {
    const i = Number(h.split(',')[1]) * 16 + Number(h.split(',')[0]);
    s.map.terrain[i] = t; s.map.elevation[i] = e;
  };
  set('5,5', 'marsh');
  assert.equal(stepCost(s.map, '4,5', '5,5'), 3);
  assert.equal(validateOrders(s, 'p0', { a: { path: ['5,5', '6,5'] } }).ok, false, 'marsh uses the whole move');
  set('5,5', 'light_forest');
  assert.equal(validateOrders(s, 'p0', { a: { path: ['5,5', '6,5'] } }).ok, true, 'light forest 2 + open 1');
  set('5,5', 'open', 1);
  assert.equal(stepCost(s.map, '4,5', '5,5'), 1 + CLIMB_COST, 'climbing a level');
  assert.equal(stepCost(s.map, '5,5', '4,5'), 1, 'descending is free');
  set('5,5', 'dense_forest', 1);
  assert.equal(stepCost(s.map, '4,5', '5,5'), 4, 'uphill into dense forest: more than a move of 3');
  assert.equal(validateOrders(s, 'p0', { a: { path: ['5,5'] } }).ok, true, 'but the first step is always allowed');
  assert.equal(validateOrders(s, 'p0', { a: { path: ['3,5', '4,5'] } }).ok, true);
  set('2,5', 'open');
  const later = neighbors('5,5').find((h) => h !== '4,5' && neighbors(h).includes('4,5'))!;
  assert.match(validateOrders(s, 'p0', { a: { path: [later, '5,5'] } }).errors.join(), /not enough movement/, 'not as a later step');
});

test('rivers: crossing costs extra and weakens attacks; a bridge removes the extra cost', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'heavy', '4,5', { facing: 0 }), unit('b', 'p1', 'infantry', '6,5', { facing: 3 })];
  s.map.rivers = [edgeKey('4,5', '5,5'), edgeKey('5,5', '6,5')];
  assert.equal(stepCost(s.map, '4,5', '5,5'), 1 + RIVER_CROSSING_COST);
  assert.equal(validateOrders(s, 'p0', { a: { path: ['5,5'] } }).ok, true, 'heavy (move 3) can ford: 3 points');
  assert.equal(validateOrders(s, 'p0', { a: { path: ['5,5', '5,4'] } }).ok, false, 'no movement left after fording');
  assert.match(validateOrders(s, 'p0', { a: { path: ['3,5', '4,5', '5,5'] } }).errors.join(), /must stop at the river/);
  assert.equal(validateOrders(s, 'p0', { a: { path: ['3,5', '4,5'] } }).ok, true, 'up to the bank');
  // Attacking across the river from 5,5 into 6,5.
  const across = combatTally(s, { ...s.units[0], hex: '5,5' }, '5,5', s.units[1]);
  assert.ok(across.tally.some((l) => l.label === 'across a river' && l.value === RIVER_ATTACK));
  // A road over the river: a bridge. No extra movement; a smaller attack penalty.
  s.map.roads = [edgeKey('4,5', '5,5'), edgeKey('5,5', '6,5')];
  assert.ok(hasBridge(s.map, '5,5', '4,5'));
  assert.equal(stepCost(s.map, '4,5', '5,5'), ROAD_STEP_COST);
  assert.equal(validateOrders(s, 'p0', { a: { path: ['3,5', '4,5', '5,5'] } }).ok, true, 'a bridge needs no stop');
  const bridge = combatTally(s, { ...s.units[0], hex: '5,5' }, '5,5', s.units[1]);
  assert.ok(bridge.tally.some((l) => l.label === 'across a bridge' && l.value === BRIDGE_ATTACK));
  assert.ok(!bridge.tally.some((l) => l.label === 'across a river'));
});

test('terrain: rivers along hex edges, branching roads between hex centres, bridges where they cross', () => {
  let branchingRoads = 0;
  for (const era of ['napoleonic', 'ww2']) {
    for (const size of ['small', 'medium', 'large']) {
      for (const seed of [1, 2, 3]) {
        const m = createSetupState(era, size, 150, [{ id: 'p0', side: 0 }, { id: 'p1', side: 1 }], seed).map;
        const label = `${era} ${size} ${seed}`;
        const all = (t: string) => m.terrain.map((x, i) => [x, `${i % m.cols},${Math.floor(i / m.cols)}`] as [string, string]).filter(([x]) => x === t).map(([, h]) => h);
        const pairs = (keys: string[]) => keys.map((k) => k.split('|'));
        for (const [a, b] of [...pairs(m.rivers), ...pairs(m.roads)]) {
          assert.ok(inBounds(a, m.cols, m.rows) && inBounds(b, m.cols, m.rows) && distance(a, b) === 1, `${label}: ${a}|${b} joins neighbours`);
        }
        // The river is one continuous line from the north edge to the south edge: the hexes along it connect.
        const riverside = new Set(pairs(m.rivers).flat());
        const linked = (from: string[], set: Set<string>) => {
          const seen = new Set(from);
          const queue = [...from];
          while (queue.length) for (const n of neighbors(queue.pop()!, m.cols, m.rows)) if (set.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
          return seen;
        };
        const fromNorth = linked([...riverside].filter((h) => h.endsWith(',0')), riverside);
        assert.ok(fromNorth.size > 0, `${label}: river starts at the north edge`);
        assert.ok([...fromNorth].some((h) => Number(h.split(',')[1]) >= m.rows - 2), `${label}: river reaches the south edge`);
        // Roads link west to east and north to south.
        const roadHexes = new Set(pairs(m.roads).flat());
        const roadFrom = (start: string[]) => {
          const adj = new Map<string, string[]>();
          for (const [a, b] of pairs(m.roads)) { adj.set(a, [...(adj.get(a) ?? []), b]); adj.set(b, [...(adj.get(b) ?? []), a]); }
          const seen = new Set(start);
          const queue = [...start];
          while (queue.length) for (const n of adj.get(queue.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
          return { seen, adj };
        };
        const west = roadFrom([...roadHexes].filter((h) => h.startsWith('0,')));
        assert.ok([...west.seen].some((h) => h.startsWith(`${m.cols - 1},`)), `${label}: a road runs west to east`);
        assert.ok([...west.seen].some((h) => h.endsWith(',0')) && [...west.seen].some((h) => h.endsWith(`,${m.rows - 1}`)), `${label}: roads run north to south, joined up`);
        if ([...west.adj.values()].some((n) => n.length >= 3)) branchingRoads++;
        // Roads crossing rivers are bridges, and every map has at least one.
        assert.ok(m.roads.some((k) => m.rivers.includes(k)), `${label}: a bridge`);
        assert.ok(all('marsh').some((h) => riverside.has(h) || neighbors(h, m.cols, m.rows).some((n) => riverside.has(n))), `${label}: marsh by the river`);
        assert.ok(all('light_forest').length > 0 && all('ruins').length > 0, `${label}: forest and ruins`);
        for (const h of all('dense_forest')) {
          assert.ok(neighbors(h, m.cols, m.rows).every((n) => all('light_forest').includes(n) || all('dense_forest').includes(n)), `${label}: dense forest ${h} sits inside a forest`);
        }
      }
    }
  }
  assert.ok(branchingRoads >= 12, `roads branch on most maps (${branchingRoads} of 18)`);
});

// ---------------------------------------------------------------- setup and turn 0

const setup = (players = 2, era = 'napoleonic', size = 'small', points = 100) =>
  createSetupState(era, size, points, Array.from({ length: players }, (_, i) => ({ id: `p${i}`, side: i })), 5);

test('setup: each era has its own terrain and armies, and unit types are unique across the era', () => {
  for (const era of Object.values(ERAS)) {
    assert.ok(era.armies.length >= 4, 'enough armies for four players, each with their own');
    const all = era.armies.flatMap((a) => Object.keys(a.units));
    assert.equal(new Set(all).size, all.length, 'unit ids are unique within the era');
    assert.ok(Object.values(eraDatasheets(era)).every((u) => u.points > 0 && u.climb >= 1));
  }
  const nap = setup(2, 'napoleonic', 'medium');
  assert.ok(nap.map.terrain.includes('village'), 'villages: Napoleonic only');
  const ww2 = setup(2, 'ww2', 'medium');
  assert.ok(ww2.map.terrain.includes('ruins') && !ww2.map.terrain.includes('village'));
  assert.equal(nap.phase, 'deploy');
  assert.equal(nap.units.length, 0);
  assert.deepEqual([nap.map.cols, nap.map.rows], [24, 18]);
});

test('setup: starting zones are on separate edges and never overlap', () => {
  for (const size of Object.values(MAP_SIZES)) {
    const zones = [0, 1, 2, 3].map((side) => startingZone(size, side));
    const all = zones.flat();
    assert.equal(new Set(all).size, all.length, `${size.id}: no hex in two zones`);
    assert.ok(zones.every((z) => z.length >= 2 * size.rows / 2), `${size.id}: zones have room`);
    assert.ok(zones[0].every((h) => Number(h.split(',')[0]) < size.zoneDepth), 'player 1: west edge');
    assert.ok(zones[1].every((h) => Number(h.split(',')[0]) >= size.cols - size.zoneDepth), 'player 2: east edge');
  }
  const s = setup(4, 'ww2', 'large');
  for (const p of s.players) {
    for (const h of zoneOf(s, p.id)) {
      const [c, r] = h.split(',').map(Number);
      assert.notEqual(s.map.terrain[r * s.map.cols + c], 'water', 'no water in a starting zone');
    }
  }
});

test('deployment: the army must be from the era, units from the army, in the zone, within the points', () => {
  const s = setup(2, 'napoleonic', 'small', 100);
  const ok = (d: unknown) => validateDeployment(s, 'p0', d);
  assert.equal(ok({ army: 'french', units: [{ type: 'french.line', hex: '0,3' }, { type: 'french.hussars', hex: '1,3' }] }).ok, true);
  assert.match(ok({ army: 'us', units: [] }).errors[0], /era's armies/);
  assert.match(ok({ army: 'french', units: [] }).errors.join(), /at least one unit/);
  assert.match(ok({ army: 'french', units: [{ type: 'british.line', hex: '0,3' }] }).errors.join(), /not a unit of the French/);
  assert.match(ok({ army: 'french', units: [{ type: 'french.line', hex: '5,5' }] }).errors.join(), /starting zone/);
  assert.match(ok({ army: 'french', units: [{ type: 'french.line', hex: '0,3' }, { type: 'french.line', hex: '0,3' }] }).errors.join(), /already taken/);
  // 3 × Old Guard = 120 points > 100.
  assert.match(ok({ army: 'french', units: ['0,1', '0,2', '0,3'].map((hex) => ({ type: 'french.guard', hex })) }).errors.join(), /120 points; the limit is 100/);
  assert.equal(ok({ army: 'french', units: ['0,1', '0,2'].map((hex) => ({ type: 'french.guard', hex })).concat([{ type: 'french.line', hex: '0,3' }]) }).ok, true, 'exactly 100 is allowed');
});

test('deployment: players deploy in turn, then round 1 begins with the first player', () => {
  let s = setup(3, 'ww2', 'small', 100);
  const d0 = resolveDeployment(s, { army: 'us', units: [{ type: 'us.rifles', hex: '0,4' }, { type: 'us.sherman', hex: '1,5' }] });
  assert.equal(d0.events[0].points, 65);
  s = d0.state;
  assert.equal(s.phase, 'deploy');
  assert.equal(s.current, 1);
  assert.equal(s.armies.p0, 'us');
  assert.deepEqual(s.units.map((u) => [u.id, u.owner, u.name]), [['u1', 'p0', 'Rifle Squad 1'], ['u2', 'p0', 'Sherman 1']]);
  assert.equal(s.units[0].facing, facingToward('0,4', '8,6'), 'units face the centre of the map');
  assert.throws(() => resolvePlayerTurn(s, {}), /still deploying/);
  s = resolveDeployment(s, { army: 'german', units: [{ type: 'german.panzer', hex: '15,5' }] }).state;
  assert.throws(() => resolveDeployment(s, { army: 'us', units: [{ type: 'us.rifles', hex: '0,4' }] }), /starting zone/, 'player 3 deploys on the north edge');
  assert.throws(() => resolveDeployment(s, { army: 'us', units: [{ type: 'us.recon', hex: '6,0' }] }), /already been chosen/, 'each player picks a different army');
  s = resolveDeployment(s, { army: 'soviet', units: [{ type: 'soviet.scouts', hex: '6,0' }] }).state;
  assert.equal(s.phase, 'battle');
  assert.equal(s.turn, 1);
  assert.equal(s.current, 0);
  assert.equal(s.units.length, 4);
});
