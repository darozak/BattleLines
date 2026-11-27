// Map art (#53): an icon for each kind of terrain, and the colour scale that shows elevation.
// The icons are small vector drawings in a 24-unit box centred on the hex (24 = the hex radius).
import type { TerrainType } from '../shared/types.js';

/** Hex colours by elevation, low to high (lakes keep their blue): cool green up to brown. */
export const ELEVATION_COLORS = ['#a8cd8a', '#cfe1a0', '#ece1a2', '#e0c085', '#c99c69', '#a97d5c'];
export const elevationColor = (e: number) => ELEVATION_COLORS[Math.max(0, Math.min(ELEVATION_COLORS.length - 1, e))];

const tree = (x: number, y: number, r: number, fill: string) =>
  `<rect x="${x - 0.9}" y="${y}" width="1.8" height="${r * 0.9}" fill="#5b4126"/><circle cx="${x}" cy="${y - r * 0.15}" r="${r}" fill="${fill}" stroke="#2f4a22" stroke-width=".8"/>`;
const pine = (x: number, y: number, h: number, fill: string) =>
  `<rect x="${x - 0.9}" y="${y}" width="1.8" height="${h * 0.25}" fill="#4a3420"/>`
  + `<path d="M${x},${y - h} L${x + h * 0.45},${y} L${x - h * 0.45},${y} Z" fill="${fill}" stroke="#1f3417" stroke-width=".8"/>`
  + `<path d="M${x},${y - h * 1.25} L${x + h * 0.35},${y - h * 0.45} L${x - h * 0.35},${y - h * 0.45} Z" fill="${fill}" stroke="#1f3417" stroke-width=".8"/>`;
const house = (x: number, y: number, w: number) =>
  `<path d="M${x - w / 2},${y} V${y - w * 0.6} L${x},${y - w * 1.05} L${x + w / 2},${y - w * 0.6} V${y} Z" fill="#efe2c8" stroke="#5b4126" stroke-width=".9"/>`
  + `<path d="M${x - w / 2 - 1},${y - w * 0.55} L${x},${y - w * 1.1} L${x + w / 2 + 1},${y - w * 0.55}" fill="none" stroke="#8a3b12" stroke-width="2" stroke-linejoin="round"/>`
  + `<rect x="${x - 1}" y="${y - 3}" width="2" height="3" fill="#5b4126"/>`;

const ART: Record<TerrainType, string> = {
  open: '<path d="M-9,6 l1.5,-4 l1.5,4 M7,-4 l1.2,-3.5 l1.2,3.5 M-2,-9 l1,-3 l1,3" stroke="#7c8c4c" stroke-width="1" fill="none" stroke-linecap="round"/>',
  light_forest: tree(-7, 2, 5, '#7fae55') + tree(6, -3, 5.5, '#88b75d') + tree(3, 9, 4, '#76a64e'),
  dense_forest: pine(-8, 4, 8, '#2f6b2f') + pine(0, -2, 9, '#2a6229') + pine(8, 5, 8, '#336f30') + pine(-1, 12, 7, '#2d6a2c'),
  hills: '<path d="M-15,8 Q-8,-8 0,6 Q6,-12 15,8" fill="#b08e5a" stroke="#6e5530" stroke-width="1.3" stroke-linejoin="round"/><path d="M-11,6 q2,-3 4,-1 M3,4 q2,-4 5,-2" stroke="#6e5530" stroke-width=".8" fill="none"/>',
  ruins: '<path d="M-12,9 V-3 H-9 V-8 H-6 V-1 H-3 V9 Z" fill="#8e8678" stroke="#4d4740" stroke-width=".9"/><path d="M2,9 V-6 H5 V-10 L8,-7 V0 H11 V9 Z" fill="#8e8678" stroke="#4d4740" stroke-width=".9"/>'
    + '<rect x="-3" y="1" width="2.5" height="2" fill="#6f685d"/><path d="M-12,11 h24" stroke="#4d4740" stroke-width=".8"/><circle cx="-1" cy="10" r="1.2" fill="#6f685d"/><circle cx="14" cy="10" r="1" fill="#6f685d"/>',
  village: house(-6, 3, 9) + house(6, 9, 8) + house(5, -4, 7),
  marsh: '<path d="M-14,3 q3.5,-2 7,0 t7,0 t7,0 t7,0 M-12,9 q3.5,-2 7,0 t7,0 t7,0" stroke="#3f7f95" stroke-width="1.1" fill="none"/>'
    + '<path d="M-8,2 l-1.5,-7 M-7,2 l0,-8 M-6,2 l1.5,-6 M5,8 l-1.5,-6 M6,8 l0,-8 M7,8 l1.5,-6 M10,-1 l-1,-5 M11,-1 l.5,-6" stroke="#3d6b2a" stroke-width="1.1" stroke-linecap="round"/>',
  water: '<path d="M-12,-3 q3,-2.5 6,0 t6,0 t6,0 t6,0 M-9,5 q3,-2.5 6,0 t6,0 t6,0" stroke="#e8f2fa" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".9"/>',
};

/** A terrain icon centred on (cx, cy), at `scale` times the 24-unit drawing. */
export const terrainIcon = (type: TerrainType, cx: number, cy: number, scale: number) =>
  `<g class="ticon" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) scale(${scale})">${ART[type]}</g>`;

/** A terrain icon as a small stand-alone SVG, for the legend. */
export const legendIcon = (type: TerrainType, px = 18) =>
  `<svg class="legend-icon" width="${px}" height="${px}" viewBox="-15 -15 30 30" aria-hidden="true">${type === 'water' ? '<circle r="14" fill="#6fa3cc"/>' : ''}${ART[type]}</svg>`;
