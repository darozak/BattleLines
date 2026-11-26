import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, joinGame, openTurn, endTurn, openFinal, readLink, verifyReplay, packState, linkHash, type Link,
} from '../src/shared/game.js';
import { decodeHeader, encodeHeader, fromB64u, toB64u, WrongPinError, LinkError } from '../src/shared/link.js';
import { neighbors } from '../src/shared/hex.js';
import { terrainAt } from '../src/shared/terrain.js';
import type { GameState, PlayerOrders } from '../src/shared/types.js';

const FAST = 1000; // PBKDF2 iterations for tests (the real default is much higher)

async function startGame(players: number, scenario = 'crossroads') {
  const pins = ['1111', '2222', '3333', '4444'].slice(0, players);
  let link = await createGame({ gameName: 'Test', scenario, players, name: 'Alice', pin: pins[0], iterations: FAST });
  for (let i = 1; i < players; i++) link = await joinGame(link, ['Alice', 'Bob', 'Cara', 'Dev'][i], pins[i]);
  return { link, pins };
}

/** Move every unit of the current player one step towards the centre, where possible. */
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

const viaUrl = async (l: Link) => (await readLink(`https://example.github.io/BattleLines/#${linkHash(l)}`))!;

test('base64url round trip', () => {
  const bytes = new Uint8Array(300).map((_, i) => (i * 37) % 256);
  assert.deepEqual(fromB64u(toB64u(bytes)), bytes);
});

test('create and join: keys are added, the game starts when everyone has joined', async () => {
  const one = await createGame({ gameName: 'G', scenario: 'crossroads', players: 3, name: 'Alice', pin: '1111', iterations: FAST });
  assert.equal(one.header.phase, 'join');
  assert.equal(one.payload, null);
  const two = await joinGame(await viaUrl(one), 'Bob', '2222');
  assert.equal(two.header.phase, 'join');
  const three = await joinGame(await viaUrl(two), 'Cara', '3333');
  assert.equal(three.header.phase, 'play');
  assert.equal(three.header.cur, 0, 'player 1 moves first');
  assert.ok(three.payload);
  await assert.rejects(joinGame(three, 'Dev', '4444'), /not taking new players/);
  await assert.rejects(createGame({ gameName: 'G', scenario: 'crossroads', players: 2, name: 'A', pin: '12', iterations: FAST }), /at least 4/);
});

test('only the current player can open the turn, and only with their PIN', async () => {
  const { link } = await startGame(2);
  await assert.rejects(openTurn(link, '2222'), WrongPinError, "Bob's PIN does not open Alice's turn");
  await assert.rejects(openTurn(link, '0000'), WrongPinError);
  const t = await openTurn(await viaUrl(link), '1111');
  assert.equal(t.me, 0);
  assert.equal(t.state.units.length, 8);
});

test('the link cannot be altered', async () => {
  const { link } = await startGame(2);
  // Change who it is addressed to / the turn in the header: the seal no longer matches.
  const forged = { ...link.header, turn: 5 };
  const forgedText = await encodeHeader(forged);
  await assert.rejects(openTurn({ header: forged, headerText: forgedText, payload: link.payload }, '1111'), LinkError);
  // Flip a byte in the sealed state.
  const bytes = fromB64u(link.payload!);
  bytes[bytes.length - 5] ^= 1;
  await assert.rejects(openTurn({ ...link, payload: toB64u(bytes) }, '1111'), /could not be opened/);
  // Truncated link.
  await assert.rejects(readLink(`#${link.headerText.slice(0, 20)}`), /damaged/);
});

test('turns pass between players, and each player can verify the others by replay', async () => {
  const { link: start, pins } = await startGame(3);
  let link = start;
  const remembered: Record<number, ReturnType<typeof packState>> = {};
  for (let i = 0; i < 9; i++) {
    const t = await openTurn(await viaUrl(link), pins[link.header.cur]);
    const check = verifyReplay(link.header, remembered[t.me] ?? null, t.payload.s, t.payload.log);
    assert.equal(check, i < 3 ? 'unknown' : 'verified', `turn ${i}: replay check`);
    const ended = await endTurn(t, someOrders(t.state));
    remembered[t.me] = packState(ended.state);
    link = ended.link;
  }
  assert.equal(link.header.turn, 4, 'three full rounds played');

  // A player who alters the state is caught by the replay check.
  const t = await openTurn(link, pins[link.header.cur]);
  const tampered = structuredClone(t.payload.s);
  tampered.u[0][2] = 1; // knock a unit's strength down
  assert.equal(verifyReplay(link.header, remembered[t.me], tampered, t.payload.log), 'mismatch');
});

test('same link + same orders = same result (dice come from the embedded seed)', async () => {
  const { link } = await startGame(2);
  const a = await openTurn(link, '1111');
  const b = await openTurn(link, '1111');
  const orders = someOrders(a.state);
  assert.deepEqual(packState((await endTurn(a, orders)).state), packState((await endTurn(b, orders)).state));
});

test('the game ends and the final link is open to everyone', async () => {
  const { link: start, pins } = await startGame(2);
  let link = start;
  // Fast-forward: play until the turn limit with no orders.
  for (let i = 0; i < 40 && link.header.phase === 'play'; i++) {
    link = (await endTurn(await openTurn(link, pins[link.header.cur]), {})).link;
  }
  assert.equal(link.header.phase, 'over');
  const { state } = await openFinal(await viaUrl(link));
  assert.ok(state.finished);
  assert.ok(state.result);
});

test('link sizes stay reasonable', async () => {
  const rows: string[] = [];
  for (const [scenario, players] of [['crossroads', 2], ['crossroads', 4], ['valley', 2], ['valley', 4]] as const) {
    const { link: start, pins } = await startGame(players, scenario);
    let link = start;
    for (let i = 0; i < players * 3; i++) {
      const t = await openTurn(link, pins[link.header.cur]);
      link = (await endTurn(t, someOrders(t.state))).link;
    }
    const url = `https://darozak.github.io/BattleLines/#${linkHash(link)}`;
    rows.push(`${scenario} ${players}p after 3 rounds: ${url.length} chars (header ${link.headerText.length}, state ${link.payload!.length})`);
    assert.ok(url.length < 8000, `${scenario} ${players}p link is ${url.length} chars`);
  }
  console.log(rows.join('\n'));
  const h = await decodeHeader((await startGame(2)).link.headerText);
  assert.equal(h.players.length, 2);
});
