---
id: 075
title: A failed download tells me enough to report it
status: done
created: 2026-09-08
---

## Requirement

[[073]] gave a failed job a persistent, i18n'd entry in the Downloads tab. That entry says
*what* the launcher concluded ("The files were downloaded, but the result was not a usable
Quake II installation.") but nothing about *why* — and a user who wants to post the problem in
the community or open a GitHub issue has nothing to paste.

This is not hypothetical. On 2026-09-08 a real bootstrap run failed exactly this way. All three
packages downloaded and verified fine; the reason (one package's extraction produced no usable
game data) existed only as a single line in `%APPDATA%\Q2 Launcher\logs\main.log`, written by
[job.ts:698](../../src/main/modules/downloads/bootstrap/job.ts#L698). The failure card in the UI
could not show it, because `DownloadFailure.error` is deliberately restricted to
`DOWNLOADS_ERROR_KEYS` ([downloads.ts:250](../../src/shared/modules/downloads.ts#L250)) — main
must never send prose across IPC. The log path is revealable, but only from a `KeyValue` row
buried in Settings ([SettingsView.tsx:185](../../src/renderer/src/views/SettingsView.tsx#L185)),
which nobody finds while looking at a red card in a different tab.

So: a failed download must carry enough **machine-readable** diagnostic data with it that the
user can hand a complete, useful report to someone else in one click, without reading a 200 KB
log and without the launcher inventing untranslatable sentences.

The distinction that keeps this inside the house rules: the i18n key stays the only *prose*
main produces. Diagnostics are structured data (ids, URLs, byte counts, exit codes, verdicts,
raw log lines) — the same category as a stack trace, and no more translatable than one.

## Acceptance Criteria

- [x] **AC1** — A failure log entry can carry an optional, structured `diagnostics` record
      produced in main: the job id, start/end timestamps, the error key, and — per package the
      job touched — its id, the source URL it was actually fetched from, its byte size, and
      whether verify and extract succeeded.
- [x] **AC2** — For a bootstrap failure the diagnostics additionally name the target path, the
      inspector verdict that made it fail, and which required game files were missing at that
      point — i.e. the run described above would identify the demo package as the one that
      contributed nothing, not just "the result was not usable".
- [x] **AC3** — The failure card offers an action that puts a ready-to-paste Markdown report on
      the clipboard: app/Electron/OS versions, the error key, the package table from AC1, the
      AC2 verdict, and the tail of the job's own log lines.
- [x] **AC4** — The copied report redacts the user's home directory to a placeholder, so a path
      like `C:\Users\<name>\AppData\...` does not carry a real account name into a public issue.
      Paths the user chose themselves outside the home directory are kept verbatim.
- [x] **AC5** — The failure card offers an action that reveals the log file, through the
      existing `app:revealPath` allowlist — no new privileged channel.
- [x] **AC6** — Diagnostics persist with the entry in `state.json` and are bounded (a size cap
      per entry, on top of [[073]]'s 50-entry cap), so a retry loop cannot grow `state.json`
      without bound. An entry written before this story — no `diagnostics` — still renders, and
      simply offers no copy action.
- [x] **AC7** — No translatable prose crosses IPC: the diagnostics record contains no
      user-facing sentence, and every label in the copied report is assembled in the renderer
      from `en.json`.
- [x] **AC8** — The UI verification fixture renders the Downloads tab with a failure entry that
      has diagnostics and one that does not, both reachable offline.

## Open Questions

None — the four decisions this story needed are made below, each with its reason.

## Decisions (Refine)

- **Where diagnostics come from:** a module-scoped `DiagnosticsRegistry`
  (`Map<jobId, DownloadDiagnostics>`) inside the downloads module, **not** a new field on `Job`.
  `Job` is broadcast on every `jobs:changed` tick to every job surface in the app; hanging a
  growing record off it would widen that payload per progress tick for no reader. `failureFor()`
  ([index.ts:353](../../src/main/modules/downloads/index.ts#L353)) takes the entry out of the
  registry; any terminal job status drops it, so nothing leaks. `JobsService` is not touched.
- **Log tail without a log reader:** the `BootstrapLog` port
  ([ports.ts:50](../../src/main/modules/downloads/bootstrap/ports.ts#L50)) is already a seam, so
  the collector *tees* it — every line the job writes goes to `electron-log` as today **and**
  into a bounded ring. That is literally "the job's own log lines" (AC3) and needs no parsing of
  the shared `main.log`; `logger.ts` has no in-memory buffer to reuse.
- **Redaction happens at capture, in main** (`redactHome(value, homeDir)`), not when the report
  is assembled. The persisted record then never contains the account name at all — one place to
  get right, and a `state.json` that leaks nothing even if a future surface renders it. A path
  outside `os.homedir()` is a prefix miss and stays verbatim (AC4).
- **Clipboard gets a real IPC channel** (`app:copyText`), not `navigator.clipboard.writeText`.
  The renderer runs from `file://` under `sandbox: true` + `contextIsolation: true`
  ([window.ts:139](../../src/main/window.ts#L139)); the async clipboard API's secure-context and
  transient-activation requirements are not something to gamble a user-facing action on, and
  there is no clipboard precedent in the repo to mirror. A main-side `clipboard.writeText` behind
  a length-capped zod schema is deterministic, and the flow harness can read it back
  (`app.evaluate(({ clipboard }) => clipboard.readText())` — the mechanism is already used at
  [harness.mjs:487](../../scripts/lib/harness.mjs#L487)).
- **Scope: bootstrap jobs only.** AC1 says a failure entry *can* carry diagnostics — optional by
  construction. The bootstrap job is the one that fails opaquely (and the one the 2026-09-08 run
  hit); the single-package pipeline (`pipeline.ts`) stays uninstrumented and its failures simply
  offer no copy action, the same path AC6's pre-story entries take.
- **AC2's verdict is already reachable:** `installations.validate()` returns
  `Outcome<Installation>` and `Installation.checks: ValidationCheck[]`
  ([installation.ts:101](../../src/shared/types/installation.ts#L101)) — the failing check ids
  and their `messageKey`s (i18n keys, not prose) are in hand at
  [job.ts:686](../../src/main/modules/downloads/bootstrap/job.ts#L686). No inspector change.
- **Relation to [[076]]:** the two stories meet on the same failed run. 076 fixes `assemble.ts`'s
  allowlist so the demo package contributes its files; 075 makes the failure *say* which package
  contributed nothing. Neither depends on the other landing first.

## Plan

Bottom-up: the shape and its bounds first, then the capture, then the copy action, then the
verification. Nothing here changes `JobsService` or the `jobs:changed` broadcast.

1. **Shape + bounds** — `src/shared/modules/downloads.ts` gains `DownloadDiagnostics`
   (`jobId`, `kind`, `startedAt`, `finishedAt`, `errorKey`, `packages[]`, `target?`, `logTail[]`,
   `truncated?`) and `DownloadFailure.diagnostics?`. `main/lib/schemas.ts` gets the forgiving
   `.optional().catch(undefined)` row field, so a pre-story entry parses unchanged.
   `failure-log.ts` gains a pure `capDiagnostics()` that trims `logTail` oldest-first, then
   `packages`, then `target`, then drops the record — enforced inside `appendFailure`.
2. **Capture** — new `src/main/modules/downloads/diagnostics.ts`: `redactHome()`, the collector
   (`recordPackage`, `recordTarget`, `tee(log)`) and the registry. `failureFor()` attaches
   whatever the registry holds for the job.
3. **Bootstrap records it** — `bootstrap/job.ts` stops discarding `fetched.url` / `sizeBytes`
   ([job.ts:604](../../src/main/modules/downloads/bootstrap/job.ts#L604)) and `extracted.ok`
   ([job.ts:621](../../src/main/modules/downloads/bootstrap/job.ts#L621)), and records the target
   path, `afterAll.value.status` and the failing checks at
   [job.ts:694](../../src/main/modules/downloads/bootstrap/job.ts#L694). The collector enters
   through `BootstrapDeps` (`ports.ts`), injected by `bootstrapDepsFor()`
   ([index.ts:407](../../src/main/modules/downloads/index.ts#L407)).
4. **Two plumbing bits** — `app:copyText` (contract → schema → preload allowlist → handler, per
   [ARCHITECTURE.md#the-ipc-contract](../ARCHITECTURE.md#the-ipc-contract)) and
   `AppInfo.osVersion` from `os.release()`, which AC3's report header needs and `AppInfo` lacks.
5. **The report** — a pure `report.ts` in the renderer turning failure + diagnostics + `AppInfo`
   into Markdown, every label via `t()`. Then the card's two `IconButton`s: copy (only when
   `diagnostics` exists) and reveal-log (`app:revealPath` with `appInfo.logPath` — already
   allowlisted at [app.ts:60](../../src/main/ipc/app.ts#L60), no allowlist edit).
6. **Verification** — `populatedStateDocument()` seeds two `downloadFailures` entries, one with
   diagnostics and one without; `scripts/flows/downloads-tab.mjs` walks copy → clipboard read →
   redaction assertion.

Order: D1 → D2 → D3, with D4 → D5 → D6 runnable in parallel; D7 last (needs D1 and D6).

## Deliverables

- [x] **D1 — The shape, its persisted form, and its size cap.**
  Edit `src/shared/modules/downloads.ts` (add `DownloadDiagnostics`,
  `DownloadDiagnosticsPackage`, `DownloadDiagnosticsTarget`; add `diagnostics?` to
  `DownloadFailure` at [downloads.ts:250](../../src/shared/modules/downloads.ts#L250)); edit
  `src/main/lib/schemas.ts` (extend `downloadFailureObjectSchema` at
  [schemas.ts:943](../../src/main/lib/schemas.ts#L943) — mirror its existing
  `.optional().catch(undefined)` fields); edit `src/main/modules/downloads/failure-log.ts` (new
  `capDiagnostics`, called from `appendFailure` next to the existing `FAILURE_LOG_CAP` slice).
  *Acceptance:* a diagnostics record round-trips through the log and `state.json`; an entry
  written before this story (no `diagnostics`) parses unchanged; a garbage `diagnostics` value
  drops only that field, not the row; an oversized record is trimmed in the documented order and
  comes back with `truncated: true`; the 50-entry cap is unchanged.
  Tests: `src/main/modules/downloads/failure-log.test.ts`, `src/main/lib/schemas.test.ts`.

- [x] **D2 — Redaction, the collector, and the registry.**
  New `src/main/modules/downloads/diagnostics.ts` (pure `redactHome`,
  `createDiagnosticsCollector`, the module-scoped registry); edit
  `src/main/modules/downloads/index.ts` (`failureFor` at
  [index.ts:353](../../src/main/modules/downloads/index.ts#L353) attaches the registry entry,
  `observeFailedJobs` drops it on any terminal status).
  *Acceptance:* `redactHome` replaces the home prefix with a placeholder, is case-insensitive on
  win32, leaves a path outside the home directory byte-identical, and never partially matches a
  sibling directory (`C:\Users\bobby` is not inside `C:\Users\bob`); `tee()` forwards every line
  to the wrapped logger *and* keeps a bounded, redacted ring of the last N; a failed job with a
  registry entry produces a failure carrying it, one without produces a failure with no
  `diagnostics` field; a succeeded job leaves the registry empty.
  Tests: `src/main/modules/downloads/diagnostics.test.ts` plus an added case in
  `src/main/modules/downloads/index.test.ts`.

- [x] **D3 — The bootstrap job records what it already knows.**
  Edit `src/main/modules/downloads/bootstrap/job.ts` (capture `fetched.url`, `fetched.sizeBytes`
  and the verify + extract outcome per package inside the loop at
  [job.ts:557](../../src/main/modules/downloads/bootstrap/job.ts#L557); record target path,
  `afterAll.value.status` and the failing `checks` at
  [job.ts:686](../../src/main/modules/downloads/bootstrap/job.ts#L686)); edit
  `bootstrap/ports.ts` (`BootstrapDeps.diagnostics`); edit
  `src/main/modules/downloads/index.ts` (`bootstrapDepsFor` injects the collector).
  *Acceptance:* a run that fails at the not-playable verdict yields diagnostics naming every
  package with the URL that actually served it (the mirror, when a mirror fired), its byte size
  and `verified`/`extracted` per package — so the package that contributed nothing is
  identifiable; the target entry carries the redacted path, the verdict and the failing check
  ids; a run that fails earlier (`packageUnavailable`, extraction) still yields the packages it
  got to; the happy path is unchanged and the cleanup path
  ([job.ts:516](../../src/main/modules/downloads/bootstrap/job.ts#L516)) still deletes exactly
  what it deleted before.
  Test: `src/main/modules/downloads/bootstrap/job.test.ts` (extend the existing fake-deps setup).

- [x] **D4 — `app:copyText` and `AppInfo.osVersion`.**
  Edit `src/shared/ipc.ts` (channel + `INVOKE_CHANNELS` entry next to
  [ipc.ts:60](../../src/shared/ipc.ts#L60)), `src/shared/ipc-schemas.ts` (length-capped string,
  mirror the `app:openExternal` entry), `src/shared/types/common.ts` (`AppInfo.osVersion`),
  `src/main/ipc/app.ts` (handler over Electron `clipboard.writeText`; `os.release()` in `getInfo`
  at [app.ts:11](../../src/main/ipc/app.ts#L11)).
  *Acceptance:* boot-time `assertContractFullyHandled()` and the preload compile-time
  `ALL_INVOKE_CHANNELS_LISTED` assertion both stay satisfied; an over-length or non-string
  payload resolves to a failure `Outcome` without touching the clipboard; `app:getInfo` gains
  `osVersion` and no existing field changes.
  Tests: `src/main/ipc/app.test.ts` plus the existing `src/main/ipc/index.test.ts` coverage test.

- [x] **D5 — The Markdown report builder (pure).**
  New `src/renderer/src/modules/downloads/report.ts`
  (`buildFailureReport({ failure, appInfo, t }): string`); edit
  `src/renderer/src/i18n/locales/en.json` (new keys under the existing `downloads.failures.*`
  namespace).
  *Acceptance:* the report contains the version header (app/Electron/Chrome/Node/platform/OS),
  the error key, a Markdown package table with one row per diagnostics package, the AC2 verdict
  block and the log tail in a fenced block; every heading and column label resolves through `t()`
  (a missing key fails an assertion rather than printing a raw key); no path in the output
  contains a home-directory segment; the builder is total — a record with no `target` or an empty
  `packages` still yields a valid report.
  Test: `src/renderer/src/modules/downloads/report.test.ts`.

- [x] **D6 — The card's two actions.**
  Edit `src/renderer/src/modules/downloads/components/FailureLogEntry.tsx` (a `Copy` and a
  `FolderOpen` `IconButton`, `size="sm"`, mirroring the existing dismiss/restore cluster at
  [FailureLogEntry.tsx:50](../../src/renderer/src/modules/downloads/components/FailureLogEntry.tsx#L50));
  edit `src/renderer/src/modules/downloads/DownloadsView.tsx` (fetch `AppInfo` once, pass it
  down); edit `src/renderer/src/i18n/locales/en.json`.
  *Acceptance:* an entry with diagnostics shows both actions; an entry without shows neither the
  copy action nor a disabled stub; copy calls `app:copyText` with exactly `buildFailureReport`'s
  output and gives visible confirmation; reveal calls `app:revealPath` with `appInfo.logPath` and
  is disabled until `AppInfo` has loaded (mirroring
  [SettingsView.tsx:191](../../src/renderer/src/views/SettingsView.tsx#L191)); no string from the
  diagnostics record is rendered as card text.
  Tests: `src/renderer/src/modules/downloads/DownloadsView.failures.test.tsx` (extend) and
  `src/renderer/src/modules/downloads/components/FailureLogEntry.test.tsx` (new).

- [x] **D7 — Fixture and flow.**
  Edit `scripts/lib/fixture.mjs` (`populatedStateDocument()` at
  [fixture.mjs:505](../../scripts/lib/fixture.mjs#L505) seeds `downloadFailures`: one entry with
  a full diagnostics record, one without); edit `scripts/flows/downloads-tab.mjs` (new steps
  after the existing dismiss/restore walk at
  [downloads-tab.mjs:151](../../scripts/flows/downloads-tab.mjs#L151)); edit
  `docs/UI-VERIFICATION.md` where it lists the flow's steps.
  *Acceptance:* `npm run ui:verify -- --screens=downloads` stays axe-clean with the two seeded
  entries visible (adjust the existing empty-state assertions if the seeded entries break them —
  the jobs `EmptyState` must still be the jobs section's state); `npm run ui:flow --
  downloads-tab` passes offline and its new steps prove: both entries render, only the
  diagnostics one offers copy, the clipboard read back through
  `app.evaluate(({ clipboard }) => clipboard.readText())` holds a report containing the package
  table and the verdict, that text contains no real account name, and the reveal-log action is
  present and enabled; `shot()`s for both states.

## Model Hints

- **D3 → `deliverable-hard`** — `job.ts` is the bootstrap orchestrator: five distinct failure
  exits plus a `cleanUp()` path that deletes the target directory, and the values to capture
  (`fetched.url` after mirror fallback, `extracted.ok`, `afterAll.value.checks`) sit inside the
  loop that currently throws them away. A capture placed one branch off either records nothing on
  the exact failure this story exists for, or — worse — changes when cleanup runs.
- D1, D2, D4, D5, D6, D7 → default.
- **`Review: → story-review-hard`** — AC4 is a privacy guarantee: a redaction that silently
  under-matches (a case-different drive letter, a `logTail` line assembled by a code path the
  test does not exercise) ships a real Windows account name into a public GitHub issue, and every
  test in this story can pass while that is true.

## Acceptance Tests

- **AC1** → unit `src/main/modules/downloads/bootstrap/job.test.ts` › "a failed run records every
  package it touched with its serving URL, size, verify and extract result" (D3); unit
  `src/main/modules/downloads/failure-log.test.ts` › "a diagnostics record round-trips through
  the log" (D1).
- **AC2** → unit `src/main/modules/downloads/bootstrap/job.test.ts` › "a not-playable verdict
  records the target path, the verdict and the failing checks" plus › "a package that extracted
  nothing is identifiable in the diagnostics" (D3).
- **AC3** → e2e `scripts/flows/downloads-tab.mjs` › "copying a failure report puts the package
  table and the verdict on the clipboard" (D7, clipboard read back via `app.evaluate`); unit
  `src/renderer/src/modules/downloads/report.test.ts` › "the report carries versions, error key,
  package table, verdict and log tail" (D5).
- **AC4** → e2e `scripts/flows/downloads-tab.mjs` › the copy-report step, which rejects the
  fixture account name, the fixture home dir, the raw un-redacted target path, the suite
  machine's real `os.homedir()`, and any `X:\Users\<name>` shape in the clipboard content (D7);
  unit `src/main/modules/downloads/diagnostics.test.ts` › "the home directory is redacted, a path
  outside it is kept verbatim", › "a sibling directory sharing the prefix is not redacted", and ›
  a parity case pinning `scripts/lib/redact-home.mjs` (the e2e fixture's redaction mirror) against
  the real `redactHome` byte-for-byte, plus boundary cases for `:` / `)` / `,` / newline / the
  forward-slash form / the JSON-escaped `\\` form (D2, hardened after review); unit
  `src/renderer/src/modules/downloads/report.test.ts` › "no home-directory segment" against a
  stub `appInfo` using a realistic `C:\Users\realaccountname\...` path (D5, hardened after
  review — the original stub could not have failed).
- **AC5** → unit `src/renderer/src/modules/downloads/components/FailureLogEntry.test.tsx` › "the
  reveal action invokes app:revealPath with the launcher's log path" (D6); unit
  `src/main/ipc/app.test.ts` › the `app:revealPath` block asserting `app:getInfo`'s `logPath`
  resolves through the real handler (and a negative counterpart) (D4, added after review — guards
  the existing allowlist at [app.ts:60](../../src/main/ipc/app.ts#L60)); e2e
  `scripts/flows/downloads-tab.mjs` › "the failure card offers a reveal-log action" — presence,
  accessible name, enabled state (D7).
  **manual residue:** that an OS file-manager window actually appears on top is not asserted —
  `shell.showItemInFolder` opens Explorer/Finder, an out-of-process OS window Playwright cannot
  see and which would litter the machine running the suite. Everything up to and including the
  invoked channel and its validated argument is automated.
- **AC6** → unit `src/main/modules/downloads/failure-log.test.ts` › "an oversized diagnostics
  record is trimmed to the cap and marked truncated" and › "the 50-entry cap still holds with
  diagnostics present" (D1); unit `src/main/lib/schemas.test.ts` › "an entry without diagnostics
  parses unchanged" and › "a garbage diagnostics value drops the field, not the row" (D1); e2e
  `scripts/flows/downloads-tab.mjs` › "the entry without diagnostics renders and offers no copy
  action" (D7).
- **AC7** → unit `src/renderer/src/modules/downloads/report.test.ts` › "every label in the report
  comes from en.json" (D5); unit
  `src/renderer/src/modules/downloads/components/FailureLogEntry.test.tsx` › "no diagnostics
  value is rendered as card text" (D6). Note: `logTail` holds developer log lines by explicit
  design (the Requirement puts raw log lines in the same category as a stack trace); it is never
  rendered in the UI, only inside the copied report.
- **AC8** → e2e `npm run ui:verify -- --screens=downloads` (D7, axe + console + CSP gate with
  both seeded entries) plus `scripts/flows/downloads-tab.mjs`'s `shot()`s for the
  with-diagnostics and without-diagnostics states (D7). Offline: both entries come from the
  static `state.json` fixture — no network and no live job needed.

## Done

A failed bootstrap job now records structured diagnostics (per-package URL/size/verify/extract
result, target path, inspector verdict, missing checks, and a bounded log tail) in a
module-scoped registry, capped and persisted alongside the failure entry. The Downloads tab's
failure card can copy a ready-to-paste Markdown report (versions, error key, package table,
verdict, log tail) and reveal the log file, with the user's home directory redacted at capture
time so a real account name never leaves the machine. Pre-story entries without diagnostics still
render and simply offer no copy action.

Commit message: `075: a failed download tells me enough to report it`

**Verification:**
- `npm run build` — clean.
- `npm run typecheck` (node + web) — clean.
- `npm test` — 3098/3098 pass (one pre-existing, unrelated timing flake in
  `src/main/modules/config/core/import-reader.test.ts` under full-suite load — passes standalone,
  confirmed twice; not touched by this story).
- `npm run ui:verify -- --screens=downloads` — axe-clean, both fixture entries visible.
- `npm run ui:flow -- downloads-tab` — passes offline.
- Review: `story-review-hard` verdict **PASS**. Six findings raised, all fixed before closing:
  a missing AC5 test, two AC4 tests that couldn't actually fail (fixture used a hand-typed
  placeholder instead of real `redactHome` output; a report-builder stub `appInfo` that was never
  home-dir-shaped), a redaction boundary regex that let a home path survive when followed by
  punctuation/newline/forward-slash/JSON-escaped forms, `capDiagnostics` trimming the
  most-recently-processed (most diagnostically relevant) package instead of the oldest, and a
  silently swallowed clipboard-copy failure with no user feedback. Three lower-severity findings
  (an un-enforced `ValidationCheckId` sync comment in schemas.ts, the `truncated` flag not
  surfaced anywhere, UTF-16-vs-byte size accounting in the size cap) were left as-is — none affect
  an acceptance criterion, and are noted here rather than fixed to keep the review-fix cycle
  scoped to real gaps.

**AC → test mapping, as verified:**
- AC1 → `bootstrap/job.test.ts` "records every package..." + `failure-log.test.ts` "round-trips
  through the log" — pass.
- AC2 → `bootstrap/job.test.ts` "records the target path, the verdict and the failing checks" +
  "a package that extracted nothing is identifiable" — pass.
- AC3 → `scripts/flows/downloads-tab.mjs` clipboard read-back + `report.test.ts` "carries
  versions, error key, package table, verdict and log tail" — pass.
- AC4 → `diagnostics.test.ts` redaction cases (home prefix, outside-home verbatim, sibling
  directory, boundary punctuation/newline/forward-slash/JSON-escape forms, parity against the e2e
  fixture's redaction mirror) + `report.test.ts` "no home-directory segment" (hardened stub) +
  `downloads-tab.mjs` clipboard content checked against the fixture account name, fixture home
  dir, raw target path, and the suite machine's real `os.homedir()` — pass.
- AC5 → `FailureLogEntry.test.tsx` reveal action + `app.test.ts` `app:revealPath`
  allowlist-guard block (added) + `downloads-tab.mjs` presence/accessible-name/enabled-state —
  pass. Manual residue unchanged: the OS file-manager window itself is not asserted
  (Playwright can't see an out-of-process Explorer window).
- AC6 → `failure-log.test.ts` truncation + 50-entry-cap-with-diagnostics + `schemas.test.ts`
  no-diagnostics/garbage-diagnostics + `downloads-tab.mjs` no-copy-action-without-diagnostics —
  pass.
- AC7 → `report.test.ts` "every label comes from en.json" + `FailureLogEntry.test.tsx` "no
  diagnostics value rendered as card text" — pass.
- AC8 → `ui:verify --screens=downloads` + `downloads-tab.mjs` shots for both states — pass.
