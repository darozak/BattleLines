import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbors, distance, line, label, facingToward, arcOf, FACING_NAMES } from '../src/shared/hex.js';
import { createInitialState } from '../src/shared/scenario.js';
import { resolvePlayerTurn, validateOrders, boardView, canSee, combatTally, previewTurn, attackOptions, BASE_DEFENCE } from '../src/shared/engine.js';
import type { AttackEvent, GameState, HexKey, PlayerOrders, Unit } from '../src/shared/types.js';

function openState(players = 2): GameState {
  const s = createInitialState('crossroads', Array.from({ length: players }, (_, i) => ({ id: `p${i}`, side: i })), 42);
  s.map.terrain.fill('open'); // flat, open map for predictable tests
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

test('large scenario: every unit starts on its own passable hex inside the map', () => {
  for (const players of [2, 3, 4]) {
    const s = createInitialState('valley', Array.from({ length: players }, (_, i) => ({ id: `p${i}`, side: i })), 7);
    assert.equal(s.map.cols * s.map.rows, s.map.terrain.length);
    assert.equal(s.units.length, players * 12);
    const hexes = new Set(s.units.map((u) => u.hex));
    assert.equal(hexes.size, s.units.length, 'no two units share a hex');
    for (const u of s.units) {
      const [c, r] = u.hex.split(',').map(Number);
      assert.ok(c >= 0 && r >= 0 && c < s.map.cols && r < s.map.rows, `${u.hex} in bounds`);
      assert.notEqual(s.map.terrain[r * s.map.cols + c], 'water');
    }
    assert.equal(s.objectives.length, 5);
  }
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

test('scenario units start facing the centre of the map', () => {
  const s = createInitialState('crossroads', [{ id: 'p0', side: 0 }, { id: 'p1', side: 1 }], 1);
  assert.ok(s.units.filter((u) => u.owner === 'p0').every((u) => ['E', 'NE', 'SE'].includes(FACING_NAMES[u.facing])));
  assert.ok(s.units.filter((u) => u.owner === 'p1').every((u) => ['W', 'NW', 'SW'].includes(FACING_NAMES[u.facing])));
});
