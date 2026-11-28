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

// ---------------------------------------------------------------- scenarios (#37)

export interface Scenario {
  id: string;
  name: string;
  /** One line for the setup screen and the rules. */
  description: string;
  /** Where the objectives come from: chosen number in the middle, one at the centre, none, or a flag per player. */
  objectives: 'choose' | 'centre' | 'none' | 'flags';
}

/** King of the Hill: the first player to this many points wins at once. */
export const HILL_TARGET = 5;
/** Capture the Flags: points for each enemy flag held at the end of your turn. */
export const FLAG_POINTS = 2;

export const SCENARIOS: Record<string, Scenario> = {
  hold: { id: 'hold', name: 'Hold the Field', objectives: 'choose',
    description: 'Objectives in the middle of the map. At the end of your turn, score 1 for each objective you hold.' },
  hill: { id: 'hill', name: 'King of the Hill', objectives: 'centre',
    description: `One objective at the centre. Score 1 at the end of each of your turns you hold it: the first to ${HILL_TARGET} wins at once.` },
  annihilation: { id: 'annihilation', name: 'Annihilation', objectives: 'none',
    description: 'No objectives. Score the point value of every enemy unit you destroy, or that breaks and disbands.' },
  flags: { id: 'flags', name: 'Capture the Flags', objectives: 'flags',
    description: `Each player has a flag in front of their starting zone. At the end of your turn, score ${FLAG_POINTS} for each enemy flag you hold.` },
  decisive: { id: 'decisive', name: 'Decisive Ground', objectives: 'choose',
    description: 'Objectives in the middle of the map, but no running score: when the battle ends, each player scores 1 for each objective they hold.' },
};
export const DEFAULT_SCENARIO = 'hold';
export const ROUND_OPTIONS = [6, 8, 10, 12, 15];
export const OBJECTIVE_OPTIONS = [1, 3, 5];

/** Capture the Flags: each player's flag, a little in front of the middle of their starting zone. */
export function flagHex(size: MapSize, side: number): HexKey {
  const { cols, rows, zoneDepth: d } = size;
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  return side === 0 ? key(d + 1, cy) : side === 1 ? key(cols - d - 2, cy) : side === 2 ? key(cx, d + 1) : key(cx, rows - d - 2);
}

function objectiveHexes(size: MapSize, count = size.objectives): HexKey[] {
  const cx = Math.floor(size.cols / 2);
  const cy = Math.floor(size.rows / 2);
  const dx = Math.floor(size.cols / 4);
  const dy = Math.floor(size.rows / 4);
  return [key(cx, cy), key(cx - dx, cy - dy), key(cx + dx, cy + dy), key(cx + dx, cy - dy), key(cx - dx, cy + dy)].slice(0, count);
}

const centre = (size: MapSize) => key(Math.floor(size.cols / 2), Math.floor(size.rows / 2));

// ---------------------------------------------------------------- map generation

export function generateMap(era: Era, size: MapSize, seed: number, protectedHexes: HexKey[]): GameMap {
  return buildMap(era, size, seed, protectedHexes).map;
}

/** The map, and each river's stretches from source to mouth (for tests). */
export function buildMap(era: Era, size: MapSize, seed: number, protectedHexes: HexKey[]): { map: GameMap; courses: [HexKey, HexKey][][] } {
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

  // ---- the lie of the land (PLACEHOLDER shape), worked out first so the river can follow it: a few
  // rises, each sloping down one level every two hexes, so neighbouring hexes mostly differ by at most 1.
  const rises = Math.max(2, Math.round((cols * rows) / 60));
  const peaks = Array.from({ length: rises }, () => ({ hex: key(rng.int(cols), rng.int(rows)), height: 2 + rng.int(2) }));
  const ground = (h: HexKey) => Math.max(0, ...peaks.map((p) => p.height - Math.floor(distance(h, p.hex) / 2)));

  // ---- rivers: one river crosses the map along hex edges, downhill or level, and now and then a
  // tributary joins it (#59): rarely on a small map, at most once on any map.
  const { edges: rivers, courses } = riverNetwork(cols, rows, rng, rng.next() < Math.min(0.5, 0.15 * scale) ? 1 : 0, ground);
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
  /** The hexes the roads laid so far run to from `h`. */
  const linked = (h: HexKey) => neighbors(h, cols, rows).filter((n) => roads.has(edgeKey(h, n)));
  /**
   * No sharp turns (#57): a road never leaves a hex through a face next to the one it came in by, so it
   * goes straight on or bends by one face. That holds where one road ends and another begins too: a hex
   * with exactly two segments is a bend and must not be sharp. (Three or more make a junction, where
   * roads may meet at any angle.)
   */
  const sharp = (ends: HexKey[]) => ends.length === 2 && distance(ends[0], ends[1]) === 1;
  const fine = (cur: HexKey, n: HexKey, prev: HexKey | undefined) =>
    !sharp([...new Set([...linked(cur), ...(prev ? [prev] : []), n])]) && !sharp([...new Set([...linked(n), cur])]);
  /**
   * Find a way from `from` to `to`, avoiding lakes and sharp turns; returns the hexes visited. A road
   * never moves away from where it's going, so it can't loop back on itself, and it keeps straight on
   * unless a turn gets it there sooner, so turns are few (#57). A branch (`join` false) doesn't run
   * into another road on the way.
   */
  const wander = (from: HexKey, to: HexKey, maxSteps: number, join: boolean): HexKey[] => {
    const path = [from];
    const dead = new Set<HexKey>(); // hexes that led nowhere: back out of them and don't go back
    let cur = from;
    for (let i = 0; i < maxSteps && cur !== to; i++) {
      const prev = path.length > 1 ? path[path.length - 2] : undefined;
      // Straight on is the neighbour opposite the one the road came in from (neighbors() lists the six
      // directions in order round the hex, so the opposite one is three along).
      const ahead = prev ? neighbors(cur)[(neighbors(cur).indexOf(prev) + 3) % 6] : undefined;
      const options = neighbors(cur, cols, rows).filter((n) => !TERRAIN[at(n)].impassable && !path.includes(n) && !dead.has(n) && fine(cur, n, prev)
        && distance(n, to) <= distance(cur, to) && (join || n === to || !onRoad.includes(n)));
      if (!options.length) {
        if (path.length === 1) break;
        dead.add(path.pop()!);
        cur = path[path.length - 1];
        continue;
      }
      // One random draw per option, then sort: never draw inside a sort comparator, or the number of
      // draws depends on the JavaScript engine's sort and different browsers would build different maps.
      const scored = options.map((n) => ({
        n,
        score: distance(n, to) * 2 + (prev && n !== ahead ? 0.9 : 0) + rng.next() * 1.4,
      }));
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
  // A road that can't find a fairly direct way to where it's going is left out, rather than coiling
  // round (#57): it must get there in at most twice the straight distance, plus a little.
  const roadTo = (from: HexKey, to: HexKey, steps: number, join = false) => {
    const p = wander(from, to, steps, join);
    const ok = p[p.length - 1] === to && p.length - 1 <= distance(from, to) * 2 + 3;
    if (ok) lay(p);
    return ok;
  };
  // The two main roads: west to east and north to south, each tried from a few places until one gets through.
  for (let tries = 0; tries < 6 && !roadTo(passableOnEdge(() => key(0, mid(rows))), passableOnEdge(() => key(cols - 1, mid(rows))), cols * 3); tries++);
  for (let tries = 0; tries < 6 && !roadTo(passableOnEdge(() => key(mid(cols), 0)), passableOnEdge(() => key(mid(cols), rows - 1)), rows * 3, true); tries++);
  // Branches: from somewhere on the network to a village, ruins, or a point on the map.
  const destinations = terrain.map((t, i) => [t, key(i % cols, Math.floor(i / cols))] as const)
    .filter(([t]) => t === 'village' || t === 'ruins').map(([, h]) => h);
  for (let i = 0; i < Math.max(2, Math.round(scale * 2)); i++) {
    const to = destinations.length && rng.int(3) ? rng.pick(destinations) : key(rng.int(cols), rng.int(rows));
    const from = [...onRoad].sort((x, y) => distance(x, to) - distance(y, to))[0];
    if (from && from !== to && !TERRAIN[at(to)].impassable) roadTo(from, to, Math.max(cols, rows) * 2);
  }

  // Elevation: the lie of the land, with hills one level above the ground around them (which makes the
  // occasional two-level drop: a cliff for most units). Lakes are at 0.
  const elevation = new Array<number>(cols * rows).fill(0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      elevation[i] = terrain[i] === 'water' ? 0 : ground(key(c, r)) + (terrain[i] === 'hills' ? 1 : 0);
    }
  }
  // Rivers never flow uphill (#59). A stretch of river lies at the height of its lower bank (lakes aside);
  // going downstream that never rises. Where a hill beside it would make it rise, the river cuts its
  // bed: the lower bank comes down to the river's level. Repeat until nothing changes.
  const idx = (h: HexKey) => { const [c, r] = h.split(',').map(Number); return r * cols + c; };
  for (let changed = true; changed;) {
    changed = false;
    for (const course of courses) {
      let level = Infinity;
      for (const [a, b] of course) {
        const banks = [a, b].filter((h) => terrain[idx(h)] !== 'water');
        if (!banks.length) continue;
        const low = banks.reduce((x, y) => (elevation[idx(y)] < elevation[idx(x)] ? y : x));
        if (elevation[idx(low)] > level) { elevation[idx(low)] = level; changed = true; }
        level = Math.min(level, elevation[idx(low)]);
      }
    }
  }
  void inMap;
  return { map: { cols, rows, terrain, elevation, roads: [...roads].sort(), rivers }, courses };
}

// ---------------------------------------------------------------- rivers along hex edges

/**
 * A river from the north edge to the south edge, meandering along hex edges, plus `branches`
 * tributaries that wander east or west from it. Walks the graph of hex corners: each step follows
 * one hex edge. Returns the edges as "a|b" keys of the two hexes they separate (edges on the map's
 * border, with a hex on one side only, are left out).
 */
function riverNetwork(cols: number, rows: number, rng: ReturnType<typeof createRng>, branches: number, ground: (h: HexKey) => number):
  { edges: string[]; courses: [HexKey, HexKey][][] } {
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
  const courses: [HexKey, HexKey][][] = []; // each river's stretches, from source to mouth
  const level = (hexes: HexKey[]) => Math.min(...hexes.map(ground)); // a stretch lies at its lower bank

  // Headings every 15°, measured from due south (+y) towards east (+x), from -120° to +120°. A table
  // rather than Math.sin/cos, so every browser computes exactly the same river.
  const SIN = [0, 0.258819, 0.5, 0.707107, 0.866025, 0.965926, 1, 0.965926, 0.866025];
  const COS = [1, 0.965926, 0.866025, 0.707107, 0.5, 0.258819, 0, -0.258819, -0.5];
  const heading = (i: number) => ({ x: Math.sign(i) * SIN[Math.abs(i)], y: COS[Math.abs(i)] });

  /**
   * Follow a heading from a corner (#59). The river keeps to a straight course line, taking the edge
   * that makes most progress along it while staying closest to it, so it zigzags only as hex edges
   * must. Now and then it bends by 15° (within `lo`..`hi`) and starts a new course line from where it
   * is. It never doubles back: where it can't go on, it stops, and a branch shorter than `minSteps`
   * edges is left out. `flip` turns every heading round (north instead of south). Going `downhill`
   * (the main river, from its source) it never takes a stretch higher than the last while it has a
   * choice, and generateMap cuts its bed where it has none; going uphill (a tributary, traced from
   * where it joins), it never takes a lower stretch and stops instead. Returns the corners visited.
   */
  const follow = (start: string, dir: number, lo: number, hi: number, flip: boolean, downhill: boolean,
    done: (c: Corner) => boolean, maxSteps: number, minSteps = 0) => {
    const path = [start];
    const laid: [HexKey, HexKey][] = [];
    let cur = start;
    let origin = corners.get(start)!;
    let height = downhill ? Infinity : -Infinity;
    for (let i = 0; i < maxSteps && !done(corners.get(cur)!); i++) {
      if (rng.next() < 0.07) {
        dir = Math.max(lo, Math.min(hi, dir + (rng.int(2) ? 1 : -1)));
        origin = corners.get(cur)!;
      }
      const h0 = heading(dir);
      const h = flip ? { x: -h0.x, y: -h0.y } : h0;
      const here = corners.get(cur)!;
      // Keep clear of rivers already drawn: never run along a corner they touch (except where this one starts).
      const options = here.links.filter((l) => l.hexes.length === 2 && !visited.has(l.to) && !path.includes(l.to)
        && !corners.get(l.to)!.links.some((m) => m.to !== cur && visited.has(m.to) && m.to !== start)).map((l) => {
        const to = corners.get(l.to)!;
        const ahead = (to.x - here.x) * h.x + (to.y - here.y) * h.y; // progress along the heading
        const aside = Math.abs((to.x - origin.x) * h.y - (to.y - origin.y) * h.x); // off the course line
        const lv = level(l.hexes);
        return { l, ahead, lv, score: ahead - aside * 0.8 + rng.next() * 0.1 };
      }).filter((o) => o.ahead > 0); // never doubles back: a river that can't go on stops here
      const level_ok = options.filter((o) => (downhill ? o.lv <= height : o.lv >= height));
      const pool = level_ok.length || !downhill ? level_ok : options;
      if (!pool.length) break;
      const best = pool.sort((a, b) => b.score - a.score || a.l.to.localeCompare(b.l.to))[0];
      laid.push([best.l.hexes[0], best.l.hexes[1]]);
      height = downhill ? Math.min(height, best.lv) : Math.max(height, best.lv);
      cur = best.l.to;
      path.push(cur);
    }
    if (laid.length < minSteps) return [start]; // too short to be a river: leave it out
    for (const [a, b] of laid) edges.add(edgeKey(a, b));
    for (const c of path) visited.add(c);
    courses.push(downhill ? laid : [...laid].reverse());
    return path;
  };

  // The main river crosses the map north to south, within 30° of straight across. It rises at the
  // higher end (the north on level ground) and starts from a corner in the middle half of that edge.
  const minY = Math.min(...all.map((x) => x.y));
  const middle = Array.from({ length: Math.max(1, Math.floor(cols / 2)) }, (_, i) => Math.floor(cols / 4) + i);
  const northHigh = middle.reduce((t, c) => t + ground(key(c, 0)), 0) >= middle.reduce((t, c) => t + ground(key(c, rows - 1)), 0);
  const ends = all.filter((c) => (northHigh ? c.y < minY + 0.6 : c.y > maxY - 0.6) && c.links.some((l) => l.hexes.length === 2)
    && c.x > minX + (maxX - minX) / 4 && c.x < maxX - (maxX - minX) / 4);
  const source = rng.pick(ends.length ? ends : all);
  const sourceKey = [...corners.entries()].find(([, c]) => c === source)![0];
  const flip = !northHigh;
  const main = follow(sourceKey, rng.int(3) - 1, -2, 2, flip, true, (c) => (flip ? c.y <= minY + 1.6 : c.y >= maxY - 1.6), rows * 6);

  // Now and then a tributary joins the main river from the east or west. It's traced upstream from
  // where it joins, heading back against the main river's flow at 0°–30° above square across.
  for (let i = 0; i < branches && main.length > 8; i++) {
    const at = Math.floor(main.length / 5) + rng.int(Math.max(1, Math.floor((main.length * 3) / 5)));
    const from = main[at];
    // Branch away from the way the river leans there, so the two part at a wide angle rather than
    // running side by side.
    const lean = corners.get(main[Math.min(main.length - 1, at + 4)])!.x - corners.get(main[Math.max(0, at - 4)])!.x;
    const side = (lean > 0.5 ? -1 : lean < -0.5 ? 1 : rng.int(2) ? 1 : -1) * (flip ? -1 : 1); // in heading terms
    const dir = side * (6 + rng.int(3)); // 90°–120° from the main river's direction
    follow(from, dir, side > 0 ? 6 : -8, side > 0 ? 8 : -6, flip, false, (c) => c.x <= minX + 1 || c.x >= maxX - 1, cols * 3, 6);
  }
  return { edges: [...edges].sort(), courses };
}

// ---------------------------------------------------------------- the game at turn 0

export interface SetupPlayer { id: PlayerId; side: number }

/** Scenario choices made at setup; anything left out takes the scenario's and the map size's default. */
export interface ScenarioOptions { scenario?: string; rounds?: number; objectives?: number }

/** A new game at turn 0: map and objectives, no units yet; player 1 deploys first. */
export function createSetupState(eraId: string, sizeId: string, pointLimit: number, players: SetupPlayer[], seed: number, opts: ScenarioOptions = {}): GameState {
  const era = ERAS[eraId];
  const size = MAP_SIZES[sizeId];
  const scenario = SCENARIOS[opts.scenario ?? DEFAULT_SCENARIO];
  if (!era) throw new Error(`Unknown era ${eraId}`);
  if (!size) throw new Error(`Unknown map size ${sizeId}`);
  if (!scenario) throw new Error(`Unknown scenario ${opts.scenario}`);
  const objectives =
    scenario.objectives === 'none' ? [] :
    scenario.objectives === 'centre' ? [centre(size)] :
    scenario.objectives === 'flags' ? players.map((p) => flagHex(size, p.side)) :
    objectiveHexes(size, opts.objectives ?? size.objectives);
  const objectiveOwners = scenario.objectives === 'flags' ? players.map((p) => p.id) : objectives.map(() => null);
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
    turnLimit: opts.rounds ?? size.turnLimit,
    map: generateMap(era, size, seed, [...objectives, ...zones]),
    datasheets: eraDatasheets(era),
    players: players.map((p) => ({ id: p.id, side: p.side })),
    units: [],
    objectives,
    scenario: scenario.id,
    objectiveOwners,
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
