# Battle Lines: the rules

Battle Lines is a correspondence wargame for two to four players on a hex map. Players take turns one
after another and pass the game on as a link. Everyone sees the whole battlefield, and there are no
dice: the page shows exactly what your orders will do before you end your turn. These rules describe
the game as it plays on the [live site](https://darozak.github.io/BattleLines/).

<!-- generated:version -->
These rules are version **12**, the same as the game's link version: a link from another version won't open.
<!-- /generated -->

The numbers in these rules are placeholders while the game is being playtested, and will change.

## 1. Setting up

1. One player opens the site and chooses the **era**, the **map size**, the **point limit** and the
   number of players (two to four, and no more than the era has armies), and names every player.
2. The game draws a battlefield for the era and size, places the **objectives**, and puts the players
   in a random **turn order**. The order is the same for deployment and for every round of the battle.
3. Each player has a **starting zone** along one edge of the map: the first player in the turn order
   the west edge, the second the east edge, the third the north edge and the fourth the south edge.

<!-- generated:sizes -->
| Map | Hexes | Rounds | Objectives | Starting zone depth |
| --- | --- | --- | --- | --- |
| Small | 16 × 12 | 10 | 3 | 2 hexes |
| Medium | 24 × 18 | 12 | 5 | 3 hexes |
| Large | 40 × 30 | 12 | 5 | 3 hexes |

Point limits: 100, 150, 200, 300.
<!-- /generated -->

## 2. Deployment (turn 0)

1. In turn order, each player picks one of the era's **armies**. No two players may pick the same army.
2. The player then chooses units from that army and places each one on an empty hex of their starting
   zone. Units can't be placed in a lake.
3. The army may cost up to the point limit, and no more. Any mix of the army's units is allowed, and a
   unit type may be taken more than once. At least one unit must be placed.
4. Placed units face the centre of the map. They can be turned once the battle begins.
5. The player passes the link to the next player, who sees where earlier players deployed. The battle
   begins once every player has deployed.

## 3. The turn

The battle is fought in **rounds**. In each round every player with units left takes one turn, in turn
order. On your turn you give orders to your units, then end the turn. Ending the turn resolves it in
this order:

1. **Movement**: your units move along their ordered paths (section 4).
2. **Facing**: units turn to their ordered facing (section 5).
3. **Combat**: each of your units that you ordered to attack attacks its target, if it can reach it
   (sections 6 and 7).
4. **Morale**: badly damaged units check their morale (section 8).
5. **Scoring**: you score for the objectives you hold (section 9).

Only the player whose turn it is moves and attacks. The other players' units stand still and don't
strike back on your turn; they act on their own turns.

## 4. Movement

1. Each unit has a **move** allowance in movement points. Its path is a chain of adjacent hexes, and each
   step costs movement points:
   - the **terrain** of the hex entered (see the table below);
   - **along a road**: ½, whatever the terrain;
   - **climbing**: +1 for each level of elevation climbed. Descending is free;
   - **fording a river**: +2.
2. **The first step is always allowed**, whatever it costs, so slow ground never traps a unit. Every
   later step needs the movement points to pay for it.
3. **Climb**: a step may rise or fall by no more than the unit's climb (1 for most units, 2 for light
   troops). Steeper drops are cliffs.
4. **Rivers**: a unit must stop at a river before crossing it. It may only ford a river as the first
   step of a move, so a unit that reaches the bank waits there until its next turn. A **bridge** (where
   a road crosses a river) is a road step: no stop and no extra cost.
5. **Lakes** are impassable. A unit can't enter a hex held by an enemy.
6. **Contact**: a moving unit stops as soon as it comes next to an enemy it wasn't next to before.
7. **Friendly units** may move through each other, but no two may end a move in the same hex. A unit
   that didn't move keeps its hex; otherwise the unit that got there first does, and the other stops on
   the last hex of its path where it can.
8. A unit that moves faces the direction of its last step, unless it is ordered to face another way.

<!-- generated:terrain -->
| Terrain | Move cost | Cover | Blocks sight |
| --- | --- | --- | --- |
| Open | 1 | 0 | no |
| Light forest | 2 | +1 | no |
| Dense forest | 3 | +2 | yes |
| Hills | 2 | +1 | yes |
| Ruins | 2 | +2 | yes |
| Village | 1 | +2 | yes |
| Marsh | 3 | 0 | no |
| Lake | impassable | – | no |
<!-- /generated -->

Roads and rivers are lines on the map, not terrain: roads run between hex centres and rivers along hex
edges. Every hex also has an **elevation** (the number shown in it).

## 5. Facing

1. Every unit faces one of the six hexsides. Its **front** is the three hexsides it faces, its **flank**
   the two beside them, and its **rear** the hexside behind.
2. A unit may be ordered to face any direction at the end of its move, whether or not it moved. Turning
   is free.

## 6. Close combat

1. **Attacks are optional.** A unit attacks only if you order it to, and only the enemy you pick. To
   attack, select your unit and click the enemy on the map, or pick it on the unit's datasheet. Click it
   again, or choose "Don't attack", to cancel.
2. After movement, a unit attacks its target in **close combat** if the target is next to it. If the
   target isn't in reach once the unit has moved, there is no attack.
3. The attack is a **tally** of modifiers, shown before you end your turn:
   - **Attack** = the attacker's **strength**, +1 if it attacks the target's flank, +2 if it attacks the
     target's rear, + 1 for each level the attacker stands above the target (− 1 for each level below it),
     − 2 attacking across a river, − 1 attacking across a bridge.
   - **Defence** = 3, + the **cover** of the target's hex.
   - **Hits** = attack − defence, and never less than 0.
4. All your attacks land together, after movement. Each hit removes one point of the target's strength;
   a unit at 0 is **destroyed**.

## 7. Ranged attacks

1. A unit with a range on its datasheet may **fire** at an enemy that isn't next to it. You pick the
   target the same way as for close combat (section 6), and firing is just as optional.
2. An enemy next to the unit that **faces** it (the unit is on one of that enemy's front three hexsides,
   section 5) stops it firing: it can only attack in close combat. Enemies next to it that show it their
   flank or rear don't stop it, so it may choose between close combat and firing past them.
3. The target must be, once the unit has moved and turned:
   - within its **range** in hexes;
   - in its **front** (section 5);
   - in **line of sight**: no hex between the two blocks sight (see the terrain table). The hexes the
     units stand in never block.
4. The tally:
   - **Attack** = the unit's **fire**, − 1 for each hex beyond 2, + the flank and rear bonuses and the
     height modifier of close combat. Rivers don't matter.
   - **Defence** = 2, + the cover of the target's hex.
   - **Hits** = attack − defence, and never less than 0.
5. Units without a range (cavalry, for example) never fire. Fire lands with the close-combat attacks.

## 8. Morale

1. After the attacks, each unit that took hits this turn, survived, and is down to **half its starting
   strength or less** checks its morale.
2. The tally:
   - **Morale** = the unit's **morale**, + the **rally** value of each friendly rallying unit (guards and
     other elites) within 2 hexes, − 1 for every 3 hexes (or part of 3) it stands more than 3 hexes from
     its army's **main body**. The main body is the army's centre unit: the one with the smallest total
     distance to all the others.
   - **Losses** = the strength the unit has lost since the battle began.
3. The unit **holds** if its morale is greater than its losses. Otherwise it **breaks and disbands**, and
   leaves the battle.
4. All checks are made against the battlefield as it stands after the attacks, so a unit that breaks
   doesn't affect another unit's check in the same turn.

## 9. Scoring and the end of the battle

1. At the end of your turn you score **1 point for each objective** one of your units stands on with no
   enemy next to it.
2. A player whose units are all gone is out of the game, and loses their turns.
3. The battle ends after the last round, or as soon as only one army is left.
4. The player with the most points wins; if only one army is left, it wins. Players with no units left
   can't win. A tie shares the victory.

## 10. Armies and units

Each era has its own terrain and four armies, each with its own units. A unit's datasheet gives:

- **Points**: its cost at deployment.
- **Move**: its movement points (section 4). **Climb**: the most levels it can rise or fall in one step.
- **Strength**: its close-combat attack, and how many hits it can take.
- **Fire** and **range**: its ranged attack (section 7); "–" means it can't fire.
- **Morale** and **rally**: its steadiness, and how much it steadies friends nearby (section 8).
- **Sight**: how far it sees, for rules that need it.

<!-- generated:units -->
### Napoleonic Wars

Line infantry, skirmishers and cavalry among villages, forests, marshes and rolling hills, with a river to cross.

**French Empire.** Fast cavalry and the formidable Old Guard.

| Unit | Points | Move | Climb | Strength | Fire | Range | Morale | Rally | Sight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Line Infantry | 20 | 3 | 1 | 4 | 3 | 2 | 3 | – | 5 |
| Voltigeurs | 15 | 5 | 2 | 2 | 3 | 3 | 2 | – | 7 |
| Hussars | 25 | 7 | 1 | 3 | – | – | 3 | – | 6 |
| Old Guard | 40 | 3 | 1 | 6 | 4 | 2 | 5 | 1 | 5 |

**British Army.** Steady redcoats and sharpshooting riflemen.

| Unit | Points | Move | Climb | Strength | Fire | Range | Morale | Rally | Sight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Redcoats | 20 | 3 | 1 | 4 | 4 | 2 | 3 | – | 5 |
| 95th Rifles | 15 | 5 | 2 | 2 | 4 | 4 | 2 | – | 7 |
| Light Dragoons | 25 | 7 | 1 | 3 | – | – | 3 | – | 6 |
| Foot Guards | 40 | 3 | 1 | 6 | 4 | 2 | 5 | 1 | 5 |

**Austrian Empire.** Solid infantry, Grenzer skirmishers and heavy cuirassiers.

| Unit | Points | Move | Climb | Strength | Fire | Range | Morale | Rally | Sight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Line Infantry | 20 | 3 | 1 | 4 | 3 | 2 | 3 | – | 5 |
| Grenzers | 15 | 5 | 2 | 2 | 3 | 3 | 2 | – | 7 |
| Cuirassiers | 30 | 6 | 1 | 4 | – | – | 4 | – | 6 |
| Grenadiers | 35 | 3 | 1 | 5 | 3 | 2 | 4 | 1 | 5 |

**Prussian Army.** Landwehr in numbers, Jäger and hussars.

| Unit | Points | Move | Climb | Strength | Fire | Range | Morale | Rally | Sight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Landwehr | 15 | 3 | 1 | 3 | 2 | 2 | 2 | – | 5 |
| Jäger | 15 | 5 | 2 | 2 | 4 | 3 | 2 | – | 7 |
| Black Hussars | 25 | 7 | 1 | 3 | – | – | 3 | – | 6 |
| Guard Infantry | 40 | 3 | 1 | 6 | 4 | 2 | 5 | 1 | 5 |

### Second World War

Infantry, recon and armour fighting over forests, hills, marshes and ruined towns, with a river to cross.

**US Infantry Division.** Rifle squads backed by Shermans and paratroopers.

| Unit | Points | Move | Climb | Strength | Fire | Range | Morale | Rally | Sight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rifle Squad | 20 | 4 | 1 | 4 | 3 | 3 | 3 | – | 5 |
| Recon Patrol | 15 | 6 | 2 | 2 | 2 | 3 | 2 | – | 7 |
| Sherman | 45 | 6 | 1 | 6 | 5 | 5 | 4 | – | 4 |
| Paratroopers | 30 | 4 | 2 | 4 | 3 | 3 | 4 | 1 | 6 |

**German Panzergrenadiers.** Grenadiers with heavy armour and mountain troops.

| Unit | Points | Move | Climb | Strength | Fire | Range | Morale | Rally | Sight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Grenadiers | 20 | 4 | 1 | 4 | 3 | 3 | 3 | – | 5 |
| Scouts | 15 | 6 | 2 | 2 | 2 | 3 | 2 | – | 7 |
| Panzer IV | 50 | 5 | 1 | 7 | 6 | 5 | 4 | – | 4 |
| Gebirgsjäger | 30 | 4 | 2 | 4 | 3 | 3 | 4 | 1 | 6 |

**British Infantry Division.** Rifle sections, Bren carriers, Churchills and commandos.

| Unit | Points | Move | Climb | Strength | Fire | Range | Morale | Rally | Sight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rifle Section | 20 | 4 | 1 | 4 | 3 | 3 | 3 | – | 5 |
| Bren Carrier | 20 | 6 | 1 | 3 | 3 | 3 | 2 | – | 6 |
| Churchill | 45 | 4 | 1 | 7 | 5 | 4 | 4 | – | 4 |
| Commandos | 30 | 4 | 2 | 4 | 3 | 3 | 4 | 1 | 6 |

**Soviet Rifle Division.** Masses of riflemen with T-34s.

| Unit | Points | Move | Climb | Strength | Fire | Range | Morale | Rally | Sight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rifle Squad | 15 | 4 | 1 | 3 | 2 | 3 | 2 | – | 5 |
| Razvedchiki | 15 | 6 | 2 | 2 | 2 | 3 | 2 | – | 7 |
| T-34 | 45 | 6 | 1 | 6 | 5 | 5 | 4 | – | 4 |
| Guards Rifles | 25 | 4 | 1 | 4 | 3 | 3 | 4 | 1 | 5 |
<!-- /generated -->
