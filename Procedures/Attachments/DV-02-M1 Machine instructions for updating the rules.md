# DV-02-M1: Machine instructions for updating the rules

1. <a id="1"></a>Always review and follow the most recent version of these instructions.

2. <a id="2"></a>Scope

   1. <a id="2.1"></a>Apply these instructions to every change that alters how the game plays: the rules engine, the eras, armies and datasheets, the map sizes and point limits, the terrain table, or anything else `rules.md` describes. Apply them also when asked to review `rules.md` against the game.

3. <a id="3"></a>Updating the rules

   1. <a id="3.1"></a>Read the sections of `rules.md` that cover the area being changed before changing the code, and confirm the change has the project lead's approval, per [DV-02](../SOPs/DV-02%20Maintaining%20the%20rules.md) §2.1.

   2. <a id="3.2"></a>Change the prose of `rules.md` to describe the game after the change, in players' terms, per [DV-02](../SOPs/DV-02%20Maintaining%20the%20rules.md) §4.2. Keep the order of the sections, which follows the order of a turn.

   3. <a id="3.3"></a>For every constant the change alters, search `rules.md` for the old value and the words around it, and update each place it appears.

   4. <a id="3.4"></a>If the change adds a rule, add it to the section for the step of the turn it belongs to; if it removes one, remove it everywhere it is mentioned, including section 3, "The turn".

   5. <a id="3.5"></a>Run `npm run rules` to rewrite the generated sections. Do not edit between the `<!-- generated -->` markers by hand.

   6. <a id="3.6"></a>Run `npm test` and confirm the rules tests pass.

   7. <a id="3.7"></a>Build the site (`npx tsc -p .` and `node scripts/build-site.mjs`) and open `rules.html` in a browser at desktop and phone width: check the changed sections read correctly and the page doesn't scroll sideways.

   8. <a id="3.8"></a>Compare each changed rule with the code once more: the tally labels and numbers the page shows during a game must match the rules. If they disagree and it is not clear which is right, list the disagreement in the report for the project lead.

   9. <a id="3.9"></a>Make sure `design.md` still points to `rules.md` for the rules of play, and doesn't contradict them.

   10. <a id="3.10"></a>In the report to the project lead, list the rules that changed, in players' terms, with the new numbers.

4. <a id="4"></a>Provide a concise summary of activities performed and issues encountered when performing these instructions, including the sections of `rules.md` changed and any disagreement found between the rules and the code.
