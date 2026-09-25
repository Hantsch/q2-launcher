---
id: 115
title: how hard the scan works is a setting
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user who thinks the browser is too aggressive, too slow, or too eager to refresh itself can turn
every one of those knobs down (or up) in the module's settings section, rather than living with
whatever number a developer once hardcoded. Conversely a user who wants the list to feel instant
does not need to wait for a future release to loosen it. The concept is explicit that none of this
is fixed by design — "das soll der user selber entscheiden" (game-browser.md §3, §7.3, GB-N3/GB-N4)
— so the scan scheduler [[114]] built reads its cadence and budget from settings, never from a
constant baked into the scheduler.

That still leaves the question of what the app ships with on first run. The concept is equally
explicit that it refuses to invent those numbers (§18.1): "the first thing the implementation does
is measure: how long a full pass over a real master list (~100-300 servers) takes including
details. Only the numbers decide whether any of this needs tuning at all." This story is where that
measurement happens and where its result becomes the shipped defaults — not a guess dressed up as
one. If the measured full-detail pass turns out to be on the order of a few hundred milliseconds,
that also answers most of the "does this even need tuning" question the concept poses, and later
stories (the scoped refreshes in [[117]], a possible dedicated watchlist re-check) inherit that
answer rather than re-litigating it.

This story also has to decide, for [[114]]'s scheduler, whether a scan is represented as a `Job`
through the existing `JobsService` (`src/main/services/jobs.ts`), the way every installation-mutating
download/repair/upgrade job is today, or is its own lighter-weight thing. The concept raises this
itself without resolving it (§18 open point #7): "`JobsService` today is scoped to installation-
mutating work; reusing it for a read-only network sweep would be a deliberate decision, and the
progress UI would come for free." Whichever way this falls also shapes how [[116]]'s "no scan while
playing" guard observes and enforces the rule, so it has to be settled here, not deferred into build.

## Acceptance Criteria

- [ ] **AC1** — Auto-scan-on-open, auto-refresh interval (off/on + value), maximum concurrent
      in-flight queries, per-query timeout, retry count, and minimum spacing between two automatic
      scans are each a user-changeable setting in the module's settings section — none of them is a
      constant in the scheduler code.
- [ ] **AC2** — The shipped default value for every setting in AC1 is justified by a real measurement
      of a full two-stage pass over a real master list (~100-300 servers) recorded in this story
      (method, environment, and the resulting numbers), not asserted without that evidence.
- [ ] **AC3** — A manual scan is available regardless of the auto-scan-on-open and auto-refresh
      settings' current values — turning both off never removes the manual trigger.
- [ ] **AC4** — When an automatic scan comes due while a previous scan (automatic or manual) is still
      running, the due one is skipped, not queued and not run concurrently — at most one scan is ever
      in flight at a time.

## Open Questions

- [x] ~~**Q1 — Is a scan a `Job`?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Is a scan a `Job` through `JobsService`? No — the scan is its own lighter-weight
  mechanism, not a `Job`. `JobsService` stays scoped to installation-mutating work; the scan
  scheduler owns its own state and pushes progress via a dedicated `module:event`, the same pattern
  [[114]] already specifies for stage-1/stage-2 results. [[116]]'s no-scan-while-playing guard reads
  scan state directly from the scheduler, not through `jobs:changed`.
- **Where the settings live.** The seven knobs extend the existing `ServersScanSettings`
  (`src/shared/modules/servers.ts:205`) inside the module's own `state.json` key — GB-P1/GB-P2
  already put scan settings there, so no new state key and no `LauncherSettings` extension.
- **Field shape.** `autoScanOnOpen: boolean`, `autoRefreshEnabled: boolean`,
  `autoRefreshIntervalMs`, plus the existing `concurrency`, `timeoutMs`, `retries`,
  `minSpacingMs` — every duration is stored in ms for consistency with `timeoutMs` and rendered in
  seconds/minutes in the UI, because mixing units inside one persisted object is how a "30" becomes
  30 ms.
- **Bounded, not free-text.** Each numeric knob gets `MIN_*`/`MAX_*` constants plus a shipped choice
  list in shared (mirroring `MIN/MAX_CONCURRENT_DOWNLOAD_JOBS`), and the UI renders `Select`/`Switch`
  rather than number inputs — a bounded choice cannot produce a 500-way flood or a 1 ms timeout, and
  it keeps the e2e selectors stable.
- **Defensive parse stays field-level.** `parseServersScanSettings` (`src/main/lib/schemas.ts`)
  clamps each field into its range and falls back to that field's own default, never dropping the
  whole `scan` object — the same rule every other field of `parseServersState` already follows.
- **Two settings handlers, mirroring downloads.** `scan.getSettings` / `scan.patchSettings` (strict
  zod payload, resolving to the full persisted settings) follow `downloads.getSettings`/
  `patchSettings`; the scan trigger and scan-state channels are [[114]]'s and are consumed here, not
  duplicated.
- **The cadence lives in main, not in the view.** The renderer reports only view visibility
  (`scan.setViewActive`); main owns the auto-scan-on-open decision and the auto-refresh timer,
  because main already owns scan state and the renderer must never poll for it (concept §7.2/§7.3).
- **Settings are read per scan, the timer is rescheduled on patch.** A changed budget takes effect on
  the next scan rather than mutating a pass in flight; a changed interval reschedules immediately, so
  the setting the user just moved is visibly the one in force.
- **Manual scan ignores both auto settings and the minimum spacing.** Minimum spacing bounds
  *automatic* scans (GB-N4's wording); a trigger the user pressed is an explicit instruction and is
  never rate-limited away — which is exactly what AC3 protects.
- **At most one scan, ever.** The scheduler keeps a single in-flight handle and a due automatic scan
  is skipped and counted, not queued; the decision itself is a pure function (`scan-cadence.ts`) so
  AC4 is provable without timers in the test.
- **The measurement uses a loopback server population, not a real master.** GB-A5 forbids any test or
  `ui:verify` run touching a real master or game server, and no production population exists in dev —
  so the measured pass runs against N fake Q2 servers on `127.0.0.1` answering real
  `reply-fixtures.ts` bytes after a seeded latency/dead-share distribution.
- **The measurement's limits are recorded with its numbers.** Loopback bounds the scheduler's own
  cost and the effect of each knob, not real internet jitter and loss; the modelled distribution is
  written down as the input it is, so nobody later reads the table as a claim about a real master.
- **The measurement is a committed, re-runnable script** (`npm run measure:scan`), not a throwaway —
  §18.16 and [[117]] both get decided against these numbers, and a number nobody can reproduce is not
  evidence.
- **No "reset to defaults" control.** Nothing in the ACs asks for one and every knob is a bounded
  choice the user can put back by hand; adding it would be scope the story did not buy.
- **No platform-parity row here.** Nothing in this story behaves differently on Linux (GB-T2), so no
  control is disabled and no "not available on Linux" text is added.

## Plan

1. **Contract (D1).** Extend `ServersScanSettings` + its zod schema in `src/shared/modules/servers.ts`
   with `autoScanOnOpen`, `autoRefreshEnabled`, `autoRefreshIntervalMs`; add the `MIN_*`/`MAX_*` and
   choice-list constants and the three new `SERVERS_HANDLERS` entries (`scan.getSettings`,
   `scan.patchSettings`, `scan.setViewActive`) with strict input schemas.
2. **Persistence (D2).** Teach `parseServersScanSettings` (`src/main/lib/schemas.ts`) the new fields
   with per-field clamp-and-fallback; implement the two settings handlers in
   `src/main/modules/servers/index.ts` through its existing read/mutate/persist `mutate` path.
3. **Cadence (D3).** New pure `src/main/modules/servers/scan-cadence.ts` — auto-scan-on-open,
   interval due-check, minimum spacing, single-flight skip — plus the thin timer/wiring around
   [[114]]'s scheduler and the `scan.setViewActive` handler.
4. **UI (D4).** A "Scan" group inside `src/renderer/src/modules/servers/ServersSettingsSection.tsx`
   (Switches + Selects, mirroring `DownloadsSettingsSection.tsx`), the client calls, en locale keys.
5. **Manual trigger (D5).** Guarantee the Servers view's manual refresh control exists and never
   reads the two auto settings; acceptance flow `scripts/flows/servers-scan-settings.mjs`.
6. **Measurement (D6).** `scripts/measure/scan-pass.mjs` + `npm run measure:scan`, run it, write
   method/environment/numbers into `## Measurement (AC2)`, and set `DEFAULT_SERVERS_STATE.scan` from
   the result.

Order is a dependency chain (contract → persistence → cadence → UI → flow), with the measurement last
because it needs the whole pass in place and its output is the shipped defaults. Nothing here touches
the shell or `src/shared/ipc.ts` — all traffic rides the existing `module:invoke` / `module:event`
seam under the `servers` namespace.

## Deliverables

- **D1 — the scan settings exist in the contract.**
  `src/shared/modules/servers.ts`, `src/shared/modules/servers.test.ts`.
  Mirror: `src/shared/modules/downloads.ts` (`MIN/MAX_CONCURRENT_DOWNLOAD_JOBS`,
  `patchDownloadsSettingsInputSchema`). Adds the three new fields, the bound/choice constants and the
  three `SERVERS_HANDLERS` entries with strict payload schemas.
  *Accepted when:* `servers.test.ts`'s existing "every handler has a schema" sweep covers the new
  channels and the patch schema rejects an out-of-range value.

- **D2 — the settings persist and survive a hostile `state.json`.**
  `src/main/lib/schemas.ts` (`parseServersScanSettings`), `src/main/lib/schemas.test.ts`,
  `src/main/modules/servers/index.ts`, `src/main/modules/servers/index.test.ts`.
  Mirror: `src/main/modules/downloads/index.ts:487` (`patchDownloadsSettings`) and the `mutate` helper
  already in `servers/index.ts`.
  *Accepted when:* a patch round-trips through `state.json`, an out-of-range or garbage field falls
  back to that field's default only, and the other `ServersState` keys stay untouched.

- **D3 — the scheduler's cadence comes from the settings, and only one scan runs.**
  `src/main/modules/servers/scan-cadence.ts` (+ `.test.ts`), [[114]]'s scheduler entry under
  `src/main/modules/servers/`, `src/main/modules/servers/index.ts` (the `scan.setViewActive` handler).
  *Accepted when:* `scan-cadence.test.ts` proves (a) every cadence/budget decision is taken from the
  passed settings with no literal left in the module, (b) a due automatic scan while one is in flight
  is skipped and not queued, (c) minimum spacing gates automatic scans and not manual ones.

- **D4 — the user changes all seven knobs in Settings.**
  `src/renderer/src/modules/servers/ServersSettingsSection.tsx` (+ `.test.tsx`),
  `src/renderer/src/modules/servers/client.ts`, `src/renderer/src/i18n/locales/en.json`.
  Mirror: `src/renderer/src/modules/downloads/DownloadsSettingsSection.tsx`.
  *Accepted when:* the section renders from main's returned settings (no optimistic local copy), every
  control is a `Switch`/`Select` carrying a `servers-scan-settings-*` testid, and the interval control
  is disabled while auto-refresh is off.

- **D5 — the manual scan survives both auto settings being off.**
  the Servers view's manual refresh control (`src/renderer/src/modules/servers/` — added here if
  [[114]]'s view did not land one), `scripts/flows/servers-scan-settings.mjs`.
  Mirror: `scripts/flows/settings-downloads-section.mjs`.
  *Accepted when:* the flow turns both auto settings off in Settings, returns to the Servers view, and
  the manual refresh control is present, enabled and starts a scan.

- **D6 — the shipped defaults are measured, not invented.**
  `scripts/measure/scan-pass.mjs`, `package.json` (`measure:scan`),
  `src/main/modules/servers/scan-measurement.test.ts`, `src/shared/modules/servers.ts`
  (`DEFAULT_SERVERS_STATE.scan`), this story's `## Measurement (AC2)`.
  Method: spin up 100/200/300 loopback UDP responders replying with `src/shared/servers/reply-fixtures.ts`
  bytes after a seeded per-server delay (a fixed latency distribution plus a dead share that never
  answers), run [[114]]'s real two-stage scheduler over them, and record median/p95 wall clock for
  stage 1, stage 2 and the full pass, plus the zero-delay run (the scheduler's own overhead), across a
  concurrency × timeout × retries matrix.
  *Accepted when:* `## Measurement (AC2)` carries method, environment (OS, CPU, Node/Electron version),
  the modelled distribution, the result table and its stated limits; `DEFAULT_SERVERS_STATE.scan`
  matches a row of that table; and `scan-measurement.test.ts` re-runs a scaled-down population and
  asserts a full pass under the shipped defaults finishes inside the recorded budget.

## Model Hints

- D3 → `deliverable-hard` — single-flight plus an interval timer wired into [[114]]'s freshly built
  scheduler is the one place a regression means two concurrent scans (AC4) or a timer that outlives
  the closed view.
- D6 → `deliverable-hard` — the measurement is this story's entire evidence base; a harness that
  quietly measures the fixture parser instead of a real two-stage pass would still go green.
- All other Ds → default tier.
- Review: → `story-review-hard` — AC2 is satisfiable by a plausible-looking but rigged number, so the
  review has to judge the measurement's method, not just the diff.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-scan-settings.mjs` › flow `servers-scan-settings` ("all seven scan
  knobs change in Settings and land in state.json"), plus unit
  `src/main/modules/servers/scan-cadence.test.ts` › "every cadence decision comes from the passed
  settings" (D3/D4).
- AC2 → unit `src/main/modules/servers/scan-measurement.test.ts` › "a full two-stage pass over the
  loopback population finishes inside the shipped defaults' budget" (D6), against the method,
  environment and numbers recorded in `## Measurement (AC2)`.
- AC3 → e2e `scripts/flows/servers-scan-settings.mjs` › flow `servers-scan-settings` (with
  auto-scan-on-open and auto-refresh both off, the manual refresh control is still present, enabled
  and starts a scan) (D5).
- AC4 → unit `src/main/modules/servers/scan-cadence.test.ts` › "an automatic scan due while one is
  running is skipped, not queued" (D3).

Coverage gate: AC1 → D1/D2/D4 + flow & cadence test · AC2 → D6 + measurement test · AC3 → D5 + flow ·
AC4 → D3 + cadence test. No criterion without a deliverable, no criterion without a test, no manual
residue.

## Measurement (AC2)

<!-- Filled by `/build 115` D6: method, environment, modelled distribution, result table, stated
     limits, and which row of it the shipped defaults were taken from. -->

## Done

<!-- Filled by `/build 115`. -->
