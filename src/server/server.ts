import { openDb } from './db.js';
import { createMailer } from './mailer.js';
import { createGameService } from './games.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const devTools = process.env.DEV_TOOLS === '1';
const now = () => Date.now();

const db = openDb(process.env.DATABASE_FILE || 'data/battlelines.db');
// Run with: npm run build && npm start
const mailer = createMailer({ db, now, smtpUrl: process.env.SMTP_URL, from: process.env.MAIL_FROM });
const service = createGameService({ db, mailer, now, baseUrl });
const app = createApp({ db, service, devTools });

// Scheduler: check deadlines and reminders every 30 seconds.
let ticking = false;
setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try { await service.tick(); } catch (err) { console.error('scheduler tick failed', err); } finally { ticking = false; }
}, Number(process.env.TICK_MS || 30000));

app.listen(port, () => {
  console.log(`Battle Lines listening on ${baseUrl}`);
  console.log(process.env.SMTP_URL ? 'Email: sending via SMTP' : 'Email: SMTP_URL not set, emails go to the dev outbox');
  if (devTools) console.log(`Dev tools: ${baseUrl}/dev`);
});
