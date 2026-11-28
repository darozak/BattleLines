// Game lifecycle without a server: set up → turn 0 (each player deploys) → rounds of turns → game
// over. Every turn produces a new link (see link.ts) that the player sends to the next player.
// Nothing is hidden: every player sees the whole battlefield.
import { createSetupState, resolveDeployment, ERAS, MAP_SIZES, POINT_LIMITS, MIN_PLAYERS, maxPlayers, SCENARIOS, ROUND_OPTIONS, OBJECTIVE_OPTIONS, type Deployment } from './setup.js';
import { resolvePlayerTurn } from './engine.js';
import { randomBattleName } from './names.js';
import { decodeFragment, encodeFragment, LinkError, LINK_VERSION, sha256, toB64u } from './link.js';
import type { Facing, GameEvent, GameResult, GameState, HexKey, PlayerOrders } from './types.js';

export const playerId = (index: number) => `p${index}`;
export const playerIndex = (id: string) => Number(id.slice(1));

// ---------------------------------------------------------------- compact state

/** The parts of the game state that change. The map and datasheets are rebuilt from the era, size and seed. */
export interface PackedState {
  /** Phase: 0 deploying, 1 battle. */
  ph: 0 | 1;
  t: number;
  c: number;
  /** Each player's army id ('' until they deploy). */
  a: string[];
  /** Per unit, in the order they were deployed: [type, owner index, hex index, facing, strength]. */
  u: [string, number, number, number, number][];
  s: number[];
  f: 0 | 1;
  w: GameResult | null;
}

/** One player-turn: orders given (or, on turn 0, the deployment) and what happened. */
export interface TurnRecord { t: number; p: number; o?: PlayerOrders; d?: Deployment; e: GameEvent[] }

/** Everything in a link. */
export interface GameLink {
  v: number;
  /** Random game id, used to remember things about this game in the browser. */
  id: string;
  name: string;
  era: string;
  size: string;
  points: number;
  /** Map seed. (There are no dice.) */
  seed: number;
  /** Scenario id, number of rounds and, for scenarios that let you choose, number of objectives (#37). */
  sc: string;
  rounds: number;
  obj?: number;
  /** Player names, in turn order (shuffled when the game was set up). */
  players: string[];
  s: PackedState;
  /** The most recent player-turns (one round's worth), for reports and replay checks. */
  h: TurnRecord[];
}

const hexIndex = (state: GameState, hex: HexKey) => { const [c, r] = hex.split(',').map(Number); return r * state.map.cols + c; };
const hexKey = (state: GameState, i: number) => `${i % state.map.cols},${Math.floor(i / state.map.cols)}`;

export function packState(state: GameState): PackedState {
  return {
    ph: state.phase === 'deploy' ? 0 : 1,
    t: state.turn,
    c: state.current,
    a: state.players.map((p) => state.armies[p.id] ?? ''),
    u: state.units.map((u) => [u.type, playerIndex(u.owner), hexIndex(state, u.hex), u.facing, u.strength]),
    s: state.players.map((p) => state.scores[p.id]),
    f: state.finished ? 1 : 0,
    w: state.result,
  };
}

type Setup = Pick<GameLink, 'era' | 'size' | 'points' | 'players' | 'seed' | 'sc' | 'rounds' | 'obj'>;

function baseState(g: Setup): GameState {
  if (!ERAS[g.era]) throw new LinkError(`This link uses an era this version doesn't have (${g.era}).`);
  if (!MAP_SIZES[g.size]) throw new LinkError(`This link uses a map size this version doesn't have (${g.size}).`);
  if (!SCENARIOS[g.sc]) throw new LinkError(`This link uses a scenario this version doesn't have (${g.sc}).`);
  return createSetupState(g.era, g.size, g.points, g.players.map((_, i) => ({ id: playerId(i), side: i })), g.seed,
    { scenario: g.sc, rounds: g.rounds, objectives: g.obj });
}

export function unpackState(g: Setup, packed: PackedState): GameState {
  const state = baseState(g);
  state.phase = packed.ph === 0 ? 'deploy' : 'battle';
  state.turn = packed.t;
  state.current = packed.c;
  state.players.forEach((p, i) => {
    state.armies[p.id] = packed.a[i] || null;
    state.scores[p.id] = packed.s[i];
  });
  const counts: Record<string, number> = {};
  state.units = packed.u.map(([type, owner, hex, facing, strength], i) => {
    const ds = state.datasheets[type];
    if (!ds) throw new LinkError('The link names a unit this era doesn\'t have.');
    const k = `${owner}:${type}`;
    counts[k] = (counts[k] || 0) + 1;
    return { id: `u${i + 1}`, owner: playerId(owner), type, name: `${ds.name} ${counts[k]}`, hex: hexKey(state, hex), facing: facing as Facing, strength };
  });
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

/**
 * A readable label at the start of every link, showing what the link is waiting for, e.g.
 * "Deploy-Alice", "Round3-Bob" or "Final". It is only for people: links are read without it.
 */
export function linkLabel(link: GameLink): string {
  if (link.s.f) return 'Final';
  const name = (link.players[link.s.c] ?? '').normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || `Player${link.s.c + 1}`;
  return link.s.ph === 0 ? `Deploy-${name}` : `Round${link.s.t}-${name}`;
}

/** The link fragment: "<label>/<compressed game>". */
export const encodeGame = async (g: GameLink) => `${linkLabel(g)}/${await encodeFragment(g)}`;

export async function readGame(hashOrUrl: string): Promise<Game> {
  const fragment = hashOrUrl.includes('#') ? hashOrUrl.slice(hashOrUrl.indexOf('#') + 1) : hashOrUrl;
  // Skip the readable label (base64url data never contains "/"). Links without a label still work.
  const link = await decodeFragment<GameLink>(fragment.slice(fragment.lastIndexOf('/') + 1));
  if (link?.v !== LINK_VERSION) throw new LinkError(`This link is from a different version of Battle Lines (v${link?.v ?? '?'}).`);
  return { link, state: unpackState(link, link.s) };
}

export interface NewGame {
  gameName: string;
  era: string;
  size: string;
  points: number;
  /** Player names. The game shuffles them into a random turn order. */
  players: string[];
  /** Scenario id (default Hold the Field), number of rounds (default: the map size's) and objectives. */
  scenario?: string;
  rounds?: number;
  objectives?: number;
}

/** Random permutation, from the browser's (or Node's) cryptographic random numbers. */
function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createGame(g: NewGame): Game {
  if (!ERAS[g.era]) throw new LinkError('Choose an era.');
  if (!MAP_SIZES[g.size]) throw new LinkError('Choose a map size.');
  if (!POINT_LIMITS.includes(g.points)) throw new LinkError('Choose a point limit.');
  const scenario = SCENARIOS[g.scenario ?? 'hold'];
  if (!scenario) throw new LinkError('Choose a scenario.');
  const rounds = g.rounds ?? MAP_SIZES[g.size].turnLimit;
  if (!ROUND_OPTIONS.includes(rounds) && rounds !== MAP_SIZES[g.size].turnLimit) throw new LinkError('Choose the number of rounds.');
  if (g.objectives !== undefined && !OBJECTIVE_OPTIONS.includes(g.objectives)) throw new LinkError('Choose the number of objectives.');
  const names = g.players.map((n, i) => n.trim() || `Player ${i + 1}`);
  const most = maxPlayers(ERAS[g.era]);
  if (names.length < MIN_PLAYERS || names.length > most) throw new LinkError(`A game in this era is for ${MIN_PLAYERS}–${most} players: each needs an army of their own.`);
  const link: GameLink = {
    v: LINK_VERSION,
    id: toB64u(globalThis.crypto.getRandomValues(new Uint8Array(9))),
    name: g.gameName.trim() || randomBattleName(g.era), // #54, #55
    era: g.era,
    size: g.size,
    points: g.points,
    seed: globalThis.crypto.getRandomValues(new Uint32Array(1))[0],
    sc: scenario.id,
    rounds,
    ...(scenario.objectives === 'choose' && g.objectives !== undefined ? { obj: g.objectives } : {}),
    players: shuffle(names),
    s: { ph: 0, t: 0, c: 0, a: [], u: [], s: [], f: 0, w: null },
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

const record = (game: Game, entry: TurnRecord): TurnRecord[] =>
  [...game.link.h, entry].slice(-Math.max(1, game.link.players.length - 1));

/** Turn 0: the current player's army and unit placements. Throws if they break the rules. */
export function deploy(game: Game, d: Deployment): EndedTurn {
  const before = game.state;
  const { state, events } = resolveDeployment(before, d);
  const h = record(game, { t: before.turn, p: before.current, d, e: events });
  return { link: { ...game.link, s: packState(state), h }, state, events };
}

/** Resolve the current player's orders and produce the link for the next player. */
export function endTurn(game: Game, orders: PlayerOrders): EndedTurn {
  const before = game.state;
  const { state, events } = resolvePlayerTurn(before, orders);
  const h = record(game, { t: before.turn, p: before.current, o: orders, e: events });
  return { link: { ...game.link, s: packState(state), h }, state, events };
}

/** The player-turns since `player` last moved (what they need to catch up on). */
export function turnsSince(link: GameLink, player: number): TurnRecord[] {
  const last = link.h.map((r) => r.p).lastIndexOf(player);
  return link.h.slice(last + 1);
}

export type Verification = 'verified' | 'mismatch' | 'unknown';

/**
 * Check the other players' turns since my last one by replaying them on the position I sent
 * (remembered by my browser). Same position + same orders must give the same position.
 */
export function verifyReplay(link: GameLink, mine: PackedState | null): Verification {
  if (!mine) return 'unknown';
  let state = unpackState(link, mine);
  try {
    for (const entry of link.h) {
      if (entry.t !== state.turn || entry.p !== state.current) continue; // from before my last turn
      if (state.finished) break;
      if (entry.d) state = resolveDeployment(state, entry.d).state;
      else state = resolvePlayerTurn(state, entry.o ?? {}).state;
    }
  } catch {
    return 'mismatch';
  }
  return JSON.stringify(packState(state)) === JSON.stringify(link.s) ? 'verified' : 'mismatch';
}
