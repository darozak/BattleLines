# Battle Lines

**Play now: [darozak.github.io/BattleLines](https://darozak.github.io/BattleLines/)** · **[Read the rules](https://darozak.github.io/BattleLines/rules.html)**

Battle Lines is a free correspondence wargame for two to four players, played on a hex map in your
web browser. There is nothing to install, no account to create and no server: the whole game travels
in a link. Take your turn, then send the new link to the next player by email or any messaging app.
They open it, see what you did, take their turn and send it on. A game fits around everyone's day, one
turn at a time.

## How a game works

The main button for each step (Create game, Deploy, Finish deployment, End turn) is always in the header
at the top of the page, so you never need to scroll to find it. The map has the whole screen: the game,
round, scenario and scores are in a slim bar above it, and the **Report** button shows what has happened.

1. **Set up.** Open the site and choose the era, the map size, the point limit, the scenario, the
   number of rounds and the number of players, and name the players. Every choice starts with a sensible default, including random names that suit the era: battles such as "Combat of Beaumont-le-Val" or "Assault on Hill 213", and commanders such as "Colonel Ashby" or "Captain Sokolov" (🎲 draws another), so you can press Create game straight away. The game puts the players in a random order.
2. **Deploy (turn 0).** Each player in turn picks one of the era's armies (no two players can pick the
   same one), then chooses units from it and places them in their starting zone, up to the point limit,
   and passes the link on. Once they have picked an army, **Deploy army for me** draws a random set of its
   units (mostly cheaper ones) and places them; each press draws a new deployment to keep or adjust. Units can be turned to face a new
   direction once the battle begins. Later players can see where earlier players deployed. The battle
   begins once everyone has deployed.
3. **Give orders.** Hover over any unit (on a phone, press and hold it) to see its details and what will happen to
   it this turn. Hover over (or press and hold) woods, hills, villages, roads, rivers and other terrain
   features to see what they do in battle. Everything else happens on the map. Click one of your units, or step through them with
   ◀ ▶, then:
   - click a highlighted hex to move it there (click another to change your mind, or its own hex to stay);
   - press on its new position and drag left or right to turn it;
   - click an enemy it can reach (marked in red) to attack or fire at it, and again to cancel. Attacks are
     always optional, and moving or turning the unit cancels its attack, so pick the target last.
   As you plan, the page shows exactly what your orders will do: every attack, with its tally sheet.
4. **End your turn.** Your units move, then attack or fire at the enemies you picked; badly damaged enemies check
   their morale; then you score for the objectives you hold. **End turn** opens a box showing exactly what
   your turn will do and the link for the next player, with buttons to copy, email or share it. It also
   shows an **email card**: one of several battle pictures with a call to action ("Click here for your next
   turn"), and a short message you can edit, which starts as "Player 2, it's your turn." **Copy card** copies
   both: paste into an email (Gmail and others) and the picture opens the game. **Share…** and **Email…** send
   your message with the link. **Cancel**
   takes you back to your orders; once you've sent the link, **Done** shows the result. Shared links show a
   Battle Lines preview card in chat apps and social media.
5. **Pass it on.** The next player opens the link, sees a report of every turn since they last moved,
   and plays their turn. Each link starts with whose turn it is, for example `…/#Deploy-Cara/…` or `…/#Round3-Bob/…`.
6. **Win.** The scenario decides how points are scored: **Hold the Field**, **King of the Hill**,
   **Annihilation**, **Capture the Flags** or **Decisive Ground** (see the [rules](https://darozak.github.io/BattleLines/rules.html#9-scenarios-scoring-and-the-end-of-the-battle)).
   The battle ends after the last round, or when only one army is left, and the player with the most
   points wins.

## What's in the game

- **Eras**: each with its own terrain and its own armies, and units unique to each army. For now:
  the Napoleonic Wars (French, British, Austrian and Prussian armies) and the Second World War (US,
  German, British and Soviet divisions).
- **Hex battlefields** in three sizes (16×12, 24×18 and 40×30) that scroll and zoom, with light and
  dense forest, hills, marshes, ruins (and villages in the Napoleonic era) and lakes, each affecting
  movement, sight and cover. Marshes and woods are slow going, and climbing costs extra. On the map an
  icon shows each hex's terrain, and its colour shows its height, from green lowland to brown high ground.
- **Roads, rivers and bridges** are lines, not hexes. Roads run mostly straight and branch between hex centres, with no sharp turns:
  following one doubles a unit's speed whatever the ground. A river crosses the map along hex edges, always downhill or level, sometimes with a tributary:
  troops must stop at a river before crossing, and attacking across it is hard. Where a road crosses a
  river there is a bridge.
- **Elevation**: every hex has a height. Most units can climb or descend only one level per step
  (light troops can manage two), so steep drops act as cliffs. Attacking from higher ground is stronger;
  attacking uphill is weaker.
- **Units with datasheets**: each with its own point cost, move, climb, sight, strength, fire, range and morale. Light troops
  climb two levels per step; the rest climb one.
  Every unit faces one of the six hexsides; attacks on a unit's flank or rear are stronger.
- **Ranged attacks**: muskets, rifles and guns fire at enemies within range, in front of them and in line
  of sight. Fire weakens with distance; units with an enemy next to them fight in close combat instead.
- **Morale**: a unit battered down to half strength or less checks its morale. Rallying elites nearby
  steady it; straying far from the army's main body weakens it. If its morale doesn't beat its losses, it
  disbands. Like combat, the check is a tally you see before you end your turn.
- **Nothing hidden**: every player sees the whole battlefield, as in chess.
- **No dice**: combat is decided by a tally of modifiers (strength, flank or rear, height, cover), and the
  page shows you the tally and the result of every attack before you end your turn. When the link
  comes back to you, your browser replays the other players' moves from the position you sent and
  tells you if anything doesn't match.
- **No sign-up, no tracking**: the game lives in the link, after the `#`, which browsers never send to
  the web server. Your browser remembers your recent games so you can reopen them.

The full rules are in [rules.md](rules.md), also published as the
[Rules page](https://darozak.github.io/BattleLines/rules.html) of the live site. Their numbers, and the eras' armies
and unit values, are **placeholders** while the game is playtested. Hand-made maps and more are planned: see the [open issues](https://github.com/darozak/BattleLines/issues).

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
npm run rules   # regenerate the tables in rules.md from the game data
```

You can play every side from one browser: open each new link and play the next turn.

Every push to `main` is tested, built and published to GitHub Pages by `.github/workflows/pages.yml`;
pull requests are tested by `.github/workflows/tests.yml`. See [AD-03](Procedures/SOPs/AD-03%20Publishing%20the%20live%20site.md).

### Code layout

- `src/shared/`: everything that defines the game, used by the browser and the tests.
  - `engine.ts`: the rules engine (pure functions). Resolves a player's turn.
  - `setup.ts`: eras, armies and unit datasheets (placeholders), map sizes, point limits, starting zones, map generation, and turn 0 (deployment).
  - `hex.ts`: hex maths and facing. `terrain.ts`: terrain table. `names.ts`: random battle and commander names for each era.
  - `link.ts`: the link encoding (compression, base64url).
  - `game.ts`: set up a game, deploy, end a turn, read a link, check the other players' turns by replay.
  - `types.ts`: data shapes.
- `src/client/`: the web page. `main.ts`: screens (set up, deploy, play a turn, send the link). `board.ts`: the map (orders are given on it), unit info boxes and deployment. `terrain-art.ts`: terrain icons and the elevation colours.
- `public/`: `index.html` and `style.css`.
- `src/rules/`: the tables in `rules.md` that are generated from the game data.
- `scripts/`: site assembly (including the Rules page, built from `rules.md`), a small local web server, and `update-rules.mjs`.
- `test/`: engine tests, link/game tests (round trips, damaged links, replay checks, link sizes), and a check that `rules.md` is up to date.
- `Procedures/`: the project's standard operating procedures.

## Licence

Battle Lines is open source under the [MIT licence](LICENSE).
