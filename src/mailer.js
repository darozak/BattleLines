// Every email is recorded in the `emails` table. If SMTP_URL is set it is also delivered
// via SMTP; otherwise it stays in the dev outbox (viewable at /dev/outbox).
import nodemailer from 'nodemailer';

export function createMailer({ db, now, smtpUrl, from = 'Battle Lines <no-reply@battlelines.local>', log = console.log }) {
  const transport = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
  const insert = db.prepare(
    'INSERT INTO emails (game_id, to_addr, subject, text, html, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const mark = db.prepare('UPDATE emails SET status = ?, error = ? WHERE id = ?');

  return {
    async send({ gameId = null, to, subject, text, html }) {
      const { lastInsertRowid: id } = insert.run(gameId, to, subject, text, html, transport ? 'queued' : 'outbox', now());
      if (!transport) {
        log(`[mail] outbox #${id} -> ${to}: ${subject}`);
        return id;
      }
      try {
        await transport.sendMail({ from, to, subject, text, html });
        mark.run('sent', null, id);
      } catch (err) {
        mark.run('failed', String(err.message || err), id);
        log(`[mail] FAILED #${id} -> ${to}: ${err.message}`);
      }
      return id;
    },
  };
}
