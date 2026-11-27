# Contributing to Battle Lines

Thank you for helping. Battle Lines is a free, open-source correspondence hex wargame that runs in the browser: the whole game travels in a link that players pass to each other. Contributions of every size are welcome: a typo fix, a bug report, a rule idea, a new era or army.

## Ways to help

- **Play and report.** Start a game at https://darozak.github.io/BattleLines/, play a few turns with a friend, and [open an issue](../../issues/new/choose) when something is wrong or confusing. Confusion is a bug too.
- **Write.** The design (`design.md`) and the rules (`rules.md`, published as the [Rules page](https://darozak.github.io/BattleLines/rules.html)) are Markdown files in this repository.
- **Code.** The game is TypeScript with no framework. The [README](README.md) explains how to run it locally.

## How changes are made

These are the same rules every maintainer and every AI session follows; [CLAUDE.md](CLAUDE.md) and the [procedures](Procedures/README.md) have the details.

1. **Every change has an issue.** Find or open one first, saying what changes and why. One issue per change.
2. **Branch from `main`, and open the pull request into `main`.** Name the issue in the description: `Closes #N`.
3. **Keep the docs current.** If players would notice the change, update the README, `design.md` or `rules.md` in the same pull request.
4. **Run the tests:** `npm test`. CI runs them too, on every pull request.
5. **Say if the change alters games in progress.** Games live in players' links and are replayed by the current code, so a rule change can change a game halfway through.
6. **The project lead squash-merges** once CI is green and they agree to the change. Every merge is published to the live site straight away.

Small pull requests get reviewed fastest. If you're unsure whether a change is wanted, ask on the issue before writing it.

## Licence

Battle Lines is [MIT licensed](LICENSE). By contributing, you agree that your contribution is licensed the same way.
