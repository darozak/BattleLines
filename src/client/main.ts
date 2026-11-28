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
import { randomBattleName } from '../shared/names.js';
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

// ---------------------------------------------------------------- email cards (#50)
// Generic graphics hosted on the site (public/cards/): a battle scene with a call to action. Mail programs
// such as Gmail show pictures only when they are on the web, so a card is a hosted graphic, clickable,
// with the sender's message under it. Each link gets a card to suit it; "Different picture" tries another.

type CardKind = 'turn' | 'deploy' | 'final';
const CARDS: Record<CardKind, string[]> = {
  turn: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5', 'turn-6'],
  deploy: ['deploy-1', 'deploy-2'],
  final: ['final-1'],
};
const CARD_ALT: Record<CardKind, string> = {
  turn: 'Battle Lines: your turn. Click to play.',
  deploy: 'Battle Lines: deploy your army. Click to play.',
  final: 'Battle Lines: the battle is over. Click to see how it ended.',
};
const cardUrl = (id: string) => new URL(`cards/${id}.jpg`, document.baseURI).href;

/** What to send with a link: who it's for, the card to show and the default message. */
interface Sending { title: string; text: string; subject: string; kind: CardKind; message: string }

function shareCard(hash: string, s: Sending): string {
  const url = urlFor(hash);
  const cards = CARDS[s.kind];
  const first = cards[Math.floor(Math.random() * cards.length)];
  return `<div class="card share" data-card="${first}">
    <h3>${esc(s.title)}</h3>
    <p class="small">${esc(s.text)}</p>
    <div class="email-card">
      <a href="${esc(url)}" target="_blank" rel="noopener"><img class="card-img" src="${esc(cardUrl(first))}" alt="${esc(CARD_ALT[s.kind])}"></a>
      ${cards.length > 1 ? '<button class="link card-next" type="button" data-card-next>Different picture</button>' : ''}
      <label class="small card-msg">Your message, shown under the picture
        <textarea class="message" rows="2" maxlength="280">${esc(s.message)}</textarea></label>
    </div>
    <div class="row">
      <button data-share="copy-card" data-major>Copy card</button>
      <button class="secondary" data-share="copy">Copy link</button>
      <a class="button secondary" data-share="email" href="#">Email…</a>
      ${'share' in navigator ? '<button class="secondary" data-share="native">Share…</button>' : ''}
    </div>
    <p class="small share-note">Copy card, then paste it into an email (Gmail and others) or a document: the picture opens
      the game when clicked, with your message under it. Share… sends your message and the link to an app;
      Copy link copies the link alone.</p>
    <textarea class="linkbox" readonly rows="2" aria-label="The link">${esc(url)}</textarea>
    <p class="small">The link <b>is</b> the game (${url.length} characters). Send all of it.</p>
  </div>`;
}

function wireShare(root: HTMLElement, hash: string, s: Sending, onShared?: () => void): void {
  const url = urlFor(hash);
  const card = root.querySelector<HTMLElement>('.share')!;
  const msgBox = root.querySelector<HTMLTextAreaElement>('textarea.message')!;
  const message = () => msgBox.value.trim();
  const email = root.querySelector<HTMLAnchorElement>('[data-share="email"]')!;
  const setMail = () => { email.href = `mailto:?subject=${encodeURIComponent(s.subject)}&body=${encodeURIComponent(`${message()}\n\n${url}\n`)}`; };
  setMail();
  msgBox.addEventListener('input', setMail);
  root.querySelector('[data-card-next]')?.addEventListener('click', () => {
    const cards = CARDS[s.kind];
    const next = cards[(cards.indexOf(card.dataset.card!) + 1) % cards.length];
    card.dataset.card = next;
    root.querySelector<HTMLImageElement>('.card-img')!.src = cardUrl(next);
  });
  root.querySelectorAll<HTMLElement>('[data-share]').forEach((btn) => {
    btn.onclick = async () => {
      onShared?.();
      const kind = btn.dataset.share;
      if (kind === 'email') return; // the mailto: link opens the mail app itself
      if (kind === 'copy-card') {
        // The card as HTML (the hosted graphic, clickable, then the message and the link) for mail and
        // documents, and as plain text (the message and the link) for anywhere else.
        const msg = message();
        const html = `<div><a href="${esc(url)}"><img src="${esc(cardUrl(card.dataset.card!))}" alt="${esc(CARD_ALT[s.kind])}" width="600" style="max-width:100%;height:auto;border:0;border-radius:8px"></a>`
          + (msg ? `<p style="font-size:16px;margin:12px 0 6px">${esc(msg).replace(/\n/g, '<br>')}</p>` : '')
          + `<p style="margin:6px 0"><a href="${esc(url)}">Open the game</a></p></div>`;
        const text = `${msg ? `${msg}\n` : ''}${url}`;
        // #51: copy the way Ctrl+C does (the copy command, with the HTML and text set on the copy event).
        // Gmail pasted only the text of a copy made with navigator.clipboard.write, so that is the fallback.
        let copied = false;
        const onCopy = (ev: ClipboardEvent) => {
          ev.clipboardData?.setData('text/html', html);
          ev.clipboardData?.setData('text/plain', text);
          ev.preventDefault();
          copied = !!ev.clipboardData;
        };
        document.addEventListener('copy', onCopy);
        try { document.execCommand('copy'); } catch { /* not supported */ } finally { document.removeEventListener('copy', onCopy); }
        if (!copied) {
          try {
            await navigator.clipboard.write([new ClipboardItem({
              'text/html': new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([text], { type: 'text/plain' }),
            })]);
            copied = true;
          } catch { /* not allowed */ }
        }
        btn.textContent = copied ? 'Card copied ✓' : "This browser won't copy the card: use Copy link";
      } else if (kind === 'copy') {
        try {
          await navigator.clipboard.writeText(url);
          btn.textContent = 'Link copied ✓';
        } catch {
          root.querySelector<HTMLTextAreaElement>('.linkbox')?.select();
          btn.textContent = 'Select and copy the link below';
        }
      } else {
        try { await navigator.share({ title: s.subject, text: message() || s.subject, url }); } catch { /* cancelled */ }
      }
    };
  });
  root.querySelector<HTMLTextAreaElement>('.linkbox')?.addEventListener('focus', (e) => (e.target as HTMLTextAreaElement).select());
}

/**
 * The end-turn dialog (#44): what the turn does, then the card and link for the next player (#50). Nothing
 * is saved or sent until a share button is used (onShared, once); then Done shows the result. Cancel or ×
 * goes back to giving orders.
 */
function sendDialog(title: string, summaryHtml: string, hash: string, sending: Sending, onShared: () => void, onDone: () => void): void {
  let shared = false;
  const dlg = openDialog(title, `${summaryHtml ? `<div class="dlg-summary">${summaryHtml}</div>` : ''}
    ${shareCard(hash, sending)}
    <div class="row dlg-buttons"><button data-done hidden>Done</button><button class="secondary" data-dialog-close>Cancel</button></div>`);
  wireShare(dlg, hash, sending, () => {
    if (!shared) { shared = true; onShared(); }
    dlg.querySelector<HTMLButtonElement>('[data-done]')!.hidden = false;
  });
  dlg.querySelector('[data-done]')!.addEventListener('click', () => { dlg.close(); onDone(); });
}

/** Who gets the link next, and what to tell them. */
function sendText(state: GameState, link: GameLink, events: GameEvent[]): Sending {
  const finished = state.finished;
  const next = link.players[state.current];
  const deploying = state.phase === 'deploy';
  const subject = finished ? `Battle Lines: ${link.name} — the battle is over`
    : `Battle Lines: ${link.name} — ${deploying ? 'your turn to deploy' : 'your move'}, ${next}`;
  if (finished) return { title: 'Send the final link to everyone', text: 'The battle is over. This link shows the final position.', subject, kind: 'final', message: 'The battle is over. See how it ended!' };
  return { title: `Send this link to ${next}`, subject, kind: deploying ? 'deploy' : 'turn',
    message: deploying ? `${next}, it's your turn to deploy.` : `${next}, it's your turn.`,
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
        <label>Game name <span class="name-row"><input name="gameName" maxlength="60" value="${esc(randomBattleName())}">
          <button type="button" class="secondary small-btn" id="new-name" title="Another name" aria-label="Another name">🎲</button></span></label>
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
`);

  const form = document.getElementById('create') as HTMLFormElement;
  document.getElementById('new-name')!.onclick = () => { (form.elements.namedItem('gameName') as HTMLInputElement).value = randomBattleName(); };
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
}

/** A new game: show the random turn order and the link for the first player. */
function createdScreen(game: Game, hash: string): void {
  const { link, state } = game;
  const first = link.players[0];
  const era = ERAS[state.era];
  const subject = `Battle Lines: ${link.name} — you deploy first, ${first}`;
  const firstSending: Sending = { title: `Or send this link to ${first}`, text: `${first} picks an army and places units first.`, subject, kind: 'deploy', message: `${first}, it's your turn to deploy.` };
  page(`<section class="card"><h2>${esc(link.name)}</h2>
      <p>${esc(era.name)} · ${esc(MAP_SIZES[state.size].name)} map · ${state.pointLimit} points per player · ${state.turnLimit} rounds.</p>
      <p><b>${esc(SCENARIOS[state.scenario].name)}</b>: ${esc(SCENARIOS[state.scenario].description)}</p>
      <h3>Turn order</h3>
      <ol class="order">${link.players.map((n, i) => `<li><span class="swatch" style="background:${SIDE_COLORS[i]}"></span> ${esc(n)} <span class="small">(${SIDE_NAMES[i]})</span></li>`).join('')}</ol>
      <p class="hint">The order was drawn at random. Each player deploys in this order, then takes their turns in it.</p>
      <div class="row"><button id="deploy-now" data-major>I'm ${esc(first)}: deploy now</button></div></section>
    ${shareCard(hash, firstSending)}`);
  wireShare(app, hash, firstSending);
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
      onFinish: async (d, summaryHtml) => {
        const ended = deploy(game, d);
        const hash = await encodeGame(ended.link);
        const t = sendText(ended.state, ended.link, ended.events);
        sendDialog('Finish deployment', summaryHtml, hash, t, () => commitTurn(ended, hash, me), () => sentScreen(ended, hash, me, ended.events));
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
    onEndTurn: async (orders, summaryHtml) => {
      const ended = endTurn(game, orders);
      const hash = await encodeGame(ended.link);
      const t = sendText(ended.state, ended.link, ended.events);
      sendDialog('End turn', summaryHtml, hash, t, () => commitTurn(ended, hash, me), () => sentScreen(ended, hash, me, ended.events));
    },
  });
}

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
  mountBoard(app, {
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
      if (btn) btn.onclick = () => sendDialog('Send the link', '', hash, t, () => {}, () => {});
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
