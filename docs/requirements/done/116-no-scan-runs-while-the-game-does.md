---
id: 116
title: no scan runs while the game does
status: done # draft -> ready -> in-progress -> done
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

- [x] **AC1** — An auto-refresh that comes due while a game session is active (launch phase
      `starting` or `running`) is skipped for that round, not queued to run once the session ends;
      the view states the reason visibly.
- [x] **AC2** — A manual scan attempted while a game session is active is refused, showing the same
      visible reason as AC1, not silently ignored and not queued.
- [x] **AC3** — A server that receives no reply this scan round (skipped round, or that one server
      timing out) keeps showing its last known data, visibly flagged as stale — it is never shown
      with zero players or as absent.
- [x] **AC4** — The moment the active game session ends, scanning resumes on its normal cadence
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

- [x] **D1 — Shared scan-guard contract.** `ScanBlockedReason`, the scan state's `blockedReason` field,
  the `ScanStartResult` refusal union, and `stale` on the known-server entry.
  Files: `src/shared/modules/servers.ts`, `src/shared/modules/servers.test.ts`.
  Mirror: the `MasterSourcesResult` refusal union already in that file.
  *Accepted when:* the types/schemas compile against [[114]]'s scan state and the schema test covers
  the new fields.

- [x] **D2 — The pure guard, folded into the cadence decision.** `isScanBlocked(state: LaunchState):
  boolean` (exactly `starting`/`running`) in its own module, plus `gameRunning` as an input to
  [[115]]'s pure `scan-cadence.ts` decision and `'game-running'` as one more skip reason there — one
  decision function, not two (D-P).
  Files: `src/main/modules/servers/scan-guard.ts` (new),
  `src/main/modules/servers/scan-guard.test.ts` (new), `src/main/modules/servers/scan-cadence.ts`
  (+ its existing `.test.ts`).
  Mirror: `src/main/services/write-guard.ts` (`LaunchHost`, `isBlockedFor`).
  *Accepted when:* the unit test covers every `LaunchPhase`, including `handed-off` → not blocked,
  and the cadence decision returns `game-running` ahead of every other skip reason.

- [x] **D3 — Scheduler wiring: skip, refuse, resume.** Inject `launch: LaunchHost` into [[114]]'s
  scheduler and `src/main/context.ts`; an auto tick that is due-and-blocked skips the round without
  queueing and publishes `blockedReason`; the manual entry point returns the refusal; a launch state
  change out of an active phase clears the reason, pushes the new state and re-evaluates due-ness
  (D-G).
  Files: `src/main/modules/servers/scan-scheduler.ts`, `src/main/modules/servers/index.ts`,
  `src/main/context.ts`, plus its test in `src/main/modules/servers/scan-scheduler.test.ts` (fake
  timers + a stub `LaunchHost`).
  *Accepted when:* the test proves skip-not-queue, manual refusal, and exactly one resumed scan
  after unblock (never two).

- [x] **D4 — The stale merge rule.** A completed round merges results into the known-server map: no
  reply → previous entry kept with `stale: true`; a reply → entry replaced with `stale: false`; a
  skipped round changes nothing (D-J).
  Files: `src/main/modules/servers/scan-merge.ts` (new), `src/main/modules/servers/scan-merge.test.ts`
  (new), called from the scheduler.
  *Accepted when:* the unit test shows a timed-out server keeps its player count and is neither
  zeroed nor dropped.

- [x] **D5 — The visible reason and the stale row.** Blocked banner + refresh control disabled with the
  reason as text, and a stale label on a stale row.
  Files: `src/renderer/src/modules/servers/` (the view/store [[114]] builds — banner component + row
  label), `src/renderer/src/i18n/locales/en.json` (`servers.scan.blocked.gameRunning`,
  `servers.row.stale`), plus a renderer test next to the touched component.
  Testids: `servers-scan-blocked`, `servers-refresh`, `servers-row-stale-<address>`.
  Mirror: `JobRow.tsx`'s waiting-reason line (`downloads-job-waiting-<id>`).
  *Accepted when:* the reason is real text in the DOM (not a `title`), and the refresh control is
  disabled while blocked.

- [x] **D6 — The offline e2e flow.** `scripts/flows/servers-no-scan-while-playing.mjs` plus the fixture
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
  `src/main/modules/servers/scan-cadence.test.ts` › "AC1: a due auto-refresh while the game runs is
  skipped, not queued" (+ "AC1/D-G: nothing about a skipped round is replayed - resume re-derives
  due-ness from lastScanAt"); ordering proof: `src/main/modules/servers/scan-cadence.test.ts` ›
  "game-running wins ahead of every other skip reason (story 116 D2)".
- AC2 → e2e `scripts/flows/servers-no-scan-while-playing.mjs` › "servers-no-scan-while-playing"
  (click `servers-refresh` while `running`: same visible reason, and the real IPC result is the
  `game-running` refusal); unit `src/main/modules/servers/scan-service.test.ts` › "AC2: a manual
  scan while the game runs is refused, not queued, and no sweep runs" (+ "the game-running refusal
  wins over the single-flight refusal").
- AC3 → unit `src/main/modules/servers/scan-merge.test.ts` › "flips an unanswered target with a
  pre-existing entry to stale, keeping every other field (D4 acceptance)" (+ "creates no row for an
  unanswered target with no pre-existing entry"; + "changes nothing at all when the round was
  aborted, even for an unanswered target with an entry" for the skipped-round half of D-J); e2e
  `scripts/flows/servers-no-scan-while-playing.mjs` › "servers-no-scan-while-playing" (a real first
  scan establishes a known-server entry with players via a throwaway loopback responder the flow
  itself runs - `ScanService`'s known-server map is in-memory-only and cannot be pre-seeded via
  `state.json`, see the flow's own header comment for this adaptation from the original plan; the
  responder is then silenced, a later round finds it silent, and its row shows
  `servers-row-stale-<address>` while a direct `scan.read` confirms its full player roster survived
  unzeroed).
- AC4 → e2e `scripts/flows/servers-no-scan-while-playing.mjs` › "servers-no-scan-while-playing"
  (`dev:simulateLaunch` → `idle` with no further interaction: the banner disappears and a scan runs
  on the normal cadence); unit `src/main/modules/servers/scan-cadence.test.ts` › "AC4: scanning
  resumes once the session ends - promptly, without waiting for the next tick" (+ "AC4: exactly one
  resumed scan after unblock, never two"); `src/main/modules/servers/scan-service.test.ts` ›
  "AC1/AC4: blockedReason mirrors the live launch state and clears the moment the session ends".

No manual residue.

### Coverage gate

| AC | Deliverable | Test |
| --- | --- | --- |
| AC1 | D1, D3, D5 | e2e flow + `scan-scheduler.test.ts` |
| AC2 | D1, D3, D5 | e2e flow + `scan-scheduler.test.ts` |
| AC3 | D1, D4, D5 | `scan-merge.test.ts` + e2e flow |
| AC4 | D2, D3, D5 | e2e flow + `scan-scheduler.test.ts` |

## Done

**Summary.** Folded a game-running guard into story 114/115's scan scheduler end to end: the
shared contract (D1, `ScanBlockedReason`/`blockedReason`/`SCAN_BLOCKED_GAME_RUNNING_REASON_KEY`),
the pure `isScanBlocked(LaunchState)` predicate plus `gameRunning` wired into `scan-cadence.ts`'s
existing `decideAutoTrigger` as the first-checked skip reason (D2), the scheduler wiring that
skips an auto tick without queueing, refuses a manual `scan.start`, and resumes promptly on unblock
via reactive `blockedReason` mirroring plus a re-armed timer with single-flight as backup (D3,
`deliverable-hard` tier — the highest-risk piece, reviewed hardest), the stale-merge end-of-round
logic extracted into a pure, unit-tested `mergeStaleRound` (D4), the renderer's blocked banner +
disabled refresh control + minimal stale row (D5), and an offline e2e flow proving all four ACs in
one app session against real loopback UDP sockets, no internet (D6). All 6 deliverables landed in
order with a fresh agent each; D3 ran on `deliverable-hard` per `## Model Hints`.

**Commit message:**
```
116: no scan runs while the game does
```

**Verification — narrow gate (no `--full`):**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `test-story` (`npx vitest run --changed HEAD`) — 90/91 files green, 1478/1479 tests green. The
  one failure, `ServersSettingsSection.test.tsx`'s pre-existing registration test, timed out at
  5000ms under full-suite parallel contention on this machine but passed cleanly in isolation both
  times it was checked (before and after the review-fix cycle) — the exact same file/test [[115]]'s
  own Done section already documents exhibiting this identical flake pattern. Not a story 116
  regression: nothing this story touched changed that test or its imports beyond the `blockedReason`
  field already covered by other, passing tests in the same file.
- `e2e-story` (`npm run ui:flow -- servers-no-scan-while-playing`, the one test both AC1/AC2/AC3/AC4
  map to) — PASS, run three times across the build (twice by the D6 agent, once more by this
  session after the review-fix cycle rebuilt the renderer).

**AC → test mapping, as verified** (see `## Acceptance Tests` above, corrected in place per step 7
to the real test names — several deliverable agents phrased them slightly differently than the
plan predicted, and the plan's own `scan-scheduler.test.ts` file name never existed; the real files
are `scan-cadence.test.ts`/`scan-service.test.ts`):
- AC1 — e2e PASS + `scan-cadence.test.ts`'s two named unit tests PASS + the ordering proof PASS.
- AC2 — e2e PASS (both the disabled-button half and the real `module:invoke` refusal-value half)
  + `scan-service.test.ts`'s two named unit tests PASS.
- AC3 — `scan-merge.test.ts`'s three named unit tests PASS + e2e PASS (stale testid in the DOM,
  full player roster confirmed unzeroed via a direct `scan.read` invoke — after the review fix
  below, the roster count is now also visible in the DOM row itself, not just provable via IPC).
- AC4 — e2e PASS + `scan-cadence.test.ts`'s two named unit tests PASS +
  `scan-service.test.ts`'s blockedReason-mirroring test PASS.
- No `manual residue` — every criterion has a real, passing automated test.

**Review outcome (clean agent, `story-review-hard` tier per `## Model Hints`):** first-pass verdict
PASS, with 4 findings (none blocking the verdict). One review-fix cycle (of the 3 allowed) fixed
the two actionable ones; the other two are documented below as deliberately left as-is:
- **Fixed — D5 DOM gap.** `ServersView.tsx`'s row only showed a player count when `entry.players`
  was a bare `number` (the stage-1-only shape); a server that had answered a real `status` reply
  (the roster-array shape `mergeSuccessfulReply` produces once stage 2 lands) showed no player data
  at all once stale, undermining D-K's own "provable on the real surface" intent for AC3. Fixed to
  also read `Array.isArray(entry.players) ? entry.players.length : ...`, with a new renderer test
  covering the roster-array case.
- **Fixed — weak test assertion.** `ServersView.test.tsx` asserted the blocked banner's text with
  `toMatch(/game/i)`/`toBeTruthy()`, which would also pass if the i18n key had failed to resolve
  and rendered its own raw key string (`servers.scan.blocked.gameRunning` itself contains "game").
  Tightened to assert the exact resolved English string for both the banner and the stale label.
  The i18n keys themselves were already correctly wired (verified by the reviewer against the real
  rendered app and its screenshots) — only the test's own rigor was the gap.
- Re-verified after fixes: build/typecheck clean, the same narrow test gate green (same
  pre-existing flake, confirmed unrelated again), e2e flow re-run green against a fresh build.

**Decisions (review findings deliberately left unfixed, with reasons):**
- **A scan already in flight when a game session starts is not aborted (PLAUSIBLE, not
  CONFIRMED).** It keeps sweeping in the background until it finishes on its own, showing
  "Scanning…" next to the blocked banner for that window. No AC or `## Decisions` entry in this
  story asks for an in-flight abort — D-A/D-C scope the guard to skip/refuse *new* scan attempts,
  and the Requirement's "never compete… in the background" is satisfied for every scan that comes
  due *after* the session starts, which is the whole surface this story's ACs describe. Aborting a
  scan that was already running when the game started would be a new decision this story never
  made and a new failure mode (a half-merged round) this story never designed for; left as a named
  follow-up candidate rather than invented under review-fix time pressure.
- **A narrow mount-time race in `ServersView.tsx` (PLAUSIBLE, not CONFIRMED).** The initial
  one-shot `readScan()` can in principle resolve after an earlier `onScanChanged` push and
  overwrite `scanState` with a slightly older `blockedReason`. This is an inherited pattern from
  stories 114/115's own mount sequencing (the same race exists for every other field on
  `scanState`, not one this story introduced), narrow (mount-time only) and self-healing (the very
  next push corrects it) — redesigning the mount race is out of this story's Plan/Deliverables.

**Progress trail:** `docs/sprints/S24/progress.md` has one started/done line per deliverable.
