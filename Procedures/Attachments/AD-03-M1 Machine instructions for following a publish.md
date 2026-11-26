# AD-03-M1: Machine instructions for following a publish

1. <a id="1"></a>Always review and follow the most recent version of these instructions.

2. <a id="2"></a>Scope

   1. <a id="2.1"></a>Apply these instructions after you merge a pull request into `main` on the project lead's say-so, per [AD-02](../SOPs/AD-02%20Working%20with%20branches%20and%20pull%20requests.md), and whenever you are directed to publish or to check on a publish, per [AD-03](../SOPs/AD-03%20Publishing%20the%20live%20site.md).

3. <a id="3"></a>Following a publish

   1. <a id="3.1"></a>Find the **Deploy to GitHub Pages** run for the merge commit on `main` and wait for it to finish. When directed to publish without a merge, start the workflow on `main` (`workflow_dispatch`) and follow that run.

   2. <a id="3.2"></a>If the `build` job failed, treat it as a broken `main`: the live site still runs the previous version. Read the log, open an issue with the `bug` label per [AD-01](../SOPs/AD-01%20Creating%20and%20resolving%20GitHub%20issues.md) quoting the failing lines, and tell the project lead.

   3. <a id="3.3"></a>If only the `deploy` job failed, re-run it once. If it fails again, open an issue as above and tell the project lead.

   4. <a id="3.4"></a>If the run succeeded, check the live site:

      1. <a id="3.4.1"></a>Fetch the site and a file the change touched, and check that they serve the new version.

      2. <a id="3.4.2"></a>For a change to the web page or to how the game plays, play at least one turn for each player in a browser, as in DV-01 §5.3, against the live site.

      3. <a id="3.4.3"></a>If the session's network can't reach `darozak.github.io`, say so; do not report the site as checked.

   5. <a id="3.5"></a>Tell the project lead the commit is live, with a link to the run and what was checked.

   6. <a id="3.6"></a>If the live site is broken, tell the project lead at once and work on a fix-forward pull request if the cause is clear, per [AD-01-M1](AD-01-M1%20Machine%20instructions%20for%20resolving%20GitHub%20issues.md). Don't merge it until the project lead says to.

4. <a id="4"></a>Provide a concise summary of activities performed and issues encountered when performing these instructions, including the commit published, the run's link and its result.
