# Sprint S27 — manual test plan

Only criteria that cannot be automated land here (`testplan: optional`, per
`.claude/ai-scrum.md`). Every other acceptance criterion in this sprint is proven by an automated
test — see `review.md`'s Acceptance table.

## Story 156 — I find a demo on disk

**AC1 (partial) — "Reveal in file manager" opens the system file manager with the demo file
selected, on Windows and Linux.**

Reason it can't be automated: there is no in-app signal that a real OS file-manager window opened
with the right file selected — the e2e harness records the reveal path to a file instead of
calling `shell.showItemInFolder` (`recordHarnessRevealedPath`), which proves main resolved the
right, path-never-crosses-IPC target, but not that Explorer/the Linux file manager actually opened
and highlighted it.

Preparation: a running Q2 Launcher build with at least one indexed demo (loose file or a `.zip`
entry) visible in the Demos list.

Steps:

1. Open the Demos view and select a demo from the list.
2. In its detail panel, click "Reveal in file manager".
3. Repeat for a demo inside a `.zip` archive.

Expected result: the system file manager opens with the demo file (or, for an archive entry, the
`.zip` file itself) selected/highlighted, on both Windows and Linux.
