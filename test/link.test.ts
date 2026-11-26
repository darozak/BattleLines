import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, endTurn, deploy, readGame, encodeGame, verifyReplay, packState, turnsSince, linkLabel, type Game,
} from '../src/shared/game.js';
import { ERAS, zoneOf } from '../src/shared/setup.js';
import { encodeFragment, fromB64u, toB64u, LinkError } from '../src/shared/link.js';
import { neighbors } from '../src/shared/hex.js';
import { terrainAt, elevationAt } from '../src/shared/terrain.js';
import type { GameState, PlayerOrders } from '../src/shared/types.js';

const NAMES = ['Alice', 'Bob', 'Cara', 'Dev'];
const newGame = (players: number, era = 'ww2', size = 'small', points = 150) =>
  createGame({ gameName: 'Test', era, size, points, players: NAMES.slice(0, players) });

/** The current player's deployment: the first army, cheapest units first, until the points run out. */
function autoDeploy(state: GameState) {
  const me = state.players[state.current].id;
  const army = ERAS[state.era].armies[state.current % 2];
  const types = Object.entries(army.units).sort((a, b) => a[1].points - b[1].points);
  const taken = new Set(state.units.map((u) => u.hex));
  const free = zoneOf(state, me).filter((h) => !taken.has(h) && !terrainAt(state.map, h).impassable);
  const units: { type: string; hex: string }[] = [];
  let spent = 0;
  for (const hex of free) {
    const [type, ds] = types[units.length % types.length];
    if (spent + ds.points > state.pointLimit) break;
    units.push({ type, hex });
    spent += ds.points;
  }
  return { army: army.id, units };
}

/** Send a game through a link and read it back, as the next player would. */
const viaLink = async (g: Game) => readGame(`https://darozak.github.io/BattleLines/#${await encodeGame(g.link)}`);

/** Set up a game and play turn 0 for everyone. */
async function deployedGame(players: number, era = 'ww2', size = 'small', points = 150) {
  let g = newGame(players, era, size, points);
  while (g.state.phase === 'deploy') g = await viaLink(deploy(g, autoDeploy(g.state)));
  return g;
}

/** Move every unit of the current player one step, where possible. */
function someOrders(state: GameState): PlayerOrders {
  const me = state.players[state.current].id;
  const taken = new Set(state.units.filter((u) => u.strength > 0).map((u) => u.hex));
  const orders: PlayerOrders = {};
  for (const u of state.units.filter((x) => x.owner === me && x.strength > 0)) {
    const step = neighbors(u.hex, state.map.cols, state.map.rows)
      .find((h) => !taken.has(h) && !terrainAt(state.map, h).impassable && terrainAt(state.map, h).cost <= state.datasheets[u.type].move
        && Math.abs(elevationAt(state.map, h) - elevationAt(state.map, u.hex)) <= state.datasheets[u.type].climb);
    if (step) { orders[u.id] = { path: [step] }; taken.add(step); }
  }
  return orders;
}

test('base64url round trip', () => {
  const bytes = new Uint8Array(300).map((_, i) => (i * 37) % 256);
  assert.deepEqual(fromB64u(toB64u(bytes)), bytes);
});

test('create: setup choices are kept, the players are shuffled, turn 0 starts', async () => {
  const g = newGame(4, 'napoleonic', 'medium', 200);
  assert.deepEqual([...g.link.players].sort(), [...NAMES].sort(), 'every player, in some order');
  assert.deepEqual([g.link.era, g.link.size, g.link.points], ['napoleonic', 'medium', 200]);
  assert.equal(g.state.phase, 'deploy');
  assert.equal(g.state.current, 0);
  const back = await viaLink(g);
  assert.deepEqual(packState(back.state), packState(g.state));
  assert.deepEqual(back.state.map, g.state.map, 'the map is rebuilt from the era, size and seed');
  // Over many games, every player sometimes goes first.
  const firsts = new Set(Array.from({ length: 60 }, () => newGame(3).link.players[0]));
  assert.equal(firsts.size, 3);
  assert.throws(() => createGame({ gameName: 'x', era: 'ww2', size: 'small', points: 150, players: ['Solo'] }), /2–4 players/);
  assert.throws(() => createGame({ gameName: 'x', era: 'stone age', size: 'small', points: 150, players: ['A', 'B'] }), /era/);
  assert.throws(() => createGame({ gameName: 'x', era: 'ww2', size: 'small', points: 123, players: ['A', 'B'] }), /point limit/);
});

test('turn 0 travels in the link: each player deploys in turn, then the battle begins', async () => {
  let g = newGame(3, 'napoleonic', 'small', 100);
  for (let i = 0; i < 3; i++) {
    assert.equal(g.state.phase, 'deploy');
    assert.match(linkLabel(g.link), new RegExp(`^Deploy-${g.link.players[i]}$`));
    g = await viaLink(deploy(g, autoDeploy(g.state)));
  }
  assert.equal(g.state.phase, 'battle');
  assert.equal(g.state.turn, 1);
  assert.equal(g.state.current, 0);
  assert.match(linkLabel(g.link), new RegExp(`^Round1-${g.link.players[0]}$`));
  assert.ok(g.state.players.every((p) => g.state.armies[p.id]), 'everyone has an army');
  for (const p of g.state.players) {
    const mine = g.state.units.filter((u) => u.owner === p.id);
    assert.ok(mine.length > 0);
    assert.ok(mine.reduce((n, u) => n + g.state.datasheets[u.type].points, 0) <= 100);
  }
  // Reports: the first player sees the other two deployments.
  assert.deepEqual(turnsSince(g.link, 0).map((r) => r.e[0].type), ['deploy', 'deploy']);
  assert.throws(() => deploy(g, autoDeploy(g.state)), /battle has already begun/);
});

test('damaged links give a clear error', async () => {
  const hash = await encodeGame(newGame(2).link);
  await assert.rejects(readGame(hash.slice(0, hash.indexOf('/') + 30)), /damaged or incomplete/);
  await assert.rejects(readGame('#not*base64'), /unexpected characters/);
  await assert.rejects(readGame(await encodeFragment({ v: 1 })), /different version/);
  await assert.rejects(readGame(await encodeFragment({ ...newGame(2).link, era: 'nowhere' })), LinkError);
});

test('turns pass between players; reports show what happened since your last turn', async () => {
  let g = await deployedGame(3);
  for (let i = 0; i < 3; i++) g = await viaLink(endTurn(g, someOrders(g.state)));
  assert.equal(g.state.turn, 2);
  assert.equal(g.state.current, 0);
  const since = turnsSince(g.link, 0);
  assert.deepEqual(since.map((r) => r.p), [1, 2], "player 1 sees players 2 and 3's turns");
  assert.ok(since.every((r) => r.e.some((e) => e.type === 'move')));
});

test('each player can check the others\' turns by replay, deployment included; altered links are caught', async () => {
  let g = newGame(3);
  const remembered: Record<number, ReturnType<typeof packState>> = {};
  for (let i = 0; i < 9; i++) {
    const me = g.state.current;
    assert.equal(verifyReplay(g.link, remembered[me] ?? null), i < 3 ? 'unknown' : 'verified', `turn ${i}`);
    const ended = g.state.phase === 'deploy' ? deploy(g, autoDeploy(g.state)) : endTurn(g, someOrders(g.state));
    remembered[me] = packState(ended.state);
    g = await viaLink(ended);
  }
  const tampered = structuredClone(g.link);
  tampered.s.u[0][4] = 1; // knock a unit's strength down
  assert.equal(verifyReplay(tampered, remembered[g.state.current]), 'mismatch');
});

test('same link + same orders = same result (there are no dice)', async () => {
  const g = await deployedGame(2);
  const a = await viaLink(g);
  const b = await viaLink(g);
  const orders = someOrders(a.state);
  assert.deepEqual(endTurn(a, orders).link, endTurn(b, orders).link);
});

test('the game ends at the turn limit', async () => {
  let g = await deployedGame(2);
  for (let i = 0; i < 40 && !g.state.finished; i++) g = await viaLink(endTurn(g, {}));
  assert.ok(g.state.finished);
  assert.ok(g.state.result);
  assert.equal(linkLabel(g.link), 'Final');
  assert.throws(() => endTurn(g, {}), /over/);
});

test('link labels: names reduced to letters and digits, ignored when reading', async () => {
  const g = createGame({ gameName: 'x', era: 'ww2', size: 'small', points: 100, players: ['Zoë O\'Neil', '***'] });
  assert.ok(['Deploy-ZoeONeil', 'Deploy-Player1', 'Deploy-Player2'].includes(linkLabel(g.link)));
  const data = (await encodeGame(g.link)).split('/')[1];
  assert.deepEqual((await readGame(`#${data}`)).link, g.link);
  assert.deepEqual((await readGame(`#Round9-Mallory/${data}`)).link, g.link);
});

test('link sizes stay short', async () => {
  const rows: string[] = [];
  for (const [size, players, points] of [['small', 2, 150], ['medium', 4, 200], ['large', 2, 300], ['large', 4, 300]] as const) {
    let g = await deployedGame(players, 'ww2', size, points);
    for (let i = 0; i < players * 3; i++) g = await viaLink(endTurn(g, someOrders(g.state)));
    const units = g.state.units.length;
    const url = `https://darozak.github.io/BattleLines/#${await encodeGame(g.link)}`;
    rows.push(`${size} map, ${players} players, ${points} points (${units} units) after 3 rounds: ${url.length} chars`);
    assert.ok(url.length < 4000, `${size} ${players}p link is ${url.length} chars`);
  }
  console.log(rows.join('\n'));
});
