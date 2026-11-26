// Email templates. Each returns { subject, text, html }.
import { esc, formatDeadline, formatDuration } from './html.js';
import type { GameRow } from './db.js';
import type { Scenario } from '../shared/scenario.js';

export interface EmailContent { subject: string; text: string; html: string }
interface Person { name: string | null; email: string }

function wrap(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f3efe6;font-family:Georgia,serif;color:#2d2a24">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf8;border:1px solid #d8cfbd;border-radius:6px">
<tr><td style="background:#3b3a2f;color:#f3efe6;padding:14px 24px;font-size:20px;letter-spacing:2px">BATTLE LINES</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.5">
<h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>
${bodyHtml}
</td></tr>
<tr><td style="padding:12px 24px;font-size:12px;color:#7a7364;border-top:1px solid #e8e0cf">
This link is personal to you. Anyone who has it can give orders to your army, so please don't forward this email.
</td></tr></table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${esc(href)}" style="background:#8a3b12;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;display:inline-block;font-weight:bold">${esc(label)}</a></p>`;
}

export function inviteEmail({ game, host, link, scenario }: { game: GameRow; host: Person; link: string; scenario: Scenario }): EmailContent {
  const subject = `${host.name || host.email} invites you to a game of Battle Lines`;
  const text = `${host.name || host.email} has invited you to "${game.name}", a game of Battle Lines.

Scenario: ${scenario.name}
Turn length: ${formatDuration(game.turn_length_sec)}

Accept or decline here: ${link}
`;
  const html = wrap('You have been called to command', `
<p><b>${esc(host.name || host.email)}</b> has invited you to <b>${esc(game.name)}</b>, a game of Battle Lines.</p>
<p>Scenario: ${esc(scenario.name)}<br>Each turn lasts ${esc(formatDuration(game.turn_length_sec))}. You'll get an email with a link each time a new turn starts.</p>
${button(link, 'Accept or decline')}`);
  return { subject, text, html };
}

export function hostCreatedEmail({ game, link, invitees }: { game: GameRow; link: string; invitees: string[] }): EmailContent {
  const subject = `Your Battle Lines game "${game.name}" is set up`;
  const text = `Invitations have been sent to: ${invitees.join(', ')}.

Track who has accepted, and start the game, here: ${link}
`;
  const html = wrap('Invitations sent', `
<p>Your game <b>${esc(game.name)}</b> has been created and invitations have been sent to:</p>
<ul>${invitees.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
<p>The game starts automatically once everyone has replied. You can also start it early once at least one invitee has accepted.</p>
${button(link, 'Open your command post')}`);
  return { subject, text, html };
}

export function turnEmail({ game, player, turn, link, deadline, firstTurn }: { game: GameRow; player: Person; turn: number; link: string; deadline: number; firstTurn: boolean }): EmailContent {
  const subject = firstTurn
    ? `${game.name}: the battle begins — orders due ${formatDeadline(deadline)}`
    : `${game.name}: turn ${turn - 1} results are in — turn ${turn} orders due ${formatDeadline(deadline)}`;
  const lead = firstTurn
    ? 'Your forces are deployed and the battle has begun.'
    : `Turn ${turn - 1} has been resolved. See what your troops saw, then give your orders for turn ${turn}.`;
  const text = `${lead}

Orders for turn ${turn} are due by ${formatDeadline(deadline)}.
Open your map: ${link}
`;
  const html = wrap(firstTurn ? 'The battle begins' : `Turn ${turn - 1} resolved`, `
<p>${esc(lead)}</p>
<p>Orders for <b>turn ${turn}</b> are due by <b>${esc(formatDeadline(deadline))}</b>.<br>
Units without orders will hold their positions.</p>
${button(link, 'Open your map and give orders')}
<p style="font-size:13px;color:#7a7364">Playing as ${esc(player.name || player.email)}.</p>`);
  return { subject, text, html };
}

export function reminderEmail({ game, turn, link, deadline }: { game: GameRow; turn: number; link: string; deadline: number }): EmailContent {
  const subject = `Reminder: ${game.name} turn ${turn} orders due ${formatDeadline(deadline)}`;
  const text = `You haven't submitted orders for turn ${turn} yet. They are due by ${formatDeadline(deadline)}.
${link}
`;
  const html = wrap('Your troops await orders', `
<p>You haven't submitted orders for <b>turn ${turn}</b> of <b>${esc(game.name)}</b> yet.</p>
<p>They are due by <b>${esc(formatDeadline(deadline))}</b>. If you don't submit, your units will hold their positions.</p>
${button(link, 'Give orders now')}`);
  return { subject, text, html };
}

export function finalEmail({ game, link, resultText }: { game: GameRow; link: string; resultText: string }): EmailContent {
  const subject = `${game.name}: the battle is over`;
  const text = `${resultText}

See the final map: ${link}
`;
  const html = wrap('The battle is over', `<p>${esc(resultText)}</p>${button(link, 'See the final map')}`);
  return { subject, text, html };
}

export function cancelledEmail({ game }: { game: GameRow }): EmailContent {
  const subject = `${game.name} has been cancelled`;
  const text = `The host has cancelled "${game.name}".`;
  const html = wrap('Game cancelled', `<p>The host has cancelled <b>${esc(game.name)}</b>.</p>`);
  return { subject, text, html };
}
