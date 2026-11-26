import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbors, distance, line, label, facingToward, arcOf, FACING_NAMES } from '../src/shared/hex.js';
import { createInitialState } from '../src/shared/scenario.js';
import { resolveTurn, validateOrders, playerView, visibleHexes } from '../src/shared/engine.js';
import type { AttackEvent, GameState, HexKey, MoveEvent } from '../src/shared/types.js';

function openState(players = 2): GameState {
  const s = createInitialState('crossroads', Array.from({ length: players }, (_, i) => ({ id: `p${i}`, side: i })), 42);
  s.map.terrain.fill('open'); // flat, open map for predictable tests
  return s;
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

test('units with no orders hold, ordered units move, turn advances', () => {
  const s = openState();
  const u = s.units.find((x) => x.owner === 'p0' && x.type === 'infantry')!;
  const { state, logs } = resolveTurn(s, { p0: { [u.id]: { path: ['2,4', '3,4'] } } }, 1);
  assert.equal(state.units.find((x) => x.id === u.id)!.hex, '3,4');
  assert.equal(state.turn, 2);
  assert.ok(logs.p0.some((e) => e.type === 'move' && e.unit === u.id));
  assert.equal(s.units.find((x) => x.id === u.id)!.hex, u.hex, 'input state is not mutated');
});

test('enemies entering the same hex clash and stop', () => {
  const s = openState();
  s.units = [
    { id: 'a', owner: 'p0', type: 'infantry', name: 'A', hex: '5,5', facing: 0, strength: 4 },
    { id: 'b', owner: 'p1', type: 'infantry', name: 'B', hex: '7,5', facing: 0, strength: 4 },
  ];
  const { state, events } = resolveTurn(s, { p0: { a: { path: ['6,5', '7,5'] } }, p1: { b: { path: ['6,5', '5,5'] } } }, 3);
  assert.ok(events.some((e) => e.type === 'clash' && e.hex === '6,5'));
  assert.equal(state.units.find((u) => u.id === 'a')!.hex, '5,5');
  assert.equal(state.units.find((u) => u.id === 'b')!.hex, '7,5');
});

test('a friendly column can follow its leader', () => {
  const s = openState();
  s.units = [
    { id: 'a', owner: 'p0', type: 'infantry', name: 'A', hex: '3,5', facing: 0, strength: 4 },
    { id: 'b', owner: 'p0', type: 'infantry', name: 'B', hex: '2,5', facing: 0, strength: 4 },
    { id: 'z', owner: 'p1', type: 'infantry', name: 'Z', hex: '15,11', facing: 0, strength: 4 },
  ];
  const { state } = resolveTurn(s, { p0: { a: { path: ['4,5', '5,5'] }, b: { path: ['3,5', '4,5'] } } }, 3);
  assert.equal(state.units.find((u) => u.id === 'a')!.hex, '5,5');
  assert.equal(state.units.find((u) => u.id === 'b')!.hex, '4,5');
});

test('movement halts on contact with a new enemy', () => {
  const s = openState();
  s.units = [
    { id: 'a', owner: 'p0', type: 'scout', name: 'A', hex: '2,5', facing: 0, strength: 2 },
    { id: 'b', owner: 'p1', type: 'heavy', name: 'B', hex: '6,5', facing: 0, strength: 6 },
  ];
  const { state } = resolveTurn(s, { p0: { a: { path: ['3,5', '4,5', '5,5', '5,4'] } } }, 3);
  assert.equal(state.units.find((u) => u.id === 'a')!.hex, '5,5');
});

test('players only see enemies within sight and line of sight', () => {
  const s = openState();
  s.units = [
    { id: 'a', owner: 'p0', type: 'infantry', name: 'A', hex: '2,5', facing: 0, strength: 4 },
    { id: 'near', owner: 'p1', type: 'infantry', name: 'N', hex: '5,5', facing: 0, strength: 4 },
    { id: 'far', owner: 'p1', type: 'infantry', name: 'F', hex: '14,5', facing: 0, strength: 4 },
    { id: 'hidden', owner: 'p1', type: 'infantry', name: 'H', hex: '2,9', facing: 0, strength: 4 },
  ];
  s.map.terrain[7 * 16 + 2] = 'woods'; // between a and hidden
  s.map.terrain[7 * 16 + 1] = 'woods';
  s.map.terrain[7 * 16 + 3] = 'woods';
  const v = playerView(s, 'p0');
  const ids = v.units.map((u) => u.id);
  assert.ok(ids.includes('near'));
  assert.ok(!ids.includes('far'));
  assert.ok(!ids.includes('hidden'));
  assert.ok(!JSON.stringify(v).includes('"14,5"'), 'hidden unit positions never leave the server');
  assert.ok(visibleHexes(s, 'p0').has('2,5'));
  const own = v.units.find((u) => u.id === 'a')!;
  assert.equal(own.own && own.name, 'A', 'unit name is not replaced by the datasheet name');
});

test('enemy moves out of sight are not reported; last-seen markers persist', () => {
  const s = openState();
  s.units = [
    { id: 'a', owner: 'p0', type: 'infantry', name: 'A', hex: '1,5', facing: 0, strength: 4 },
    { id: 'b', owner: 'p1', type: 'scout', name: 'B', hex: '6,5', facing: 0, strength: 2 },
  ];
  s.lastSeen.p0.b = { hex: '6,5', facing: 0, turn: 0, owner: 'p1', type: 'scout' };
  const { state, logs } = resolveTurn(s, { p1: { b: { path: ['7,5', '8,5', '9,5', '10,5', '11,5', '12,5'] } } }, 5);
  const mv = logs.p0.find((e): e is MoveEvent => e.type === 'move')!;
  assert.ok(mv.partial);
  assert.ok(!mv.path.includes('12,5'));
  assert.equal(state.lastSeen.p0.b.hex, '6,5');
  assert.ok(playerView(state, 'p0').ghosts.some((g) => g.id === 'b'));
});

test('resolution is deterministic for a given seed', () => {
  const s = openState(4);
  const orders = { p0: { u1: { path: ['2,4', '3,4'] } } };
  assert.deepEqual(resolveTurn(s, orders, 99), resolveTurn(s, orders, 99));
});

test('game ends at the turn limit', () => {
  const s = openState();
  s.turn = s.turnLimit;
  const { state, events } = resolveTurn(s, {}, 1);
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
  // facingToward an adjacent hex gives the index of that neighbour.
  neighbors('5,5').forEach((n, i) => assert.equal(facingToward('5,5', n), i, `toward neighbour ${i}`));
  // Facing east (0): the three hexsides in front are front, the next two flank, the opposite one rear.
  const arcs = neighbors('5,5').map((n) => arcOf('5,5', 0, n));
  assert.deepEqual(arcs, ['front', 'front', 'flank', 'rear', 'flank', 'front']);
  assert.equal(FACING_NAMES[facingToward('0,5', '9,5')], 'E');
});

test('facing: moving units face their last step unless ordered otherwise', () => {
  const s = openState();
  s.units = [
    { id: 'a', owner: 'p0', type: 'infantry', name: 'A', hex: '3,5', facing: 3, strength: 4 },
    { id: 'b', owner: 'p0', type: 'infantry', name: 'B', hex: '3,8', facing: 0, strength: 4 },
    { id: 'c', owner: 'p0', type: 'infantry', name: 'C', hex: '3,2', facing: 0, strength: 4 },
    { id: 'z', owner: 'p1', type: 'infantry', name: 'Z', hex: '15,11', facing: 3, strength: 4 },
  ];
  const { state, events } = resolveTurn(s, { p0: {
    a: { path: ['4,5', '5,5'] },          // moves east, no facing given
    b: { path: ['4,8'], facing: 2 },      // moves east, then turns NW
    c: { path: [], facing: 4 },           // turns SW without moving
  } }, 1);
  const f = (id: string) => state.units.find((u) => u.id === id)!.facing;
  assert.equal(f('a'), 0);
  assert.equal(f('b'), 2);
  assert.equal(f('c'), 4);
  assert.equal(f('z'), 3, 'units without orders keep their facing');
  assert.ok(events.some((e) => e.type === 'turn' && e.unit === 'c'));
  assert.equal(validateOrders(s, 'p0', { a: { path: [], facing: 6 } }).ok, false);
  assert.equal(validateOrders(s, 'p0', { a: { path: [], facing: 1 } }).ok, true);
});

test('facing: attacks report which arc they hit', () => {
  const s = openState();
  s.units = [
    { id: 'a', owner: 'p0', type: 'heavy', name: 'A', hex: '5,5', facing: 0, strength: 6 },
    { id: 'b', owner: 'p1', type: 'scout', name: 'B', hex: '6,5', facing: 0, strength: 2 }, // A is directly behind B
  ];
  const { events } = resolveTurn(s, {}, 3);
  const onB = events.find((e): e is AttackEvent => e.type === 'attack' && e.target === 'b')!;
  const onA = events.find((e): e is AttackEvent => e.type === 'attack' && e.target === 'a')!;
  assert.equal(onB.arc, 'rear');
  assert.equal(onA.arc, 'front');
});

test('scenario units start facing the centre of the map', () => {
  const s = createInitialState('crossroads', [{ id: 'p0', side: 0 }, { id: 'p1', side: 1 }], 1);
  assert.ok(s.units.filter((u) => u.owner === 'p0').every((u) => ['E', 'NE', 'SE'].includes(FACING_NAMES[u.facing])));
  assert.ok(s.units.filter((u) => u.owner === 'p1').every((u) => ['W', 'NW', 'SW'].includes(FACING_NAMES[u.facing])));
});
