// Battle Lines in the browser, no server: the whole game travels in the link's #fragment.
//
//   (no link)        start a new game, or reopen a recent one
//   join link        enter your name and choose a PIN
//   turn link        the player whose turn it is unlocks it with their PIN and gives orders;
//                    ending the turn produces the link for the next player
//   final link       the finished battle, with nothing hidden
import { mountBoard, SIDE_COLORS, SIDE_NAMES, type BoardContext, type BoardPlayer } from './board.js';
import { esc, store } from './util.js';
import { SCENARIOS } from '../shared/scenario.js';
import { playerView, fullView } from '../shared/engine.js';
import {
  createGame, joinGame, openTurn, endTurn, openFinal, readLink, verifyReplay, packState, playerId, linkHash,
  MIN_PIN_LENGTH, type Link, type PackedState, type OpenTurn, type Verification,
} from '../shared/game.js';
import { LinkError, type Header } from '../shared/link.js';
import type { GameState, Report } from '../shared/types.js';

const app = document.getElementById('app')!;

// ---------------------------------------------------------------- remembered games (this browser only)

interface SavedGame { id: string; name: string; hash: string; me: number | null; updated: number; status: string }
const GAMES_KEY = 'battlelines:games';
const stateKey = (id: string, me: number) => `battlelines:state:${id}:${me}`;

function remember(link: Link, me: number | null, status: string): void {
  const games = store.get<Record<string, SavedGame>>(GAMES_KEY) ?? {};
  const prev = games[link.header.id];
  games[link.header.id] = {
    id: link.header.id, name: link.header.name, hash: linkHash(link),
    me: me ?? prev?.me ?? null, updated: Date.now(), status,
  };
  store.set(GAMES_KEY, games);
}

// ---------------------------------------------------------------- helpers

const urlFor = (link: Link) => `${location.origin}${location.pathname}#${linkHash(link)}`;

/** Show a new link in the address bar without adding a history entry to go "back" to. */
function goTo(link: Link): void {
  history.replaceState(null, '', `#${linkHash(link)}`);
}

const boardPlayers = (h: Header): BoardPlayer[] => h.players.map((p, i) => ({ id: playerId(i), name: p.name, side: i }));
const sideBadge = (i: number) => `<span class="swatch" style="background:${SIDE_COLORS[i]}"></span> ${SIDE_NAMES[i]}`;

function page(html: string): void {
  window.onbeforeunload = null;
  app.innerHTML = `<div class="narrow">${html}</div>`;
}

function shareCard(link: Link, title: string, text: string, subject: string): string {
  const url = urlFor(link);
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

function wireShare(root: HTMLElement, link: Link, subject: string): void {
  const url = urlFor(link);
  root.querySelectorAll<HTMLElement>('[data-share]').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.share === 'copy') {
        try {
          await navigator.clipboard.writeText(url);
          btn.textContent = 'Copied ✓';
        } catch {
          const box = root.querySelector<HTMLTextAreaElement>('.linkbox');
          box?.select();
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
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Working…';
    errorEl.hidden = true;
    try {
      await action(new FormData(form));
    } catch (err) {
      errorEl.textContent = err instanceof LinkError ? err.message : 'Something went wrong. Please try again.';
      errorEl.hidden = false;
      if (!(err instanceof LinkError)) console.error(err);
      button.disabled = false;
      button.textContent = label;
    }
  };
}

function pinFields(confirmPin: boolean): string {
  return `<label>PIN <input name="pin" type="password" required minlength="${MIN_PIN_LENGTH}" autocomplete="off"></label>
    ${confirmPin ? `<label>PIN again <input name="pin2" type="password" required minlength="${MIN_PIN_LENGTH}" autocomplete="off"></label>
    <p class="hint">Your PIN locks your view of the battle, so nobody else can look at the board on your turn.
      At least ${MIN_PIN_LENGTH} characters; 6 or more is safer. <b>It can't be recovered</b> — if you forget it, the game can't continue.</p>` : ''}`;
}

function checkPins(data: FormData): string {
  const pin = String(data.get('pin') ?? '');
  if (data.has('pin2') && pin !== String(data.get('pin2'))) throw new LinkError('The two PINs are different.');
  return pin;
}

// ---------------------------------------------------------------- screens

function homeScreen(): void {
  const games = Object.values(store.get<Record<string, SavedGame>>(GAMES_KEY) ?? {}).sort((a, b) => b.updated - a.updated);
  const scenarioOptions = Object.values(SCENARIOS).map((sc) =>
    `<option value="${esc(sc.id)}">${esc(sc.name)} (${sc.cols}×${sc.rows} map, ${sc.roster.length} units each)</option>`).join('');
  page(`
    <section class="hero"><h1>Correspondence warfare, one link at a time.</h1>
      <p>Battle Lines runs entirely in your browser. The whole game travels in a link: take your turn, then send the
      new link to the next player by email or message. Each player's view is locked with their own PIN.</p></section>
    <section class="card"><h2>Start a new game</h2>
      <form id="create" class="form">
        <label>Game name <input name="gameName" maxlength="60" placeholder="Battle of the Crossroads"></label>
        <label>Scenario <select name="scenario">${scenarioOptions}</select></label>
        <label>Number of players <select name="players"></select></label>
        <label>Your name <input name="name" required maxlength="30" placeholder="General Smith"></label>
        ${pinFields(true)}
        <p class="error" hidden></p>
        <button type="submit">Create game</button>
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
  const playersSel = form.elements.namedItem('players') as HTMLSelectElement;
  const fillPlayers = () => {
    const sc = SCENARIOS[scenarioSel.value];
    playersSel.innerHTML = Array.from({ length: sc.maxPlayers - sc.minPlayers + 1 }, (_, i) => sc.minPlayers + i)
      .map((n) => `<option value="${n}">${n}</option>`).join('');
  };
  scenarioSel.onchange = fillPlayers;
  fillPlayers();
  formAction(form, async (data) => {
    const link = await createGame({
      gameName: String(data.get('gameName') ?? ''), scenario: String(data.get('scenario')),
      players: Number(data.get('players')), name: String(data.get('name') ?? ''), pin: checkPins(data),
    });
    remember(link, 0, 'waiting for players to join');
    goTo(link);
    invitedScreen(link);
  });
  formAction(document.getElementById('paste') as HTMLFormElement, async (data) => {
    const text = String(data.get('link') ?? '').trim();
    if (!text.includes('#')) throw new LinkError('That doesn\'t look like a Battle Lines link.');
    location.hash = text.slice(text.indexOf('#') + 1);
  });
}

function rosterHtml(h: Header): string {
  return `<ul class="players">${Array.from({ length: h.n }, (_, i) => `<li>${sideBadge(i)} — ${h.players[i] ? esc(h.players[i].name) : '<i>not joined yet</i>'}</li>`).join('')}</ul>`;
}

/** After creating or joining, while others still need to join. */
function invitedScreen(link: Link): void {
  const h = link.header;
  const subject = `Join my Battle Lines game: ${h.name}`;
  page(`<section class="card"><h2>${esc(h.name)}</h2>
      <p>${esc(SCENARIOS[h.scenario].name)} · ${h.players.length} of ${h.n} players have joined.</p>${rosterHtml(h)}</section>
    ${shareCard(link, 'Invite the next player', `Send this link to the player who will be ${SIDE_NAMES[h.players.length]}. They'll choose their own PIN.`, subject)}`);
  wireShare(app, link, subject);
}

function joinScreen(link: Link): void {
  const h = link.header;
  const slot = h.players.length;
  page(`<section class="card"><h2>${esc(h.name)}</h2>
      <p><b>${esc(h.players[0].name)}</b> has invited you to a game of Battle Lines:
        ${esc(SCENARIOS[h.scenario]?.name ?? h.scenario)}, ${h.n} players.</p>
      ${rosterHtml(h)}
      <p>You'll play ${sideBadge(slot)}.</p>
      <form id="join" class="form">
        <label>Your name <input name="name" required maxlength="30"></label>
        ${pinFields(true)}
        <p class="error" hidden></p>
        <button type="submit">Join the game</button>
      </form></section>`);
  formAction(document.getElementById('join') as HTMLFormElement, async (data) => {
    const next = await joinGame(link, String(data.get('name') ?? ''), checkPins(data));
    goTo(next);
    if (next.header.phase === 'join') {
      remember(next, slot, 'waiting for players to join');
      return invitedScreen(next);
    }
    remember(next, slot, `round 1 · ${next.header.players[0].name} to move`);
    const subject = `Battle Lines: ${h.name} — your move, ${next.header.players[0].name}`;
    page(`<section class="card"><h2>${esc(h.name)}</h2><p>Everyone has joined. The battle begins!</p>${rosterHtml(next.header)}</section>
      ${shareCard(next, `Send this link to ${next.header.players[0].name}`, `${next.header.players[0].name} moves first.`, subject)}`);
    wireShare(app, next, subject);
  });
}

function lockScreen(link: Link): void {
  const h = link.header;
  const who = h.players[h.cur].name;
  page(`<section class="card"><h2>${esc(h.name)}</h2>
      <p>Round ${h.turn} · <b>${esc(who)}</b>'s turn.</p>
      ${rosterHtml(h)}
      <form id="unlock" class="form">
        <p>${esc(who)}, enter your PIN to see the battlefield and give your orders.</p>
        ${pinFields(false)}
        <p class="error" hidden></p>
        <button type="submit">Open my turn</button>
      </form>
      <p class="hint">Not ${esc(who)}? This link is waiting for them; there's nothing for you to do yet.</p></section>`);
  remember(link, null, `round ${h.turn} · ${who} to move`);
  formAction(document.getElementById('unlock') as HTMLFormElement, async (data) => {
    const turn = await openTurn(link, String(data.get('pin') ?? ''));
    playScreen(turn);
  });
}

function reportsFor(state: GameState, header: Header, reports: Report[]): BoardContext['reports'] {
  return reports.map((r) => ({ title: `${header.players[Number(r.player.slice(1))].name}, round ${r.turn}`, events: r.events }));
}

function playScreen(turn: OpenTurn): void {
  const { link, state, me } = turn;
  const h = link.header;
  const meId = playerId(me);
  const verification: Verification = verifyReplay(h, store.get<PackedState>(stateKey(h.id, me)), turn.payload.s, turn.payload.log);
  const notice = verification === 'verified'
    ? { kind: 'ok' as const, html: '✓ Checked: the other players\' moves replay exactly from the position you sent.' }
    : verification === 'mismatch'
      ? { kind: 'warn' as const, html: '⚠ This position does not match a replay of the other players\' orders from the position you sent. The link may have been altered.' }
      : undefined;
  remember(link, me, `round ${h.turn} · ${h.players[h.cur].name} to move`);
  mountBoard(app, {
    gameName: h.name,
    round: state.turn,
    turnLimit: state.turnLimit,
    players: boardPlayers(h),
    current: meId,
    me: meId,
    view: playerView(state, meId),
    mode: 'orders',
    reports: reportsFor(state, h, state.reports[meId]),
    notice,
    onEndTurn: async (orders) => {
      const ended = await endTurn(turn, orders);
      store.set(stateKey(h.id, me), packState(ended.state));
      goTo(ended.link);
      sentScreen(ended.link, ended.state, me, ended.events);
    },
  });
}

function sentScreen(link: Link, state: GameState, me: number, events: BoardContext['reports'][number]['events']): void {
  const h = link.header;
  const meId = playerId(me);
  const finished = h.phase === 'over';
  const next = finished ? null : h.players[h.cur];
  const subject = finished ? `Battle Lines: ${h.name} — the battle is over` : `Battle Lines: ${h.name} — your move, ${next!.name}`;
  remember(link, me, finished ? 'finished' : `round ${h.turn} · ${next!.name} to move`);
  const card = finished
    ? shareCard(link, 'Send the final link to everyone', 'The battle is over. This link shows the whole battlefield to all players.', subject)
    : shareCard(link, `Send this link to ${next!.name}`, `Your turn is done. ${next!.name} moves next; only their PIN opens this link.`, subject);
  mountBoard(app, {
    gameName: h.name,
    round: state.turn,
    turnLimit: state.turnLimit,
    players: boardPlayers(h),
    current: finished ? null : playerId(h.cur),
    me: meId,
    view: playerView(state, meId),
    mode: 'review',
    reports: [{ title: 'Your turn', events }],
    notice: { kind: 'ok', html: 'Turn complete. Send the link below to continue the game.' },
    topCard: card,
    afterRender: (root) => wireShare(root, link, subject),
  });
}

async function finalScreen(link: Link): Promise<void> {
  const h = link.header;
  const { state } = await openFinal(link);
  remember(link, null, 'finished');
  const allReports = h.players.flatMap((_, i) => state.reports[playerId(i)] ?? []);
  mountBoard(app, {
    gameName: h.name,
    round: state.turn,
    turnLimit: state.turnLimit,
    players: boardPlayers(h),
    current: null,
    me: null,
    view: fullView(state),
    mode: 'review',
    reports: reportsFor(state, h, allReports.slice(-h.n)),
    notice: { kind: 'ok', html: 'Final position. Nothing is hidden any more.' },
  });
}

// ---------------------------------------------------------------- routing

async function route(): Promise<void> {
  const hash = location.hash.slice(1);
  if (!hash) return homeScreen();
  try {
    const link = await readLink(hash);
    if (!link) return homeScreen();
    const h = link.header;
    if (h.phase === 'join') return h.players.length < h.n ? joinScreen(link) : homeScreen();
    if (h.phase === 'play') return lockScreen(link);
    return await finalScreen(link);
  } catch (err) {
    page(`<section class="card"><h2>This link can't be opened</h2>
      <p>${esc(err instanceof LinkError ? err.message : 'It may be damaged or incomplete.')}</p>
      <p><a href="#" onclick="location.hash='';return false">Start or reopen a game</a></p></section>`);
    if (!(err instanceof LinkError)) console.error(err);
  }
}

window.addEventListener('hashchange', () => void route());
void route();
