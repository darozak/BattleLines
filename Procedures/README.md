# Battle Lines standard operating procedures

These standard operating procedures (SOPs) say how the project lead, contributors and Claude work together to maintain the repository, track issues, change and test the game, and publish it to the live site at [https://darozak.github.io/BattleLines/](https://darozak.github.io/BattleLines/). They are adapted from the [Ex Machinis procedures](https://github.com/Darwin-River/Ex-Machinis/tree/main/Procedures).

- **SOPs** are in [SOPs/](SOPs/). Each says who does what, and in what order.
- **Attachments** are in [Attachments/](Attachments/): machine instructions (M) that Claude follows, templates (T), and appendices (A).
- **Anchors**: every numbered item has a link anchor, so `…/AD-01%20Creating%20and%20resolving%20GitHub%20issues.md#5.6` opens AD-01 at §5.6. Run `python3 Procedures/Tools/update_anchors.py` after renumbering; `--check` only reports.

To have Claude do a task, name the machine instructions, for example: "Apply AD-01-M1 to #4", "Apply AD-01-M4" (an issue sweep), or "Apply QA-01-M2 to these SOP changes."

## Index

| ID | Title | Machine instructions and other attachments |
|---|---|---|
| [QA-01](SOPs/QA-01%20Writing%20and%20maintaining%20Battle%20Lines%20standard%20operating%20procedures.md) | Writing and maintaining Battle Lines standard operating procedures | M1 proofreading SOPs, M2 reviewing SOP changes, T1 SOP template, T2 machine instructions template |
| [AD-01](SOPs/AD-01%20Creating%20and%20resolving%20GitHub%20issues.md) | Creating and resolving GitHub issues | M1 resolving issues, M2 posting issues, M3 tracking requests, M4 issue sweeps |
| [AD-02](SOPs/AD-02%20Working%20with%20branches%20and%20pull%20requests.md) | Working with branches and pull requests | None |
| [AD-03](SOPs/AD-03%20Publishing%20the%20live%20site.md) | Publishing the live site | M1 following a publish |
| [DV-01](SOPs/DV-01%20Making%20and%20testing%20game%20changes.md) | Making and testing game changes | A1 docs to keep current, M1 making a game change |
| [DV-02](SOPs/DV-02%20Maintaining%20the%20rules.md) | Maintaining the rules | M1 updating the rules |

## Categories

- **QA**, quality assurance: keeping code, docs and SOPs correct and consistent.
- **AD**, administration: issues, branches, pull requests, merging and publishing.
- **DV**, development: changing, testing and documenting the game.

## Who does what

- **The project lead** (@darozak) sets direction, says when Claude's changes are merged, merges contributors' pull requests, and owns the repository and its GitHub Pages settings.
- **Contributors** make changes, review them, and bring ideas and feedback in as issues, per [CONTRIBUTING.md](../CONTRIBUTING.md). The project is MIT licensed ([LICENSE](../LICENSE)).
- **Claude** tracks every request in an issue, makes changes on its session branch, merges them into `main` when the project lead says so, and follows each publish. Claude never merges on its own judgment and never posts outside GitHub.
