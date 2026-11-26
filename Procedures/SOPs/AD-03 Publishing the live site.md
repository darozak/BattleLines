# AD-03: Publishing the live site

1. # <a id="1"></a>Purpose

   1. <a id="1.1"></a>This standard operating procedure (SOP) sets out how a change on `main` reaches the live game at [https://darozak.github.io/BattleLines/](https://darozak.github.io/BattleLines/): automatically, through the **Deploy to GitHub Pages** workflow. It also covers setting publishing up, publishing by hand, what to do when a publish fails, and how to pause publishing.

2. # <a id="2"></a>Roles and responsibilities

   1. <a id="2.1"></a>The project lead owns the repository and its GitHub Pages settings and decides when to merge. Because merging publishes, saying "merge" is saying "release".

   2. <a id="2.2"></a>Claude publishes only by merging when the project lead says to, per [AD-02](AD-02%20Working%20with%20branches%20and%20pull%20requests.md), or by running the workflow when directed. After either, it follows the publish and reports the result, using the "Machine instructions for following a publish" ([AD-03-M1](../Attachments/AD-03-M1%20Machine%20instructions%20for%20following%20a%20publish.md)).

   3. <a id="2.3"></a>Developers publish the same way, by getting a pull request merged.

3. # <a id="3"></a>Required resources

   1. <a id="3.1"></a>`.github/workflows/pages.yml`, the **Deploy to GitHub Pages** workflow. It runs on every push to `main`, or when started by hand from the **Actions** tab. Its `build` job runs `npm ci`, `npm test` and `npm run build`; its `deploy` job publishes `dist/site` to GitHub Pages.

   2. <a id="3.2"></a>The repository's Pages settings (**Settings → Pages**, Source: **GitHub Actions**) and the `github-pages` environment, which records each publish.

   3. <a id="3.3"></a>To check the live site from a Claude session, a cloud environment whose network allows `darozak.github.io` (the "BattleLines" environment does).

4. # <a id="4"></a>General guidelines

   1. <a id="4.1"></a>This SOP will be formatted and maintained IAW [QA-01](QA-01%20Writing%20and%20maintaining%20Battle%20Lines%20standard%20operating%20procedures.md).

   2. <a id="4.2"></a>Every merge to `main` is a release. Merge when the change is ready for players to meet, and keep pull requests small, per [AD-02](AD-02%20Working%20with%20branches%20and%20pull%20requests.md).

   3. <a id="4.3"></a>The site is static: everything in it is public, and it holds no secrets. Never put a key, password or private data in the repository or the site.

   4. <a id="4.4"></a>Games in progress live in players' links, not on the site. Every publish changes the code that reads and replays those links, so a change that alters how a turn plays out changes games in progress. Such changes follow [DV-01](DV-01%20Making%20and%20testing%20game%20changes.md) §4.4.

   5. <a id="4.5"></a>Fix forward when you can: a small pull request that fixes the problem publishes itself once merged. Revert only when the live game can't wait for a fix.

5. # <a id="5"></a>Procedures

   1. <a id="5.1"></a>Setting up publishing (once, by the project lead):

      1. <a id="5.1.1"></a>Make the repository public (GitHub Pages on a free account needs a public repository).

      2. <a id="5.1.2"></a>In **Settings → Pages**, set **Source** to **GitHub Actions**.

      3. <a id="5.1.3"></a>Run the workflow (**Actions → Deploy to GitHub Pages → Run workflow**) and check that the site opens at [https://darozak.github.io/BattleLines/](https://darozak.github.io/BattleLines/).

   2. <a id="5.2"></a>Publishing a change:

      1. <a id="5.2.1"></a>Merge the pull request, per [AD-02](AD-02%20Working%20with%20branches%20and%20pull%20requests.md). The workflow starts on its own.

      2. <a id="5.2.2"></a>Watch the run in the **Actions** tab. It takes about a minute. If the tests fail, the `build` job stops and the live site is not changed.

      3. <a id="5.2.3"></a>Open the site, start a game and play a turn, and check what the change was meant to do. Reload the page if it still shows the old version.

   3. <a id="5.3"></a>Publishing by hand, when a publish needs repeating: **Actions → Deploy to GitHub Pages → Run workflow** on `main`.

   4. <a id="5.4"></a>When a publish fails:

      1. <a id="5.4.1"></a>Read the run's log and find the failing step.

      2. <a id="5.4.2"></a>If the `build` job failed, `main` is broken but the live site still runs the previous version. Open an issue with the `bug` label, per [AD-01](AD-01%20Creating%20and%20resolving%20GitHub%20issues.md), quoting the failing lines, and fix forward.

      3. <a id="5.4.3"></a>If only the `deploy` job failed, re-run it once; a second failure is real. Open an issue as above.

      4. <a id="5.4.4"></a>If the live site is broken and can't wait for a fix, revert the merge in a new pull request and merge it, on the project lead's say-so.

   5. <a id="5.5"></a>Pausing publishing, for example during a large change: **Actions → Deploy to GitHub Pages → ⋯ → Disable workflow**, and enable it again afterwards.

6. # <a id="6"></a>References

   1. <a id="6.1"></a>[AD-01](AD-01%20Creating%20and%20resolving%20GitHub%20issues.md): Creating and resolving GitHub issues

   2. <a id="6.2"></a>[AD-02](AD-02%20Working%20with%20branches%20and%20pull%20requests.md): Working with branches and pull requests

   3. <a id="6.3"></a>[DV-01](DV-01%20Making%20and%20testing%20game%20changes.md): Making and testing game changes

   4. <a id="6.4"></a>[QA-01](QA-01%20Writing%20and%20maintaining%20Battle%20Lines%20standard%20operating%20procedures.md): Writing and maintaining Battle Lines standard operating procedures

7. # <a id="7"></a>Attachments

   1. <a id="7.1"></a>[AD-03-M1](../Attachments/AD-03-M1%20Machine%20instructions%20for%20following%20a%20publish.md): Machine instructions for following a publish
