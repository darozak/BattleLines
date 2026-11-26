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
1. **Create:** a player picks a scenario and enters every player's name, in turn order. They are player 1
   and take the first turn straight away.
2. **Each turn:**
   - The player opens the link. They see the battlefield and a report of every turn since they last moved,
     and press "Play <name>'s turn".
   - Their browser replays the other players' orders from the position it sent last time and checks the
     result matches the link ("✓ Checked").
   - They give orders (move paths and end-of-turn facing) and end their turn. Their units move, then attack,
     then score.
   - The page produces the link for the next player, with buttons to copy, email or share it.
3. **Rounds:** a round ends when every player has moved. The game ends after the last round, or when only
   one army is left.

## The Link

```
https://<site>/#Round3-Bob/<base64url(deflate(JSON))>
```

Everything is after `#`, which browsers never send to the web server, so the host never sees games.

- **Label:** every link starts with a readable label showing the round and whose turn it is
  (`Round3-Bob`), or `Final` once the battle is over. Names are reduced to plain letters and digits
  (`Player2` if nothing is left). The label is only for people: the page ignores it when reading the
  link, so editing it changes nothing.

- **Contents:** link version, game id, name, scenario, seed, player names, the changing state (unit positions,
  facings and strengths; scores; round and whose turn it is), and the last round of player-turns (orders and
  what happened), used for reports and replay checks.
- **Not in the link:** the map, datasheets and unit names. They are rebuilt from the scenario and seed.
- **Size:** about 460 characters for 2 players on the small map, up to about 1,300 for 4 players on the
  large map.

## Dice and Fair Play
- The game seed is in the link. Each player-turn's dice come from the seed, round and player, so the same
  position and the same orders always give the same result.
- Each link carries the orders of the last round. When it's your turn again, your browser replays them from
  the position you sent and checks they produce what you received. An altered position shows a warning.
- What can't be prevented: a player can reopen a link and try different orders to see what happens before
  committing. The dice for a given turn are fixed, so trying the same orders again changes nothing.

## The Hex Map
- Pointy-top hexes in offset rows, shown as labels like `D7`.
- Terrain affects movement cost, line of sight and cover. Every unit faces one of the six hexsides.
- The map scrolls and zooms. A unit table sits beside it, and clicking a unit opens its datasheet and orders.

## Turn Resolution (placeholder rules)
1. **Movement:** units move one hex at a time along their paths. A unit stops when it becomes adjacent to a
   new enemy, and can't enter an enemy's hex. Moving units face their last step unless ordered otherwise.
2. **Facing:** units turn to their ordered facing.
3. **Combat:** each of the active player's units next to an enemy attacks the weakest one (2d6 − cover ≥ 8
   hits). Attacks record which arc they hit (front, flank or rear).
4. **Scoring:** the active player scores 1 for each objective they hold with no enemy adjacent.

## Versioning
The rules, maps and datasheets are built into the code. Every link records its format version
(`LINK_VERSION`). Before changing rules in a way that would change the outcome of games in progress, the
current version of the site should be kept available (for example under `/v2/`) so running games can finish.

## Open Questions
- **Selling unit cards:** anything on a static site can be read by anyone, so paid datasheets can't be locked.
  Options include an honour system, selling printed or premium scenario packs, or a small licence check later.
- **Rules:** what turning costs, what front/flank/rear do in combat, and whether facing limits sight or fire
  (see [darozak/BattleLines#4](https://github.com/darozak/BattleLines/issues/4)).
- **Recovering lost links:** the browser remembers recent games, but only on the device that played them.
- **Player-chosen deployment** and **in-game messages:** both fit in the link if wanted.
