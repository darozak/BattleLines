// Data shapes shared by the rules engine, the server and the browser.

/** A hex is identified by the string "col,row" (odd-r offset coordinates). */
export type HexKey = string;
/** Hexside a unit faces: 0-5 = E, NE, NW, W, SW, SE (see hex.ts). */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5;
export type PlayerId = string;
export type UnitId = string;

export type TerrainType = 'open' | 'road' | 'light_forest' | 'dense_forest' | 'hills' | 'ruins' | 'village' | 'marsh' | 'river' | 'water';

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
  /** Cost to deploy, against the game's point limit. */
  points: number;
  /** One or two letters drawn on the unit counter. */
  code: string;
  move: number;
  sight: number;
  strength: number;
  /** The largest change in elevation the unit can make in one step (most units 1). */
  climb: number;
}

export interface GameMap {
  cols: number;
  rows: number;
  /** Row-major: terrain[row * cols + col]. */
  terrain: TerrainType[];
  /** Row-major, like terrain: each hex's height, 0 and up. */
  elevation: number[];
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

export interface GameResult {
  winners: PlayerId[];
  reason: string;
}

export interface GameState {
  /** Era id (see setup.ts): decides the terrain, the armies and their units. */
  era: string;
  /** Map size id (see setup.ts). */
  size: string;
  /** Most points of units each player may deploy. */
  pointLimit: number;
  /** 'deploy': turn 0, players pick an army and place units in turn. 'battle': rounds 1 and up. */
  phase: 'deploy' | 'battle';
  /** The army each player picked (null until they deploy). */
  armies: Record<PlayerId, string | null>;
  /** Game seed, used to generate the map. (There are no dice: combat is decided by a tally of modifiers.) */
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
  finished: boolean;
  result: GameResult | null;
}

export interface UnitOrder {
  /** Hexes to move through, not including the unit's starting hex. */
  path: HexKey[];
  /** Facing at the end of the move. If omitted, a moving unit faces its last step; a unit that doesn't move keeps its facing. */
  facing?: Facing;
  /** Enemy unit to attack after moving. If omitted (or out of reach), the unit attacks the weakest adjacent enemy. */
  target?: UnitId;
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
  attacker: UnitId;
  attackerOwner: PlayerId;
  attackerType: string;
  attackerHex: HexKey;
  target: UnitId;
  targetOwner: PlayerId;
  targetType: string;
  targetHex: HexKey;
  /** Which of the target's arcs the attack came from. */
  arc: 'front' | 'flank' | 'rear';
  /** Every modifier that decided the outcome. */
  tally: TallyLine[];
  attack: number;
  defence: number;
  /** attack − defence, never below 0. Each hit removes one strength point. */
  hits: number;
}

/** One line of a combat tally sheet. */
export interface TallyLine {
  side: 'attack' | 'defence';
  label: string;
  value: number;
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
/** A player picked an army and placed their units (turn 0). */
export interface DeployEvent {
  type: 'deploy';
  player: PlayerId;
  army: string;
  units: number;
  points: number;
}
export type GameEvent = DeployEvent | MoveEvent | HaltEvent | TurnEvent | ClashEvent | AttackEvent | DestroyedEvent | ScoreEvent | GameOverEvent;

// ---------------------------------------------------------------- the board as shown to a player

export type VisibleUnit =
  | (Unit & Datasheet & { own: true })
  | { id: UnitId; owner: PlayerId; type: string; name: string; hex: HexKey; facing: Facing; strength: number; code: string; own: false };

export interface PlayerView {
  map: GameMap;
  objectives: HexKey[];
  datasheets: Record<string, Datasheet>;
  units: VisibleUnit[];
  scores: Record<PlayerId, number>;
  turn: number;
  turnLimit: number;
  finished: boolean;
  result: GameResult | null;
  eliminated: PlayerId[];
}
