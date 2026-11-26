// Prototype scenario: a small free-for-all skirmish on a generated hex map.
// Datasheets and numbers here are PLACEHOLDERS until the real rules are written.
import { key, neighbors, line } from './hex.js';
import { createRng } from './rng.js';
import type { Datasheet, GameMap, GameState, HexKey, PlayerId, TerrainType, Unit } from './types.js';

export const PLACEHOLDER_DATASHEETS: Record<string, Datasheet> = {
  infantry: { name: 'Infantry', code: 'I', move: 4, sight: 5, strength: 4 },
  scout:    { name: 'Scout',    code: 'S', move: 6, sight: 7, strength: 2 },
  heavy:    { name: 'Heavy',    code: 'H', move: 3, sight: 4, strength: 6 },
};

export const SIDE_COLORS = ['#2b6cb0', '#c53030', '#2f855a', '#b7791f'];
export const SIDE_NAMES = ['Blue', 'Red', 'Green', 'Gold'];

const COLS = 16;
const ROWS = 12;

// Starting hexes for each side's four units: infantry, infantry, scout, heavy.
const DEPLOYMENTS: HexKey[][] = [
  ['1,4', '1,7', '2,5', '0,6'],    // west
  ['14,4', '14,7', '13,6', '15,5'], // east
  ['6,1', '9,1', '7,2', '8,0'],    // north
  ['6,10', '9,10', '8,9', '7,11'], // south
];
const ROSTER = ['infantry', 'infantry', 'scout', 'heavy'];

export interface Scenario {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  turnLimit: number;
}

export const SCENARIOS: Record<string, Scenario> = {
  crossroads: {
    id: 'crossroads',
    name: 'Skirmish at the Crossroads',
    description: 'Up to four commanders race to hold three objectives near the crossroads. Placeholder rules.',
    minPlayers: 2,
    maxPlayers: 4,
    turnLimit: 10,
  },
};

export function generateMap(seed: number, protectedHexes: HexKey[]): GameMap {
  const rng = createRng(seed);
  const terrain: TerrainType[] = new Array(COLS * ROWS).fill('open');
  const set = (hex: HexKey, t: TerrainType) => {
    const [c, r] = hex.split(',').map(Number);
    terrain[r * COLS + c] = t;
  };
  const grow = (type: TerrainType, seeds: number, size: number) => {
    for (let i = 0; i < seeds; i++) {
      let frontier = [key(rng.int(COLS), rng.int(ROWS))];
      for (let j = 0; j < size && frontier.length; j++) {
        const h = rng.pick(frontier);
        set(h, type);
        frontier = frontier.concat(neighbors(h, COLS, ROWS));
      }
    }
  };
  grow('woods', 5, 6);
  grow('hills', 3, 4);
  grow('water', 1, 5);
  grow('ruins', 1, 2);
  // A road from west to east and one from north to south, crossing near the centre.
  for (const h of line(key(0, 6), key(COLS - 1, 5))) set(h, 'road');
  for (const h of line(key(7, 0), key(8, ROWS - 1))) set(h, 'road');
  for (const h of protectedHexes) set(h, 'open');
  return { cols: COLS, rows: ROWS, terrain };
}

export interface ScenarioPlayer { id: PlayerId; side: number }

export function createInitialState(scenarioId: string, players: ScenarioPlayer[], seed: number): GameState {
  const scenario = SCENARIOS[scenarioId];
  const objectives = ['5,4', '10,7', '7,6'];
  const deploy = players.flatMap((p) => DEPLOYMENTS[p.side]);
  const map = generateMap(seed, [...objectives, ...deploy]);
  const units: Unit[] = [];
  let n = 0;
  for (const p of players) {
    const counts: Record<string, number> = {};
    DEPLOYMENTS[p.side].forEach((hex, i) => {
      const type = ROSTER[i];
      const ds = PLACEHOLDER_DATASHEETS[type];
      counts[type] = (counts[type] || 0) + 1;
      units.push({
        id: `u${++n}`,
        owner: p.id,
        type,
        name: `${ds.name} ${counts[type]}`,
        hex,
        strength: ds.strength,
      });
    });
  }
  const state: GameState = {
    scenario: scenarioId,
    turn: 1,
    turnLimit: scenario.turnLimit,
    map,
    datasheets: PLACEHOLDER_DATASHEETS,
    players: players.map((p) => ({ id: p.id, side: p.side })),
    units,
    objectives,
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    lastSeen: Object.fromEntries(players.map((p) => [p.id, {}])),
    finished: false,
    result: null,
  };
  return state;
}
