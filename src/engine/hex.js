// Hex grid helpers. Pointy-top hexes in "odd-r" offset layout (odd rows shifted right).
// A hex is identified by the string key "col,row". This module has no dependencies and
// is shared with the browser.

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export const key = (col, row) => `${col},${row}`;

export function parse(k) {
  const [col, row] = k.split(',').map(Number);
  return { col, row };
}

function toAxial({ col, row }) {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

function fromAxial({ q, r }) {
  return { col: q + (r - (r & 1)) / 2, row: r };
}

export function inBounds(k, cols, rows) {
  const { col, row } = parse(k);
  return col >= 0 && row >= 0 && col < cols && row < rows;
}

export function neighbors(k, cols, rows) {
  const a = toAxial(parse(k));
  const out = [];
  for (const [dq, dr] of DIRS) {
    const o = fromAxial({ q: a.q + dq, r: a.r + dr });
    const n = key(o.col, o.row);
    if (cols === undefined || inBounds(n, cols, rows)) out.push(n);
  }
  return out;
}

export function distance(a, b) {
  const A = toAxial(parse(a));
  const B = toAxial(parse(b));
  const dq = A.q - B.q;
  const dr = A.r - B.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function cubeRound(x, y, z) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

// All hexes on the straight line from a to b, inclusive.
export function line(a, b) {
  const n = distance(a, b);
  const A = toAxial(parse(a));
  const B = toAxial(parse(b));
  const eps = 1e-6;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const q = A.q + eps + (B.q - A.q) * t;
    const r = A.r + eps + (B.r - A.r) * t;
    const h = fromAxial(cubeRound(q, -q - r, r));
    out.push(key(h.col, h.row));
  }
  return out;
}

export function colLabel(col) {
  let s = '';
  let n = col;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// Human-readable label used in emails and logs, e.g. "D7".
export function label(k) {
  const { col, row } = parse(k);
  return `${colLabel(col)}${row + 1}`;
}

// Pixel centre of a hex for rendering.
export function toPixel(k, size) {
  const { col, row } = parse(k);
  return {
    x: size * Math.sqrt(3) * (col + 0.5 * (row & 1)),
    y: size * 1.5 * row,
  };
}
