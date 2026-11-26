import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GameStatus } from '../shared/types.js';

export type Db = DatabaseSync;

// Row shapes as stored in SQLite. Times are milliseconds since the epoch.
export interface GameRow {
  id: string;
  name: string;
  scenario: string;
  status: GameStatus;
  turn: number;
  turn_length_sec: number;
  deadline: number | null;
  reminder_sent: number;
  state_json: string | null;
  created_at: number;
}
export interface PlayerRow {
  id: string;
  game_id: string;
  email: string;
  name: string | null;
  token: string;
  is_host: number;
  invite_status: 'pending' | 'accepted' | 'declined';
  responded_at: number | null;
  side: number | null;
  missed_turns: number;
  created_at: number;
}
export interface OrderRow {
  game_id: string;
  turn: number;
  player_id: string;
  orders_json: string;
  submitted_at: number;
}
export interface TurnResultRow {
  game_id: string;
  turn: number;
  seed: number;
  state_before_json: string;
  orders_json: string;
  events_json: string;
  logs_json: string;
  resolved_at: number;
}
export interface EmailRow {
  id: number;
  game_id: string | null;
  to_addr: string;
  subject: string;
  text: string;
  html: string;
  status: 'outbox' | 'queued' | 'sent' | 'failed';
  error: string | null;
  created_at: number;
}

// node:sqlite returns loosely typed rows; these helpers give them their row type.
export const getRow = <T>(db: Db, sql: string, ...params: (string | number | null)[]): T | undefined =>
  db.prepare(sql).get(...params) as T | undefined;
export const allRows = <T>(db: Db, sql: string, ...params: (string | number | null)[]): T[] =>
  db.prepare(sql).all(...params) as unknown as T[];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scenario TEXT NOT NULL,
  status TEXT NOT NULL,            -- inviting | active | finished | cancelled
  turn INTEGER NOT NULL DEFAULT 0,
  turn_length_sec INTEGER NOT NULL,
  deadline INTEGER,                -- ms since epoch
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  state_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  email TEXT NOT NULL,
  name TEXT,
  token TEXT NOT NULL UNIQUE,
  is_host INTEGER NOT NULL DEFAULT 0,
  invite_status TEXT NOT NULL,     -- pending | accepted | declined
  responded_at INTEGER,
  side INTEGER,
  missed_turns INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS players_game ON players(game_id);
CREATE TABLE IF NOT EXISTS orders (
  game_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  orders_json TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, turn, player_id)
);
CREATE TABLE IF NOT EXISTS turn_results (
  game_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  state_before_json TEXT NOT NULL,
  orders_json TEXT NOT NULL,
  events_json TEXT NOT NULL,
  logs_json TEXT NOT NULL,
  resolved_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, turn)
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL,            -- outbox | sent | failed
  error TEXT,
  created_at INTEGER NOT NULL
);
`;

export function openDb(file = ':memory:'): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
