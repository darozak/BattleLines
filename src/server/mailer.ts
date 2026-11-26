// Every email is recorded in the `emails` table. If SMTP_URL is set it is also delivered
// via SMTP; otherwise it stays in the dev outbox (viewable at /dev/outbox).
import nodemailer from 'nodemailer';
import type { Db } from './db.js';

export interface OutgoingEmail {
  gameId?: string | null;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** Records the email and delivers it (or leaves it in the outbox). Returns the email's id. */
  send(email: OutgoingEmail): Promise<number>;
}

export interface MailerOptions {
  db: Db;
  now: () => number;
  smtpUrl?: string;
  from?: string;
  log?: (msg: string) => void;
}

export function createMailer({ db, now, smtpUrl, from = 'Battle Lines <no-reply@battlelines.local>', log = console.log }: MailerOptions): Mailer {
  const transport = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
  const insert = db.prepare(
    'INSERT INTO emails (game_id, to_addr, subject, text, html, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const mark = db.prepare('UPDATE emails SET status = ?, error = ? WHERE id = ?');

  return {
    async send({ gameId = null, to, subject, text, html }) {
      const { lastInsertRowid } = insert.run(gameId, to, subject, text, html, transport ? 'queued' : 'outbox', now());
      const id = Number(lastInsertRowid);
      if (!transport) {
        log(`[mail] outbox #${id} -> ${to}: ${subject}`);
        return id;
      }
      try {
        await transport.sendMail({ from, to, subject, text, html });
        mark.run('sent', null, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        mark.run('failed', message, id);
        log(`[mail] FAILED #${id} -> ${to}: ${message}`);
      }
      return id;
    },
  };
}
