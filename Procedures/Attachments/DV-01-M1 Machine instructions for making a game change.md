# DV-01-M1: Machine instructions for making a game change

1. <a id="1"></a>Always review and follow the most recent version of these instructions.

2. <a id="2"></a>Scope

   1. <a id="2.1"></a>Apply these instructions to any change to the rules engine, the eras, armies and datasheets, the link format, the web page, the tests or the game docs.

3. <a id="3"></a>Making the change

   1. <a id="3.1"></a>Confirm the change is tracked by an issue, per the "Machine instructions for tracking requests with issues" ([AD-01-M3](AD-01-M3%20Machine%20instructions%20for%20tracking%20requests%20with%20issues.md)).

   2. <a id="3.2"></a>Read the parts of `design.md` and `rules.md` that cover the area you are changing, and follow their conventions.

   3. <a id="3.3"></a>Make the smallest change that does the job. Add or update tests that show it works.

   4. <a id="3.4"></a>Decide whether the change alters how games in progress play out or how links are written. If it does, follow [DV-01](../SOPs/DV-01%20Making%20and%20testing%20game%20changes.md) §4.4.

   5. <a id="3.5"></a>Run the checks in [DV-01](../SOPs/DV-01%20Making%20and%20testing%20game%20changes.md) §5.3 that apply. If a check cannot run in your environment, say so rather than claiming it passed.

   6. <a id="3.6"></a>Work through the "Docs to keep current" checklist ([DV-01-A1](DV-01-A1%20Docs%20to%20keep%20current.md)) and update every doc the change affects.

   7. <a id="3.7"></a>Report the change to the project lead per [AD-02](../SOPs/AD-02%20Working%20with%20branches%20and%20pull%20requests.md) §5.1.4, listing the checks run, the docs updated, and any change in link size or to games in progress.

4. <a id="4"></a>Provide a concise summary of activities performed and issues encountered when performing these instructions, including the checks run, their results and the docs updated.
