# AD-02: Working with branches and pull requests

1. # <a id="1"></a>Purpose

   1. <a id="1.1"></a>This standard operating procedure (SOP) sets out how changes reach the game: on a branch, through a pull request into `main`, checked by CI, and squash-merged only when the project lead says so. The live site at [https://darozak.github.io/BattleLines/](https://darozak.github.io/BattleLines/) is published from `main`, so every merge is a release and this is also the release procedure.

2. # <a id="2"></a>Roles and responsibilities

   1. <a id="2.1"></a>The project lead reviews pull requests and is the only person who decides when one is merged.

   2. <a id="2.2"></a>Developers and Claude open pull requests, keep them green, and answer review comments. Contributors from outside the project work the same way, per `CONTRIBUTING.md`.

   3. <a id="2.3"></a>Claude never merges a pull request on its own judgment, and never pushes to a branch other than the one it was given for the session.

3. # <a id="3"></a>Required resources

   1. <a id="3.1"></a>Write access to the [darozak/BattleLines](https://github.com/darozak/BattleLines) repository, or a fork of it for contributors without write access.

   2. <a id="3.2"></a>The CI workflows in `.github/workflows/`: `tests.yml`, which builds and tests every pull request and must pass, and `pages.yml`, which tests, builds and publishes every push to `main`.

4. # <a id="4"></a>General guidelines

   1. <a id="4.1"></a>This SOP will be formatted and maintained IAW [QA-01](QA-01%20Writing%20and%20maintaining%20Battle%20Lines%20standard%20operating%20procedures.md).

   2. <a id="4.2"></a>`main` is the default branch and the branch the live site is published from. Pull requests go into `main`.

   3. <a id="4.3"></a>Every merge is published to players straight away, per [AD-03](AD-03%20Publishing%20the%20live%20site.md). Keep each pull request small enough that, if it breaks something, it is quick to see why and quick to fix or revert.

5. # <a id="5"></a>Procedures

   1. <a id="5.1"></a>Start every change from an up-to-date `main` on its own branch. Claude uses the branch named for its session.

   2. <a id="5.2"></a>Commit in small steps with messages that say what changed and name the issue, for example `Units can turn without moving (#21)`.

   3. <a id="5.3"></a>Open a pull request into `main`. Its description:

      1. <a id="5.3.1"></a>says what changed and why, in plain words;

      2. <a id="5.3.2"></a>lists `Closes #N` for every issue it resolves;

      3. <a id="5.3.3"></a>lists the checks that were run and their results;

      4. <a id="5.3.4"></a>lists the docs updated, per [DV-01](DV-01%20Making%20and%20testing%20game%20changes.md);

      5. <a id="5.3.5"></a>says whether the change alters how games in progress play out, per [DV-01](DV-01%20Making%20and%20testing%20game%20changes.md).

   4. <a id="5.4"></a>Wait for CI. If it fails, reproduce the failure, fix it on the same branch and push again. Never skip, disable or delete a test to make CI pass.

   5. <a id="5.5"></a>Answer every review comment, with a fix or with a reason, on the pull request.

   6. <a id="5.6"></a>Merge only when all three are true: CI is green, the project lead has said to merge, and the branch is up to date with `main`. Merge with **Squash and merge** only, so each change is one commit on `main`.

   7. <a id="5.7"></a>After a merge, check that the issues named in the pull request were closed.

   8. <a id="5.8"></a>After a merge, follow the publish to the live site, per [AD-03](AD-03%20Publishing%20the%20live%20site.md). If a merge breaks the live game, open an issue at once, then fix forward or revert in a new pull request, per [AD-03](AD-03%20Publishing%20the%20live%20site.md) §5.4.

6. # <a id="6"></a>References

   1. <a id="6.1"></a>[AD-03](AD-03%20Publishing%20the%20live%20site.md): Publishing the live site

   2. <a id="6.2"></a>[DV-01](DV-01%20Making%20and%20testing%20game%20changes.md): Making and testing game changes

   3. <a id="6.3"></a>[QA-01](QA-01%20Writing%20and%20maintaining%20Battle%20Lines%20standard%20operating%20procedures.md): Writing and maintaining Battle Lines standard operating procedures

7. # <a id="7"></a>Attachments

   1. <a id="7.1"></a>None.
