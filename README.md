# Battle Lines

A correspondence hex wargame that runs entirely in the browser. There is no server: the
whole game travels in a link. Take your turn, then send the new link to the next player.

## Objectives
- Create a flexible, easy-to-use, correspondence-based wargame played by passing links.
- Design unit datasheets that describe special combat units and add an immense variety to the game.
- Generate income by selling access to new and updated unit cards (see open questions in [design.md](design.md)).

## Key Concepts
- The game is a static website (GitHub Pages); the rules engine runs in each player's browser.
- The state of play is compressed into the link. Players pass it on by email or message.
- Played on a hexagonal map. Players take turns one after another; every unit has a facing.
- No hidden information: every player sees the whole battlefield.
- A random seed in the link fixes the dice, so replaying the same orders always gives the same result.
- Unit datasheets describe abilities and range of actions.
- The same rules can be applied to different periods and environments.
- Combat results are obtained by combining modifiers; risk tables generate random, curve-adjusted modifiers.
- Terrain tables describe how different terrains affect movement and combat.

## Gameplay
1. A player opens the site, chooses a scenario and enters every player's name, in turn order.
2. They take the first turn straight away: give orders, then end the turn.
3. The page gives them a link for the next player. Send it by email or any messaging app.
4. The next player opens the link, sees what happened since their last turn, and plays their turn.
5. And so on, until the last round is played or only one army is left.

See [design.md](design.md) for the design and [market-study.md](market-study.md) for comparable games.

## Sources of Inspiration
- [Warhammer](https://www.warhammer-community.com/wp-content/uploads/2020/07/Lw4o3USx1R8sU7cQ.pdf)
- [One Page Rules](https://onepagerules.com/)

## Prototype

The movement, spotting and combat rules in the code are **placeholders**: they exist to
exercise the game flow, and will be replaced by `rules.md` once it is written.

### Running it locally

Requires Node.js 22 or newer. The code is TypeScript, compiled to a static site in `dist/site`.

```bash
npm install
npm run dev     # build and serve at http://localhost:8080
npm test        # build and run all tests
```

You can play every side from one browser: open each new link and play the next turn.

### Publishing on GitHub Pages

`.github/workflows/pages.yml` builds the site, runs the tests and publishes it on every push to `main`.
One-time setup: make the repository public, then in **Settings → Pages**, set **Source** to **GitHub Actions**.
The game is then at `https://<owner>.github.io/<repository>/`.

### Code layout

- `src/shared/`: everything that defines the game, used by the browser and the tests.
  - `engine.ts`: the rules engine (pure functions). Resolves a player's turn.
  - `scenario.ts`: placeholder maps, units and datasheets. `hex.ts`: hex maths and facing. `terrain.ts`: terrain table.
  - `link.ts`: the link encoding (compression, base64url).
  - `game.ts`: create a game, end a turn, read a link, check the other players' moves by replay.
  - `types.ts`: data shapes.
- `src/client/`: the web page. `main.ts`: screens (start, play a turn, send the link). `board.ts`: the map, unit tables and datasheets.
- `public/`: `index.html` and `style.css`.
- `scripts/`: site assembly and a small local web server.
- `test/`: engine tests, and link/game tests (round trips, damaged links, replay checks, link sizes).
