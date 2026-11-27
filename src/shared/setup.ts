// Game setup: eras (each with its own terrain, armies and units), map sizes, point limits,
// starting zones, and turn 0, when each player in turn picks an army and places units.
// The eras, armies and numbers here are PLACEHOLDERS until the rules and datasheets are written.
import { key, neighbors, facingToward, distance, inBounds, FACING_ANGLES } from './hex.js';
import { TERRAIN, edgeKey } from './terrain.js';
import { createRng } from './rng.js';
import type { Datasheet, DeployEvent, Facing, GameMap, GameState, HexKey, PlayerId, TerrainType, Unit } from './types.js';

// ---------------------------------------------------------------- eras, armies, units

export interface Army {
  id: string;
  name: string;
  description: string;
  /** Unit types, keyed by id (unique within the era: `${army}.${unit}`). */
  units: Record<string, Datasheet>;
}

export interface Era {
  id: string;
  name: string;
  description: string;
  /**
   * Terrain clusters on a 16×12 map: [type, number of clusters, hexes per cluster], scaled to the map
   * size. Every map also gets a river; marshes grow from it; forest interiors become dense forest.
   */
  terrain: [TerrainType, number, number][];
  armies: Army[];
}

const unitsOf = (army: string, list: (Omit<Datasheet, 'name'> & { id: string; name: string })[]) =>
  Object.fromEntries(list.map(({ id, ...ds }) => [`${army}.${id}`, ds]));

export const ERAS: Record<string, Era> = {
  napoleonic: {
    id: 'napoleonic',
    name: 'Napoleonic Wars',
    description: 'Line infantry, skirmishers and cavalry among villages, forests, marshes and rolling hills, with a river to cross.',
    terrain: [['light_forest', 4, 10], ['hills', 4, 5], ['village', 3, 2], ['ruins', 1, 2], ['marsh', 2, 4], ['water', 1, 4]],
    armies: [
      { id: 'french', name: 'French Empire', description: 'Fast cavalry and the formidable Old Guard.', units: unitsOf('french', [
        { id: 'line', name: 'Line Infantry', code: 'L', points: 20, move: 3, sight: 5, strength: 4, climb: 1, morale: 3, rally: 0, fire: 3, range: 2 },
        { id: 'voltigeurs', name: 'Voltigeurs', code: 'V', points: 15, move: 5, sight: 7, strength: 2, climb: 2, morale: 2, rally: 0, fire: 3, range: 3 },
        { id: 'hussars', name: 'Hussars', code: 'H', points: 25, move: 7, sight: 6, strength: 3, climb: 1, morale: 3, rally: 0, fire: 0, range: 0 },
        { id: 'guard', name: 'Old Guard', code: 'G', points: 40, move: 3, sight: 5, strength: 6, climb: 1, morale: 5, rally: 1, fire: 4, range: 2 },
      ]) },
      { id: 'british', name: 'British Army', description: 'Steady redcoats and sharpshooting riflemen.', units: unitsOf('british', [
        { id: 'line', name: 'Redcoats', code: 'L', points: 20, move: 3, sight: 5, strength: 4, climb: 1, morale: 3, rally: 0, fire: 4, range: 2 },
        { id: 'rifles', name: '95th Rifles', code: 'R', points: 15, move: 5, sight: 7, strength: 2, climb: 2, morale: 2, rally: 0, fire: 4, range: 4 },
        { id: 'dragoons', name: 'Light Dragoons', code: 'D', points: 25, move: 7, sight: 6, strength: 3, climb: 1, morale: 3, rally: 0, fire: 0, range: 0 },
        { id: 'guards', name: 'Foot Guards', code: 'G', points: 40, move: 3, sight: 5, strength: 6, climb: 1, morale: 5, rally: 1, fire: 4, range: 2 },
      ]) },
      { id: 'austrian', name: 'Austrian Empire', description: 'Solid infantry, Grenzer skirmishers and heavy cuirassiers.', units: unitsOf('austrian', [
        { id: 'line', name: 'Line Infantry', code: 'L', points: 20, move: 3, sight: 5, strength: 4, climb: 1, morale: 3, rally: 0, fire: 3, range: 2 },
        { id: 'grenzer', name: 'Grenzers', code: 'Z', points: 15, move: 5, sight: 7, strength: 2, climb: 2, morale: 2, rally: 0, fire: 3, range: 3 },
        { id: 'cuirassiers', name: 'Cuirassiers', code: 'C', points: 30, move: 6, sight: 6, strength: 4, climb: 1, morale: 4, rally: 0, fire: 0, range: 0 },
        { id: 'grenadiers', name: 'Grenadiers', code: 'G', points: 35, move: 3, sight: 5, strength: 5, climb: 1, morale: 4, rally: 1, fire: 3, range: 2 },
      ]) },
      { id: 'prussian', name: 'Prussian Army', description: 'Landwehr in numbers, Jäger and hussars.', units: unitsOf('prussian', [
        { id: 'landwehr', name: 'Landwehr', code: 'W', points: 15, move: 3, sight: 5, strength: 3, climb: 1, morale: 2, rally: 0, fire: 2, range: 2 },
        { id: 'jager', name: 'Jäger', code: 'J', points: 15, move: 5, sight: 7, strength: 2, climb: 2, morale: 2, rally: 0, fire: 4, range: 3 },
        { id: 'hussars', name: 'Black Hussars', code: 'H', points: 25, move: 7, sight: 6, strength: 3, climb: 1, morale: 3, rally: 0, fire: 0, range: 0 },
        { id: 'guard', name: 'Guard Infantry', code: 'G', points: 40, move: 3, sight: 5, strength: 6, climb: 1, morale: 5, rally: 1, fire: 4, range: 2 },
      ]) },
    ],
  },
  ww2: {
    id: 'ww2',
    name: 'Second World War',
    description: 'Infantry, recon and armour fighting over forests, hills, marshes and ruined towns, with a river to cross.',
    terrain: [['light_forest', 5, 10], ['hills', 3, 4], ['ruins', 3, 3], ['marsh', 2, 4], ['water', 1, 4]],
    armies: [
      { id: 'us', name: 'US Infantry Division', description: 'Rifle squads backed by Shermans and paratroopers.', units: unitsOf('us', [
        { id: 'rifles', name: 'Rifle Squad', code: 'R', points: 20, move: 4, sight: 5, strength: 4, climb: 1, morale: 3, rally: 0, fire: 3, range: 3 },
        { id: 'recon', name: 'Recon Patrol', code: 'P', points: 15, move: 6, sight: 7, strength: 2, climb: 2, morale: 2, rally: 0, fire: 2, range: 3 },
        { id: 'sherman', name: 'Sherman', code: 'T', points: 45, move: 6, sight: 4, strength: 6, climb: 1, morale: 4, rally: 0, fire: 5, range: 5 },
        { id: 'airborne', name: 'Paratroopers', code: 'A', points: 30, move: 4, sight: 6, strength: 4, climb: 2, morale: 4, rally: 1, fire: 3, range: 3 },
      ]) },
      { id: 'german', name: 'German Panzergrenadiers', description: 'Grenadiers with heavy armour and mountain troops.', units: unitsOf('german', [
        { id: 'grenadiers', name: 'Grenadiers', code: 'G', points: 20, move: 4, sight: 5, strength: 4, climb: 1, morale: 3, rally: 0, fire: 3, range: 3 },
        { id: 'scouts', name: 'Scouts', code: 'S', points: 15, move: 6, sight: 7, strength: 2, climb: 2, morale: 2, rally: 0, fire: 2, range: 3 },
        { id: 'panzer', name: 'Panzer IV', code: 'P', points: 50, move: 5, sight: 4, strength: 7, climb: 1, morale: 4, rally: 0, fire: 6, range: 5 },
        { id: 'gebirgs', name: 'Gebirgsjäger', code: 'J', points: 30, move: 4, sight: 6, strength: 4, climb: 2, morale: 4, rally: 1, fire: 3, range: 3 },
      ]) },
      { id: 'british', name: 'British Infantry Division', description: 'Rifle sections, Bren carriers, Churchills and commandos.', units: unitsOf('british', [
        { id: 'riflemen', name: 'Rifle Section', code: 'R', points: 20, move: 4, sight: 5, strength: 4, climb: 1, morale: 3, rally: 0, fire: 3, range: 3 },
        { id: 'carrier', name: 'Bren Carrier', code: 'C', points: 20, move: 6, sight: 6, strength: 3, climb: 1, morale: 2, rally: 0, fire: 3, range: 3 },
        { id: 'churchill', name: 'Churchill', code: 'T', points: 45, move: 4, sight: 4, strength: 7, climb: 1, morale: 4, rally: 0, fire: 5, range: 4 },
        { id: 'commandos', name: 'Commandos', code: 'K', points: 30, move: 4, sight: 6, strength: 4, climb: 2, morale: 4, rally: 1, fire: 3, range: 3 },
      ]) },
      { id: 'soviet', name: 'Soviet Rifle Division', description: 'Masses of riflemen with T-34s.', units: unitsOf('soviet', [
        { id: 'riflemen', name: 'Rifle Squad', code: 'R', points: 15, move: 4, sight: 5, strength: 3, climb: 1, morale: 2, rally: 0, fire: 2, range: 3 },
        { id: 'scouts', name: 'Razvedchiki', code: 'S', points: 15, move: 6, sight: 7, strength: 2, climb: 2, morale: 2, rally: 0, fire: 2, range: 3 },
        { id: 't34', name: 'T-34', code: 'T', points: 45, move: 6, sight: 4, strength: 6, climb: 1, morale: 4, rally: 0, fire: 5, range: 5 },
        { id: 'guards', name: 'Guards Rifles', code: 'G', points: 25, move: 4, sight: 5, strength: 4, climb: 1, morale: 4, rally: 1, fire: 3, range: 3 },
      ]) },
    ],
  },
};

/** The most players an era allows: each player needs an army of their own. */
export const maxPlayers = (era: Era) => Math.min(MAX_PLAYERS, era.armies.length);

/** Every unit type in an era, keyed by its unique id. */
export const eraDatasheets = (era: Era): Record<string, Datasheet> => Object.assign({}, ...era.armies.map((a) => a.units));

export const armyOf = (era: Era, unitType: string): Army | undefined => era.armies.find((a) => unitType in a.units);

// ---------------------------------------------------------------- map sizes and point limits

export interface MapSize {
  id: string;
  name: string;
  cols: number;
  rows: number;
  turnLimit: number;
  /** How many hexes deep each starting zone is. */
  zoneDepth: number;
  objectives: number;
}

export const MAP_SIZES: Record<string, MapSize> = {
  small: { id: 'small', name: 'Small', cols: 16, rows: 12, turnLimit: 10, zoneDepth: 2, objectives: 3 },
  medium: { id: 'medium', name: 'Medium', cols: 24, rows: 18, turnLimit: 12, zoneDepth: 3, objectives: 5 },
  large: { id: 'large', name: 'Large', cols: 40, rows: 30, turnLimit: 12, zoneDepth: 3, objectives: 5 },
};

export const POINT_LIMITS = [100, 150, 200, 300];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

// ---------------------------------------------------------------- starting zones

/**
 * The hexes a player may deploy in, by their place in the turn order: the west edge, the east
 * edge, then the north and south edges (kept clear of the west and east zones).
 */
export function startingZone(size: MapSize, side: number): HexKey[] {
  const { cols, rows, zoneDepth: d } = size;
  const out: HexKey[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inside =
        side === 0 ? c < d :
        side === 1 ? c >= cols - d :
        side === 2 ? r < d && c > d && c < cols - d - 1 :
        r >= rows - d && c > d && c < cols - d - 1;
      if (inside) out.push(key(c, r));
    }
  }
  return out;
}

function objectiveHexes(size: MapSize): HexKey[] {
  const cx = Math.floor(size.cols / 2);
  const cy = Math.floor(size.rows / 2);
  const dx = Math.floor(size.cols / 4);
  const dy = Math.floor(size.rows / 4);
  return [key(cx, cy), key(cx - dx, cy - dy), key(cx + dx, cy + dy), key(cx + dx, cy - dy), key(cx - dx, cy + dy)].slice(0, size.objectives);
}

const centre = (size: MapSize) => key(Math.floor(size.cols / 2), Math.floor(size.rows / 2));

// ---------------------------------------------------------------- map generation

export function generateMap(era: Era, size: MapSize, seed: number, protectedHexes: HexKey[]): GameMap {
  const { cols, rows } = size;
  const rng = createRng(seed);
  const terrain: TerrainType[] = new Array(cols * rows).fill('open');
  const set = (hex: HexKey, t: TerrainType) => {
    const [c, r] = hex.split(',').map(Number);
    terrain[r * cols + c] = t;
  };
  const at = (hex: HexKey) => { const [c, r] = hex.split(',').map(Number); return terrain[r * cols + c]; };
  const inMap = (h: HexKey) => inBounds(h, cols, rows);
  const scale = (cols * rows) / (16 * 12);

  // ---- rivers: meandering lines along hex edges, with branching tributaries
  const rivers = riverNetwork(cols, rows, rng, Math.max(1, Math.round(scale * 0.7)));
  const riverside = [...new Set(rivers.flatMap((k) => k.split('|')))];

  // ---- terrain clusters (marshes grow beside the rivers)
  for (const [type, clusters, hexes] of era.terrain) {
    for (let i = 0; i < Math.max(1, Math.round(clusters * scale)); i++) {
      let frontier = [type === 'marsh' && riverside.length ? rng.pick(riverside) : key(rng.int(cols), rng.int(rows))];
      for (let j = 0; j < hexes && frontier.length; j++) {
        const h = rng.pick(frontier);
        set(h, type);
        frontier = frontier.concat(neighbors(h, cols, rows));
      }
    }
  }
  // The heart of a forest (a forest hex surrounded by forest) is dense.
  const forest = (t: TerrainType) => t === 'light_forest' || t === 'dense_forest';
  const hearts: HexKey[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = key(c, r);
      if (at(h) === 'light_forest' && neighbors(h, cols, rows).every((n) => forest(at(n)))) hearts.push(h);
    }
  }
  for (const h of hearts) set(h, 'dense_forest');
  // Nobody should start in a lake or have an objective in one.
  for (const h of protectedHexes) if (TERRAIN[at(h)].impassable) set(h, 'open');

  // ---- roads: meandering lines from hex centre to hex centre, branching to villages and ruins
  const roads = new Set<string>();
  const onRoad: HexKey[] = [];
  /** Wander from `from` towards `to`, avoiding lakes; returns the hexes visited. */
  const wander = (from: HexKey, to: HexKey, maxSteps: number): HexKey[] => {
    const path = [from];
    let cur = from;
    for (let i = 0; i < maxSteps && cur !== to; i++) {
      const options = neighbors(cur, cols, rows).filter((n) => !TERRAIN[at(n)].impassable && !path.includes(n));
      if (!options.length) break;
      // One random draw per option, then sort: never draw inside a sort comparator, or the number of
      // draws depends on the JavaScript engine's sort and different browsers would build different maps.
      const scored = options.map((n) => ({ n, score: distance(n, to) + rng.next() * 1.6 }));
      scored.sort((x, y) => x.score - y.score || x.n.localeCompare(y.n));
      cur = scored[0].n;
      path.push(cur);
    }
    return path;
  };
  const lay = (path: HexKey[]) => {
    for (let i = 1; i < path.length; i++) roads.add(edgeKey(path[i - 1], path[i]));
    for (const h of path) if (!onRoad.includes(h)) onRoad.push(h);
  };
  const passableOnEdge = (pick: () => HexKey) => { for (let i = 0; i < 20; i++) { const h = pick(); if (!TERRAIN[at(h)].impassable) return h; } return pick(); };
  const mid = (n: number) => Math.floor(n / 4) + rng.int(Math.max(1, Math.floor(n / 2)));
  lay(wander(passableOnEdge(() => key(0, mid(rows))), passableOnEdge(() => key(cols - 1, mid(rows))), cols * 3));
  lay(wander(passableOnEdge(() => key(mid(cols), 0)), passableOnEdge(() => key(mid(cols), rows - 1)), rows * 3));
  // Branches: from somewhere on the network to a village, ruins, or a point on the map.
  const destinations = terrain.map((t, i) => [t, key(i % cols, Math.floor(i / cols))] as const)
    .filter(([t]) => t === 'village' || t === 'ruins').map(([, h]) => h);
  for (let i = 0; i < Math.max(2, Math.round(scale * 2)); i++) {
    const to = destinations.length && rng.int(3) ? rng.pick(destinations) : key(rng.int(cols), rng.int(rows));
    const from = [...onRoad].sort((x, y) => distance(x, to) - distance(y, to))[0];
    if (from && from !== to && !TERRAIN[at(to)].impassable) lay(wander(from, to, Math.max(cols, rows)));
  }

  // Elevation (PLACEHOLDER shape): a few rises, each sloping down one level every two hexes, so
  // neighbouring hexes mostly differ by at most 1. Hills sit one level above the ground around
  // them, which makes the occasional two-level drop: a cliff for most units.
  const elevation = new Array<number>(cols * rows).fill(0);
  const rises = Math.max(2, Math.round((cols * rows) / 60));
  const peaks = Array.from({ length: rises }, () => ({ hex: key(rng.int(cols), rng.int(rows)), height: 2 + rng.int(2) }));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = key(c, r);
      const i = r * cols + c;
      const base = Math.max(0, ...peaks.map((p) => p.height - Math.floor(distance(h, p.hex) / 2)));
      elevation[i] = terrain[i] === 'water' ? 0 : base + (terrain[i] === 'hills' ? 1 : 0);
    }
  }
  void inMap;
  return { cols, rows, terrain, elevation, roads: [...roads].sort(), rivers };
}

// ---------------------------------------------------------------- rivers along hex edges

/**
 * A river from the north edge to the south edge, meandering along hex edges, plus `branches`
 * tributaries that wander east or west from it. Walks the graph of hex corners: each step follows
 * one hex edge. Returns the edges as "a|b" keys of the two hexes they separate (edges on the map's
 * border, with a hex on one side only, are left out).
 */
function riverNetwork(cols: number, rows: number, rng: ReturnType<typeof createRng>, branches: number): string[] {
  // Corners sit on a whole-number grid: a hex at (col, row) has its centre at X = 2·col + (row odd),
  // Y = 3·row, and its corners at these offsets (pointy-top, clockwise from the top-right).
  // Integers keep the river exactly the same in every browser (no floating-point trigonometry).
  // x and y are the true positions (hex radius 1), used to steer the walk.
  type Corner = { x: number; y: number; links: { to: string; hexes: HexKey[] }[] };
  const OFFSETS: Record<number, [number, number]> = { [-90]: [0, -2], [-30]: [1, -1], 30: [1, 1], 90: [0, 2], 150: [-1, 1], 210: [-1, -1] };
  const corners = new Map<string, Corner>();
  const cornerOf = (hex: HexKey, deg: number) => {
    const { col, row } = { col: Number(hex.split(',')[0]), row: Number(hex.split(',')[1]) };
    const [dx, dy] = OFFSETS[((deg + 90) % 360 + 360) % 360 - 90];
    const X = 2 * col + (row & 1) + dx;
    const Y = 3 * row + dy;
    const k = `${X},${Y}`;
    if (!corners.has(k)) corners.set(k, { x: (X * Math.sqrt(3)) / 2, y: Y / 2, links: [] });
    return k;
  };
  const seen = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = key(c, r);
      neighbors(h).forEach((n, dir) => {
        const c1 = cornerOf(h, FACING_ANGLES[dir] - 30);
        const c2 = cornerOf(h, FACING_ANGLES[dir] + 30);
        const edge = [c1, c2].sort().join('~');
        const hexes = inBounds(n, cols, rows) ? [h, n] : [h];
        if (seen.has(edge)) {
          // Second time from the other side: the edge already links the corners.
          return;
        }
        seen.add(edge);
        corners.get(c1)!.links.push({ to: c2, hexes });
        corners.get(c2)!.links.push({ to: c1, hexes });
      });
    }
  }
  const all = [...corners.values()];
  const maxY = Math.max(...all.map((c) => c.y));
  const minX = Math.min(...all.map((c) => c.x));
  const maxX = Math.max(...all.map((c) => c.x));
  const edges = new Set<string>();
  const visited = new Set<string>();

  /** Walk from a corner, scoring each step by `pull`, until `done` or stuck. Returns the corners. */
  const walk = (start: string, pull: (from: Corner, to: Corner) => number, done: (c: Corner) => boolean, maxSteps: number) => {
    const path = [start];
    visited.add(start);
    let cur = start;
    for (let i = 0; i < maxSteps && !done(corners.get(cur)!); i++) {
      const here = corners.get(cur)!;
      const options = here.links.filter((l) => l.hexes.length === 2 && !visited.has(l.to));
      if (!options.length) break;
      const best = options.map((l) => ({ l, score: pull(here, corners.get(l.to)!) + rng.next() * 1.2 }))
        .sort((a, b) => b.score - a.score || a.l.to.localeCompare(b.l.to))[0].l;
      edges.add(edgeKey(best.hexes[0], best.hexes[1]));
      cur = best.to;
      visited.add(cur);
      path.push(cur);
    }
    return path;
  };

  // The main river: from a corner on the north edge, in the middle half, heading south.
  // Start between two hexes of the top row (where an edge leads into the map), in the middle half.
  const minY = Math.min(...all.map((x) => x.y));
  const tops = all.filter((c) => c.y < minY + 0.6 && c.links.some((l) => l.hexes.length === 2)
    && c.x > minX + (maxX - minX) / 4 && c.x < maxX - (maxX - minX) / 4);
  const startTop = rng.pick(tops.length ? tops : all);
  const startKey = [...corners.entries()].find(([, c]) => c === startTop)![0];
  // A gentle sideways drift that changes now and then makes the river meander.
  let drift = rng.next() - 0.5;
  const main = walk(startKey, (from, to) => {
    if (rng.next() < 0.15) drift = rng.next() - 0.5;
    return (to.y - from.y) * 1.2 + (to.x - from.x) * drift;
  }, (c) => c.y >= maxY - 1.6, rows * 6);

  // Tributaries: from a point along the main river, wandering east or west.
  for (let i = 0; i < branches && main.length > 6; i++) {
    const from = main[Math.floor(main.length / 4) + rng.int(Math.max(1, Math.floor(main.length / 2)))];
    const east = rng.int(2) === 1;
    walk(from, (a, b) => (b.x - a.x) * (east ? 1 : -1) + (b.y - a.y) * (rng.next() - 0.5), (c) => c.x <= minX + 1 || c.x >= maxX - 1, cols * 2);
  }
  return [...edges].sort();
}

// ---------------------------------------------------------------- the game at turn 0

export interface SetupPlayer { id: PlayerId; side: number }

/** A new game at turn 0: map and objectives, no units yet; player 1 deploys first. */
export function createSetupState(eraId: string, sizeId: string, pointLimit: number, players: SetupPlayer[], seed: number): GameState {
  const era = ERAS[eraId];
  const size = MAP_SIZES[sizeId];
  if (!era) throw new Error(`Unknown era ${eraId}`);
  if (!size) throw new Error(`Unknown map size ${sizeId}`);
  const objectives = objectiveHexes(size);
  const zones = players.flatMap((p) => startingZone(size, p.side));
  return {
    era: eraId,
    size: sizeId,
    pointLimit,
    phase: 'deploy',
    armies: Object.fromEntries(players.map((p) => [p.id, null])),
    seed,
    turn: 0,
    current: 0,
    turnLimit: size.turnLimit,
    map: generateMap(era, size, seed, [...objectives, ...zones]),
    datasheets: eraDatasheets(era),
    players: players.map((p) => ({ id: p.id, side: p.side })),
    units: [],
    objectives,
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    finished: false,
    result: null,
  };
}

// ---------------------------------------------------------------- turn 0: deployment

export interface Placement {
  type: string;
  hex: HexKey;
  facing?: Facing;
}

export interface Deployment {
  army: string;
  units: Placement[];
}

export const zoneOf = (state: GameState, playerId: PlayerId): HexKey[] => {
  const p = state.players.find((x) => x.id === playerId);
  return p ? startingZone(MAP_SIZES[state.size], p.side) : [];
};

export const deploymentCost = (state: GameState, d: Pick<Deployment, 'units'>) =>
  d.units.reduce((n, u) => n + (state.datasheets[u.type]?.points ?? 0), 0);

/** Check a player's deployment. Input is untrusted. */
export function validateDeployment(state: GameState, playerId: PlayerId, input: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const era = ERAS[state.era];
  const d = input as Partial<Deployment> | null;
  const army = era.armies.find((a) => a.id === d?.army);
  if (state.phase !== 'deploy') errors.push('The battle has already begun.');
  if (!army) return { ok: false, errors: [...errors, 'Choose one of this era\'s armies.'] };
  if (Object.entries(state.armies).some(([p, a]) => p !== playerId && a === army.id)) errors.push(`The ${army.name} has already been chosen by another player.`);
  const units = Array.isArray(d?.units) ? d!.units : [];
  if (!units.length) errors.push('Place at least one unit.');
  const zone = new Set(zoneOf(state, playerId));
  const taken = new Set(state.units.filter((u) => u.strength > 0).map((u) => u.hex));
  for (const u of units) {
    const ds = army.units[u?.type];
    if (!ds) { errors.push(`${u?.type}: not a unit of the ${army.name}.`); continue; }
    if (!zone.has(u.hex)) errors.push(`${ds.name}: must be placed in your starting zone.`);
    else if (TERRAIN[state.map.terrain[hexIndex(state, u.hex)]].impassable) errors.push(`${ds.name}: can't be placed in water.`);
    if (taken.has(u.hex)) errors.push(`${ds.name}: that hex is already taken.`);
    taken.add(u.hex);
  }
  const cost = deploymentCost(state, { units: units.filter((u) => army.units[u?.type]) });
  if (cost > state.pointLimit) errors.push(`The army costs ${cost} points; the limit is ${state.pointLimit}.`);
  return { ok: errors.length === 0, errors };
}

const hexIndex = (state: GameState, hex: HexKey) => { const [c, r] = hex.split(',').map(Number); return r * state.map.cols + c; };

/**
 * The current player's turn 0: add their units. After the last player deploys, round 1 begins
 * with the first player in turn order.
 */
export function resolveDeployment(prev: GameState, d: Deployment): { state: GameState; events: DeployEvent[] } {
  const state = structuredClone(prev);
  const me = state.players[state.current].id;
  const check = validateDeployment(state, me, d);
  if (!check.ok) throw new Error(check.errors.join(' '));
  let n = state.units.length;
  const counts: Record<string, number> = {};
  const toward = centre(MAP_SIZES[state.size]);
  for (const p of d.units) {
    const ds = state.datasheets[p.type];
    counts[p.type] = (counts[p.type] || 0) + 1;
    const unit: Unit = {
      id: `u${++n}`,
      owner: me,
      type: p.type,
      name: `${ds.name} ${counts[p.type]}`,
      hex: p.hex,
      facing: p.facing ?? facingToward(p.hex, toward),
      strength: ds.strength,
    };
    state.units.push(unit);
  }
  state.armies[me] = d.army;
  const event: DeployEvent = { type: 'deploy', player: me, army: d.army, units: d.units.length, points: deploymentCost(state, d) };
  if (state.current + 1 < state.players.length) state.current += 1;
  else {
    state.phase = 'battle';
    state.turn = 1;
    state.current = 0;
  }
  return { state, events: [event] };
}
