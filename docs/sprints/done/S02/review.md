# Sprint S02 Review — Config module completion

## Overview

Goal: finish the config module concept — a profile's bindings and alternate layers can be
edited (not just viewed), an in-session profile-switch bind reaches the game, the Advanced tab
(categories, messages, macros, symbol picker) is usable, the profile is validated against every
engine it is actually assigned to, and redundant per-mod config copies can be found and cleaned
up.

All 5 planned stories were built. All are code-complete, tested and code-reviewed; none has had
a live UI smoke test (see [Blocked / open](#blocked--open)).

| Story | Status | Commit |
| --- | --- | --- |
| 006 — Keybinding editor with alternate binding layers | built, reviewed, live acceptance pending | `3b3e628` |
| 007 — In-session profile-switch bind | built, reviewed, live acceptance pending | `f7d171e` |
| 008 — Advanced tab — categories, messages, macros, symbol picker | built, reviewed, live acceptance pending | `b1da0a1` |
| 009 — Multi-engine validator | built, reviewed, live acceptance pending | `304503e` |
| 010 — Cleanup of redundant per-mod config copies | built, reviewed, live acceptance pending | `d0a48f2` |

Branch: `sprint/S02`, cut from `dev`. `npm run build` and `npm test` green after every story
(415 tests at sprint end across all stories' suites, no regressions introduced by later stories
on earlier ones). `npm run typecheck` also green throughout, though the project profile lists
`typecheck: none` — the script exists in `package.json` and was run anyway as a free extra
check.

## Implemented stories

**006 — Keybinding editor with alternate binding layers.** A pure alias generator
(`src/shared/config/alt-layers.ts`) turns hold layers into `+n`/`-n` alias pairs and toggle
layers into a self-rewriting `n_on`/`n_off`/`n` triple, respecting `MAX_ALIAS_NAME` (32) and the
engine's no-in-quote-escaping rule, with 1024-byte chunking for long bodies. Base-bind and
layer-scoped editing landed on the existing keyboard overview (`KeyBindDialog`, `LayersPanel`),
with a non-blocking warning when a layer remaps a key that carries a `+command` on the base
layer. Layer aliases render into the same per-profile file story 004 already writes — no second
file, no change to the write pipeline's backup/diff/atomic contract.

**007 — In-session profile-switch bind.** Generalizes 006's alias-pair mechanism to an n-way
self-rewriting chain: pressing the bound key execs the next assigned profile's file and echoes
its name, without ever touching the installation's own default-profile setting (session-only by
construction — the chain never writes launcher state). Shows only when an installation has ≥2
assigned profiles. A review finding was fixed pre-merge: the payload schema accepted characters
(`;`, `"`, `$`, space) as a valid single-char key that the generator's own sanitizer silently
stripped, which would have validated, persisted, and reported success while emitting no working
bind at all.

**008 — Advanced tab — categories, messages, macros, symbol picker.** The largest story of the
sprint (8 deliverables): ports `q2-config-manager`'s action-category/message/macro/symbol-picker
feature area into the launcher's own shapes (`action-catalog.ts`, `chat-macros.ts`,
`q2-charset.ts`, `engine-limits.ts` in `src/shared/config/`), with every action rendered as an
alias (`alias-render.ts`) that auto-splits across the 1024-byte `Cbuf_Execute` line limit. A
new Advanced tab hosts category grouping, a message composer distinguishing literal text from
meta-variables/server macros, and a latin-1 symbol/colour picker that never re-encodes to UTF-8.
Code review found and fixed a real stale-closure data-loss race in the tab's debounced save, an
Escape-key conflict between the modal and the new editors' key-capture mode, and a
preview/save quote-sanitization mismatch.

**009 — Multi-engine validator.** Validates a profile's rendered `.cfg` bytes — not a
re-derived approximation — against every engine actually reached through the profile's
assignments, each weighted equally (no primary/portability two-tier severity, per the concept).
Covers alias name length, alias loop depth, no-in-quote-escaping, per-engine command-buffer size
(8192/65536/65536, with q2pro's `COM_Compress`-aware EFBIG-on-overflow accounting) and the
1024-byte per-line limit. Moved the pure profile-file serializer and 007's switch-bind generator
into `src/shared/config/` so the bytes the validator checks are exactly the bytes the write
pipeline emits — this is also why 006–008's alias/render work landed first. Runs live against
unsaved edits via a new shared profile-draft hook. First code review returned **FAIL** with 8
findings; the most serious (F1) was that the shared draft only reseeded on profile-*id* change,
so edits made from `LayersPanel`/`KeyBindDialog`/`AssignmentsMenu`/`RenameProfileDialog` never
reached the validator and went silently stale — fixed via a pure, tested `mergeProfileUpdate`.
Six of eight findings were fixed and re-verified; one (no React-Testing-Library coverage for the
new hook's wiring) is accepted as a pre-existing repo-wide gap, not specific to this story.

**010 — Cleanup of redundant per-mod config copies.** A per-installation scan flags mod-folder
`*.cfg` files that duplicate a same-named file already reachable via the `baseq2` search path
(excluding `autoexec.cfg` and launcher-owned files), scoped strictly to
`<installation.path>/baseq2` and mod folders already known to that installation. Removal is
user-reviewed (nothing pre-selected except exact byte-identical duplicates) and goes through the
same backup-once contract story 004 uses for writes, extracted into a shared `backup.ts`, so a
removal is a session-scoped "Undo" away from being restored rather than an unrecoverable delete.
A gamedir-name safety check (`isSafeGameDirName`) was added as a second layer alongside the
existing `gameDirBelongsToInstallation`, since a `..`-laden `gameDirs` array could in principle
survive `state.json`'s forgiving parse.

## Findings & decisions

Aggregated from each story's `## Decisions (Sprint)` sections and build feedback — relevant for
planning beyond this sprint:

- **Alias generation now has one canonical home.** Three stories in a row (006, 007, 008) each
  needed to emit engine aliases; the byte-chunking/name-budget/no-nested-quotes logic lives once
  in `src/shared/config/` and is reused, not re-implemented, by each. Any future feature that
  needs to emit a bind/alias should extend these helpers rather than write a fourth version.
- **The profile serializer and switch-bind generator moved from `src/main/modules/config/` to
  `src/shared/config/`** (story 009) specifically so the validator checks the *actual* rendered
  bytes rather than a parallel approximation that could drift from what gets written to disk.
  `src/main/modules/config/render.ts`/`switch-bind.ts` are now thin re-export shims — keep new
  main-only concerns (anything touching `fs`) out of these files going forward.
- **`engine-limits.ts` is the new source-cited home for engine numeric limits**
  (`MAX_ALIAS_NAME`, `ALIAS_LOOP_COUNT`, per-engine buffer sizes, `COM_Compress` semantics),
  seeded in story 008 and extended in 009 — any future engine-limit fact belongs there, not
  re-derived locally.
- **Backup-once is now a shared, reusable contract** (`src/main/modules/config/backup.ts`,
  extracted in story 010 from story 004's writer) — both write and delete paths use the exact
  same `<file>.q2l-backup`/no-clobber semantics. Any future feature that mutates a user's config
  file should reuse this rather than a fourth backup implementation.
- **This session's sandbox cannot run Electron's GUI** (`npm run dev` crashes with
  `TypeError: Cannot read properties of undefined (reading 'isPackaged')` — no real
  display/runtime available), which is a different failure mode than S01's WSL/X-server gap but
  the same practical consequence: every story's live-UI-smoke step was skipped by design, not
  oversight. See [Blocked / open](#blocked--open).
- **Nested sub-agent delegation stalled repeatedly during this sprint's build phase** (silent,
  multi-minute stretches with zero file changes, on stories 006's D6, 008's D7, 009's D3, and
  010's D3) — each time, the build orchestrator (or the sprint orchestrator prompting it) caught
  the stall via direct filesystem inspection and either took over the deliverable directly or
  let the stalled agent resume once it recovered. No story's correctness was compromised, but
  build wall-clock time for this sprint was substantially inflated by this pattern. Worth a
  process note for future sprints: check for real file-system progress before trusting a
  "still waiting" self-report from a nested orchestrator.
- **009's final code-review pass and 010's final code-review pass both took long enough that the
  build orchestrator moved on and did its own hand-verification** (re-running build/test/
  typecheck and spot-checking the specific risk surface — draft-staleness for 009, the
  destructive delete/restore path for 010) as an explicit, documented fallback. 010's delayed
  review verdict arrived after the story was already committed: **PASS**, but with a real defect
  (the finding-key template literal embedded a raw NUL byte instead of the ` ` escape
  `cleanup.ts`'s own `entryKey` uses, which made git treat `CleanupPanel.tsx` as binary — fixed
  in a follow-up commit, `1b589aa`). The same review surfaced 8 further non-blocking findings
  worth a follow-up story if they bite: the scan path itself skips the `isSafeGameDirName`
  second-line-of-defence check the delete path relies on (read-only, so low risk); a mid-loop
  I/O error during removal can silently drop already-deleted files from the UI's undo list even
  though their backups exist; the duplicate-entry guard uses an exact string key instead of the
  case-folded key `writer.ts` uses elsewhere, so `ctf`/`CTF` can double-unlink; the restore
  panel reports "Restored" even when every entry was rejected; the redundancy scan's `.cfg`
  suffix match is case-sensitive while its own `baseq2`-twin lookup is not, so an uppercase
  `HUD.CFG` duplicate is never listed; `restore` is a general "any backup with this name" primitive
  rather than scoped to what cleanup itself removed; and the shared `Cleanup*` contract types are
  redeclared locally in `cleanup.ts` instead of imported from `@shared/modules/config`.

## Blocked / open

No story is blocked in the sense of an unresolved spec question — all 5 are functionally
complete, reviewed (with the two hand-verification fallbacks noted above), and green on
`npm run build` / `npm test` / `npm run typecheck`.

**All 5 stories are "built, reviewed, live acceptance pending" (P2 exemption used throughout):**
`ui-acceptance-required: true` and `live-smoke-required: true` apply to this project, but every
build session in this sprint ran in a sandbox where Electron's GUI cannot start at all (no
display/runtime — `npm run dev`'s Electron main process crashes immediately). This is an
environment limitation, not a code defect — each story's manual `## Test Plan (manual
acceptance)` section is written and ready, but none of them has been walked through the real UI
yet.

**Decision the user needs to make:** run `docs/sprints/S02/testplan.md` against a real
Windows/Electron desktop before treating any of 006–010 as truly done, and before moving
`docs/concepts/config-module.md` to `docs/systems/`. Until then, the config module milestone
stays "built, acceptance pending" in the roadmap, same as S01 was until its own live acceptance
pass.
