# Battle Lines

A correspondence hex wargame that runs entirely in the browser. There is no server: the
whole game travels in a link. Take your turn, then send the new link to the next player.

## Objectives
- Create a flexible, easy-to-use, correspondence-based wargame played by passing links.
- Design unit datasheets that describe special combat units and add an immense variety to the game.
- Generate income by selling access to new and updated unit cards (see open questions in [design.md](design.md)).

## Key Concepts
- The game is a static website (GitHub Pages); the rules engine runs in each player's browser.
- The state of play is compressed and encrypted into the link. Players pass it on by email or message.
- Played on a hexagonal map. Players take turns one after another; every unit has a facing.
- Each player picks a PIN. A link can only be opened by the player whose turn it is.
- A random seed in the link fixes the dice, so replaying the same orders always gives the same result.
- Unit datasheets describe abilities and range of actions.
- The same rules can be applied to different periods and environments.
- Combat results are obtained by combining modifiers; risk tables generate random, curve-adjusted modifiers.
- Terrain tables describe how different terrains affect movement and combat.

## Gameplay
1. A player opens the site, chooses a scenario and the number of players, enters their name and picks a PIN.
2. They send the invitation link to the next player, who adds their name and PIN, and so on until everyone has joined.
3. The last player to join sends the link to player 1, who moves first.
4. On your turn: open the link, enter your PIN, see your troops and what they can see, give orders, end your turn.
5. The page gives you a new link for the next player. Send it by email or any messaging app.
6. When the battle ends, the final link shows the whole battlefield to everyone.

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

Open the site in two different browsers (or a normal and a private window) to play both sides.

### Publishing on GitHub Pages

`.github/workflows/pages.yml` builds the site, runs the tests and publishes it on every push to `main`.
One-time setup: make the repository public, then in **Settings → Pages**, set **Source** to **GitHub Actions**.
The game is then at `https://<owner>.github.io/<repository>/`.

### Code layout

- `src/shared/`: everything that defines the game, used by the browser and the tests.
  - `engine.ts`: the rules engine (pure functions). Resolves a player's turn and works out what each player can see.
  - `scenario.ts`: placeholder maps, units and datasheets. `hex.ts`: hex maths and facing. `terrain.ts`: terrain table.
  - `link.ts`: the link format: compression, PIN-locked keys, and encryption of the state for the next player.
  - `game.ts`: create, join, open a turn, end a turn, check the other players' moves by replay.
  - `types.ts`: data shapes.
- `src/client/`: the web page. `main.ts`: screens (start, join, PIN, send link). `board.ts`: the map, unit tables and datasheets.
- `public/`: `index.html` and `style.css`.
- `scripts/`: site assembly and a small local web server.
- `test/`: engine tests, and link/game tests (PINs, tampering, replay checks, link sizes).
