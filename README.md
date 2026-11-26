# Battle Lines

## Objectives
- Create a flexible, easy-to-use, correspondence-based wargame played through email and a website.
- Design unit datasheets that describe special combat units and add a immense variety to the game.
- Generate income by selling access to new and updated unit cards.

## Key Concepts
- The website acts as referee; email is the turn clock.
- Played on a hexagonal map with simultaneous orders.
- Players take turns placing their orders.
- Unit datasheets describe abilities and range of actions.
- The same rules can be applied to different periods and environments.
- Combat results are obtained by combining modifiers.
- Risk tables are used to generate random, curve-adjusted modifiers.
- Terrain tables describe how differnt terrains affect movement and combat.
- Players can send short in-game messages to their allies.

## Gameplay
- A host visits the Battle Lines website and enters the email addresses of the people to invite.
- Battle Lines emails each invitee an invitation they can accept with one click.
- A game is set up for everyone who accepts. Players are assigned armies on a hexagonal map.
- Each turn lasts one week:
    - Each player receives an email with the turn deadline and a private link.
    - The link shows the player their own troops, what those troops can see, and what happened last turn.
    - Players choose orders for their units and submit them before the deadline.
    - At the deadline, the website resolves everyone's moves at the same time and emails out new links.
- See [design.md](design.md) for the detailed system design.

## Sources of Inspiration
- [Warhammer](https://www.warhammer-community.com/wp-content/uploads/2020/07/Lw4o3USx1R8sU7cQ.pdf)
- [One Page Rules](https://onepagerules.com/)

## Prototype

A working prototype of the website and email system lives in this repo. The
movement, spotting and combat rules in it are **placeholders**: they exist to
exercise the game flow, and will be replaced by `rules.md` once it is written.

### Running it

Requires Node.js 22.5 or newer. No database server is needed (it uses SQLite).

```bash
npm install
npm run dev     # http://localhost:3000, with dev tools at /dev
npm test
```

With `npm run dev`, emails are not sent. They are saved to an outbox at
**http://localhost:3000/dev**, where you can read each email and click its links.
That page also lists every player's link and has a **Resolve now** button, so you
can play all sides of a game from one browser without waiting a week.

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `BASE_URL` | `http://localhost:PORT` | Public URL used in email links |
| `SMTP_URL` | unset | e.g. `smtps://user:pass@smtp.example.com`. If unset, emails stay in the outbox |
| `MAIL_FROM` | `Battle Lines <no-reply@battlelines.local>` | Sender address |
| `DATABASE_FILE` | `data/battlelines.db` | SQLite file |
| `DEV_TOOLS` | unset | `1` enables `/dev` (never enable in production) |
| `TICK_MS` | `30000` | How often deadlines are checked |

### Code layout

- `src/engine/`: the rules engine (pure functions, no I/O). `engine.js` resolves a turn,
  `scenario.js` holds the placeholder map, units and datasheets, `hex.js` the hex maths.
- `src/games.js`: invitations, turn lifecycle, deadlines, reminders and emails.
- `src/emails.js`: email templates. `src/mailer.js`: SMTP / outbox delivery.
- `src/app.js`, `src/views.js`: web routes and pages. `public/game.js`: the interactive map.
- `test/`: engine tests and a full end-to-end game played over HTTP.
