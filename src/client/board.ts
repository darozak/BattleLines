// The battle board: a scrollable, zoomable hex map with a side panel (unit tables, datasheets,
// orders, reports). Clicking a unit, in the table or on the map, zooms the map to it and opens
// its datasheet; for the player's own units the datasheet has their move and facing orders.
import { parse, neighbors, toPixel, label, facingToward, FACING_ANGLES, FACING_ARROWS, FACING_NAMES } from '../shared/hex.js';
import { TERRAIN } from '../shared/terrain.js';
import type {
  Facing, GameEvent, HexKey, PlayerId, PlayerOrders, PlayerView, Terrain, UnitId, VisibleUnit,
} from '../shared/types.js';
import { esc } from './util.js';

type OwnUnit = Extract<VisibleUnit, { own: true }>;
type EnemyUnit = Extract<VisibleUnit, { own: false }>;
/** A unit's planned order: a move path and, optionally, the facing to end with. */
interface Plan { path: HexKey[]; facing?: Facing }

export const SIDE_COLORS = ['#2b6cb0', '#c53030', '#2f855a', '#b7791f'];
export const SIDE_NAMES = ['Blue', 'Red', 'Green', 'Gold'];

export interface BoardPlayer { id: PlayerId; name: string; side: number }

export interface BoardContext {
  gameName: string;
  round: number;
  turnLimit: number;
  players: BoardPlayer[];
  /** Whose turn it is (null when the game is over). */
  current: PlayerId | null;
  /** The player giving (or who just gave) orders, or null when just looking. */
  me: PlayerId | null;
  view: PlayerView;
  /** 'orders': the viewer is giving orders. 'review': read-only. */
  mode: 'orders' | 'review';
  /** Report sections shown in the side panel and drawn on the map. */
  reports: { title: string; events: GameEvent[] }[];
  /** A notice above the board (HTML). */
  notice?: { kind: 'ok' | 'warn'; html: string };
  /** Extra card at the top of the side panel (HTML), e.g. the "send this link" panel. */
  topCard?: string;
  onEndTurn?: (orders: PlayerOrders) => Promise<void>;
  /** Called after each render so the page can wire up its own buttons in topCard. */
  afterRender?: (root: HTMLElement) => void;
}

const SIZE = 24;                 // hex radius in map units (before zoom)
const MARGIN = 14;
const ZOOMS = [0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];
const FOCUS_ZOOM = 1.25;         // minimum zoom when jumping to a unit

export function mountBoard(app: HTMLElement, ctx: BoardContext): void {
  let orders: Record<UnitId, Plan> = {};
  let selected: UnitId | null = null;
  let showReplay = true;
  let dirty = false;
  let busy = false;
  let zoom = 1;
  const view = ctx.view;

  // ---------------------------------------------------------------- helpers

  const terrainAt = (hex: HexKey): Terrain => { const { col, row } = parse(hex); return TERRAIN[view.map.terrain[row * view.map.cols + col]]; };
  const player = (id: PlayerId) => ctx.players.find((p) => p.id === id);
  const colorOf = (ownerId: PlayerId) => SIDE_COLORS[player(ownerId)?.side ?? 0];
  const sideOf = (ownerId: PlayerId) => SIDE_NAMES[player(ownerId)?.side ?? 0];
  const myUnits = (): OwnUnit[] => view.units.filter((u): u is OwnUnit => u.own);
  const others = (): EnemyUnit[] => view.units.filter((u): u is EnemyUnit => !u.own);
  const canOrder = () => ctx.mode === 'orders' && myUnits().length > 0;
  const ownUnit = (id: UnitId | null) => (id ? myUnits().find((u) => u.id === id) : undefined);
  const dsName = (type: string) => view.datasheets[type]?.name ?? type;
  const pathCost = (path: HexKey[]) => path.reduce((s, h) => s + terrainAt(h).cost, 0);
  const pathOf = (id: UnitId): HexKey[] => orders[id]?.path ?? [];
  const hasOrders = (id: UnitId) => pathOf(id).length > 0 || orders[id]?.facing !== undefined;
  const setPath = (id: UnitId, path: HexKey[]) => { orders[id] = { ...orders[id], path }; dirty = true; };
  const reportEvents = () => ctx.reports.flatMap((r) => r.events);

  /** Where a unit will end up and which way it will face, if its orders are carried out. */
  function plannedEnd(u: OwnUnit): { hex: HexKey; facing: Facing; auto: boolean } {
    const path = pathOf(u.id);
    const hex = path.length ? path[path.length - 1] : u.hex;
    const ordered = orders[u.id]?.facing;
    if (ordered !== undefined) return { hex, facing: ordered, auto: false };
    if (path.length) return { hex, facing: facingToward(path.length > 1 ? path[path.length - 2] : u.hex, hex), auto: true };
    return { hex, facing: u.facing, auto: true };
  }

  function baseSize() {
    const { cols, rows } = view.map;
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

  // Cheapest paths from the end of a unit's current planned path, within its remaining movement.
  function reachable(unit: OwnUnit): Map<HexKey, { cost: number; prev: HexKey }> {
    const path = pathOf(unit.id);
    const start = path.length ? path[path.length - 1] : unit.hex;
    const budget = unit.move - pathCost(path);
    const { cols, rows } = view.map;
    // Can't enter visible enemies, or friendly units that are staying put (no stacking).
    const blocked = new Set(view.units
      .filter((u) => !u.own || (u.id !== unit.id && !pathOf(u.id).length))
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
      const path = pathOf(unit.id);
      if (path.length && hex === path[path.length - 1]) { // click the end of the path to step back
        setPath(unit.id, path.slice(0, -1));
        return render();
      }
      const reach = reachable(unit);
      if (reach.has(hex)) {
        const steps: HexKey[] = [];
        for (let h = hex; reach.has(h); h = reach.get(h)!.prev) steps.unshift(h);
        setPath(unit.id, [...path, ...steps]);
        return render();
      }
    }
    const here = view.units.find((u) => u.hex === hex);
    selected = here && here.id !== selected ? here.id : null;
    render();
    if (selected) document.querySelector(`tr[data-unit="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  /** Select a unit: zoom the map to it and open its datasheet. */
  function focusUnit(id: UnitId): void {
    selected = id;
    const hex = view.units.find((u) => u.id === id)?.hex;
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
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i === -1 ? ZOOMS.length - 1 : i) + dir))]);
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

  async function endTurn(): Promise<void> {
    if (!ctx.onEndTurn || busy) return;
    const n = myUnits().filter((u) => hasOrders(u.id)).length;
    if (!confirm(`End your turn? ${n} of ${myUnits().length} units have orders. You can't change them afterwards.`)) return;
    busy = true;
    render();
    const out: PlayerOrders = Object.fromEntries(Object.entries(orders)
      .filter(([id]) => hasOrders(id))
      .map(([id, o]) => [id, o.facing === undefined ? { path: o.path } : { path: o.path, facing: o.facing }]));
    dirty = false;
    await ctx.onEndTurn(out);
  }

  // ---------------------------------------------------------------- map

  /** A small triangle on the edge of a counter pointing the way the unit faces. */
  function facingWedge(hex: HexKey, facing: Facing, color: string, cls = 'facing'): string {
    const p = px(hex);
    const a = (FACING_ANGLES[facing] * Math.PI) / 180;
    const r = SIZE * 0.6;
    const at = (dist: number, side: number) =>
      `${(p.x + Math.cos(a) * dist - Math.sin(a) * side).toFixed(1)},${(p.y + Math.sin(a) * dist + Math.cos(a) * side).toFixed(1)}`;
    return `<polygon class="${cls}" points="${at(r + 8, 0)} ${at(r - 2, -6)} ${at(r - 2, 6)}" fill="${color}"/>`;
  }

  function renderMap(): void {
    const wrap = document.getElementById('mapwrap')!;
    const { cols, rows } = view.map;
    const { w, h } = baseSize();
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
      }
    }
    for (const hex of view.objectives) {
      const p = px(hex);
      out.push(`<circle class="objective" cx="${p.x}" cy="${p.y}" r="${SIZE * 0.8}"/>`);
    }
    const sel = ownUnit(selected);
    if (sel && canOrder()) {
      for (const hex of reachable(sel).keys()) { const p = px(hex); out.push(`<polygon class="reach" points="${hexPoints(p.x, p.y)}"/>`); }
    }
    if (showReplay) {
      for (const e of reportEvents()) {
        if (e.type === 'move' && e.path.length > 1) {
          out.push(`<polyline class="path" points="${polyline(e.path)}" stroke="${colorOf(e.owner)}" opacity=".45" marker-end="url(#arrow)"/>`);
        } else if (e.type === 'attack' && e.attackerHex) {
          out.push(`<polyline class="path" points="${polyline([e.attackerHex, e.targetHex])}" stroke="${e.hit ? '#d33' : '#555'}" stroke-dasharray="2 3" marker-end="url(#arrow)"/>`);
        }
      }
    }
    for (const u of myUnits()) {
      const path = pathOf(u.id);
      if (path.length) {
        out.push(`<polyline class="path${u.id === selected ? ' active' : ''}" points="${polyline([u.hex, ...path])}" stroke="#fff" stroke-dasharray="6 4"/>`);
      }
      // Planned end position and facing, as a dashed outline.
      const end = plannedEnd(u);
      if (path.length || end.facing !== u.facing) {
        const p = px(end.hex);
        out.push(`<g class="planned"><circle cx="${p.x}" cy="${p.y}" r="${SIZE * 0.6}" stroke="${colorOf(u.owner)}"/>${facingWedge(end.hex, end.facing, colorOf(u.owner), 'facing planned-facing')}</g>`);
      }
    }
    for (const u of view.units) {
      const p = px(u.hex);
      out.push(`<g class="unit${u.id === selected ? ' is-selected' : ''}">${facingWedge(u.hex, u.facing, colorOf(u.owner))}<circle class="body" cx="${p.x}" cy="${p.y}" r="${SIZE * 0.6}" fill="${colorOf(u.owner)}"/>`
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
    const other = others().find((u) => u.id === id);
    if (other) return `${sideOf(owner)} ${other.name}`;
    return `${owner === ctx.me ? 'your' : sideOf(owner)} ${type ? dsName(type) : 'unit'}`;
  }

  function describe(e: GameEvent): string {
    switch (e.type) {
      case 'move': {
        return `${unitDesc(e.unit, e.owner, e.unitType)} moved ${label(e.path[0])} → ${label(e.path[e.path.length - 1])}.`;
      }
      case 'halt': return `${unitDesc(e.unit, e.owner)} halted at ${label(e.hex)}: ${e.reason}.`;
      case 'turn': return `${unitDesc(e.unit, e.owner, e.unitType)} at ${label(e.hex)} turned to face ${FACING_NAMES[e.facing]}.`;
      case 'clash': return `Opposing units collided at ${label(e.hex)}.`;
      case 'attack': {
        const roll = `rolled ${e.dice.join('+')}${e.cover ? ` −${e.cover} cover` : ''}`;
        const target = unitDesc(e.target, e.targetOwner, e.targetType);
        const arc = e.arc === 'front' ? '' : ` in the ${e.arc}`;
        return `${unitDesc(e.attacker, e.attackerOwner, e.attackerType)} attacked ${target}${arc}: ${roll} — ${e.hit ? 'hit!' : 'miss'}.`;
      }
      case 'destroyed': return `${unitDesc(e.unit, e.owner, e.unitType)} destroyed at ${label(e.hex)}.`;
      case 'score': return `${player(e.player)?.name ?? 'Someone'} scored ${e.points} for holding ${label(e.hex)}.`;
      case 'gameover': return `Game over. ${e.reason}`;
      default: return (e as { type: string }).type;
    }
  }

  const involves = (e: GameEvent, id: UnitId): boolean => {
    switch (e.type) {
      case 'move': case 'halt': case 'turn': case 'destroyed': return e.unit === id;
      case 'clash': return e.units.includes(id);
      case 'attack': return e.attacker === id || e.target === id;
      default: return false;
    }
  };

  function orderText(u: OwnUnit): string {
    const path = pathOf(u.id);
    const end = plannedEnd(u);
    const turn = end.facing !== u.facing || !end.auto ? ` ${FACING_ARROWS[end.facing]}` : '';
    if (path.length) return `to ${label(end.hex)}${turn}`;
    return orders[u.id]?.facing !== undefined && end.facing !== u.facing ? `turn ${FACING_ARROWS[end.facing]}` : 'hold';
  }
  const arrow = (f: Facing) => `<span class="arrow" title="facing ${FACING_NAMES[f]}">${FACING_ARROWS[f]}</span>`;

  function strengthBar(strength: number, max: number, color: string): string {
    const pct = Math.max(0, Math.min(100, (strength / max) * 100));
    return `<span class="bar"><span style="width:${pct}%;background:${color}"></span></span>`;
  }

  function renderUnitTables(): string {
    const mine = myUnits();
    const rows = mine.map((u) => `<tr data-unit="${esc(u.id)}" class="${u.id === selected ? 'sel' : ''}">
        <td><span class="swatch" style="background:${colorOf(u.owner)}"></span></td>
        <td>${esc(u.name)}</td><td>${label(u.hex)} ${arrow(u.facing)}</td>
        <td>${u.strength}/${view.datasheets[u.type].strength}</td><td>${u.move}</td><td>${u.sight}</td>
        <td class="${hasOrders(u.id) ? 'moving' : 'muted'}">${ctx.mode === 'orders' ? orderText(u) : ''}</td></tr>`).join('');
    const seen = others().map((u) => `<tr data-unit="${esc(u.id)}" class="${u.id === selected ? 'sel' : ''}">
        <td><span class="swatch" style="background:${colorOf(u.owner)}"></span></td>
        <td>${esc(u.name)}</td><td>${label(u.hex)} ${arrow(u.facing)}</td>
        <td>${u.strength}/${view.datasheets[u.type].strength}</td><td colspan="3">${esc(player(u.owner)?.name)}</td></tr>`);
    const ownTable = ctx.me ? `<h3>Your units <span class="small">(${mine.length})</span></h3>
      ${mine.length ? `<div class="tablewrap"><table class="unittable">
        <thead><tr><th></th><th>Unit</th><th>Hex</th><th>Str</th><th>Mv</th><th>Sight</th><th>${ctx.mode === 'orders' ? 'Orders' : ''}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<p class="small">No units remaining.</p>'}` : '';
    const otherTitle = `${ctx.me ? 'Enemy units' : 'All units'} <span class="small">(${seen.length})</span>`;
    return `<div class="card units">${ownTable}
      <h3 ${ctx.me ? 'style="margin-top:12px"' : ''}>${otherTitle}</h3>
      ${seen.length ? `<div class="tablewrap"><table class="unittable">
        <thead><tr><th></th><th>Unit</th><th>Hex</th><th>Str</th><th colspan="3">Player</th></tr></thead>
        <tbody>${seen.join('')}</tbody></table></div>` : '<p class="small">No enemy units left.</p>'}
    </div>`;
  }

  function renderDatasheet(): string {
    if (!selected) return '';
    const own = ownUnit(selected);
    const enemy = others().find((u) => u.id === selected);
    const unit = own ?? enemy;
    if (!unit) return '';
    const ds = view.datasheets[unit.type];
    const color = colorOf(unit.owner);
    const t = terrainAt(unit.hex);
    const title = own ? own.name : `${sideOf(unit.owner)} ${unit.name}`;
    const history = reportEvents().filter((e) => involves(e, unit.id));

    let options = '';
    if (own && canOrder()) {
      const path = pathOf(own.id);
      const used = pathCost(path);
      const end = plannedEnd(own);
      // Compass laid out like the hexsides: NW NE / W E / SW SE.
      const compass = ([2, 1, 3, 0, 4, 5] as Facing[]).map((f) => `<button class="face${end.facing === f ? ' on' : ''}${own.facing === f ? ' current' : ''}"
          data-action="face" data-facing="${f}" title="Face ${FACING_NAMES[f]}">${FACING_ARROWS[f]}</button>`).join('');
      options = `<div class="ds-section"><h4>Orders</h4>
        <p>${path.length ? `Move to <b>${label(path[path.length - 1])}</b> via ${path.map(label).join(', ')}` : '<b>Hold position</b>'}
        <br><span class="small">Movement used ${used} of ${own.move}.</span></p>
        <p class="small">Click a highlighted hex on the map to extend the move; click the end of the path to step back.</p>
        <div class="row">
          <button class="secondary" data-action="undo" ${path.length ? '' : 'disabled'}>Undo step</button>
          <button class="secondary" data-action="hold" ${path.length ? '' : 'disabled'}>Hold position</button>
        </div>
        <h4>Facing at end of turn</h4>
        <div class="facing-row"><div class="compass">${compass}</div>
          <div class="small">Ends facing <b>${FACING_NAMES[end.facing]}</b> ${FACING_ARROWS[end.facing]}
            ${end.auto ? (path.length ? '(direction of last step)' : '(unchanged)') : '(ordered)'}<br>
            ${end.auto ? '' : '<button class="link" data-action="face-auto">Clear facing order</button>'}</div></div></div>`;
    }
    return `<div class="card datasheet" style="border-top:4px solid ${color}">
      <div class="ds-head"><span class="counter" style="background:${color};border-color:${color};color:#fff">${esc(ds.code)}</span>
        <div><h3>${esc(title)}</h3><div class="small">${esc(ds.name)}${own ? '' : ` · ${esc(player(unit.owner)?.name ?? '')}`}</div></div>
        <button class="close" data-action="close" aria-label="Close">×</button></div>
      <table class="stats">
        <tr><th>Strength</th><td>${unit.strength} / ${ds.strength} ${strengthBar(unit.strength, ds.strength, color)}</td></tr>
        <tr><th>Move</th><td>${ds.move}</td></tr>
        <tr><th>Facing</th><td>${FACING_NAMES[unit.facing]} ${FACING_ARROWS[unit.facing]}</td></tr>
        <tr><th>Sight</th><td>${ds.sight}${t.sightBonus ? ` <span class="small">(+${t.sightBonus} from ${t.name.toLowerCase()})</span>` : ''}</td></tr>
        <tr><th>Location</th><td>${label(unit.hex)} · ${t.name}${t.defense ? ` <span class="small">(cover ${t.defense})</span>` : ''}</td></tr>
      </table>
      ${options}
      ${history.length ? `<div class="ds-section"><h4>Recently</h4><ul class="log">${history.map((e) => `<li>${esc(describe(e))}</li>`).join('')}</ul></div>` : ''}
      <div class="row"><button class="link" data-action="center">Show on map</button></div>
    </div>`;
  }

  function renderSide(): string {
    const finished = view.finished;
    const eliminated = new Set(view.eliminated);
    const moving = myUnits().filter((u) => hasOrders(u.id)).length;
    const reports = ctx.reports.filter((r) => r.events.length);
    return `
      ${ctx.topCard ?? ''}
      <div class="card"><h3>${esc(ctx.gameName)}</h3>
        <div>${finished ? 'Final round' : `Round ${ctx.round}`} of ${ctx.turnLimit}</div>
        <ul class="players">${ctx.players.map((p) => `<li><span class="swatch" style="background:${SIDE_COLORS[p.side]}"></span>
          ${esc(p.name)}${p.id === ctx.me ? ' (you)' : ''} — ${view.scores[p.id] ?? 0} pts
          ${eliminated.has(p.id) ? '<span class="small">eliminated</span>' : p.id === ctx.current ? '<span class="small">◀ to move</span>' : ''}</li>`).join('')}</ul>
        ${canOrder() ? `<div class="row submitrow"><button data-action="end-turn" ${busy ? 'disabled' : ''}>${busy ? 'Ending turn…' : 'End turn'}</button>
          <span class="small">${moving} with orders, ${myUnits().length - moving} holding</span></div>` : ''}
      </div>
      ${renderDatasheet()}
      ${renderUnitTables()}
      <div class="card"><h3>Reports</h3>
        ${reports.length ? `<label class="small"><input type="checkbox" data-action="replay" ${showReplay ? 'checked' : ''}> show on map</label>
          ${reports.map((r) => `<h4>${esc(r.title)}</h4><ol class="log">${r.events.map((e) => `<li>${esc(describe(e))}</li>`).join('')}</ol>`).join('')}`
          : '<p class="small">Nothing to report.</p>'}</div>`;
  }

  function renderBanner(): string {
    const parts: string[] = [];
    if (ctx.notice) parts.push(`<div class="banner ${ctx.notice.kind}">${ctx.notice.html}</div>`);
    if (view.finished) {
      const winners = (view.result?.winners || []).map((id) => player(id)?.name).join(' and ');
      parts.push(`<div class="banner ok">The battle is over. ${esc(view.result?.reason)} ${winners ? `Victory: ${esc(winners)}.` : ''}</div>`);
    } else if (ctx.me && !myUnits().length) parts.push('<div class="banner warn">Your army has been destroyed.</div>');
    else if (dirty) parts.push('<div class="banner warn">Your orders are not sent until you end your turn.</div>');
    return parts.join('');
  }

  // ---------------------------------------------------------------- page

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
      <span>◌ objective</span><span>dashed outline = planned move</span></div>
  </div>
  <aside class="side" id="side"></aside>
</div>`;
  const wrap = document.getElementById('mapwrap')!;
  const side = document.getElementById('side')!;

  // Click on the map (ignoring the end of a mouse drag; touch screens scroll natively).
  let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  wrap.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
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

  app.querySelector('.maptools')!.addEventListener('click', (ev) => {
    const z = (ev.target as Element).closest<HTMLElement>('[data-zoom]')?.dataset.zoom;
    if (z === 'in') zoomStep(1);
    else if (z === 'out') zoomStep(-1);
    else if (z === 'fit') zoomToFit();
  });

  side.addEventListener('click', (ev) => {
    const target = ev.target as Element;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'end-turn') return void endTurn();
    if (action === 'close') { selected = null; return render(); }
    if (action === 'center' && selected) return focusUnit(selected);
    if (action === 'undo' && selected) { setPath(selected, pathOf(selected).slice(0, -1)); return render(); }
    if (action === 'hold' && selected) { setPath(selected, []); return render(); }
    if (action === 'face' && selected) {
      const f = Number(target.closest<HTMLElement>('[data-facing]')!.dataset.facing) as Facing;
      orders[selected] = { ...orders[selected], path: pathOf(selected), facing: f };
      dirty = true;
      return render();
    }
    if (action === 'face-auto' && selected) { orders[selected] = { path: pathOf(selected) }; dirty = true; return render(); }
    const row = target.closest<HTMLElement>('tr[data-unit]');
    if (row) focusUnit(row.dataset.unit!);
  });
  side.addEventListener('change', (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.dataset.action === 'replay') { showReplay = input.checked; renderMap(); }
  });
  window.onbeforeunload = (e) => { if (dirty) e.preventDefault(); };

  function render(): void {
    document.getElementById('banner')!.innerHTML = renderBanner();
    renderMap();
    const scrolls = [...side.querySelectorAll('.tablewrap, .log')].map((el) => el.scrollTop);
    side.innerHTML = renderSide();
    [...side.querySelectorAll('.tablewrap, .log')].forEach((el, i) => { el.scrollTop = scrolls[i] ?? 0; });
    ctx.afterRender?.(app);
  }

  render();
  // Start centred on the player's own forces (or the middle of the map).
  const mine = myUnits();
  centerOn(mine.length ? mine[Math.floor(mine.length / 2)].hex : `${Math.floor(view.map.cols / 2)},${Math.floor(view.map.rows / 2)}`, false);
}
