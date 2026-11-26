// Game lifecycle without a server: create → take turns → game over. Every turn produces a new
// link (see link.ts) that the player sends to the next player. Nothing is hidden: every player
// sees the whole battlefield.
import { createInitialState, SCENARIOS } from './scenario.js';
import { resolvePlayerTurn } from './engine.js';
import { decodeFragment, encodeFragment, LinkError, LINK_VERSION, sha256, toB64u } from './link.js';
import type { Facing, GameEvent, GameResult, GameState, HexKey, PlayerOrders } from './types.js';

export const playerId = (index: number) => `p${index}`;
export const playerIndex = (id: string) => Number(id.slice(1));

// ---------------------------------------------------------------- compact state

/** The parts of the game state that change. Everything else is rebuilt from the scenario and seed. */
export interface PackedState {
  t: number;
  c: number;
  /** Per unit, in scenario order: [hex index, facing, strength]. */
  u: [number, number, number][];
  s: number[];
  f: 0 | 1;
  w: GameResult | null;
}

/** One player-turn: the orders given and what happened. */
export interface TurnRecord { t: number; p: number; o: PlayerOrders; e: GameEvent[] }

/** Everything in a link. */
export interface GameLink {
  v: number;
  /** Random game id, used to remember things about this game in the browser. */
  id: string;
  name: string;
  scenario: string;
  /** Game seed: fixes every dice roll, so the same orders always give the same result. */
  seed: number;
  /** Player names, in turn order. */
  players: string[];
  s: PackedState;
  /** The most recent player-turns (one round's worth), for reports and replay checks. */
  h: TurnRecord[];
}

const hexIndex = (state: GameState, hex: HexKey) => { const [c, r] = hex.split(',').map(Number); return r * state.map.cols + c; };
const hexKey = (state: GameState, i: number) => `${i % state.map.cols},${Math.floor(i / state.map.cols)}`;

export function packState(state: GameState): PackedState {
  return {
    t: state.turn,
    c: state.current,
    u: state.units.map((u) => [hexIndex(state, u.hex), u.facing, u.strength]),
    s: state.players.map((p) => state.scores[p.id]),
    f: state.finished ? 1 : 0,
    w: state.result,
  };
}

function baseState(g: Pick<GameLink, 'scenario' | 'players' | 'seed'>): GameState {
  if (!SCENARIOS[g.scenario]) throw new LinkError(`This link uses a scenario this version doesn't have (${g.scenario}).`);
  return createInitialState(g.scenario, g.players.map((_, i) => ({ id: playerId(i), side: i })), g.seed);
}

export function unpackState(g: Pick<GameLink, 'scenario' | 'players' | 'seed'>, packed: PackedState): GameState {
  const state = baseState(g);
  if (packed.u.length !== state.units.length) throw new LinkError('The link does not match its scenario.');
  state.turn = packed.t;
  state.current = packed.c;
  state.units.forEach((u, i) => {
    const [hex, facing, strength] = packed.u[i];
    u.hex = hexKey(state, hex);
    u.facing = facing as Facing;
    u.strength = strength;
  });
  state.players.forEach((p, i) => { state.scores[p.id] = packed.s[i]; });
  state.finished = packed.f === 1;
  state.result = packed.w;
  return state;
}

export const stateFingerprint = (state: GameState) => sha256(JSON.stringify(packState(state)));

// ---------------------------------------------------------------- links

export interface Game {
  link: GameLink;
  state: GameState;
}

export const encodeGame = (g: GameLink) => encodeFragment(g);

export async function readGame(hashOrUrl: string): Promise<Game> {
  const link = await decodeFragment<GameLink>(hashOrUrl);
  if (link?.v !== LINK_VERSION) throw new LinkError(`This link is from a different version of Battle Lines (v${link?.v ?? '?'}).`);
  return { link, state: unpackState(link, link.s) };
}

export interface NewGame {
  gameName: string;
  scenario: string;
  /** Player names, in turn order. */
  players: string[];
}

export function createGame(g: NewGame): Game {
  const sc = SCENARIOS[g.scenario];
  if (!sc) throw new LinkError('Unknown scenario.');
  const names = g.players.map((n, i) => n.trim() || `Player ${i + 1}`);
  if (names.length < sc.minPlayers || names.length > sc.maxPlayers) throw new LinkError(`This scenario is for ${sc.minPlayers}–${sc.maxPlayers} players.`);
  const link: GameLink = {
    v: LINK_VERSION,
    id: toB64u(globalThis.crypto.getRandomValues(new Uint8Array(9))),
    name: g.gameName.trim() || 'Untitled battle',
    scenario: g.scenario,
    seed: globalThis.crypto.getRandomValues(new Uint32Array(1))[0],
    players: names,
    s: { t: 0, c: 0, u: [], s: [], f: 0, w: null },
    h: [],
  };
  const state = baseState(link);
  link.s = packState(state);
  return { link, state };
}

export interface EndedTurn extends Game {
  /** What happened during the turn just played. */
  events: GameEvent[];
}

/** Resolve the current player's orders and produce the link for the next player. */
export function endTurn(game: Game, orders: PlayerOrders): EndedTurn {
  const before = game.state;
  const { state, events } = resolvePlayerTurn(before, orders);
  const h = [...game.link.h, { t: before.turn, p: before.current, o: orders, e: events }].slice(-Math.max(1, game.link.players.length - 1));
  return { link: { ...game.link, s: packState(state), h }, state, events };
}

/** The player-turns since `player` last moved (what they need to catch up on). */
export function turnsSince(link: GameLink, player: number): TurnRecord[] {
  const last = link.h.map((r) => r.p).lastIndexOf(player);
  return link.h.slice(last + 1);
}

export type Verification = 'verified' | 'mismatch' | 'unknown';

/**
 * Check the other players' moves since my last turn by replaying their logged orders on the
 * position I sent (remembered by my browser). Same seed + same orders must give the same position.
 */
export function verifyReplay(link: GameLink, mine: PackedState | null): Verification {
  if (!mine) return 'unknown';
  let state = unpackState(link, mine);
  for (const entry of link.h) {
    if (entry.t !== state.turn || entry.p !== state.current) continue; // from before my last turn
    if (state.finished) break;
    state = resolvePlayerTurn(state, entry.o).state;
  }
  return JSON.stringify(packState(state)) === JSON.stringify(link.s) ? 'verified' : 'mismatch';
}
