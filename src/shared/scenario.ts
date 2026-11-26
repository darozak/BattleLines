// Prototype scenario: a small free-for-all skirmish on a generated hex map.
// Datasheets and numbers here are PLACEHOLDERS until the real rules are written.
import { key, neighbors, line, facingToward } from './hex.js';
import { createRng } from './rng.js';
import type { Datasheet, GameMap, GameState, HexKey, PlayerId, TerrainType, Unit } from './types.js';

export const PLACEHOLDER_DATASHEETS: Record<string, Datasheet> = {
  infantry: { name: 'Infantry', code: 'I', move: 4, sight: 5, strength: 4 },
  scout:    { name: 'Scout',    code: 'S', move: 6, sight: 7, strength: 2 },
  heavy:    { name: 'Heavy',    code: 'H', move: 3, sight: 4, strength: 6 },
};

export const SIDE_COLORS = ['#2b6cb0', '#c53030', '#2f855a', '#b7791f'];
export const SIDE_NAMES = ['Blue', 'Red', 'Green', 'Gold'];

// Starting hexes for each side in the crossroads scenario: infantry, infantry, scout, heavy.
const CROSSROADS_DEPLOYMENTS: HexKey[][] = [
  ['1,4', '1,7', '2,5', '0,6'],    // west
  ['14,4', '14,7', '13,6', '15,5'], // east
  ['6,1', '9,1', '7,2', '8,0'],    // north
  ['6,10', '9,10', '8,9', '7,11'], // south
];

export interface Scenario {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  turnLimit: number;
  cols: number;
  rows: number;
  /** Unit types each side starts with, in deployment order. */
  roster: string[];
  /** Terrain clusters to scatter: [type, number of clusters, hexes per cluster]. */
  terrain: [TerrainType, number, number][];
  /** Fixed objectives; if omitted they are placed automatically. */
  objectives?: HexKey[];
  /** Fixed deployment hexes per side; if omitted they are placed along the map edges. */
  deployments?: HexKey[][];
}

export const SCENARIOS: Record<string, Scenario> = {
  crossroads: {
    id: 'crossroads',
    name: 'Skirmish at the Crossroads',
    description: 'Up to four commanders race to hold three objectives near the crossroads. Placeholder rules.',
    minPlayers: 2,
    maxPlayers: 4,
    turnLimit: 10,
    cols: 16,
    rows: 12,
    roster: ['infantry', 'infantry', 'scout', 'heavy'],
    terrain: [['woods', 5, 6], ['hills', 3, 4], ['water', 1, 5], ['ruins', 1, 2]],
    objectives: ['5,4', '10,7', '7,6'],
    deployments: CROSSROADS_DEPLOYMENTS,
  },
  valley: {
    id: 'valley',
    name: 'Battle of the Broken Valley',
    description: 'A large battlefield with a dozen units per side and five objectives. Placeholder rules.',
    minPlayers: 2,
    maxPlayers: 4,
    turnLimit: 12,
    cols: 40,
    rows: 30,
    roster: ['infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry',
      'scout', 'scout', 'scout', 'heavy', 'heavy', 'heavy'],
    terrain: [['woods', 30, 9], ['hills', 16, 6], ['water', 4, 8], ['ruins', 6, 3]],
  },
};

/** Deployment hexes along the middle of a map edge: west, east, north, south. */
function edgeDeployment(side: number, count: number, cols: number, rows: number): HexKey[] {
  const out: HexKey[] = [];
  for (let i = 0; i < count; i++) {
    const depth = i % 2;                 // two ranks deep
    const along = Math.floor(i / 2) - Math.floor(count / 4);
    if (side === 0) out.push(key(1 + depth, Math.floor(rows / 2) + along));
    else if (side === 1) out.push(key(cols - 2 - depth, Math.floor(rows / 2) + along));
    else if (side === 2) out.push(key(Math.floor(cols / 2) + along, 1 + depth));
    else out.push(key(Math.floor(cols / 2) + along, rows - 2 - depth));
  }
  return out;
}

function defaultObjectives(cols: number, rows: number): HexKey[] {
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  const dx = Math.floor(cols / 4);
  const dy = Math.floor(rows / 4);
  return [key(cx, cy), key(cx - dx, cy - dy), key(cx + dx, cy + dy), key(cx + dx, cy - dy), key(cx - dx, cy + dy)];
}

export function deploymentsFor(scenario: Scenario, side: number): HexKey[] {
  return scenario.deployments?.[side] ?? edgeDeployment(side, scenario.roster.length, scenario.cols, scenario.rows);
}

export function objectivesFor(scenario: Scenario): HexKey[] {
  return scenario.objectives ?? defaultObjectives(scenario.cols, scenario.rows);
}

export function generateMap(scenario: Scenario, seed: number, protectedHexes: HexKey[]): GameMap {
  const { cols, rows } = scenario;
  const rng = createRng(seed);
  const terrain: TerrainType[] = new Array(cols * rows).fill('open');
  const set = (hex: HexKey, t: TerrainType) => {
    const [c, r] = hex.split(',').map(Number);
    terrain[r * cols + c] = t;
  };
  for (const [type, seeds, size] of scenario.terrain) {
    for (let i = 0; i < seeds; i++) {
      let frontier = [key(rng.int(cols), rng.int(rows))];
      for (let j = 0; j < size && frontier.length; j++) {
        const h = rng.pick(frontier);
        set(h, type);
        frontier = frontier.concat(neighbors(h, cols, rows));
      }
    }
  }
  // A road from west to east and one from north to south, crossing near the centre.
  for (const h of line(key(0, Math.floor(rows / 2)), key(cols - 1, Math.floor(rows / 2) - 1))) set(h, 'road');
  for (const h of line(key(Math.floor(cols / 2) - 1, 0), key(Math.floor(cols / 2), rows - 1))) set(h, 'road');
  for (const h of protectedHexes) set(h, 'open');
  return { cols, rows, terrain };
}

export interface ScenarioPlayer { id: PlayerId; side: number }

export function createInitialState(scenarioId: string, players: ScenarioPlayer[], seed: number): GameState {
  const scenario = SCENARIOS[scenarioId];
  const objectives = objectivesFor(scenario);
  const deploy = players.flatMap((p) => deploymentsFor(scenario, p.side));
  const map = generateMap(scenario, seed, [...objectives, ...deploy]);
  const units: Unit[] = [];
  let n = 0;
  for (const p of players) {
    const counts: Record<string, number> = {};
    deploymentsFor(scenario, p.side).forEach((hex, i) => {
      const type = scenario.roster[i];
      const ds = PLACEHOLDER_DATASHEETS[type];
      counts[type] = (counts[type] || 0) + 1;
      units.push({
        id: `u${++n}`,
        owner: p.id,
        type,
        name: `${ds.name} ${counts[type]}`,
        hex,
        facing: facingToward(hex, key(Math.floor(scenario.cols / 2), Math.floor(scenario.rows / 2))), // face the centre
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
