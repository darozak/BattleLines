// The battle board: a scrollable, zoomable hex map with a side panel (players, turn preview, reports).
// Hovering over a unit (tapping, on a touch screen) shows an info box with its details and what will
// happen to it this turn (#34). Clicking one of your units selects it: a small orders strip gives its
// move, facing and attack controls, and the map marks where it can go and whom it can attack.
import { parse, neighbors, distance, arcOf, inBounds, toPixel, label, facingToward, FACING_ANGLES, FACING_ARROWS, FACING_NAMES } from '../shared/hex.js';
import { TERRAIN, stepCost, fordsRiver } from '../shared/terrain.js';
import type {
  AttackEvent, MoraleEvent, Facing, GameEvent, HexKey, PlayerId, PlayerOrders, PlayerView, Terrain, UnitId, VisibleUnit,
} from '../shared/types.js';
import type { AttackOption, TurnPreview } from '../shared/engine.js';
import type { Army, Deployment, Placement } from '../shared/setup.js';
import { SCENARIOS } from '../shared/setup.js';
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
  /** The unit whose info box stays open after a click or tap (#34). */
  let pinned: UnitId | null = null;
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
    // Engaging (#33): a unit that enters an enemy's front hexes stops there, so a route can't go on
    // from one (except from where the unit starts, which it may leave, drawing free attacks).
    const engaged = new Set(others().flatMap((e) => neighbors(e.hex, cols, rows).filter((h) => arcOf(e.hex, e.facing, h) === 'front')));
    const best = new Map<HexKey, { cost: number; prev: HexKey }>([[start, { cost: 0, prev: start }]]);
    const queue = [start];
    while (queue.length) {
      queue.sort((a, b) => best.get(a)!.cost - best.get(b)!.cost);
      const h = queue.shift()!;
      if (engaged.has(h) && (h !== start || path.length)) continue;
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
    if (ctx.mode === 'deploy' && here?.id.startsWith('new')) { // a unit placed this turn: take it off the map
      placements.splice(Number(here.id.slice(3)), 1);
      selected = pinned = hovered = null;
      return render();
    }
    if (unit && canOrder() && here && !here.own && targetOptions(unit).some((o) => o.target.id === here.id)) {
      setTarget(unit.id, orders[unit.id]?.target === here.id ? null : here.id); // click again to cancel
      return render();
    }
    if (here && !here.own && ctx.mode !== 'deploy') { // an enemy: show its info box, keep the selection
      pinned = pinned === here.id ? null : here.id;
      return render();
    }
    selected = here && here.own && here.id !== selected ? here.id : null;
    pinned = here && here.id === selected ? here.id : null;
    render();
  }

  /** Select a unit: zoom the map to it, open its orders and show its info box. */
  function focusUnit(id: UnitId): void {
    selected = id;
    pinned = id;
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
    view.objectives.forEach((hex, i) => {
      const p = px(hex);
      const owner = view.objectiveOwners[i];
      // A flag (Capture the Flags, #37) is drawn in its owner's colour, with a pennant.
      out.push(owner
        ? `<g class="flag"><circle class="objective" cx="${p.x}" cy="${p.y}" r="${SIZE * 0.8}" style="stroke:${colorOf(owner)}"/>`
          + `<path d="M${p.x - SIZE * 0.55},${p.y - SIZE * 0.85} l0,-${SIZE * 0.5} l${SIZE * 0.45},${SIZE * 0.17} l-${SIZE * 0.45},${SIZE * 0.17}" fill="${colorOf(owner)}" stroke="${colorOf(owner)}" stroke-width="1.5"/></g>`
        : `<circle class="objective" cx="${p.x}" cy="${p.y}" r="${SIZE * 0.8}"/>`);
    });
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
      out.push(`<g class="unit${u.id === selected ? ' is-selected' : ''}" data-unit="${esc(u.id)}" data-hex="${u.hex}">${facingWedge(u.hex, u.facing, colorOf(u.owner))}<circle class="body" cx="${p.x}" cy="${p.y}" r="${SIZE * 0.6}" fill="${colorOf(u.owner)}"/>`
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

  /** Why points were scored, by scenario (#37). */
  function scoreWhy(e: Extract<GameEvent, { type: 'score' }>): string {
    if (e.reason === 'kill') return `for ${unitDesc(e.unit ?? null, e.unitOwner ?? '', e.unitType)}`;
    const i = e.hex ? view.objectives.indexOf(e.hex) : -1;
    const owner = i >= 0 ? view.objectiveOwners[i] : null;
    const where = e.hex ? label(e.hex) : '';
    if (e.reason === 'flag') return `for holding ${player(owner ?? '')?.name ?? 'an enemy'}'s flag at ${where}`;
    if (e.reason === 'final') return `for holding ${where} when the battle ended`;
    return `for holding ${where}`;
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
        if (e.free) return `${unitDesc(e.attacker, e.attackerOwner, e.attackerType)} made a free attack on ${target}${arc} as it disengaged: attack ${e.attack} vs defence ${e.defence}, ${plural(e.hits, 'hit')}.`;
        return `${unitDesc(e.attacker, e.attackerOwner, e.attackerType)} ${e.ranged ? 'fired at' : 'attacked'} ${target}${arc}: attack ${e.attack} vs defence ${e.defence}, ${plural(e.hits, 'hit')}.`;
      }
      case 'destroyed': return `${unitDesc(e.unit, e.owner, e.unitType)} destroyed at ${label(e.hex)}.`;
      case 'morale': return e.held
        ? `${unitDesc(e.unit, e.owner, e.unitType)} held at ${label(e.hex)}: morale ${e.morale} against ${plural(e.losses, 'loss', 'losses')}.`
        : `${unitDesc(e.unit, e.owner, e.unitType)} broke at ${label(e.hex)} and disbanded: morale ${e.morale} against ${plural(e.losses, 'loss', 'losses')}.`;
      case 'score': return `${player(e.player)?.name ?? 'Someone'} scored ${e.points} ${scoreWhy(e)}.`;
      case 'gameover': return `Game over. ${e.reason}`;
      default: return (e as { type: string }).type;
    }
  }

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


  function strengthBar(strength: number, max: number, color: string): string {
    const pct = Math.max(0, Math.min(100, (strength / max) * 100));
    return `<span class="bar"><span style="width:${pct}%;background:${color}"></span></span>`;
  }

  /** The info box for a unit: its datasheet in brief, where it stands, and what happens to it this turn. */
  function infoHtml(unit: VisibleUnit): string {
    const ds = view.datasheets[unit.type];
    const color = colorOf(unit.owner);
    const t = terrainAt(unit.hex);
    const title = unit.own ? unit.name : `${sideOf(unit.owner)} ${unit.name}`;
    const turn: string[] = [];
    if (pv) {
      if (unit.own) {
        turn.push(`Orders: ${orderText(unit)}`);
        const made = pvAttacks().find((e) => e.attacker === unit.id && !e.free);
        if (made) turn.push(`${made.ranged ? 'Fires at' : 'Attacks'} ${esc(unitDesc(made.target, made.targetOwner, made.targetType))}: ${made.attack} vs ${made.defence} → <b>${plural(made.hits, 'hit')}</b>`);
      }
      const on = outcomeOn(unit.id);
      if (on) turn.push(on);
    } else if (ctx.mode === 'deploy' && unit.own) turn.push(`${ds.points} points${unit.id.startsWith('new') ? ' · click it to take it off the map' : ''}`);
    return `<div class="info-head"><span class="counter mini" style="background:${color};border-color:${color};color:#fff">${esc(ds.code)}</span>
        <div><b>${esc(title)}</b><div class="small">${esc(ds.name)}${unit.own ? '' : ` · ${esc(player(unit.owner)?.name ?? '')}`}</div></div></div>
      <div class="info-str">Strength <b>${unit.strength}/${ds.strength}</b> ${strengthBar(unit.strength, ds.strength, color)}</div>
      <table class="info-stats"><tr><th>Move</th><th>Climb</th><th>Fire</th><th>Morale</th><th>Sight</th></tr>
        <tr><td>${ds.move}</td><td>${ds.climb}</td><td>${ds.range ? `${ds.fire} <span class="small">r${ds.range}</span>` : '–'}</td><td>${ds.morale}${ds.rally ? ` <span class="small">rally +${ds.rally}</span>` : ''}</td><td>${ds.sight}</td></tr></table>
      <div class="small">${label(unit.hex)} · ${t.name}${t.defense ? ` (cover ${t.defense})` : ''} · elevation ${elevationAt(unit.hex)} · facing ${FACING_NAMES[unit.facing]} ${FACING_ARROWS[unit.facing]}</div>
      ${turn.length ? `<div class="info-turn">${turn.map((x) => `<div>${x}</div>`).join('')}</div>` : ''}`;
  }

  /** The orders strip for the selected unit: move, facing and attack controls (#34). */
  function renderOrders(): string {
    const own = ownUnit(selected);
    if (!own || !canOrder()) return '';
    const ds = view.datasheets[own.type];
    const color = colorOf(own.owner);
    const path = pathOf(own.id);
    const used = pathCost(own.hex, path);
    const end = plannedEnd(own);
    const endHex = pv?.endHex[own.id] ?? own.hex;
    // Compass laid out like the hexsides: NW NE / W E / SW SE.
    const compass = ([2, 1, 3, 0, 4, 5] as Facing[]).map((f) => `<button class="face${end.facing === f ? ' on' : ''}${own.facing === f ? ' current' : ''}"
        data-action="face" data-facing="${f}" title="Face ${FACING_NAMES[f]}">${FACING_ARROWS[f]}</button>`).join('');
    const opts = targetOptions(own);
    const made = pvAttacks().find((e) => e.attacker === own.id && !e.free);
    const ordered = orders[own.id]?.target;
    const lost = ordered && !opts.some((o) => o.target.id === ordered) ? units().find((u) => u.id === ordered) : undefined;
    // An adjacent enemy facing the unit stops it firing (#32).
    const pinners = ds.range ? others().filter((e) => neighbors(endHex).includes(e.hex) && arcOf(e.hex, e.facing, endHex) === 'front') : [];
    const freeOn = pvAttacks().filter((e) => e.free && e.target === own.id);
    const notes: string[] = [];
    if (freeOn.length) notes.push(`<span class="warn">Leaving ${label(own.hex)} draws a free attack from ${freeOn.map((e) => esc(unitDesc(e.attacker, e.attackerOwner, e.attackerType))).join(' and ')}: ${plural(freeOn.reduce((n, e) => n + e.hits, 0), 'hit')}.</span>`);
    if (lost) notes.push(`<span class="warn">${esc(sideOf(lost.owner))} ${esc(lost.name)} is out of reach from ${label(endHex)}: no attack.</span>`);
    if (made) notes.push(`${made.ranged ? 'Fires at' : 'Attacks'} <b>${esc(unitDesc(made.target, made.targetOwner, made.targetType))}</b>: ${made.attack} vs ${made.defence} → <b>${plural(made.hits, 'hit')}</b>.`);
    else if (opts.length) notes.push(`Attacking is optional: click an enemy marked in red to ${opts.some((o) => o.ranged) ? 'attack or fire at it' : 'attack it'}.`);
    else notes.push('No enemy in reach from where it stops.');
    if (pinners.length) notes.push(`It can't fire: ${pinners.map((e) => `${esc(sideOf(e.owner))} ${esc(e.name)}`).join(' and ')} ${pinners.length > 1 ? 'face' : 'faces'} it.`);
    return `<div class="card orders" style="border-top:4px solid ${color}">
      <div class="ds-head"><span class="counter mini" style="background:${color};border-color:${color};color:#fff">${esc(ds.code)}</span>
        <div><b>${esc(own.name)}</b><div class="small">${path.length ? `to ${label(path[path.length - 1])} · ` : 'holding · '}movement ${mpText(used)} of ${own.move}</div></div>
        <button class="close" data-action="close" aria-label="Close">×</button></div>
      <div class="orders-row">
        <div class="compass" title="Facing at the end of the turn">${compass}</div>
        <div class="orders-buttons">
          <button class="secondary small-btn" data-action="undo" ${path.length ? '' : 'disabled'}>Undo step</button>
          <button class="secondary small-btn" data-action="hold" ${path.length ? '' : 'disabled'}>Hold</button>
          ${ordered ? '<button class="secondary small-btn" data-action="target-none">Don\'t attack</button>' : ''}
          ${end.auto ? '' : '<button class="link" data-action="face-auto">Clear facing</button>'}
        </div>
      </div>
      <div class="small orders-notes">${notes.map((n) => `<div>${n}</div>`).join('')}</div>
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
        ${SCENARIOS[view.scenario] ? `<div class="small scenario"><b>${esc(SCENARIOS[view.scenario].name)}</b>: ${esc(SCENARIOS[view.scenario].description)}</div>` : ''}
        <ul class="players">${ctx.players.map((p) => `<li><span class="swatch" style="background:${SIDE_COLORS[p.side]}"></span>
          ${esc(p.name)}${p.id === ctx.me ? ' (you)' : ''}${p.army ? ` <span class="small">(${esc(p.army)})</span>` : ''} — ${view.scores[p.id] ?? 0} pts
          ${eliminated.has(p.id) ? '<span class="small">eliminated</span>' : p.id === ctx.current ? '<span class="small">◀ to move</span>' : ''}</li>`).join('')}</ul>
        ${canOrder() ? `<div class="row submitrow"><button data-action="end-turn" ${busy ? 'disabled' : ''}>${busy ? 'Ending turn…' : 'End turn'}</button>
          <span class="small">${moving} with orders, ${myUnits().length - moving} holding<br>${summary}</span></div>` : ''}
      </div>
      ${ctx.mode === 'deploy' ? renderDeploy() : ''}
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
      <div class="row"><button data-action="finish-deploy" ${placements.length && !busy ? '' : 'disabled'}>${busy ? 'Finishing…' : 'Finish deployment'}</button>
        <button class="secondary" data-action="auto-deploy" title="Draw a random set of ${esc(army.name)} units (mostly cheaper ones) and place them in your zone; press again for another">${placements.length ? 'Deploy again for me' : 'Deploy army for me'}</button></div></div>`;
  }

  /** Weight for drawing a unit type: cheap units far more often than expensive ones (#35). */
  const drawWeight = (points: number) => 1 / (points * points);

  /**
   * "Deploy army for me" (#35): with the player's chosen army, draw a random mix of its units up to the
   * point limit (weighted towards cheap units) and place them in the starting zone, front hexes (nearest
   * the centre) first. Only a suggestion: the player can change it, or press again for another.
   */
  function autoDeploy(): void {
    const d = ctx.deploy!;
    if (!army) return;
    const types = Object.keys(army.units);
    const hexes = [...zone].filter((h) => !terrainAt(h).impassable && !view.units.some((u) => u.hex === h))
      .map((h) => ({ h, k: distance(h, middle) + Math.random() * 2.5 })).sort((a, b) => a.k - b.k).map((x) => x.h);
    const picks: string[] = [];
    let cost = 0;
    while (picks.length < hexes.length) {
      const ok = types.filter((t) => cost + army!.units[t].points <= d.pointLimit);
      if (!ok.length) break;
      const weights = ok.map((t) => drawWeight(army!.units[t].points));
      let r = Math.random() * weights.reduce((a, w) => a + w, 0);
      let i = 0;
      while (i < ok.length - 1 && (r -= weights[i]) >= 0) i++;
      const t = ok[i];
      picks.push(t);
      cost += army.units[t].points;
    }
    placements = picks.map((type, i) => ({ type, hex: hexes[i] }));
    placing = null;
    selected = pinned = hovered = null;
    dirty = true;
    render();
    if (placements.length) centerOn(placements[Math.floor(placements.length / 2)].hex, true);
  }

  /** Everything ending the turn now would do, worked out by the rules engine. */
  function renderPreview(): string {
    const events = pv?.events ?? [];
    const halts = events.filter((e) => e.type === 'halt');
    const items = events.map((e) => {
      if (e.type === 'attack') {
        const arc = e.arc === 'front' ? '' : ` (${e.arc})`;
        return `<li><details><summary>${esc(unitDesc(e.attacker, e.attackerOwner, e.attackerType))} ${e.free ? 'free attack on' : e.ranged ? 'fires at' : '→'} ${esc(unitDesc(e.target, e.targetOwner, e.targetType))}${arc}${e.free ? ' as it disengages' : ''}: ${e.attack} vs ${e.defence}, <b>${plural(e.hits, 'hit')}</b></summary>${tallyHtml(e)}</details></li>`;
      }
      if (e.type === 'halt') return `<li class="warn">${esc(unitDesc(e.unit, e.owner))} will stop at ${label(e.hex)} (${esc(e.reason)}).</li>`;
      if (e.type === 'destroyed') return `<li><b>${esc(unitDesc(e.unit, e.owner, e.unitType))} will be destroyed.</b></li>`;
      if (e.type === 'morale') {
        return `<li><details><summary>${esc(unitDesc(e.unit, e.owner, e.unitType))} checks morale: ${e.morale} vs ${plural(e.losses, 'loss', 'losses')}, ${e.held ? 'holds' : '<b>disbands</b>'}</summary>${moraleHtml(e)}</details></li>`;
      }
      if (e.type === 'score') return `<li>${e.player === ctx.me ? 'You' : esc(player(e.player)?.name ?? 'Someone')} will score ${e.points} ${esc(scoreWhy(e))}.</li>`;
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
      <span class="cycle"><button class="secondary small-btn" data-cycle="-1" aria-label="Previous unit" title="Previous unit">◀</button><span class="small">your units</span><button class="secondary small-btn" data-cycle="1" aria-label="Next unit" title="Next unit">▶</button></span>
      <span class="small hint-inline hint-hover">Hover over a unit for its details · click yours to give orders · drag to pan</span>
      <span class="small hint-inline hint-touch">Tap a unit for its details · tap yours to give orders</span>
    </div>
    <div class="mapframe">
      <div class="mapwrap" id="mapwrap"></div>
      <div class="datasheet-dock" id="datasheet" hidden></div>
      <div class="infobox" id="infobox" hidden></div>
    </div>
    <div class="legend">${Object.values(TERRAIN).map((t) => `<span><i style="background:${t.color}"></i>${t.name}</span>`).join('')}
      <span><i class="line-key road-key"></i>road</span><span><i class="line-key river-key"></i>river</span><span><i class="line-key bridge-key"></i>bridge</span>
      <span>◌ objective${view.objectiveOwners.some(Boolean) ? ' (flag: its owner\'s colour)' : ''}</span><span>number = elevation (darker = lower)</span><span><i class="cliff-key"></i>cliff (2+ levels)</span><span>dashed outline = planned move</span></div>
  </div>
  <aside class="side" id="side"></aside>
</div>`;
  const wrap = document.getElementById('mapwrap')!;
  const side = document.getElementById('side')!;
  const dock = document.getElementById('datasheet')!;
  const infobox = document.getElementById('infobox')!;
  const frame = app.querySelector<HTMLElement>('.mapframe')!;

  // The info box (#34): follows the pointer over a unit; a clicked or tapped unit's box stays put.
  let hovered: UnitId | null = null;
  let pointer: { x: number; y: number } | null = null;
  function showInfo(): void {
    const id = hovered ?? pinned;
    const unit = id ? units().find((u) => u.id === id) : undefined;
    // On a narrow screen the orders strip already covers the selected unit: no second box for it.
    const narrow = window.matchMedia('(max-width: 960px)').matches;
    if (!unit || (!hovered && narrow && unit.id === selected && dock.innerHTML)) { infobox.hidden = true; return; }
    infobox.innerHTML = infoHtml(unit);
    infobox.hidden = false;
    const f = frame.getBoundingClientRect();
    let x: number; let y: number;
    if (hovered && pointer) { x = pointer.x - f.left + 18; y = pointer.y - f.top + 18; }
    else {
      const poly = wrap.querySelector(`polygon.hex[data-hex="${unit.hex}"]`)?.getBoundingClientRect();
      x = poly ? poly.right - f.left + 6 : 10; y = poly ? poly.top - f.top : 10;
    }
    const w = infobox.offsetWidth; const h = infobox.offsetHeight;
    if (x + w > f.width - 6) x = Math.max(6, (hovered && pointer ? pointer.x - f.left - 18 : x - 60) - w);
    if (y + h > f.height - 6) y = Math.max(6, f.height - h - 6);
    infobox.style.left = `${x}px`;
    infobox.style.top = `${y}px`;
  }
  wrap.addEventListener('mousemove', (ev) => {
    const hex = (ev.target as Element).closest<SVGElement>('[data-hex]')?.dataset.hex;
    const id = hex ? units().find((u) => u.hex === hex)?.id ?? null : null;
    pointer = { x: ev.clientX, y: ev.clientY };
    if (id !== hovered || id) { hovered = id; showInfo(); }
  });
  wrap.addEventListener('mouseleave', () => { hovered = null; showInfo(); });

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
    const cycle = (ev.target as Element).closest<HTMLElement>('[data-cycle]')?.dataset.cycle;
    if (cycle) {
      const mine = myUnits();
      if (!mine.length) return;
      const at = mine.findIndex((u) => u.id === selected);
      return focusUnit(mine[(at + Number(cycle) + mine.length) % mine.length].id);
    }
    if (z === 'in') zoomStep(1);
    else if (z === 'out') zoomStep(-1);
    else if (z === 'fit') zoomToFit();
  });

  const onPanelClick = (ev: Event) => {
    const target = ev.target as Element;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'end-turn') return void endTurn();
    if (action === 'auto-deploy' && !busy) return autoDeploy();
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
    if (action === 'finish-deploy' && army && placements.length && !busy) {
      busy = true;
      dirty = false;
      render();
      return void ctx.deploy!.onFinish({ army: army.id, units: placements });
    }
    if (action === 'close') { selected = null; pinned = null; return render(); }
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
    const sheet = renderOrders();
    dock.innerHTML = sheet;
    dock.hidden = !sheet;
    dock.scrollTop = selected === dockUnit ? dockTop : 0;
    dockUnit = selected;
    if (pinned && !units().some((u) => u.id === pinned)) pinned = null;
    showInfo();
    if (window.scrollX !== winX || window.scrollY !== winY) window.scrollTo(winX, winY);
    ctx.afterRender?.(app);
  }

  render();
  // Start centred on the player's own forces (or the middle of the map).
  const mine = myUnits();
  centerOn(mine.length ? mine[Math.floor(mine.length / 2)].hex : `${Math.floor(view.map.cols / 2)},${Math.floor(view.map.rows / 2)}`, false);
}
