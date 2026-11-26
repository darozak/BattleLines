// Placeholder terrain table. Real values come from the rules document later.
// Shared with the browser.
export const TERRAIN = {
  open:  { name: 'Open',  cost: 1, blocksSight: false, sightBonus: 0, defense: 0, color: '#d4dfa6' },
  road:  { name: 'Road',  cost: 1, blocksSight: false, sightBonus: 0, defense: 0, color: '#e2cf98' },
  woods: { name: 'Woods', cost: 2, blocksSight: true,  sightBonus: 0, defense: 1, color: '#7fa765' },
  hills: { name: 'Hills', cost: 2, blocksSight: true,  sightBonus: 2, defense: 1, color: '#c2a878' },
  ruins: { name: 'Ruins', cost: 2, blocksSight: true,  sightBonus: 0, defense: 2, color: '#a9a39a' },
  water: { name: 'Water', impassable: true, blocksSight: false, sightBonus: 0, defense: 0, color: '#8dbcdc' },
};

export function terrainAt(map, hex) {
  const [col, row] = hex.split(',').map(Number);
  return TERRAIN[map.terrain[row * map.cols + col]];
}
