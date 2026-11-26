# Working on Battle Lines

These rules apply to every Claude session on this repository. They are the short version of the standard operating procedures in [`Procedures/`](Procedures/README.md): before a task, read the SOP that covers it and follow its machine instructions. If this file and an SOP disagree, post an issue for the project lead rather than guess.

## Every change has an issue

- Before starting a change, find or open a GitHub issue for it. One issue per change: a feature, a rule change, a bug, a doc rewrite, an SOP change (AD-01).
- The issue says what is changing and why, in the requester's words where possible.
- Commit messages name the issue, for example `Units can turn without moving (#21)`. After the merge, close each issue the change resolves with a comment naming the merge commit.
- A bug found while working gets its own issue, even when it is fixed in the same change.
- Every issue or comment Claude posts marks who said what and ends with "Posted by Claude from session LINK." and the Claude Code footer (AD-01 §5.6).

## Branches and merging

- Work on the branch named for the session. Run the checks, report the change, and wait for the project lead to say "merge" (AD-02).
- To merge, bring the session branch up to date with `main` (re-running the checks if `main` moved), fast-forward `main` to it and push. No pull request. Never force-push `main`.
- Contributors from outside the project open pull requests, which the project lead squash-merges when CI is green.
- A merge to `main` publishes itself to the live site, https://darozak.github.io/BattleLines/. Follow the publish and report it, per AD-03 (`Procedures/SOPs/AD-03 Publishing the live site.md`).

## Docs to keep current

When a change affects players or how the project works, update in the same change (DV-01-A1):

- `README.md` (what the game is, how a game works, setup, code layout)
- `design.md` (how the game is built, the link format, turn resolution, versioning)
- `rules.md` (the rules of play, once written)
- `CLAUDE.md` and `CONTRIBUTING.md` (how the project is run)
- the SOPs in `Procedures/` (QA-01)

## Tests

- `npm test` compiles the TypeScript and runs every test. `npm run build` builds the site in `dist/site`.
- For a change to the web page or to how the game plays, also run `npm run dev` and play a turn for each player in a browser, at desktop and phone width (DV-01 §5.3).

## The game's design

- Battle Lines is a static site. The whole game travels in the link; every player sees the whole battlefield. No server, no accounts, no hidden information.
- The rules engine (`src/shared/engine.ts`) is pure and deterministic. There are no dice: combat is a tally of modifiers, so the same orders always give the same result, and the page shows players exactly what their orders will do before they end the turn.
- A change that alters how a turn plays out, or how a link is written, changes games in progress: say so, increase `LINK_VERSION` and ask the project lead about keeping the old version available (DV-01 §4.4).
- The movement, combat and scoring rules are placeholders until `rules.md` is written.
