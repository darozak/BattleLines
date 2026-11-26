# DV-01: Making and testing game changes

1. # <a id="1"></a>Purpose

   1. <a id="1.1"></a>This standard operating procedure (SOP) sets out how developers and Claude change the game (the rules engine, the scenarios and datasheets, the link format and the web page), how they test the change, and how they keep the docs in step with it.

2. # <a id="2"></a>Roles and responsibilities

   1. <a id="2.1"></a>The project lead sets the direction of the game and approves rule changes, new features and changes to the link format.

   2. <a id="2.2"></a>Developers and Claude make changes per this SOP, using the "Machine instructions for making a game change" ([DV-01-M1](../Attachments/DV-01-M1%20Machine%20instructions%20for%20making%20a%20game%20change.md)).

   3. <a id="2.3"></a>Whoever makes a change is responsible for updating every doc it affects, using the "Docs to keep current" checklist ([DV-01-A1](../Attachments/DV-01-A1%20Docs%20to%20keep%20current.md)).

3. # <a id="3"></a>Required resources

   1. <a id="3.1"></a>The developer setup in the repository's `README.md`: Node.js 22 or later and npm.

   2. <a id="3.2"></a>The design document (`design.md`), which records how the game is built and why, and the rules (`rules.md`).

   3. <a id="3.3"></a>A browser, to play the changed game: `npm run dev` serves it at http://localhost:8080.

4. # <a id="4"></a>General guidelines

   1. <a id="4.1"></a>This SOP will be formatted and maintained IAW [QA-01](QA-01%20Writing%20and%20maintaining%20Battle%20Lines%20standard%20operating%20procedures.md).

   2. <a id="4.2"></a>The game is a static site. The whole game travels in a link, and every player sees the whole battlefield. Keep it that way: no server, no accounts, no hidden information, unless the project lead decides otherwise.

   3. <a id="4.3"></a>The rules engine (`src/shared/engine.ts`) is pure and deterministic: the same position and the same orders always give the same result, because every dice roll comes from the seed in the link. Never use `Math.random`, the clock or anything else outside the game state in the engine.

   4. <a id="4.4"></a>A change that alters how a turn plays out (the rules, a scenario, a datasheet, the map generator or the dice) or how a link is written changes the games already in progress, because their links are replayed by the new code. For such a change:

      1. <a id="4.4.1"></a>say so in the issue and the pull request;

      2. <a id="4.4.2"></a>increase `LINK_VERSION` in `src/shared/link.ts`, so old links say they are from a different version instead of playing out differently;

      3. <a id="4.4.3"></a>ask the project lead whether the previous version should stay available for games in progress, per `design.md`, "Versioning".

   5. <a id="4.5"></a>Keep links short. When a change adds to what a link carries, check the sizes the link tests print and say in the pull request how they changed.

   6. <a id="4.6"></a>The movement, combat and scoring rules in the code are placeholders until `rules.md` is written. A rule change follows `rules.md`; if the two disagree, ask the project lead.

5. # <a id="5"></a>Procedures

   1. <a id="5.1"></a>Track the change with an issue, per [AD-01](AD-01%20Creating%20and%20resolving%20GitHub%20issues.md), and work on a branch, per [AD-02](AD-02%20Working%20with%20branches%20and%20pull%20requests.md).

   2. <a id="5.2"></a>Make the change, with tests that show it working and, for a bug, a test that failed before the fix. Engine tests go in `test/engine.test.ts`; link and game-flow tests in `test/link.test.ts`.

   3. <a id="5.3"></a>Run the checks:

      1. <a id="5.3.1"></a>`npm test`: compiles the TypeScript and runs every test.

      2. <a id="5.3.2"></a>`npm run build`: builds the site in `dist/site`.

      3. <a id="5.3.3"></a>For a change to the web page or to how the game plays: `npm run dev`, then create a game, play at least one turn for each player by opening each new link, and check the page at phone width as well as desktop width.

   4. <a id="5.4"></a>Update every doc the change affects, using [DV-01-A1](../Attachments/DV-01-A1%20Docs%20to%20keep%20current.md), in the same pull request.

   5. <a id="5.5"></a>Open the pull request and see it through to merge, per [AD-02](AD-02%20Working%20with%20branches%20and%20pull%20requests.md).

6. # <a id="6"></a>References

   1. <a id="6.1"></a>[AD-01](AD-01%20Creating%20and%20resolving%20GitHub%20issues.md): Creating and resolving GitHub issues

   2. <a id="6.2"></a>[AD-02](AD-02%20Working%20with%20branches%20and%20pull%20requests.md): Working with branches and pull requests

   3. <a id="6.3"></a>[QA-01](QA-01%20Writing%20and%20maintaining%20Battle%20Lines%20standard%20operating%20procedures.md): Writing and maintaining Battle Lines standard operating procedures

7. # <a id="7"></a>Attachments

   1. <a id="7.1"></a>[DV-01-A1](../Attachments/DV-01-A1%20Docs%20to%20keep%20current.md): Docs to keep current

   2. <a id="7.2"></a>[DV-01-M1](../Attachments/DV-01-M1%20Machine%20instructions%20for%20making%20a%20game%20change.md): Machine instructions for making a game change
