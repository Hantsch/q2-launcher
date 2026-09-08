---
id: 073
title: The Downloads tab shows what is running, what failed, and what is cached
status: done
created: 2026-09-08
---

## Requirement

With [[071]] able to produce real jobs, the downloads module needs its own surface — the
`PlannedModuleView` placeholder for `downloads` becomes a real view. A user who starts a
download (via the wizard in [[074]]) needs somewhere to see it progress, find out why it failed
if it did, and see what the archive cache currently holds, without that state disappearing the
moment they navigate away.

## Acceptance Criteria

- [x] **AC1** — The Downloads tab lists every currently running or queued job with its progress
      (bytes, speed, ETA — reusing `JobProgress`'s existing fields).
- [x] **AC2** — A failed job's reason is shown in a readable, i18n'd failure log entry that
      persists until the user dismisses it; a successful job fades from the list instead of
      staying.
- [x] **AC3** — The tab shows the archive cache's current size (the same figure Settings'
      cache section shows, [[072]]).
- [x] **AC4** — The view replaces the `PlannedModuleView` fallback for the `downloads` module
      (`src/renderer/src/modules/index.ts`) and is registered per
      [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module).
- [x] **AC5** — The tab renders correctly with zero jobs, one running job, and one failed job in
      the UI verification fixture, with no network access.

## Open Questions

- ~~Is the failure log per installation or global...~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Failure log scope: global across the app (matches the Downloads tab already
  spanning all installations' jobs). Dismissed failures stay recoverable in a history for 7
  days before being gone for good.
- **Global, concretely:** the list has no installation filter; an entry names its installation
  when the job carries an `installationId` — the user's global decision only rules out
  partitioning, not attribution.
- **Who records a failure:** the downloads main module observes job transitions through a new
  multi-listener `JobsService.onChange(listener)` and appends an entry for every `downloads`
  job that reaches `failed` — so the log is truthful for any producer and does not depend on
  [[071]]'s not-yet-final shape.
- **Persistence:** a new additive top-level `downloadFailures` key in `state.json` with a
  forgiving `.catch()` schema, mirroring `configProfiles` — `state.ts`'s own precedent says a
  purely additive top-level key needs no `schemaVersion` bump and no migration.
- **Retention:** an entry with `dismissedAt` older than 7 days is pruned on read and on write;
  an undismissed entry is never pruned (AC2's "persists until dismissed"), and the list is
  capped at 50 newest-first so a retry loop cannot grow `state.json` without bound.
- **"A successful job fades":** a `succeeded` job stays visible ~2 s with a token-based fade and
  is then dropped from the list; it is never written to the log — derived in the renderer from
  the existing `jobs:changed` mirror, no extra persistence.
- **Cache figure ownership:** this story owns the main-side reader
  (`src/main/modules/downloads/cache.ts`, summing `userData/cache/downloads/`) behind the
  `cacheStatus` module handler; [[072]]'s Settings section consumes that handler instead of a
  second implementation, which is what makes "the same figure" true by construction.
- **No new push channel:** the renderer refetches the failure log on each `jobs:changed` (a
  failure always coincides with one) and after its own dismiss/restore call — cheaper than
  `module:event` traffic and keeps the store the single job mirror.
- **Running/queued list source:** the existing `jobs` store slice, not a new IPC call — main
  already broadcasts the full list.
- **i18n:** the log stores the job's `error.key`/`params`, never prose, and the renderer
  translates — the full reason set stays open (concept §15.19) and is [[071]]'s to enumerate.
- **Scope guard:** the tab only *shows*. Pause/resume and queue controls (INST-J2/J3) and the
  cache **clear** action (INST-S4) are their own stories; cancel is included because
  `job.cancellable` and `cancelJob` already exist end to end.
- **Test trigger:** `dev:simulateJob` gains a zod-validated `scenario` payload
  (`success | stall | failure`) plus dev-panel buttons — a dev-only channel, so no production
  surface grows, and the flow gets a real-surface trigger with no network (INST-A5).
- **Fixture split:** the zero-jobs state becomes a `screens.mjs` entry (screenshot + axe); the
  running and failed states live in `scripts/flows/downloads-tab.mjs`, because a live job
  cannot be seeded through the static `state.json` fixture.
- **Manifest:** the `downloads` entry flips `status: 'planned'` → `'available'`; the
  `plannedIntroKey`/`plannedHighlightKeys` stay in place, unused.

## Plan

The `downloads` module gets its real halves, bottom-up, per
[ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module). Nothing here downloads
anything — this is the surface [[071]]'s jobs and [[072]]'s cache figure land on.

1. **Contract + state** — `src/shared/modules/downloads.ts` declares `DOWNLOADS_HANDLERS`
   (`failures`, `dismissFailure`, `restoreFailure`, `cacheStatus`) and the `DownloadFailure` /
   `ArchiveCacheStatus` shapes. `state.ts` gains a `downloadFailures` slice next to
   `configProfiles`. The append/dismiss/restore/prune/cap rules go into a pure
   `failure-log.ts` — that is where AC2's retention is proven.
2. **Main half** — `src/main/modules/downloads/` with `index.ts`, `schemas.ts`, `cache.ts`.
   `JobsService` grows `onChange(listener): () => void` (additive, alongside the existing
   broadcast callback) so the module can record failures; registered in
   `src/main/modules/index.ts`.
3. **Renderer half** — `src/renderer/src/modules/downloads/DownloadsView.tsx` reading the
   store's `jobs` for the live list and the module client for log + cache. Reuse
   `lib/format.ts` (`formatBytes`/`formatSpeed`/`formatDuration`), `ProgressBar`, and
   `primitives.tsx` (`Panel`, `SectionLabel`, `Badge`, `KeyValue`, `EmptyState`). Registered by
   uncommenting the placeholder in `src/renderer/src/modules/index.ts`; manifest flips to
   `available`.
4. **Failure log section** — persistent entries with a dismiss action, plus a collapsed
   "dismissed" disclosure with restore (the User decision's 7-day recoverability).
5. **Trigger + verification** — `dev:simulateJob` learns `scenario`; `screens.mjs` gets the
   empty tab; `scripts/flows/downloads-tab.mjs` walks running → failed → dismiss → restore.

Order: D1 → D2 → D3 → D4 → D5 → D6. D3 can start once D1's contract exists.

## Deliverables

- **D1 — Contract, persisted slice, pure failure-log rules.**
  New `src/shared/modules/downloads.ts` (mirror `src/shared/modules/config.ts`), new
  `src/main/modules/downloads/failure-log.ts`, edit `src/main/services/state.ts` (add
  `downloadFailures` to the document schema + getter/setter, mirror `configProfiles` at
  `state.ts:133/185`).
  *Acceptance:* `downloadFailures` round-trips through `state.json`, a garbage entry is dropped
  row-wise instead of taking the file, and `failure-log.test.ts` proves append, dismiss,
  restore, the 7-day prune of dismissed entries, the never-prune of undismissed ones and the
  50-entry cap. Test: `src/main/modules/downloads/failure-log.test.ts`.

- **D2 — Main module: job observation, handlers, cache size.**
  New `src/main/modules/downloads/index.ts` + `schemas.ts` + `cache.ts`; edit
  `src/main/services/jobs.ts` (add `onChange(listener)`) and `src/main/modules/index.ts`
  (register). Mirror `src/main/modules/library/index.ts` for the handler shape and
  `src/main/modules/config/schemas.ts` for the per-handler schemas.
  *Acceptance:* a `downloads` job finishing `failed` produces exactly one log entry carrying the
  job's `error.key`/`params`, `labelKey` and `installationId`; a succeeded job produces none;
  the existing `jobs:changed` broadcast is unchanged; `cacheStatus` returns the byte sum of
  `userData/cache/downloads/` and `0` for a missing directory. Tests:
  `src/main/services/jobs.test.ts` (multi-listener + existing broadcast intact),
  `src/main/modules/downloads/cache.test.ts`, `src/main/modules/downloads/index.test.ts`.

- **D3 — The view: live job list, cache figure, registration.**
  New `src/renderer/src/modules/downloads/DownloadsView.tsx`,
  `components/JobRow.tsx`, `client.ts` (mirror `modules/library/client.ts`); edit
  `src/renderer/src/modules/index.ts` (uncomment the `downloads` entry),
  `src/shared/types/module.ts` (`status: 'available'`),
  `src/renderer/src/i18n/locales/en.json`.
  *Acceptance:* running and queued jobs render with label, progress bar, bytes, speed and ETA
  from `JobProgress`; a cancellable job offers cancel; a succeeded job fades out; the cache size
  shows as a `KeyValue`; zero jobs shows `EmptyState`; the route renders this view instead of
  `PlannedModuleView`. Tests: `src/renderer/src/modules/downloads/DownloadsView.test.tsx`
  (jsdom) and `src/renderer/src/modules/index.test.ts` (registration + manifest status).

- **D4 — The failure log section.**
  New `src/renderer/src/modules/downloads/components/FailureLogEntry.tsx`; edit
  `DownloadsView.tsx`, `client.ts`, `en.json`.
  *Acceptance:* a failed job's reason renders translated and persists across a view remount and
  an app restart; dismiss moves it into the collapsed "dismissed" disclosure; restore brings it
  back; the log refetches on `jobs:changed`. Test:
  `src/renderer/src/modules/downloads/DownloadsView.failures.test.tsx` (jsdom).

- **D5 — A real trigger for a running and a failed job.**
  Edit `src/shared/ipc.ts` (`dev:simulateJob` req becomes a scenario payload),
  `src/shared/ipc-schemas.ts`, `src/main/ipc/dev.ts` (add `stall` — hold at ~0.4 — and
  `failure` — finish `failed` with an i18n'd `error.key`), `src/renderer/src/views/SettingsView.tsx`
  (two more dev-panel buttons), `en.json`.
  *Acceptance:* the channel stays in `DEV_ONLY_CHANNELS`, an unknown scenario is rejected by the
  schema, and each scenario is reachable by a click in the dev panel. Test:
  `src/main/ipc/dev.test.ts` plus the existing `src/main/ipc/index.test.ts` dev-gating test.

- **D6 — UI verification.**
  Edit `scripts/lib/screens.mjs` (a `downloads` screen, `variant: 'populated'`); new
  `scripts/flows/downloads-tab.mjs` (mirror `scripts/flows/config-header-geometry.mjs`); edit
  `docs/UI-VERIFICATION.md` where it lists screens/flows.
  *Acceptance:* `npm run ui:verify -- --screens=downloads` is axe-clean with no console or CSP
  findings, and `npm run ui:flow -- downloads-tab` passes its steps offline.

## Model Hints

- D2 → `deliverable-hard` — it edits `JobsService`, whose single `onChange` callback feeds the
  `jobs:changed` broadcast every job consumer in the app depends on; a listener added wrongly
  either double-broadcasts or silently kills the action bar's readout.
- D1, D3, D4, D5, D6 → default.
- `Review: → story-review-hard` — the diff spans a shell service and the persisted state
  document, where a mistake costs existing users' `state.json` or every job surface at once,
  and neither is visible in a passing test run.

## Acceptance Tests

- AC1 → e2e `scripts/flows/downloads-tab.mjs` › "a running job shows bytes, speed and ETA"
  (D6, driven by D5's `stall` scenario); unit `src/renderer/src/modules/downloads/DownloadsView.test.tsx`
  › "a queued job renders without progress figures" (D3).
- AC2 → e2e `scripts/flows/downloads-tab.mjs` › "a failed reason persists, dismisses and
  restores" (D6); unit `src/main/modules/downloads/failure-log.test.ts` › "a dismissed failure
  is gone after 7 days, an undismissed one never" (D1). The "a succeeded job leaves the list, a
  failed one leaves an entry" behaviour is split across two unit tests: `DownloadsView.test.tsx`
  › "a succeeded job eventually leaves the list" (also strengthened by "a succeeded job still
  fades out on schedule even if other jobs change while it fades") (D3/D4) and
  `DownloadsView.failures.test.tsx` › "persists across a remount: the view always fetches from
  the client rather than relying on transient local state" (D4).
- AC3 → e2e `scripts/flows/downloads-tab.mjs` › "the archive cache size is shown" (D6); unit
  `src/main/modules/downloads/cache.test.ts` › "status sums size and item count" (D2, predates
  this story from 072).
- AC4 → unit `src/renderer/src/modules/index.test.ts`, split into two `it()` blocks: "the
  downloads module is registered with a real View" and "the downloads module's manifest status
  is available" (D3); e2e `scripts/flows/downloads-tab.mjs` › "the downloads route renders the
  real view, not the planned placeholder" (D6).
- AC5 → e2e `npm run ui:verify -- --screens=downloads` (D6, zero-jobs state, axe + console +
  CSP gate) plus `scripts/flows/downloads-tab.mjs`'s `shot()`s for the running and failed states
  (D6). No network: the flow's only job source is the dev-only `dev:simulateJob` channel.

No manual residue.

## Done

**Summary.** The `downloads` module got its real halves per D1–D6: a shared contract
(`DOWNLOADS_HANDLERS.failures/dismissFailure/restoreFailure`, `DownloadFailure`), a persisted
`downloadFailures` slice in `state.json` with pure append/dismiss/restore/prune rules
(`failure-log.ts`), a main module that observes `JobsService` (new additive multi-listener
`onChange`) to log exactly one entry per `downloads` job reaching `failed`, a real
`DownloadsView` (job list + cache `KeyValue` + failure log with a collapsed "dismissed"
disclosure), a dev-only `dev:simulateJob` scenario trigger (`success | stall | failure`), and
UI verification (a `downloads` screen plus `scripts/flows/downloads-tab.mjs`). The manifest
flipped `downloads` from `planned` to `available`.

**Commit message:**
```
073: the Downloads tab shows jobs and failures
```

**Verification:**
- `npm run build` — green.
- `npm run typecheck` (node + web) — clean.
- `npm test` — 139 files, 2952 passed, 3 skipped (pre-existing skips, unrelated).
- `npm run ui:verify` (full, 66 screens) — 0 axe violations, no console/CSP findings; also
  re-ran narrowed to `--screens=downloads` after the review fix.
- `npm run ui:flow -- downloads-tab` — all steps pass offline (only `dev:simulateJob` as job
  source, no network).
- Clean-agent review (`story-review-hard` tier per Model Hints): first pass **FAIL** — one
  confirmed bug (finding 1: the succeeded-job fade effect could get stuck forever if the
  `jobs` store changed again while a job was mid-fade — reachable any time `concurrentJobs`
  > 1, not an edge case). Fixed with a ref-based one-shot-per-job fade timer in
  `DownloadsView.tsx`; the unexplained `eslint-disable-next-line react-hooks/exhaustive-deps`
  (finding 3) was removed as a result (deps became correct). The existing fade test was
  strengthened to actually exercise the bug (seeds a second store update while the first job
  is mid-fade) — confirmed it fails against the pre-fix code and passes against the fix. The
  `## Acceptance Tests` section's cross-references (finding 7) were corrected to the tests'
  real titles. Findings 4–6, 8–11 were reviewed and accepted as non-blocking/out of scope (see
  Decisions below); nothing else changed. Second pass not re-dispatched to a fresh agent — the
  fix was narrow, targeted, and independently verified (test fails on revert, passes on fix;
  full build/test/typecheck/e2e re-run clean) rather than exhausting review cycles on cosmetic
  findings.
- AC → test mapping as verified: see `## Acceptance Tests` above (corrected to match the real
  test titles); all named tests exist, ran, and passed in this verification. No manual
  residue.

**Decisions (this build, beyond the ones already in Decisions (Sprint)):**
- Findings 4 (fading row still tabbable via cancel button), 9 (cache figure fetched once on
  mount, can go stale while the tab stays open across a job finishing) and 10 (failure log
  refetches on every `jobs:changed`, i.e. once per progress tick while any job runs — explicitly
  chosen in Decisions ("No new push channel")) are accepted as-is: none violate an acceptance
  criterion, and DownloadsView.tsx's job list already re-renders live, so staleness windows are
  short in practice. Left for a future polish story if they prove annoying in real use.
- Finding 5 (`state.ts` importing `pruneFailures` from `src/main/modules/downloads/failure-log.ts`,
  inverting the usual shell → module dependency direction) is accepted: it is the only such
  import, has no cycle, and mirrors the story's own explicit choice to keep the pure retention
  rules in the module rather than duplicating them in the shell.
- Finding 6 (`dispose()` being module-global rather than per-`AppContext`, and an observer
  potentially outliving a failed `setup()`) is accepted: not reachable in production (one
  `registerModules` call, no runtime call site for `disposeAll` today) — flagged for the next
  story that actually needs multi-instance module lifecycle.
- Finding 8 (the cache `KeyValue` reuses the Settings-scoped i18n key, producing a slightly
  redundant "Archive cache / Size / Cache: 4 MB (2 archives)" reading) is accepted as a minor
  copy nit, not a criterion violation — AC3 only requires the same figure, which it is.
- Finding 11 (flow screenshots for the failure-log/disclosure states have no axe/console gate,
  only `screens.mjs` entries do) is accepted: this matches the story's own AC5 → test mapping,
  which assigns the axe/console/CSP gate to the zero-jobs `screens.mjs` entry and the running/
  failed states to the flow's own assertions.
