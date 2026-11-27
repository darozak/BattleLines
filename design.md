# Battle Lines — System Design

## Overview
Battle Lines is a correspondence hex wargame with no server. The site is static (GitHub Pages) and the
rules engine runs in each player's browser. The whole state of play travels in the link, compressed.
Players take turns one after another and pass the link on by email or message. There is no hidden
information: every player sees the whole battlefield.

Earlier designs are in the git history: a server-refereed version with simultaneous orders and email
(up to commit `509a6f6`), and a serverless version with PIN-locked fog of war (commit `68a50d1`). The
fog of war was dropped because it complicated play and invited players to dig into the page to peek.

## Game Lifecycle
1. **Set up:** the first player chooses the era, the map size, the point limit and the number of players,
   and names every player. The game shuffles the players into a random turn order and shows the link for
   the first player.
2. **Turn 0, deployment:** each player in turn order opens the link, picks one of the era's armies (each
   player a different one, so an era allows as many players as it has armies, up to 4), then
   chooses units from that army and places them in their starting zone, within the point limit (the total
   may equal the limit). Earlier players' units are visible. When the last player has deployed, round 1
   begins with the first player. Starting zones are strips along the edges, by turn order: west, east,
   north, south. Units face the centre of the map when placed, and can be turned from round 1.
3. **Each turn:**
   - The player opens the link. They see the battlefield and a report of every turn since they last moved,
     and press "Play <name>'s turn".
   - Their browser replays the other players' orders from the position it sent last time and checks the
     result matches the link ("✓ Checked").
   - They give orders (move paths and end-of-turn facing) and end their turn. Their units move, then attack,
     then score.
   - The page produces the link for the next player, with buttons to copy, email or share it.
4. **Rounds:** a round ends when every player has moved. The game ends after the last round, or when only
   one army is left.

## The Link

```
https://<site>/#Round3-Bob/<base64url(deflate(JSON))>
```

Everything is after `#`, which browsers never send to the web server, so the host never sees games.

- **Label:** every link starts with a readable label showing what it waits for: `Deploy-Cara` on turn 0,
  `Round3-Bob` in battle, or `Final` once the battle is over. Names are reduced to plain letters and digits
  (`Player2` if nothing is left). The label is only for people: the page ignores it when reading the
  link, so editing it changes nothing.

- **Contents:** link version, game id, name, era, map size, point limit, map seed, player names in turn order,
  the changing state (phase; each player's army; each unit's type, owner, position, facing and strength;
  scores; round and whose turn it is), and the last round of player-turns (orders and
  what happened), used for reports and replay checks.
- **Not in the link:** the map, datasheets and unit names. They are rebuilt from the era, map size and seed.
- **Size:** after three rounds, about 650 characters for 2 players on the small map, and about 1,700 for 4
  players with 44 units on the large map.

## Prescriptive Combat and Fair Play
- There are no dice. Every attack's result is fixed by a tally of modifiers, so the same position and the
  same orders always give the same result. (The seed in the link only generates the map.)
- While a player plans, the page runs their orders through the rules engine and shows exactly what ending
  the turn would do: each attack and each morale check as a tally sheet listing every modifier, the units
  destroyed or disbanded, units that
  would stop early on contact, and points scored. The attacks are drawn on the map with their hits.
- Each link carries the orders of the last round. When it's your turn again, your browser replays them from
  the position you sent and checks they produce what you received. An altered position shows a warning.
- Reopening a link to try different orders gains nothing: the page already shows every outcome before
  the turn is ended.

## The Hex Map
- Pointy-top hexes in offset rows, shown as labels like `D7`.
- Terrain affects movement, line of sight and cover; the values are in [rules.md](rules.md) (generated from
  `TERRAIN` in `src/shared/terrain.ts`). Where map generation puts each kind of terrain:

  | Terrain | Where it appears |
  |---|---|
  | Open | everywhere else |
  | Light forest | forest clusters |
  | Dense forest | the heart of a forest (a forest hex surrounded by forest) |
  | Hills | clusters, one level above their surroundings |
  | Ruins | both eras |
  | Village | Napoleonic era |
  | Marsh | grows beside rivers |
  | Lake | small clusters |

- **Roads, rivers and bridges are lines**, not terrain (their effects on movement and combat are in rules.md):
  - **Roads** join hex centres: a meandering west–east and north–south road, with branches to villages, ruins
    and other points.
  - **Rivers** run along hex edges: a meandering river from the north edge to the south edge, with branching
    tributaries.
  - **Bridges** are where a road crosses a river.
  - The map stores both as pairs of adjacent hexes (`roads`, `rivers`); a pair in both lists is a bridge.

- Every unit faces one of the six hexsides.
- Every hex has an elevation (0 and up), generated with the map from its seed, so it isn't carried in links.
  Hills sit one level above the ground around them. The map shades lower ground darker, writes each hex's
  height at its top, and draws edges with a drop of 2 or more as cliffs.
- The map scrolls and zooms. A unit table sits beside it, and clicking a unit opens its datasheet and orders.

## Turn Resolution
The rules of play, with every number, are in [rules.md](rules.md), published as the
[Rules page](https://darozak.github.io/BattleLines/rules.html) and kept in step with the code per DV-02. The
engine (`resolvePlayerTurn` in `src/shared/engine.ts`) resolves the active player's turn in the order the
rules give: movement, facing, combat (close combat and fire land together), morale, scoring. How it does so:

- **Movement** is simulated in impulses: every moving unit takes one step per impulse, so contact and
  crowding are decided by who gets where first, not by the order of the orders. Step costs and the river
  rule come from `stepCost` and `stepProblem` in `src/shared/terrain.ts`, which the page also uses to
  highlight moves, so the map only offers hexes the engine will accept.
- **Combat**: every attack is worked out against the board after movement, then all hits are applied.
- **Morale**: every check is made against the board after the attacks, then units that fail are removed.
- **Preview**: the page runs `resolvePlayerTurn` on the planned orders, so the preview is exactly what
  ending the turn will do.

## Versioning
The rules, maps and datasheets are built into the code. Every link records its format version
(`LINK_VERSION`). Before changing rules in a way that would change the outcome of games in progress, the
current version of the site should be kept available (for example under `/v2/`) so running games can finish.

## Open Questions
- **Selling unit cards:** anything on a static site can be read by anyone, so paid datasheets can't be locked.
  Options include an honour system, selling printed or premium era and army packs, or a small licence check later.
- **Rules:** what turning costs, what front/flank/rear do in combat, and whether facing limits sight or fire
  (see [darozak/BattleLines#4](https://github.com/darozak/BattleLines/issues/4)).
- **Recovering lost links:** the browser remembers recent games, but only on the device that played them.
- **Player-chosen deployment** and **in-game messages:** both fit in the link if wanted.
