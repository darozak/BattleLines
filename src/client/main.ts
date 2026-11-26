// Battle Lines in the browser, no server: the whole game travels in the link's #fragment.
//
//   (no link)   start a new game, or reopen a recent one
//   game link   see the battlefield; the player whose turn it is gives orders and ends their
//               turn, which produces the link for the next player
import { mountBoard, SIDE_COLORS, SIDE_NAMES, type BoardContext, type BoardPlayer } from './board.js';
import { esc, store } from './util.js';
import { SCENARIOS } from '../shared/scenario.js';
import { boardView } from '../shared/engine.js';
import {
  createGame, endTurn, readGame, encodeGame, verifyReplay, turnsSince, packState, playerId,
  type Game, type GameLink, type PackedState, type TurnRecord,
} from '../shared/game.js';
import { LinkError } from '../shared/link.js';
import type { GameEvent } from '../shared/types.js';

const app = document.getElementById('app')!;

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

const statusOf = (g: Game) => (g.state.finished ? 'finished' : `round ${g.state.turn} · ${g.link.players[g.state.current]} to move`);
const boardPlayers = (link: GameLink): BoardPlayer[] => link.players.map((name, i) => ({ id: playerId(i), name, side: i }));

function page(html: string): void {
  window.onbeforeunload = null;
  app.innerHTML = `<div class="narrow">${html}</div>`;
}

function shareCard(hash: string, title: string, text: string, subject: string): string {
  const url = urlFor(hash);
  const body = `${text}\n\n${url}\n`;
  return `<div class="card share">
    <h3>${esc(title)}</h3>
    <p class="small">${esc(text)}</p>
    <textarea class="linkbox" readonly rows="3">${esc(url)}</textarea>
    <div class="row">
      <button data-share="copy">Copy link</button>
      <a class="button secondary" href="mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">Email…</a>
      ${'share' in navigator ? '<button class="secondary" data-share="native">Share…</button>' : ''}
    </div>
    <p class="small">The link <b>is</b> the game (${url.length} characters). Send all of it.</p>
  </div>`;
}

function wireShare(root: HTMLElement, hash: string, subject: string): void {
  const url = urlFor(hash);
  root.querySelectorAll<HTMLElement>('[data-share]').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.share === 'copy') {
        try {
          await navigator.clipboard.writeText(url);
          btn.textContent = 'Copied ✓';
        } catch {
          root.querySelector<HTMLTextAreaElement>('.linkbox')?.select();
          btn.textContent = 'Select and copy the link above';
        }
      } else {
        try { await navigator.share({ title: subject, text: subject, url }); } catch { /* cancelled */ }
      }
    };
  });
  root.querySelector<HTMLTextAreaElement>('.linkbox')?.addEventListener('focus', (e) => (e.target as HTMLTextAreaElement).select());
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
  return turns.map((r) => ({ title: `${link.players[r.p]}, round ${r.t}`, events: r.e }));
}

// ---------------------------------------------------------------- screens

function homeScreen(): void {
  const games = Object.values(store.get<Record<string, SavedGame>>(GAMES_KEY) ?? {}).sort((a, b) => b.updated - a.updated);
  const scenarioOptions = Object.values(SCENARIOS).map((sc) =>
    `<option value="${esc(sc.id)}">${esc(sc.name)} (${sc.cols}×${sc.rows} map, ${sc.roster.length} units each)</option>`).join('');
  page(`
    <section class="hero"><h1>Correspondence warfare, one link at a time.</h1>
      <p>Battle Lines runs entirely in your browser. The whole game travels in a link: take your turn,
      then send the new link to the next player by email or message.</p></section>
    <section class="card"><h2>Start a new game</h2>
      <form id="create" class="form">
        <label>Game name <input name="gameName" maxlength="60" placeholder="Battle of the Crossroads"></label>
        <label>Scenario <select name="scenario">${scenarioOptions}</select></label>
        <label>Number of players <select name="count"></select></label>
        <div id="names"></div>
        <p class="hint">Players take turns in this order. You are player 1 and take the first turn.</p>
        <p class="error" hidden></p>
        <button type="submit">Create game and take the first turn</button>
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
  const scenarioSel = form.elements.namedItem('scenario') as HTMLSelectElement;
  const countSel = form.elements.namedItem('count') as HTMLSelectElement;
  const namesDiv = document.getElementById('names')!;
  const fillNames = () => {
    const typed = [...namesDiv.querySelectorAll('input')].map((i) => i.value);
    namesDiv.innerHTML = Array.from({ length: Number(countSel.value) }, (_, i) =>
      `<label><span class="swatch" style="background:${SIDE_COLORS[i]}"></span> Player ${i + 1} (${SIDE_NAMES[i]})${i === 0 ? ' — you' : ''}
        <input name="player" required maxlength="30" value="${esc(typed[i] ?? '')}"></label>`).join('');
  };
  const fillCounts = () => {
    const sc = SCENARIOS[scenarioSel.value];
    const keep = Number(countSel.value) || sc.minPlayers;
    countSel.innerHTML = Array.from({ length: sc.maxPlayers - sc.minPlayers + 1 }, (_, i) => sc.minPlayers + i)
      .map((n) => `<option value="${n}" ${n === keep ? 'selected' : ''}>${n}</option>`).join('');
    fillNames();
  };
  scenarioSel.onchange = fillCounts;
  countSel.onchange = fillNames;
  fillCounts();
  formAction(form, async (data) => {
    const game = createGame({
      gameName: String(data.get('gameName') ?? ''), scenario: String(data.get('scenario')),
      players: data.getAll('player').map(String),
    });
    const hash = await encodeGame(game.link);
    showInAddressBar(hash);
    remember(game.link, hash, statusOf(game));
    playScreen(game);
  });
  formAction(document.getElementById('paste') as HTMLFormElement, async (data) => {
    const text = String(data.get('link') ?? '').trim();
    if (!text.includes('#')) throw new LinkError('That doesn\'t look like a Battle Lines link.');
    location.hash = text.slice(text.indexOf('#') + 1);
  });
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
    players: boardPlayers(link),
    current: playerId(state.current),
    me: null,
    view: boardView(state, null),
    mode: 'review',
    reports: reportSections(link, turnsSince(link, state.current)),
    topCard: `<div class="card share"><h3>Round ${state.turn} · ${esc(who)}'s turn</h3>
      <p class="small">Below is what has happened since ${esc(who)} last moved.</p>
      <div class="row"><button data-play>Play ${esc(who)}'s turn</button></div></div>`,
    afterRender: (root) => {
      const btn = root.querySelector<HTMLButtonElement>('[data-play]');
      if (btn) btn.onclick = () => playScreen(game);
    },
  });
}

function playScreen(game: Game): void {
  const { link, state } = game;
  const me = state.current;
  const check = verifyReplay(link, store.get<PackedState>(stateKey(link.id, me)));
  const notice = check === 'verified'
    ? { kind: 'ok' as const, html: '✓ Checked: the other players\' moves replay exactly from the position you sent.' }
    : check === 'mismatch'
      ? { kind: 'warn' as const, html: '⚠ This position does not match a replay of the other players\' orders from the position you sent. The link may have been altered.' }
      : undefined;
  mountBoard(app, {
    gameName: link.name,
    round: state.turn,
    turnLimit: state.turnLimit,
    players: boardPlayers(link),
    current: playerId(me),
    me: playerId(me),
    view: boardView(state, playerId(me)),
    mode: 'orders',
    reports: reportSections(link, turnsSince(link, me)),
    notice,
    onEndTurn: async (orders) => {
      const ended = endTurn(game, orders);
      const hash = await encodeGame(ended.link);
      store.set(stateKey(link.id, me), packState(ended.state));
      showInAddressBar(hash);
      remember(ended.link, hash, statusOf(ended));
      sentScreen(ended, hash, me, ended.events);
    },
  });
}

function sentScreen(game: Game, hash: string, me: number, events: GameEvent[]): void {
  const { link, state } = game;
  const finished = state.finished;
  const next = link.players[state.current];
  const subject = finished ? `Battle Lines: ${link.name} — the battle is over` : `Battle Lines: ${link.name} — your move, ${next}`;
  const card = finished
    ? shareCard(hash, 'Send the final link to everyone', 'The battle is over. This link shows the final position.', subject)
    : shareCard(hash, `Send this link to ${next}`, `Your turn is done. ${next} moves next.`, subject);
  mountBoard(app, {
    gameName: link.name,
    round: state.turn,
    turnLimit: state.turnLimit,
    players: boardPlayers(link),
    current: finished ? null : playerId(state.current),
    me: playerId(me),
    view: boardView(state, playerId(me)),
    mode: 'review',
    reports: [{ title: 'Your turn', events }],
    notice: { kind: 'ok', html: 'Turn complete. Send the link below to continue the game.' },
    topCard: card,
    afterRender: (root) => wireShare(root, hash, subject),
  });
}

function finalScreen(game: Game): void {
  const { link, state } = game;
  mountBoard(app, {
    gameName: link.name,
    round: state.turn,
    turnLimit: state.turnLimit,
    players: boardPlayers(link),
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
