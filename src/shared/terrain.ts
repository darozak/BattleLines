// Placeholder terrain table. Real values come from the rules document later.
// Shared with the browser.
import type { GameMap, HexKey, Terrain, TerrainType } from './types.js';

export const TERRAIN: Record<TerrainType, Terrain> = {
  open:         { name: 'Open',          cost: 1, blocksSight: false, sightBonus: 0, defense: 0,  color: '#d4dfa6' },
  road:         { name: 'Road',          cost: 1, blocksSight: false, sightBonus: 0, defense: 0,  color: '#e2cf98' },
  light_forest: { name: 'Light forest',  cost: 2, blocksSight: false, sightBonus: 0, defense: 1,  color: '#a3c27e' },
  dense_forest: { name: 'Dense forest',  cost: 3, blocksSight: true,  sightBonus: 0, defense: 2,  color: '#5f8a4c' },
  hills:        { name: 'Hills',         cost: 2, blocksSight: true,  sightBonus: 2, defense: 1,  color: '#c2a878' },
  ruins:        { name: 'Ruins',         cost: 2, blocksSight: true,  sightBonus: 0, defense: 2,  color: '#a9a39a' },
  village:      { name: 'Village',       cost: 1, blocksSight: true,  sightBonus: 0, defense: 2,  color: '#c9a98a' },
  marsh:        { name: 'Marsh',         cost: 3, blocksSight: false, sightBonus: 0, defense: 0,  color: '#8fb5a6' },
  river:        { name: 'River (ford)',  cost: 3, blocksSight: false, sightBonus: 0, defense: -1, color: '#9fcbe6' },
  water:        { name: 'Lake',          cost: 0, impassable: true, blocksSight: false, sightBonus: 0, defense: 0, color: '#6fa3cc' },
};

export function elevationAt(map: GameMap, hex: HexKey): number {
  const [col, row] = hex.split(',').map(Number);
  return map.elevation[row * map.cols + col] ?? 0;
}

export function terrainAt(map: GameMap, hex: HexKey): Terrain {
  const [col, row] = hex.split(',').map(Number);
  return TERRAIN[map.terrain[row * map.cols + col]];
}
