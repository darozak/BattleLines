// Battle Lines in the browser, no server: the whole game travels in the link's #fragment.
//
//   (no link)   set up a new game (era, map size, points, players), or reopen a recent one
//   game link   see the battlefield; on turn 0 the player whose turn it is picks an army and
//               places units; after that they give orders. Either way, finishing produces the
//               link for the next player.
import { mountBoard, SIDE_COLORS, SIDE_NAMES, type BoardContext, type BoardPlayer } from './board.js';
import { esc, store, openDialog } from './util.js';
import { ERAS, MAP_SIZES, POINT_LIMITS, MIN_PLAYERS, maxPlayers, zoneOf, SCENARIOS, ROUND_OPTIONS, OBJECTIVE_OPTIONS } from '../shared/setup.js';
import { boardView, previewTurn, attackOptions } from '../shared/engine.js';
import {
  createGame, endTurn, deploy, readGame, encodeGame, verifyReplay, turnsSince, packState, playerId, playerIndex,
  type Game, type GameLink, type PackedState, type TurnRecord,
} from '../shared/game.js';
import { LinkError } from '../shared/link.js';
import type { GameEvent, GameState } from '../shared/types.js';

const app = document.getElementById('app')!;

// ---------------------------------------------------------------- header actions (#40)
// Each screen marks its main buttons with data-major. The header, which stays in view, shows a copy of
// each one; pressing the copy presses the original, so every screen keeps its own logic. The originals
// are hidden by the stylesheet.
const headerActions = document.getElementById('header-actions');
function syncHeaderActions(): void {
  if (!headerActions) return;
  const majors = [...app.querySelectorAll<HTMLButtonElement>('button[data-major]')];
  headerActions.replaceChildren(...majors.map((orig) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = orig.textContent?.trim() ?? '';
    b.disabled = orig.disabled;
    b.className = orig.className;
    if (orig.title) b.title = orig.title;
    b.onclick = () => orig.click();
    return b;
  }));
}
new MutationObserver(syncHeaderActions).observe(app, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'class'] });

// ---------------------------------------------------------------- remembered games (this browser only)

interface SavedGame { id: string; name: string; hash: string; updated: number; status: string }
const GAMES_KEY = 'battlelines:games';
const stateKey = (id: string, player: number) => `battlelines:state:${id}:${player}`;

function remember(link: GameLink, hash: string, status: string): void {
  const games = store.get<Record<string, SavedGame>>(GAMES_KEY) ?? {};
  games[link.id] = { id: link.id, name: link.name, hash, updated: Date.now(), status };
  store.set(GAMES_KEY, games);
}

// ---------------------------------------------------------------- helpers

const urlFor = (hash: string) => `${location.origin}${location.pathname}#${hash}`;

/** Show a new link in the address bar without adding a history entry to go "back" to. */
const showInAddressBar = (hash: string) => history.replaceState(null, '', `#${hash}`);

const statusOf = (g: Game) => (g.state.finished ? 'finished'
  : g.state.phase === 'deploy' ? `turn 0 · ${g.link.players[g.state.current]} to deploy`
    : `round ${g.state.turn} · ${g.link.players[g.state.current]} to move`);
const armyName = (g: Game, id: string | null) => ERAS[g.state.era].armies.find((a) => a.id === id)?.name;
const boardPlayers = (g: Game): BoardPlayer[] =>
  g.link.players.map((name, i) => ({ id: playerId(i), name, side: i, army: armyName(g, g.state.armies[playerId(i)]) }));

function page(html: string): void {
  window.onbeforeunload = null;
  document.querySelectorAll('dialog.bl-dialog').forEach((d) => d.remove());
  app.innerHTML = `<div class="narrow">${html}</div>`;
}

function shareCard(hash: string, title: string, text: string, subject: string, withPicture = false): string {
  const url = urlFor(hash);
  const body = `${text}\n\n${url}\n`;
  return `<div class="card share">
    <h3>${esc(title)}</h3>
    <p class="small">${esc(text)}</p>
    ${withPicture ? '<img class="pic-preview" alt="A picture of the battlefield this turn" hidden>' : ''}
    <textarea class="linkbox" readonly rows="3">${esc(url)}</textarea>
    <div class="row">
      <button data-share="copy" data-major>Copy link${withPicture ? ' and picture' : ''}</button>
      <a class="button secondary" data-share="email" href="mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">Email…</a>
      ${'share' in navigator ? '<button class="secondary" data-share="native">Share…</button>' : ''}
      ${withPicture ? '<button class="secondary" data-share="download">Download picture</button>' : ''}
    </div>
    <p class="small share-note">${withPicture
      ? 'Copy link and picture, then paste: into an email you get the picture, and clicking it opens the game; into a chat you get the link. Email… opens your mail app with the link only.'
      : `The link <b>is</b> the game (${url.length} characters). Send all of it.`}</p>
  </div>`;
}

/** The turn's picture (#46), for the share card: made once on demand. */
interface SharePicture { blob: () => Promise<Blob>; name: string }

function wireShare(root: HTMLElement, hash: string, subject: string, onShared?: () => void, picture?: SharePicture): void {
  const url = urlFor(hash);
  const note = root.querySelector<HTMLElement>('.share-note');
  const canShareFiles = (() => { try { return !!navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] }); } catch { return false; } })();
  root.querySelectorAll<HTMLElement>('[data-share]').forEach((btn) => {
    btn.onclick = async () => {
      onShared?.();
      const kind = btn.dataset.share;
      if (kind === 'email') return; // the mailto: link opens the mail app itself
      if (kind === 'copy') {
        try {
          if (picture && typeof ClipboardItem !== 'undefined') {
            // #47: one copy holds the picture wrapped in the link (pasted into an email or a document) and the
            // plain link (pasted into a chat). The clipboard is written at once, with the picture to follow,
            // so browsers that need the click to be "fresh" (Safari) accept it.
            const html = picture.blob().then((b) => new Promise<Blob>((ok) => {
              const r = new FileReader();
              r.onload = () => ok(new Blob([`<a href="${esc(url)}"><img src="${r.result}" alt="${esc(subject)}" width="600"></a><br><a href="${esc(url)}">${esc(subject)}</a>`], { type: 'text/html' }));
              r.readAsDataURL(b);
            }));
            await navigator.clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': new Blob([url], { type: 'text/plain' }) })]);
          } else {
            await navigator.clipboard.writeText(url);
          }
          btn.textContent = 'Copied ✓';
        } catch {
          try { await navigator.clipboard.writeText(url); btn.textContent = 'Link copied ✓ (without the picture)'; } catch {
            root.querySelector<HTMLTextAreaElement>('.linkbox')?.select();
            btn.textContent = 'Select and copy the link above';
          }
        }
      } else if (kind === 'download' && picture) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await picture.blob());
        a.download = picture.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        if (note) note.textContent = `Saved as ${picture.name}: attach it to your post or email, with the link.`;
      } else {
        // Share…: the picture and the link together where the device can share files; the link alone otherwise.
        try {
          if (picture && canShareFiles) await navigator.share({ files: [new File([await picture.blob()], picture.name, { type: 'image/png' })], title: subject, text: `${subject}\n${url}` });
          else await navigator.share({ title: subject, text: subject, url });
        } catch { /* cancelled */ }
      }
    };
  });
  root.querySelector<HTMLTextAreaElement>('.linkbox')?.addEventListener('focus', (e) => (e.target as HTMLTextAreaElement).select());
}

/**
 * The end-turn dialog (#44): what the turn does, then the link for the next player, with the picture of
 * the turn (#46, #47), Copy, Email, Share and Download. Nothing is saved or sent until one of them is used
 * (onShared, once); then Done shows the result. Cancel or × goes back to giving orders.
 */
function sendDialog(title: string, summaryHtml: string, hash: string, cardTitle: string, cardText: string, subject: string,
  onShared: () => void, onDone: () => void, picture?: { make: () => Promise<Blob>; name: string }): void {
  let shared = false;
  const dlg = openDialog(title, `${summaryHtml ? `<div class="dlg-summary">${summaryHtml}</div>` : ''}
    ${shareCard(hash, cardTitle, cardText, subject, !!picture)}
    <div class="row dlg-buttons"><button data-done hidden>Done</button><button class="secondary" data-dialog-close>Cancel</button></div>`);
  const markShared = () => {
    if (!shared) { shared = true; onShared(); }
    dlg.querySelector<HTMLButtonElement>('[data-done]')!.hidden = false;
  };
  let made: Promise<Blob> | null = null;
  const pic = picture ? { blob: () => (made ??= picture.make()), name: picture.name } : undefined;
  wireShare(dlg, hash, subject, markShared, pic);
  dlg.querySelector('[data-done]')!.addEventListener('click', () => { dlg.close(); onDone(); });
  if (!pic) return;
  void pic.blob().then((b) => {
    const img = dlg.querySelector<HTMLImageElement>('.pic-preview')!;
    img.src = URL.createObjectURL(b);
    img.hidden = false;
  }).catch(() => {
    dlg.querySelector<HTMLElement>('.share-note')!.textContent = 'The picture could not be made on this device: Copy link copies the link alone.';
  });
}

/** Who gets the link next, and what to tell them. */
function sendText(state: GameState, link: GameLink, events: GameEvent[]): { title: string; text: string; subject: string } {
  const finished = state.finished;
  const next = link.players[state.current];
  const deploying = state.phase === 'deploy';
  const subject = finished ? `Battle Lines: ${link.name} — the battle is over`
    : `Battle Lines: ${link.name} — ${deploying ? 'your turn to deploy' : 'your move'}, ${next}`;
  if (finished) return { title: 'Send the final link to everyone', text: 'The battle is over. This link shows the final position.', subject };
  return { title: `Send this link to ${next}`, subject,
    text: deploying ? `Your army is in place. ${next} deploys next.`
      : state.turn === 1 && events.some((e) => e.type === 'deploy') ? `Everyone has deployed: the battle begins! ${next} moves first.`
        : `Your turn is done. ${next} moves next.` };
}

/** Run an async form action with a busy button and an error line. */
function formAction(form: HTMLFormElement, action: (data: FormData) => Promise<void>): void {
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const errorEl = form.querySelector<HTMLElement>('.error')!;
    const text = button.textContent;
    button.disabled = true;
    errorEl.hidden = true;
    try {
      await action(new FormData(form));
    } catch (err) {
      errorEl.textContent = err instanceof LinkError ? err.message : 'Something went wrong. Please try again.';
      errorEl.hidden = false;
      if (!(err instanceof LinkError)) console.error(err);
      button.disabled = false;
      button.textContent = text;
    }
  };
}

function reportSections(link: GameLink, turns: TurnRecord[]): BoardContext['reports'] {
  return turns.map((r) => ({ title: `${link.players[r.p]}, ${r.t === 0 ? 'deployment' : `round ${r.t}`}`, events: r.e }));
}

// ---------------------------------------------------------------- screens

function homeScreen(): void {
  const games = Object.values(store.get<Record<string, SavedGame>>(GAMES_KEY) ?? {}).sort((a, b) => b.updated - a.updated);
  const eraOptions = Object.values(ERAS).map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  const sizeOptions = Object.values(MAP_SIZES).map((m) => `<option value="${esc(m.id)}" ${m.id === 'medium' ? 'selected' : ''}>${esc(m.name)} (${m.cols}×${m.rows})</option>`).join('');
  const scenarioOptions = Object.values(SCENARIOS).map((sc) => `<option value="${esc(sc.id)}">${esc(sc.name)}</option>`).join('');
  const pointOptions = POINT_LIMITS.map((n) => `<option value="${n}" ${n === 150 ? 'selected' : ''}>${n} points</option>`).join('');
  page(`
    <section class="hero"><h1>Correspondence warfare, one link at a time.</h1>
      <p>Battle Lines runs entirely in your browser. The whole game travels in a link: take your turn,
      then send the new link to the next player by email or message.</p></section>
    <section class="card"><h2>Start a new game</h2>
      <form id="create" class="form">
        <label>Game name <input name="gameName" maxlength="60" placeholder="Battle of the Crossroads"></label>
        <label>Era <select name="era">${eraOptions}</select></label>
        <p class="hint" id="era-about"></p>
        <label>Map size <select name="size">${sizeOptions}</select></label>
        <label>Scenario <select name="scenario">${scenarioOptions}</select></label>
        <p class="hint" id="scenario-about"></p>
        <label id="objectives-row">Number of objectives <select name="objectives">${OBJECTIVE_OPTIONS.map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
        <label>Rounds <select name="rounds">${ROUND_OPTIONS.map((n) => `<option value="${n}">${n} rounds</option>`).join('')}</select></label>
        <label>Point limit (per player) <select name="points">${pointOptions}</select></label>
        <label>Number of players <select name="count"></select></label>
        <div id="names"></div>
        <p class="hint">The game puts the players in a random order. On turn 0, each player in turn picks a different army
          from the era and places units in their starting zone, up to the point limit. Then the battle begins.</p>
        <p class="error" hidden></p>
        <button type="submit" data-major>Create game</button>
      </form></section>
    ${games.length ? `<section class="card"><h2>Your recent games</h2><p class="hint">Remembered by this browser only.</p>
      <table class="roster"><tr><th>Game</th><th>Status</th><th>Last opened</th></tr>
      ${games.map((g) => `<tr><td><a href="#${esc(g.hash)}">${esc(g.name)}</a></td><td>${esc(g.status)}</td>
        <td>${esc(new Date(g.updated).toLocaleDateString())}</td></tr>`).join('')}</table></section>` : ''}
    <section class="card"><h2>Open a link</h2>
      <form id="paste" class="form"><label>If clicking a link doesn't work, paste it here
        <textarea name="link" rows="2" required></textarea></label><p class="error" hidden></p>
        <button type="submit" class="secondary">Open</button></form></section>`);

  const form = document.getElementById('create') as HTMLFormElement;
  const eraSel = form.elements.namedItem('era') as HTMLSelectElement;
  const countSel = form.elements.namedItem('count') as HTMLSelectElement;
  const namesDiv = document.getElementById('names')!;
  const about = document.getElementById('era-about')!;
  const fillNames = () => {
    const typed = [...namesDiv.querySelectorAll('input')].map((i) => i.value);
    namesDiv.innerHTML = Array.from({ length: Number(countSel.value) }, (_, i) =>
      `<label>Player name ${i + 1}${i === 0 ? ' (you)' : ''}
        <input name="player" maxlength="30" placeholder="Player ${i + 1}" value="${esc(typed[i] ?? `Player ${i + 1}`)}"></label>`).join(''); // defaults (#48)
  };
  const fillAbout = () => {
    const era = ERAS[eraSel.value];
    about.textContent = `${era.description} Armies: ${era.armies.map((a) => a.name).join(', ')}. Each player picks a different army.`;
    const keep = Number(countSel.value) || MIN_PLAYERS;
    countSel.innerHTML = Array.from({ length: maxPlayers(era) - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i)
      .map((n) => `<option value="${n}" ${n === Math.min(keep, maxPlayers(era)) ? 'selected' : ''}>${n}</option>`).join('');
    fillNames();
  };
  // Scenario, objectives and rounds (#37): defaults follow the map size.
  const sizeSel = form.elements.namedItem('size') as HTMLSelectElement;
  const scSel = form.elements.namedItem('scenario') as HTMLSelectElement;
  const objSel = form.elements.namedItem('objectives') as HTMLSelectElement;
  const roundsSel = form.elements.namedItem('rounds') as HTMLSelectElement;
  const fillScenario = () => {
    const sc = SCENARIOS[scSel.value];
    document.getElementById('scenario-about')!.textContent = sc.description;
    document.getElementById('objectives-row')!.hidden = sc.objectives !== 'choose';
  };
  const fillSizeDefaults = () => {
    const size = MAP_SIZES[sizeSel.value];
    roundsSel.value = String(size.turnLimit);
    objSel.value = String(size.objectives);
  };
  scSel.onchange = fillScenario;
  sizeSel.onchange = fillSizeDefaults;
  fillScenario();
  fillSizeDefaults();
  eraSel.onchange = fillAbout;
  countSel.onchange = fillNames;
  fillAbout();
  formAction(form, async (data) => {
    const game = createGame({
      gameName: String(data.get('gameName') ?? ''), era: String(data.get('era')), size: String(data.get('size')),
      points: Number(data.get('points')), players: data.getAll('player').map(String),
      scenario: String(data.get('scenario')), rounds: Number(data.get('rounds')),
      ...(SCENARIOS[String(data.get('scenario'))]?.objectives === 'choose' ? { objectives: Number(data.get('objectives')) } : {}),
    });
    const hash = await encodeGame(game.link);
    showInAddressBar(hash);
    remember(game.link, hash, statusOf(game));
    createdScreen(game, hash);
  });
  formAction(document.getElementById('paste') as HTMLFormElement, async (data) => {
    const text = String(data.get('link') ?? '').trim();
    if (!text.includes('#')) throw new LinkError('That doesn\'t look like a Battle Lines link.');
    location.hash = text.slice(text.indexOf('#') + 1);
  });
}

/** A new game: show the random turn order and the link for the first player. */
function createdScreen(game: Game, hash: string): void {
  const { link, state } = game;
  const first = link.players[0];
  const era = ERAS[state.era];
  const subject = `Battle Lines: ${link.name} — you deploy first, ${first}`;
  page(`<section class="card"><h2>${esc(link.name)}</h2>
      <p>${esc(era.name)} · ${esc(MAP_SIZES[state.size].name)} map · ${state.pointLimit} points per player · ${state.turnLimit} rounds.</p>
      <p><b>${esc(SCENARIOS[state.scenario].name)}</b>: ${esc(SCENARIOS[state.scenario].description)}</p>
      <h3>Turn order</h3>
      <ol class="order">${link.players.map((n, i) => `<li><span class="swatch" style="background:${SIDE_COLORS[i]}"></span> ${esc(n)} <span class="small">(${SIDE_NAMES[i]})</span></li>`).join('')}</ol>
      <p class="hint">The order was drawn at random. Each player deploys in this order, then takes their turns in it.</p>
      <div class="row"><button id="deploy-now" data-major>I'm ${esc(first)}: deploy now</button></div></section>
    ${shareCard(hash, `Or send this link to ${first}`, `${first} picks an army and places units first.`, subject)}`);
  wireShare(app, hash, subject);
  document.getElementById('deploy-now')!.onclick = () => deployScreen(game);
}

/** Someone opened a game link: show the battlefield and whose turn it is. */
function gameScreen(game: Game, hash: string): void {
  const { link, state } = game;
  remember(link, hash, statusOf(game));
  if (state.finished) return finalScreen(game);
  const who = link.players[state.current];
  mountBoard(app, {
    gameName: link.name,
    round: state.turn,
    turnLimit: state.turnLimit,
    players: boardPlayers(game),
    current: playerId(state.current),
    me: null,
    view: boardView(state, null),
    mode: 'review',
    reports: reportSections(link, turnsSince(link, state.current)),
    intro: state.phase === 'deploy'
      ? { title: `Turn 0 · ${who} deploys`, play: `Deploy ${who}'s army`,
        text: `${who} picks an army from the ${ERAS[state.era].name} and places units in their starting zone, up to ${state.pointLimit} points.` }
      : { title: `Round ${state.turn} · ${who}'s turn`, play: `Play ${who}'s turn`, text: `What has happened since ${who} last moved:` },
    afterRender: (root) => {
      const btn = root.querySelector<HTMLButtonElement>('[data-play]');
      if (btn) btn.onclick = () => (state.phase === 'deploy' ? deployScreen(game) : playScreen(game));
    },
  });
}

function checkNotice(game: Game, me: number): BoardContext['notice'] {
  const check = verifyReplay(game.link, store.get<PackedState>(stateKey(game.link.id, me)));
  return check === 'verified'
    ? { kind: 'ok', html: '✓ Checked: the other players\' turns replay exactly from the position you sent.' }
    : check === 'mismatch'
      ? { kind: 'warn', html: '⚠ This position does not match a replay of the other players\' turns from the position you sent. The link may have been altered.' }
      : undefined;
}

/** Turn 0: the current player picks an army and places units. */
function deployScreen(game: Game): void {
  const { link, state } = game;
  const me = state.current;
  const era = ERAS[state.era];
  mountBoard(app, {
    gameName: link.name,
    round: 0,
    turnLimit: state.turnLimit,
    players: boardPlayers(game),
    current: playerId(me),
    me: playerId(me),
    view: boardView(state, playerId(me)),
    mode: 'deploy',
    reports: reportSections(link, turnsSince(link, me)),
    notice: checkNotice(game, me),
    deploy: {
      armies: era.armies,
      taken: Object.fromEntries(state.players.filter((p) => state.armies[p.id]).map((p) => [state.armies[p.id]!, link.players[playerIndex(p.id)]])),
      zone: zoneOf(state, playerId(me)),
      pointLimit: state.pointLimit,
      onFinish: async (d, summaryHtml, picture) => {
        const ended = deploy(game, d);
        const hash = await encodeGame(ended.link);
        const t = sendText(ended.state, ended.link, ended.events);
        sendDialog('Finish deployment', summaryHtml, hash, t.title, t.text, t.subject,
          () => commitTurn(ended, hash, me), () => sentScreen(ended, hash, me, ended.events), { make: picture, name: pictureName(ended) });
      },
    },
  });
}

function playScreen(game: Game): void {
  const { link, state } = game;
  const me = state.current;
  const notice = checkNotice(game, me);
  mountBoard(app, {
    gameName: link.name,
    round: state.turn,
    turnLimit: state.turnLimit,
    players: boardPlayers(game),
    current: playerId(me),
    me: playerId(me),
    view: boardView(state, playerId(me)),
    mode: 'orders',
    reports: reportSections(link, turnsSince(link, me)),
    notice,
    preview: (orders) => previewTurn(state, orders),
    attackOptions: (unitId, hex, facing) => attackOptions(state, unitId, hex, facing),
    onEndTurn: async (orders, summaryHtml, picture) => {
      const ended = endTurn(game, orders);
      const hash = await encodeGame(ended.link);
      const t = sendText(ended.state, ended.link, ended.events);
      sendDialog('End turn', summaryHtml, hash, t.title, t.text, t.subject,
        () => commitTurn(ended, hash, me), () => sentScreen(ended, hash, me, ended.events), { make: picture, name: pictureName(ended) });
    },
  });
}

/** A file name for the turn's picture (#46), e.g. "battle-lines-round-3.png". */
const pictureName = (g: Game) => `battle-lines-${g.state.phase === 'deploy' ? 'deployment' : `round-${g.state.turn}`}.png`;

/** The turn is sent (a share button was used): remember it, for the replay check and the recent-games list. */
function commitTurn(ended: Game, hash: string, me: number): void {
  store.set(stateKey(ended.link.id, me), packState(ended.state));
  showInAddressBar(hash);
  remember(ended.link, hash, statusOf(ended));
}

/** After Done: the new position, with a header button to send the link again. */
function sentScreen(game: Game, hash: string, me: number, events: GameEvent[]): void {
  const { link, state } = game;
  const finished = state.finished;
  const t = sendText(state, link, events);
  const board = mountBoard(app, {
    gameName: link.name,
    round: state.turn,
    turnLimit: state.turnLimit,
    players: boardPlayers(game),
    current: finished ? null : playerId(state.current),
    me: playerId(me),
    view: boardView(state, playerId(me)),
    mode: 'review',
    reports: [{ title: events.some((e) => e.type === 'deploy') ? 'Your deployment' : 'Your turn', events }],
    notice: { kind: 'ok', html: `Turn complete. ${esc(t.text)}` },
    actions: [{ id: 'send-again', label: 'Send the link again' }],
    afterRender: (root) => {
      const btn = root.querySelector<HTMLButtonElement>('[data-action-id="send-again"]');
      if (btn) btn.onclick = () => sendDialog('Send the link', '', hash, t.title, t.text, t.subject, () => {}, () => {}, { make: board.picture, name: pictureName(game) });
    },
  });
}

function finalScreen(game: Game): void {
  const { link, state } = game;
  mountBoard(app, {
    gameName: link.name,
    round: state.turn,
    turnLimit: state.turnLimit,
    players: boardPlayers(game),
    current: null,
    me: null,
    view: boardView(state, null),
    mode: 'review',
    reports: reportSections(link, link.h),
  });
}

// ---------------------------------------------------------------- routing

async function route(): Promise<void> {
  const hash = location.hash.slice(1);
  if (!hash) return homeScreen();
  try {
    gameScreen(await readGame(hash), hash);
  } catch (err) {
    page(`<section class="card"><h2>This link can't be opened</h2>
      <p>${esc(err instanceof LinkError ? err.message : 'It may be damaged or incomplete.')}</p>
      <p><a href="./">Start or reopen a game</a></p></section>`);
    if (!(err instanceof LinkError)) console.error(err);
  }
}

window.addEventListener('hashchange', () => void route());
void route();
