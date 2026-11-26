# Battle Lines: Market Study

*Prepared November 2026. Combines what we already knew with a web search for current information. Figures taken from third-party sites are snapshots and should be checked again before being relied on.*

## Summary

No game we found matches what Battle Lines will be: a tactical hex wargame with simultaneous orders and hidden units, resolved automatically by a server and played in the browser from a link in an email.

The space around it has three kinds of game:

1. **Online Diplomacy.** These sites have a large, active audience used to games with simultaneous orders and deadlines. They have no tactics, dice or unit variety.
2. **Old-school, computer-moderated play-by-mail and play-by-email games.** They are long-running and proven, but they are text-based, built around grand strategy, and serve a small, ageing audience.
3. **Commercial PC wargames with simultaneous turns.** These include Combat Mission, Dominions and Frozen Synapse. They need software installed, players usually swap turn files themselves or rely on community servers, and the pace is generally faster than correspondence play.

No new game in this space appeared in 2025–2026. A modern browser interface for slow-paced, tactical, simultaneous-turn battles appears to be unserved.

## What Battle Lines offers

| Feature | Battle Lines |
|---|---|
| Platform | Web browser, nothing to install |
| Access | A private link in each turn email; no account needed |
| Turn structure | Simultaneous orders with a deadline; the turn ends early once everyone has submitted |
| Pace | Correspondence: turns of days to a week, chosen by the host |
| Hidden information | Fog of war worked out on the server; each player sees only what their units can see |
| Scale | Tactical battles on a hex map |
| Variety and revenue | Unit datasheets on one set of rules for any era, with new unit cards sold to players |

## Comparable games

### 1. Online Diplomacy (webDiplomacy, Backstabbr)

- **Similar:** Everyone orders at the same time, there is a deadline per phase, notifications arrive when a turn is resolved, and games last days or weeks. Of everything we found, this is the closest match to the Battle Lines game flow.
- **Different:** It's a negotiation game with no tactics, dice, hidden units or unit variety.
- **How big:** The webDiplomacy homepage showed about 254,000 registered users, about 33,900 people playing, and about 2,900 active games (undated snapshot). Semrush estimates Backstabbr at roughly 360,000–530,000 site visits a month in late 2025; that is traffic, not a player count.
- **Takeaway:** A large audience already enjoys this way of playing. These players are a natural first audience for Battle Lines.

### 2. Hyborian War (Reality Simulations)

- **Similar:** A commercial game, moderated by computer since 1985 and played by postal mail and email, with simultaneous orders.
- **Different:** Grand strategy, with results delivered as written reports and no interactive map.
- **Status:** Its brochure was updated in 2024. We found nothing confirming it is still running in 2026.
- **Takeaway:** People have paid for slow, correspondence-paced strategy games for decades.

### 3. Other computer-moderated play-by-email games (War of the Dark God, Alamaze, Galac-Tac)

- **War of the Dark God:** a fantasy wargame on a hex map that lasts a fixed 24 turns. It runs on pbem.dk using a game engine called COSMOS.
- **Alamaze:** a play-by-email game with a fixed end, on a 26×26 grid.
- **Galac-Tac:** a science-fiction game moderated by computer. Since 2010, players read their turn reports and enter orders on a website.
- **Takeaway:** These are the closest structural competitors: computer referee, fixed length, sometimes a hex map. They are text-first, focused on grand strategy, and look dated. A small but dedicated community of play-by-mail players exists that Battle Lines could appeal to.

### 4. Laser Squad Nemesis (Codo Technologies, 2003)

- **Similar:** A tactical game with simultaneous turns over email and fog of war. Players submitted orders through a web page or by email, could preview the likely effect of their orders, and the server emailed back each turn's results automatically.
- **Status:** Apparently dead. There were no patches after June 2006, and its official site ran only until 2010.
- **Takeaway:** The closest design ancestor to Battle Lines. It shows the idea works, and its order preview is worth copying. Why it ended is unknown; finding out would be useful.

### 5. Combat Mission series (Battlefront, now owned by Slitherine)

- **Similar:** Simultaneous turns, play by email, hidden units, and a turn replay players love.
- **Different:** Expensive desktop software at the level of individual squads.
- **Status:** Slitherine now owns Battlefront's games and runs a play-by-email server for Combat Mission Cold War. A 25th-anniversary tournament ran in December 2025.
- **Takeaway:** Its turn replay is a model for Battle Lines' own replay feature ([#12](https://github.com/darozak/BattleLines/issues/12)).

### 6. Dominions 6 (Illwinter)

- **Similar:** Simultaneous turns, fog of war, and long multiplayer games resolved by a server at each deadline.
- **Different:** Fantasy strategy at the empire level, as installed desktop software.
- **Status:** Most multiplayer games are played asynchronously on Illwinter's own servers. Turn alerts come from community services (Dominions Envoy and Mr. Clockwork) that post to Discord. One player complained in 2024 that the game itself gives no notification.
- **Takeaway:** This community has moved its turn notifications to Discord. Battle Lines should offer more than email.

### 7. Fast-paced simultaneous-turn tactics games (Frozen Synapse, Phantom Brigade and others)

- **Similar:** Players plan, then all moves are carried out at once. Frozen Synapse can be played with asynchronous turns.
- **Different:** Installed software, small squads, quick turns.
- **Takeaway:** Planning first and then watching the result is popular. Frozen Synapse's ability to preview your plan against guessed enemy moves is a feature worth borrowing.

### Not direct competitors

- **Turn-by-turn wargames with play-by-email** (Steel Panthers, Slitherine's PBEM++ titles, Advance Wars By Web): players take turns one at a time, and most need software installed.
- **VASSAL and similar tools:** board wargames played over email by swapping log files, with no automatic referee.
- **Hidden movement in email board wargames** (e.g. Close Action) relies on a human referee or encryption tricks. In 2020, PAXsims found no tools for playing it automatically online.

## Opportunities

1. **A modern tactical game in an empty niche.** The existing correspondence wargames are text-based and focused on grand strategy. Battle Lines can be the visual, browser-based, tactical option.
2. **Nothing to install, no account to create.** Every comparable game asks players either to install software or to register on a site. A link in an email is the easiest start of any game we looked at.
3. **Revenue from unit cards** on one set of rules for every era. This is proven for tabletop play (One Page Rules, Warhammer) but we found no example in correspondence games.
4. **Audiences to approach first:** online Diplomacy players, the existing play-by-mail community, and owners of tabletop wargames.

## Risks

- **A small niche.** The old play-by-mail market is small and shrinking. Battle Lines will need to bring in Diplomacy-style casual players and tabletop wargamers, not only correspondence veterans.
- **Slow pace means players drop out.** Weekly turns may be too slow for some. Diplomacy sites and Dominions hosting let the host choose the pace. Battle Lines already offers several turn lengths and ends a turn early once everyone has submitted; handling players who drop out ([#11](https://github.com/darozak/BattleLines/issues/11)) will matter.
- **Precedent of failure.** Laser Squad Nemesis, the closest earlier game, did not survive. Its history is worth looking into.
- **Relying on email alone.** Email can land in spam or be missed. Communities have moved to Discord for turn alerts.

## Recommendations

1. Add **notifications beyond email**, such as Discord or browser notifications (new issue to file).
2. Add an **order preview** to the orders screen, in the style of Laser Squad Nemesis and Frozen Synapse. The shared rules engine makes this practical.
3. Give priority to the **turn replay** ([#12](https://github.com/darozak/BattleLines/issues/12)). It is the best-loved feature of the closest comparable games.
4. Default to **shorter turns** (2–3 days) for casual groups, and keep weekly turns as an option.
5. Test early with **online Diplomacy players** and **play-by-mail communities** (e.g. playbymail.net, pbem.dk).
6. Look into **why Laser Squad Nemesis ended** and what its players said about it.

## Sources

- [webDiplomacy](https://webdiplomacy.net)
- [Semrush: backstabbr.com overview](https://www.semrush.com/website/backstabbr.com/overview)
- [Backstabbr: About](https://www.backstabbr.com/about)
- [Hyborian War (Wikipedia)](https://Wikipedia.com/wiki/Hyborian_War)
- [Hyborian War PBM brochure](https://playbymail.net/PBM-Brochures/Hyperborea-Hyborian-War-PBM-Brochure.pdf)
- [PBM Unearthed Issue 28](https://playbymail.net/PBMUnearthed/PBM-Unearthed-Issue-28.pdf)
- [War of the Dark God (Wikipedia)](https://en.wikipedia.org/wiki/War_of_the_Dark_God)
- [Alamaze (Wikipedia)](https://en.wikipedia.org/wiki/Alamaze)
- [Galac-Tac (Wikipedia)](https://en.wikipedia.org/wiki/Galac-Tac)
- [Laser Squad Nemesis (Wikipedia)](https://en.wikipedia.org/wiki/Laser_Squad_Nemesis)
- [Laser Squad by email (2003)](https://gyford.com/phil/writing/2003/01/18/laser-squad-by-e)
- [Slitherine service status](https://status.slitherine.com)
- [Battlefront acquisition FAQ (Slitherine)](https://www.slitherine.com/battlefront-acquisition-faq)
- [Combat Mission Final Blitzkrieg 25th Anniversary Tournament](https://www.matrixgames.com/news/combat-mission-final-blitzkrieg-25th-anniversary-tournament)
- [Dominions 6 multiplayer guide (illwiki)](https://illwiki.com/dom5/dom6/join-multiplayer-game-guide)
- [Dominions 6 Steam discussion on notifications](https://steamcommunity.com/app/2511500/discussions/0/5715697730995731280)
- [Frozen Synapse (Wikipedia)](https://en.wikipedia.org/wiki/Frozen_Synapse)
- [itch.io: simultaneous turn-based games](https://itch.io/games/tag-simultaneous/tag-turn-based)
- [Grognard.com: PBEM](https://grognard.com/Pbem.aspx)
- [PAXsims: Wargaming from home (2020)](https://paxsims.wordpress.com/2020/06/03/wargaming-from-home/)
