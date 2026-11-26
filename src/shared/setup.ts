// Game setup: eras (each with its own terrain, armies and units), map sizes, point limits,
// starting zones, and turn 0, when each player in turn picks an army and places units.
// The eras, armies and numbers here are PLACEHOLDERS until the rules and datasheets are written.
import { key, neighbors, line, facingToward, distance } from './hex.js';
import { TERRAIN } from './terrain.js';
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
  /** Terrain clusters on a 16×12 map: [type, number of clusters, hexes per cluster]. Scaled to the map size. */
  terrain: [TerrainType, number, number][];
  armies: Army[];
}

const unitsOf = (army: string, list: (Omit<Datasheet, 'name'> & { id: string; name: string })[]) =>
  Object.fromEntries(list.map(({ id, ...ds }) => [`${army}.${id}`, ds]));

export const ERAS: Record<string, Era> = {
  napoleonic: {
    id: 'napoleonic',
    name: 'Napoleonic Wars',
    description: 'Line infantry, skirmishers and cavalry among villages, woods and rolling hills.',
    terrain: [['woods', 4, 6], ['hills', 4, 5], ['village', 3, 2], ['water', 1, 4]],
    armies: [
      { id: 'french', name: 'French Empire', description: 'Fast cavalry and the formidable Old Guard.', units: unitsOf('french', [
        { id: 'line', name: 'Line Infantry', code: 'L', points: 20, move: 3, sight: 5, strength: 4, climb: 1 },
        { id: 'voltigeurs', name: 'Voltigeurs', code: 'V', points: 15, move: 5, sight: 7, strength: 2, climb: 2 },
        { id: 'hussars', name: 'Hussars', code: 'H', points: 25, move: 7, sight: 6, strength: 3, climb: 1 },
        { id: 'guard', name: 'Old Guard', code: 'G', points: 40, move: 3, sight: 5, strength: 6, climb: 1 },
      ]) },
      { id: 'british', name: 'British Army', description: 'Steady redcoats and sharpshooting riflemen.', units: unitsOf('british', [
        { id: 'line', name: 'Redcoats', code: 'L', points: 20, move: 3, sight: 5, strength: 4, climb: 1 },
        { id: 'rifles', name: '95th Rifles', code: 'R', points: 15, move: 5, sight: 7, strength: 2, climb: 2 },
        { id: 'dragoons', name: 'Light Dragoons', code: 'D', points: 25, move: 7, sight: 6, strength: 3, climb: 1 },
        { id: 'guards', name: 'Foot Guards', code: 'G', points: 40, move: 3, sight: 5, strength: 6, climb: 1 },
      ]) },
      { id: 'austrian', name: 'Austrian Empire', description: 'Solid infantry, Grenzer skirmishers and heavy cuirassiers.', units: unitsOf('austrian', [
        { id: 'line', name: 'Line Infantry', code: 'L', points: 20, move: 3, sight: 5, strength: 4, climb: 1 },
        { id: 'grenzer', name: 'Grenzers', code: 'Z', points: 15, move: 5, sight: 7, strength: 2, climb: 2 },
        { id: 'cuirassiers', name: 'Cuirassiers', code: 'C', points: 30, move: 6, sight: 6, strength: 4, climb: 1 },
        { id: 'grenadiers', name: 'Grenadiers', code: 'G', points: 35, move: 3, sight: 5, strength: 5, climb: 1 },
      ]) },
      { id: 'prussian', name: 'Prussian Army', description: 'Landwehr in numbers, Jäger and hussars.', units: unitsOf('prussian', [
        { id: 'landwehr', name: 'Landwehr', code: 'W', points: 15, move: 3, sight: 5, strength: 3, climb: 1 },
        { id: 'jager', name: 'Jäger', code: 'J', points: 15, move: 5, sight: 7, strength: 2, climb: 2 },
        { id: 'hussars', name: 'Black Hussars', code: 'H', points: 25, move: 7, sight: 6, strength: 3, climb: 1 },
        { id: 'guard', name: 'Guard Infantry', code: 'G', points: 40, move: 3, sight: 5, strength: 6, climb: 1 },
      ]) },
    ],
  },
  ww2: {
    id: 'ww2',
    name: 'Second World War',
    description: 'Infantry, recon and armour fighting over woods, hills and ruined towns.',
    terrain: [['woods', 5, 6], ['hills', 3, 4], ['ruins', 2, 3], ['water', 1, 5]],
    armies: [
      { id: 'us', name: 'US Infantry Division', description: 'Rifle squads backed by Shermans and paratroopers.', units: unitsOf('us', [
        { id: 'rifles', name: 'Rifle Squad', code: 'R', points: 20, move: 4, sight: 5, strength: 4, climb: 1 },
        { id: 'recon', name: 'Recon Patrol', code: 'P', points: 15, move: 6, sight: 7, strength: 2, climb: 2 },
        { id: 'sherman', name: 'Sherman', code: 'T', points: 45, move: 6, sight: 4, strength: 6, climb: 1 },
        { id: 'airborne', name: 'Paratroopers', code: 'A', points: 30, move: 4, sight: 6, strength: 4, climb: 2 },
      ]) },
      { id: 'german', name: 'German Panzergrenadiers', description: 'Grenadiers with heavy armour and mountain troops.', units: unitsOf('german', [
        { id: 'grenadiers', name: 'Grenadiers', code: 'G', points: 20, move: 4, sight: 5, strength: 4, climb: 1 },
        { id: 'scouts', name: 'Scouts', code: 'S', points: 15, move: 6, sight: 7, strength: 2, climb: 2 },
        { id: 'panzer', name: 'Panzer IV', code: 'P', points: 50, move: 5, sight: 4, strength: 7, climb: 1 },
        { id: 'gebirgs', name: 'Gebirgsjäger', code: 'J', points: 30, move: 4, sight: 6, strength: 4, climb: 2 },
      ]) },
      { id: 'british', name: 'British Infantry Division', description: 'Rifle sections, Bren carriers, Churchills and commandos.', units: unitsOf('british', [
        { id: 'riflemen', name: 'Rifle Section', code: 'R', points: 20, move: 4, sight: 5, strength: 4, climb: 1 },
        { id: 'carrier', name: 'Bren Carrier', code: 'C', points: 20, move: 6, sight: 6, strength: 3, climb: 1 },
        { id: 'churchill', name: 'Churchill', code: 'T', points: 45, move: 4, sight: 4, strength: 7, climb: 1 },
        { id: 'commandos', name: 'Commandos', code: 'K', points: 30, move: 4, sight: 6, strength: 4, climb: 2 },
      ]) },
      { id: 'soviet', name: 'Soviet Rifle Division', description: 'Masses of riflemen with T-34s.', units: unitsOf('soviet', [
        { id: 'riflemen', name: 'Rifle Squad', code: 'R', points: 15, move: 4, sight: 5, strength: 3, climb: 1 },
        { id: 'scouts', name: 'Razvedchiki', code: 'S', points: 15, move: 6, sight: 7, strength: 2, climb: 2 },
        { id: 't34', name: 'T-34', code: 'T', points: 45, move: 6, sight: 4, strength: 6, climb: 1 },
        { id: 'guards', name: 'Guards Rifles', code: 'G', points: 25, move: 4, sight: 5, strength: 4, climb: 1 },
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
  const scale = (cols * rows) / (16 * 12);
  for (const [type, clusters, hexes] of era.terrain) {
    for (let i = 0; i < Math.max(1, Math.round(clusters * scale)); i++) {
      let frontier = [key(rng.int(cols), rng.int(rows))];
      for (let j = 0; j < hexes && frontier.length; j++) {
        const h = rng.pick(frontier);
        set(h, type);
        frontier = frontier.concat(neighbors(h, cols, rows));
      }
    }
  }
  // A road from west to east and one from north to south, crossing near the centre.
  for (const h of line(key(0, Math.floor(rows / 2)), key(cols - 1, Math.floor(rows / 2) - 1))) set(h, 'road');
  for (const h of line(key(Math.floor(cols / 2) - 1, 0), key(Math.floor(cols / 2), rows - 1))) set(h, 'road');
  // Nobody should start in a lake or have an objective in one.
  for (const h of protectedHexes) {
    const [c, r] = h.split(',').map(Number);
    if (TERRAIN[terrain[r * cols + c]].impassable) set(h, 'open');
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
  return { cols, rows, terrain, elevation };
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
