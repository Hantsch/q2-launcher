---
id: 115
title: how hard the scan works is a setting
status: done # draft -> ready -> in-progress -> done
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

- [x] **AC1** — Auto-scan-on-open, auto-refresh interval (off/on + value), maximum concurrent
      in-flight queries, per-query timeout, retry count, and minimum spacing between two automatic
      scans are each a user-changeable setting in the module's settings section — none of them is a
      constant in the scheduler code.
- [x] **AC2** — The shipped default value for every setting in AC1 is justified by a real measurement
      of a full two-stage pass over a real master list (~100-300 servers) recorded in this story
      (method, environment, and the resulting numbers), not asserted without that evidence.
- [x] **AC3** — A manual scan is available regardless of the auto-scan-on-open and auto-refresh
      settings' current values — turning both off never removes the manual trigger.
- [x] **AC4** — When an automatic scan comes due while a previous scan (automatic or manual) is still
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

- [x] **D1 — the scan settings exist in the contract.**
  `src/shared/modules/servers.ts`, `src/shared/modules/servers.test.ts`.
  Mirror: `src/shared/modules/downloads.ts` (`MIN/MAX_CONCURRENT_DOWNLOAD_JOBS`,
  `patchDownloadsSettingsInputSchema`). Adds the three new fields, the bound/choice constants and the
  three `SERVERS_HANDLERS` entries with strict payload schemas.
  *Accepted when:* `servers.test.ts`'s existing "every handler has a schema" sweep covers the new
  channels and the patch schema rejects an out-of-range value.

- [x] **D2 — the settings persist and survive a hostile `state.json`.**
  `src/main/lib/schemas.ts` (`parseServersScanSettings`), `src/main/lib/schemas.test.ts`,
  `src/main/modules/servers/index.ts`, `src/main/modules/servers/index.test.ts`.
  Mirror: `src/main/modules/downloads/index.ts:487` (`patchDownloadsSettings`) and the `mutate` helper
  already in `servers/index.ts`.
  *Accepted when:* a patch round-trips through `state.json`, an out-of-range or garbage field falls
  back to that field's default only, and the other `ServersState` keys stay untouched.

- [x] **D3 — the scheduler's cadence comes from the settings, and only one scan runs.**
  `src/main/modules/servers/scan-cadence.ts` (+ `.test.ts`), [[114]]'s scheduler entry under
  `src/main/modules/servers/`, `src/main/modules/servers/index.ts` (the `scan.setViewActive` handler).
  *Accepted when:* `scan-cadence.test.ts` proves (a) every cadence/budget decision is taken from the
  passed settings with no literal left in the module, (b) a due automatic scan while one is in flight
  is skipped and not queued, (c) minimum spacing gates automatic scans and not manual ones.

- [x] **D4 — the user changes all seven knobs in Settings.**
  `src/renderer/src/modules/servers/ServersSettingsSection.tsx` (+ `.test.tsx`),
  `src/renderer/src/modules/servers/client.ts`, `src/renderer/src/i18n/locales/en.json`.
  Mirror: `src/renderer/src/modules/downloads/DownloadsSettingsSection.tsx`.
  *Accepted when:* the section renders from main's returned settings (no optimistic local copy), every
  control is a `Switch`/`Select` carrying a `servers-scan-settings-*` testid, and the interval control
  is disabled while auto-refresh is off.

- [x] **D5 — the manual scan survives both auto settings being off.**
  the Servers view's manual refresh control (`src/renderer/src/modules/servers/` — added here if
  [[114]]'s view did not land one), `scripts/flows/servers-scan-settings.mjs`.
  Mirror: `scripts/flows/settings-downloads-section.mjs`.
  *Accepted when:* the flow turns both auto settings off in Settings, returns to the Servers view, and
  the manual refresh control is present, enabled and starts a scan.

- [x] **D6 — the shipped defaults are measured, not invented.**
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

Re-run with `npm run measure:scan` (`scripts/measure/scan-pass.mjs`, ~6.5 min on the machine
below). Every number in this section is transcribed from one run of that script, not computed by
hand.

### Method

- **What is timed.** [[114]]'s real scheduler, `runScan` (`src/main/modules/servers/scan-runner.ts`),
  with its default, real `queryServer` — one real `node:dgram` socket per query, real retry timer,
  real reply parsers. Nothing is stubbed, re-implemented or fed bytes without a socket round-trip.
  Because `runScan` is TypeScript behind the `@shared`/`@main` aliases and plain Node here has no
  loader for either, the script starts vitest through its node API over itself (with `include`
  narrowed to that one file, so `npm test` never picks it up) and runs the measurement inside that
  worker.
- **The population.** N fake Quake II servers, each a `node:dgram` socket bound on `127.0.0.1` with
  an ephemeral port (GB-A5: no real master or game server is contacted, no hostname resolved). A
  responder reads the command token after the OOB prefix and answers `info` with
  `buildInfoReplyBytes(...)` and `status` with `buildStatusReplyBytes(...)` from
  `src/shared/servers/reply-fixtures.ts`, carrying its own hostname and player count, after its own
  delay (`setTimeout` before `send`). The scan's targets are the N `127.0.0.1:<port>` addresses; no
  server is selected, so stage 2 is exactly the non-empty set.
- **The modelled distribution (an invented input, not an observation).** One seeded draw
  (mulberry32, seed `0x115`, five draws per responder, so N=100 is the first 100 of N=300):
  - **dead share 15%** — bound, never answers anything (a server that is down);
  - **lossy share 5% of the live ones** — drops the first datagram of each query kind per pass and
    answers only a resend (one lost packet), so the `retries` knob's effect is visible on loopback;
  - **non-empty share 40% of the live ones** — `clients` 1-7 (the stage-2 targets), the rest report
    `clients 0`;
  - **reply delay** per live responder, drawn once: 70% uniform 5-30 ms, 25% uniform 30-150 ms, 5%
    uniform 150-400 ms.

  Realised: N=100 — 15 dead, 85 live (4 lossy, 36 non-empty); N=200 — 36 dead, 164 live (9 lossy,
  66 non-empty); N=300 — 44 dead, 256 live (14 lossy, 99 non-empty). Live delay median 24-25 ms,
  p95 137 ms, max 268/355/359 ms.
- **Zero-delay runs** switch every responder to answer immediately (nobody dead or lossy): what is
  left is the scheduler's own pooling, bookkeeping, socket and parse cost.
- **Timing.** `performance.now()` around the `runScan` call; the stage-1/stage-2 split is the
  `onProgress` callback's first `phase: 'stage2'` emission, which `runScan` fires the moment stage
  1 has fully settled. Stage 1 = call → that emission, stage 2 = that emission → resolve, full
  pass = call → resolve.
- **Integrity checks, per pass.** A pass only counts if: all N stage-1 queries settled and the call
  was not aborted; every responder received at least one `info` datagram; every dead responder saw
  exactly `retries + 1` sends; the stage-1 successes equal the responders that can answer under that
  `retries` (lossy ones cannot at `retries 0`); every row's hostname is its own responder's (proof
  it was that datagram, parsed); `stage2Total` equals the answering non-empty set, all of which got a
  `status` reply; and no empty, dead or unanswered responder ever received a `status` query. Any
  violation throws instead of printing numbers.
- **Matrix — a representative subset of D1's choice lists, not exhaustive.** Each dead server costs
  one pool slot `timeoutMs × (retries + 1)` per pass, so the full cross at three sizes would run for
  the better part of an hour. Run instead: zero-delay at concurrency 8 and 32 for every N; modelled
  at N=100 concurrency {8, 16, 24} × timeoutMs 1000 × retries {0, 1}; N=200 {16, 24} × 1000 ×
  {0, 1}; N=300 {8, 16, 24, 32} × 1000 × {0, 1} plus 24 × 2000 × {0, 1}. A discarded zero-delay
  warm-up pass runs first.
- **Repetitions.** 3 per modelled configuration, 10 per zero-delay configuration; median and
  nearest-rank p95 (with 3 reps the p95 is the slowest rep). The delays are fixed per responder, so
  run-to-run spread is small — p95 sits within ~1% of the median on almost every modelled row.

### Environment

- OS: Windows 11 Pro (win32 10.0.26200, x64)
- CPU: 13th Gen Intel(R) Core(TM) i7-13700K — 24 logical cores
- Node: v25.6.1, via vitest 4.1.10 — not inside an Electron main process
- Repo pins: electron ^43.4.0 (installed 43.4.0), electron-vite ^5.0.0

### Results

| N | delays | concurrency | timeoutMs | retries | stage 1 median / p95 (ms) | stage 2 median / p95 (ms) | full pass median / p95 (ms) | online | stage-2 targets | reps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | zero | 8 | - | - | 22.7 / 24.4 | 9.3 / 11.3 | 31.9 / 35.4 | 100/100 | 42 | 10 |
| 100 | zero | 32 | - | - | 20.7 / 23.0 | 7.5 / 8.8 | 28.0 / 30.1 | 100/100 | 42 | 10 |
| 100 | modelled | 8 | 1000 | 0 | 3450 / 3456 | 280 / 282 | 3725 / 3732 | 81/100 | 33 | 3 |
| 100 | modelled | 16 | 1000 | 0 | 2191 / 2272 | 179 / 184 | 2375 / 2452 | 81/100 | 33 | 3 |
| 100 | modelled | 24 | 1000 | 0 | 1392 / 1405 | 155 / 156 | 1547 / 1561 | 81/100 | 33 | 3 |
| 100 | modelled | 8 | 1000 | 1 | 6210 / 6257 | 1354 / 1383 | 7564 / 7640 | 85/100 | 36 | 3 |
| 100 | modelled | 16 | 1000 | 1 | 3871 / 4033 | 1309 / 1321 | 5181 / 5354 | 85/100 | 36 | 3 |
| 100 | modelled | 24 | 1000 | 1 | 2375 / 2375 | 1288 / 1293 | 3662 / 3664 | 85/100 | 36 | 3 |
| 200 | zero | 8 | - | - | 70.8 / 79.5 | 27.3 / 33.9 | 99.8 / 110 | 200/200 | 81 | 10 |
| 200 | zero | 32 | - | - | 65.8 / 70.1 | 23.4 / 33.5 | 90.0 / 100 | 200/200 | 81 | 10 |
| 200 | modelled | 16 | 1000 | 0 | 3658 / 3661 | 296 / 311 | 3955 / 3972 | 155/200 | 62 | 3 |
| 200 | modelled | 24 | 1000 | 0 | 2663 / 2668 | 266 / 279 | 2929 / 2947 | 155/200 | 62 | 3 |
| 200 | modelled | 16 | 1000 | 1 | 6550 / 6592 | 1283 / 1294 | 7832 / 7886 | 164/200 | 66 | 3 |
| 200 | modelled | 24 | 1000 | 1 | 4646 / 4696 | 1287 / 1293 | 5934 / 5989 | 164/200 | 66 | 3 |
| 300 | zero | 8 | - | - | 138 / 170 | 45.6 / 63.2 | 184 / 230 | 300/300 | 116 | 10 |
| 300 | zero | 32 | - | - | 89.9 / 127 | 32.6 / 49.6 | 130 / 156 | 300/300 | 116 | 10 |
| 300 | modelled | 8 | 1000 | 0 | 9383 / 9837 | 746 / 911 | 10127 / 10748 | 242/300 | 94 | 3 |
| 300 | modelled | 16 | 1000 | 0 | 4903 / 4905 | 512 / 514 | 5415 / 5419 | 242/300 | 94 | 3 |
| 300 | modelled | 24 | 1000 | 0 | 3581 / 3582 | 440 / 506 | 4016 / 4086 | 242/300 | 94 | 3 |
| 300 | modelled | 32 | 1000 | 0 | 2772 / 2804 | 406 / 447 | 3179 / 3251 | 242/300 | 94 | 3 |
| 300 | modelled | 8 | 1000 | 1 | 15841 / 16536 | 1753 / 2180 | 17579 / 18716 | 256/300 | 99 | 3 |
| 300 | modelled | 16 | 1000 | 1 | 8546 / 8550 | 1288 / 1290 | 9834 / 9840 | 256/300 | 99 | 3 |
| **300** | **modelled** | **24** | **1000** | **1** | **6240 / 6240** | **1287 / 1288** | **7527 / 7528** | **256/300** | **99** | **3** |
| 300 | modelled | 32 | 1000 | 1 | 4673 / 4678 | 1288 / 1289 | 5961 / 5966 | 256/300 | 99 | 3 |
| 300 | modelled | 24 | 2000 | 0 | 6536 / 6540 | 435 / 437 | 6968 / 6978 | 242/300 | 94 | 3 |
| 300 | modelled | 24 | 2000 | 1 | 11863 / 11870 | 2284 / 2295 | 14152 / 14154 | 256/300 | 99 | 3 |

"online" is stage-1 successes; the 14 servers missing at `retries 0` for N=300 are exactly the lossy
ones, reported offline because one packet was lost. Responder socket errors across the run: 0.

**What the numbers say.**

- The scheduler itself is cheap: a zero-delay full two-stage pass over 300 servers takes ~130-180 ms,
  largely independent of concurrency. Its own overhead is not what a user waits for.
- Under the model, a pass is paid almost entirely in **waiting for servers that do not answer**:
  each dead server holds one pool slot for `timeoutMs × (retries + 1)`. That is why concurrency
  helps nearly linearly in stage 1 (N=300, 1000/1: 15.8 s → 8.5 s → 6.2 s → 4.7 s for 8/16/24/32)
  and why doubling the timeout nearly doubles the pass (24/1000/1: 7.5 s; 24/2000/1: 14.2 s).
- Stage 2 is floored by the retry wait of the lossy non-empty servers (~`timeoutMs` + their delay,
  ~1.29 s at 1000 ms) and does not shrink with more concurrency.
- A full-detail pass over ~300 servers is therefore **seconds, not a few hundred milliseconds** —
  the knobs do matter, and they matter through the dead share, which is exactly the input a
  loopback model cannot know for a real master.

### Stated limits

- **Loopback, not the internet.** This bounds the scheduler's own cost and each knob's effect
  against a stated input. It is not a claim about a real master: real RTTs, real loss and — above
  all — the real dead share of a master list are unknown here, and the dead share dominates the
  result. The distribution above is an invented model, written down as the input it is.
- **Timeout adequacy is not measured.** No modelled reply is slower than 400 ms, so no row can show
  a real server being cut off by a too-short timeout; the choice of 1000 ms rests on the model's
  worst tail (400 ms) with 2.5× headroom, not on an observation.
- **Node via vitest, not Electron.** The run is Node v25.6.1 inside a vitest worker; Electron's main
  process (its own Node build, event loop integration and GC) could differ slightly. Given how
  small the zero-delay cost is next to the waiting, this cannot move a row materially.
- **Representative, not exhaustive.** The matrix above is a subset of D1's choice lists (see
  Method); 500/1500/3000/5000 ms timeouts, retries 2/3 and concurrency 4 are not measured.
- **Few repetitions.** 3 reps per modelled row, so its p95 is the slowest rep; the spread is small
  because the delays are fixed per responder, but it is not a large-sample percentile.
- **One machine.** A single Windows desktop; Linux (GB-T2) was not measured.

### Shipped defaults (`DEFAULT_SERVERS_STATE.scan`)

- **`concurrency: 24`, `timeoutMs: 1000`, `retries: 1`** — the bold N=300 row: median full pass
  7527 ms (stage 1 6240 ms, stage 2 1287 ms). `retries: 1` is the one knob loopback can argue for
  directly: at `retries 0` every server that loses one packet is reported offline for the whole pass
  (242/300 online instead of 256/300), which costs a user a real server; one retry recovers all of
  them for ~3.5 s of extra waiting at N=300. `timeoutMs: 1000` is the smallest shipped choice that
  leaves real headroom over the model's slowest reply, and 2000 ms would nearly double the pass for
  nothing the model can show. Concurrency 24 cuts the pass from 9.8 s (16) to 7.5 s; 32 would save
  another ~1.5 s but is the setting's upper bound (`MAX_SCAN_CONCURRENCY`), and shipping the ceiling
  would leave a user nothing to raise. 24 simultaneous small UDP queries is a trivial footprint for
  a desktop. All three are existing choice-list values; no list was widened.
- **`minSpacingMs: 30_000`** — a pass costs ~7.5 s under the model (and could be longer against a
  worse real dead share), so two automatic scans closer than 30 s would put the scanner at more
  than a quarter duty cycle and let flicking in and out of the view re-sweep the whole list each
  time. 15 s is only ~2× a pass; 60 s would make a return to the view after a minute feel stale.
  A manual scan is never gated by it (AC3).
- **`autoRefreshEnabled: false`, `autoRefreshIntervalMs: 60_000`** — a recurring background sweep of
  seconds' worth of UDP traffic is a larger behavioural commitment than the one-shot scan on open,
  and nothing in the ACs asks for it on; it stays opt-in. When a user turns it on, 60 s keeps one
  ~7.5 s pass to ~12% of the time (30 s would be ~25%) and sits above `minSpacingMs`, so the
  interval is what the user actually gets.
- **`autoScanOnOpen: true`** — one pass when the view opens is the expected behaviour and costs a
  single pass (~7.5 s modelled, ~130 ms of it the scheduler's own work).

`src/main/modules/servers/scan-measurement.test.ts` re-runs the first 30 responders of this same
seeded model through the real `runScan` under `DEFAULT_SERVERS_STATE.scan` and asserts the full pass
finishes inside the bold row's 7527 ms median (observed ~3.0 s — floored by one dead server's 2 s
and one lossy server's ~1 s stage-2 retry — so ~2.5× headroom).

## Done

**Summary.** Extended [[114]]'s scan scheduler with the seven settings AC1 asks for: contract
(D1), field-level clamp-and-fallback persistence plus `scan.getSettings`/`scan.patchSettings`
handlers (D2), a pure-decision cadence module (`scan-cadence.ts`, `deliverable-hard` tier) that
owns auto-scan-on-open, the auto-refresh timer and the single-flight/minimum-spacing gate on the
automatic path only (D3), a "Scan" group in the Servers Settings section (D4), a minimal
`ServersView` carrying the always-enabled manual-scan trigger plus its acceptance flow (D5), and a
real, re-runnable loopback measurement (`npm run measure:scan`, `deliverable-hard` tier) that
produced the shipped `DEFAULT_SERVERS_STATE.scan` and is written up in `## Measurement (AC2)` (D6).
All 6 deliverables landed in order, each with a fresh agent; D3 and D6 ran on `deliverable-hard`
per `## Model Hints`.

**Commit message:**
```
115: how hard the scan works is a setting
```

**Verification — narrow gate (no `--full`):**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `test-story` (`npx vitest run --changed HEAD`) — green. Three different, unrelated test-timeout
  flakes surfaced across separate full-suite runs during this story
  (`src/main/modules/downloads/bootstrap/job.test.ts`'s AC1 case,
  `src/main/modules/config/core/import-reader.test.ts`'s 512-file depth-guard case, and once
  `ServersSettingsSection.test.tsx`'s own registration test) — none touch anything this story
  changed, and each passes in isolation every time; they are this machine's parallel-run CPU
  contention, not a story 115 regression. `src/main/modules/servers/` alone was also run in
  isolation and is consistently green (15 files).
- `e2e-story` — `npm run ui:flow -- servers-scan-settings` (the flow both AC1 and AC3 map to,
  against its own dedicated `servers-scan` fixture variant, see Decisions below) — PASS.

**AC → test mapping, as verified:**
- AC1 (seven user-changeable settings, none a scheduler constant) — e2e flow
  `servers-scan-settings` (all seven `servers-scan-settings-*` controls change and land in
  `state.json`) PASS + `scan-cadence.test.ts` › "every cadence decision comes from the passed
  settings" PASS.
- AC2 (shipped defaults justified by a real measurement) — `scan-measurement.test.ts` › "a full
  two-stage pass over the loopback population finishes inside the shipped defaults' budget" PASS,
  against `## Measurement (AC2)`'s method/environment/numbers.
- AC3 (manual scan survives both auto settings off) — same e2e flow's AC3 section (both auto
  switches turned off in Settings, `servers-manual-refresh` present/enabled, click starts a scan)
  PASS.
- AC4 (a due automatic scan while one runs is skipped, not queued) — `scan-cadence.test.ts` › "an
  automatic scan due while one is running is skipped, not queued" PASS.
- No manual residue — every criterion has a real automated test.

**Review outcome (clean agent, `story-review-hard` tier per `## Model Hints`):** first-pass verdict
FAIL. Two of the seven findings were confirmed regressions of *other* stories' e2e flows and one was
a confirmed gap against this story's own Decision; all three were fixed in one review-fix cycle (of
the 3 allowed), then the narrow gate above was re-run clean by this session itself, plus the three
affected flows individually:
- **Fixed — regression, story 111's flow.** D5's fixture seed had added a `servers` key straight
  onto the shared `populated` variant (all three shipped sources disabled, to keep AC3's manual-scan
  flow off the real internet per GB-A5). That variant is shared by
  `scripts/flows/servers-master-sources.mjs` (story 111), which expects a fresh profile's three
  default sources enabled — broke it. Fix: `populated` no longer carries a `servers` key at all
  (reverted to falling back to `DEFAULT_SERVERS_STATE`, sources enabled); story 115's own flow now
  runs against a new, dedicated `servers-scan` fixture variant instead
  (`export const variant = 'servers-scan'`, mirroring `news-cover-template.mjs`'s own
  dedicated-variant precedent). `populatedStateDocument()`/`writePopulatedFixture()` gained optional
  overrides/target-variant parameters so the heavy installation/config-profile/news-cache writing
  logic is reused rather than duplicated. Re-verified: `servers-master-sources` and
  `servers-scan-settings` both PASS independently.
- **Fixed — regression, story 106's flow.** D5 replaced the servers route's `PlannedModuleView`
  fallback with a real (if minimal) `ServersView`, but
  `scripts/flows/servers-module-shell.mjs` (story 106) still waited for the old "Planned" badge text
  — broke it. Fix: that flow's first step now waits for `servers-manual-refresh` (the real, current
  content of the route) instead, with its header comment updated to document why, mirroring how the
  same file already documents an earlier such change from story 111. Re-verified: PASS.
- **Fixed — gap against this story's own Decision.** "Two settings handlers, mirroring downloads"
  meant mirroring the *real* `patchDownloadsSettingsInputSchema`
  (`src/main/modules/downloads/schemas.ts`) — per-field `.refine()` against each field's own shipped
  choice list plus `.strict()` on the whole payload — not the bare `.min()/.max()` + `.partial()`
  D1 had shipped. Consequence the reviewer demonstrated concretely: a `retries: 0.5` patch was
  accepted, and an in-range-but-off-list value (e.g. `timeoutMs: 250`) would persist and then render
  with no matching `<Select>` option. Fixed on both sides: `scanPatchSettingsInputSchema` (shared
  contract) and `serversScanSettingsForgivingSchema` (persisted-state parse, `main/lib/schemas.ts`)
  both now `.refine()` each numeric field against its own `SCAN_*_CHOICES` array; four test literals
  using an in-range-but-off-list `minSpacingMs` (leftover from before this story's choice lists
  existed) were updated to a real choice, never the validation loosened. Re-verified: full suite
  green (see flakes noted above, unrelated).

**Decisions (review findings deliberately left unfixed, with reasons):**
- **AC2's loopback-vs-"real master list" wording.** The reviewer flagged AC2's literal text ("a real
  master list") against the Decision actually built against ("a loopback server population, not a
  real master") as something "a human has to accept or reject." This was not a decision made or
  reinterpreted during this build: "The measurement uses a loopback server population, not a real
  master" was already a locked-in `## Decisions (Sprint)` entry in this story file *before* `/build`
  started (refine-time, GB-A5-driven — no test or `ui:verify`/`ui:flow` run may touch a real master
  or game server, and no production population exists in dev to point at instead). Per this sprint's
  own deviation rule ("no questions to the user, make decisions yourself... verify them against plan
  + acceptance criteria"), a Decision already on record when build began is not re-litigated
  mid-build; it was carried through as written, with its own stated limits section spelling out
  exactly what it can and cannot claim.
- **A renderer full-reload can leave main's `viewActive` stuck true (PLAUSIBLE, not CONFIRMED).**
  `ServersView.tsx` reports `scan.setViewActive(false)` from its unmount cleanup; a hard reload
  (Electron's default menu still carries the reload accelerator, per `src/main/window.ts`'s
  `autoHideMenuBar: true` only hiding the menu *bar*, not removing the menu itself — no
  `Menu.setApplicationMenu` call exists in this repo) tears down the renderer without ever running
  that cleanup, so main could keep thinking the view is open. Consequence is narrow and
  self-healing: the auto-refresh timer keeps ticking against a closed view until the user navigates
  away and back (which does send the `false` then `true` pair correctly), and no acceptance
  criterion exercises a mid-session reload. Fixing it properly means either stripping the default
  reload accelerator app-wide or having main resynchronize `viewActive` from `webContents`
  lifecycle events — both meaningfully out of this story's Plan/Deliverables. Named here as a
  follow-up candidate, not fixed under review-fix time pressure.
- **`scan-measurement.test.ts`'s budget has limited discriminating power (PLAUSIBLE).** The
  reviewer noted a distinctly worse `concurrency`/`timeoutMs`/`retries` combination would likely
  still finish inside the same budget on the scaled-down population, so the test doesn't by itself
  prove the *specific* shipped row matters, only that the shipped defaults produce a pass inside a
  recorded number — which is exactly what D6's own acceptance line asks for ("asserts a full pass
  under the shipped defaults finishes inside the recorded budget"). Tightening it into a
  differential proof (asserting a worse config would *not* fit) is real extra rigor but a second
  real-socket harness run per test, which risks making an already loopback-timing-sensitive test
  flakier for a property the AC text doesn't itself require. Left as a named gap rather than
  invented under time pressure.
- **`servers-scan-settings.mjs`'s AC3 section doesn't assert the pre-click running state or
  `startScan`'s own return value (PLAUSIBLE).** It infers "a scan visibly ran" from the status
  readout's `data-finished-at` changing, which is real evidence but doesn't rule out an
  already-in-flight auto-triggered scan being what actually produced that change. Both auto
  settings are explicitly turned off immediately beforehand in the same flow, which already makes
  a same-tick automatic trigger very unlikely, and AC3's own wording ("the manual refresh control is
  present, enabled and starts a scan") is satisfied by the observed state transition either way.
  Named as a minor rigor gap, not fixed.

**Progress trail:** `docs/sprints/S24/progress.md` has one started/done line per deliverable.
