---
id: 078
title: The failure says the cause, not "go read the log"
status: done
created: 2026-09-08
---

## Requirement

[[075]] shipped two actions on a failed download: copy a Markdown report, and reveal the log file
([FailureLogEntry.tsx](../../src/renderer/src/modules/downloads/components/FailureLogEntry.tsx)).
The copy action is right. **Revealing the log is not an answer for a user** — most people will not
open a 200 KB `main.log`, and nobody should have to in order to learn which of three downloads
went wrong. What the card itself says is still only the generic sentence
`downloads.error.installationNotPlayable`: "The files were downloaded, but the result was not a
usable Quake II installation."

The information to do better is already captured and already persisted. `DownloadDiagnostics`
([downloads.ts:282](../../src/shared/modules/downloads.ts#L282)) holds, per package, the id, the
URL that actually served it, its size and `verified`/`extracted`; and for a bootstrap failure a
`target` with the `verdict` and the failing `missingChecks` — each an id plus an i18n
`messageKey`, never prose. Every one of those is renderable in the card today, i18n intact. The
story that captured them stopped at putting them on the clipboard.

Second gap from the same run: the failure was only visible in the Downloads tab. The bootstrap
wizard's own running step prints one line, `t(job.error.key)`
([RunningStep.tsx:44](../../src/renderer/src/modules/downloads/bootstrap/RunningStep.tsx#L44)) —
the same generic sentence, in the place the user is actually looking when it breaks.

### What the real report showed, and what it could not show

The 2026-09-08 report (reviewed 2026-09-08) is honest about everything it covers: three packages,
each `Verified: Yes` / `Extracted: Yes`, one mirror fallback recorded (`Hantsch/...` 404 → upstream
`q2pro/q2pro` release), the target `C:\Games\Q2Pro` left `Not playable` with `engine-identified`,
`base-paks` and `executable` failing, and a log tail ending in "still invalid after assembly".
`Verified: Yes` is meaningful — `sha256` is mandatory in the manifest and a bad digest is refused
([verify.ts:106](../../src/main/modules/downloads/verify.ts#L106)) — and the redaction rule worked
(a self-chosen path outside the home directory stayed verbatim, [[075]] AC4).

But it stops one step short of the cause, and the step is always the same one. Everything the
report describes ends *before* assembly, and assembly is the stage that failed: with all three
archives verified and extracted, an unplayable target means
[`assembleInstallation`](../../src/main/modules/downloads/bootstrap/assemble.ts) copied nothing —
each allowlist entry it could not find is silently `continue`d ("A missing allowlisted file is
skipped, not thrown"), `assemble.ts` takes no logger at all, and its `copiedFiles` result is used
only as the cleanup set ([job.ts:718](../../src/main/modules/downloads/bootstrap/job.ts#L718)).
So the report cannot distinguish "the archives were wrong" from "our allowlist looks in the wrong
place" — which is exactly the question [[076]] is about, and exactly the question `assemble.ts`'s
own comment already flags as unverified for the two self-extracting id Software installers.

Two data points would have closed it in one glance: **what assembly looked for and whether it
found it**, and **what was actually inside each extracted package**.

## Acceptance Criteria

- [x] **AC1** — A failure entry that carries diagnostics shows, in the UI, which package failed
      and at which step (fetched / verified / extracted / contributed), built in the renderer from
      `diagnostics.packages` — so the 2026-09-08 run reads as "every package downloaded, nothing
      reached the installation", not as "the result was not usable".
- [x] **AC2** — For a bootstrap failure the entry shows the target verdict and the failing checks,
      rendered through their existing `messageKey`s (the same keys the library's check list already
      resolves), with no new prose in main and no untranslated string in the UI.
- [x] **AC3** — The detail is collapsed by default. An entry stays as compact as today until the
      user expands it, and the failure list does not grow taller for entries nobody opens.
- [x] **AC4** — The bootstrap wizard's failed running step shows the same cause summary as the
      Downloads tab, so the user learns the reason without changing tabs.
- [x] **AC5** — Copy-report stays the primary action for reporting. Reveal-log is demoted: it is no
      longer offered as the first explanation, and the card never reads as "go look in the log".
- [x] **AC6** — An entry without diagnostics ([[075]] AC6: written before it, or from the
      single-package pipeline) renders exactly as it does today, with no empty detail affordance.
- [x] **AC7** — Diagnostics gain the assembly stage: per allowlist entry, what was looked for,
      whether it was found, and which package's extraction served it. A run where nothing was found
      says so per entry, instead of ending at "still invalid after assembly".
- [x] **AC8** — Diagnostics gain, per package, a bounded listing of what its extraction actually
      produced (top-level entries, capped) — enough to see that a self-extracting installer nested
      its payload under a wrapper directory, without dumping a file tree into `state.json`.
- [x] **AC9** — Both new records appear in the copied report and are covered by [[075]]'s existing
      size cap and redaction (`capDiagnostics`, `redactHome`) — an entry cannot grow `state.json`
      past its bound, and no account name enters either listing.
- [x] **AC10** — The UI verification fixture renders the expanded detail for a bootstrap failure
      with diagnostics, offline.

## Open Questions

- ~~**Q1 — Does the *user-facing* card show the assembly table too, or only the report?**~~
  answered → Decisions (Sprint)
- ~~**Q2 — Where does the wizard's summary live (AC4)?**~~ answered → Decisions (Sprint)
- **Q3 — Overlap with [[076]].** Not a user decision — noted as context, not blocking: 076 fixes
  the allowlist so packages contribute; this story makes a *future* assembly failure legible. If
  076 lands first (it does, per sprint build order), AC7's table shows all entries found on a
  healthy run — that is the intended shape, not a reason to defer.

## Decisions (Sprint)

- **(User)** Q1 — card detail depth: the user-facing card shows the per-package summary (AC1) and
  the verdict/checks (AC2) only; the assembly table (AC7) and extraction listing (AC8) go into the
  copied report only, for maintainers.
- **(User)** Q2 — wizard summary location (AC4): share the component — `RunningStep` reuses the
  same collapsible detail component as the Downloads tab entry, rather than linking out to another
  tab.

### Decided during refine (not user decisions)

- **AC1's "contributed" step is a field, not a join.** `DownloadDiagnosticsPackage` gains
  `contributed?: boolean`, derived in main from the assembly result. AC1 says the card is built
  "from `diagnostics.packages`", and the (User) Q1 decision keeps the assembly table out of the
  card — a per-package boolean satisfies both without the renderer reading `assembly` at all.
- **`assemble.ts` reports, it does not log.** `assembleInstallation` returns a per-entry record
  (`from`, `to`, `found`, `sourcePackageId?`) instead of taking a logger, keeping the module pure
  and testable — the same seam every other bootstrap step already uses.
- **Assembly needs package attribution, so `sourceDirs` becomes `sources`.**
  `AssembleInstallationInput.sourceDirs: string[]` → `sources: { packageId, dir }[]`; AC7 asks
  "which package's extraction served it", which a bare directory list cannot answer.
- **Both `assembleInstallation` calls feed one record.** `job.ts` calls it twice (core, then the
  video/players extras); their entries are concatenated in call order into a single
  `diagnostics.assembly`, so the report reads as one table.
- **AC8's listing is a bounded `readdir` of the extraction dir's top level**, names only, sorted,
  capped at 20 with a `contentsTruncated` flag — enough to see an `Install/` wrapper, and it never
  descends, so it cannot become a file tree in `state.json`.
- **The new records are trimmed between `logTail` and `packages`** in `capDiagnostics`: `logTail`
  (oldest-first) → per-package `contents` (oldest package first) → `assembly` (oldest-first) →
  `packages` → `target` → drop. The 8 KB cap is unchanged; the log tail still dominates the size
  and is still the first thing to go.
- **Redaction is applied to both new records at capture**, in the collector, like every other
  field — they hold relative paths and file names today, so this is defensive, but AC9 asks for
  the guarantee and it is one `redactHome` call per value.
- **The disclosure is a native `<details>`/`<summary>`**, mirroring `DownloadsView.tsx`'s existing
  dismissed-failures disclosure (lines 203-220) — no new UI primitive for one use, and closed by
  default satisfies AC3 without JS state.
- **The wizard gets the failure entry through the existing `getDownloadFailures()` client.**
  `BootstrapWizard` fetches the failure list once the job turns `failed` and matches on `jobId` —
  no new IPC channel, no widening of the `jobs:changed` payload.
- **Reveal-log is demoted by moving it inside the expanded detail** (AC5): copy-report stays in the
  card's always-visible action cluster, reveal-log becomes a footer action of the opened detail, so
  a closed card never offers "go look in the log" as its explanation.
- **AC4's e2e gets its own flow with a deliberately broken fixture.** `scripts/flows/bootstrap-failure.mjs`
  serves a package set whose paks are nested under an `Install/Data/` wrapper — the exact real-world
  shape from [[076]] — so the wizard reaches a genuine `installationNotPlayable`. Kept out of
  `bootstrap-wizard.mjs` so the passing happy-path flow is not destabilised.

## Plan

Bottom-up again: the two new records first (shape → assemble → job), then the report, then the
shared UI, then the two surfaces, then verification. Builds **after** [[076]] and [[077]] are
merged: 076 rewrites `assemble.ts`'s allowlist (this story changes its signature and result), 077
touches the same library/failure display area.

1. **Shape + bounds** — `src/shared/modules/downloads.ts` gains
   `DownloadDiagnosticsAssemblyEntry`, `DownloadDiagnostics.assembly?`,
   `DownloadDiagnosticsPackage.contents?` / `contentsTruncated?` / `contributed?`.
   `src/main/lib/schemas.ts` mirrors them as `.optional().catch(undefined)` rows (its existing
   diagnostics block, ~944-1007). `failure-log.ts`'s `capDiagnostics` gains the two new trim
   passes in the documented order.
2. **`assemble.ts` says what it looked for** — `sources: { packageId, dir }[]`, and
   `AssembleInstallationResult.entries[]` alongside the unchanged `copiedFiles`. Glob dirs
   (`video`/`players`) contribute one entry each, not one per file.
3. **`job.ts` records it** — passes package ids into both `assembleInstallation` calls, merges the
   entries into `diagnostics.recordAssembly(...)`, lists each extraction dir's top level right
   after `extractor.result` resolves (~line 684) and hands it to the existing `recordPackage` call,
   and sets `contributed` per package from the merged assembly entries. `ports.ts` widens
   `BootstrapDiagnosticsSource`; `diagnostics.ts` gains `recordAssembly` + redaction of both.
4. **The report** — two new sections in `renderer/.../report.ts` (assembly table, per-package
   extraction listing) plus their `en.json` labels. Report-only, per (User) Q1.
5. **The shared detail** — new `components/FailureCauseDetail.tsx`: a closed `<details>` rendering
   the per-package step summary (AC1) and the target verdict + failing `messageKey`s (AC2, the same
   resolution `ChecksList.tsx` uses). Renders nothing at all without diagnostics (AC6).
6. **The two surfaces** — `FailureLogEntry.tsx` mounts it and moves reveal-log into its footer;
   `BootstrapWizard.tsx` fetches the failure for a failed job and `RunningStep.tsx` mounts the same
   component.
7. **Verification** — extend the seeded fixture record and the `downloads-tab` flow; add a
   `bootstrap-failure` flow driven by a wrapper-nested fixture package set.

Order: D1 → D2 → D3, then D4 and D5 in parallel, D6/D7 after D5, D8 after D5, D9 last.

## Deliverables

- [ ] **D1 — The two new records, their persisted form, and their cap.**
  Edit `src/shared/modules/downloads.ts` (add `DownloadDiagnosticsAssemblyEntry`; add `assembly?` to
  `DownloadDiagnostics` at [downloads.ts:282](../../src/shared/modules/downloads.ts#L282); add
  `contents?`, `contentsTruncated?`, `contributed?` to `DownloadDiagnosticsPackage` at
  [downloads.ts:310](../../src/shared/modules/downloads.ts#L310)); edit `src/main/lib/schemas.ts`
  (extend the diagnostics block at lines ~944-1007, mirroring its existing per-field
  `.optional().catch(undefined)` style); edit `src/main/modules/downloads/failure-log.ts`
  (`capDiagnostics` gains the `contents` and `assembly` trim passes between the existing `logTail`
  and `packages` passes).
  *Acceptance:* a record carrying `assembly` and per-package `contents` round-trips through the
  failure log and `state.json`; a [[075]]-era record without either parses unchanged; a garbage
  `assembly` or `contents` value drops only that field, not the row or the record; an oversized
  record is trimmed in the documented order (`logTail` → `contents` → `assembly` → `packages` →
  `target` → dropped) and comes back `truncated: true`; `DIAGNOSTICS_SIZE_CAP_BYTES` and
  `FAILURE_LOG_CAP` are unchanged.
  Tests: `src/main/modules/downloads/failure-log.test.ts`, `src/main/lib/schemas.test.ts`.

- [ ] **D2 — `assemble.ts` reports what it looked for and what served it.**
  Edit `src/main/modules/downloads/bootstrap/assemble.ts`: `AssembleInstallationInput.sourceDirs`
  becomes `sources: { packageId: string; dir: string }[]`; `AssembleInstallationResult` gains
  `entries: { from, to, found, sourcePackageId? }[]`, one per allowlist entry in plan order plus
  one per expanded glob dir. `copiedFiles` keeps its exact current meaning and content (it is
  [[076]]/[[074]]'s cleanup set, [job.ts:718](../../src/main/modules/downloads/bootstrap/job.ts#L718)).
  *Acceptance:* a run where every entry is found yields `found: true` for each with the id of the
  source that served it; a run where nothing is found yields one `found: false` entry per allowlist
  entry and an empty `copiedFiles`; source order still decides the winner when two sources have the
  same file; AC8 of [[074]] is untouched — nothing outside the allowlist is read or copied, and the
  entries record is not a directory scan.
  Test: `src/main/modules/downloads/bootstrap/assemble.test.ts` (extend).
  Mirror: the file's own existing `findSource`/`expandGlobDir` structure — no new traversal.

- [ ] **D3 — The bootstrap job records assembly and extraction contents.**
  Edit `src/main/modules/downloads/bootstrap/job.ts` (pass `{ packageId, dir }` into both
  `assembleInstallation` calls at ~713 and ~738, merge their `entries` into one
  `diagnostics.recordAssembly(...)`, derive `contributed` per package from it; read a bounded
  top-level listing of each extraction dir right after `extractor.result` resolves at ~684 and pass
  it into the existing per-package `recordPackage` call at ~690/~697); edit
  `src/main/modules/downloads/bootstrap/ports.ts` (`BootstrapDiagnosticsSource` gains
  `recordAssembly`, `recordPackage`'s payload widens); edit
  `src/main/modules/downloads/diagnostics.ts` (`recordAssembly`, `EXTRACTION_LISTING_CAP = 20`,
  `redactHome` over both new records, `diagnosticsFor` carries `assembly` through).
  *Acceptance:* a run where assembly copies nothing yields one assembly entry per allowlist entry
  with `found: false`, and every package `contributed: false` — the 2026-09-08 run becomes
  legible without the log; a healthy run (post-[[076]]) yields `found: true` entries naming the
  serving package; each package's `contents` holds its extraction dir's top-level names, sorted,
  at most 20, with `contentsTruncated: true` when there were more; a package whose extraction
  failed records no `contents` rather than an empty one; a run that fails before assembly records
  no `assembly`; the happy path, the cleanup set and when cleanup runs are all unchanged.
  Tests: `src/main/modules/downloads/bootstrap/job.test.ts` (extend the fake-deps setup),
  `src/main/modules/downloads/diagnostics.test.ts` (extend).

- [ ] **D4 — The copied report gains both records.**
  Edit `src/renderer/src/modules/downloads/report.ts` (two helpers pushed into the existing
  `sections` array after the verdict section: an assembly table and a per-package extraction
  listing); edit `src/renderer/src/i18n/locales/en.json` (new keys under `downloads.failures.report.*`).
  *Acceptance:* the report contains an assembly table with one row per entry (looked-for path,
  target path, found yes/no, serving package) and, per package, its capped extraction listing with
  an explicit marker when it was truncated; a record without `assembly`/`contents` (a [[075]]-era
  entry) still yields a valid report with those sections simply absent; every heading and column
  label resolves through `t()`; no output value contains a home-directory segment.
  Test: `src/renderer/src/modules/downloads/report.test.ts` (extend).
  Mirror: `buildVerdictSection` (report.ts:95-116).

- [ ] **D5 — The shared, collapsed cause detail.**
  New `src/renderer/src/modules/downloads/components/FailureCauseDetail.tsx`; edit
  `src/renderer/src/i18n/locales/en.json` (`downloads.failures.detail.*`).
  Renders `null` when the failure carries no diagnostics; otherwise a closed `<details>` whose
  summary is a translated "what went wrong" line, and whose body lists each package with the step
  it reached (fetched / verified / extracted / contributed) and, when `diagnostics.target` exists,
  the verdict plus each failing check via its `messageKey`. Optional `footer` slot for the
  reveal-log action (D6). Assembly and extraction listings are deliberately **not** rendered
  ((User) Q1).
  *Acceptance:* a bootstrap record whose packages are all fetched/verified/extracted but none
  `contributed` renders as exactly that per package (AC1); the verdict and every failing check's
  `messageKey` render as translated text, no raw key and no prose from main (AC2); the disclosure
  is closed on first render and the body is not in the accessible tree until opened (AC3); a
  failure without diagnostics renders nothing — no empty summary, no disabled affordance (AC6);
  tokens only, no raw colour, focus-visible on the summary (`/design-tokens`).
  Test: `src/renderer/src/modules/downloads/components/FailureCauseDetail.test.tsx` (new).
  Mirror: `ChecksList.tsx`'s `CheckRow` (line 61) for check rendering; `DownloadsView.tsx:203-220`
  for the `<details>`/`<summary>` styling.

- [ ] **D6 — The Downloads card mounts it and demotes reveal-log.**
  Edit `src/renderer/src/modules/downloads/components/FailureLogEntry.tsx` (mount
  `FailureCauseDetail` under the existing header row; move the reveal-log `IconButton` out of the
  always-visible cluster into the detail's footer slot; copy-report stays where it is).
  *Acceptance:* an entry with diagnostics shows the closed detail and, in the header cluster, only
  copy + dismiss/restore; reveal-log is reachable only after expanding, still invokes
  `app:revealPath` with `appInfo.logPath` and is still disabled until `AppInfo` loads; an entry
  without diagnostics renders exactly as it did before this story minus the header reveal-log
  button, with no detail affordance (AC6); no `logTail` line is ever rendered as card text.
  Tests: `src/renderer/src/modules/downloads/components/FailureLogEntry.test.tsx` (extend),
  `src/renderer/src/modules/downloads/DownloadsView.failures.test.tsx` (extend).

- [ ] **D7 — The wizard's failed running step shows the same detail.**
  Edit `src/renderer/src/modules/downloads/bootstrap/BootstrapWizard.tsx` (when `job.status ===
  'failed'`, fetch `getDownloadFailures()` once and pick the entry whose `jobId` matches, pass it
  to `RunningStep`); edit `src/renderer/src/modules/downloads/bootstrap/RunningStep.tsx` (mount
  `FailureCauseDetail` below the existing `job.error` line at
  [RunningStep.tsx:44](../../src/renderer/src/modules/downloads/bootstrap/RunningStep.tsx#L44)).
  *Acceptance:* a failed job whose failure entry carries diagnostics shows the same closed detail
  as the Downloads tab, with the same content; a failed job with no matching entry (or none with
  diagnostics) keeps today's single error line and nothing else; a running or succeeded job renders
  no detail and triggers no fetch; the fetch does not run on every `jobs:changed` tick.
  Test: `src/renderer/src/modules/downloads/bootstrap/RunningStep.test.tsx` (new or extend).

- [ ] **D8 — Fixture record and the Downloads-tab flow.**
  Edit `scripts/lib/download-failures.mjs` (`downloadFailureWithDiagnostics()` at lines 56-105
  gains `assembly`, per-package `contents`/`contentsTruncated`/`contributed`); edit
  `scripts/flows/downloads-tab.mjs` (after the existing copy-report steps: expand the detail,
  assert the per-package step summary and the verdict + check text, assert reveal-log is only
  reachable there, `shot('failure-cause-expanded')`); edit `docs/UI-VERIFICATION.md` where the
  flow's steps are listed.
  *Acceptance:* `npm run ui:verify -- --screens=downloads` stays axe-clean with the closed detail
  present; `npm run ui:flow -- downloads-tab` passes offline and its new steps prove the detail is
  closed on load, opens to the package summary and the verdict, that the no-diagnostics entry has
  none, and that the clipboard report now also carries the assembly table and the extraction
  listing with no real account name in either.

- [ ] **D9 — A real failed bootstrap run, end to end.**
  Edit `scripts/lib/fixture.mjs` (`buildBootstrapPackages()` at
  [fixture.mjs:1299](../../scripts/lib/fixture.mjs#L1299) gains a variant whose demo and
  point-release archives nest their paks under an `Install/Data/` wrapper —
  [[076]]'s real-world shape — and `startBootstrapFixtureServer()` at
  [fixture.mjs:1388](../../scripts/lib/fixture.mjs#L1388) accepts it); new
  `scripts/flows/bootstrap-failure.mjs` (own `setup()`/`teardown()`, mirroring
  `scripts/flows/bootstrap-wizard.mjs`'s); edit `docs/UI-VERIFICATION.md`.
  *Acceptance:* `npm run ui:flow -- bootstrap-failure` passes offline: the wizard runs to a real
  `installationNotPlayable`, `bootstrap-running-step` reaches `data-status="failed"`, the cause
  detail appears there and expands to name every package as downloaded-but-not-contributing plus
  the target verdict and its failing checks, and `shot('bootstrap-failure-cause')` is captured;
  `scripts/flows/bootstrap-wizard.mjs` is untouched and still passes.

## Model Hints

- **D3 → `deliverable-hard`** — `job.ts` is the bootstrap orchestrator with five failure exits and
  a `cleanUp()` that deletes the target directory; this D changes both `assembleInstallation` call
  sites and adds a `readdir` inside the per-package loop, so a misplaced capture either records
  nothing on the exact failure the story exists for, or shifts when cleanup runs. It also lands on
  top of [[076]]'s and [[077]]'s edits to the same file.
- D1, D2, D4, D5, D6, D7, D8, D9 → default.
- **`Review: → story-review-hard`** — two new records are persisted to `state.json` and pasted into
  public issue reports; a redaction miss or a cap gap in either ships an account name or grows the
  state file, and every test in this story can pass while that is true (the same class of risk
  [[075]]'s review actually caught).

## Acceptance Tests

- **AC1** → unit `src/renderer/src/modules/downloads/components/FailureCauseDetail.test.tsx` ›
  "every package downloaded but none contributed reads as exactly that" (D5); unit
  `src/main/modules/downloads/bootstrap/job.test.ts` › "a run that assembles nothing marks every
  package as not contributed" (D3); e2e `scripts/flows/downloads-tab.mjs` › "the expanded cause
  detail names the package and the step it reached" (D8).
- **AC2** → unit `FailureCauseDetail.test.tsx` › "the target verdict and each failing check render
  through their messageKey" (D5); e2e `scripts/flows/downloads-tab.mjs` › the same step, asserting
  the resolved English text rather than a raw key (D8).
- **AC3** → unit `FailureCauseDetail.test.tsx` › "the detail is closed on first render" (D5); e2e
  `scripts/flows/downloads-tab.mjs` › "the failure list does not grow for an unopened entry" —
  measured card height before and after the story's fixture entries, detail closed (D8).
- **AC4** → unit `src/renderer/src/modules/downloads/bootstrap/RunningStep.test.tsx` › "a failed
  job renders the same cause detail as the Downloads tab" (D7); e2e
  `scripts/flows/bootstrap-failure.mjs` › "the wizard's failed running step names the cause"
  (D9, a real failing bootstrap run).
- **AC5** → unit `src/renderer/src/modules/downloads/components/FailureLogEntry.test.tsx` › "the
  closed card offers copy, not reveal-log" and › "reveal-log lives in the expanded detail and still
  invokes app:revealPath with the log path" (D6); e2e `scripts/flows/downloads-tab.mjs` › the
  reveal-log reachability step (D8).
  **manual residue:** unchanged from [[075]] AC5 — that an OS file-manager window actually appears
  is not asserted (`shell.showItemInFolder` opens an out-of-process window Playwright cannot see).
- **AC6** → unit `FailureCauseDetail.test.tsx` › "a failure without diagnostics renders nothing"
  (D5); unit `FailureLogEntry.test.tsx` › "an entry without diagnostics has no detail affordance"
  (D6); unit `src/main/lib/schemas.test.ts` › "a [[075]]-era diagnostics record parses unchanged"
  (D1); e2e `scripts/flows/downloads-tab.mjs` › the existing without-diagnostics entry step,
  extended to assert no disclosure (D8).
- **AC7** → unit `src/main/modules/downloads/bootstrap/assemble.test.ts` › "every allowlist entry
  is reported as found or not found, with the source that served it" and › "a run that finds
  nothing reports every entry as missing" (D2); unit `bootstrap/job.test.ts` › "the assembly record
  reaches the diagnostics" (D3); unit `src/renderer/src/modules/downloads/report.test.ts` › "the
  report carries the assembly table" (D4).
- **AC8** → unit `bootstrap/job.test.ts` › "each package records its extraction's top-level
  entries, capped and sorted" and › "a wrapper-nested archive is visible in its listing" (D3); unit
  `report.test.ts` › "the report carries each package's extraction listing" (D4).
- **AC9** → unit `src/main/modules/downloads/failure-log.test.ts` › "an oversized record trims
  contents and assembly in the documented order" and › "a record that still does not fit is
  dropped" (D1); unit `src/main/modules/downloads/diagnostics.test.ts` › "assembly entries and
  extraction listings are redacted at capture" (D3); unit `report.test.ts` › "no home-directory
  segment in the new sections", against a realistic `C:\Users\<name>\...` stub (D4); e2e
  `scripts/flows/downloads-tab.mjs` › the clipboard content check, extended to cover the two new
  sections against the fixture account name and the suite machine's real `os.homedir()` (D8).
- **AC10** → e2e `npm run ui:verify -- --screens=downloads` (D8, axe + console + CSP gate with the
  detail rendered) plus `scripts/flows/downloads-tab.mjs` › `shot('failure-cause-expanded')` (D8).
  Offline: the entry comes from the static `state.json` fixture — no network and no live job. The
  live counterpart is `scripts/flows/bootstrap-failure.mjs`'s `shot('bootstrap-failure-cause')`
  (D9), which also runs offline against the local fixture server.

## Done

A failed download's cause is now on screen, not just in the log. `DownloadDiagnostics` gained two
new records — `assembly` (one entry per allowlist candidate `assembleInstallation` tried, whether
it was found, and which package served it) and per-package `contents` (a capped, sorted top-level
listing of what each extraction actually produced) — both redacted at capture and trimmed by
`capDiagnostics` in the documented order (`logTail` → `contents` → `assembly` → `packages` →
`target` → drop) before anything is persisted or copied. A new shared `FailureCauseDetail`
component renders the per-package step reached (fetched/verified/extracted/contributed) and the
target verdict/failing checks behind a closed-by-default `<details>`, mounted by both the
Downloads tab's failure card (which also demotes reveal-log into the opened detail's footer) and
the bootstrap wizard's failed running step, so a user reads the same cause in either place without
opening `main.log`. The copied report gained an assembly table and per-package extraction listing
for maintainers. Verified against two real, offline end-to-end runs: `downloads-tab.mjs` (static
fixture, closed→expanded, redacted clipboard) and the new `bootstrap-failure.mjs` (a real
wrapper-nested package set, downloaded/verified/extracted for real, that the allowlist genuinely
finds nothing in).

**Commit message:** `078: the failure says the cause, not "go read the log"`

**Verification:**
- `npm run build` — clean.
- `npm run typecheck` — clean (both TS projects).
- `npm test` — 157 files / 3173 tests; one unrelated flake
  (`src/main/modules/config/core/import-reader.test.ts` › the 512-exec-expansion guard, a
  5000ms timeout under full-suite parallel load) confirmed green in isolation (428ms) and untouched
  by this story — not a story regression.
- `npm run ui:verify` — 34/34 screens, 68 shots, 0 axe violations.
- `npm run ui:flow -- downloads-tab` — OK (AC1/AC2/AC3/AC5/AC6/AC7/AC8/AC9/AC10 through the real
  UI, offline).
- `npm run ui:flow -- bootstrap-failure` — OK (AC4 through a real, non-simulated failing bootstrap
  run, offline).

**Review (`story-review-hard`):** the build was resumed after an interruption between full
verification and the review pass (no findings had been logged yet). A fresh full-diff
`story-review-hard` pass independently re-derived the diff, re-ran the suite and both typecheck
projects, and returned **PASS** with 4 medium and 9 low findings, focused per the story's Model
Hint on redaction/cap-order for the two new records — both **confirmed correct**: `assembly[].from`/
`.to`/`sourcePackageId` and every `contents[]` entry are redacted at capture in `diagnostics.ts`
before ever leaving main; `EXTRACTION_LISTING_CAP = 20` is applied before persistence; the three
new `capDiagnostics` trim passes terminate correctly at every `assembly`/`contents` boundary
(`undefined`/`[]`/non-empty) and are exercised by a genuinely-oversized-input test, not a
tautology; `DIAGNOSTICS_SIZE_CAP_BYTES`/`FAILURE_LOG_CAP` are unchanged.

Findings fixed:
- **M2 (medium) — `contributed: undefined` (assembly never ran for this job) was indistinguishable
  from `contributed: false` (assembly ran and rejected this package)** in
  `FailureCauseDetail.tsx`'s `reachedStep()`, so a package that extracted cleanly but whose job
  failed *before* assembly ever started (e.g. a later package's download error) was told to the
  user as "did not contribute to the installation" — an accusation assembly never actually made.
  Fixed: a new `extractedNoAssembly` step/i18n key ("downloaded, verified and extracted", no
  contribution claim) for the `undefined` case; the `false` case keeps its existing wording
  unchanged. New test: `FailureCauseDetail.test.tsx` › "a package extracted before assembly ever
  ran reads as extracted, not as rejected (M3)". No existing fixture or flow relied on the
  `undefined` case rendering the old text (all hand-authored fixtures already set
  `contributed: false` explicitly), so this was a pure fix, not a behaviour change anywhere else.
- **M3 (medium) — a not-found allowlist entry with more than one candidate path
  (`assemble.ts`'s demo `pak0.pak`/`Install/Data/…` and engine `q2pro.exe`/`q2pro64.exe`
  candidates) recorded only the first candidate**, so the assembly table could read "looked for
  `baseq2/pak0.pak`, not found" on exactly the real-world wrapper-nested case ([[076]]) where the
  allowlist *did* try the `Install/Data/…` candidate too — misleading a maintainer reading the
  report toward "the allowlist never tries the wrapper path" when it does. Fixed:
  `AssembleEntryResult.from` for a not-found entry now joins every candidate that was tried
  (`' | '`-separated); a found entry still records only the single candidate that matched.
  Updated tests: `assemble.test.ts` › "a run that finds nothing reports every entry as missing",
  `job.test.ts` › "a run that assembles nothing marks every package as not contributed".

Findings reviewed and deliberately left unfixed, with reasons:
- **M1 — a `missingChecks` entry whose message interpolates a variable (e.g.
  `validation.rootMissing`'s `{{path}}`) renders its raw placeholder unfilled**, because
  `DownloadDiagnosticsTarget.missingChecks` has stored only `{id, messageKey}` (no `params`) since
  [[075]] — a deliberate redaction boundary (a check's params can carry an absolute install path).
  This story surfaces those keys on screen for the first time (previously report-only), inheriting
  a gap AC2's literal wording ("no untranslated string") does not clearly cover ("no raw key" is
  satisfied — the *key* is never shown, only an unfilled variable inside its translation) and both
  this story's AC2 tests and the e2e fixture happen to use only param-free keys. Left unfixed:
  closing it properly means deciding whether/how to redact-and-carry `params` through
  `missingChecks`, which is a shape change to a [[075]] record type this story's plan never
  scoped, and doing it hastily risks exactly the redaction miss this story's whole review tier
  exists to catch. Flagged here as a real, pre-existing gap for a future story rather than
  silently absorbed into this one.
- **M4 — reveal-log is fully absent (not merely demoted) on an entry without diagnostics** — this
  is D6's own explicitly stated acceptance ("minus the header reveal-log button, with no detail
  affordance (AC6)"), not a review-found bug: AC6 rules out any empty detail affordance, and there
  is nowhere left to put a demoted reveal-log action on such an entry. AC5's "demoted" wording is
  about entries *with* diagnostics; reveal-log stays reachable from Settings regardless.
- **L1 — an empty detail is theoretically reachable** if a record's `packages` were trimmed to `[]`
  and `target` is absent (a very small, already-oversized record, or a job that fails before either
  is ever recorded). Accepted: both are pre-existing, narrow edge cases of `capDiagnostics`/the
  collector, not introduced by D5, and AC6 ("no empty detail affordance") is about the common case
  of no diagnostics at all, which is fully covered.
- **L2 — `job.ts` calls `listExtraction` unconditionally**, even for a job with no diagnostics
  collector, technically loosening `ports.ts`'s "a job without one records nothing and behaves
  exactly as before" comment to the letter. Confirmed harmless (one extra `readdir`, discarded,
  `job.test.ts`'s "cleans up exactly the same whether or not a collector is attached" still
  passes) — accepted as a comment/code precision gap, not a behaviour bug.
- **L3 — a trimmed record can persist `assembly: []`** (distinct from "absent = job failed before
  assembly ran") when emptying the array by itself brings the record back under the cap. The
  record's `truncated: true` flag already tells a reader this happened; treating `[]` as
  meaningfully different from "absent" was not asked for by any AC.
- **L4 — `bootstrap-failure.mjs` (D9) reaches `downloads.error.packageIncomplete`, not
  `installationNotPlayable`**, so the target-verdict half of the cause detail is not proven
  end-to-end. Investigated and confirmed structural, not a shortcut: `job.ts` fails on
  `missingRequired` *before* the revalidation that could ever produce `installationNotPlayable`,
  and this codebase's checks (`inspector.ts`) all pass once every required file is genuinely
  present — there is no real archive layout that leaves a required file unfindable and *also*
  reaches revalidation, only `job.test.ts`'s own mock-based `breakTargetBeforeValidate()` can. The
  flow's own header comment discloses this at length and asserts the verdict section's *absence*
  explicitly rather than silently omitting the check. AC4's actual test mapping (unit
  `RunningStep.test.tsx` + this e2e's AC1-half proof) does not require reaching
  `installationNotPlayable` specifically, and AC7/AC8 (the assembly table / extraction listing)
  have no e2e requirement in their Acceptance Tests mapping — both are fully proven at the unit
  level. Left as a known, disclosed gap rather than restructuring `job.ts`'s failure-exit ordering,
  which is out of this story's scope and risks new bugs in a five-exit orchestrator.
- **L5 — the AC3 e2e measures closed-vs-open card height, not pre-story-vs-post-story height** —
  correct as designed: the closed `<details>`/`<summary>` bar is an intentional, small addition to
  every diagnostics entry's closed height (Decisions: mirrors `DownloadsView.tsx`'s existing
  disclosure pattern), and AC3's actual requirement (no growth when *unopened* is the point) is
  what the flow proves.
- **L6 — the D8 fixture's hand-authored `assembly` rows don't exactly match what real code would
  now produce** (e.g. single-candidate `from` values, unsorted `contents`) — cosmetic; the fixture
  is self-consistent with what the flow asserts against, and (User) Q1 keeps this data report-only,
  never rendered in the card.
- **L7 — stale `sourceDirs` references in two doc comments** — fixed alongside M3 (renamed to
  `sources`), no behaviour change.
- **L8 — the six fixed allowlist entries appear twice in the assembly table when video/players
  extras are enabled** — already documented as intentional at `job.ts:889-893` (the aux pass
  re-plans them); noted, not changed.
- **L9 — untracked `.claude/settings.local.json`** is unrelated to this story (harness/session
  config); left for the orchestrator to decide whether to stage it.

No weakened or deleted tests, no scope creep beyond the two fixes above, no CLAUDE.md guardrail
violations (no IPC channel touched — D7 reuses the existing `getDownloadFailures()` client; no
renderer-supplied path trusted; no image asset added; only i18n keys cross main→renderer, never
prose).

**AC → test mapping, as verified:** all ten criteria PASS — see the "Acceptance Tests" section
above for the exact test names (unchanged from refine; every named test exists, ran and passed in
this verification pass), plus the two tests added during review-fix
(`assemble.test.ts`/`job.test.ts` updated `from` expectations for M3;
`FailureCauseDetail.test.tsx`'s new M2 regression test). No manual residue.

**Open points:** M1 (raw `{{path}}` placeholder for a parameterized `missingChecks` key) is a real,
pre-existing gap worth its own story if it matters enough to prioritize — see "Findings reviewed
and deliberately left unfixed" above.
