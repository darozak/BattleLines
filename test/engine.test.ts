import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbors, distance, line, label, facingToward, arcOf, FACING_NAMES } from '../src/shared/hex.js';
import { createSetupState, resolveDeployment, validateDeployment, startingZone, zoneOf, ERAS, MAP_SIZES, eraDatasheets } from '../src/shared/setup.js';
import { resolvePlayerTurn, validateOrders, boardView, canSee, combatTally, previewTurn, attackOptions, BASE_DEFENCE } from '../src/shared/engine.js';
import type { AttackEvent, Datasheet, GameState, HexKey, PlayerOrders, Unit } from '../src/shared/types.js';

/** Simple unit types for rule tests (the eras' own units are tested separately). */
const TEST_UNITS: Record<string, Datasheet> = {
  infantry: { name: 'Infantry', code: 'I', points: 20, move: 4, sight: 5, strength: 4, climb: 1 },
  scout: { name: 'Scout', code: 'S', points: 15, move: 6, sight: 7, strength: 2, climb: 2 },
  heavy: { name: 'Heavy', code: 'H', points: 40, move: 3, sight: 4, strength: 6, climb: 1 },
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
  ({ id, owner, type, name: id.toUpperCase(), hex, facing: 0, strength: { infantry: 4, scout: 2, heavy: 6 }[type]!, ...extra });

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

test('movement halts on contact with a new enemy', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'scout', '2,5'), unit('b', 'p1', 'heavy', '6,5')];
  const { state } = play(s, 0, { a: { path: ['3,5', '4,5', '5,5', '5,4'] } });
  assert.equal(state.units.find((u) => u.id === 'a')!.hex, '5,5');
});

test('only the active player attacks', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'heavy', '5,5'), unit('b', 'p1', 'heavy', '6,5')];
  const { events } = play(s, 0, {});
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

test('line of sight is blocked by woods (kept for future rules)', () => {
  const s = openState();
  assert.ok(canSee(s, '2,5', '2,9', 5));
  s.map.terrain[7 * 16 + 2] = 'woods';
  s.map.terrain[7 * 16 + 1] = 'woods';
  s.map.terrain[7 * 16 + 3] = 'woods';
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
  const onB = play(s, 0, {}).events.find((e): e is AttackEvent => e.type === 'attack')!;
  assert.equal(onB.arc, 'rear');
  assert.deepEqual(onB.tally.map((l) => [l.side, l.label, l.value]), [
    ['attack', 'A strength', 6], ['attack', 'rear attack', 2], ['defence', 'base defence', BASE_DEFENCE]]);
  assert.equal(onB.attack, 8);
  assert.equal(onB.defence, 3);
  assert.equal(onB.hits, 5);
  assert.equal(play(s, 0, {}).state.units.find((u) => u.id === 'b')!.strength, 0, 'scout destroyed');
  // From b's side: a front attack on the heavy, in the open. 2 - 3 is below 0: no hits.
  const onA = play(s, 1, {}).events.find((e): e is AttackEvent => e.type === 'attack')!;
  assert.equal(onA.arc, 'front');
  assert.equal(onA.hits, 0);
  // Cover adds to defence.
  s.map.terrain[5 * 16 + 6] = 'woods';
  const inWoods = combatTally(s, s.units[0], '5,5', s.units[1]);
  assert.ok(inWoods.tally.some((l) => l.side === 'defence' && l.label === 'cover (woods)' && l.value === 1));
  assert.equal(inWoods.hits, 4);
});

test('combat: an ordered target is attacked; otherwise the weakest adjacent enemy', () => {
  const s = openState();
  s.units = [unit('a', 'p0', 'heavy', '5,5'), unit('weak', 'p1', 'scout', '6,5'), unit('strong', 'p1', 'infantry', '4,5')];
  const target = (orders: PlayerOrders) => play(s, 0, orders).events.find((e): e is AttackEvent => e.type === 'attack')!.target;
  assert.equal(target({}), 'weak');
  assert.equal(target({ a: { path: [], target: 'strong' } }), 'strong');
  assert.equal(target({ a: { path: [], target: 'nobody' } }), 'weak', 'invalid targets are dropped by validation');
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

// ---------------------------------------------------------------- setup and turn 0

const setup = (players = 2, era = 'napoleonic', size = 'small', points = 100) =>
  createSetupState(era, size, points, Array.from({ length: players }, (_, i) => ({ id: `p${i}`, side: i })), 5);

test('setup: each era has its own terrain and armies, and unit types are unique across the era', () => {
  for (const era of Object.values(ERAS)) {
    assert.ok(era.armies.length >= 2);
    const all = era.armies.flatMap((a) => Object.keys(a.units));
    assert.equal(new Set(all).size, all.length, 'unit ids are unique within the era');
    assert.ok(Object.values(eraDatasheets(era)).every((u) => u.points > 0 && u.climb >= 1));
  }
  const nap = setup(2, 'napoleonic', 'medium');
  assert.ok(nap.map.terrain.includes('village') && !nap.map.terrain.includes('ruins'));
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
  s = resolveDeployment(s, { army: 'us', units: [{ type: 'us.recon', hex: '6,0' }] }).state;
  assert.equal(s.phase, 'battle');
  assert.equal(s.turn, 1);
  assert.equal(s.current, 0);
  assert.equal(s.units.length, 4);
});
