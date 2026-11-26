import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb, type Db, type EmailRow } from '../src/server/db.js';
import { createMailer } from '../src/server/mailer.js';
import { createGameService } from '../src/server/games.js';
import { createApp } from '../src/server/app.js';
import { neighbors } from '../src/shared/hex.js';
import { terrainAt } from '../src/shared/terrain.js';
import type { PlayerData, VisibleUnit } from '../src/shared/types.js';

function setup() {
  let clock = Date.UTC(2026, 0, 1);
  const now = () => clock;
  const db = openDb(':memory:');
  const mailer = createMailer({ db, now, log: () => {} });
  return { db, mailer, now, advance: (ms: number) => { clock += ms; } };
}

const tokenFor = (db: Db, email: string, subjectLike: string): string => {
  const m = db.prepare('SELECT * FROM emails WHERE to_addr = ? AND subject LIKE ? ORDER BY id DESC').get(email, subjectLike) as EmailRow | undefined;
  assert.ok(m, `no email to ${email} like ${subjectLike}`);
  return m.text.match(/\/p\/([\w-]+)/)![1];
};

test('full game flow: invite, accept, play, remind, resolve, finish', async () => {
  const env = setup();
  const service = createGameService({ db: env.db, mailer: env.mailer, now: env.now, baseUrl: 'http://bl.test' });
  const app = createApp({ db: env.db, service, devTools: true });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    // Host creates a game through the web form.
    let res = await fetch(`${base}/games`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ hostName: 'Host', hostEmail: 'host@example.com', gameName: 'Test Battle', turnLength: '7d',
        inviteEmails: 'alice@example.com\nbob@example.com' }),
    });
    assert.equal(res.status, 303);
    const hostToken = res.headers.get('location')!.match(/\/p\/([\w-]+)/)![1];
    const emails = () => env.db.prepare('SELECT * FROM emails ORDER BY id').all() as unknown as EmailRow[];
    assert.deepEqual(emails().map((e) => e.to_addr).sort(), ['alice@example.com', 'bob@example.com', 'host@example.com']);

    // Invitees accept via the link in their email.
    const alice = tokenFor(env.db, 'alice@example.com', '%invites you%');
    const bob = tokenFor(env.db, 'bob@example.com', '%invites you%');
    res = await fetch(`${base}/p/${alice}`);
    assert.match(await res.text(), /Accept/);
    await fetch(`${base}/p/${alice}/respond`, { method: 'POST', body: new URLSearchParams({ answer: 'accept', name: 'Alice' }), redirect: 'manual' });
    assert.equal(service.lookup(alice)!.game.status, 'inviting');
    await fetch(`${base}/p/${bob}/respond`, { method: 'POST', body: new URLSearchParams({ answer: 'accept', name: 'Bob' }), redirect: 'manual' });
    assert.equal(service.lookup(alice)!.game.status, 'active', 'starts automatically once everyone replied');
    assert.equal(emails().filter((e) => e.subject.includes('the battle begins')).length, 3);

    // Each player sees only their own view.
    const view = async (t: string): Promise<PlayerData> => (await fetch(`${base}/api/p/${t}/view`)).json() as Promise<PlayerData>;
    const av = await view(alice);
    assert.equal(av.game.turn, 1);
    assert.ok(av.view.units.filter((u) => u.own).every((u) => u.owner === av.me.id));
    assert.equal(av.view.units.filter((u) => u.own).length, 4);

    // Alice cannot order Bob's units.
    const bv = await view(bob);
    const bobUnit = bv.view.units.find((u) => u.own)!;
    res = await fetch(`${base}/api/p/${alice}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: { [bobUnit.id]: { path: [] } } }) });
    assert.equal(res.status, 400);

    // Alice submits a valid order.
    const unit = av.view.units.find((u) => u.own && u.type === 'infantry')!;
    const step = neighbors(unit.hex, 16, 12).find((h) => !terrainAt(av.view.map, h).impassable && !av.view.units.some((u) => u.hex === h));
    res = await fetch(`${base}/api/p/${alice}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: { [unit.id]: { path: [step] } } }) });
    assert.equal(res.status, 200);
    assert.equal((await view(alice)).myOrders![unit.id].path[0], step);

    // Reminder goes to players who haven't submitted once the deadline is near.
    env.advance(6.5 * 86400 * 1000);
    await service.tick();
    const reminders = emails().filter((e) => e.subject.startsWith('Reminder'));
    assert.deepEqual(reminders.map((e) => e.to_addr).sort(), ['bob@example.com', 'host@example.com']);

    // Deadline passes: turn resolves, everyone gets a new email, missing players hold.
    env.advance(1 * 86400 * 1000);
    await service.tick();
    const after = await view(alice);
    assert.equal(after.game.turn, 2);
    assert.equal(after.view.units.find((u: VisibleUnit) => u.id === unit.id)!.hex, step);
    assert.equal(after.lastTurn!.turn, 1);
    assert.equal(emails().filter((e) => e.subject.includes('turn 1 results')).length, 3);

    // If everyone submits early, the turn resolves without waiting for the deadline.
    for (const t of [hostToken, alice, bob]) {
      await fetch(`${base}/api/p/${t}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"orders":{}}' });
    }
    await service.tick();
    assert.equal((await view(alice)).game.turn, 3);

    // Play out to the turn limit.
    for (let i = 0; i < 20 && service.lookup(alice)!.game.status === 'active'; i++) {
      env.advance(8 * 86400 * 1000);
      await service.tick();
    }
    assert.equal(service.lookup(alice)!.game.status, 'finished');
    assert.equal(emails().filter((e) => e.subject.includes('the battle is over')).length, 3);
    const final = await view(alice);
    assert.ok(final.view.finished);

    // Dev tools pages render.
    assert.equal((await fetch(`${base}/dev`)).status, 200);
    assert.equal((await fetch(`${base}/p/not-a-token`)).status, 404);
  } finally {
    server.close();
  }
});

test('form validation errors are shown', async () => {
  const env = setup();
  const service = createGameService({ db: env.db, mailer: env.mailer, now: env.now, baseUrl: 'http://bl.test' });
  await assert.rejects(service.createGame({ hostEmail: 'bad', inviteEmails: 'a@b.co' }), /valid email/);
  await assert.rejects(service.createGame({ hostEmail: 'h@b.co', inviteEmails: '' }), /at least one/);
  await assert.rejects(service.createGame({ hostEmail: 'h@b.co', inviteEmails: 'a@b.co b@b.co c@b.co d@b.co' }), /at most 4/);
});

test('host can start early and declines are respected', async () => {
  const env = setup();
  const service = createGameService({ db: env.db, mailer: env.mailer, now: env.now, baseUrl: 'http://bl.test' });
  const { game, host } = await service.createGame({ hostEmail: 'h@b.co', inviteEmails: 'a@b.co c@b.co' });
  const a = tokenFor(env.db, 'a@b.co', '%invites%');
  const c = tokenFor(env.db, 'c@b.co', '%invites%');
  await assert.rejects(service.startGame(game.id, host.token), /Not enough/);
  await service.respond(c, false);
  await assert.rejects(service.startGame(game.id, a), /Only the host/);
  await service.respond(a, true, 'A');
  assert.equal(service.getGame(game.id)!.status, 'active', 'auto-starts: everyone replied, 2 accepted');
});
