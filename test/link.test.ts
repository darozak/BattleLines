import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, endTurn, readGame, encodeGame, verifyReplay, packState, turnsSince, type Game,
} from '../src/shared/game.js';
import { encodeFragment, fromB64u, toB64u, LinkError } from '../src/shared/link.js';
import { linkLabel } from '../src/shared/game.js';
import { neighbors } from '../src/shared/hex.js';
import { terrainAt } from '../src/shared/terrain.js';
import type { GameState, PlayerOrders } from '../src/shared/types.js';

const NAMES = ['Alice', 'Bob', 'Cara', 'Dev'];
const newGame = (players: number, scenario = 'crossroads') =>
  createGame({ gameName: 'Test', scenario, players: NAMES.slice(0, players) });

/** Move every unit of the current player one step, where possible. */
function someOrders(state: GameState): PlayerOrders {
  const me = state.players[state.current].id;
  const taken = new Set(state.units.filter((u) => u.strength > 0).map((u) => u.hex));
  const orders: PlayerOrders = {};
  for (const u of state.units.filter((x) => x.owner === me && x.strength > 0)) {
    const step = neighbors(u.hex, state.map.cols, state.map.rows)
      .find((h) => !taken.has(h) && !terrainAt(state.map, h).impassable && terrainAt(state.map, h).cost <= 3);
    if (step) { orders[u.id] = { path: [step] }; taken.add(step); }
  }
  return orders;
}

/** Send a game through a link and read it back, as the next player would. */
const viaLink = async (g: Game) => readGame(`https://darozak.github.io/BattleLines/#${await encodeGame(g.link)}`);

test('base64url round trip', () => {
  const bytes = new Uint8Array(300).map((_, i) => (i * 37) % 256);
  assert.deepEqual(fromB64u(toB64u(bytes)), bytes);
});

test('create: players in order, player 1 moves first, the link round-trips', async () => {
  const g = newGame(3);
  assert.deepEqual(g.link.players, ['Alice', 'Bob', 'Cara']);
  assert.equal(g.state.current, 0);
  const back = await viaLink(g);
  assert.deepEqual(packState(back.state), packState(g.state));
  assert.deepEqual(back.state.map, g.state.map, 'the map is rebuilt from the scenario and seed');
  assert.throws(() => createGame({ gameName: 'x', scenario: 'crossroads', players: ['Solo'] }), /2–4 players/);
  assert.equal(createGame({ gameName: '', scenario: 'crossroads', players: ['', 'B'] }).link.players[0], 'Player 1');
});

test('damaged links give a clear error', async () => {
  const hash = await encodeGame(newGame(2).link);
  await assert.rejects(readGame(hash.slice(0, hash.indexOf('/') + 30)), /damaged or incomplete/);
  await assert.rejects(readGame('#not*base64'), /unexpected characters/);
  await assert.rejects(readGame(await encodeFragment({ v: 1 })), /different version/);
  await assert.rejects(readGame(await encodeFragment({ ...newGame(2).link, scenario: 'nowhere' })), LinkError);
});

test('every link starts with a readable label: round and whose turn', async () => {
  let g = newGame(2);
  assert.match(await encodeGame(g.link), /^Round1-Alice\//);
  g = await viaLink(endTurn(g, {}));
  assert.match(await encodeGame(g.link), /^Round1-Bob\//);
  g = await viaLink(endTurn(g, {}));
  assert.match(await encodeGame(g.link), /^Round2-Alice\//);
  // Names are reduced to plain letters and digits; an empty result falls back to the player number.
  assert.equal(linkLabel(createGame({ gameName: 'x', scenario: 'crossroads', players: ['Zoë O\'Neil', '***'] }).link), 'Round1-ZoeONeil');
  const odd = createGame({ gameName: 'x', scenario: 'crossroads', players: ['A', '***'] });
  assert.equal(linkLabel(endTurn(odd, {}).link), 'Round1-Player2');
  while (!g.state.finished) g = await viaLink(endTurn(g, {}));
  assert.match(await encodeGame(g.link), /^Final\//);
  // The label is ignored when reading: links without one, or with an edited one, still open the same game.
  const data = (await encodeGame(g.link)).split('/')[1];
  assert.deepEqual((await readGame(`#${data}`)).link, g.link);
  assert.deepEqual((await readGame(`#Round1-Mallory/${data}`)).link, g.link);
});

test('turns pass between players; reports show what happened since your last turn', async () => {
  let g = newGame(3);
  for (let i = 0; i < 3; i++) g = await viaLink(endTurn(g, someOrders(g.state)));
  assert.equal(g.state.turn, 2);
  assert.equal(g.state.current, 0);
  const since = turnsSince(g.link, 0);
  assert.deepEqual(since.map((r) => r.p), [1, 2], "Alice sees Bob's and Cara's turns");
  assert.ok(since.every((r) => r.e.some((e) => e.type === 'move')));
});

test('each player can check the others\' moves by replay; altered links are caught', async () => {
  let g = newGame(3);
  const remembered: Record<number, ReturnType<typeof packState>> = {};
  for (let i = 0; i < 9; i++) {
    const me = g.state.current;
    assert.equal(verifyReplay(g.link, remembered[me] ?? null), i < 3 ? 'unknown' : 'verified', `turn ${i}`);
    const ended = endTurn(g, someOrders(g.state));
    remembered[me] = packState(ended.state);
    g = await viaLink(ended);
  }
  const tampered = structuredClone(g.link);
  tampered.s.u[0][2] = 1; // knock a unit's strength down
  assert.equal(verifyReplay(tampered, remembered[g.state.current]), 'mismatch');
});

test('same link + same orders = same result (there are no dice)', async () => {
  const g = newGame(2);
  const a = await viaLink(g);
  const b = await viaLink(g);
  const orders = someOrders(a.state);
  assert.deepEqual(endTurn(a, orders).link, endTurn(b, orders).link);
});

test('the game ends at the turn limit', async () => {
  let g = newGame(2);
  for (let i = 0; i < 40 && !g.state.finished; i++) g = await viaLink(endTurn(g, {}));
  assert.ok(g.state.finished);
  assert.ok(g.state.result);
  assert.throws(() => endTurn(g, {}), /over/);
});

test('link sizes stay short', async () => {
  const rows: string[] = [];
  for (const [scenario, players] of [['crossroads', 2], ['crossroads', 4], ['valley', 2], ['valley', 4]] as const) {
    let g = newGame(players, scenario);
    for (let i = 0; i < players * 3; i++) g = await viaLink(endTurn(g, someOrders(g.state)));
    const url = `https://darozak.github.io/BattleLines/#${await encodeGame(g.link)}`;
    rows.push(`${scenario} ${players}p after 3 rounds: ${url.length} chars`);
    assert.ok(url.length < 4000, `${scenario} ${players}p link is ${url.length} chars`);
  }
  console.log(rows.join('\n'));
});
