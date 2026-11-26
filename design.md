# Battle Lines — System Design

## Overview
Battle Lines is a correspondence hex wargame with no server. The site is static (GitHub Pages) and the
rules engine runs in each player's browser. The whole state of play travels in the link, compressed and
encrypted. Players take turns one after another and pass the link on by email or message.

The original design used a server as referee, with simultaneous orders, deadlines and emails. That
version is in the git history (up to commit `509a6f6`).

## Game Lifecycle

### 1. Creating and joining
- The first player picks a scenario and the number of players, enters their name and chooses a PIN.
  The page produces an invitation link.
- Each invited player opens the link, enters their name and chooses their own PIN, and passes the link to
  the next player. Turn order is join order.
- When the last player joins, the starting position is created and sealed for player 1, and the last
  player sends that link to player 1.

### 2. Each turn
1. The player whose turn it is opens the link and enters their PIN. Anyone else sees only
   "this link is waiting for <name>".
2. They see their own units, what those units can see, enemies last seen, and reports of what they saw
   happen since their last turn.
3. Their browser replays the other players' orders from the position it sent last time and checks the
   result matches the link ("✓ Checked").
4. They give orders (move paths and end-of-turn facing) and end their turn. Their units move, then attack,
   then score.
5. The page produces a new link, sealed for the next player, with buttons to copy, email or share it.
6. A round ends when every player has moved. The game ends after the last round, or when only one army is left.

### 3. End of game
The final link is not encrypted: it shows the whole battlefield, with nothing hidden, to everyone.

## The Link

```
https://<site>/#<header>.<sealed state>
```

Everything is after `#`, which browsers never send to the web server, so the host never sees games.

- **Header** (public): link version, game id, name, scenario, seed, number of players, each player's name,
  public key and PIN-locked private key, phase, round and whose turn it is. JSON, deflate-compressed, base64url.
- **Sealed state**: only what changes during play (unit positions, facings and strengths; scores; each
  player's last-seen markers and reports; the last few player-turns' orders, for replay checks). The map,
  datasheets and unit names are rebuilt from the scenario and seed. JSON, deflate-compressed, then encrypted.
- **Size**: about 1,000 characters for 2 players and about 1,800 for 4, on either map. About 300 characters
  per player are their keys.

## PINs and Hidden Information
- Each player has an ECDH P-256 key pair, created in their browser when they join.
- The private key is encrypted with a key derived from their PIN (PBKDF2-SHA256, 310,000 iterations) and
  stored in the header. The PIN itself is never stored.
- Ending a turn encrypts the state to the next player's public key (ephemeral ECDH + HKDF + AES-GCM). The
  header is bound in as additional data, so altering it breaks the seal.
- **What this protects:** a link can only be opened by the player it is addressed to, so nobody can look at
  the board when it isn't their turn, and anyone else who gets hold of the link learns nothing.
- **What it can't protect:** during your own turn, your browser holds the whole state, because it needs it to
  apply the rules. A player willing to dig into the page's memory could see hidden units. Short PINs can be
  guessed by a script, so 6+ characters are recommended.
- **A forgotten PIN can't be recovered**, and the game can't continue without it.

## Dice and Fair Play
- The game seed is in the header. Each player-turn's dice come from the seed, round and player, so the same
  position and the same orders always give the same result.
- Each link carries the orders of recent player-turns. When it's your turn again, your browser replays them
  from the position you sent and checks they produce what you received. An altered position shows a warning.
- What can't be prevented: a player can reopen a link and try different orders to see what happens before
  committing. The dice for a given turn are fixed, so trying the same orders again changes nothing.

## The Hex Map
- Pointy-top hexes in offset rows, shown as labels like `D7`.
- Terrain affects movement cost, line of sight and cover. Every unit faces one of the six hexsides.
- The map scrolls and zooms. A unit table sits beside it, and clicking a unit opens its datasheet and orders.

## Turn Resolution (placeholder rules)
1. **Movement**: units move one hex at a time along their paths. A unit stops when it becomes adjacent to a
   new enemy, and can't enter an enemy's hex. Moving units face their last step unless ordered otherwise.
2. **Facing**: units turn to their ordered facing.
3. **Combat**: each of the active player's units next to an enemy attacks the weakest one (2d6 − cover ≥ 8
   hits). Attacks record which arc they hit (front, flank or rear).
4. **Scoring**: the active player scores 1 for each objective they hold with no enemy adjacent.
5. **Reports**: each other player gets a report of what they could see.

## Versioning
The rules, maps and datasheets are built into the code. Every link records its format version
(`LINK_VERSION`). Before changing rules in a way that would change the outcome of games in progress, the
current version of the site should be kept available (for example under `/v1/`) so running games can finish.

## Open Questions
- **Selling unit cards**: anything on a static site can be read by anyone, so paid datasheets can't be locked.
  Options include an honour system, selling printed or premium scenario packs, or a small licence check later.
- **Rules**: what turning costs, what front/flank/rear do in combat, and whether facing limits sight
  (see [darozak/BattleLines#4](https://github.com/darozak/BattleLines/issues/4)).
- **Recovering lost links**: the browser remembers recent games, but only on the device that played them.
- **Player-chosen deployment** and **in-game messages**: both fit in the link if wanted.
