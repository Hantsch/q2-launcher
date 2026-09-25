---
id: 116
title: no scan runs while the game does
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user who is actually playing Quake II never has the launcher compete with the game for the
network path or the CPU in the background — no auto-refresh fires while a session is live, and if
that same user alt-tabs back to the launcher and hits "refresh" out of habit, the launcher says why
it won't, instead of quietly doing it anyway or quietly doing nothing. This is the one rule in the
whole scan story that is not a setting: "kein autoscan während das spiel läuft auf jeden fall"
(game-browser.md §3), restated as a permanent non-goal (§2) and as GB-N5. It sits on top of
[[114]]'s scheduler and [[115]]'s cadence settings — the cadence decides *when* a scan is due, this
story decides that a due scan still does not run if a game is live, no matter what the cadence says.

The launcher already knows whether a game is running — `LaunchService` tracks `LaunchState.phase`
(`starting` / `running` count as an active session; `handed-off` does not, since the launcher loses
track of a Steam-handed-off process, per `src/shared/types/launch.ts`), and
`InstallationWriteGuard` already reads exactly that state to defer installation writes. This story
reuses that existing launch-state awareness for the scan guard rather than inventing a second way to
ask "is the game running" — the answer already exists in one place.

The second half of this story is what happens to a server the scan couldn't reach this round,
whether because a scan was skipped or because that one server simply timed out: it keeps showing
what the launcher last knew about it, marked stale, and is never redrawn as an empty server just
because this round has no fresher answer (GB-N6). An empty-looking row that is actually just old
data is worse than no data, because it tells the user the opposite of the truth.

## Acceptance Criteria

- [ ] **AC1** — An auto-refresh that comes due while a game session is active (launch phase
      `starting` or `running`) is skipped for that round, not queued to run once the session ends;
      the view states the reason visibly.
- [ ] **AC2** — A manual scan attempted while a game session is active is refused, showing the same
      visible reason as AC1, not silently ignored and not queued.
- [ ] **AC3** — A server that receives no reply this scan round (skipped round, or that one server
      timing out) keeps showing its last known data, visibly flagged as stale — it is never shown
      with zero players or as absent.
- [ ] **AC4** — The moment the active game session ends, scanning resumes on its normal cadence
      without any user action — no stale "still blocked" state survives past the session's end.

## Open Questions

<!-- None. The one cross-story question (is a scan a `Job`?) was answered in story 115 and is
carried into this story's Decisions below. -->

## Decisions (Sprint)

- **D-A — The guard reads the scan scheduler directly, not `jobs:changed`.** [[115]]'s recorded
  decision is that a scan is *not* a `Job`; the scheduler owns its own state and pushes a dedicated
  `module:event`, so the guard lives inside that scheduler and `JobsService` /
  `InstallationWriteGuard` are untouched by this story.
- **D-B — The scheduler contract this story attaches to.** 116 assumes [[114]]/[[115]] give the
  scheduler (`src/main/modules/servers/scan-scheduler.ts`) an auto-tick path, a manual
  `scan.start`-style entry point, a `getScanState()` and a state push; this story adds exactly one
  new constructor dependency (`launch`) and one new branch in each of those two paths — if [[114]]
  named them differently, the guard adapts to those names and nothing else.
- **D-C — The block is launcher-wide, not per installation.** Unlike `InstallationWriteGuard` (which
  blocks writes to *that* installation's files), the contention here is the network path and the
  CPU, so *any* active session blocks *every* scan.
- **D-D — `handed-off` does not block.** The launcher has no reliable knowledge of a
  Steam-handed-off process, so the guard uses exactly `LaunchService.isRunning()`'s predicate
  (`starting` / `running`) rather than inventing a wider one.
- **D-E — Reuse `LaunchHost`, don't import `LaunchService`.** The guard takes the same structural
  `{ getState, onStateChange }` interface `src/main/services/write-guard.ts` already defines, so the
  servers module keeps zero dependency on the launch service's concrete class.
- **D-F — A refused manual scan is a result union, never a thrown error.** The servers module
  already answers refusals that way (`MasterSourcesResult`, `ManualServerAddResult`), and a refusal
  the user caused is not an exception.
- **D-G — "Resume" means re-evaluating due-ness, not replaying the skipped round.** On unblock the
  scheduler clears the blocked reason and re-runs the normal cadence predicate ("has the interval
  elapsed since the last *completed* scan?"); nothing about the skipped round is remembered, which
  is how AC4 and AC1's "not queued" hold at the same time.
- **D-H — The reason is visible text, and main stays authoritative.** The view shows a blocked
  banner and disables the refresh control with the reason rendered as text (CLAUDE.md's visible-text
  rule, same shape as the platform-parity treatment); the renderer's disabled state is convenience
  only — the scheduler refuses the call regardless, as story 091 decided for `launch:start`.
- **D-I — One i18n key, `servers.scan.blocked.gameRunning`.** Main pushes the key, never prose
  (CLAUDE.md), mirroring `jobs.waiting.gameRunning`.
- **D-J — A skipped round marks nothing stale; a queried-but-silent server does.** A round that
  never ran asked no question and is therefore no evidence a server went quiet — its entries stay
  exactly as they were (AC3's "keeps showing its last known data"), and the blocked banner is what
  tells the user the list is not being refreshed right now. Only a server that was actually queried
  and did not answer gets `stale: true`.
- **D-K — 116 ships the minimal visible stale indication only.** The row's full marker set
  (password, gamemode, favourite, stale, waiting-for-opponent) is [[118]]'s story; 116 adds the data
  rule plus a plain, testable stale label so AC3 is provable on the real surface without pre-empting
  that design.
- **D-L — No new scan trigger.** The manual refresh control comes from [[114]]/[[115]] (GB-N3); this
  story only adds the guard branch and the banner to it — it must not invent a second trigger.
- **D-M — The e2e proof needs no network.** The flow seeds a manual server on a dead loopback port
  (guaranteed timeout, offline-safe) plus a pre-seeded known-server entry with players, and seeds a
  short per-query timeout and a short auto-refresh interval through [[115]]'s own settings, so both
  the timeout path and the "resumes on its normal cadence" path finish inside a flow's budget.
- **D-N — A running game is simulated the way the repo already does it.** The flow drives the real
  `dev:simulateLaunch` channel (as `scripts/flows/job-waits-for-running-game.mjs` does), so no real
  Quake II process is needed and AC1/AC2/AC4 run on the real surface rather than as manual residue.
- **D-P — The guard feeds [[115]]'s cadence decision, it does not run beside it.** [[115]] (now
  `ready`) puts every skip decision into one pure `src/main/modules/servers/scan-cadence.ts`
  (interval due-check, minimum spacing, single-flight), so 116 adds `gameRunning` as an input to that
  same decision and `'game-running'` as one more skip reason — two independent "should this scan
  run?" paths is exactly how one of them ends up not being consulted.
- **D-Q — The manual refresh control is [[115]] D5's.** 115 already guarantees the Servers view has
  a manual refresh control that ignores both auto settings; 116 only adds its blocked state, and
  minimum spacing still never applies to it (115's decision) — a manual scan is refused for a running
  game and for nothing else.
- **D-R — No platform-parity caveat.** Launch state and the scheduler work identically on Windows
  and Linux, so nothing here is disabled-with-a-reason on either platform.

## Plan

The guard is one predicate, two call sites and one visible reason. Order follows the data flow.

1. **Shared contract first** (`src/shared/modules/servers.ts`): a `ScanBlockedReason`
   (`'game-running'`) on the scan state [[114]] pushes, a `ScanStartResult` refusal union for the
   manual entry point (mirror: `MasterSourcesResult` in the same file), and `stale: boolean` on the
   known-server entry [[114]] defines.
2. **Pure guard** (`src/main/modules/servers/scan-guard.ts`, new): `isScanBlocked(LaunchState)`,
   fed as one more input into [[115]]'s pure `scan-cadence.ts` decision (D-P), plus its own test.
   Mirror: `src/main/services/write-guard.ts` for the `LaunchHost` interface and the `onStateChange`
   subscription shape — the guard itself is far simpler (no waiting, no deferral, no job).
3. **Wire it into the scheduler** ([[114]]'s `scan-scheduler.ts`, `src/main/context.ts`): the auto
   tick skips the round and publishes the blocked reason; the manual entry point returns the
   refusal; an `onStateChange` to a non-active phase clears the reason and re-evaluates due-ness
   (D-G).
4. **Stale merge** (`src/main/modules/servers/scan-merge.ts`, new): a finished round merges into the
   known-server map — a server with no reply keeps its previous entry with `stale: true`, is never
   replaced by a zero-player entry and never removed.
5. **Renderer** (`src/renderer/src/modules/servers/`, `i18n/locales/en.json`): blocked banner,
   refresh control disabled with the reason as visible text, stale label on the row.
6. **The offline e2e flow** (`scripts/flows/servers-no-scan-while-playing.mjs` + a fixture writer)
   proving all four criteria on the real surface.

Untouched by design: `JobsService`, `InstallationWriteGuard`, `LaunchService` (read-only through
`LaunchHost`), and every other module's shell.

## Deliverables

- **D1 — Shared scan-guard contract.** `ScanBlockedReason`, the scan state's `blockedReason` field,
  the `ScanStartResult` refusal union, and `stale` on the known-server entry.
  Files: `src/shared/modules/servers.ts`, `src/shared/modules/servers.test.ts`.
  Mirror: the `MasterSourcesResult` refusal union already in that file.
  *Accepted when:* the types/schemas compile against [[114]]'s scan state and the schema test covers
  the new fields.

- **D2 — The pure guard, folded into the cadence decision.** `isScanBlocked(state: LaunchState):
  boolean` (exactly `starting`/`running`) in its own module, plus `gameRunning` as an input to
  [[115]]'s pure `scan-cadence.ts` decision and `'game-running'` as one more skip reason there — one
  decision function, not two (D-P).
  Files: `src/main/modules/servers/scan-guard.ts` (new),
  `src/main/modules/servers/scan-guard.test.ts` (new), `src/main/modules/servers/scan-cadence.ts`
  (+ its existing `.test.ts`).
  Mirror: `src/main/services/write-guard.ts` (`LaunchHost`, `isBlockedFor`).
  *Accepted when:* the unit test covers every `LaunchPhase`, including `handed-off` → not blocked,
  and the cadence decision returns `game-running` ahead of every other skip reason.

- **D3 — Scheduler wiring: skip, refuse, resume.** Inject `launch: LaunchHost` into [[114]]'s
  scheduler and `src/main/context.ts`; an auto tick that is due-and-blocked skips the round without
  queueing and publishes `blockedReason`; the manual entry point returns the refusal; a launch state
  change out of an active phase clears the reason, pushes the new state and re-evaluates due-ness
  (D-G).
  Files: `src/main/modules/servers/scan-scheduler.ts`, `src/main/modules/servers/index.ts`,
  `src/main/context.ts`, plus its test in `src/main/modules/servers/scan-scheduler.test.ts` (fake
  timers + a stub `LaunchHost`).
  *Accepted when:* the test proves skip-not-queue, manual refusal, and exactly one resumed scan
  after unblock (never two).

- **D4 — The stale merge rule.** A completed round merges results into the known-server map: no
  reply → previous entry kept with `stale: true`; a reply → entry replaced with `stale: false`; a
  skipped round changes nothing (D-J).
  Files: `src/main/modules/servers/scan-merge.ts` (new), `src/main/modules/servers/scan-merge.test.ts`
  (new), called from the scheduler.
  *Accepted when:* the unit test shows a timed-out server keeps its player count and is neither
  zeroed nor dropped.

- **D5 — The visible reason and the stale row.** Blocked banner + refresh control disabled with the
  reason as text, and a stale label on a stale row.
  Files: `src/renderer/src/modules/servers/` (the view/store [[114]] builds — banner component + row
  label), `src/renderer/src/i18n/locales/en.json` (`servers.scan.blocked.gameRunning`,
  `servers.row.stale`), plus a renderer test next to the touched component.
  Testids: `servers-scan-blocked`, `servers-refresh`, `servers-row-stale-<address>`.
  Mirror: `JobRow.tsx`'s waiting-reason line (`downloads-job-waiting-<id>`).
  *Accepted when:* the reason is real text in the DOM (not a `title`), and the refresh control is
  disabled while blocked.

- **D6 — The offline e2e flow.** `scripts/flows/servers-no-scan-while-playing.mjs` plus the fixture
  writer it needs (a servers `state.json` seed: one manual server on a dead loopback port, one
  pre-seeded known-server entry with players, a short timeout and a short auto-refresh interval).
  Files: `scripts/flows/servers-no-scan-while-playing.mjs` (new), `scripts/lib/fixture.mjs`.
  Mirror: `scripts/flows/job-waits-for-running-game.mjs` (its `dev:simulateLaunch` helper and pass
  ordering), `scripts/flows/servers-master-sources.mjs` (servers fixture/nav plumbing).
  *Accepted when:* the flow passes offline via `npm run ui:flow -- servers-no-scan-while-playing`
  and covers AC1–AC4 in one app session.

## Model Hints

- D3 → `deliverable-hard` — the only piece with a real race: a cadence timer, a launch-state
  subscription and a "skip but do not queue, then resume exactly once" rule meeting in one object,
  wired into `context.ts` where a wrong subscription order silently disables the guard.
- D1, D2, D4, D5, D6 → default.
- Review: → `story-review-hard` — the value of this story is a *negative* behaviour (nothing runs, no
  queue survives), which a green suite can mask if the guard is wired into only one of the two entry
  points; that is exactly the class of gap a cheap review misses.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-no-scan-while-playing.mjs` › "servers-no-scan-while-playing"
  (simulate `running`, let the seeded short auto-refresh interval come due, assert no scan ran and
  `servers-scan-blocked` names the running game); unit
  `src/main/modules/servers/scan-scheduler.test.ts` › "a due auto-refresh while the game runs is
  skipped, not queued".
- AC2 → e2e `scripts/flows/servers-no-scan-while-playing.mjs` › "servers-no-scan-while-playing"
  (click `servers-refresh` while `running`: same visible reason, and the real IPC result is the
  `game-running` refusal); unit `src/main/modules/servers/scan-scheduler.test.ts` › "a manual scan
  while the game runs is refused".
- AC3 → unit `src/main/modules/servers/scan-merge.test.ts` › "a server that does not answer keeps
  its last known data and is marked stale"; e2e
  `scripts/flows/servers-no-scan-while-playing.mjs` › "servers-no-scan-while-playing" (the
  dead-loopback server's seeded player count survives a real round and its row shows
  `servers-row-stale-<address>`).
- AC4 → e2e `scripts/flows/servers-no-scan-while-playing.mjs` › "servers-no-scan-while-playing"
  (`dev:simulateLaunch` → `idle` with no further interaction: the banner disappears and a scan runs
  on the normal cadence); unit `src/main/modules/servers/scan-scheduler.test.ts` › "scanning resumes
  once the session ends".

No manual residue.

### Coverage gate

| AC | Deliverable | Test |
| --- | --- | --- |
| AC1 | D1, D3, D5 | e2e flow + `scan-scheduler.test.ts` |
| AC2 | D1, D3, D5 | e2e flow + `scan-scheduler.test.ts` |
| AC3 | D1, D4, D5 | `scan-merge.test.ts` + e2e flow |
| AC4 | D2, D3, D5 | e2e flow + `scan-scheduler.test.ts` |

## Done

<!-- Filled by `/build 116`. -->
