# Battle Lines

**Play now: [darozak.github.io/BattleLines](https://darozak.github.io/BattleLines/)**

Battle Lines is a free correspondence wargame for two to four players, played on a hex map in your
web browser. There is nothing to install, no account to create and no server: the whole game travels
in a link. Take your turn, then send the new link to the next player by email or any messaging app.
They open it, see what you did, take their turn and send it on. A game fits around everyone's day, one
turn at a time.

## How a game works

1. **Start a game.** Open the site, pick a scenario, and enter every player's name in turn order.
   You're player 1 and take the first turn straight away.
2. **Give orders.** Click one of your units, in the unit table or on the map, to open its datasheet.
   Click highlighted hexes to plot its move, choose which way it should face when it stops, and, if
   more than one enemy will be in reach, which one to attack.
   As you plan, the page shows exactly what your orders will do: every attack, with its tally sheet.
3. **End your turn.** Your units move, then attack any enemy next to them, then score for the
   objectives they hold. The page gives you a link for the next player, with buttons to copy,
   email or share it.
4. **Pass it on.** The next player opens the link, sees a report of every turn since they last moved,
   and plays their turn. Each link starts with whose turn it is, for example `…/#Round3-Bob/…`.
5. **Win.** The battle ends after the last round, or when only one army is left. The player with the
   most points wins.

## What's in the game

- **Hex battlefields** that scroll and zoom: a small skirmish map and a large 40×30 valley, with roads,
  woods, hills, ruins and water that affect movement, sight and cover.
- **Units with datasheets**: infantry, scouts and heavy units, each with its own move, sight and strength.
  Every unit faces one of the six hexsides; attacks on a unit's flank or rear are stronger.
- **Nothing hidden**: every player sees the whole battlefield, as in chess.
- **No dice**: combat is decided by a tally of modifiers (strength, flank or rear, cover), and the
  page shows you the tally and the result of every attack before you end your turn. When the link
  comes back to you, your browser replays the other players' moves from the position you sent and
  tells you if anything doesn't match.
- **No sign-up, no tracking**: the game lives in the link, after the `#`, which browsers never send to
  the web server. Your browser remembers your recent games so you can reopen them.

The movement, combat and scoring rules are **placeholders** while the real rules are written
([rules.md](rules.md), [#4](https://github.com/darozak/BattleLines/issues/4)). Unit datasheets,
hand-made scenarios and more are planned: see the [open issues](https://github.com/darozak/BattleLines/issues).

## Design goals

- A flexible, easy-to-use correspondence wargame played by passing links.
- Unit datasheets that describe special combat units and add an immense variety to the game.
- The same rules applied to different periods and settings, with terrain tables for movement and combat,
  and combat results built by combining modifiers into a tally the player sees before committing.

See [design.md](design.md) for how the game is built and [market-study.md](market-study.md) for comparable games.
Inspired by [Warhammer](https://www.warhammer-community.com/wp-content/uploads/2020/07/Lw4o3USx1R8sU7cQ.pdf)
and [One Page Rules](https://onepagerules.com/).

## Contributing

Bug reports, rule ideas and code are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Work on the project
follows the standard operating procedures in [Procedures/](Procedures/README.md); [CLAUDE.md](CLAUDE.md) is
the short version that AI sessions read first.

## Running it locally

Requires Node.js 22 or newer. The code is TypeScript, compiled to a static site in `dist/site`.

```bash
npm install
npm run dev     # build and serve at http://localhost:8080
npm test        # build and run all tests
```

You can play every side from one browser: open each new link and play the next turn.

Every push to `main` is tested, built and published to GitHub Pages by `.github/workflows/pages.yml`;
pull requests are tested by `.github/workflows/tests.yml`. See [AD-03](Procedures/SOPs/AD-03%20Publishing%20the%20live%20site.md).

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
- `Procedures/`: the project's standard operating procedures.

## Licence

Battle Lines is open source under the [MIT licence](LICENSE).
