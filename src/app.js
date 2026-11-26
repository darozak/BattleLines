import express from 'express';
import { fileURLToPath } from 'node:url';
import { GameError } from './games.js';
import { playerView } from './engine/engine.js';
import * as views from './views.js';

const root = (p) => fileURLToPath(new URL(p, import.meta.url));

export function createApp({ db, service, devTools = false }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/static', express.static(root('../public')));
  // Hex math and terrain are shared with the browser.
  app.get('/shared/hex.js', (req, res) => res.sendFile(root('./engine/hex.js')));
  app.get('/shared/terrain.js', (req, res) => res.sendFile(root('./engine/terrain.js')));

  // Player links are bearer credentials: keep them out of caches and referrers.
  app.use('/p', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  const page = (res, title, body, opts = {}, status = 200) =>
    res.status(status).send(views.layout(title, body, { devTools, ...opts }));

  app.get('/', (req, res) => page(res, 'Battle Lines', views.homePage()));

  app.post('/games', async (req, res) => {
    try {
      const { host } = await service.createGame(req.body);
      res.redirect(303, `/p/${host.token}?created=1`);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      page(res, 'Battle Lines', views.homePage({ error: err.message, values: req.body }), {}, 400);
    }
  });

  function renderPlayer(res, ctx, { error, created } = {}) {
    const { game, player } = ctx;
    const players = service.getPlayers(game.id);
    if (game.status === 'cancelled') return page(res, game.name, views.messagePage(game.name, 'This game was cancelled by the host.'));
    if (player.invite_status === 'declined') return page(res, game.name, views.messagePage(game.name, 'You declined this invitation.'));
    if (game.status === 'inviting') {
      if (player.invite_status === 'pending') {
        return page(res, game.name, views.invitePage({ game, player, host: players.find((p) => p.is_host), error }));
      }
      return page(res, game.name, views.lobbyPage({ game, player, players, error, created }));
    }
    return page(res, game.name, views.gamePage({ game, player }), { wide: true });
  }

  const withPlayer = (handler) => async (req, res) => {
    const ctx = service.lookup(req.params.token);
    if (!ctx) return page(res, 'Not found', views.messagePage('Link not recognised', 'This link is not valid. Check you used the most recent email.'), {}, 404);
    try {
      await handler(req, res, ctx);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      renderPlayer(res.status(400), service.lookup(req.params.token), { error: err.message });
    }
  };

  app.get('/p/:token', withPlayer((req, res, ctx) => renderPlayer(res, ctx, { created: req.query.created })));
  app.post('/p/:token/respond', withPlayer(async (req, res) => {
    await service.respond(req.params.token, req.body.answer === 'accept', req.body.name);
    res.redirect(303, `/p/${req.params.token}`);
  }));
  app.post('/p/:token/start', withPlayer(async (req, res, ctx) => {
    await service.startGame(ctx.game.id, req.params.token);
    res.redirect(303, `/p/${req.params.token}`);
  }));
  app.post('/p/:token/cancel', withPlayer(async (req, res) => {
    await service.cancelGame(req.params.token);
    res.redirect(303, `/p/${req.params.token}`);
  }));

  app.get('/api/p/:token/view', (req, res) => {
    const data = service.playerData(req.params.token, playerView);
    if (!data) return res.status(404).json({ error: 'Unknown link' });
    if (!['active', 'finished'].includes(data.game.status)) return res.status(409).json({ error: 'Game has not started' });
    res.json(data);
  });
  app.post('/api/p/:token/orders', (req, res) => {
    try {
      const out = service.submitOrders(req.params.token, req.body?.orders);
      res.json(out);
      // If that was the last outstanding set of orders, resolve without waiting for the deadline.
      service.tick().catch((err) => console.error('tick failed', err));
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      res.status(400).json({ error: err.message });
    }
  });

  if (devTools) {
    app.get('/dev', (req, res) => {
      const games = db.prepare('SELECT * FROM games ORDER BY created_at DESC LIMIT 50').all()
        .map((g) => ({ ...g, players: service.getPlayers(g.id) }));
      const emails = db.prepare('SELECT id, to_addr, subject, status, created_at FROM emails ORDER BY id DESC LIMIT 100').all();
      page(res, 'Dev tools', views.devPage({ games, emails }));
    });
    app.get('/dev/emails/:id', (req, res) => {
      const m = db.prepare('SELECT * FROM emails WHERE id = ?').get(Number(req.params.id));
      if (!m) return res.status(404).send('Not found');
      res.send(m.html);
    });
    app.post('/dev/games/:id/resolve', async (req, res) => {
      await service.resolveGame(req.params.id);
      res.redirect(303, '/dev');
    });
    app.post('/dev/tick', async (req, res) => {
      await service.tick();
      res.redirect(303, '/dev');
    });
  }

  app.use((req, res) => page(res, 'Not found', views.messagePage('Not found', 'Nothing here.'), {}, 404));
  app.use((err, req, res, next) => {
    console.error(err);
    if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Server error' });
    page(res, 'Error', views.messagePage('Something went wrong', 'Please try again.'), {}, 500);
  });
  return app;
}
