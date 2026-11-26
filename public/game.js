// Player map: shows own units, what they can see, last turn's events, and lets the
// player plot movement orders. All hidden-information filtering is done by the server.
import { parse, neighbors, toPixel, label } from '/shared/hex.js';
import { TERRAIN } from '/shared/terrain.js';

const app = document.getElementById('app');
const token = app.dataset.token;
const SIDE_COLORS = JSON.parse(app.dataset.colors);
const SIDE_NAMES = JSON.parse(app.dataset.sides);
const SIZE = 24;
const MARGIN = 14;

let data = null;
let orders = {};          // unitId -> [hex, ...]
let selected = null;      // unitId
let showReplay = true;
let dirty = false;
let flash = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const terrainAt = (hex) => { const { col, row } = parse(hex); return TERRAIN[data.view.map.terrain[row * data.view.map.cols + col]]; };
const player = (id) => data.players.find((p) => p.id === id);
const colorOf = (ownerId) => SIDE_COLORS[player(ownerId)?.side ?? 0];
const sideOf = (ownerId) => SIDE_NAMES[player(ownerId)?.side ?? 0];
const myUnits = () => data.view.units.filter((u) => u.own);
const canOrder = () => data.game.status === 'active' && myUnits().length > 0;

async function load() {
  const res = await fetch(`/api/p/${token}/view`);
  if (!res.ok) { app.innerHTML = `<p class="error">${esc((await res.json()).error)}</p>`; return; }
  const prevTurn = data?.game.turn;
  data = await res.json();
  if (prevTurn && prevTurn !== data.game.turn) flash = { kind: 'ok', text: `Turn ${prevTurn} has been resolved.` };
  orders = Object.fromEntries(Object.entries(data.myOrders || {}).map(([id, o]) => [id, [...o.path]]));
  dirty = false;
  selected = null;
  render();
}

// Cheapest paths from the end of a unit's current planned path, within its remaining movement.
function reachable(unit) {
  const path = orders[unit.id] || [];
  const start = path.length ? path[path.length - 1] : unit.hex;
  const spent = path.reduce((s, h) => s + terrainAt(h).cost, 0);
  const budget = unit.move - spent;
  const { cols, rows } = data.view.map;
  // Can't enter visible enemies, or friendly units that are staying put (no stacking).
  const blocked = new Set(data.view.units
    .filter((u) => !u.own || (u.id !== unit.id && !(orders[u.id] || []).length))
    .map((u) => u.hex));
  const best = new Map([[start, { cost: 0, prev: null }]]);
  const queue = [start];
  while (queue.length) {
    queue.sort((a, b) => best.get(a).cost - best.get(b).cost);
    const h = queue.shift();
    for (const n of neighbors(h, cols, rows)) {
      const t = terrainAt(n);
      if (t.impassable || blocked.has(n)) continue;
      const c = best.get(h).cost + t.cost;
      if (c > budget) continue;
      if (!best.has(n) || c < best.get(n).cost) { best.set(n, { cost: c, prev: h }); queue.push(n); }
    }
  }
  best.delete(start);
  return best;
}

function onHexClick(hex) {
  if (!canOrder()) return;
  const unit = selected && myUnits().find((u) => u.id === selected);
  if (unit) {
    const path = orders[unit.id] || [];
    if (path.length && hex === path[path.length - 1]) { // click the end of the path to step back
      path.pop();
      orders[unit.id] = path;
      dirty = true;
      return render();
    }
    const reach = reachable(unit);
    if (reach.has(hex)) {
      const steps = [];
      for (let h = hex; reach.has(h); h = reach.get(h).prev) steps.unshift(h);
      orders[unit.id] = [...path, ...steps];
      dirty = true;
      return render();
    }
  }
  const own = myUnits().find((u) => u.hex === hex);
  selected = own && own.id !== selected ? own.id : null;
  render();
}

function hexPoints(cx, cy) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + SIZE * Math.cos(a)).toFixed(1)},${(cy + SIZE * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

const px = (hex) => { const p = toPixel(hex, SIZE); return { x: p.x + MARGIN + SIZE, y: p.y + MARGIN + SIZE }; };
const polyline = (hexes) => hexes.map((h) => { const p = px(h); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');

function renderMap() {
  const { cols, rows } = data.view.map;
  const w = Math.sqrt(3) * SIZE * (cols + 0.5) + MARGIN * 2;
  const h = 1.5 * SIZE * (rows - 1) + 2 * SIZE + MARGIN * 2;
  const visible = new Set(data.view.visibleHexes);
  const out = [];
  out.push(`<svg viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">`);
  out.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>`);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hex = `${c},${r}`;
      const p = px(hex);
      out.push(`<polygon class="hex" data-hex="${hex}" points="${hexPoints(p.x, p.y)}" fill="${terrainAt(hex).color}"/>`);
      out.push(`<text class="label" x="${p.x}" y="${p.y + SIZE * 0.62}">${label(hex)}</text>`);
      if (!visible.has(hex)) out.push(`<polygon class="fog" points="${hexPoints(p.x, p.y)}"/>`);
    }
  }
  for (const hex of data.view.objectives) {
    const p = px(hex);
    out.push(`<circle class="objective" cx="${p.x}" cy="${p.y}" r="${SIZE * 0.8}"/>`);
  }
  const sel = selected && myUnits().find((u) => u.id === selected);
  if (sel && canOrder()) {
    for (const hex of reachable(sel).keys()) { const p = px(hex); out.push(`<polygon class="reach" points="${hexPoints(p.x, p.y)}"/>`); }
  }
  if (showReplay && data.lastTurn) {
    for (const e of data.lastTurn.events.filter((x) => x.type === 'move' && x.path.length > 1)) {
      out.push(`<polyline class="path" points="${polyline(e.path)}" stroke="${colorOf(e.owner)}" opacity=".45" marker-end="url(#arrow)"/>`);
    }
    for (const e of data.lastTurn.events.filter((x) => x.type === 'attack' && x.attackerHex)) {
      out.push(`<polyline class="path" points="${polyline([e.attackerHex, e.targetHex])}" stroke="${e.hit ? '#d33' : '#555'}" stroke-dasharray="2 3" marker-end="url(#arrow)"/>`);
    }
  }
  for (const u of myUnits()) {
    const path = orders[u.id];
    if (path?.length) out.push(`<polyline class="path" points="${polyline([u.hex, ...path])}" stroke="#fff" stroke-dasharray="6 4" marker-end="url(#arrow)"/>`);
  }
  for (const g of data.view.ghosts) {
    const p = px(g.hex);
    out.push(`<g class="unit ghost"><circle cx="${p.x}" cy="${p.y}" r="${SIZE * 0.55}" stroke="${colorOf(g.owner)}"/><text x="${p.x}" y="${p.y}">${esc(g.code)}?</text></g>`);
  }
  for (const u of data.view.units) {
    const p = px(u.hex);
    const ring = u.id === selected ? ' selected' : '';
    out.push(`<g class="unit"><circle class="${ring}" cx="${p.x}" cy="${p.y}" r="${SIZE * 0.6}" fill="${colorOf(u.owner)}"/>`
      + `<text x="${p.x}" y="${p.y - 1}">${esc(u.code)}</text>`
      + `<circle cx="${p.x + SIZE * 0.5}" cy="${p.y - SIZE * 0.45}" r="7" fill="#fffdf8" stroke="${colorOf(u.owner)}"/>`
      + `<text class="str" x="${p.x + SIZE * 0.5}" y="${p.y - SIZE * 0.45}">${u.strength}</text></g>`);
  }
  out.push('</svg>');
  return out.join('');
}

function unitDesc(id, owner, type) {
  const own = myUnits().find((u) => u.id === id);
  if (own) return own.name;
  const ds = data.view.datasheets[type];
  return owner === data.me.id ? `your ${ds?.name ?? 'unit'}` : `${sideOf(owner)} ${ds?.name ?? 'unit'}`;
}

function describe(e) {
  switch (e.type) {
    case 'move': {
      const who = unitDesc(e.unit, e.owner, e.unitType);
      if (e.owner === data.me.id) return `${who} moved ${label(e.path[0])} → ${label(e.path[e.path.length - 1])}.`;
      return `${who} seen moving through ${e.path.map(label).join(', ')}${e.partial ? ' (partly out of sight)' : ''}.`;
    }
    case 'halt': return `${unitDesc(e.unit, e.owner)} halted at ${label(e.hex)}: ${e.reason}.`;
    case 'clash': return `Opposing units collided at ${label(e.hex)}.`;
    case 'attack': {
      const roll = `rolled ${e.dice.join('+')}${e.cover ? ` −${e.cover} cover` : ''}`;
      const target = unitDesc(e.target, e.targetOwner, e.targetType);
      if (e.unseenAttacker) return `Unseen enemy attacked ${target} — ${e.hit ? 'hit' : 'miss'}.`;
      return `${unitDesc(e.attacker, e.attackerOwner, e.attackerType)} attacked ${target}: ${roll} — ${e.hit ? 'hit!' : 'miss'}.`;
    }
    case 'destroyed': return `${unitDesc(e.unit, e.owner, e.unitType)} destroyed at ${label(e.hex)}.`;
    case 'score': return `${player(e.player)?.name ?? 'Someone'} scored ${e.points} for holding ${label(e.hex)}.`;
    case 'gameover': return `Game over. ${e.reason}`;
    default: return e.type;
  }
}

function timeLeft(ms) {
  const d = ms - Date.now();
  if (d <= 0) return 'deadline passed, resolving shortly';
  const h = Math.floor(d / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  return h >= 48 ? `${Math.floor(h / 24)} days left` : h ? `${h}h ${m}m left` : `${m}m left`;
}

function render() {
  const g = data.game;
  const finished = g.status === 'finished';
  const scores = data.view.scores;
  const eliminated = new Set(data.view.eliminated);
  let banner = '';
  if (flash) { banner = `<div class="banner ${flash.kind}">${esc(flash.text)}</div>`; }
  else if (finished) {
    const winners = (data.view.result?.winners || []).map((id) => player(id)?.name).join(' and ');
    banner = `<div class="banner ok">The battle is over. ${esc(data.view.result?.reason)} ${winners ? `Victory: ${esc(winners)}.` : ''}</div>`;
  } else if (!myUnits().length) banner = '<div class="banner warn">Your army has been destroyed. You can still watch the battle.</div>';
  else if (dirty) banner = '<div class="banner warn">You have unsaved changes to your orders.</div>';
  else if (data.submittedAt) banner = `<div class="banner ok">Orders for turn ${g.turn} submitted ${new Date(data.submittedAt).toLocaleString()}. You can change them until the deadline.</div>`;

  const sel = selected && myUnits().find((u) => u.id === selected);
  const orderItems = myUnits().map((u) => {
    const p = orders[u.id];
    return `<li><b>${esc(u.name)}</b> (${label(u.hex)}): ${p?.length ? `move to ${label(p[p.length - 1])}` : 'hold'}</li>`;
  }).join('');
  const log = data.lastTurn?.events.length
    ? `<ol class="log">${data.lastTurn.events.map((e) => `<li>${esc(describe(e))}</li>`).join('')}</ol>`
    : '<p class="small">Nothing to report.</p>';

  app.innerHTML = `
${banner}
<div class="game">
  <div class="mapwrap">${renderMap()}
    <div class="legend">${Object.values(TERRAIN).map((t) => `<span><i style="background:${t.color}"></i>${t.name}</span>`).join('')}
      <span>◌ objective</span><span>dark = not in sight</span><span>dashed circle = last seen</span></div></div>
  <div class="side">
    <div class="card"><h3>${esc(g.name)}</h3>
      <div>${finished ? 'Final turn' : `Turn ${g.turn}`} of ${data.view.turnLimit}</div>
      ${g.deadline && !finished ? `<div class="small">Orders due ${esc(new Date(g.deadline).toLocaleString())} (${timeLeft(g.deadline)})</div>` : ''}
      <ul class="players" style="margin-top:8px">${data.players.map((p) => `<li><span class="swatch" style="background:${SIDE_COLORS[p.side]}"></span>
        ${esc(p.name)}${p.id === data.me.id ? ' (you)' : ''} — ${scores[p.id] ?? 0} pts
        ${eliminated.has(p.id) ? '<span class="small">eliminated</span>' : !finished ? `<span class="small">${p.submitted ? '✓ orders in' : 'thinking…'}</span>` : ''}</li>`).join('')}</ul>
    </div>
    ${canOrder() ? `<div class="card"><h3>Orders</h3>
      ${sel ? `<p class="small"><b>${esc(sel.name)}</b>: move ${sel.move}, sight ${sel.sight}, strength ${sel.strength}/${data.view.datasheets[sel.type].strength}.
        Click a highlighted hex to plot a move; click the end of the path to step back.</p>` : '<p class="small">Click one of your units to give it orders.</p>'}
      <ul class="orders">${orderItems}</ul>
      <div class="row"><button id="submit">${data.submittedAt && !dirty ? 'Resubmit orders' : 'Submit orders'}</button>
      ${sel && orders[sel.id]?.length ? '<button id="clear" class="secondary">Hold position</button>' : ''}</div></div>` : ''}
    <div class="card"><h3>${data.lastTurn ? `Turn ${data.lastTurn.turn} report` : 'Report'}</h3>
      ${data.lastTurn ? `<label class="small"><input type="checkbox" id="replay" ${showReplay ? 'checked' : ''}> show on map</label>` : ''}
      ${data.lastTurn ? log : '<p class="small">The battle has just begun.</p>'}</div>
  </div>
</div>`;
  flash = null;
  app.querySelector('svg').addEventListener('click', (ev) => {
    const hex = ev.target.closest('[data-hex]')?.dataset.hex;
    if (hex) onHexClick(hex);
  });
  app.querySelector('#replay')?.addEventListener('change', (ev) => { showReplay = ev.target.checked; render(); });
  app.querySelector('#clear')?.addEventListener('click', () => { orders[selected] = []; dirty = true; render(); });
  app.querySelector('#submit')?.addEventListener('click', submit);
}

async function submit() {
  const body = { orders: Object.fromEntries(Object.entries(orders).filter(([, p]) => p.length).map(([id, path]) => [id, { path }])) };
  const res = await fetch(`/api/p/${token}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json();
  if (!res.ok) { flash = { kind: 'warn', text: out.error }; return render(); }
  data.submittedAt = out.submittedAt;
  data.players.find((p) => p.id === data.me.id).submitted = true;
  dirty = false;
  render();
  // If everyone has now submitted, the turn resolves straight away; pick that up.
  setTimeout(async () => {
    const res2 = await fetch(`/api/p/${token}/view`);
    if (res2.ok && (await res2.json()).game.turn !== data.game.turn) load();
  }, 1200);
}

window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
load();
