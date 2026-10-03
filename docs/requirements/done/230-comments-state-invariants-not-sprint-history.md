---
id: 230
title: comments state invariants, not sprint history
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a reader without the story archive I want a comment to tell me the rule or the non-obvious
reason, not which deliverable of which review round introduced the line, so that the densest
files read as code again, headers are not the opposite of what the file does, and leftover
diagnostics do not spam the user's log.

Today ([review 2026-10-01](../../reviews/2026-10-01-codebase-review.md), F38): ~4,800 story
references in non-test source across 778 files; comment share is 55 % in `profile-restore.ts`
(a 254-line header essay), 55 % in `render.ts`, 57 % in `shared/modules/servers.ts`, 26 % in
`ControlsTab.tsx` (139 references), 135 of 580 lines in `useLauncher.ts`. Forms like "story-045
review round 2, finding 4", "Reversed by story 079 (was: …)", "Story 067 review finding F1 (third
round)". Stale headers: `servers/index.ts` says "There is no scanning yet" above a file wiring
scan, cadence, watchlist and LAN; `replays/index.ts` says "no process.platform checks" while
using it three times; `modules/index.ts` narrates a superseded stand-in. Three `[diag187]`
`log.info` lines remain in production.

Depends on story 227 (the comment convention in CLAUDE.md). Priority P3: do the sweep file by
file as those files are opened by other stories, or as a quiet filler.

## Acceptance Criteria

- [x] **AC1** — The `[diag187]` log lines are deleted or downgraded to `debug`; a test fails on
      any `log.info('[diag` in `src/main`.
- [x] **AC2** — The headers of `servers/index.ts`, `replays/index.ts`, `modules/index.ts`,
      `profile-restore.ts`, `render.ts` and `rebuild.ts` are rewritten in present tense and state
      what the file does today; none exceeds 40 lines.
- [x] **AC3** — One bounded sweep over the densest files (`profile-restore.ts`,
      `ControlsTab.tsx`, `lib/schemas.ts`, `shared/modules/{config,downloads,servers,replays}.ts`,
      `scan-service.ts`, `useLauncher.ts`, `ConfigView.tsx`) rewrites history narrative into
      invariants or deletes it; story pointers remain only as trailing `(story NNN)`; narrative
      worth keeping moves to the module's systems doc (story 228). Comment share in each swept
      file drops below 35 %.
- [x] **AC4** — No `D\d`/`AC\d` deliverable or acceptance-criterion ids remain in non-test source
      (grep-zero for `\bD[1-9]\b` and `\bAC[1-9]\b` inside comments), per the CLAUDE.md
      convention.
- [x] **AC5** — The story review (`/build`'s clean-agent review) checks new comments against the
      convention; the instruction is in the review prompt.

## Decisions (Sprint)

- **Paths are post-refactor.** 230 runs after 210/213/214/218 in S33, so `profile-restore.ts`,
  `render.ts`, `rebuild.ts`, `ControlsTab.tsx` and `ConfigView.tsx` mean the file(s) holding that
  content after those stories (e.g. every file of `src/shared/config/**/profile-restore/`); each D
  resolves them with `git ls-files` first — the criteria follow the content, not a dead path.
- **`render.ts` is `src/shared/config/render.ts`** (post-214 location); `src/main/modules/config/render.ts`
  is a one-line re-export with no header to rewrite.
- **`modules/index.ts` is `src/renderer/src/modules/index.ts`** — it holds the "stand-in" narrative
  (line ~72); `src/main/modules/index.ts` has none.
- **`scan-service.ts` means both** `src/main/modules/servers/scan-service.ts` and
  `src/main/modules/replays/scan-service.ts`, because the AC names no module and both carry the forms.
- **A "header" is the module's leading doc block** (the first `/** … */` of ≥ 3 lines), since the
  servers/replays headers sit above `defineModule`, not at line 1.
- **The `[diag187]` lines are deleted, not downgraded** — story 187 is done and they carry a
  user-visible protocol line at `info`; nothing reads them.
- **Comment share = lines touched by a comment ÷ all lines of the file**, measured with the shared
  comment scanner, threshold `< 0.35` — the measure the review used (55 % etc.).
- **AC4's scope is comments only**, as the AC says; string literals (log messages, migration
  descriptions in `persisted-migrations.ts`) are left alone because persisted/log text is not a
  comment and changing it is out of scope.
- **Test files and `src/test-support/` are excluded** from every comment check — the AC says
  "non-test source".
- **Narrative is machine-checked by markers** (`review round`, `review finding`, `finding F?\d+`,
  `reversed by story`, `round (one|two|three|\d)`), because "no review-round narrative" is otherwise
  only a reviewer's judgement; outside the swept files the markers are checked tree-wide too.
- **AC5 needs no edit:** `.claude/commands/build.md` (plugin-managed, "do not edit") already
  carries the rule in the review assignment (d) "comments that narrate story or review history
  instead of stating an invariant" and in the deliverable prompt; a test pins that clause so a
  plugin update that drops it turns red.
- **The id codemod is a throwaway, not committed** — a one-time migration; the guard test is the
  lasting artefact.
- **No CHANGELOG entry** — comments and a removed debug log line change nothing a user sees.
- **An invariant comment is rewritten, never deleted to hit the share**; narrative worth keeping
  moves to the module's doc under `docs/systems/` (story 228), the rest is dropped.

## Open Questions

- none

## Plan

Measured on 2026-10-03: ~4,100 `D\d`/`AC\d` occurrences in ~430 non-test files (≈ 2,250 in the
canonical `story NNN Dn` form, the rest bare); 199 narrative-marker lines in 64 files; shares
53–66 % in `profile-restore`, `render`, `shared/modules/{config,downloads}`.

1. **Scanner + guard (D1).** Add `commentRanges(source)` to `src/test-support/source-tree.ts` and
   rebuild `stripComments` on it (one lexer). New `src/comments.test.ts` holds every check of this
   story; it grows per D. D1 also deletes the three `[diag187]` lines and pins AC5.
2. **Headers (D2)** — six module headers rewritten, ≤ 40 lines, stale sentences gone.
3. **Codemod (D3)** — strips ids from the canonical forms tree-wide, inside comments only.
4. **Bounded sweep (D4–D7)** — the AC3 files by layer: contracts, shared/config, main, renderer.
   Each D adds its files to `SWEPT_FILES` (share < 0.35, trailing `(story NNN)` only, no ids, no
   markers).
5. **Residual ids (D8–D11)** — bare ids rewritten by directory; each D appends its root to
   `ID_FREE_ROOTS`; D11 collapses the list to `['src']`.

Every D: comments only — `npm run typecheck`, `npm run lint`, `npm test` green; `git diff`
shows no non-comment line change (D3's codemod asserts it per file).

## Deliverables

Common rules for every D below (repeat them to each agent): only comments change — no code, no
string literal, no test file, nothing under `src/test-support/` except D1's helper; a comment that
states an invariant or a non-obvious why is kept or rewritten, never deleted to reach a number;
history ("review round", "used to be", "was: …", which deliverable added a line) is deleted or,
if a reader needs it, moved to the module's doc under `docs/systems/` (story 228 created them);
a story pointer survives only as a trailing `(story NNN)`; no `D1`–`D9`/`AC1`–`AC9` ids. The
convention is the comment paragraph in `CLAUDE.md` (story 227).

- [x] **D1 — comment scanner, guard test, diag lines, review-prompt pin.**
  Files: `src/test-support/source-tree.ts` (add `export function commentRanges(source: string):
  { text: string; startLine: number; endLine: number }[]` — the same lexer `stripComments` uses,
  skipping string/template/regex literals; reimplement `stripComments` on top of it, no second
  lexer), `src/test-support/source-tree.test.ts` (cases: `//` inside a URL string, `/*` inside a
  regex, JSX `{/* */}`, line numbers of a multi-line block), `src/main/modules/replays/index.ts`
  (delete the three `log.info('[diag187] …')` calls at ~318/338/344; keep the surrounding `.then`
  chain working), new `src/comments.test.ts` (mirror `src/architecture.test.ts`'s use of
  `listSourceFiles`/`isTestFile`/`readRepoFile`). The test file holds: a `SWEPT_FILES: string[]`
  (empty), an `ID_FREE_ROOTS: string[]` (empty), a helper `commentShare(path)` (lines touched by a
  comment ÷ total lines), and the tests named under Acceptance Tests for AC1 and AC5, plus the
  table-driven tests over `SWEPT_FILES` / `ID_FREE_ROOTS` (vacuously green while empty) and the
  tree-wide narrative-marker test (markers: `review round`, `review finding`, `\bfinding F?\d+`,
  `reversed by story`, `\bround (one|two|three|\d)\b`, case-insensitive, comments only) — which
  will be red today, so in D1 it runs over `ID_FREE_ROOTS` only; D11 widens it with the list.
  AC5 test reads `.claude/commands/build.md` and asserts the review assignment contains
  "comments that narrate story or review history".
- [x] **D2 — six module headers as built.** Files (resolve post-refactor paths first):
  `src/main/modules/servers/index.ts`, `src/main/modules/replays/index.ts`,
  `src/renderer/src/modules/index.ts`, the `profile-restore` folder's `index.ts` (story 214),
  `src/shared/config/**/render.ts`, `src/main/modules/config/**/rebuild.ts`. Each header (first
  `/** … */` of ≥ 3 lines) is rewritten in present tense from reading the file's code: what it
  owns, what it registers/exports, the invariants a caller relies on; ≤ 40 lines; no ids, no
  history. Gone: "There is no scanning yet" (servers), "no platform checks - that is a later
  deliverable" (replays ~136), the story-115 "stand-in" narrative (renderer modules index ~72).
  Test in `src/comments.test.ts` (see AC2 line).
- [x] **D3 — id codemod over canonical forms.** A throwaway script (scratch dir or a temporary
  test run once and deleted — not committed) that, using `commentRanges` from D1, edits **only
  text inside comments** of every non-test `src/**/*.{ts,tsx}`: `story NNN D3` / `story-NNN D3, AC2`
  / `NNN D5's` → `story NNN` (keeping the surrounding punctuation readable), parenthetical
  `(D4)`/`(AC3)`/`(AC1, AC2)` → removed, `// AC3: text` → `// text`. It asserts per file that
  `stripComments(before) === stripComments(after)` and aborts otherwise. Acceptance: typecheck,
  lint, `npm test` green; report remaining id count (bare forms) per top directory.
- [x] **D4 — sweep the shared contracts.** Files: `src/shared/modules/config.ts`,
  `downloads.ts`, `servers.ts`, `replays.ts`, plus the matching `docs/systems/*.md` if narrative
  moves. Bring each below 0.35 comment share (today 57/66/35/37 %), story pointers trailing-only.
  Append the four paths to `SWEPT_FILES`.
- [x] **D5 — sweep shared/config.** Files: every file of the `profile-restore` folder (story 214)
  and `render.ts` (post-214 path), plus `docs/systems/config-module.md` if narrative moves.
  Each file below 0.35 (today 53 % / 54 % for the pre-split files). Append the paths to
  `SWEPT_FILES`.
- [x] **D6 — sweep the main files.** Files: `src/main/lib/schemas.ts`,
  `src/main/modules/servers/scan-service.ts`, `src/main/modules/replays/scan-service.ts`. Shares
  are already < 0.35; the work is pointer form, ids and narrative. Append to `SWEPT_FILES`.
- [x] **D7 — sweep the renderer files.** Files: `ControlsTab.tsx` and the component files story
  213 split out of it (its `components/`/`dialogs/` children), `ConfigView.tsx` and the components
  story 218 split out of it, `src/renderer/src/store/useLauncher.ts`. Append to `SWEPT_FILES`.
- [x] **D8 — residual ids: `src/shared` + `src/preload`.** Rewrite every remaining bare
  `D\d`/`AC\d` in comments (e.g. "D2's verification" → name the check; "(AC4)" → drop) in those
  trees. Append `src/shared`, `src/preload` to `ID_FREE_ROOTS`.
- [x] **D9 — residual ids: `src/main/modules/{config,downloads}`.** Same rewrite; append both.
- [x] **D10 — residual ids: rest of `src/main`.** Same rewrite; replace the main entries in
  `ID_FREE_ROOTS` with `src/main`.
- [x] **D11 — residual ids: `src/renderer`, then whole tree.** Same rewrite in `src/renderer`
  (the config module first: ~80 files); set `ID_FREE_ROOTS = ['src']`, which also makes the
  narrative-marker test tree-wide; rewrite any marker hit it reports.

## Model Hints

No `deliverable-hard`: every D edits comments only, the codemod proves code equality per file,
and typecheck/lint/test catch any slip.

Review: → default — the risk (invariant comments deleted to reach the share) is visible in the
diff, and a hard pass over a ~4k-line comment diff would not see it better.

## Acceptance Tests

- AC1 → unit `src/comments.test.ts` › "main logs no info-level diagnostic tags" (D1)
- AC2 → unit `src/comments.test.ts` › "module headers are at most 40 lines and carry no stale
  claims" — per file: header ≤ 40 lines, no id, no non-trailing story pointer, none of the three
  stale sentences (D2); present tense is the review's check.
- AC3 → unit `src/comments.test.ts` › "swept files keep comments under 35% with trailing story
  pointers only" — table over `SWEPT_FILES`, which must contain all AC3 files (asserted: the list
  covers the 12 named contents) (D4–D7)
- AC4 → unit `src/comments.test.ts` › "no deliverable or criterion ids in comments" over
  `ID_FREE_ROOTS = ['src']`, plus › "no review-round narrative in comments" (D3, D8–D11)
- AC5 → unit `src/comments.test.ts` › "the build review prompt checks comments against the
  convention" (D1)
- Scanner → unit `src/test-support/source-tree.test.ts` › "commentRanges finds comments, not
  comment-like text in literals" (D1)

## Done

Comment sweep over ~440 non-test files: ids stripped (codemod + hand rewrites), six module headers
rewritten, the densest files swept below 35 % comment share, `[diag187]` lines deleted.
`src/comments.test.ts` (new, on a one-lexer `commentRanges` in `src/test-support/source-tree.ts`)
guards headers, swept files, ids and narrative markers tree-wide, the diag tag and the build-review clause.

Commit message: 230: comments state invariants, not sprint history (diag187 removed, headers, id sweep, comment guard test)

Verification: narrow gate `npx vitest run --changed HEAD` green; build, typecheck, lint green; one full
`npm test` after the last fix shows only the two known pre-existing reds (shell-layering "no shell file
imports from modules"; test-kit mockClient offender useQuickFilters.test.ts). No e2e mapped. AC to test
(all ran and passed): AC1 "main logs no info-level diagnostic tags"; AC2 "module headers are at most 40
lines and carry no stale claims"; AC3 "swept files keep comments under 35% with trailing story pointers
only"; AC4 "no deliverable or criterion ids in comments" + "no review-round narrative in comments"; AC5
"the build review prompt checks comments against the convention"; scanner "commentRanges finds comments,
not comment-like text in literals". No manual residue.

Decisions:
- The replays header is the block above `defineModule`; `moduleHeader()` picks it. `profile-restore/index.ts` was already compliant; `render.ts` had no header, one was added.
- The id regex is wider than the spec (`\bD\d{1,2}\b|\bAC ?\d{1,2}\b`); in swept files and headers a story pointer must be a trailing `(story N)` (also `stories N`, `story-N`).
- CSS comments under `src/renderer/src/styles` keep old ids (AC4 covers ts/tsx source); left alone.
- History was deleted, not moved to docs/systems; leading `Story NNN:` pointers remain in unswept files (allowed).
- Two review cycles (both FAIL: guard gaps, invariants lost in downloads.ts/config.ts), all fixed; no third. Open: a few lower-value config.ts notes (`ImportPreviewResult` fields, `RefreshedProfileResult` duplicate-alias) not restored; the guard cannot detect invariant loss.
- D8-D11 ran in parallel (disjoint trees); D5 needed one re-dispatch (PARTIAL).

tiers: D 11 / hard 0 · review default · cycles 2 · agents 22
