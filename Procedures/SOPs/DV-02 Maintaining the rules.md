# DV-02: Maintaining the rules

1. # <a id="1"></a>Purpose

   1. <a id="1.1"></a>This standard operating procedure (SOP) sets out how the rulebook, `rules.md`, is kept in step with the game, so that the rules players read on the live site always describe the game the site plays.

   2. <a id="1.2"></a>`rules.md` is published as the Rules page of the live site, https://darozak.github.io/BattleLines/rules.html, every time `main` is published.

2. # <a id="2"></a>Roles and responsibilities

   1. <a id="2.1"></a>The project lead decides the rules: every new or changed rule, and every change to the numbers in it, needs their approval.

   2. <a id="2.2"></a>Developers and Claude update `rules.md` in the same change as any game mechanic it describes, using the "Machine instructions for updating the rules" ([DV-02-M1](../Attachments/DV-02-M1%20Machine%20instructions%20for%20updating%20the%20rules.md)).

   3. <a id="2.3"></a>Claude checks the Rules page on the live site after each publish that changes it, per [AD-03](AD-03%20Publishing%20the%20live%20site.md).

3. # <a id="3"></a>Required resources

   1. <a id="3.1"></a>The developer setup in the repository's `README.md`: Node.js 22 or later and npm.

   2. <a id="3.2"></a>`rules.md`, the rulebook; `src/rules/tables.ts`, which generates its tables; `test/rules.test.ts`, which checks they are up to date; and `scripts/markdown.mjs` and `scripts/build-site.mjs`, which turn `rules.md` into the Rules page.

4. # <a id="4"></a>General guidelines

   1. <a id="4.1"></a>This SOP will be formatted and maintained IAW [QA-01](QA-01%20Writing%20and%20maintaining%20Battle%20Lines%20standard%20operating%20procedures.md).

   2. <a id="4.2"></a>`rules.md` is written for players. Say what a player can do and what happens, in plain language and in the order a turn is played. Leave out how the code does it; that belongs in `design.md`.

   3. <a id="4.3"></a>The rules engine (`src/shared/engine.ts`) and `rules.md` must say the same thing. If they disagree, the code is what players get: fix whichever is wrong, and if it is not clear which, ask the project lead rather than guess.

   4. <a id="4.4"></a>Some parts of `rules.md` are generated from the game's data, between `<!-- generated:NAME -->` and `<!-- /generated -->` markers: the rules version, the map sizes and point limits, the terrain table and every era's unit tables. Never edit between the markers by hand: run `npm run rules`, which rewrites them.

   5. <a id="4.5"></a>The rules version is the game's `LINK_VERSION`. A change that alters how a turn plays out increases `LINK_VERSION`, per [DV-01](DV-01%20Making%20and%20testing%20game%20changes.md) §4.4; `npm test` then fails until `npm run rules` has updated the version in `rules.md`. This is the reminder to review the prose as well: the test only checks the generated parts.

   6. <a id="4.6"></a>Numbers in the prose (for example "+2 to ford a river" or "defence = 2 + cover") come from constants in the code. When a constant changes, search `rules.md` for the old value and update each place it is used.

   7. <a id="4.7"></a>Keep `rules.md` to the Markdown that `scripts/markdown.mjs` understands: headings, paragraphs, numbered and bulleted lists (nested by indenting under the item's text), tables, bold, italics, inline code and links.

5. # <a id="5"></a>Procedures

   1. <a id="5.1"></a>Track the change with an issue, per [AD-01](AD-01%20Creating%20and%20resolving%20GitHub%20issues.md). A rule change and the code that implements it are one change, with one issue.

   2. <a id="5.2"></a>Make the game change per [DV-01](DV-01%20Making%20and%20testing%20game%20changes.md), and update `rules.md` in the same change, using [DV-02-M1](../Attachments/DV-02-M1%20Machine%20instructions%20for%20updating%20the%20rules.md).

   3. <a id="5.3"></a>Run `npm run rules`, then `npm test`. The rules tests must pass.

   4. <a id="5.4"></a>Build the site and read the changed sections of the Rules page in a browser, at desktop and phone width.

   5. <a id="5.5"></a>Report the rule change to the project lead with the issue, in the players' terms: what a player can now do, or what now happens, and the new numbers.

   6. <a id="5.6"></a>After the merge, follow the publish per [AD-03](AD-03%20Publishing%20the%20live%20site.md) and check that the live Rules page shows the change.

6. # <a id="6"></a>References

   1. <a id="6.1"></a>[AD-01](AD-01%20Creating%20and%20resolving%20GitHub%20issues.md): Creating and resolving GitHub issues

   2. <a id="6.2"></a>[AD-03](AD-03%20Publishing%20the%20live%20site.md): Publishing the live site

   3. <a id="6.3"></a>[DV-01](DV-01%20Making%20and%20testing%20game%20changes.md): Making and testing game changes

   4. <a id="6.4"></a>[QA-01](QA-01%20Writing%20and%20maintaining%20Battle%20Lines%20standard%20operating%20procedures.md): Writing and maintaining Battle Lines standard operating procedures

7. # <a id="7"></a>Attachments

   1. <a id="7.1"></a>[DV-02-M1](../Attachments/DV-02-M1%20Machine%20instructions%20for%20updating%20the%20rules.md): Machine instructions for updating the rules
