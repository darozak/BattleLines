// Placeholder terrain table. Real values come from the rules document later.
// Shared with the browser.
import type { GameMap, HexKey, Terrain, TerrainType } from './types.js';

export const TERRAIN: Record<TerrainType, Terrain> = {
  open:         { name: 'Open',          cost: 1, blocksSight: false, sightBonus: 0, defense: 0,  color: '#d4dfa6' },
  light_forest: { name: 'Light forest',  cost: 2, blocksSight: false, sightBonus: 0, defense: 1,  color: '#a3c27e' },
  dense_forest: { name: 'Dense forest',  cost: 3, blocksSight: true,  sightBonus: 0, defense: 2,  color: '#5f8a4c' },
  hills:        { name: 'Hills',         cost: 2, blocksSight: true,  sightBonus: 2, defense: 1,  color: '#c2a878' },
  ruins:        { name: 'Ruins',         cost: 2, blocksSight: true,  sightBonus: 0, defense: 2,  color: '#a9a39a' },
  village:      { name: 'Village',       cost: 1, blocksSight: true,  sightBonus: 0, defense: 2,  color: '#c9a98a' },
  marsh:        { name: 'Marsh',         cost: 3, blocksSight: false, sightBonus: 0, defense: 0,  color: '#8fb5a6' },
  water:        { name: 'Lake',          cost: 0, impassable: true, blocksSight: false, sightBonus: 0, defense: 0, color: '#6fa3cc' },
};

// ---------------------------------------------------------------- roads, rivers and bridges
// Roads join hex centres; rivers run along hex edges. Both are stored as "a|b" keys for a pair of
// adjacent hexes: for a road, the segment from a's centre to b's; for a river, the edge between them.
// A road segment always crosses the edge between its two hexes, so a key in both lists is a bridge.
// PLACEHOLDER values until the rules are written.

/** Following a road: each step along it costs this, whatever the terrain. */
export const ROAD_STEP_COST = 1;
/** Crossing a river (not by a bridge): extra movement. */
export const RIVER_CROSSING_COST = 2;
/** Attacking across a river, or across a bridge. */
export const RIVER_ATTACK = -2;
export const BRIDGE_ATTACK = -1;

export const edgeKey = (a: HexKey, b: HexKey) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const lookups = new WeakMap<string[], Set<string>>();
const setOf = (list: string[] | undefined): Set<string> => {
  if (!list) return new Set();
  let s = lookups.get(list);
  if (!s) { s = new Set(list); lookups.set(list, s); }
  return s;
};
export const hasRoad = (map: GameMap, a: HexKey, b: HexKey) => setOf(map.roads).has(edgeKey(a, b));
export const hasRiver = (map: GameMap, a: HexKey, b: HexKey) => setOf(map.rivers).has(edgeKey(a, b));
export const hasBridge = (map: GameMap, a: HexKey, b: HexKey) => hasRiver(map, a, b) && hasRoad(map, a, b);

/** Movement points to step from one hex into an adjacent one (Infinity if it can't be entered). */
export function stepCost(map: GameMap, from: HexKey, to: HexKey): number {
  const t = terrainAt(map, to);
  if (t.impassable) return Infinity;
  if (hasRoad(map, from, to)) return ROAD_STEP_COST; // following a road; crossing a river by its bridge
  return t.cost + (hasRiver(map, from, to) ? RIVER_CROSSING_COST : 0);
}

export function elevationAt(map: GameMap, hex: HexKey): number {
  const [col, row] = hex.split(',').map(Number);
  return map.elevation[row * map.cols + col] ?? 0;
}

export function terrainAt(map: GameMap, hex: HexKey): Terrain {
  const [col, row] = hex.split(',').map(Number);
  return TERRAIN[map.terrain[row * map.cols + col]];
}
