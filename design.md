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
- Terrain affects movement cost, line of sight and cover (placeholder values):

  | Terrain | Move cost | Cover | Blocks sight | Where it appears |
  |---|---|---|---|---|
  | Open | 1 | 0 | no | everywhere else |
  | Light forest | 2 | +1 | no | forest clusters |
  | Dense forest | 3 | +2 | yes | the heart of a forest (a forest hex surrounded by forest) |
  | Hills | 2 | +1 | yes | clusters, one level above their surroundings; +2 sight |
  | Ruins | 2 | +2 | yes | both eras |
  | Village | 1 | +2 | yes | Napoleonic era |
  | Marsh | 3 | 0 | no | grows beside rivers |
  | Lake | impassable | – | no | small clusters |

- **Roads, rivers and bridges are lines** (placeholder values):
  - **Roads** join hex centres: a meandering west–east and north–south road, with branches to villages, ruins
    and other points. A step **along** a road costs 1, whatever the terrain.
  - **Rivers** run along hex edges: a meandering river from the north edge to the south edge, with branching
    tributaries. **Crossing** one costs +2 movement; attacking across one is −2 attack.
  - **Bridges** are where a road crosses a river: no extra movement, and −1 to attack across.
  - The map stores both as pairs of adjacent hexes (`roads`, `rivers`); a pair in both lists is a bridge.

- Every unit faces one of the six hexsides.
- Every hex has an elevation (0 and up), generated with the map from its seed, so it isn't carried in links.
  Hills sit one level above the ground around them. The map shades lower ground darker, writes each hex's
  height at its top, and draws edges with a drop of 2 or more as cliffs.
- The map scrolls and zooms. A unit table sits beside it, and clicking a unit opens its datasheet and orders.

## Turn Resolution (placeholder rules)
1. **Movement:** units move one hex at a time along their paths. A unit stops when it becomes adjacent to a
   new enemy, and can't enter an enemy's hex. Moving units face their last step unless ordered otherwise.
   Each step may rise or fall by at most the unit's **climb** (1 for most units, 2 for light troops).
   Friendly units may pass through each other, but no two may end a move in the same hex: a unit that
   stayed put keeps its hex, otherwise the one that got there first does, and the other stops on the last
   free hex of its route. The map only offers hexes where a unit can actually stop.
2. **Facing:** units turn to their ordered facing.
3. **Combat:** each of the active player's units next to an enemy attacks it in close combat: the target
   in its orders if that enemy is in reach, otherwise the weakest. Units with no enemy next to them may
   fire (below). All attacks land together.
   - **Attack** = the attacker's strength, +1 from the target's flank, +2 from its rear, + the attacker's
     height above the target (or − its height below it, when attacking uphill).
     Attacking across a river is −2, across a bridge −1.
   - **Defence** = 3 (base), + the cover of the target's hex (light forest and hills 1; dense forest, ruins
     and villages 2).
   - **Hits** = attack − defence, never below 0. Each hit removes one strength point; a unit at 0 is destroyed.
   - **Ranged attacks:** a unit with no enemy next to it fires instead, if its datasheet gives it a range:
     at the ordered target, or else the nearest enemy (then the weakest) within range, in its front arc
     (the three hexsides it faces) and in line of sight (no hex between blocks sight). Attack = its
     **fire**, − 1 for each hex beyond 2, + flank/rear and height as above (rivers don't matter); defence
     = 2 + cover. Cavalry can't fire; muskets reach 2 hexes, rifles 3–4, tanks 4–5.
4. **Morale:** each unit that took hits, survived, and is down to half its starting strength or less checks
   morale, all against the battlefield as it stands after the attacks.
   - **Morale** = the unit's morale (on its datasheet), + the rally value of each friendly rallying unit
     (guards and other elites, rally 1) within 2 hexes, − 1 for every 3 hexes (or part of 3) it stands more
     than 3 hexes from its army's **main body**: the army's centre unit, the one with the smallest total
     distance to the rest.
   - **Losses** = strength lost since the battle began.
   - The unit holds if morale is greater than losses; otherwise it breaks and disbands, leaving the battle.
5. **Scoring:** the active player scores 1 for each objective they hold with no enemy adjacent.

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
