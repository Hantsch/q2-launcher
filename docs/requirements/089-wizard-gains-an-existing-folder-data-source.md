---
id: 089
title: The wizard gains an existing-folder data source
status: ready
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

- [ ] **AC1** — The wizard's game-data step always offers "point at an existing folder", regardless
      of whether any store installation was detected.
- [ ] **AC2** — Choosing this option lets the user browse to a folder; the wizard then reports what
      it found there (retail data, demo-only data, or nothing usable) before the user can proceed.
- [ ] **AC3** — A folder containing usable retail `pak0.pak`/`pak1.pak` proceeds exactly like
      [[088]]'s detected-store path: those files are copied (never linked) into the new
      installation, and the result carries no Demo marker.
- [ ] **AC4** — A folder containing only demo-equivalent data (no valid retail paks) proceeds as a
      demo installation, carrying the same Demo marker [[074]] introduced for the free-download
      path.
- [ ] **AC5** — A folder containing nothing usable is rejected with a reason before the job starts,
      not partway through.
- [ ] **AC6** — Before the job starts, the confirm step names the chosen folder as the data source,
      what will still be downloaded (the engine) and its size, and the target path.
- [ ] **AC7** — This data source produces `baseq2` only — no `ctf`, `xatrix` or `rogue` directory
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

- AC1 → e2e `scripts/flows/bootstrap-existing-folder.mjs` › "the source step offers the existing
  folder option with no store installation detected" (D4)
- AC2 → e2e `scripts/flows/bootstrap-existing-folder.mjs` › "browsing to a folder reports what was
  found before Next" (D4)
- AC3 → e2e `scripts/flows/bootstrap-existing-folder.mjs` › "a retail folder is copied and carries
  no Demo marker" (D4), plus unit
  `src/main/modules/downloads/bootstrap/game-data-source.test.ts` › "retail paks are classified and
  copied, never linked" (D2)
- AC4 → e2e `scripts/flows/bootstrap-existing-folder-demo.mjs` › "a demo-only folder installs with
  the Demo marker" (D5), plus unit `game-data-source.test.ts` › "a non-retail pak0 classifies as
  demo" (D2)
- AC5 → e2e `scripts/flows/bootstrap-existing-folder-demo.mjs` › "an unusable folder is named as
  such and blocks Next" (D5), plus unit
  `src/main/modules/downloads/bootstrap/job.test.ts` › "an unusable source is refused before the
  installation is registered" (D3)
- AC6 → e2e `scripts/flows/bootstrap-existing-folder.mjs` › "the confirm step names the folder, the
  engine download and the target" (D4/D5)
- AC7 → e2e `scripts/flows/bootstrap-existing-folder.mjs` › "no ctf, xatrix or rogue directory is
  created" (D4), plus unit `game-data-source.test.ts` › "the allowlist copies nothing outside
  baseq2's paks" (D2)

Both flows run through the project's real-surface harness (`npm run ui:flow -- <name>`, the same
Playwright `_electron` harness `npm run ui:verify` uses); no manual residue.
