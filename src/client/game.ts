// Player map page.
//  - A scrollable, zoomable hex map showing own units, what they can see, and last turn's events.
//  - A unit table beside the map. Clicking a unit (in the table or on the map) zooms the map to
//    it and opens its datasheet, with order options for the player's own units.
// All hidden-information filtering is done by the server; this page only shows what it is sent.
import { parse, neighbors, toPixel, label } from '../shared/hex.js';
import { TERRAIN } from '../shared/terrain.js';
import type { GameEvent, Ghost, HexKey, PlayerData, PlayerId, Terrain, UnitId, VisibleUnit } from '../shared/types.js';

type OwnUnit = Extract<VisibleUnit, { own: true }>;
type EnemyUnit = Extract<VisibleUnit, { own: false }>;

const app = document.getElementById('app')!;
const token = app.dataset.token!;
const SIDE_COLORS: string[] = JSON.parse(app.dataset.colors!);
const SIDE_NAMES: string[] = JSON.parse(app.dataset.sides!);
const SIZE = 24;                 // hex radius in map units (before zoom)
const MARGIN = 14;
const ZOOMS = [0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];
const FOCUS_ZOOM = 1.25;         // minimum zoom when jumping to a unit

let data: PlayerData;
let loaded = false;
let orders: Record<UnitId, HexKey[]> = {};
let selected: UnitId | null = null;    // any visible unit or last-seen marker
let showReplay = true;
let dirty = false;
let flash: { kind: 'ok' | 'warn'; text: string } | null = null;
let zoom = 1;

// ---------------------------------------------------------------- helpers

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as Record<string, string>)[c]);
const terrainAt = (hex: HexKey): Terrain => { const { col, row } = parse(hex); return TERRAIN[data.view.map.terrain[row * data.view.map.cols + col]]; };
const player = (id: PlayerId) => data.players.find((p) => p.id === id);
const colorOf = (ownerId: PlayerId) => SIDE_COLORS[player(ownerId)?.side ?? 0];
const sideOf = (ownerId: PlayerId) => SIDE_NAMES[player(ownerId)?.side ?? 0];
const myUnits = (): OwnUnit[] => data.view.units.filter((u): u is OwnUnit => u.own);
const enemies = (): EnemyUnit[] => data.view.units.filter((u): u is EnemyUnit => !u.own);
const canOrder = () => data.game.status === 'active' && myUnits().length > 0;
const ownUnit = (id: UnitId | null) => (id ? myUnits().find((u) => u.id === id) : undefined);
const dsName = (type: string) => data.view.datasheets[type]?.name ?? type;
const pathCost = (path: HexKey[]) => path.reduce((s, h) => s + terrainAt(h).cost, 0);

function baseSize() {
  const { cols, rows } = data.view.map;
  return {
    w: Math.sqrt(3) * SIZE * (cols + 0.5) + MARGIN * 2,
    h: 1.5 * SIZE * (rows - 1) + 2 * SIZE + MARGIN * 2,
  };
}
const px = (hex: HexKey) => { const p = toPixel(hex, SIZE); return { x: p.x + MARGIN + SIZE, y: p.y + MARGIN + SIZE }; };
const polyline = (hexes: HexKey[]) => hexes.map((h) => { const p = px(h); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');

function hexPoints(cx: number, cy: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + SIZE * Math.cos(a)).toFixed(1)},${(cy + SIZE * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

// ---------------------------------------------------------------- data

async function load(): Promise<void> {
  const res = await fetch(`/api/p/${token}/view`);
  if (!res.ok) { app.innerHTML = `<p class="error">${esc((await res.json()).error)}</p>`; return; }
  const prevTurn = loaded ? data.game.turn : undefined;
  data = await res.json();
  if (prevTurn && prevTurn !== data.game.turn) flash = { kind: 'ok', text: `Turn ${prevTurn} has been resolved.` };
  orders = Object.fromEntries(Object.entries(data.myOrders || {}).map(([id, o]) => [id, [...o.path]]));
  dirty = false;
  if (selected && !data.view.units.some((u) => u.id === selected) && !data.view.ghosts.some((g) => g.id === selected)) selected = null;
  const first = !loaded;
  loaded = true;
  render();
  if (first) {
    // Start centred on the player's own forces.
    const mine = myUnits();
    if (mine.length) centerOn(mine[Math.floor(mine.length / 2)].hex, false);
  }
}

// Cheapest paths from the end of a unit's current planned path, within its remaining movement.
function reachable(unit: OwnUnit): Map<HexKey, { cost: number; prev: HexKey }> {
  const path = orders[unit.id] || [];
  const start = path.length ? path[path.length - 1] : unit.hex;
  const budget = unit.move - pathCost(path);
  const { cols, rows } = data.view.map;
  // Can't enter visible enemies, or friendly units that are staying put (no stacking).
  const blocked = new Set(data.view.units
    .filter((u) => !u.own || (u.id !== unit.id && !(orders[u.id] || []).length))
    .map((u) => u.hex));
  const best = new Map<HexKey, { cost: number; prev: HexKey }>([[start, { cost: 0, prev: start }]]);
  const queue = [start];
  while (queue.length) {
    queue.sort((a, b) => best.get(a)!.cost - best.get(b)!.cost);
    const h = queue.shift()!;
    for (const n of neighbors(h, cols, rows)) {
      const t = terrainAt(n);
      if (t.impassable || blocked.has(n)) continue;
      const c = best.get(h)!.cost + t.cost;
      if (c > budget) continue;
      if (!best.has(n) || c < best.get(n)!.cost) { best.set(n, { cost: c, prev: h }); queue.push(n); }
    }
  }
  best.delete(start);
  return best;
}

// ---------------------------------------------------------------- actions

function onHexClick(hex: HexKey): void {
  const unit = ownUnit(selected);
  if (unit && canOrder()) {
    const path = orders[unit.id] || [];
    if (path.length && hex === path[path.length - 1]) { // click the end of the path to step back
      orders[unit.id] = path.slice(0, -1);
      dirty = true;
      return render();
    }
    const reach = reachable(unit);
    if (reach.has(hex)) {
      const steps: HexKey[] = [];
      for (let h = hex; reach.has(h); h = reach.get(h)!.prev) steps.unshift(h);
      orders[unit.id] = [...path, ...steps];
      dirty = true;
      return render();
    }
  }
  const here = data.view.units.find((u) => u.hex === hex) ?? data.view.ghosts.find((g) => g.hex === hex);
  selected = here && here.id !== selected ? here.id : null;
  render();
  if (selected) scrollRowIntoView(selected);
}

/** Select a unit from the table: zoom the map to it and open its datasheet. */
function focusUnit(id: UnitId): void {
  selected = id;
  const hex = data.view.units.find((u) => u.id === id)?.hex ?? data.view.ghosts.find((g) => g.id === id)?.hex;
  if (hex && zoom < FOCUS_ZOOM) setZoom(FOCUS_ZOOM);
  render();
  if (hex) centerOn(hex, true);
  pulse(hex);
}

function setZoom(z: number): void {
  const wrap = document.getElementById('mapwrap');
  if (!wrap) { zoom = z; return; }
  // Keep the point at the centre of the view in place.
  const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / zoom;
  const cy = (wrap.scrollTop + wrap.clientHeight / 2) / zoom;
  zoom = z;
  renderMap();
  wrap.scrollLeft = cx * zoom - wrap.clientWidth / 2;
  wrap.scrollTop = cy * zoom - wrap.clientHeight / 2;
}

function zoomStep(dir: 1 | -1): void {
  const i = ZOOMS.findIndex((z) => z >= zoom - 1e-6);
  const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i === -1 ? ZOOMS.length - 1 : i) + dir))];
  setZoom(next);
}

function zoomToFit(): void {
  const wrap = document.getElementById('mapwrap')!;
  const { w, h } = baseSize();
  setZoom(Math.min(wrap.clientWidth / w, wrap.clientHeight / h, 2));
}

function centerOn(hex: HexKey, smooth: boolean): void {
  const wrap = document.getElementById('mapwrap');
  if (!wrap) return;
  const p = px(hex);
  wrap.scrollTo({ left: p.x * zoom - wrap.clientWidth / 2, top: p.y * zoom - wrap.clientHeight / 2, behavior: smooth ? 'smooth' : 'auto' });
}

function pulse(hex: HexKey | undefined): void {
  if (!hex) return;
  const svg = document.querySelector('#mapwrap svg');
  if (!svg) return;
  const p = px(hex);
  svg.insertAdjacentHTML('beforeend', `<circle class="pulse" cx="${p.x}" cy="${p.y}" r="${SIZE}"/>`);
  setTimeout(() => svg.querySelector('.pulse')?.remove(), 1600);
}

function scrollRowIntoView(id: UnitId): void {
  document.querySelector(`tr[data-unit="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

async function submit(): Promise<void> {
  const body = { orders: Object.fromEntries(Object.entries(orders).filter(([, p]) => p.length).map(([id, path]) => [id, { path }])) };
  const res = await fetch(`/api/p/${token}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json();
  if (!res.ok) { flash = { kind: 'warn', text: out.error }; return render(); }
  data.submittedAt = out.submittedAt;
  data.players.find((p) => p.id === data.me.id)!.submitted = true;
  dirty = false;
  render();
  // If everyone has now submitted, the turn resolves straight away; pick that up.
  setTimeout(async () => {
    const res2 = await fetch(`/api/p/${token}/view`);
    if (res2.ok && ((await res2.json()) as PlayerData).game.turn !== data.game.turn) load();
  }, 1200);
}

// ---------------------------------------------------------------- map

function renderMap(): void {
  const wrap = document.getElementById('mapwrap')!;
  const { cols, rows } = data.view.map;
  const { w, h } = baseSize();
  const visible = new Set(data.view.visibleHexes);
  const out: string[] = [];
  out.push(`<svg viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${(w * zoom).toFixed(0)}" height="${(h * zoom).toFixed(0)}" xmlns="http://www.w3.org/2000/svg">`);
  out.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>`);
  const showLabels = zoom >= 0.65;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hex = `${c},${r}`;
      const p = px(hex);
      out.push(`<polygon class="hex" data-hex="${hex}" points="${hexPoints(p.x, p.y)}" fill="${terrainAt(hex).color}"/>`);
      if (showLabels) out.push(`<text class="label" x="${p.x}" y="${p.y + SIZE * 0.62}">${label(hex)}</text>`);
      if (!visible.has(hex)) out.push(`<polygon class="fog" points="${hexPoints(p.x, p.y)}"/>`);
    }
  }
  for (const hex of data.view.objectives) {
    const p = px(hex);
    out.push(`<circle class="objective" cx="${p.x}" cy="${p.y}" r="${SIZE * 0.8}"/>`);
  }
  const sel = ownUnit(selected);
  if (sel && canOrder()) {
    for (const hex of reachable(sel).keys()) { const p = px(hex); out.push(`<polygon class="reach" points="${hexPoints(p.x, p.y)}"/>`); }
  }
  if (showReplay && data.lastTurn) {
    for (const e of data.lastTurn.events) {
      if (e.type === 'move' && e.path.length > 1) {
        out.push(`<polyline class="path" points="${polyline(e.path)}" stroke="${colorOf(e.owner)}" opacity=".45" marker-end="url(#arrow)"/>`);
      } else if (e.type === 'attack' && e.attackerHex) {
        out.push(`<polyline class="path" points="${polyline([e.attackerHex, e.targetHex])}" stroke="${e.hit ? '#d33' : '#555'}" stroke-dasharray="2 3" marker-end="url(#arrow)"/>`);
      }
    }
  }
  for (const u of myUnits()) {
    const path = orders[u.id];
    if (path?.length) {
      out.push(`<polyline class="path${u.id === selected ? ' active' : ''}" points="${polyline([u.hex, ...path])}" stroke="#fff" stroke-dasharray="6 4" marker-end="url(#arrow)"/>`);
    }
  }
  for (const g of data.view.ghosts) {
    const p = px(g.hex);
    out.push(`<g class="unit ghost${g.id === selected ? ' is-selected' : ''}"><circle cx="${p.x}" cy="${p.y}" r="${SIZE * 0.55}" stroke="${colorOf(g.owner)}"/><text x="${p.x}" y="${p.y}">${esc(g.code)}?</text></g>`);
  }
  for (const u of data.view.units) {
    const p = px(u.hex);
    out.push(`<g class="unit${u.id === selected ? ' is-selected' : ''}"><circle class="body" cx="${p.x}" cy="${p.y}" r="${SIZE * 0.6}" fill="${colorOf(u.owner)}"/>`
      + `<text x="${p.x}" y="${p.y - 1}">${esc(u.code)}</text>`
      + `<circle cx="${p.x + SIZE * 0.5}" cy="${p.y - SIZE * 0.45}" r="7" fill="#fffdf8" stroke="${colorOf(u.owner)}"/>`
      + `<text class="str" x="${p.x + SIZE * 0.5}" y="${p.y - SIZE * 0.45}">${u.strength}</text></g>`);
  }
  out.push('</svg>');
  wrap.innerHTML = out.join('');
  document.getElementById('zoomlevel')!.textContent = `${Math.round(zoom * 100)}%`;
}

// ---------------------------------------------------------------- side panel

function unitDesc(id: UnitId | null, owner: PlayerId, type?: string | null): string {
  const own = myUnits().find((u) => u.id === id);
  if (own) return own.name;
  return owner === data.me.id ? `your ${type ? dsName(type) : 'unit'}` : `${sideOf(owner)} ${type ? dsName(type) : 'unit'}`;
}

function describe(e: GameEvent): string {
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
    default: return (e as { type: string }).type;
  }
}

const involves = (e: GameEvent, id: UnitId): boolean => {
  switch (e.type) {
    case 'move': case 'halt': case 'destroyed': return e.unit === id;
    case 'clash': return e.units.includes(id);
    case 'attack': return e.attacker === id || e.target === id;
    default: return false;
  }
};

function timeLeft(ms: number): string {
  const d = ms - Date.now();
  if (d <= 0) return 'deadline passed, resolving shortly';
  const h = Math.floor(d / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  return h >= 48 ? `${Math.floor(h / 24)} days left` : h ? `${h}h ${m}m left` : `${m}m left`;
}

function orderText(u: OwnUnit): string {
  const p = orders[u.id];
  return p?.length ? `→ ${label(p[p.length - 1])}` : 'hold';
}

function strengthBar(strength: number, max: number, color: string): string {
  const pct = Math.max(0, Math.min(100, (strength / max) * 100));
  return `<span class="bar"><span style="width:${pct}%;background:${color}"></span></span>`;
}

function renderUnitTables(): string {
  const mine = myUnits();
  const rows = mine.map((u) => `<tr data-unit="${esc(u.id)}" class="${u.id === selected ? 'sel' : ''}">
      <td><span class="swatch" style="background:${colorOf(u.owner)}"></span></td>
      <td>${esc(u.name)}</td><td>${label(u.hex)}</td>
      <td>${u.strength}/${data.view.datasheets[u.type].strength}</td><td>${u.move}</td><td>${u.sight}</td>
      <td class="${orders[u.id]?.length ? 'moving' : 'muted'}">${orderText(u)}</td></tr>`).join('');
  const seen = enemies().map((u) => `<tr data-unit="${esc(u.id)}" class="${u.id === selected ? 'sel' : ''}">
      <td><span class="swatch" style="background:${colorOf(u.owner)}"></span></td>
      <td>${esc(sideOf(u.owner))} ${esc(dsName(u.type))}</td><td>${label(u.hex)}</td>
      <td>${u.strength}/${data.view.datasheets[u.type].strength}</td><td colspan="3">in sight</td></tr>`);
  const ghosts = data.view.ghosts.map((g) => `<tr data-unit="${esc(g.id)}" class="ghostrow ${g.id === selected ? 'sel' : ''}">
      <td><span class="swatch hollow" style="border-color:${colorOf(g.owner)}"></span></td>
      <td>${esc(sideOf(g.owner))} ${esc(dsName(g.type))}</td><td>${label(g.hex)}?</td>
      <td>?</td><td colspan="3">last seen turn ${g.turn}</td></tr>`);
  return `<div class="card units"><h3>Your units <span class="small">(${mine.length})</span></h3>
    ${mine.length ? `<div class="tablewrap"><table class="unittable">
      <thead><tr><th></th><th>Unit</th><th>Hex</th><th>Str</th><th>Mv</th><th>Sight</th><th>Orders</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<p class="small">No units remaining.</p>'}
    <h3 style="margin-top:12px">Enemy units <span class="small">(${seen.length} in sight${ghosts.length ? `, ${ghosts.length} last seen` : ''})</span></h3>
    ${seen.length + ghosts.length ? `<div class="tablewrap"><table class="unittable">
      <thead><tr><th></th><th>Unit</th><th>Hex</th><th>Str</th><th colspan="3">Status</th></tr></thead>
      <tbody>${seen.join('')}${ghosts.join('')}</tbody></table></div>` : '<p class="small">No enemies spotted.</p>'}
  </div>`;
}

function renderDatasheet(): string {
  if (!selected) return '';
  const own = ownUnit(selected);
  const enemy = enemies().find((u) => u.id === selected);
  const ghost: Ghost | undefined = data.view.ghosts.find((g) => g.id === selected);
  const unit = own ?? enemy ?? ghost;
  if (!unit) return '';
  const ds = data.view.datasheets[unit.type];
  const color = colorOf(unit.owner);
  const t = terrainAt(unit.hex);
  const title = own ? own.name : `${sideOf(unit.owner)} ${ds.name}`;
  const lastTurn = (data.lastTurn?.events ?? []).filter((e) => involves(e, unit.id));
  const strength = ghost ? null : (unit as OwnUnit | EnemyUnit).strength;

  let options = '';
  if (own && canOrder()) {
    const path = orders[own.id] || [];
    const used = pathCost(path);
    options = `<div class="ds-section"><h4>Orders</h4>
      <p>${path.length ? `Move to <b>${label(path[path.length - 1])}</b> via ${path.map(label).join(', ')}` : '<b>Hold position</b>'}
      <br><span class="small">Movement used ${used} of ${own.move}.</span></p>
      <p class="small">Click a highlighted hex on the map to extend the move; click the end of the path to step back.</p>
      <div class="row">
        <button class="secondary" data-action="undo" ${path.length ? '' : 'disabled'}>Undo step</button>
        <button class="secondary" data-action="hold" ${path.length ? '' : 'disabled'}>Hold position</button>
      </div></div>`;
  }
  return `<div class="card datasheet" style="border-top:4px solid ${color}">
    <div class="ds-head"><span class="counter" style="background:${ghost ? 'transparent' : color};border-color:${color};color:${ghost ? color : '#fff'}">${esc(ds.code)}</span>
      <div><h3>${esc(title)}</h3><div class="small">${esc(ds.name)}${own ? '' : ` · ${esc(player(unit.owner)?.name ?? '')}`}</div></div>
      <button class="close" data-action="close" aria-label="Close">×</button></div>
    ${ghost ? `<p class="small">Out of sight. Last seen at <b>${label(ghost.hex)}</b> on turn ${ghost.turn}.</p>` : ''}
    <table class="stats">
      <tr><th>Strength</th><td>${strength === null ? '?' : `${strength} / ${ds.strength} ${strengthBar(strength, ds.strength, color)}`}</td></tr>
      <tr><th>Move</th><td>${ds.move}</td></tr>
      <tr><th>Sight</th><td>${ds.sight}${t.sightBonus && !ghost ? ` <span class="small">(+${t.sightBonus} from ${t.name.toLowerCase()})</span>` : ''}</td></tr>
      <tr><th>Location</th><td>${label(unit.hex)} · ${t.name}${t.defense ? ` <span class="small">(cover ${t.defense})</span>` : ''}</td></tr>
    </table>
    ${options}
    ${lastTurn.length ? `<div class="ds-section"><h4>Last turn</h4><ul class="log">${lastTurn.map((e) => `<li>${esc(describe(e))}</li>`).join('')}</ul></div>` : ''}
    <div class="row"><button class="link" data-action="center">Show on map</button></div>
  </div>`;
}

function renderSide(): string {
  const g = data.game;
  const finished = g.status === 'finished';
  const scores = data.view.scores;
  const eliminated = new Set(data.view.eliminated);
  const log = data.lastTurn?.events.length
    ? `<ol class="log">${data.lastTurn.events.map((e) => `<li>${esc(describe(e))}</li>`).join('')}</ol>`
    : '<p class="small">Nothing to report.</p>';
  const moving = myUnits().filter((u) => orders[u.id]?.length).length;
  return `
    <div class="card"><h3>${esc(g.name)}</h3>
      <div>${finished ? 'Final turn' : `Turn ${g.turn}`} of ${data.view.turnLimit}</div>
      ${g.deadline && !finished ? `<div class="small">Orders due ${esc(new Date(g.deadline).toLocaleString())} (${timeLeft(g.deadline)})</div>` : ''}
      <ul class="players">${data.players.map((p) => `<li><span class="swatch" style="background:${SIDE_COLORS[p.side]}"></span>
        ${esc(p.name)}${p.id === data.me.id ? ' (you)' : ''} — ${scores[p.id] ?? 0} pts
        ${eliminated.has(p.id) ? '<span class="small">eliminated</span>' : !finished ? `<span class="small">${p.submitted ? '✓ orders in' : 'thinking…'}</span>` : ''}</li>`).join('')}</ul>
      ${canOrder() ? `<div class="row submitrow"><button data-action="submit">${data.submittedAt && !dirty ? 'Resubmit orders' : 'Submit orders'}</button>
        <span class="small">${moving} moving, ${myUnits().length - moving} holding</span></div>` : ''}
    </div>
    ${renderDatasheet()}
    ${renderUnitTables()}
    <div class="card"><h3>${data.lastTurn ? `Turn ${data.lastTurn.turn} report` : 'Report'}</h3>
      ${data.lastTurn ? `<label class="small"><input type="checkbox" data-action="replay" ${showReplay ? 'checked' : ''}> show on map</label>${log}` : '<p class="small">The battle has just begun.</p>'}</div>`;
}

function renderBanner(): string {
  const finished = data.game.status === 'finished';
  if (flash) return `<div class="banner ${flash.kind}">${esc(flash.text)}</div>`;
  if (finished) {
    const winners = (data.view.result?.winners || []).map((id) => player(id)?.name).join(' and ');
    return `<div class="banner ok">The battle is over. ${esc(data.view.result?.reason)} ${winners ? `Victory: ${esc(winners)}.` : ''}</div>`;
  }
  if (!myUnits().length) return '<div class="banner warn">Your army has been destroyed. You can still watch the battle.</div>';
  if (dirty) return '<div class="banner warn">You have unsaved changes to your orders.</div>';
  if (data.submittedAt) return `<div class="banner ok">Orders for turn ${data.game.turn} submitted ${new Date(data.submittedAt).toLocaleString()}. You can change them until the deadline.</div>`;
  return '';
}

// ---------------------------------------------------------------- page

let shellBuilt = false;

function buildShell(): void {
  app.innerHTML = `
<div id="banner"></div>
<div class="game">
  <div class="mapcol">
    <div class="maptools">
      <button class="secondary small-btn" data-zoom="out" aria-label="Zoom out">−</button>
      <span id="zoomlevel" class="small"></span>
      <button class="secondary small-btn" data-zoom="in" aria-label="Zoom in">+</button>
      <button class="secondary small-btn" data-zoom="fit">Fit map</button>
      <span class="small hint-inline">Scroll or drag to pan · click a unit for its datasheet</span>
    </div>
    <div class="mapwrap" id="mapwrap"></div>
    <div class="legend">${Object.values(TERRAIN).map((t) => `<span><i style="background:${t.color}"></i>${t.name}</span>`).join('')}
      <span>◌ objective</span><span>dark = not in sight</span><span>dashed circle = last seen</span></div>
  </div>
  <aside class="side" id="side"></aside>
</div>`;
  const wrap = document.getElementById('mapwrap')!;
  const side = document.getElementById('side')!;

  // Click on the map (ignoring the end of a drag).
  let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  wrap.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'mouse' || ev.button !== 0) return; // touch screens scroll natively
    drag = { x: ev.clientX, y: ev.clientY, left: wrap.scrollLeft, top: wrap.scrollTop, moved: false };
  });
  wrap.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 6) { drag.moved = true; wrap.classList.add('dragging'); }
    if (drag.moved) { wrap.scrollLeft = drag.left - dx; wrap.scrollTop = drag.top - dy; }
  });
  const endDrag = () => { wrap.classList.remove('dragging'); setTimeout(() => { drag = null; }, 0); };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointerleave', endDrag);
  wrap.addEventListener('click', (ev) => {
    if (drag?.moved) return;
    const hex = (ev.target as Element).closest<SVGElement>('[data-hex]')?.dataset.hex;
    if (hex) onHexClick(hex);
  });

  document.querySelector('.maptools')!.addEventListener('click', (ev) => {
    const z = (ev.target as Element).closest<HTMLElement>('[data-zoom]')?.dataset.zoom;
    if (z === 'in') zoomStep(1);
    else if (z === 'out') zoomStep(-1);
    else if (z === 'fit') zoomToFit();
  });

  side.addEventListener('click', (ev) => {
    const target = ev.target as Element;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'submit') return void submit();
    if (action === 'close') { selected = null; return render(); }
    if (action === 'center' && selected) return focusUnit(selected);
    if (action === 'undo' && selected) { orders[selected] = (orders[selected] || []).slice(0, -1); dirty = true; return render(); }
    if (action === 'hold' && selected) { orders[selected] = []; dirty = true; return render(); }
    const row = target.closest<HTMLElement>('tr[data-unit]');
    if (row) focusUnit(row.dataset.unit!);
  });
  side.addEventListener('change', (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.dataset.action === 'replay') { showReplay = input.checked; renderMap(); }
  });
  shellBuilt = true;
}

function render(): void {
  if (!shellBuilt) buildShell();
  document.getElementById('banner')!.innerHTML = renderBanner();
  renderMap();
  const side = document.getElementById('side')!;
  const scrolls = [...side.querySelectorAll('.tablewrap, .log')].map((el) => el.scrollTop);
  side.innerHTML = renderSide();
  [...side.querySelectorAll('.tablewrap, .log')].forEach((el, i) => { el.scrollTop = scrolls[i] ?? 0; });
  flash = null;
}

window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
load();
