# Sprint S24 review — The scan engine finds servers and stays out of the way

## Overview

**Goal.** Opening the Servers view runs a real two-stage scan — list rows appear as `info` replies
stream in, player data follows for the servers that have anyone on them — and that scan respects
the user's own cadence settings, never competes with a running game, and can be narrowed to just
favourites or just one server instead of always reloading everything.

| Story | Status | Commit |
| --- | --- | --- |
| [114 — a scan sweeps the servers in two stages](../../requirements/done/114-a-scan-sweeps-the-servers-in-two-stages.md) | done | `114: sweep servers in two stages` |
| [115 — how hard the scan works is a setting](../../requirements/done/115-how-hard-the-scan-works-is-a-setting.md) | done | `115: how hard the scan works is a setting` |
| [116 — no scan runs while the game does](../../requirements/done/116-no-scan-runs-while-the-game-does.md) | done | `116: no scan runs while the game does` |
| [117 — a refresh only reloads what changed](../../requirements/done/117-a-refresh-only-reloads-what-changed.md) | done | `117: a refresh only reloads what changed` |

All four stories built, clean-agent-reviewed and committed on `sprint/S24`. No story was blocked.

## Implemented stories

- **114 — a scan sweeps the servers in two stages.** A new `ScanService` inside the `servers`
  module resolves the address set from every enabled source, every favourite and every manual
  server, sweeps it in a concurrency-capped two-stage pass (`info` then `status` for the non-empty
  servers plus the selected one), and pushes every result to the renderer as `module:event` —
  never polled. A single source failing never aborts the rest of the scan, and a favourite is
  always swept even when no source returns it. Decided (with the user, in the clarification round)
  that a scan is not a `Job` through `JobsService` — it owns its own state and its own event push.
- **115 — how hard the scan works is a setting.** All seven cadence/budget knobs (auto-scan-on-open,
  auto-refresh on/off + interval, concurrency, timeout, retries, minimum spacing) moved out of the
  scheduler and into user-changeable settings, backed by a real, re-runnable loopback measurement
  (`npm run measure:scan`) of a full two-stage pass over 100–300 fake servers — the shipped
  defaults are a row of that table, not a guess. A manual scan always works regardless of the two
  auto settings, and at most one scan is ever in flight.
- **116 — no scan runs while the game does.** A guard reusing the launcher's existing launch-state
  awareness (the same pattern `InstallationWriteGuard` already uses) skips a due auto-refresh and
  refuses a manual scan while a game session is active, with the reason shown as visible text. A
  server that goes unanswered for a round keeps its last-known data, flagged stale, never zeroed or
  dropped — and scanning resumes on its own the moment the session ends.
- **117 — a refresh only reloads what changed.** "Refresh servers", "Refresh favourites" and
  "Refresh this server" all go through the same single `scan.start` entry point with an explicit
  scope, rather than a second implementation of a full scan — the favourites/single-server cases
  reuse 114's own address-set and stage-2 machinery unchanged. Out-of-scope rows are never rewritten
  or staled by a narrower refresh, and all three controls obey 115's single-flight rule and 116's
  no-scan-while-playing guard.

## Findings & decisions

- **Scan is not a `Job`** (user decision, 115): `JobsService` stays scoped to installation-mutating
  work; the scan owns its own state and a dedicated `module:event` push. This shaped how 114 and 116
  were built and is the sprint's one substantive open point, now closed.
- **A full two-stage pass costs seconds, not milliseconds** (115's measurement): under a modelled
  loopback population, a 300-server pass is dominated by waiting on dead/unreachable servers
  (`timeoutMs × (retries + 1)` per dead slot), not by the scheduler's own ~130 ms overhead. This
  directly justified `concurrency: 24`, `timeoutMs: 1000`, `retries: 1`, `minSpacingMs: 30s` as the
  shipped defaults, and answers the concept's own open question about whether tuning is even needed
  — it is, and the numbers say why.
- **`http-list` master sources have no bounded timeout of their own** (114, PLAUSIBLE, not fixed):
  only the shared abort signal can end a hung fetch. Not fixed under this story's own decisions
  (timeout/retry budgets are scoped to the query runner, not source resolution); worth a follow-up.
- **A renderer full reload can leave the scheduler thinking the Servers view is still open** (115,
  PLAUSIBLE, not fixed): narrow, mount-time-adjacent and self-healing on the next navigation; fixing
  it properly means touching the app's reload accelerator or main's `webContents` lifecycle
  handling, out of scope for this sprint.
- **An in-flight scan is not aborted when a game session starts** (116, PLAUSIBLE, not fixed): it
  keeps sweeping in the background until it finishes on its own. No acceptance criterion asked for
  an abort; the guard's job is to skip/refuse *new* attempts, which it does.
- **A scoped refresh (117) overwrites a row's `origins` instead of merging them.** Currently inert —
  nothing in the renderer or main reads `ServerListEntry.origins` yet — but worth fixing before
  story 131's watchlist work is likely to read it.
- Three unrelated single-test timeout flakes surfaced across full-suite runs during the sprint
  (a bootstrap job test, an import-reader depth-guard test, a servers-settings registration test),
  all confirmed passing in isolation — machine/parallelism contention, not product regressions.

## Blocked / open

None. All four stories completed; no question was left for the user beyond the one already
resolved in the clarification round (is a scan a `Job`? — no).

## Regression gate

Ran once on `sprint/S24`'s `HEAD` (`9dc1153`, "117: a refresh only reloads what changed"), after all
four stories were built and committed:

- `npm run build` — green.
- `npm test` (full suite) — green (278 files, 4536 passed, 8 skipped, 0 failed).
- `npm run ui:verify` — green (45/45 screens, axe clean).
- `npm run ui:flows` — red: 45/59 flows passed, 14 failed.

All 14 failures were attributed via `git merge-base dev HEAD` (`9e4e6de`, "sprint 23 done"): every
one fails identically on that pre-sprint commit, before any of stories 114–117 touched the
`servers` module, so none of them are flaky and none bisect to a story in this sprint. Verdict for
all 14: **pre-existing**, not caused by this sprint, not fixed here — the same 14 flows the S23
review already named (`app-update`, `bootstrap-failure`, `bootstrap-failure-retry`,
`bootstrap-incomplete-package`, `bootstrap-r1q2`, `bootstrap-wizard`, `config-header-geometry`,
`controls-subcategory`, `custom-action-row`, `engine-badge-surfaces`, `engine-not-client`,
`harness-offscreen`, `home-hero-carousel`, `news-cover-template`). **The gate is green for
everything this sprint touched; the pre-existing e2e gap is unchanged and already tracked in the
roadmap's follow-ups.**

## Acceptance

Every criterion in this sprint is proven by a named, passing automated test — no story carries a
manual-residue item.

**114 — a scan sweeps the servers in two stages.** No e2e ran: the `servers` route still renders
the shell's `PlannedModuleView` fallback for list UI (that lands with stories 118/121 in S25), so
every criterion here is main-process/IPC behaviour proven one level down instead of through the
real surface — a named, deliberate gap, not a silently-dropped one.
- AC1 (rows stream before the sweep finishes) — `scan-runner.test.ts` + `scan-integration.test.ts`'s
  real-socket test.
- AC2 (stage 2 = non-empty ∪ selected, nothing twice) — `scan-runner.test.ts` + the same integration
  test.
- AC3 (isolated source failure) — `source-resolution.test.ts`.
- AC4 (favourite always swept) — `address-set.test.ts` + the same integration test.
- AC5 (push-only, no polling) — `scan-service.test.ts` + `client.test.ts` + the same integration test.
- AC6 (union dedupe, origins preserved) — `address-set.test.ts` + the same integration test.

**115 — how hard the scan works is a setting.**
- AC1 (seven user-changeable settings) — e2e flow `servers-scan-settings` + `scan-cadence.test.ts`.
- AC2 (defaults justified by a real measurement) — `scan-measurement.test.ts`, against the method,
  environment and result table recorded in the story's own `## Measurement (AC2)` section.
- AC3 (manual scan survives both auto settings off) — the same e2e flow.
- AC4 (a due auto scan while one runs is skipped, not queued) — `scan-cadence.test.ts`.

**116 — no scan runs while the game does.**
- AC1 (a due auto-refresh while playing is skipped, reason visible) — e2e flow
  `servers-no-scan-while-playing` + `scan-cadence.test.ts`.
- AC2 (a manual scan while playing is refused, same reason) — the same e2e flow +
  `scan-service.test.ts`.
- AC3 (an unanswered server keeps its last data, flagged stale) — `scan-merge.test.ts` + the same
  e2e flow.
- AC4 (scanning resumes the moment the session ends) — the same e2e flow + `scan-cadence.test.ts`.

**117 — a refresh only reloads what changed.**
- AC1 ("Refresh servers" is the same sweep, not a parallel one) — e2e flow
  `servers-scoped-refresh` + `scan-scope.test.ts` (deep-equals 114's own address-set resolver).
- AC2 ("Refresh favourites" queries only favourites) — the same e2e flow + `scan-scope.test.ts` +
  `scan-service.test.ts`.
- AC3 ("Refresh this server" issues exactly one `status` query) — the same e2e flow +
  `scan-service.test.ts`.

No `testplan.md` was written — every criterion in this sprint has an automated test and none was
marked manual residue, so there is nothing left that needs walking by hand.
