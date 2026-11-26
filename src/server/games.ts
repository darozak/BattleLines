// Game service: invitations, turn lifecycle, deadlines and the emails that drive them.
import { randomBytes, randomUUID } from 'node:crypto';
import { allRows, getRow, transaction, type Db, type GameRow, type OrderRow, type PlayerRow, type TurnResultRow } from './db.js';
import type { Mailer } from './mailer.js';
import * as mail from './emails.js';
import { SCENARIOS, SIDE_NAMES, createInitialState } from '../shared/scenario.js';
import { resolveTurn, initialSpotting, validateOrders } from '../shared/engine.js';
import { randomSeed } from '../shared/rng.js';
import type { GameEvent, GameState, PlayerData, PlayerId, PlayerOrders, PlayerView } from '../shared/types.js';

export const TURN_LENGTHS: Record<string, number> = {
  '7d': 7 * 86400,
  '3d': 3 * 86400,
  '1d': 86400,
  '1h': 3600,
  '5m': 300,
};

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const newToken = () => randomBytes(24).toString('base64url');

/** An error caused by the user's input or the game's state; its message is safe to show them. */
export class GameError extends Error {}

export interface CreateGameInput {
  hostName?: string;
  hostEmail?: string;
  gameName?: string;
  turnLength?: string;
  inviteEmails?: string;
  scenario?: string;
}

export interface PlayerContext {
  player: PlayerRow;
  game: GameRow;
}

export interface GameServiceOptions {
  db: Db;
  mailer: Mailer;
  now?: () => number;
  baseUrl: string;
}

export type GameService = ReturnType<typeof createGameService>;

export function createGameService({ db, mailer, now = () => Date.now(), baseUrl }: GameServiceOptions) {
  const link = (player: { token: string }) => `${baseUrl}/p/${player.token}`;
  const displayName = (p: PlayerRow) => p.name || p.email;

  const getGame = (id: string) => getRow<GameRow>(db, 'SELECT * FROM games WHERE id = ?', id);
  const getPlayers = (gameId: string) =>
    allRows<PlayerRow>(db, 'SELECT * FROM players WHERE game_id = ? ORDER BY is_host DESC, created_at, rowid', gameId);
  const acceptedPlayers = (gameId: string) => getPlayers(gameId).filter((p) => p.invite_status === 'accepted');
  const getOrders = (gameId: string, turn: number) =>
    allRows<OrderRow>(db, 'SELECT * FROM orders WHERE game_id = ? AND turn = ?', gameId, turn);
  const getState = (game: GameRow): GameState => {
    if (!game.state_json) throw new Error(`Game ${game.id} has no state`);
    return JSON.parse(game.state_json) as GameState;
  };
  const reminderLeadMs = (game: GameRow) => Math.min(24 * 3600, game.turn_length_sec / 4) * 1000;

  async function createGame(input: CreateGameInput): Promise<{ game: GameRow; host: PlayerRow }> {
    const scenario = input.scenario || 'crossroads';
    const sc = SCENARIOS[scenario];
    if (!sc) throw new GameError('Unknown scenario.');
    const hostEmail = String(input.hostEmail || '').trim().toLowerCase();
    if (!EMAIL_RE.test(hostEmail)) throw new GameError('Please enter a valid email address for yourself.');
    const turnSec = TURN_LENGTHS[input.turnLength || '7d'];
    if (!turnSec) throw new GameError('Unknown turn length.');
    const invitees = [...new Set(String(input.inviteEmails || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))]
      .filter((e) => e !== hostEmail);
    const bad = invitees.filter((e) => !EMAIL_RE.test(e));
    if (bad.length) throw new GameError(`These don't look like email addresses: ${bad.join(', ')}`);
    if (invitees.length < sc.minPlayers - 1) throw new GameError('Invite at least one other player.');
    if (invitees.length > sc.maxPlayers - 1) throw new GameError(`This scenario supports at most ${sc.maxPlayers} players including you.`);

    const t = now();
    const gameId = randomUUID();
    const gameName = String(input.gameName || '').trim() || 'Untitled battle';
    const hostId = randomUUID();
    const guests = invitees.map((email) => ({ id: randomUUID(), email, token: newToken() }));
    transaction(db, () => {
      db.prepare("INSERT INTO games (id, name, scenario, status, turn_length_sec, created_at) VALUES (?, ?, ?, 'inviting', ?, ?)")
        .run(gameId, gameName, scenario, turnSec, t);
      const ins = db.prepare('INSERT INTO players (id, game_id, email, name, token, is_host, invite_status, responded_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      ins.run(hostId, gameId, hostEmail, String(input.hostName || '').trim() || null, newToken(), 1, 'accepted', t, t);
      guests.forEach((g, i) => ins.run(g.id, gameId, g.email, null, g.token, 0, 'pending', null, t + i + 1));
    });
    const game = getGame(gameId)!;
    const host = getPlayers(gameId).find((p) => p.id === hostId)!;
    for (const guest of guests) {
      await mailer.send({ gameId, to: guest.email, ...mail.inviteEmail({ game, host, link: link(guest), scenario: sc }) });
    }
    await mailer.send({ gameId, to: host.email, ...mail.hostCreatedEmail({ game, link: link(host), invitees }) });
    return { game, host };
  }

  function lookup(token: string): PlayerContext | null {
    const player = getRow<PlayerRow>(db, 'SELECT * FROM players WHERE token = ?', String(token));
    if (!player) return null;
    return { player, game: getGame(player.game_id)! };
  }

  async function respond(token: string, accept: boolean, name?: string): Promise<PlayerContext | null> {
    const ctx = lookup(token);
    if (!ctx) throw new GameError('Unknown link.');
    const { player, game } = ctx;
    if (game.status !== 'inviting') throw new GameError('This game is no longer accepting replies.');
    if (player.invite_status !== 'pending') return ctx;
    db.prepare('UPDATE players SET invite_status = ?, name = COALESCE(?, name), responded_at = ? WHERE id = ?')
      .run(accept ? 'accepted' : 'declined', String(name || '').trim() || null, now(), player.id);
    const players = getPlayers(game.id);
    const accepted = players.filter((p) => p.invite_status === 'accepted');
    if (!players.some((p) => p.invite_status === 'pending') && accepted.length >= SCENARIOS[game.scenario].minPlayers) {
      await startGame(game.id);
    }
    return lookup(token);
  }

  async function startGame(gameId: string, byToken?: string): Promise<GameRow> {
    const game = getGame(gameId);
    if (!game) throw new GameError('Unknown game.');
    if (byToken) {
      const ctx = lookup(byToken);
      if (!ctx || ctx.game.id !== gameId || !ctx.player.is_host) throw new GameError('Only the host can start the game.');
    }
    if (game.status !== 'inviting') throw new GameError('The game has already started.');
    const accepted = acceptedPlayers(gameId);
    if (accepted.length < SCENARIOS[game.scenario].minPlayers) throw new GameError('Not enough players have accepted yet.');

    const seed = randomSeed();
    const players = accepted.map((p, side) => ({ id: p.id, side }));
    const state = initialSpotting(createInitialState(game.scenario, players, seed));
    const deadline = now() + game.turn_length_sec * 1000;
    transaction(db, () => {
      const setSide = db.prepare('UPDATE players SET side = ? WHERE id = ?');
      players.forEach((p) => setSide.run(p.side, p.id));
      db.prepare("UPDATE games SET status = 'active', turn = 1, deadline = ?, reminder_sent = 0, state_json = ? WHERE id = ?")
        .run(deadline, JSON.stringify(state), gameId);
    });
    const g = getGame(gameId)!;
    for (const p of acceptedPlayers(gameId)) {
      await mailer.send({ gameId, to: p.email, ...mail.turnEmail({ game: g, player: p, turn: 1, link: link(p), deadline, firstTurn: true }) });
    }
    return g;
  }

  async function cancelGame(token: string): Promise<void> {
    const ctx = lookup(token);
    if (!ctx || !ctx.player.is_host) throw new GameError('Only the host can cancel the game.');
    if (!['inviting', 'active'].includes(ctx.game.status)) throw new GameError('The game is already over.');
    db.prepare("UPDATE games SET status = 'cancelled' WHERE id = ?").run(ctx.game.id);
    for (const p of getPlayers(ctx.game.id).filter((x) => x.invite_status !== 'declined' && !x.is_host)) {
      await mailer.send({ gameId: ctx.game.id, to: p.email, ...mail.cancelledEmail({ game: ctx.game }) });
    }
  }

  function submitOrders(token: string, orders: unknown): { turn: number; submittedAt: number; orders: PlayerOrders } {
    const ctx = lookup(token);
    if (!ctx) throw new GameError('Unknown link.');
    const { player, game } = ctx;
    if (game.status !== 'active') throw new GameError('This game is not accepting orders.');
    const v = validateOrders(getState(game), player.id, orders);
    if (!v.ok) throw new GameError(v.errors.join('; '));
    const t = now();
    db.prepare(`INSERT INTO orders (game_id, turn, player_id, orders_json, submitted_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (game_id, turn, player_id) DO UPDATE SET orders_json = excluded.orders_json, submitted_at = excluded.submitted_at`)
      .run(game.id, game.turn, player.id, JSON.stringify(v.orders), t);
    return { turn: game.turn, submittedAt: t, orders: v.orders };
  }

  async function resolveGame(gameId: string, expectedTurn?: number): Promise<GameRow | null> {
    const game = getGame(gameId);
    if (!game || game.status !== 'active') return null;
    if (expectedTurn !== undefined && game.turn !== expectedTurn) return null; // already resolved elsewhere
    const state = getState(game);
    const ordersByPlayer: Record<PlayerId, PlayerOrders> = Object.fromEntries(
      getOrders(gameId, game.turn).map((r) => [r.player_id, JSON.parse(r.orders_json) as PlayerOrders]));
    const seed = randomSeed();
    const { state: next, events, logs } = resolveTurn(state, ordersByPlayer, seed);
    const players = acceptedPlayers(gameId);
    const deadline = now() + game.turn_length_sec * 1000;

    transaction(db, () => {
      db.prepare(`INSERT INTO turn_results (game_id, turn, seed, state_before_json, orders_json, events_json, logs_json, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(gameId, game.turn, seed, game.state_json, JSON.stringify(ordersByPlayer),
        JSON.stringify(events), JSON.stringify(logs), now());
      const missed = db.prepare('UPDATE players SET missed_turns = missed_turns + 1 WHERE id = ?');
      const ontime = db.prepare('UPDATE players SET missed_turns = 0 WHERE id = ?');
      for (const p of players) (ordersByPlayer[p.id] ? ontime : missed).run(p.id);
      if (next.finished) {
        db.prepare("UPDATE games SET status = 'finished', state_json = ?, deadline = NULL WHERE id = ?").run(JSON.stringify(next), gameId);
      } else {
        db.prepare('UPDATE games SET turn = ?, deadline = ?, reminder_sent = 0, state_json = ? WHERE id = ?')
          .run(next.turn, deadline, JSON.stringify(next), gameId);
      }
    });

    const g = getGame(gameId)!;
    if (next.finished && next.result) {
      const nameOf = (id: PlayerId) => displayName(players.find((x) => x.id === id)!);
      const winners = next.result.winners.map(nameOf);
      const scores = players.map((p) => `${displayName(p)} (${SIDE_NAMES[p.side ?? 0]}): ${next.scores[p.id]}`).join(', ');
      const resultText = `${next.result.reason} ${winners.length ? `Victory: ${winners.join(' and ')}.` : 'No winner.'} Final scores: ${scores}.`;
      for (const p of players) await mailer.send({ gameId, to: p.email, ...mail.finalEmail({ game: g, link: link(p), resultText }) });
    } else {
      for (const p of players) {
        await mailer.send({ gameId, to: p.email, ...mail.turnEmail({ game: g, player: p, turn: next.turn, link: link(p), deadline, firstTurn: false }) });
      }
    }
    return g;
  }

  /**
   * Called periodically by the scheduler. Resolves turns whose deadline has passed (or
   * where every player has submitted) and sends reminders to players running out of time.
   */
  async function tick(): Promise<void> {
    const t = now();
    for (const { id } of allRows<{ id: string }>(db, "SELECT id FROM games WHERE status = 'active'")) {
      const game = getGame(id)!; // re-read: an earlier await may have resolved it already
      if (game.status !== 'active' || game.deadline === null) continue;
      const state = getState(game);
      const aliveOwners = new Set(state.units.filter((u) => u.strength > 0).map((u) => u.owner));
      const needed = acceptedPlayers(game.id).filter((p) => aliveOwners.has(p.id));
      const submitted = new Set(getOrders(game.id, game.turn).map((r) => r.player_id));
      if (t >= game.deadline || needed.every((p) => submitted.has(p.id))) {
        await resolveGame(game.id, game.turn);
      } else if (!game.reminder_sent && t >= game.deadline - reminderLeadMs(game)) {
        db.prepare('UPDATE games SET reminder_sent = 1 WHERE id = ?').run(game.id);
        for (const p of needed.filter((x) => !submitted.has(x.id))) {
          await mailer.send({ gameId: game.id, to: p.email, ...mail.reminderEmail({ game, turn: game.turn, link: link(p), deadline: game.deadline }) });
        }
      }
    }
  }

  /** Everything one player is allowed to see, for the map page. */
  function playerData(token: string, viewFn: (state: GameState, playerId: PlayerId) => PlayerView): PlayerData | null {
    const ctx = lookup(token);
    if (!ctx) return null;
    const { player, game } = ctx;
    const state = getState(game);
    const submitted = new Set(getOrders(game.id, game.turn).map((r) => r.player_id));
    const mine = getRow<OrderRow>(db, 'SELECT * FROM orders WHERE game_id = ? AND turn = ? AND player_id = ?', game.id, game.turn, player.id);
    const lastTurn = game.status === 'finished' ? state.turn : game.turn - 1;
    const last = lastTurn >= 1
      ? getRow<TurnResultRow>(db, 'SELECT * FROM turn_results WHERE game_id = ? AND turn = ?', game.id, lastTurn)
      : undefined;
    return {
      game: { id: game.id, name: game.name, status: game.status, turn: game.turn, deadline: game.deadline, turnLengthSec: game.turn_length_sec },
      me: { id: player.id, name: displayName(player), side: player.side, isHost: !!player.is_host },
      players: acceptedPlayers(game.id).map((p) => ({
        id: p.id, name: p.name || p.email.split('@')[0], side: p.side ?? 0, submitted: submitted.has(p.id), missedTurns: p.missed_turns,
      })),
      view: viewFn(state, player.id),
      myOrders: mine ? (JSON.parse(mine.orders_json) as PlayerOrders) : null,
      submittedAt: mine ? mine.submitted_at : null,
      lastTurn: last
        ? { turn: last.turn, events: (JSON.parse(last.logs_json) as Record<PlayerId, GameEvent[]>)[player.id] || [] }
        : null,
    };
  }

  return { createGame, lookup, respond, startGame, cancelGame, submitOrders, resolveGame, tick, playerData, getGame, getPlayers };
}
