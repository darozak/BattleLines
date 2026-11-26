// Game lifecycle without a server: create → join (each player picks a PIN) → take turns → game over.
// Every step produces a new link (see link.ts) that the player sends on to the next player.
import { createInitialState, SCENARIOS } from './scenario.js';
import { initialSpotting, resolvePlayerTurn } from './engine.js';
import {
  createPlayerSlot, decodeHeader, encodeHeader, LinkError, LINK_VERSION, openPayload, readOpenPayload,
  seal, sha256, splitLink, toB64u, unlockPlayer, unseal, DEFAULT_PBKDF2_ITERATIONS, type Header,
} from './link.js';
import type { Facing, GameEvent, GameResult, GameState, HexKey, PlayerOrders, Report } from './types.js';

export const playerId = (index: number) => `p${index}`;
export const playerIndex = (id: string) => Number(id.slice(1));
export const MIN_PIN_LENGTH = 4;

// ---------------------------------------------------------------- compact state

/** The parts of the game state that change. Everything else is rebuilt from the scenario and seed. */
export interface PackedState {
  t: number;
  c: number;
  /** Per unit, in scenario order: [hex index, facing, strength]. */
  u: [number, number, number][];
  s: number[];
  /** Per player: last-seen enemy units [unit index, hex index, facing, turn]. */
  l: [number, number, number, number][][];
  /** Per player: reports since their last turn. */
  r: Report[][];
  f: 0 | 1;
  w: GameResult | null;
}

/** One player-turn, kept so the next players can check it by replaying it. */
export interface LoggedTurn { t: number; p: number; o: PlayerOrders }

export interface Payload {
  s: PackedState;
  /** The most recent player-turns (enough to cover everyone's turn since the reader last moved). */
  log: LoggedTurn[];
}

const hexIndex = (state: GameState, hex: HexKey) => { const [c, r] = hex.split(',').map(Number); return r * state.map.cols + c; };
const hexKey = (state: GameState, i: number) => `${i % state.map.cols},${Math.floor(i / state.map.cols)}`;
const unitIndex = (id: string) => Number(id.slice(1)) - 1;

export function packState(state: GameState): PackedState {
  return {
    t: state.turn,
    c: state.current,
    u: state.units.map((u) => [hexIndex(state, u.hex), u.facing, u.strength]),
    s: state.players.map((p) => state.scores[p.id]),
    l: state.players.map((p) => Object.entries(state.lastSeen[p.id])
      .map(([id, g]) => [unitIndex(id), hexIndex(state, g.hex), g.facing, g.turn] as [number, number, number, number])
      .sort((a, b) => a[0] - b[0])),
    r: state.players.map((p) => state.reports[p.id]),
    f: state.finished ? 1 : 0,
    w: state.result,
  };
}

export function unpackState(h: Header, packed: PackedState): GameState {
  const state = createInitialState(h.scenario, h.players.map((_, i) => ({ id: playerId(i), side: i })), h.seed);
  state.turn = packed.t;
  state.current = packed.c;
  if (packed.u.length !== state.units.length) throw new LinkError('The link does not match its scenario.');
  state.units.forEach((u, i) => {
    const [hex, facing, strength] = packed.u[i];
    u.hex = hexKey(state, hex);
    u.facing = facing as Facing;
    u.strength = strength;
  });
  state.players.forEach((p, i) => {
    state.scores[p.id] = packed.s[i];
    state.lastSeen[p.id] = Object.fromEntries(packed.l[i].map(([ui, hex, facing, turn]) => {
      const u = state.units[ui];
      return [u.id, { hex: hexKey(state, hex), facing: facing as Facing, turn, owner: u.owner, type: u.type }];
    }));
    state.reports[p.id] = packed.r[i];
  });
  state.finished = packed.f === 1;
  state.result = packed.w;
  return state;
}

export const stateFingerprint = (state: GameState) => sha256(JSON.stringify(packState(state)));

// ---------------------------------------------------------------- links

export interface Link { header: Header; headerText: string; payload: string | null }

export const linkHash = (l: { headerText: string; payload: string | null }) => `${l.headerText}${l.payload ? `.${l.payload}` : ''}`;

export async function readLink(hashOrUrl: string): Promise<Link | null> {
  const parts = splitLink(hashOrUrl);
  if (!parts) return null;
  return { header: await decodeHeader(parts.header), headerText: parts.header, payload: parts.payload };
}

function validatePin(pin: string) {
  if (pin.length < MIN_PIN_LENGTH) throw new LinkError(`Choose a PIN of at least ${MIN_PIN_LENGTH} characters.`);
}

export interface NewGame {
  gameName: string;
  scenario: string;
  players: number;
  name: string;
  pin: string;
  /** For tests: fewer PBKDF2 iterations. */
  iterations?: number;
}

export async function createGame(g: NewGame): Promise<Link> {
  const sc = SCENARIOS[g.scenario];
  if (!sc) throw new LinkError('Unknown scenario.');
  if (!(g.players >= sc.minPlayers && g.players <= sc.maxPlayers)) throw new LinkError(`This scenario is for ${sc.minPlayers}–${sc.maxPlayers} players.`);
  validatePin(g.pin);
  const it = g.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const header: Header = {
    v: LINK_VERSION,
    id: toB64u(globalThis.crypto.getRandomValues(new Uint8Array(9))),
    name: g.gameName.trim() || 'Untitled battle',
    scenario: g.scenario,
    seed: globalThis.crypto.getRandomValues(new Uint32Array(1))[0],
    n: g.players,
    players: [await createPlayerSlot(g.name.trim() || 'Player 1', g.pin, it)],
    phase: 'join',
    turn: 0,
    cur: 0,
    it,
  };
  return { header, headerText: await encodeHeader(header), payload: null };
}

/** Add a player. When the last player joins, the game starts and the link goes to player 1. */
export async function joinGame(link: Link, name: string, pin: string): Promise<Link> {
  const h = link.header;
  if (h.phase !== 'join' || h.players.length >= h.n) throw new LinkError('This game is not taking new players.');
  validatePin(pin);
  const joined = { ...h, players: [...h.players, await createPlayerSlot(name.trim() || `Player ${h.players.length + 1}`, pin, h.it)] };
  if (joined.players.length < h.n) return { header: joined, headerText: await encodeHeader(joined), payload: null };

  const state = initialSpotting(createInitialState(h.scenario, joined.players.map((_, i) => ({ id: playerId(i), side: i })), h.seed));
  const started: Header = { ...joined, phase: 'play', turn: state.turn, cur: state.current };
  const headerText = await encodeHeader(started);
  const payload: Payload = { s: packState(state), log: [] };
  return { header: started, headerText, payload: await seal(payload, started.players[started.cur], headerText) };
}

export interface OpenTurn {
  link: Link;
  state: GameState;
  me: number;
  payload: Payload;
  /** The private key stays in memory only for this turn. */
  key: CryptoKey;
}

/** The current player opens their turn with their PIN. */
export async function openTurn(link: Link, pin: string): Promise<OpenTurn> {
  const h = link.header;
  if (h.phase !== 'play' || !link.payload) throw new LinkError('There is no turn to play in this link.');
  const key = await unlockPlayer(h.players[h.cur], pin, h.it);
  const payload = await unseal<Payload>(link.payload, key, link.headerText);
  const state = unpackState(h, payload.s);
  if (state.turn !== h.turn || state.current !== h.cur) throw new LinkError('The link is inconsistent.');
  return { link, state, me: h.cur, payload, key };
}

/** Once the game is over, the final state is open to everyone. */
export async function openFinal(link: Link): Promise<{ state: GameState; payload: Payload }> {
  if (link.header.phase !== 'over' || !link.payload) throw new LinkError('This game is not over yet.');
  const payload = await readOpenPayload<Payload>(link.payload);
  return { state: unpackState(link.header, payload.s), payload };
}

export interface EndedTurn {
  link: Link;
  state: GameState;
  /** What the player who just moved saw happen. */
  events: GameEvent[];
}

/** Resolve the current player's orders and seal the result for the next player. */
export async function endTurn(turn: OpenTurn, orders: PlayerOrders): Promise<EndedTurn> {
  const before = turn.state;
  const { state, logs } = resolvePlayerTurn(before, orders);
  const h = turn.link.header;
  const header: Header = { ...h, phase: state.finished ? 'over' : 'play', turn: state.turn, cur: state.current };
  const headerText = await encodeHeader(header);
  const log = [...turn.payload.log, { t: before.turn, p: before.current, o: orders }].slice(-Math.max(1, h.n - 1));
  const payload: Payload = { s: packState(state), log };
  const sealed = state.finished
    ? await openPayload(payload)
    : await seal(payload, header.players[header.cur], headerText);
  return { link: { header, headerText, payload: sealed }, state, events: logs[playerId(before.current)] };
}

export type Verification = 'verified' | 'mismatch' | 'unknown';

/**
 * Check the other players' moves since my last turn by replaying their logged orders on the
 * state I sent (remembered by my browser). Same seed + same orders must give the same state.
 */
export function verifyReplay(h: Header, mine: PackedState | null, received: PackedState, log: LoggedTurn[]): Verification {
  if (!mine) return 'unknown';
  let state = unpackState(h, mine);
  for (const entry of log) {
    if (entry.t !== state.turn || entry.p !== state.current) continue; // from before my last turn
    if (state.finished) break;
    state = resolvePlayerTurn(state, entry.o).state;
  }
  return JSON.stringify(packState(state)) === JSON.stringify(received) ? 'verified' : 'mismatch';
}
