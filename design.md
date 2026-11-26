# Battle Lines — System Design

## Overview
Battle Lines is a correspondence wargame run by a website. The website acts as referee and email is the turn clock. Each turn lasts one week. All players give orders at the same time, and the server resolves those orders together on a hex map.

## Game Lifecycle

### 1. Creating a game
- A host visits the Battle Lines website and chooses a scenario.
- The host enters the email addresses of the people they want to invite.
- Battle Lines emails each invitee an invitation with **Accept** and **Decline** buttons.
- Once enough players accept (or the host clicks **Start**), the game is set up with the players who accepted. Each player is assigned an army or side.

### 2. Deployment (Turn 0)
- Each player gets an email with a private link to their deployment screen.
- Players place their starting units in their own deployment zone and submit.
- When the deadline passes, the server reveals to each player only the enemy units they can see.

### 3. Each turn
1. **Email out:** each player receives an email with the turn number, the deadline, and a private link.
2. **Review:** the link opens the player's view of the map:
   - their own units and their status
   - enemy units their units can currently see
   - an animated or step-by-step replay of what happened last turn, from that player's point of view
3. **Orders:** the player gives orders to each unit (move path, target, stance, special ability) and submits. Orders can be changed until the deadline.
4. **Resolution:** at the deadline (or earlier, once every player has submitted), the server resolves all orders at once.
5. Repeat until the scenario ends (turn limit reached, objectives held, or an army breaks).

### 4. End of game
- A final email gives the result, the scores, and a link to a full replay with fog of war removed.

## Private Links
- Each player gets a long, random, unguessable token for each game, e.g. `battlelines.example/g/<token>`. Players do not need an account.
- Each token is tied to one player in one game and shows only that player's view.
- Tokens can be reissued, for example if an email was forwarded by mistake.
- Optional later feature: accounts, so a player can see all their games in one place.

## The Hex Map
- Offset or axial hex coordinates, shown as labels like `D7`.
- Each hex has one terrain type: open, road, river, escarpment edge, woods, ruins, and so on.
- Some features run along hex *edges* rather than filling a hex (rivers, escarpments, walls).
- Terrain affects movement cost, line of sight, and combat modifiers (see `rules.md`).

## Simultaneous Resolution
The server resolves orders in **phases**. Results must not depend on the order in which players submitted.

1. **Orders locked.** Units with no orders hold their position.
2. **Movement**, in impulses. Each unit moves one hex per impulse, and all units move in the same impulse at the same time.
   - A unit that moves next to an enemy it can see stops (contact).
   - If two units try to enter the same hex: friendly units → the second one waits; enemy units → both stop where they are and a fight takes place.
3. **Spotting.** Visibility is recalculated from the new positions.
4. **Ranged fire.** All fire happens at once, so a unit destroyed in this phase still gets to fire.
5. **Close combat** between units that are in contact.
6. **Morale.** Units that are damaged or flanked check morale and may retreat or rout.
7. **Objectives and scoring.**
8. **Reports.** One event log per player is built, filtered by what that player could see.

Random results use a **seeded random-number generator** stored with the turn. This makes every result reproducible and checkable, and means bugs can be replayed exactly.

## Fog of War
- Each unit has a **Sight** value. Line of sight is blocked by woods, ruins and higher ground.
- A player sees the enemy units that are inside the sight range and line of sight of any of their own units (or allied units, if the scenario shares vision between allies).
- An enemy unit that was seen earlier but is no longer visible shows as a **"last seen"** marker.
- The server never sends hidden information to the browser. All filtering happens on the server.

## Deadlines and Missed Turns
- The default turn length is 7 days, and the host can change it.
- A reminder email goes out 24 hours before the deadline to anyone who hasn't submitted.
- If a player misses the deadline, their units hold position and defend.
- If a player misses several turns in a row (for example 3), their army switches to a simple AI or is removed, depending on the scenario.

## Pacing
At one turn per week, a 12-turn game takes about 3 months, so:
- Scenarios should be about 8–12 turns long.
- Every turn should involve meaningful decisions. Orders should let a unit plan several hexes of movement plus a conditional action, e.g. "advance to F6; if fired upon, halt and return fire".
- The turn should end as soon as every player has submitted, so fast groups can play faster than once a week.
- Allies can send each other messages from the order screen. The messages are delivered at resolution time.

## Data Model (first sketch)
| Entity | Key fields |
|---|---|
| Game | id, scenario_id, status, turn_number, turn_deadline, turn_length, rng_seed |
| Player | id, game_id, email, side, token, accepted_at, missed_turns |
| Unit | id, game_id, player_id, datasheet_id, hex, facing, strength, status |
| Datasheet | id, name, move, range, attack, defense, morale, sight, abilities |
| Orders | game_id, turn, player_id, unit_id, order JSON, submitted_at |
| TurnResult | game_id, turn, event log, per-player visible log |
| Scenario | id, map, terrain, deployment zones, objectives, turn limit |

## Suggested Technical Architecture
- **Rules engine:** a pure library that takes (game state, orders, seed) and returns (new state, events). It has no database or email code in it, so it can be fully unit-tested and is easy to balance.
- **Web app:** the invitation flow, the token links, the order-entry screen (an SVG hex map in the browser), and the turn replay.
- **Scheduler:** a job that checks deadlines, triggers resolution, and sends emails.
- **Email:** a transactional email service such as Postmark, Amazon SES or Resend.
- **Database:** Postgres.

## Open Questions
- First setting or era for the launch scenario?
- Should allied players share vision?
- How many players per game: 2 only, or teams and free-for-all?
- Should datasheets and unit cards be bought by the host or by each player? (This affects the business model.)
- Should there be a printable version for people who want to play on paper?
