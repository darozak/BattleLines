# AD-02: Working with branches and pull requests

1. # <a id="1"></a>Purpose

   1. <a id="1.1"></a>This standard operating procedure (SOP) sets out how changes reach the game. Claude works on its session branch and merges it straight into `main` when the project lead says so; contributors from outside the project open pull requests, which the project lead squash-merges. The live site at [https://darozak.github.io/BattleLines/](https://darozak.github.io/BattleLines/) is published from `main`, so every merge is a release and this is also the release procedure.

2. # <a id="2"></a>Roles and responsibilities

   1. <a id="2.1"></a>The project lead decides when a change is merged: by telling Claude to merge, or by merging a contributor's pull request.

   2. <a id="2.2"></a>Claude works only on the branch it was given for the session, runs the checks before every merge, and merges into `main` only when the project lead says to. Claude never merges on its own judgment.

   3. <a id="2.3"></a>Contributors from outside the project open pull requests and keep them green, per `CONTRIBUTING.md`.

3. # <a id="3"></a>Required resources

   1. <a id="3.1"></a>Write access to the [darozak/BattleLines](https://github.com/darozak/BattleLines) repository, or a fork of it for contributors without write access.

   2. <a id="3.2"></a>The CI workflows in `.github/workflows/`: `tests.yml`, which builds and tests every pull request and must pass, and `pages.yml`, which tests, builds and publishes every push to `main`.

4. # <a id="4"></a>General guidelines

   1. <a id="4.1"></a>This SOP will be formatted and maintained IAW [QA-01](QA-01%20Writing%20and%20maintaining%20Battle%20Lines%20standard%20operating%20procedures.md).

   2. <a id="4.2"></a>`main` is the default branch and the branch the live site is published from.

   3. <a id="4.3"></a>Every merge is published to players straight away, per [AD-03](AD-03%20Publishing%20the%20live%20site.md). Keep each change small enough that, if it breaks something, it is quick to see why and quick to fix or revert.

   4. <a id="4.4"></a>Never rewrite the history of `main`: no force-pushes, no rebasing commits that are already on it.

5. # <a id="5"></a>Procedures

   1. <a id="5.1"></a>Claude's changes:

      1. <a id="5.1.1"></a>Start from an up-to-date `main`, on the branch named for the session.

      2. <a id="5.1.2"></a>Commit in small steps with messages that say what changed and name the issue, for example `Units can turn without moving (#21)`.

      3. <a id="5.1.3"></a>Run the checks the governing SOP requires, such as [DV-01](DV-01%20Making%20and%20testing%20game%20changes.md) §5.3, and push the branch.

      4. <a id="5.1.4"></a>Report to the project lead what changed, the checks run and their results, the docs updated per [DV-01](DV-01%20Making%20and%20testing%20game%20changes.md), and whether the change alters how games in progress play out. Then wait for the project lead to say "merge".

      5. <a id="5.1.5"></a>To merge, fetch `main`. If `main` has new commits, merge `main` into the session branch and run the checks again. Then fast-forward `main` to the session branch (`git merge --ff-only`) and push `main`. Never skip, disable or delete a test to make a merge pass.

      6. <a id="5.1.6"></a>Close every issue the change resolves with a comment that says what was done and names the merge commit, attributed per [AD-01](AD-01%20Creating%20and%20resolving%20GitHub%20issues.md) §5.6.

   2. <a id="5.2"></a>Contributors' changes:

      1. <a id="5.2.1"></a>Branch from `main` (on a fork if needed) and open a pull request into `main`. Its description says what changed and why, lists `Closes #N` for every issue it resolves, lists the checks run and the docs updated, per [DV-01](DV-01%20Making%20and%20testing%20game%20changes.md), and says whether the change alters how games in progress play out.

      2. <a id="5.2.2"></a>Wait for CI. If it fails, fix it on the same branch and push again.

      3. <a id="5.2.3"></a>Answer every review comment, with a fix or with a reason, on the pull request.

      4. <a id="5.2.4"></a>The project lead merges with **Squash and merge** when CI is green, the branch is up to date with `main`, and they agree to the change.

   3. <a id="5.3"></a>After any merge, follow the publish to the live site, per [AD-03](AD-03%20Publishing%20the%20live%20site.md). If a merge breaks the live game, open an issue at once, then fix forward or revert, per [AD-03](AD-03%20Publishing%20the%20live%20site.md) §5.4.

6. # <a id="6"></a>References

   1. <a id="6.1"></a>[AD-01](AD-01%20Creating%20and%20resolving%20GitHub%20issues.md): Creating and resolving GitHub issues

   2. <a id="6.2"></a>[AD-03](AD-03%20Publishing%20the%20live%20site.md): Publishing the live site

   3. <a id="6.3"></a>[DV-01](DV-01%20Making%20and%20testing%20game%20changes.md): Making and testing game changes

   4. <a id="6.4"></a>[QA-01](QA-01%20Writing%20and%20maintaining%20Battle%20Lines%20standard%20operating%20procedures.md): Writing and maintaining Battle Lines standard operating procedures

7. # <a id="7"></a>Attachments

   1. <a id="7.1"></a>None.
