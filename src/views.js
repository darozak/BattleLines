// Server-rendered pages. The map itself is drawn in the browser by public/game.js.
import { esc, formatDeadline, formatDuration } from './html.js';
import { SCENARIOS, SIDE_COLORS, SIDE_NAMES } from './engine/scenario.js';
import { TURN_LENGTHS } from './games.js';

export function layout(title, body, { devTools = false, wide = false } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/static/style.css"></head>
<body><header class="top"><a href="/" class="brand">BATTLE LINES</a>${devTools ? '<a href="/dev" class="devlink">Dev tools</a>' : ''}</header>
<main class="${wide ? 'wide' : ''}">${body}</main></body></html>`;
}

const msg = (error) => (error ? `<p class="error">${esc(error)}</p>` : '');

export function homePage({ error, values = {} } = {}) {
  const sc = SCENARIOS.crossroads;
  const opt = (k) => `<option value="${k}" ${values.turnLength === k ? 'selected' : ''}>${formatDuration(TURN_LENGTHS[k])}</option>`;
  return `
<section class="hero"><h1>Correspondence warfare, one week at a time.</h1>
<p>Invite your friends by email. Each week everyone gets a link showing what their troops can see, gives orders, and the
battle is resolved for everyone at the same moment.</p></section>
<section class="card"><h2>Start a new game</h2>${msg(error)}
<form method="post" action="/games" class="form">
<label>Your name <input name="hostName" value="${esc(values.hostName)}" maxlength="60" placeholder="General Smith"></label>
<label>Your email <input name="hostEmail" type="email" required value="${esc(values.hostEmail)}"></label>
<label>Game name <input name="gameName" value="${esc(values.gameName)}" maxlength="80" placeholder="Battle of the Crossroads"></label>
<label>Scenario <select name="scenario"><option value="crossroads">${esc(sc.name)} (2–${sc.maxPlayers} players, ${sc.turnLimit} turns)</option></select></label>
<label>Turn length <select name="turnLength">${Object.keys(TURN_LENGTHS).map(opt).join('')}</select></label>
<label>Invite players (email addresses, one per line)
<textarea name="inviteEmails" rows="4" required>${esc(values.inviteEmails)}</textarea></label>
<button type="submit">Send invitations</button>
</form></section>`;
}

export function invitePage({ game, player, host, error }) {
  return `<section class="card"><h2>${esc(game.name)}</h2>${msg(error)}
<p><b>${esc(host.name || host.email)}</b> has invited you to a game of Battle Lines.</p>
<p>Scenario: ${esc(SCENARIOS[game.scenario].name)}<br>Turn length: ${esc(formatDuration(game.turn_length_sec))}</p>
<form method="post" action="/p/${esc(player.token)}/respond" class="form">
<label>Your name (shown to other players) <input name="name" maxlength="60" value="${esc(player.name)}"></label>
<div class="row"><button name="answer" value="accept">Accept</button>
<button name="answer" value="decline" class="secondary">Decline</button></div></form></section>`;
}

export function lobbyPage({ game, player, players, error, created }) {
  const rows = players.map((p) => `<tr><td>${esc(p.name || '—')}</td><td>${esc(p.email)}</td>
    <td><span class="status ${p.invite_status}">${p.is_host ? 'host' : p.invite_status}</span></td></tr>`).join('');
  const accepted = players.filter((p) => p.invite_status === 'accepted').length;
  const hostControls = player.is_host ? `
<div class="row">
<form method="post" action="/p/${esc(player.token)}/start"><button ${accepted < 2 ? 'disabled' : ''}>Start game now (${accepted} player${accepted === 1 ? '' : 's'})</button></form>
<form method="post" action="/p/${esc(player.token)}/cancel"><button class="secondary">Cancel game</button></form>
</div><p class="hint">The game starts automatically once everyone has replied.</p>` : '<p>You\'re in. You\'ll get an email when the battle begins.</p>';
  return `<section class="card"><h2>${esc(game.name)}</h2>${msg(error)}
${created ? '<p class="ok">Invitations sent. We also emailed you this link: bookmark it, it\'s your command post.</p>' : ''}
<table class="roster"><tr><th>Name</th><th>Email</th><th>Status</th></tr>${rows}</table>${hostControls}</section>`;
}

export function messagePage(title, text) {
  return `<section class="card"><h2>${esc(title)}</h2><p>${esc(text)}</p></section>`;
}

export function gamePage({ game, player }) {
  return `<div id="app" data-token="${esc(player.token)}" data-colors='${esc(JSON.stringify(SIDE_COLORS))}' data-sides='${esc(JSON.stringify(SIDE_NAMES))}'>
<p>Loading map…</p></div><script type="module" src="/static/game.js"></script>`;
}

export function devPage({ games, emails }) {
  const g = games.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.status)}</td><td>${x.turn}</td>
    <td>${x.deadline ? esc(formatDeadline(x.deadline)) : '—'}</td>
    <td>${x.players.map((p) => `<a href="/p/${esc(p.token)}">${esc(p.name || p.email)}</a>`).join(', ')}</td>
    <td>${x.status === 'active' ? `<form method="post" action="/dev/games/${esc(x.id)}/resolve"><button>Resolve now</button></form>` : ''}</td></tr>`).join('');
  const e = emails.map((m) => `<tr><td>#${m.id}</td><td>${esc(new Date(m.created_at).toISOString().slice(0, 19).replace('T', ' '))}</td>
    <td>${esc(m.to_addr)}</td><td><a href="/dev/emails/${m.id}">${esc(m.subject)}</a></td><td>${esc(m.status)}</td></tr>`).join('');
  return `<section class="card"><h2>Dev tools</h2><p class="hint">Visible only when DEV_TOOLS=1. Player links below bypass email.</p>
<form method="post" action="/dev/tick"><button>Run scheduler tick</button></form>
<h3>Games</h3><table class="roster"><tr><th>Game</th><th>Status</th><th>Turn</th><th>Deadline</th><th>Players</th><th></th></tr>${g}</table>
<h3>Outbox (latest 100)</h3><table class="roster"><tr><th></th><th>Time (UTC)</th><th>To</th><th>Subject</th><th>Status</th></tr>${e}</table></section>`;
}
