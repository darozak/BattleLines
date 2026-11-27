// The battle board: a scrollable, zoomable hex map with a side panel (unit tables, datasheets,
// orders, reports). Clicking a unit, in the table or on the map, zooms the map to it and opens
// its datasheet; for the player's own units the datasheet has their move and facing orders.
import { parse, neighbors, distance, inBounds, toPixel, label, facingToward, FACING_ANGLES, FACING_ARROWS, FACING_NAMES } from '../shared/hex.js';
import { TERRAIN, stepCost, fordsRiver } from '../shared/terrain.js';
import type {
  AttackEvent, MoraleEvent, Facing, GameEvent, HexKey, PlayerId, PlayerOrders, PlayerView, Terrain, UnitId, VisibleUnit,
} from '../shared/types.js';
import type { AttackOption, TurnPreview } from '../shared/engine.js';
import { RALLY_RANGE, FIRE_FULL_RANGE } from '../shared/engine.js';
import type { Army, Deployment, Placement } from '../shared/setup.js';
import { esc } from './util.js';

type OwnUnit = Extract<VisibleUnit, { own: true }>;
type EnemyUnit = Extract<VisibleUnit, { own: false }>;
/** A unit's planned order: a move path and, optionally, the facing to end with. */
interface Plan { path: HexKey[]; facing?: Facing; target?: UnitId }

export const SIDE_COLORS = ['#2b6cb0', '#c53030', '#2f855a', '#b7791f'];
export const SIDE_NAMES = ['Blue', 'Red', 'Green', 'Gold'];

export interface BoardPlayer { id: PlayerId; name: string; side: number; army?: string }

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
  /** 'orders': giving orders. 'deploy': turn 0, picking an army and placing units. 'review': read-only. */
  mode: 'orders' | 'review' | 'deploy';
  /** Turn 0 (deploy mode): the era's armies, the player's starting zone and the point limit. */
  deploy?: { armies: Army[]; taken: Record<string, string>; zone: HexKey[]; pointLimit: number; onFinish: (d: Deployment) => Promise<void> };
  /** Report sections shown in the side panel and drawn on the map. */
  reports: { title: string; events: GameEvent[] }[];
  /** A notice above the board (HTML). */
  notice?: { kind: 'ok' | 'warn'; html: string };
  /** Extra card at the top of the side panel (HTML), e.g. the "send this link" panel. */
  topCard?: string;
  onEndTurn?: (orders: PlayerOrders) => Promise<void>;
  /** Exactly what ending the turn with these orders would do (orders mode). */
  preview?: (orders: PlayerOrders) => TurnPreview;
  /** The enemies a unit could attack from a hex, each with its tally sheet. */
  attackOptions?: (unitId: UnitId, hex: HexKey, facing: Facing) => AttackOption[];
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
  const elevationAt = (hex: HexKey): number => { const { col, row } = parse(hex); return view.map.elevation[row * view.map.cols + col] ?? 0; };
  const maxElevation = Math.max(0, ...view.map.elevation);
  const player = (id: PlayerId) => ctx.players.find((p) => p.id === id);
  const colorOf = (ownerId: PlayerId) => SIDE_COLORS[player(ownerId)?.side ?? 0];
  const sideOf = (ownerId: PlayerId) => SIDE_NAMES[player(ownerId)?.side ?? 0];
  // ---- turn 0: the army being picked and the units being placed
  let army: Army | null = null;
  let placements: Placement[] = [];
  let placing: string | null = null; // unit type to place with the next click in the zone
  const zone = new Set(ctx.deploy?.zone ?? []);
  const spent = () => placements.reduce((n, pl) => n + (view.datasheets[pl.type]?.points ?? 0), 0);
  const middle = `${Math.floor(view.map.cols / 2)},${Math.floor(view.map.rows / 2)}`;
  /** Units being placed, shown like the player's own units. */
  function pendingUnits(): OwnUnit[] {
    const counts: Record<string, number> = {};
    return placements.map((pl, i) => {
      const ds = view.datasheets[pl.type];
      counts[pl.type] = (counts[pl.type] || 0) + 1;
      return { ...ds, id: `new${i}`, owner: ctx.me ?? '', type: pl.type, name: `${ds.name} ${counts[pl.type]}`, hex: pl.hex,
        facing: pl.facing ?? facingToward(pl.hex, middle), strength: ds.strength, own: true as const };
    });
  }
  const units = (): VisibleUnit[] => (ctx.mode === 'deploy' ? [...view.units, ...pendingUnits()] : view.units);
  const myUnits = (): OwnUnit[] => units().filter((u): u is OwnUnit => u.own);
  const others = (): EnemyUnit[] => units().filter((u): u is EnemyUnit => !u.own);
  const canOrder = () => ctx.mode === 'orders' && myUnits().length > 0;
  const ownUnit = (id: UnitId | null) => (id ? myUnits().find((u) => u.id === id) : undefined);
  const dsName = (type: string) => view.datasheets[type]?.name ?? type;
  /** Movement used by a path from `start` (roads, rivers and bridges change each step's cost). */
  const pathCost = (start: HexKey, path: HexKey[]) => path.reduce((s, h, i) => s + stepCost(view.map, i ? path[i - 1] : start, h), 0);
  const pathOf = (id: UnitId): HexKey[] => orders[id]?.path ?? [];
  const hasOrders = (id: UnitId) => pathOf(id).length > 0 || orders[id]?.facing !== undefined || orders[id]?.target !== undefined;
  /** The orders as the rules engine takes them. */
  const toOrders = (): PlayerOrders => Object.fromEntries(Object.entries(orders)
    .filter(([id]) => hasOrders(id))
    .map(([id, o]) => [id, { path: o.path, ...(o.facing !== undefined ? { facing: o.facing } : {}), ...(o.target ? { target: o.target } : {}) }]));
  let pv: TurnPreview | null = null; // what ending the turn now would do
  const pvAttacks = (): AttackEvent[] => (pv?.events ?? []).filter((e): e is AttackEvent => e.type === 'attack');
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

  function hexPoints(cx: number, cy: number, r = SIZE): string {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  // Cheapest paths from the end of a unit's current planned path, within its remaining movement.
  /**
   * Where a unit can go from the end of its planned path: `routes` holds every hex it can reach (for
   * tracing a route back), `stops` the ones where it may end its move (#26: a route may pass through a
   * friendly unit's hex without stopping there).
   */
  function reachable(unit: OwnUnit): { routes: Map<HexKey, { cost: number; prev: HexKey }>; stops: Set<HexKey> } {
    const path = pathOf(unit.id);
    const start = path.length ? path[path.length - 1] : unit.hex;
    const budget = unit.move - pathCost(unit.hex, path);
    const { cols, rows } = view.map;
    // Enemies block the way. Friendly units can be passed through, but a move can't end on one
    // that is staying put, or where another friendly unit plans to end its move (#23). A friendly
    // unit that is moving away frees its current hex, so a column can still follow its leader.
    const blocked = new Set(units().filter((u) => !u.own).map((u) => u.hex));
    const noStop = new Set(myUnits().filter((u) => u.id !== unit.id && !pathOf(u.id).length).map((u) => u.hex));
    for (const u of myUnits()) {
      if (u.id !== unit.id && pathOf(u.id).length) noStop.add(plannedEnd(u).hex);
    }
    const best = new Map<HexKey, { cost: number; prev: HexKey }>([[start, { cost: 0, prev: start }]]);
    const queue = [start];
    while (queue.length) {
      queue.sort((a, b) => best.get(a)!.cost - best.get(b)!.cost);
      const h = queue.shift()!;
      for (const n of neighbors(h, cols, rows)) {
        const t = terrainAt(n);
        if (t.impassable || blocked.has(n)) continue;
        if (Math.abs(elevationAt(n) - elevationAt(h)) > unit.climb) continue; // too steep for this unit
        // The first step of a move is always allowed; later steps need the movement, and can't ford a river.
        const first = h === start && !path.length;
        if (!first && fordsRiver(view.map, h, n)) continue;
        const c = best.get(h)!.cost + stepCost(view.map, h, n);
        if (!first && c > budget) continue;
        if (!best.has(n) || c < best.get(n)!.cost) { best.set(n, { cost: c, prev: h }); queue.push(n); }
      }
    }
    best.delete(start);
    const stops = new Set([...best.keys()].filter((h) => !noStop.has(h)));
    return { routes: best, stops };
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
      const { routes, stops } = reachable(unit);
      if (stops.has(hex)) {
        const steps: HexKey[] = [];
        for (let h = hex; routes.has(h); h = routes.get(h)!.prev) steps.unshift(h);
        setPath(unit.id, [...path, ...steps]);
        return render();
      }
    }
    if (ctx.mode === 'deploy' && placing && zone.has(hex) && !terrainAt(hex).impassable && !units().some((u) => u.hex === hex)) {
      if (spent() + (view.datasheets[placing]?.points ?? 0) <= (ctx.deploy?.pointLimit ?? 0)) {
        placements.push({ type: placing, hex });
        dirty = true;
        if (spent() + (view.datasheets[placing]?.points ?? 0) > (ctx.deploy?.pointLimit ?? 0)) placing = null; // can't afford another
        return render();
      }
    }
    const here = units().find((u) => u.hex === hex);
    if (unit && canOrder() && here && !here.own && targetOptions(unit).some((o) => o.target.id === here.id)) {
      setTarget(unit.id, orders[unit.id]?.target === here.id ? null : here.id); // click again to cancel
      return render();
    }
    selected = here && here.id !== selected ? here.id : null;
    render();
    if (selected) revealRow(selected);
  }

  /** Scroll a unit's row into view inside its own table box, without moving the page. */
  function revealRow(id: UnitId): void {
    const row = side.querySelector<HTMLElement>(`tr[data-unit="${CSS.escape(id)}"]`);
    const box = row?.closest<HTMLElement>('.tablewrap');
    if (!row || !box) return;
    const header = box.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top + header) box.scrollTop -= b.top + header - r.top;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  }

  /** Select a unit: zoom the map to it and open its datasheet. */
  function focusUnit(id: UnitId): void {
    selected = id;
    const hex = units().find((u) => u.id === id)?.hex;
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
    // Centre the hex in the part of the map the datasheet panel doesn't cover.
    let viewW = wrap.clientWidth;
    let viewH = wrap.clientHeight;
    const dock = document.getElementById('datasheet');
    if (dock && !dock.hidden) {
      if (getComputedStyle(dock).position === 'absolute') viewW = Math.max(viewW / 3, viewW - dock.offsetWidth - 20);
      else {
        const overlap = wrap.getBoundingClientRect().bottom - dock.getBoundingClientRect().top;
        if (overlap > 0) viewH = Math.max(viewH / 3, viewH - overlap);
      }
    }
    wrap.scrollTo({ left: p.x * zoom - viewW / 2, top: p.y * zoom - viewH / 2, behavior: smooth ? 'smooth' : 'auto' });
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
    busy = true;
    render();
    const out = toOrders();
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
        // Lower ground is shaded darker; the height is written at the top of the hex.
        const e = elevationAt(hex);
        if (e < maxElevation) out.push(`<polygon class="shade" points="${hexPoints(p.x, p.y)}" fill-opacity="${((maxElevation - e) * 0.06).toFixed(2)}"/>`);
        if (showLabels) out.push(`<text class="elev" x="${p.x}" y="${p.y - SIZE * 0.6}">${e}</text>`);
      }
    }
    // Cliffs: edges where the ground drops 2 or more levels (too steep for most units).
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hex = `${c},${r}`;
        const p = px(hex);
        neighbors(hex).forEach((n, dir) => {
          if (dir !== 0 && dir !== 4 && dir !== 5) return; // each shared edge once: E, SW, SE
          if (!inBounds(n, cols, rows) || Math.abs(elevationAt(n) - elevationAt(hex)) < 2) return;
          const a = FACING_ANGLES[dir];
          const end = (deg: number) => `${(p.x + SIZE * Math.cos((deg * Math.PI) / 180)).toFixed(1)},${(p.y + SIZE * Math.sin((deg * Math.PI) / 180)).toFixed(1)}`;
          out.push(`<polyline class="cliff" points="${end(a - 30)} ${end(a + 30)}"/>`);
        });
      }
    }
    // Rivers run along hex edges; roads join hex centres; a road crossing a river is a bridge.
    const edgeEnds = (k: string) => {
      const [a, b] = k.split('|');
      const dir = neighbors(a).indexOf(b);
      const p = px(a);
      const ang = FACING_ANGLES[dir];
      const end = (deg: number) => `${(p.x + SIZE * Math.cos((deg * Math.PI) / 180)).toFixed(1)},${(p.y + SIZE * Math.sin((deg * Math.PI) / 180)).toFixed(1)}`;
      return `${end(ang - 30)} ${end(ang + 30)}`;
    };
    const rivers = new Set(view.map.rivers);
    for (const k of view.map.rivers) out.push(`<polyline class="river" points="${edgeEnds(k)}"/>`);
    for (const k of view.map.roads) {
      const [a, b] = k.split('|');
      if (rivers.has(k)) {
        const pa = px(a);
        const pb = px(b);
        const at = (f: number) => `${(pa.x + (pb.x - pa.x) * f).toFixed(1)},${(pa.y + (pb.y - pa.y) * f).toFixed(1)}`;
        out.push(`<polyline class="bridge" points="${at(0.3)} ${at(0.7)}"/>`);
      }
    }
    for (const k of view.map.roads) out.push(`<polyline class="road" points="${polyline(k.split('|'))}"/>`);
    for (const hex of view.objectives) {
      const p = px(hex);
      out.push(`<circle class="objective" cx="${p.x}" cy="${p.y}" r="${SIZE * 0.8}"/>`);
    }
    const sel = ownUnit(selected);
    if (sel && canOrder()) {
      for (const hex of reachable(sel).stops) { const p = px(hex); out.push(`<polygon class="reach" points="${hexPoints(p.x, p.y)}"/>`); }
      for (const o of targetOptions(sel)) {
        const p = px(o.target.hex);
        out.push(`<polygon class="target-mark${orders[sel.id]?.target === o.target.id ? ' on' : ''}" points="${hexPoints(p.x, p.y, SIZE * 0.86)}"/>`);
      }
    }
    if (showReplay) {
      for (const e of reportEvents()) {
        if (e.type === 'move' && e.path.length > 1) {
          out.push(`<polyline class="path" points="${polyline(e.path)}" stroke="${colorOf(e.owner)}" opacity=".45" marker-end="url(#arrow)"/>`);
        } else if (e.type === 'attack' && e.attackerHex) {
          out.push(`<polyline class="path" points="${polyline([e.attackerHex, e.targetHex])}" stroke="${e.hits ? '#d33' : '#555'}" stroke-dasharray="2 3" marker-end="url(#arrow)"/>`);
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
      const endHex = pv?.endHex[u.id] ?? end.hex; // where the rules say it will actually stop
      if (path.length || end.facing !== u.facing) {
        const p = px(endHex);
        out.push(`<g class="planned"><circle cx="${p.x}" cy="${p.y}" r="${SIZE * 0.6}" stroke="${colorOf(u.owner)}"/>${facingWedge(endHex, end.facing, colorOf(u.owner), 'facing planned-facing')}</g>`);
      }
    }
    // The attacks this turn would make, with their hits.
    for (const e of pvAttacks()) {
      const a = px(e.attackerHex);
      const t = px(e.targetHex);
      const mx = (a.x + t.x) / 2;
      const my = (a.y + t.y) / 2;
      out.push(`<g class="preview-attack${e.attacker === selected || e.target === selected ? ' active' : ''}">`
        + `<polyline class="path" points="${polyline([e.attackerHex, e.targetHex])}" stroke="${e.hits ? '#b3261e' : '#666'}"${e.ranged ? ' stroke-dasharray="7 4"' : ''} marker-end="url(#arrow)"/>`
        + `<circle cx="${mx}" cy="${my}" r="8" fill="${e.hits ? '#b3261e' : '#666'}"/><text x="${mx}" y="${my}">${e.hits}</text></g>`);
    }
    if (ctx.mode === 'deploy') {
      for (const hex of zone) { const p = px(hex); out.push(`<polygon class="zone${placing ? ' active' : ''}" points="${hexPoints(p.x, p.y)}"/>`); }
    }
    for (const u of units()) {
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
      case 'deploy': return `${player(e.player)?.name ?? 'Someone'} deployed the ${player(e.player)?.army ?? e.army}: ${plural(e.units, 'unit')}, ${e.points} points.`;
      case 'move': {
        return `${unitDesc(e.unit, e.owner, e.unitType)} moved ${label(e.path[0])} → ${label(e.path[e.path.length - 1])}.`;
      }
      case 'halt': return `${unitDesc(e.unit, e.owner)} halted at ${label(e.hex)}: ${e.reason}.`;
      case 'turn': return `${unitDesc(e.unit, e.owner, e.unitType)} at ${label(e.hex)} turned to face ${FACING_NAMES[e.facing]}.`;
      case 'clash': return `Opposing units collided at ${label(e.hex)}.`;
      case 'attack': {
        const target = unitDesc(e.target, e.targetOwner, e.targetType);
        const arc = e.arc === 'front' ? '' : ` in the ${e.arc}`;
        return `${unitDesc(e.attacker, e.attackerOwner, e.attackerType)} ${e.ranged ? 'fired at' : 'attacked'} ${target}${arc}: attack ${e.attack} vs defence ${e.defence}, ${plural(e.hits, 'hit')}.`;
      }
      case 'destroyed': return `${unitDesc(e.unit, e.owner, e.unitType)} destroyed at ${label(e.hex)}.`;
      case 'morale': return e.held
        ? `${unitDesc(e.unit, e.owner, e.unitType)} held at ${label(e.hex)}: morale ${e.morale} against ${plural(e.losses, 'loss', 'losses')}.`
        : `${unitDesc(e.unit, e.owner, e.unitType)} broke at ${label(e.hex)} and disbanded: morale ${e.morale} against ${plural(e.losses, 'loss', 'losses')}.`;
      case 'score': return `${player(e.player)?.name ?? 'Someone'} scored ${e.points} for holding ${label(e.hex)}.`;
      case 'gameover': return `Game over. ${e.reason}`;
      default: return (e as { type: string }).type;
    }
  }

  const involves = (e: GameEvent, id: UnitId): boolean => {
    switch (e.type) {
      case 'move': case 'halt': case 'turn': case 'destroyed': case 'morale': return e.unit === id;
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
  /** Movement points, with halves from roads: 1½. */
  const mpText = (n: number) => (Number.isInteger(n) ? `${n}` : `${Math.floor(n) || ''}½`);
  const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

  /** A combat tally sheet: every modifier on each side, the totals, and the result. */
  function tallyHtml(t: Pick<AttackEvent, 'tally' | 'attack' | 'defence' | 'hits'>): string {
    const lines = (side: 'attack' | 'defence') => t.tally.filter((l) => l.side === side)
      .map((l) => `<tr><td>${esc(l.label)}</td><td>${l.value < 0 ? '−' : '+'}${Math.abs(l.value)}</td></tr>`).join('');
    return `<table class="tally">
      <tr class="head"><th colspan="2">Attack</th></tr>${lines('attack')}<tr class="total"><td>Attack</td><td>${t.attack}</td></tr>
      <tr class="head"><th colspan="2">Defence</th></tr>${lines('defence')}<tr class="total"><td>Defence</td><td>${t.defence}</td></tr>
      <tr class="result"><td>Hits (${t.attack} − ${t.defence}${t.attack < t.defence ? ', at least 0' : ''})</td><td>${t.hits}</td></tr>
    </table>`;
  }

  /** The enemies one of your units could attack or fire at from where it will stop, facing its end facing. */
  function targetOptions(u: OwnUnit): AttackOption[] {
    const hex = pv?.endHex[u.id] ?? plannedEnd(u).hex;
    const facing = pv?.endFacing[u.id] ?? plannedEnd(u).facing;
    return ctx.attackOptions?.(u.id, hex, facing) ?? [];
  }
  /** Order a unit to attack an enemy, or (null) not to attack. Attacks are optional (#31). */
  function setTarget(unitId: UnitId, enemyId: UnitId | null): void {
    orders[unitId] = { ...orders[unitId], path: pathOf(unitId), target: enemyId ?? undefined };
    dirty = true;
  }

  /** A morale tally sheet: the unit's morale and every modifier, against its losses. */
  function moraleHtml(m: MoraleEvent): string {
    return `<table class="tally">
      <tr class="head"><th colspan="2">Morale</th></tr>${m.tally.map((l) => `<tr><td>${esc(l.label)}</td><td>${l.value < 0 ? '−' : '+'}${Math.abs(l.value)}</td></tr>`).join('')}
      <tr class="total"><td>Morale</td><td>${m.morale}</td></tr>
      <tr class="total"><td>Losses (strength lost)</td><td>${m.losses}</td></tr>
      <tr class="result"><td>${m.held ? `Holds (${m.morale} beats ${m.losses})` : `Breaks and disbands (${m.morale} does not beat ${m.losses})`}</td><td>${m.held ? '✓' : '✗'}</td></tr>
    </table>`;
  }
  const pvMorale = (id: UnitId): MoraleEvent | undefined =>
    (pv?.events ?? []).find((e): e is MoraleEvent => e.type === 'morale' && e.unit === id);

  /** What the attacks on one unit add up to this turn. */
  function outcomeOn(targetId: UnitId): string {
    const on = pvAttacks().filter((e) => e.target === targetId);
    if (!on.length) return '';
    const total = on.reduce((n, e) => n + e.hits, 0);
    const target = units().find((u) => u.id === targetId);
    const after = Math.max(0, (target?.strength ?? 0) - total);
    const m = pvMorale(targetId);
    const morale = m ? (m.held ? ` It checks morale and holds (${m.morale} beats ${m.losses}).` : ` It checks morale and <b>disbands</b> (${m.morale} does not beat ${m.losses}).`) : '';
    return `${plural(on.length, 'attack')} on ${esc(unitDesc(targetId, target?.owner ?? '', target?.type))}: ${plural(total, 'hit')}, strength ${target?.strength} → ${after}${after === 0 ? ' — <b>destroyed</b>' : ''}.${morale}`;
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
        <td class="${hasOrders(u.id) ? 'moving' : 'muted'}">${ctx.mode === 'orders' ? orderText(u) : ''}${pvAttacks().some((e) => e.attacker === u.id) ? ' <span title="attacks">⚔</span>' : ''}</td></tr>`).join('');
    const seen = others().map((u) => `<tr data-unit="${esc(u.id)}" class="${u.id === selected ? 'sel' : ''}">
        <td><span class="swatch" style="background:${colorOf(u.owner)}"></span></td>
        <td>${esc(u.name)}</td><td>${label(u.hex)} ${arrow(u.facing)}</td>
        <td>${u.strength}/${view.datasheets[u.type].strength}</td><td colspan="3">${esc(player(u.owner)?.name)}</td></tr>`);
    const ownTable = ctx.me ? `<h3>Your units <span class="small">(${mine.length})</span></h3>
      ${mine.length ? `<div class="tablewrap" data-scroll="own"><table class="unittable">
        <thead><tr><th></th><th>Unit</th><th>Hex</th><th>Str</th><th>Mv</th><th>Sight</th><th>${ctx.mode === 'orders' ? 'Orders' : ''}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : `<p class="small">${ctx.round === 0 ? 'No units placed yet.' : 'No units remaining.'}</p>`}` : '';
    const otherTitle = `${ctx.me ? 'Enemy units' : 'All units'} <span class="small">(${seen.length})</span>`;
    return `<div class="card units">${ownTable}
      <h3 ${ctx.me ? 'style="margin-top:12px"' : ''}>${otherTitle}</h3>
      ${seen.length ? `<div class="tablewrap" data-scroll="others"><table class="unittable">
        <thead><tr><th></th><th>Unit</th><th>Hex</th><th>Str</th><th colspan="3">Player</th></tr></thead>
        <tbody>${seen.join('')}</tbody></table></div>` : `<p class="small">${ctx.round === 0 ? 'No enemy units deployed yet.' : 'No enemy units left.'}</p>`}
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
      const used = pathCost(own.hex, path);
      const end = plannedEnd(own);
      // Compass laid out like the hexsides: NW NE / W E / SW SE.
      const compass = ([2, 1, 3, 0, 4, 5] as Facing[]).map((f) => `<button class="face${end.facing === f ? ' on' : ''}${own.facing === f ? ' current' : ''}"
          data-action="face" data-facing="${f}" title="Face ${FACING_NAMES[f]}">${FACING_ARROWS[f]}</button>`).join('');
      options = `<div class="ds-section"><h4>Orders</h4>
        <p>${path.length ? `Move to <b>${label(path[path.length - 1])}</b> via ${path.map(label).join(', ')}` : '<b>Hold position</b>'}
        <br><span class="small">Movement used ${mpText(used)} of ${own.move}.${used > own.move ? ' The first step of a move is always allowed, whatever it costs.' : ''}</span></p>
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
      // Combat: who this unit can attack from where it will stop, and exactly what each attack would do.
      const endHex = pv?.endHex[own.id] ?? own.hex;
      const opts = targetOptions(own);
      const made = pvAttacks().find((e) => e.attacker === own.id);
      const fires = opts.some((o) => o.ranged);
      const ordered = orders[own.id]?.target;
      const lost = ordered && !opts.some((o) => o.target.id === ordered) ? units().find((u) => u.id === ordered) : undefined;
      options += `<div class="ds-section"><h4>Combat</h4>${lost ? `<p class="small warn">${esc(sideOf(lost.owner))} ${esc(lost.name)} is out of reach from ${label(endHex)}: no attack.</p>` : ''}${!opts.length
        ? `<p class="small">No enemy next to ${label(endHex)}${ds.range ? ` and none to fire at (within ${ds.range} hexes, in front and in sight)` : ''}: no attack this turn.</p>`
        : `<p class="small">Attacking is optional. After moving, ${esc(own.name)} can ${fires ? `fire at an enemy within ${ds.range} hexes, in front and in sight` : 'attack an enemy next to it'}: pick one here or click it on the map.</p>
          <div class="targets"><button class="target${ordered ? '' : ' on'}" data-action="target-none"><b>Don't attack</b></button>${opts.map((o) => `<button class="target${made?.target === o.target.id ? ' on' : ''}" data-action="target" data-target="${esc(o.target.id)}">
            <b>${esc(sideOf(o.target.owner))} ${esc(o.target.name)}</b>${o.ranged ? ` (fire, ${distance(endHex, o.target.hex)} hexes${o.arc === 'front' ? '' : `, ${o.arc}`})` : o.arc === 'front' ? '' : ` (${o.arc})`}: ${o.attack} vs ${o.defence} → ${plural(o.hits, 'hit')}</button>`).join('')}</div>
          ${made ? tallyHtml(made) + `<p class="small">${outcomeOn(made.target)}</p>` + (pvMorale(made.target) ? moraleHtml(pvMorale(made.target)!) : '') : ''}
`}</div>`;
    }
    if (enemy && ctx.mode === 'orders') {
      const on = pvAttacks().filter((e) => e.target === enemy.id);
      options = `<div class="ds-section"><h4>Attacks on this unit this turn</h4>${on.length
        ? on.map((e) => `<p class="small"><b>${esc(unitDesc(e.attacker, e.attackerOwner, e.attackerType))}</b>${e.arc === 'front' ? '' : ` (${e.arc})`}</p>${tallyHtml(e)}`).join('') + `<p class="small">${outcomeOn(enemy.id)}</p>` + (pvMorale(enemy.id) ? moraleHtml(pvMorale(enemy.id)!) : '')
        : '<p class="small">None of your units will attack it.</p>'}</div>`;
      const able = canOrder() ? myUnits().filter((u) => targetOptions(u).some((o) => o.target.id === enemy.id)) : [];
      if (able.length) {
        options += `<div class="ds-section"><h4>Attack it with</h4><p class="small">Your units that can reach it this turn, from where they will stop:</p>
          <div class="targets">${able.map((u) => { const o = targetOptions(u).find((x) => x.target.id === enemy.id)!; const on = orders[u.id]?.target === enemy.id;
            return `<button class="target${on ? ' on' : ''}" data-action="attack-with" data-unit-id="${esc(u.id)}"><b>${esc(u.name)}</b>${o.ranged ? ' (fire)' : ''}: ${o.attack} vs ${o.defence} → ${plural(o.hits, 'hit')}${on ? ' ✓' : ''}</button>`; }).join('')}</div></div>`;
      }
    }
    return `<div class="card datasheet" style="border-top:4px solid ${color}">
      <div class="ds-head"><span class="counter" style="background:${color};border-color:${color};color:#fff">${esc(ds.code)}</span>
        <div><h3>${esc(title)}</h3><div class="small">${esc(ds.name)}${own ? '' : ` · ${esc(player(unit.owner)?.name ?? '')}`}</div></div>
        <button class="close" data-action="close" aria-label="Close">×</button></div>
      <table class="stats">
        <tr><th>Strength</th><td>${unit.strength} / ${ds.strength} ${strengthBar(unit.strength, ds.strength, color)}</td></tr>
        <tr><th>Move</th><td>${ds.move}</td></tr>
        <tr><th>Climb</th><td>${ds.climb} <span class="small">(level${ds.climb === 1 ? '' : 's'} up or down per step)</span></td></tr>
        <tr><th>Fire</th><td>${ds.range ? `${ds.fire} · range ${ds.range} hexes <span class="small">(in front and in sight; −1 per hex beyond ${FIRE_FULL_RANGE})</span>` : '— <span class="small">(close combat only)</span>'}</td></tr>
        <tr><th>Morale</th><td>${ds.morale}${ds.rally ? ` · rallies friends within ${RALLY_RANGE} hexes (+${ds.rally})` : ''}</td></tr>
        <tr><th>Facing</th><td>${FACING_NAMES[unit.facing]} ${FACING_ARROWS[unit.facing]}</td></tr>
        <tr><th>Sight</th><td>${ds.sight}${t.sightBonus ? ` <span class="small">(+${t.sightBonus} from ${t.name.toLowerCase()})</span>` : ''}</td></tr>
        <tr><th>Location</th><td>${label(unit.hex)} · ${t.name}${t.defense ? ` <span class="small">(cover ${t.defense})</span>` : ''} · elevation ${elevationAt(unit.hex)}</td></tr>
      </table>
      ${options}
      ${history.length ? `<div class="ds-section"><h4>Recently</h4><ul class="log">${history.map((e) => `<li>${esc(describe(e))}</li>`).join('')}</ul></div>` : ''}
      ${ctx.mode === 'deploy' && own?.id.startsWith('new') ? `<div class="ds-section"><p class="small">${ds.points} points.</p><div class="row"><button class="secondary" data-action="remove-placement">Remove from the battlefield</button></div></div>` : ''}
      <div class="row"><button class="link" data-action="center">Show on map</button></div>
    </div>`;
  }

  function renderSide(): string {
    const finished = view.finished;
    const eliminated = new Set(view.eliminated);
    const moving = myUnits().filter((u) => hasOrders(u.id)).length;
    const attacks = pvAttacks();
    const destroyed = (pv?.events ?? []).filter((e) => e.type === 'destroyed').length;
    const disbanded = (pv?.events ?? []).filter((e) => e.type === 'morale' && !e.held).length;
    const summary = `${plural(attacks.length, 'attack')}, ${plural(attacks.reduce((n, e) => n + e.hits, 0), 'hit')}${destroyed ? `, ${destroyed} destroyed` : ''}${disbanded ? `, ${disbanded} disbanded` : ''}`;
    const reports = ctx.reports.filter((r) => r.events.length);
    return `
      ${ctx.topCard ?? ''}
      <div class="card"><h3>${esc(ctx.gameName)}</h3>
        <div>${finished ? 'Final round' : ctx.round === 0 ? 'Turn 0: deployment' : `Round ${ctx.round} of ${ctx.turnLimit}`}</div>
        <ul class="players">${ctx.players.map((p) => `<li><span class="swatch" style="background:${SIDE_COLORS[p.side]}"></span>
          ${esc(p.name)}${p.id === ctx.me ? ' (you)' : ''}${p.army ? ` <span class="small">(${esc(p.army)})</span>` : ''} — ${view.scores[p.id] ?? 0} pts
          ${eliminated.has(p.id) ? '<span class="small">eliminated</span>' : p.id === ctx.current ? '<span class="small">◀ to move</span>' : ''}</li>`).join('')}</ul>
        ${canOrder() ? `<div class="row submitrow"><button data-action="end-turn" ${busy ? 'disabled' : ''}>${busy ? 'Ending turn…' : 'End turn'}</button>
          <span class="small">${moving} with orders, ${myUnits().length - moving} holding<br>${summary}</span></div>` : ''}
      </div>
      ${ctx.mode === 'deploy' ? renderDeploy() : ''}
      ${renderUnitTables()}
      ${canOrder() ? renderPreview() : ''}
      <div class="card"><h3>Reports</h3>
        ${reports.length ? `<label class="small"><input type="checkbox" data-action="replay" ${showReplay ? 'checked' : ''}> show on map</label>
          ${reports.map((r, i) => `<h4>${esc(r.title)}</h4><ol class="log" data-scroll="report-${i}">${r.events.map((e) => `<li>${esc(describe(e))}</li>`).join('')}</ol>`).join('')}`
          : '<p class="small">Nothing to report.</p>'}</div>`;
  }

  /** Turn 0: pick an army, then choose units and place them in the starting zone. */
  function renderDeploy(): string {
    const d = ctx.deploy!;
    if (!army) {
      return `<div class="card deploy"><h3>Choose your army</h3>
        ${d.armies.map((a) => `<div class="army"><div><b>${esc(a.name)}</b><div class="small">${esc(a.description)}</div>
          <div class="small">${Object.values(a.units).map((u) => `${esc(u.name)} (${u.points})`).join(' · ')}</div></div>
          ${d.taken[a.id] ? `<span class="small">Taken by ${esc(d.taken[a.id])}</span>` : `<button data-action="army" data-army="${esc(a.id)}">Choose</button>`}</div>`).join('')}</div>`;
    }
    const used = spent();
    const rows = Object.entries(army.units).map(([type, u]) => {
      const affordable = used + u.points <= d.pointLimit;
      const n = placements.filter((pl) => pl.type === type).length;
      return `<tr class="${placing === type ? 'sel' : ''}"><td><span class="counter mini">${esc(u.code)}</span></td><td>${esc(u.name)}${n ? ` <span class="small">×${n}</span>` : ''}</td>
        <td>${u.move}</td><td>${u.climb}</td><td>${u.strength}</td><td>${u.range ? `${u.fire}/${u.range}` : '–'}</td><td>${u.morale}${u.rally ? '★' : ''}</td><td><b>${u.points}</b></td>
        <td><button class="small-btn${placing === type ? '' : ' secondary'}" data-action="place" data-type="${esc(type)}" ${affordable ? '' : 'disabled'} title="${placing === type ? 'Placing: click hexes in your zone' : 'Place this unit'}">${placing === type ? 'Placing' : 'Place'}</button></td></tr>`;
    }).join('');
    return `<div class="card deploy"><h3>${esc(army.name)} <button class="link" data-action="army-change">change army</button></h3>
      <div class="points"><span class="bar"><span style="width:${Math.min(100, (used / d.pointLimit) * 100)}%"></span></span>
        <b>${used}</b> of ${d.pointLimit} points · ${plural(placements.length, 'unit')}</div>
      <div class="tablewrap"><table class="unittable roster">
        <thead><tr><th></th><th>Unit</th><th>Mv</th><th>Climb</th><th>Str</th><th title="Fire / range in hexes (– close combat only)">Fire</th><th title="Morale (★ rallies nearby friends)">Mor</th><th>Pts</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="small">${placing ? `Click a highlighted hex in your starting zone to place a ${esc(view.datasheets[placing].name)}. Click a placed unit to remove it.` : 'Press Place, then click hexes in your starting zone (highlighted on the map).'}</p>
      <div class="row"><button data-action="finish-deploy" ${placements.length && !busy ? '' : 'disabled'}>${busy ? 'Finishing…' : 'Finish deployment'}</button></div></div>`;
  }

  /** Everything ending the turn now would do, worked out by the rules engine. */
  function renderPreview(): string {
    const events = pv?.events ?? [];
    const halts = events.filter((e) => e.type === 'halt');
    const items = events.map((e) => {
      if (e.type === 'attack') {
        const arc = e.arc === 'front' ? '' : ` (${e.arc})`;
        return `<li><details><summary>${esc(unitDesc(e.attacker, e.attackerOwner, e.attackerType))} ${e.ranged ? 'fires at' : '→'} ${esc(unitDesc(e.target, e.targetOwner, e.targetType))}${arc}: ${e.attack} vs ${e.defence}, <b>${plural(e.hits, 'hit')}</b></summary>${tallyHtml(e)}</details></li>`;
      }
      if (e.type === 'halt') return `<li class="warn">${esc(unitDesc(e.unit, e.owner))} will stop at ${label(e.hex)} (${esc(e.reason)}).</li>`;
      if (e.type === 'destroyed') return `<li><b>${esc(unitDesc(e.unit, e.owner, e.unitType))} will be destroyed.</b></li>`;
      if (e.type === 'morale') {
        return `<li><details><summary>${esc(unitDesc(e.unit, e.owner, e.unitType))} checks morale: ${e.morale} vs ${plural(e.losses, 'loss', 'losses')}, ${e.held ? 'holds' : '<b>disbands</b>'}</summary>${moraleHtml(e)}</details></li>`;
      }
      if (e.type === 'score') return `<li>You will score ${e.points} for holding ${label(e.hex)}.</li>`;
      if (e.type === 'gameover') return `<li><b>The battle will end: ${esc(e.reason)}</b></li>`;
      return '';
    }).filter(Boolean);
    return `<div class="card preview"><h3>If you end your turn now</h3>
      ${items.length ? `<ul class="log" data-scroll="preview">${items.join('')}</ul>` : '<p class="small">No attacks and no points this turn.</p>'}
      ${halts.length ? '<p class="small">Units stop early when they come next to an enemy.</p>' : ''}
      <p class="small">There are no dice: this is exactly what will happen. Open an attack or a morale check to see its tally.</p></div>`;
  }

  function renderBanner(): string {
    const parts: string[] = [];
    if (ctx.notice) parts.push(`<div class="banner ${ctx.notice.kind}">${ctx.notice.html}</div>`);
    if (view.finished) {
      const winners = (view.result?.winners || []).map((id) => player(id)?.name).join(' and ');
      parts.push(`<div class="banner ok">The battle is over. ${esc(view.result?.reason)} ${winners ? `Victory: ${esc(winners)}.` : ''}</div>`);
    } else if (ctx.me && ctx.round > 0 && !myUnits().length) parts.push('<div class="banner warn">Your army has been destroyed.</div>');
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
    <div class="mapframe">
      <div class="mapwrap" id="mapwrap"></div>
      <div class="datasheet-dock" id="datasheet" hidden></div>
    </div>
    <div class="legend">${Object.values(TERRAIN).map((t) => `<span><i style="background:${t.color}"></i>${t.name}</span>`).join('')}
      <span><i class="line-key road-key"></i>road</span><span><i class="line-key river-key"></i>river</span><span><i class="line-key bridge-key"></i>bridge</span>
      <span>◌ objective</span><span>number = elevation (darker = lower)</span><span><i class="cliff-key"></i>cliff (2+ levels)</span><span>dashed outline = planned move</span></div>
  </div>
  <aside class="side" id="side"></aside>
</div>`;
  const wrap = document.getElementById('mapwrap')!;
  const side = document.getElementById('side')!;
  const dock = document.getElementById('datasheet')!;

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

  const onPanelClick = (ev: Event) => {
    const target = ev.target as Element;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'end-turn') return void endTurn();
    if (action === 'army') {
      army = ctx.deploy!.armies.find((a) => a.id === target.closest<HTMLElement>('[data-army]')!.dataset.army) ?? null;
      placements = [];
      placing = null;
      return render();
    }
    if (action === 'army-change') { army = null; placements = []; placing = null; selected = null; return render(); }
    if (action === 'place') {
      const type = target.closest<HTMLElement>('[data-type]')!.dataset.type!;
      placing = placing === type ? null : type;
      return render();
    }
    if (action === 'remove-placement' && selected?.startsWith('new')) {
      placements.splice(Number(selected.slice(3)), 1);
      selected = null;
      return render();
    }
    if (action === 'finish-deploy' && army && placements.length && !busy) {
      busy = true;
      dirty = false;
      render();
      return void ctx.deploy!.onFinish({ army: army.id, units: placements });
    }
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
    if (action === 'face-auto' && selected) { orders[selected] = { ...orders[selected], path: pathOf(selected), facing: undefined }; dirty = true; return render(); }
    if (action === 'target' && selected) {
      const id = target.closest<HTMLElement>('[data-target]')!.dataset.target!;
      setTarget(selected, orders[selected]?.target === id ? null : id); // click again to cancel
      return render();
    }
    if (action === 'target-none' && selected) { setTarget(selected, null); return render(); }
    if (action === 'attack-with' && selected) {
      const id = target.closest<HTMLElement>('[data-unit-id]')!.dataset.unitId!;
      setTarget(id, orders[id]?.target === selected ? null : selected);
      return render();
    }
    const row = target.closest<HTMLElement>('tr[data-unit]');
    if (row) focusUnit(row.dataset.unit!);
  };
  side.addEventListener('click', onPanelClick);
  dock.addEventListener('click', onPanelClick);
  side.addEventListener('change', (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.dataset.action === 'replay') { showReplay = input.checked; renderMap(); }
  });
  window.onbeforeunload = (e) => { if (dirty) e.preventDefault(); };

  let dockUnit: UnitId | null = null;

  function render(): void {
    // Nothing here may move the page: remember every scroll position and put it back.
    const winX = window.scrollX;
    const winY = window.scrollY;
    const sideTop = side.scrollTop;
    const scrolls = new Map([...side.querySelectorAll<HTMLElement>('[data-scroll]')].map((el) => [el.dataset.scroll!, el.scrollTop]));
    const dockTop = dock.scrollTop;

    pv = ctx.mode === 'orders' && ctx.preview ? ctx.preview(toOrders()) : null;
    document.getElementById('banner')!.innerHTML = renderBanner();
    renderMap();
    side.innerHTML = renderSide();
    side.querySelectorAll<HTMLElement>('[data-scroll]').forEach((el) => { el.scrollTop = scrolls.get(el.dataset.scroll!) ?? 0; });
    side.scrollTop = sideTop;
    const sheet = renderDatasheet();
    dock.innerHTML = sheet;
    dock.hidden = !sheet;
    dock.scrollTop = selected === dockUnit ? dockTop : 0;
    dockUnit = selected;
    if (window.scrollX !== winX || window.scrollY !== winY) window.scrollTo(winX, winY);
    ctx.afterRender?.(app);
  }

  render();
  // Start centred on the player's own forces (or the middle of the map).
  const mine = myUnits();
  centerOn(mine.length ? mine[Math.floor(mine.length / 2)].hex : `${Math.floor(view.map.cols / 2)},${Math.floor(view.map.rows / 2)}`, false);
}
