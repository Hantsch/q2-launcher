---
id: 089
title: The wizard gains an existing-folder data source
status: done
created: 2026-09-11
---

## Requirement

The third and last data source the wizard needs, per
[concepts/install-module.md §8](../concepts/install-module.md) step 2 and the "point at a folder
that already has data" half of INST-W2: a user who already has Quake II data somewhere the store
detection ([[088]]) does not recognise — a manual copy, an old install, a USB stick — points the
wizard at that folder instead of downloading or picking a detected store installation. The wizard
copies the retail (or demo) paks it finds there into the new installation exactly as [[088]] does
for a detected store installation; the engine is still fetched from the manifest and verified
exactly as [[074]] already does.

## Acceptance Criteria

- [x] **AC1** — The wizard's game-data step always offers "point at an existing folder", regardless
      of whether any store installation was detected.
- [x] **AC2** — Choosing this option lets the user browse to a folder; the wizard then reports what
      it found there (retail data, demo-only data, or nothing usable) before the user can proceed.
- [x] **AC3** — A folder containing usable retail `pak0.pak`/`pak1.pak` proceeds exactly like
      [[088]]'s detected-store path: those files are copied (never linked) into the new
      installation, and the result carries no Demo marker.
- [x] **AC4** — A folder containing only demo-equivalent data (no valid retail paks) proceeds as a
      demo installation, carrying the same Demo marker [[074]] introduced for the free-download
      path.
- [x] **AC5** — A folder containing nothing usable is rejected with a reason before the job starts,
      not partway through.
- [x] **AC6** — Before the job starts, the confirm step names the chosen folder as the data source,
      what will still be downloaded (the engine) and its size, and the target path.
- [x] **AC7** — This data source produces `baseq2` only — no `ctf`, `xatrix` or `rogue` directory
      is created even if the source folder has one.

## Decisions (Sprint)

- **(User)** Folder picked: game root — the user browses to a game-root folder (the folder
  containing e.g. `quake2.exe`), expected to contain `baseq2` inside it, matching how store
  detection ([[088]]) and the free-download path already think in terms of an install root.
- **"Usable" is decided at `<root>/baseq2/` only** (closes the Open Question): `pak0.pak`/`pak1.pak`
  are looked for as immediate children of the picked root's `baseq2` directory (case-insensitive
  name match, as `inspectInstallation` already does via `byLowerName`) — a looser "search any
  subfolder" rule would make the copy non-deterministic and could not be expressed as an allowlist,
  which is the only mechanism that guarantees AC7.
- **Three verdicts, defined by size, not by hashing:** `retail` = `pak0.pak` *and* `pak1.pak` both
  present and matching `RETAIL_PAK_SIZES` (`src/shared/constants.ts`); `demo` = `pak0.pak` present
  but the retail check failed; `unusable` = no `baseq2/pak0.pak` at all — because the inspector
  already decides "is this retail" by exactly that pak0 size comparison, so any other rule here
  would produce a wizard verdict that disagrees with the Demo marker the finished installation gets.
- **One detection routine shared with [[088]]** (closes the Open Question): the pak-size check and
  the copy live in one main-side module, expected as
  `src/main/modules/downloads/bootstrap/game-data-source.ts` exporting
  `inspectGameDataSource(rootPath)` and `copyGameDataSource(rootPath, targetRoot)` — a second
  implementation of "is this retail" would be a second answer to the same question. **Reconcile at
  build time:** [[088]] is refined in parallel and builds this routine first for its AC3/AC4; if it
  landed under a different file/function name, 089 imports *that* one and adds only what is missing
  (the `demo`/`unusable` verdicts), never a parallel copy.
- **The data source becomes an explicit discriminated union in the contract**, shared with [[088]]:
  `BootstrapDataSource = { kind: 'download' } | { kind: 'store'; path: string } | { kind: 'folder';
  path: string }`, carried on `StartBootstrapInput.source` and echoed on `BootstrapSummary.source` —
  the wizard's data source is now a real choice and a `boolean`/optional-path pair would let an
  impossible combination through the schema. If [[088]]'s build already added the union, 089 adds
  only the `'folder'` variant.
- **The wizard's new step is the one [[088]] introduces:** `STEP_ORDER` becomes
  `engine → source → target → confirm → running`, with the existing-folder option unconditional
  (AC1) next to free-download (always) and detected-store ([[088]], conditional) — the source
  decides what the summary and the job do, so it has to be chosen before the target step, and one
  shared step keeps both stories out of each other's way. If [[088]] has not landed it yet, 089
  introduces the step in exactly this shape.
- **Browsing reuses `installations:pickFolder`** (`src/shared/ipc.ts:88`), the same channel the
  target step and the write-dir remedy already use — no second folder-picker channel, and the
  `Q2L_UI_PICK_FOLDER` harness stub then drives AC2 through the real surface.
- **The source path is re-judged in main, never trusted from the renderer:** `bootstrap.start`
  re-runs `inspectGameDataSource` before `installations.create()` and fails with
  `downloads.error.gameDataSourceUnusable` (new `DOWNLOADS_ERROR_KEYS` member) — AC5's "before the
  job starts", and CLAUDE.md's "paths from the renderer are never trusted".
- **A source that overlaps the target is refused** as `unusable` with its own reason: the source
  path also goes through the path-safety checks `computeTargetVerdict` already owns (device paths,
  reserved names), extracted from `target.ts` as an exported `isUnsafeAbsolutePath()`, plus a
  containment test against the target — copying a folder into itself is the one way this feature
  could destroy the user's data.
- **The copy is a fixed allowlist, never a recursive directory copy:** `baseq2/pak0.pak`,
  `baseq2/pak1.pak`, `baseq2/pak2.pak` (each only if present) — the same mechanism `assemble.ts`
  uses to guarantee no `ctf`/`xatrix`/`rogue` ever appears (AC7), and a filter-based copy would
  make that guarantee a matter of keeping a denylist current.
- **`pak2.pak` is copied when the source has it**, even though AC3 names only pak0/pak1 — a 3.20-
  patched retail folder ships it, and leaving it behind would trigger the inspector's
  `validation.retailPaksMissing` warning on an installation that had the file available.
- **The Demo marker needs no new code** (AC3/AC4): it is derived at read time by `isDemoData()`
  from the inspector's `validation.pak0NotRetail` check, so a copied retail pak0 produces no marker
  and a copied demo pak0 produces the same marker the free-download path gets — introducing a flag
  would create a second truth for the same fact.
- **This source downloads the engine package only:** `resolvePackages` resolves the demo and
  point-release packages only for `kind: 'download'`, so AC6's "what will still be downloaded" is
  one package and its size, and the job's byte accounting stays the engine's size.
- **No video/players toggle for this source in this story:** the toggle is hidden and
  `includeVideoAndPlayers` is forced `false` when the source is a folder — 089's criteria never
  mention it, the toggle's payload today comes from the point-release archive this source does not
  download, and [[088]]'s up-front-presence rule can be extended to this source later as its own
  story.
- **Copy progress rides the existing assemble phase:** the local copy runs where
  `assembleInstallation` runs and reports through the existing `ASSEMBLE_CORE_RATIO` step rather
  than inventing a second byte counter — the job's progress model, cancel checks and `copied`
  cleanup set then apply unchanged.
- **The e2e fixture creates the retail paks with `fs.truncate`** at exactly `RETAIL_PAK_SIZES`
  bytes and deletes them in `teardown()` — the check reads size only and never hashes, so a real
  184 MB download is not needed to prove the real path.

## Open Questions

*(none — both entries were decided above)*

## Plan

1. **Contract first** (`src/shared/modules/downloads.ts`): `BootstrapDataSource` union,
   `GameDataSourceVerdict` (`rootPath`, `kind: 'retail' | 'demo' | 'unusable'`, `reason?`,
   `paks: { name, sizeBytes, retail }[]`), `DOWNLOADS_HANDLERS.bootstrapGameDataSource =
   'bootstrap.gameDataSource'`, `StartBootstrapInput.source`, `BootstrapSummary.source`, the new
   error key. Schemas in `src/main/modules/downloads/schemas.ts`, client in
   `src/renderer/src/modules/downloads/client.ts`.
2. **The shared routine** (`bootstrap/game-data-source.ts`, reconciled with [[088]]):
   `inspectGameDataSource()` (path safety → `baseq2` listing → pak sizes vs `RETAIL_PAK_SIZES`) and
   `copyGameDataSource()` (fixed 3-entry allowlist, returns the target-relative paths copied).
   Export `isUnsafeAbsolutePath()` from `bootstrap/target.ts` for it.
3. **Job + summary** (`bootstrap/job.ts`, `index.ts`): `resolvePackages` takes the source and
   returns engine-only for a folder source; `buildBootstrapSummary` echoes the source; `start`
   re-inspects the source before `create()` and refuses; the copy runs in the assemble phase,
   feeding `copied`. Handler for `bootstrap.gameDataSource`.
4. **Wizard source step** (`bootstrap/SourceStep.tsx` + `BootstrapWizard.tsx`): the three options,
   browse via `installations:pickFolder`, verdict line, `canProceed.source`.
5. **Confirm step** (`ConfirmStep.tsx`): source line, engine-only package list, toggle hidden for a
   folder source; `en.json` throughout. Then the two `scripts/flows/` acceptance flows.

## Deliverables

- **D1 — the contract carries a data source.** `src/shared/modules/downloads.ts` (union, verdict
  type, handler name, `StartBootstrapInput.source`, `BootstrapSummary.source`, new
  `DOWNLOADS_ERROR_KEYS` member), `src/main/modules/downloads/schemas.ts` (source schema on
  `bootstrapSummaryInputSchema`/`startBootstrapInputSchema` + `bootstrapGameDataSourceInputSchema`),
  `src/main/modules/downloads/bootstrap/errors.ts`, `src/renderer/src/modules/downloads/client.ts`.
  Mirror: the `bootstrapSummary` entries added by 074 D4 in each of these files.
  *Acceptance:* typecheck + `npm test` green; every existing call site compiles against the new
  shape (`{ kind: 'download' }` is the free path's value). Test: schema cases in the existing
  downloads schema test file — an unknown `kind`, and a `'folder'` source without a path, are both
  rejected.
- **D2 — one routine decides "usable retail data" and copies it.** New
  `src/main/modules/downloads/bootstrap/game-data-source.ts` + `game-data-source.test.ts`; exports
  `isUnsafeAbsolutePath()` from `bootstrap/target.ts`. **Reconcile with [[088]] first** — if it
  already built this module, extend it instead of adding a second. Mirror: `bootstrap/target.ts`
  (verdict-producing pure-ish function) and `bootstrap/assemble.ts` (allowlist copy discipline).
  *Acceptance:* unit tests cover retail / demo / unusable classification, a source whose `baseq2`
  holds `ctf`, `xatrix`, `rogue` and loose files (none copied), overlap with the target refused, and
  `pak2.pak` copied when present.
- **D3 — the job installs from a folder.** `src/main/modules/downloads/bootstrap/job.ts`
  (`resolvePackages` source-aware, `buildBootstrapSummary` echoes the source, pre-`create()` refusal,
  the copy inside the assemble phase feeding `copied`), `src/main/modules/downloads/index.ts` (the
  `bootstrap.gameDataSource` handler), plus `bootstrap/job.test.ts` cases. Mirror: the existing
  `missingRequired`/`r1q2` branches in `job.ts` for where a source-specific step belongs.
  *Acceptance:* unit tests prove the start refusal with `downloads.error.gameDataSourceUnusable`
  before any installation is registered, engine-only package resolution and summary, and that a
  failed run's cleanup removes the copied paks.
- **D4 — the wizard has a data-source step.** New
  `src/renderer/src/modules/downloads/bootstrap/SourceStep.tsx`, `BootstrapWizard.tsx` (step order,
  source state, `pickSourceFolder()` via `installations:pickFolder`, `canProceed.source`),
  `src/renderer/src/i18n/locales/en.json`. Mirror: `TargetStep.tsx` (browse + verdict rendering +
  "cannot proceed" shape) and `EngineStep.tsx` (option list). Plus the happy-path flow
  `scripts/flows/bootstrap-existing-folder.mjs` (mirror: `scripts/flows/bootstrap-wizard.mjs`,
  including its `findForbiddenDirs` assertions and its `Q2L_UI_PICK_FOLDER` usage).
  *Acceptance:* the flow drives engine → existing-folder → browse → retail verdict → target →
  confirm → success against a truncate-built retail fixture and asserts the copied paks, the absent
  Demo marker and the absent `ctf`/`xatrix`/`rogue` directories on disk.
- **D5 — demo and rejection read as reasons, not as failures.** `ConfirmStep.tsx` (source line,
  engine-only package list, toggle hidden for a folder source), the verdict/refusal strings in
  `en.json`, and the second flow `scripts/flows/bootstrap-existing-folder-demo.mjs`.
  *Acceptance:* the flow runs a demo-only fixture to a finished installation carrying the Demo
  marker, and a second pass against an empty folder where the wizard names the reason and Next stays
  disabled.

## Model Hints

- `D3 → deliverable-hard` — `job.ts` is the story's regression surface: a new branch has to sit
  inside its existing cancel/cleanup/`copied`/`lastFailure` choreography (074/075/077/078 all wrote
  into it) without changing what the free-download path does at any of those exits.
- D1, D2, D4, D5 → default tier.
- `Review: → story-review-hard` — a renderer-supplied path is used to read and copy files into a
  freshly created installation, and the free-download path must remain byte-for-byte unaffected;
  both are exactly the kind of thing a cheap review reads past.

## Acceptance Tests

As-built note: the two flows are sequential Playwright `_electron` scripts (`npm run ui:flow --
<name>`), not vitest `it()` cases — each step below is one of the flow's logged steps/assertions,
named by what it checks rather than by a test-framework title.

- AC1 → e2e `scripts/flows/bootstrap-existing-folder.mjs` — "open the wizard and assert the
  existing-folder choice is offered" with `Q2L_UI_HARNESS_STORE_SOURCES` forced empty (D4)
- AC2 → e2e `scripts/flows/bootstrap-existing-folder.mjs` — "assert Next is blocked before a folder
  is picked" then "assert the retail verdict appears... before Next enables" (D4)
- AC3 → e2e `scripts/flows/bootstrap-existing-folder.mjs` — sha256 byte-compare of the copied
  `pak0.pak`/`pak1.pak` plus "assert no Demo marker" on card/action bar, plus unit
  `src/main/modules/downloads/bootstrap/job.test.ts` › "AC3: …resolves the engine package only and
  copies exactly the folder's paks" (D3) — this is the production-path proof (through
  `assembleInstallation`/`buildFolderGameDataEntries`); `game-data-source.test.ts`'s
  `copyGameDataSource` cases (D2) cover the same allowlist/never-linked behaviour as a standalone,
  independently tested building block that production does not call directly (the job pushes a
  `role: 'folder'` source into the same `assembleInstallation` call the free-download/store-copy
  paths already use, per the "copy rides the existing assemble phase" decision below)
- AC4 → e2e `scripts/flows/bootstrap-existing-folder-demo.mjs` — pass 1, "assert the Demo marker on
  tile, card and action bar" (D5), plus unit `game-data-source.test.ts` › pak0 present but
  wrong-size, or pak1 missing → `kind: 'demo'` (D2) and `job.test.ts` › "AC4: a demo-only folder
  installs with the one pak it has" (D3)
- AC5 → e2e `scripts/flows/bootstrap-existing-folder-demo.mjs` — pass 2, "assert the reason" and
  "assert nothing was created" (D5), plus unit `job.test.ts` › "AC5: an unusable source is refused
  before the installation is registered" (asserts empty `installations.list()`/`jobs.list()` and
  no target directory, not just an error return) and "a source that overlaps the target is refused
  the same way, in both directions" (D3)
- AC6 → e2e `scripts/flows/bootstrap-existing-folder.mjs` — "assert the confirm step names the
  engine-only download and the target", checking the rendered copy-source line's text contains the
  source path, the target line equals the target path, and the package list contains the engine id
  but neither game-data package id (D4/D5)
- AC7 → e2e `scripts/flows/bootstrap-existing-folder.mjs` — recursive on-disk search for
  `ctf`/`xatrix`/`rogue`/loose files against a fixture that ships all of them, plus unit
  `game-data-source.test.ts` › "the allowlist copies nothing outside baseq2's paks" (D2) and
  `job.test.ts`'s AC3 case (exact `readdir` of the target) (D3)

Both flows run through the project's real-surface harness (`npm run ui:flow -- <name>`, the same
Playwright `_electron` harness `npm run ui:verify` uses); no manual residue.

## Done

**Summary.** The bootstrap wizard's game-data step (088's `GameDataStep.tsx`) gains a third,
always-offered option: point at an existing folder. Browsing runs it through a new
`inspectGameDataSource()` that classifies the folder's `baseq2/` as `retail` / `demo` / `unusable`
by pak size alone, exactly like [[088]]'s store-copy path but with two extra verdicts store-copy
never needed. A retail or demo folder proceeds to a job that downloads the engine only and copies
the pak(s) the inspector actually found — through the same `assembleInstallation` call and
allowlist mechanism the free-download/store-copy paths already use, so `baseq2`-only (AC7) is a
property of the code, not of a fixture. An unusable or target-overlapping folder is refused
server-side before any installation is registered (AC5), independent of whatever the renderer
claims.

**Commit message:**
```
089: wizard gains an existing-folder data source
```

**Reconciliation decisions (this story was refined against a version of [[088]] that landed
differently than expected; these are the resulting deviations from this story's own Plan/Decisions
prose, made during build per the sprint's "no questions to the user" rule):**
- `BootstrapDataSource` stayed [[088]]'s **flat string union** (`'free-download' | 'store-copy'`),
  widened to add `'existing-folder'`, instead of the discriminated `{kind:...}` object union this
  story's Decisions section describes — 088 never built that shape for `store-copy` either, and
  forking the type two ways for the same concept would be worse than the union this story
  originally wanted to avoid. `copySourcePath` (already on `StartBootstrapInput`/`BootstrapSummary`)
  is reused verbatim for the folder path; no second field.
- No `game-data-source.ts` was needed as a *shared* module with [[088]]'s pak-size check — 088's
  `inspectRetailSource` is a boolean verified/not-verified check with no `demo` concept, which this
  story's three-verdict requirement doesn't fit. Added `src/main/modules/downloads/bootstrap/game-data-source.ts`
  (`inspectGameDataSource`, `copyGameDataSource`, `isPathContainedBy`) as its own module, importing
  the same `RETAIL_PAK_SIZES` constant `retail-source.ts` uses — the size table itself is never
  duplicated, only the small comparison/verdict logic, which is legitimately different logic (2-way
  vs 3-way).
- `isUnsafeAbsolutePath()` was extracted from `target.ts`'s `computeTargetVerdict` as planned, and is
  now shared by both.
- The wizard's new option was added to [[088]]'s actual step, `GameDataStep.tsx` (`'gameData'` in
  `STEP_ORDER`), not a new `SourceStep.tsx`/`'source'` step as this story's prose names it — 088
  already built exactly the "one shared step" this story's own Decision asked for, just under a
  different name.
- `copyGameDataSource()` (D2) is a fully tested, reusable building block that production does **not**
  call — `job.ts` instead pushes a `role: 'folder'` source into the same single `assembleInstallation`
  call the free-download/store-copy paths already use (mirroring exactly how 088's `role: 'retail'`
  push already worked), which is what makes "copy rides the existing assemble phase" (this story's
  own Decision) literally true rather than a second, parallel copy path. This mirrors 088's own
  `copyRetailGameData`, which is similarly unused by `job.ts`'s run loop.
- `bootstrap.gameDataSource` was registered the same way every other bootstrap handler is — an
  individual `handle(DOWNLOADS_HANDLERS.x, schema, fn)` call in `index.ts` — there is no generic
  `module:invoke` dispatcher in this codebase to hang it off of.

**Verification.**
- `npm run typecheck` — clean (node + web).
- `npm run build` — clean.
- `npm test` — 3663 passed, 1 skipped (a symlink-copy regression test gated `skipIf` — this sandbox
  lacks symlink privilege on Windows), across 200 files. One unrelated flake seen mid-run
  (`config/file-source-pipeline.test.ts`, an `EBUSY` on a temp file under load) — reran that file
  alone immediately after: 149/149 green; file untouched by this story.
- `npm run ui:flow -- bootstrap-existing-folder` — passed (AC1, AC2, AC3, AC6, AC7).
- `npm run ui:flow -- bootstrap-existing-folder-demo` — passed (AC4, AC5).
- `npm run ui:verify` — full run, 82 screenshots (43/43 screens), 0 axe violations.
- Clean-agent review (`story-review-hard`): verdict **PASS**. Five findings, two fixed in one
  review-fix cycle: **F2** — `includeVideoAndPlayers` was clamped to `false` for an
  `existing-folder` source only in the renderer, not re-enforced server-side, so a scripted caller
  could still pull `baseq2/video`/`players` out of the picked folder; `job.ts`'s `startBootstrap`
  and `buildBootstrapSummary` now clamp it server-side regardless of the renderer's claim. **F3** —
  the pak copy (`assemble.ts`, shared by every role including 088's `'retail'`) used `cp()` without
  `dereference: true`, so a symlinked source file would land at the target as a symlink instead of
  an independent copy, against AC3's "copied (never linked)"; fixed for all roles, with a
  `skipIf`-gated regression test (this Windows sandbox can't create symlinks to prove it directly
  here, but the assertion runs wherever symlink privilege exists). Three findings left as
  documented, deliberately unfixed: **F1** (informational — a folder with a retail-sized `pak0.pak`
  but a missing/wrong-size `pak1.pak` classifies as `demo` per this story's own verdict rule, but
  the finished install's Demo marker is derived from `pak0`'s own validity, not from the verdict —
  outside AC4's scope since AC4 only requires an actually-demo-shaped `pak0` to carry the marker,
  which it does); **F4** (documentation only — fixed separately by correcting the `## Acceptance
  Tests` section above to point AC3/AC7 at the production-path tests in `job.test.ts` rather than
  at `copyGameDataSource`'s standalone tests, which cover the same allowlist discipline as an
  independently tested unit but aren't on the path production calls); **F5** (minor — the
  `GameDataSourceUnusableReasonKey` union/array this story added is currently unused because
  `GameDataSourceVerdict.reason` stayes typed as a plain `string`; a future story tightening main→
  renderer reason-key typing can pick this up, no user-facing effect today since the string values
  used already match real i18n keys).
- AC → test mapping as verified: see the `## Acceptance Tests` section above (updated to match what
  was actually built). No manual residue — every criterion has a passing automated test through the
  real surface (e2e) or unit level.

**Files changed:** `src/shared/modules/downloads.ts`; `src/main/modules/downloads/schemas.ts` +
`schemas.test.ts` (new); `src/main/modules/downloads/bootstrap/errors.ts`, `game-data-source.ts`
(new) + `game-data-source.test.ts` (new), `target.ts`, `assemble.ts`, `job.ts` + `job.test.ts`;
`src/main/modules/downloads/index.ts` + `index.test.ts`; `src/renderer/src/modules/downloads/client.ts`;
`src/renderer/src/modules/downloads/bootstrap/GameDataStep.tsx`, `BootstrapWizard.tsx` +
`BootstrapWizard.test.tsx`, `ConfirmStep.tsx`; `src/renderer/src/i18n/locales/en.json`;
`scripts/lib/fixture.mjs`; `scripts/flows/bootstrap-existing-folder.mjs` (new),
`scripts/flows/bootstrap-existing-folder-demo.mjs` (new); `docs/sprints/S19/progress.md`.
