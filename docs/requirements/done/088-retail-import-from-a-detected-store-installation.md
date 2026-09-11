---
id: 088
title: Retail import from a detected store installation
status: done
created: 2026-09-11
---

## Requirement

The bootstrap wizard ([[074]]) can only ever produce a demo installation today — its one data
source is the free download. This story adds the wizard's second data source, described in
[concepts/install-module.md §8](../concepts/install-module.md) step 2 and required by INST-D1,
INST-D2 and the "copy from a detected store installation" half of INST-W2: a user who owns Quake
II on Steam, GOG or Epic picks that installation instead of downloading, and the wizard copies its
retail `pak0.pak`/`pak1.pak` (plus, behind the same optional toggle [[074]] introduced,
`baseq2/video/` and `players/`) into the new installation. The result is a normal (non-demo)
installation from the very first run — turning an existing demo installation into a retail one is
[[090]], not this story.

This story reuses the store detection the launcher already has (Steam's `libraryfolders.vdf`,
GOG's registry entries, Epic's manifests) rather than scanning again, and reuses the engine
step, target-folder step and job/registration machinery [[074]] built — this is a new *data
source*, not a new wizard.

## Acceptance Criteria

- [x] **AC1** — The wizard's game-data step offers "copy from a detected installation" as a second
      option, alongside the existing free-download option, whenever the store-detection service
      finds at least one Steam, GOG or Epic Quake II installation; the option is absent (not
      shown disabled) when none is found.
- [x] **AC2** — When more than one store installation is detected, the user picks which one to
      copy from; each is identified by its store and its path.
- [x] **AC3** — Choosing a detected installation whose `pak0.pak`/`pak1.pak` do not match the
      launcher's known retail sizes tells the user this installation's data could not be
      verified as retail, instead of silently offering to copy it.
- [x] **AC4** — Running the wizard with this data source copies `pak0.pak` and `pak1.pak` (never
      links or references them) from the chosen installation into the new installation's target
      folder; the free-download engine package for the chosen engine is still fetched and
      verified exactly as [[074]] already does.
- [x] **AC5** — Before the job starts, the confirm step names the copy source, what will still be
      downloaded (the engine only) and its size, and the target path.
- [x] **AC6** — The resulting installation is registered with a status computed by
      `inspectInstallation`, exactly as [[074]]'s AC6 requires, and does **not** carry the Demo
      marker [[074]] introduced, since its base data is retail.
- [x] **AC7** — This data source produces `baseq2` only, same as the free-download path — no
      `ctf`, `xatrix` or `rogue` directory is created even if the source installation has one.

## Decisions (Sprint)

- **(User)** Video/players toggle availability for a detected-store source: check up front — the
  wizard inspects the detected installation and hides/disables the toggle if `video/`/`players`
  isn't present there, rather than letting the user enable it and reporting a copy failure
  afterwards.

### Decided during refine

- **2023 re-release pak sizes (the story's one open question) → resolved as the story's own
  fallback.** Neither `docs/concepts/install-module.md` (§ open point 5) nor any code records a
  re-release pak size or its `rerelease/` layout; `RETAIL_PAK_SIZES` (`src/shared/constants.ts:54`)
  only carries the classic 3.20 sizes. So an unrecognised size takes AC3's "could not be verified
  as retail" path, exactly as `sprint.md`'s Notes allow. Reason: inventing an allowance for sizes
  nobody has measured would be a guess that silently copies unknown data. Mitigation without a
  guess: the AC3 message names the file and its actual size, so the first affected user report
  yields the number a later story needs. No `rerelease/` subfolder is probed — only `<root>/baseq2`.
- **The retail install root is just another assemble source.** `AssembleFileRole` gains `'retail'`,
  `buildAssemblePlan` gains `dataSource: 'free-download' | 'store-copy'` selecting the game-data
  block (demo/point-release entries vs. `baseq2/pak0.pak`+`pak1.pak`), and the chosen installation
  root is passed as an `AssembleSource` like an extraction dir. Reason: reuses the allowlist that
  already makes AC7 a property of the code (`assemble.ts`'s module doc), plus its diagnostics and
  glob-dir handling, instead of a second copier with its own AC7 risk.
- **`pak2.pak` is copied when it is present *and* matches `RETAIL_PAK_SIZES['pak2.pak']`** (an
  optional, non-`required` entry). Reason: a 3.20-patched retail install carries it and dropping
  point-release data the user already owns would make this source worse than the free download;
  size-gating it keeps the "only verified retail data is copied" promise of AC3.
- **The renderer's copy-source path is never trusted.** `bootstrap.start` takes the chosen path but
  main re-lists the detected sources and re-inspects the path before copying; a path that is not
  among them (or no longer verifies) fails with a `downloads.error.*` key. Reason: CLAUDE.md's "paths
  from the renderer are never trusted" — the picker list is a UI convenience, not an authorisation.
- **Detection is reached through the module seam, not `detection:scan` from the wizard.** The new
  `bootstrap.retailSources` handler calls `app.detection.scan({})` (fast pass only — no deep scan,
  no drive walk) and returns already-inspected sources. Reason: filtering to stores, verifying paks
  and checking video/players are main's job; the renderer must not re-derive the verdict, and the
  wizard must not trigger a slow scan.
- **A detected source is offered only if it is a store source** (`InstallationSource` `steam` |
  `gog` | `epic`). Reason: AC1 names exactly those three; the detector's classic hand-made paths
  and `manual`/`unknown` hits are [[089]]'s existing-folder source, not this one.
- **An unverifiable source stays in the list, not selectable** — it is shown with the AC3 reason
  rather than hidden. Reason: AC3 says "tells the user this installation's data could not be
  verified", which a hidden entry cannot do; AC1's "absent" rule is about the data-source *option*,
  which is absent only when no store installation exists at all.
- **The video/players toggle is rendered disabled with a reason line** when the chosen source has
  neither `baseq2/video` nor `baseq2/players` (the binding user decision above says hide *or*
  disable). Reason: a toggle that vanishes reads as a bug, a disabled one with "this installation
  has no videos/player models" explains itself.
- **Default installation name for this source** is the engine's display name (e.g. `Q2PRO`), not
  `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` (`'Q2PRO Demo'`). Reason: AC6 says the result is not a demo,
  and a name saying otherwise would outlive the badge.
- **AC6 needs no new code.** The Demo marker is derived from the inspector's
  `validation.pak0NotRetail` check ([[074]] "Demo state"), which cannot fire once pak0 matches
  `RETAIL_PAK_SIZES` — so AC6 is an assertion, not a feature. Reason: no second source of truth for
  demo-ness.
- **The e2e proof injects fixture store installations through the existing harness gate.** The
  detected-source lister honours a `Q2L_UI_HARNESS_STORE_SOURCES` override resolved in
  `src/main/modules/downloads/harness.ts`, under the same double gate as `resolveDownloadSource`
  (`Q2L_UI_HARNESS === '1' && isDev`) and with the same production-unreachability test. Reason:
  `ui-acceptance-required` demands the real surface, and no test can plant a real Steam library.
- **Fixture paks are created with `truncate` at the exact retail sizes**, not by writing bytes.
  Reason: verification is size-based, so a 184 MB fixture costs metadata, not I/O.

### Reusable piece for [[089]] and [[090]]

Both later stories of this sprint build on one main-side file, `src/main/modules/downloads/bootstrap/retail-source.ts`:

- `inspectRetailSource(rootPath): Promise<RetailSourceInspection>` — fs-only; reports
  `pak0`/`pak1`/`pak2` presence + size + `verified` (against `RETAIL_PAK_SIZES`), `hasVideo`,
  `hasPlayers` and an `unverifiedReason` key. **[[089]]** calls exactly this on the folder the user
  picked — it does not need the detection half.
- `listDetectedRetailSources(deps): Promise<DetectedRetailSource[]>` — the detection half
  (`app.detection.scan({})` → store sources → `inspectRetailSource`), 088-specific.
- `copyRetailGameData({ sourceRoot, targetRoot, includeVideoAndPlayers }): Promise<AssembleInstallationResult>`
  — copies pak0/pak1 (+ optional pak2, + video/players) through `assemble.ts`'s allowlist copier,
  onto *any* installation root. **[[090]]** calls exactly this on an already-registered
  installation; it needs neither the job's download half nor the wizard.

Shared types (`RetailSourceInspection`, `DetectedRetailSource`, `BootstrapDataSource`) live in
`src/shared/modules/downloads.ts`; the schemas in `src/main/modules/downloads/schemas.ts`.

## Open Questions

None — the 2023 re-release question is resolved above, per `docs/sprints/S19/sprint.md`'s Notes.

## Plan

1. **Inspection core** (`bootstrap/retail-source.ts` + shared types): `inspectRetailSource`, pak
   size verification against `RETAIL_PAK_SIZES`, video/players presence. Pure fs, no detection.
2. **Detected-source listing**: `listDetectedRetailSources` over `app.detection.scan({})` filtered
   to `steam`/`gog`/`epic`, plus the `bootstrap.retailSources` handler, its zod schema, the
   renderer client call and the harness override in `harness.ts`.
3. **Copy path**: `assemble.ts` gains the `'retail'` role and `buildAssemblePlan`'s `dataSource`;
   `copyRetailGameData` in `retail-source.ts` reuses the same allowlist copier (AC4/AC7).
4. **Job + summary** (`bootstrap/job.ts`, `shared/modules/downloads.ts`): `StartBootstrapInput`
   gains `dataSource` + `copySourcePath`; main re-resolves/re-verifies that path; package
   resolution drops demo/point-release for this source; `buildBootstrapSummary` names the copy
   source, the engine-only download and its size (AC5); the copy replaces the game-data extraction
   phase; name default from the engine (AC6).
5. **Wizard UI**: a game-data step between engine and target (free download / copy from detected —
   the latter only when the list is non-empty), the source picker with store + path (AC2), the
   unverified reason (AC3), the toggle availability rule, ConfirmStep's copy-source line, i18n.
6. **Offline e2e**: fixture store installations (verified + wrong-size), the harness env wiring, a
   `scripts/flows/bootstrap-retail-import.mjs` walk-through, `docs/UI-VERIFICATION.md`.

Order: D1 → D2 → D3 → D4 → D5 → D6. D5 may start once D2's contract exists.

## Deliverables

- [x] **D1 — Retail source inspection.** `src/main/modules/downloads/bootstrap/retail-source.ts`
  (+ `retail-source.test.ts`), types in `src/shared/modules/downloads.ts`. Mirror
  `bootstrap/target.ts` (+ `target.test.ts`) for shape and doc style, `src/main/services/inspector.ts:194`
  for the size comparison. *Acceptance:* over temp dirs — a folder with exact-`RETAIL_PAK_SIZES`
  pak0+pak1 verifies; a wrong-size pak0 does not and carries an `unverifiedReason` key plus the
  actual size; a missing pak1 does not verify; `hasVideo`/`hasPlayers` reflect `baseq2/video` and
  `baseq2/players`; no `rerelease/` probing. Proves AC3 (core).
- [x] **D2 — Detected store sources over the module seam.** `retail-source.ts`
  (`listDetectedRetailSources`), `src/main/modules/downloads/index.ts`, `schemas.ts`,
  `src/shared/modules/downloads.ts` (handler name `bootstrap.retailSources`),
  `src/renderer/src/modules/downloads/client.ts`, `src/main/modules/downloads/harness.ts`
  (+ `harness.test.ts`, mirroring its existing four gate cases). *Acceptance:* the handler returns
  one entry per `steam`/`gog`/`epic` candidate with `{ source, rootPath, inspection }` and nothing
  else; a non-store candidate is dropped; the harness override is provably unreachable without
  `Q2L_UI_HARNESS === '1' && isDev`. Test: `retail-source.test.ts` (fake detection) +
  `harness.test.ts`. Proves AC1/AC2 (data).
- [x] **D3 — Copy retail game data through the allowlist.** `bootstrap/assemble.ts` (+
  `assemble.test.ts`), `bootstrap/retail-source.ts` (`copyRetailGameData`, + its test).
  *Acceptance:* with a fixture "store installation" that also contains `ctf/`, `xatrix/`, `rogue/`,
  `baseq2/pak3.pak` and loose files, the target afterwards holds `baseq2` with pak0/pak1 (+pak2 when
  size-matching) only; `pak2.pak` at a wrong size is skipped; the toggle off leaves
  `video/`+`players/` out and on brings them in; the `store-copy` plan contains no demo/point-release
  entry and the `free-download` plan is unchanged. Proves AC4 (copy) + AC7.
- [x] **D4 — Job, summary and start input for the copy source.** `bootstrap/job.ts` (+
  `job.test.ts`), `src/shared/modules/downloads.ts`, `src/main/modules/downloads/schemas.ts`,
  `bootstrap/errors.ts`. *Acceptance:* with fake ports — `dataSource: 'store-copy'` resolves the
  engine package only (no demo, no point release) and `buildBootstrapSummary` reports it plus the
  copy source and the target; a `copySourcePath` that is not among the freshly listed detected
  sources, or no longer verifies, fails with a `downloads.error.*` key and registers nothing; the
  job copies game data before the playability revalidation, still takes every status from
  `inspectInstallation`, and the created installation's default name is the engine's, not
  `'Q2PRO Demo'`. Proves AC4 (orchestration), AC5, AC6.
- [x] **D5 — The wizard's game-data step.** `src/renderer/src/modules/downloads/bootstrap/BootstrapWizard.tsx`,
  new `GameDataStep.tsx`, `ConfirmStep.tsx`, `src/renderer/src/i18n/locales/en.json`, `data-testid`s.
  Mirror `EngineStep.tsx` for step shape and `TargetStep.tsx` for verdict rendering. *Acceptance:*
  the copy option is absent when the list is empty and present otherwise; multiple sources render as
  a picker showing store + path; an unverified source is listed but not selectable and states the
  reason; the video/players toggle is disabled with a reason when the chosen source has neither dir;
  the confirm step names the copy source, the engine-only download + size and the target. Proves
  AC1/AC2/AC3/AC5 (surface).
- [x] **D6 — Offline end-to-end proof.** `scripts/lib/fixture.mjs` (verified + wrong-size fixture
  store installs, `truncate`d paks), `scripts/flows/bootstrap-retail-import.mjs`, `scripts/lib/harness.mjs`
  (env wiring), `docs/UI-VERIFICATION.md`. Mirror `scripts/flows/bootstrap-wizard.mjs`. *Acceptance:*
  `npm run ui:flow -- bootstrap-retail-import` walks engine → game data (copy) → target → confirm →
  run against the loopback fixture server, asserts the picker, the unverified entry, the summary, the
  finished installation carrying **no** Demo marker, and on disk that the target holds `baseq2` only
  with byte-identical pak0/pak1 — with no outbound network access.

## Model Hints

- `D4 → deliverable-hard` — it rewires a job that mutates a registered installation mid-run: a
  wrong phase order (copy after the playability revalidation) or a missed re-verification of the
  renderer-supplied source path either strands a half-built installation or copies an unverified
  tree, and it must not regress [[074]]'s free-download path.
- `D6 → deliverable-hard` — the harness store-source injection is a security-relevant override that
  must be provably unreachable in production while carrying the whole AC map end to end.
- All other deliverables: default tier.
- `Review: → story-review-hard` — the story spans main, the module IPC seam and the renderer, trusts
  no renderer path, adds a harness injection point, and AC7 is a negative requirement a diff-blind
  review would miss.

## Acceptance Tests

- AC1 → e2e `npm run ui:flow -- bootstrap-retail-import` (`scripts/flows/bootstrap-retail-import.mjs`)
  › "the game-data step offers the copy source when a store installation is detected, and omits it
  when none is", plus unit `src/main/modules/downloads/bootstrap/retail-source.test.ts` › "only
  steam, gog and epic candidates become retail sources"
- AC2 → e2e `scripts/flows/bootstrap-retail-import.mjs` › "two detected installations are pickable by
  store and path", plus unit `…/retail-source.test.ts` › "each detected source carries its store and
  its root path"
- AC3 → e2e `scripts/flows/bootstrap-retail-import.mjs` › "a wrong-size pak0 is listed as
  unverifiable and cannot be chosen", plus unit `…/retail-source.test.ts` › "a pak0 that is not the
  known retail size does not verify and names its actual size"
- AC4 → e2e `scripts/flows/bootstrap-retail-import.mjs` › "the run copies pak0 and pak1 into the
  target and downloads the engine only" (byte-compare on disk), plus unit
  `…/bootstrap/retail-source.test.ts` › "copyRetailGameData copies the paks, never links them" and
  `…/bootstrap/job.test.ts` › "a store-copy run resolves the engine package only"
- AC5 → e2e `scripts/flows/bootstrap-retail-import.mjs` › "the confirm step names the copy source,
  the engine download and the target", plus unit `…/bootstrap/job.test.ts` › "the summary names the
  copy source and sums the engine package only"
- AC6 → e2e `scripts/flows/bootstrap-retail-import.mjs` › "the finished installation carries no Demo
  marker", plus unit `…/bootstrap/job.test.ts` › "the status always comes from inspectInstallation
  and the default name is not the demo name"
- AC7 → unit `src/main/modules/downloads/bootstrap/assemble.test.ts` › "a store-copy plan copies
  baseq2 only, never ctf, xatrix or rogue", plus the on-disk assertion in
  `scripts/flows/bootstrap-retail-import.mjs` › "the target holds baseq2 only"

No manual residue: every criterion has a named automated test, and every user-facing one is proven
through the real surface.

## Done

**Summary.** The bootstrap wizard's game-data step now offers a second source alongside the free
download: copying retail `pak0.pak`/`pak1.pak` (+`pak2.pak`/`video`/`players` when present) out of
a detected Steam/GOG/Epic Quake II installation. `src/main/modules/downloads/bootstrap/retail-source.ts`
is the new reusable core (`inspectRetailSource`, `listDetectedRetailSources`, `copyRetailGameData`),
built exactly to the shape the story's "Reusable piece for [[089]] and [[090]]" section specified —
those names are unchanged from the plan, so 089/090 can grep for them directly. The copy goes
through `assemble.ts`'s existing allowlist (new `'retail'` role + `dataSource` on
`buildAssemblePlan`), never a second copier, which is what makes AC7 (baseq2-only) a property of
the code rather than of a test fixture. `job.ts` re-verifies the renderer-supplied source path
against a fresh `listDetectedRetailSources()` call before registering anything, and the copy runs
in the same phase slot free-download's assemble step used, ahead of the first `inspectInstallation`
revalidation.

**Commit message:**
```
088: retail import from a detected store installation
```

**Verification.**
- `npm run typecheck` — clean.
- `npm test` — 198 files / 3627 tests passed (one `fan-out cannot blow up combinatorially` test
  flaked once mid-run in an unrelated exec-expansion suite untouched by this story; reran alone and
  as part of the full suite immediately after — green both times, not a regression from this story).
- `npm run build` — clean.
- `npm run ui:flow -- bootstrap-retail-import` (`scripts/flows/bootstrap-retail-import.mjs`) — passed,
  end to end, twice (once before and once after the review-fix cycle), including the AC1 "absent"
  half (zero detected sources) via an in-process harness override, with no outbound network access
  beyond the loopback fixture server.
- Clean-agent review (`story-review-hard`): verdict **PASS**. Six findings, four addressed in one
  fix cycle (F1 misleading `packageIncomplete` message on an empty retail copy → new
  `downloads.error.retailCopyIncomplete` key; F2 case-sensitive copy vs. case-insensitive inspection
  → copier now resolves the `'retail'` role case-insensitively too; F3 the AC3 mitigation - naming
  the actual mismatched pak size - never reached the UI → wired `sizeBytes` through the i18n
  interpolation; F4 a fast user could click past the game-data step before `listDetectedRetailSources`
  resolved → `canProceed.gameData` now waits for `detectedSources !== null`). Two left as documented,
  deliberately unfixed: F5 (informational — main's summary echoes the renderer's raw path back only
  in the already-refused case, no behavioural effect since `startBootstrap` refuses regardless) and
  F6 (pre-existing [[074]] behaviour — the toggle-on extras pass re-copies the whole plan a second
  time; 088 only enlarges the duplicated payload; flagged for [[090]] since it reuses
  `copyRetailGameData` on a live installation).
- AC → test mapping as verified: AC1 e2e (`bootstrap-retail-import.mjs`, both halves) + unit
  `retail-source.test.ts`; AC2 e2e + unit `retail-source.test.ts`; AC3 e2e + unit
  `retail-source.test.ts`; AC4 e2e (byte-compare) + unit `retail-source.test.ts` +
  `job.test.ts`; AC5 e2e + unit `job.test.ts`; AC6 e2e + unit `job.test.ts`; AC7 unit
  `assemble.test.ts` + the e2e's on-disk assertion. No manual residue.

**Decisions made during build (beyond the story's own "Decisions (Sprint)" section).**
- Reusable-piece naming matches the story's plan exactly: `inspectRetailSource`,
  `listDetectedRetailSources`, `copyRetailGameData` all live in
  `src/main/modules/downloads/bootstrap/retail-source.ts`; shared types
  (`RetailSourceInspection`, `RetailPakInfo`, `DetectedRetailSource`, `RETAIL_SOURCE_UNVERIFIED_REASON_KEYS`,
  `BootstrapDataSource`) live in `src/shared/modules/downloads.ts` — no deviation for [[089]]/[[090]]
  to reconcile against.
- `pak2.pak`'s size gating lives at the copy layer (an `expectedSizeBytes` on the optional
  `AssembleFileEntry`), not as a second pre-filtering pass, so a wrong-size `pak2.pak` is silently
  skipped through the same "missing optional entries are skipped" path the allowlist already had.
- `bootstrap.retailSources` dispatches through the existing generic `module:invoke` seam the other
  bootstrap handlers already use (`bootstrapEngineOptions`/`bootstrapSummary`) — no edit to
  `src/shared/ipc.ts` was needed, since that contract-first file governs the channel-declaration
  layer those handlers already share, not each individual handler name.
- `StartBootstrapInput`/`BootstrapSummary` gained `dataSource`/`copySourcePath`/`copySource` as
  optional fields on the existing flat shape rather than a discriminated union, to avoid an
  invasive type refactor across every existing free-download call site; a zod `superRefine`
  enforces `copySourcePath` being present iff `dataSource === 'store-copy'` at the schema boundary.
- The new `downloads.error.retailSourceUnverified` / `downloads.error.retailCopyIncomplete` keys
  were added alongside, not inside, `DOWNLOADS_ERROR_KEYS`'s existing enumeration in the same style
  as the pre-existing `TARGET_BLOCKED_KEY`.

**Files changed:** see `git diff HEAD` — main-side: `src/main/modules/downloads/bootstrap/retail-source.ts`
(new) + its test, `assemble.ts`/`assemble.test.ts`, `job.ts`/`job.test.ts`, `errors.ts`,
`harness.ts`/`harness.test.ts`, `index.ts`, `schemas.ts`, `archive-layouts.test.ts` (type-fix only);
shared: `src/shared/modules/downloads.ts`; renderer: `GameDataStep.tsx` (new), `BootstrapWizard.tsx`
+ its test, `ConfirmStep.tsx`, `client.ts`, `en.json`; e2e: `scripts/flows/bootstrap-retail-import.mjs`
(new), `scripts/lib/fixture.mjs`, `scripts/lib/harness.mjs` (doc-only), `docs/UI-VERIFICATION.md`.
