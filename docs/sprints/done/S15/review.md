# Sprint S15 — Review

## Overview

**Goal:** one word for one concept — the launcher calls a Quake II engine an *engine*, everywhere,
and only offers the two it actually supports; an installation is told apart by an icon the user
picked, not by two letters derived from its engine; the config profile header stops looking pasted
together; and creating a profile offers the three starting points people actually arrive with —
empty, a handed template, or their own config files.

This closes the "Identity, icons and the first profile" milestone (`docs/ROADMAP.md`).

| Story | Status | Commit |
| --- | --- | --- |
| 068 — the app says engine, not client | done | `40a4d83` (+ `6e2a51e` fix, see below) |
| 067 — an installation carries an icon I choose | done | `d750127` |
| 069 — the profile header breathes in two lines | done | `f144537` |
| 066 — a new profile starts empty, from a handed template, or from my own config files | done | `e111db8` |

Build order followed the sprint plan exactly: 068 → 067 → 069 → 066 (068 settles the engine
vocabulary and supported-engine set everything else builds on; 067 replaces the code tile before
069 reworks the header next to it; 066 is the largest and most independent story, built last).

## Implemented stories

**068 — the app says engine, not client.** `EngineDefinition` carries a required `supported`
boolean (true only for `r1q2`/`q2pro`); the create-installation dialog's dropdown and every "Client"
label in `en.json` now derive from that data instead of a hard-coded list. Detection still
classifies all eight known engine kinds; an unsupported one is marked "unsupported" in text on its
badge, never degraded to `unknown`.

**067 — an installation carries an icon I choose.** A new `InstallationTile` (extracted once, used
by rail/library-card/action-bar) shows either a shipped icon (from `assets/installations/`,
converted to 128px `.avif` at build time), a user-picked image (validated, re-encoded to 128px PNG
by main, stored at `userData/installation-icons/<id>.png`, delivered as a `data:` URL), or today's
code tile as before. Three new IPC channels own the OS file dialog and all path handling in main.

**069 — the profile header breathes in two lines.** The config profile header's identity zone is
now two lines — name + saved state, then created/updated in smaller, dimmer type — while the
30-visible-editor-line floor (story 061 AC4) is not just preserved but hardened: the read-only raw
tab's find bar is now on-demand instead of permanently visible, and its locked-state hint moved into
the merged toolbar row, so both raw-tab states measure the same 30-line box instead of one being
lucky.

**066 — a new profile starts empty, from a handed template, or from my own config files.** The
create-profile dialog's "Start from" now offers four options (Empty, Template right-/left-handed,
Import from files). Import no longer addresses `{ installationId, gameDir }` — it addresses a
user-picked, arbitrary set of `.cfg` files via an opaque id → path registry owned entirely by main
(`DialogService` + a picked-file session map), closing the gap where 96 of the reference fixture's
aliases were never read because nothing `exec`s them from the engine's own entry files.

## Findings & decisions

- **068 — a real orchestrator bug, not a story bug.** The first commit for 068 captured a stale,
  pre-build snapshot of the story file: a `git mv` staged the file's rename before its Done section
  was written, and a follow-up `git add` never re-staged the finished content. Fixed with a
  dedicated follow-up commit (`6e2a51e`). No code was affected — the bug was in the orchestrator's
  own commit hygiene, not in story 068's implementation. Every subsequent story's build agent was
  explicitly told not to use `git mv` for its own done-move, and this session verified each commit's
  staged content before committing.
- **068 decisions:** AC1 is enforced zero-tolerance (no allowlist) over every `en.json` string
  value, catching three cvar-help strings beyond the ones the requirement named; the unsupported
  marker is one interpolated string composed inside the existing badge, not a second badge node;
  `isEngineSupported` is false for `custom`/`unknown` too, so the rule has no exceptions.
- **067 review (2 passes, story-review-hard):** found and fixed two real bugs — a stale icon-cache
  invalidation gap (re-picking or clearing a custom icon kept showing the old image until restart)
  and a ~5px rail-tile layout drift introduced by the tile extraction. Two lower-severity findings
  were accepted as documented rather than fixed: a missing regression test for the cache fix (added
  after the fact and verified to actually catch the bug reverted) and a stale test comment.
- **069 review (3 passes, story-review-hard):** two real regressions in the on-demand find bar were
  caught and fixed — the bar losing keyboard reachability after Escape, and Ctrl+F becoming a
  destructive no-op when the bar was already open. Four non-blocking findings accepted as
  documented: the find bar is undiscoverable on cold arrival (intentional, matches the option the
  user chose for the header-floor hardening), Escape restores focus to the wrong element, one
  untested memo gate, and a pre-existing query-clear asymmetry between the two code-view branches.
- **069's own investigation corrected a wrong premise mid-refine:** the first refine pass measured
  the acceptance guard as already red before any code change and blocked on a user decision (which
  route to fix it). The user chose "069 absorbs the repair." A second refine pass then found the
  "red" measurement was a stale/dirty test fixture from an unrelated earlier session, not a real
  regression — a fresh `npm run ui:seed` showed the guard green. The chosen repair was kept anyway
  because it hardens AC4 to hold in both raw-tab states rather than one by accident; this turned out
  to be the right call, since it also implicitly fixed the two find-bar bugs review round 1 and 2
  found in the very code the repair touched.
- **066 review (story-review-hard):** confirmed the two things the story itself flagged as its
  named review risk — the renderer→main path-trust seam (opaque ids, never a path; commit re-reads
  from disk rather than trusting the preview) and the `Q2L_UI_HARNESS`+`isDev` double gate on the
  new `DialogService` (traced to `isDev` sourcing from `!app.isPackaged`, not an env var, so the
  gate cannot collapse in a packaged build). Two findings fixed (a stale "Import from installation"
  label plus its own test pinning it; a dead i18n string); two accepted as documented (e2e coverage
  of the raw-file "own-written file" restore banner was lost when its old screen was retired — unit
  coverage survives; a 64-file `fileIds` cap surfaces a generic error rather than a cap-specific
  message, not required by any AC).
- **Standing carry-over rule from S14 held clean this sprint:** 068 is a label-rename story and the
  sprint plan flagged the `getByRole` selector risk explicitly; the grep across `scripts/flows/` and
  `scripts/lib/screens.mjs` came back clean (only `clientWidth`/`getBoundingClientRect` matches),
  confirming no cross-story selector collision this time.

## Blocked / open

None. All four stories are `done`.

## Acceptance

Every acceptance criterion was mapped to a named, automated test in refine and proven by it in
build; see each story's own `## Acceptance Tests` / `## Done` → "AC → test mapping" for the full
list. Summary:

- **068** — AC1-AC5 all proven at unit level (`src/shared/types/engine.test.ts`,
  `src/renderer/src/i18n/vocabulary.test.ts`, `CreateInstallationDialog.test.ts`,
  `EngineBadge.test.ts`) plus the real surface (`scripts/flows/engine-not-client.mjs`). No manual
  residue.
- **067** — AC1, AC3, AC5, AC8, AC9 proven on the real surface
  (`scripts/flows/installation-icon-tile.mjs`, `installation-icon-pick.mjs`) plus unit tests; AC2,
  AC4, AC6, AC7 proven by main-process unit tests with a stubbed `showOpenDialog`
  (`installation-icons.test.ts`). **Manual residue:** AC2's native OS multi-select-adjacent single
  file dialog itself — Playwright cannot drive an OS-native dialog; everything from the resolved
  path onward is covered.
- **069** — all five criteria proven by the extended real-surface guard
  (`scripts/flows/config-header-geometry.mjs`), run with a fresh `npm run ui:seed` each time. No
  manual residue.
- **066** — AC1, AC3, AC4, AC5, AC9, AC11 proven on the real surface
  (`scripts/flows/import-from-files.mjs`) plus unit tests; AC2, AC6, AC7, AC8, AC10 proven by
  main-process unit tests (`import-reader.test.ts`, `import-fixtures.test.ts`, `import.test.ts`,
  `dialog.test.ts`). **Manual residue:** AC4's native OS multi-select file dialog itself — same
  Playwright limitation as 067; the `Q2L_UI_HARNESS`+`isDev`-gated stub covers everything from the
  resolved paths onward.

**Verification, aggregated from each story's own build:** `npm run build`, `npm run typecheck` and
`npm test` green throughout the sprint (final count 2755/2755, with one pre-existing, unrelated
Windows timing flake in `import-reader.test.ts`'s 512-file exec-expansion test — confirmed present
before this sprint and clean in isolation, same class already documented for stories 065/068/069).
`npm run ui:verify` clean at every story's checkpoint (0 axe violations throughout), plus a
dedicated `ui:flow` script per user-facing story.

**Two manual residues, both the same class of gap** (an OS-native file dialog Playwright cannot
drive): see `testplan.md`.
