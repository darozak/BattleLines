// Data shapes shared by the rules engine, the server and the browser.

/** A hex is identified by the string "col,row" (odd-r offset coordinates). */
export type HexKey = string;
/** Hexside a unit faces: 0-5 = E, NE, NW, W, SW, SE (see hex.ts). */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5;
export type PlayerId = string;
export type UnitId = string;

export type TerrainType = 'open' | 'road' | 'woods' | 'hills' | 'ruins' | 'water';

export interface Terrain {
  name: string;
  /** Movement points to enter. Ignored when impassable. */
  cost: number;
  impassable?: boolean;
  blocksSight: boolean;
  sightBonus: number;
  defense: number;
  color: string;
}

export interface Datasheet {
  name: string;
  /** One or two letters drawn on the unit counter. */
  code: string;
  move: number;
  sight: number;
  strength: number;
}

export interface GameMap {
  cols: number;
  rows: number;
  /** Row-major: terrain[row * cols + col]. */
  terrain: TerrainType[];
}

export interface Unit {
  id: UnitId;
  owner: PlayerId;
  type: string;
  name: string;
  hex: HexKey;
  facing: Facing;
  strength: number;
}

export interface LastSeen {
  hex: HexKey;
  facing: Facing;
  turn: number;
  owner: PlayerId;
  type: string;
}

export interface GameResult {
  winners: PlayerId[];
  reason: string;
}

/** What one player learned from another player's turn. */
export interface Report {
  turn: number;
  player: PlayerId;
  events: GameEvent[];
}

export interface GameState {
  scenario: string;
  /** Game seed. Each player-turn's dice are derived from it, so replaying the same orders gives the same result. */
  seed: number;
  /** Round number. A round ends when every player has taken a turn. */
  turn: number;
  /** Index into players of the player whose turn it is. */
  current: number;
  turnLimit: number;
  map: GameMap;
  /** Copied into each game so later datasheet changes don't affect running games. */
  datasheets: Record<string, Datasheet>;
  players: { id: PlayerId; side: number }[];
  units: Unit[];
  objectives: HexKey[];
  scores: Record<PlayerId, number>;
  /** Per player: where each enemy unit was last seen. */
  lastSeen: Record<PlayerId, Record<UnitId, LastSeen>>;
  /** Per player: what they saw happen since their last turn. Cleared when they take their turn. */
  reports: Record<PlayerId, Report[]>;
  finished: boolean;
  result: GameResult | null;
}

export interface UnitOrder {
  /** Hexes to move through, not including the unit's starting hex. */
  path: HexKey[];
  /** Facing at the end of the move. If omitted, a moving unit faces its last step; a unit that doesn't move keeps its facing. */
  facing?: Facing;
}
export type PlayerOrders = Record<UnitId, UnitOrder>;

// ---------------------------------------------------------------- events

export interface MoveEvent {
  type: 'move';
  unit: UnitId;
  owner: PlayerId;
  unitType: string;
  path: HexKey[];
  /** Facing when the move ended. */
  facing: Facing;
  /** Set on enemy moves that were only partly in sight. */
  partial?: boolean;
}
export interface HaltEvent {
  type: 'halt';
  unit: UnitId;
  owner: PlayerId;
  hex: HexKey;
  reason: string;
}
/** A unit changed facing without moving. */
export interface TurnEvent {
  type: 'turn';
  unit: UnitId;
  owner: PlayerId;
  unitType: string;
  hex: HexKey;
  facing: Facing;
}
export interface ClashEvent {
  type: 'clash';
  hex: HexKey;
  units: UnitId[];
}
export interface AttackEvent {
  type: 'attack';
  /** null when the attacker was out of sight of the player receiving the report. */
  attacker: UnitId | null;
  attackerOwner: PlayerId;
  attackerType: string | null;
  attackerHex: HexKey | null;
  target: UnitId;
  targetOwner: PlayerId;
  targetType: string;
  targetHex: HexKey;
  /** Which of the target's arcs the attack came from. */
  arc: 'front' | 'flank' | 'rear';
  dice: number[];
  cover: number;
  hit: boolean;
  unseenAttacker?: boolean;
}
export interface DestroyedEvent {
  type: 'destroyed';
  unit: UnitId;
  owner: PlayerId;
  unitType: string;
  hex: HexKey;
}
export interface ScoreEvent {
  type: 'score';
  player: PlayerId;
  hex: HexKey;
  points: number;
}
export interface GameOverEvent extends GameResult {
  type: 'gameover';
}
export type GameEvent = MoveEvent | HaltEvent | TurnEvent | ClashEvent | AttackEvent | DestroyedEvent | ScoreEvent | GameOverEvent;

// ---------------------------------------------------------------- what a player may see

export type VisibleUnit =
  | (Unit & Datasheet & { own: true })
  | { id: UnitId; owner: PlayerId; type: string; hex: HexKey; facing: Facing; strength: number; code: string; own: false };

export interface Ghost extends LastSeen {
  id: UnitId;
  code: string;
}

export interface PlayerView {
  map: GameMap;
  objectives: HexKey[];
  datasheets: Record<string, Datasheet>;
  visibleHexes: HexKey[];
  units: VisibleUnit[];
  ghosts: Ghost[];
  scores: Record<PlayerId, number>;
  turn: number;
  turnLimit: number;
  finished: boolean;
  result: GameResult | null;
  eliminated: PlayerId[];
}
