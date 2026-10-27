---
id: 258
title: Server pings match what I get in game
status: done # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, the ping the server browser shows is close to the ping I get when I join, so the ping
filter and sorting can be trusted.

User feedback 2026-10-26: the same server shows 20, 70 or 400 on repeated refreshes, while in game it is
20–30; occasional outliers of 100–300+ make the ping filter feel wrong.

Today (`src/main/modules/servers/server-query.ts`, `scan-runner.ts`) each scan takes a single `Date.now()`
sample per query, up to 24 queries run concurrently, the receive time is taken on the busy main event loop
while other replies are parsed and IPC events emitted, and a retry overwrites the send timestamp. Nothing
aggregates samples; the filter compares the single latest `rttMs`.

## Acceptance Criteria

- [x] **AC1** — A scan takes 3 ping samples per reachable server.
- [x] **AC2** — When the 3 samples are far apart (threshold in Decisions), 3 more are taken.
- [x] **AC3** — The ping shown, sorted on and filtered on is the median of the samples of the latest scan.
- [x] **AC4** — Each sample is timed against its own send (a late reply to an earlier send is not measured
      against a retry).
- [x] **AC5** — Sample timing uses a monotonic high-resolution clock and is not inflated by the processing of
      other servers' replies (proved with a fake socket that delays processing, not the send/receive).
- [x] **AC6** — Against a local test server with a fixed delay, the shown ping stays within ±5 ms of that
      delay over 10 consecutive scans.
- [x] **AC7** — A full scan with the extra samples takes no more than 1.5× the time of today's scan over the
      same fixture servers.

## Open Questions

## Decisions (Sprint)

- **(User)** Staggered sampling: 3 pings per server; if they are far apart, 3 more; the value shown, sorted
  and filtered on is the median of all samples.
- "Far apart" proposed at the cut: max − min > 20 ms or > 25 % of the median; refine may tune the threshold
  against a measurement and records it here.
- Far apart = max − min > max(20 ms, 25 % of the median), i.e. both bounds must be exceeded: a few ms of
  jitter on a 10 ms ping is not an outlier, and with "or" nearly every near server would pay 3 extra samples
  against AC7's time budget.
- Samples are the stage-1 `info` query: the first successful reply (after its retries, as today) is sample 1;
  further samples are `info` queries with `retries: 0`, sent one after another per server (never two in flight
  for one server); a lost extra sample is simply missing. "Staggered" is read as the 3-then-3 staging, not as
  an added delay, because a delay would only cost scan time.
- The row is emitted once sampling for that server is finished, so the shown ping is never a single sample.
- Median of an even count is the mean of the two middle values; the result is rounded to whole ms because
  display and filter work in whole ms.
- Stage-2 `status` replies no longer overwrite `rttMs` or append to `rttHistory` when the entry already has a
  stage-1 ping from this scan, since one status sample would undo the median.
- Each send (first, retry, extra sample) goes out from its own socket through the existing `ServerUdpImpl`
  seam, so a reply is attributed to the send whose socket it arrived on — Quake II replies carry no sequence id
  to match on (AC4).
- The receive time is stamped as the first statement of the socket's `message` listener and handed to
  `onMessage(data, receivedAt)`; parse/settle is deferred with `setImmediate` so every datagram readable in the
  same poll phase is stamped before any reply is processed (AC5).
- `server-query.ts`'s `systemClock.now` becomes `performance.now()` (monotonic, sub-ms);
  `udp-master-source.ts`'s own clock is untouched because master queries measure no ping.
- LAN mode (`lan-discovery.ts`, broadcast) is out of scope: the feedback is about internet servers, and a
  broadcast round has no per-server send to sample.
- AC7's "today's scan" is the same runner with `pingSamples: 1` over the same population, because the old code
  cannot run side by side with the new in one test.
- AC6's responder runs in a `worker_threads` worker that busy-spins the delay, because a `setTimeout` delay on
  Windows can drift by the 15.6 ms timer tick and would make a ±5 ms assertion flaky.
- AC6 runs under load (30-responder population plus an `onServer` that busy-waits), so a receive stamp taken
  after processing instead of at arrival fails a test rather than needing a hard review to spot.
  **Not reached (build):** measured, that regression still passes AC6 (the 2 ms/row load is short and the median
  of 3 hides one late stamp). A discriminating variant (`pingSamples: 1`, 8 same-delay workers, busy `onServer`)
  was tried and dropped: even correct code reads replies of one burst up to 20 ms late when the loop polls them
  in a later turn, so it was flaky. AC5's fake-socket unit test is the proof for the arrival stamp; AC6 proves
  end-to-end accuracy only.
- (Build) `ScanServiceDeps.pingSamples` passes through to `runScan` so existing call-counting service tests can
  pin `pingSamples: 1`; production never sets it.
- (Build) LAN rounds run the same `runScan` stages after discovery, so a LAN stage-2 `status` reply also keeps the
  stage-1 median (review finding); the broadcast discovery reply itself is unchanged.
- (Build) AC6 reads 41-43 ms against 40 in isolation; under a parallel full-suite run it failed once (48 ms) in
  review from CPU contention with the busy-spin worker. Tolerance is not widened; a red here in the sprint gate
  is contention, re-run the file alone.

## Plan

Root cause is measurement, not the network: one sample, a receive time taken after other work on the busy
main loop, and a retry overwriting the send time. Fixed bottom-up:

1. Pure helper `ping-samples.ts`: median, rounding, far-apart rule, sample counts (D1).
2. `server-query.ts`: monotonic clock, receive time stamped in the socket listener, processing deferred, one
   socket per send so every reply is timed against its own send (D2, the risky one).
3. `scan-runner.ts`: stage 1 takes 3 samples per reachable server, 3 more when far apart, and emits the row
   with `rttMs` = rounded median (D3). Systems doc updated here.
4. `scan-service.ts`: stage 2 no longer overwrites the stage-1 median; history gets one sample per scan (D4).
   Changelog entry here.
5. Real-socket proof over loopback: fixed-delay accuracy under load (AC6) and the time budget (AC7) (D5).

Order D1 → D2 → D3 → D4 → D5. Shared types unchanged: `rttMs` stays the one field display, sort and filter
read (`server-format.ts`, `list-sort.ts`, `list-filter.ts` need no change). No IPC and no renderer change.

## Deliverables

- **D1 — Ping sample maths.** New `src/main/modules/servers/ping-samples.ts` exporting
  `PING_SAMPLES_FIRST = 3`, `PING_SAMPLES_EXTRA = 3`, `medianPing(samples: readonly number[]): number`
  (sorts a copy; even count → mean of the two middle values; rounded to whole ms) and
  `samplesFarApart(samples: readonly number[]): boolean` = `max − min > Math.max(20, 0.25 * median)`
  (unrounded median; fewer than 2 samples → false). Pure, no node imports. Tests in
  `src/main/modules/servers/ping-samples.test.ts`: odd/even median, rounding, far-apart true for
  `[20, 70, 400]`, false for `[20, 24, 31]` and for `[300, 330, 350]` (spread 50 < 25 % of 330), single sample.
- **D2 — Each reply timed against its own send, on a monotonic clock, before other work.** Only
  `src/main/modules/servers/server-query.ts` + `server-query.test.ts` (and keep `lan-discovery.ts`, which imports
  `systemClock` and the handler types, compiling without behaviour change).
  (a) `systemClock.now` → `performance.now()`.
  (b) `ServerUdpHandlers.onMessage` becomes `(data: Uint8Array, receivedAt?: number) => void`;
  `dgramServerUdp` takes an optional clock (default `systemClock`) and calls `now()` as the very first
  statement of its `'message'` listener; `queryServer` uses `receivedAt ?? clock.now()`.
  (c) Every send — the first and each retry — opens its own socket through `udpImpl` (no re-send on one
  socket); each socket's handler closes over its own `sentAt`, read immediately before `socket.send`. A
  reply on any of the query's sockets settles it with `receivedAt − thatSocket.sentAt`; every socket the
  query opened is closed on settle (reply, abort, error, timeout). A retry whose socket fails to open, or whose
  send throws, settles `transport-error`.
  (d) Parse + `settle` of a reply runs through an optional `clock.defer?: (fn: () => void) => void` (default
  `setImmediate`); the timestamp is taken before deferral; a second reply arriving before the deferred one
  ran is ignored; an abort before it ran still wins as `no-reply`.
  Rewrite the file doc comment's "RTT is measured from the last send" bullet. Tests (adapt existing ones to
  per-send sockets and deferral): "a late reply to the first send is timed against the first send, not the
  retry" (fake seam records each opened socket; reply delivered on socket 1 after socket 2's send → RTT =
  receive − send 1); "the receive stamp is taken at arrival, not when the reply is processed" (fake seam
  passes `receivedAt`, fake clock advanced 300 ms before the deferred processing runs → RTT unchanged);
  "every socket of a query is closed when it settles"; "systemClock is monotonic and sub-millisecond"
  (`systemClock.now` is backed by `performance.now`, successive reads non-decreasing).
- **D3 — Stage 1 samples every reachable server.** `src/main/modules/servers/scan-runner.ts` +
  `scan-runner.test.ts`, using D1's `ping-samples.ts`. New `RunScanOptions.pingSamples?: number` (default
  `PING_SAMPLES_FIRST`; `1` reproduces today's single sample — D5's baseline). In stage 1, when the `info`
  query succeeds, the same pool slot sends `pingSamples − 1` further `info` queries one after another
  (`retries: 0`, same `timeoutMs`, same internal signal, each through the injected `queryServer` and raced
  against abort like `queryOne`), collecting each successful `rttMs` together with the first. If
  `pingSamples > 1` and `samplesFarApart(collected)`, `PING_SAMPLES_EXTRA` more follow the same way. The row
  is then emitted once: the first successful result with `rttMs` replaced by `medianPing(collected)`. A failed
  extra sample is dropped and never turns the row into a failure; a failed first query is not sampled. After
  abort no further sample is sent and the row is dropped like any aborted result. Stage 2 unchanged. Update the
  file doc comment and `docs/systems/servers-module.md` (how a scan measures ping: 3 samples, far-apart rule
  → 3 more, median, stage 2 does not override it). Tests: "a reachable server gets 3 info samples" (calls per
  target = 3); "far-apart samples get 3 more" (fake RTTs 20/70/400/… → 6 calls, row `rttMs` = median of 6);
  "close samples get no extra" (20/24/31 → 3 calls); "the emitted ping is the median of the samples"
  (30/90/31 → 31); "an unreachable server is not sampled further"; "abort stops sampling".
  `scan-measurement.test.ts` must stay green.
- **D4 — The list's ping is the stage-1 median.** `src/main/modules/servers/scan-service.ts` +
  `scan-service.test.ts` + `CHANGELOG.md`. In `mergeSuccessfulReply` (~line 252) and its call sites (~lines
  325/392/460): a stage-2 `status` reply keeps the existing entry's `rttMs` and `rttHistory` when that entry
  already got a stage-1 ping in this scan; an entry without one (e.g. the selected server outside the address
  set) takes the status reply's `rttMs` and appends it to history. So history gets exactly one sample per
  scan. LAN path (~line 512) unchanged. Changelog: under `## Unreleased` › `### Fixed`, one line: "Server pings
  are the median of several samples and match the ping you get in game." Tests: "a status reply does not
  overwrite the stage-1 median ping" (stage-1 `rttMs` 25, stage-2 `rttMs` 300 → entry `rttMs` 25, one history
  sample for the scan); "a server only queried in stage 2 takes the status ping".
- **D5 — Real-socket proof: accurate under load, within the time budget.** New
  `src/main/modules/servers/scan-ping-accuracy.test.ts`. First extract `buildProfiles`, `bindResponder`,
  `decodeQueryKind` (and the seeded RNG) from `scan-measurement.test.ts` into
  `src/main/modules/servers/scan-fixture-responders.ts` and import them from both tests — no second copy.
  (a) AC6: a fixed-delay responder (40 ms) runs in a `worker_threads` worker that busy-spins the delay on
  `performance.now()` before replying (built with `buildInfoReplyBytes`/`buildStatusReplyBytes` from
  `@shared/servers/reply-fixtures`), bound on `127.0.0.1`; it is scanned together with the 30-responder
  population through the real `runScan` + real `queryServer`, with an `onServer` that busy-waits 2 ms per row;
  over 10 consecutive scans its emitted stage-1 `rttMs` is within 40 ± 5 ms every time. (b) AC7: the same
  population (no busy `onServer`) scanned 3 times with `pingSamples: 1` and 3 times with the default; the
  median full-pass time of the default is ≤ 1.5 × the baseline's. Shipped `DEFAULT_SERVERS_STATE.scan`
  settings; every socket on `127.0.0.1`. Test names as in `## Acceptance Tests`.

## Model Hints

- D2 → deliverable-hard — replacing one re-sent socket with one socket per send and deferring settlement
  changes the state machine every server row goes through: a socket left open on an early settle, a reply on a
  retry socket after settle, or a double settle between two deferred replies regresses every scan and the
  abort guarantees `scan-runner.ts` relies on.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/servers/scan-runner.test.ts` › "a reachable server gets 3 info samples" (D3)
- AC2 → unit `src/main/modules/servers/scan-runner.test.ts` › "far-apart samples get 3 more" and "close samples
  get no extra" (D3); threshold in `src/main/modules/servers/ping-samples.test.ts` (D1)
- AC3 → unit `src/main/modules/servers/scan-runner.test.ts` › "the emitted ping is the median of the samples"
  (D3) + `src/main/modules/servers/scan-service.test.ts` › "a status reply does not overwrite the stage-1 median
  ping" (D4). Display, sort and filter all read that same `rttMs` (existing `list-sort`/`list-filter` tests);
  not a user action, so no e2e flow.
- AC4 → unit `src/main/modules/servers/server-query.test.ts` › "a late reply to the first send is timed against
  the first send, not the retry" (D2)
- AC5 → unit `src/main/modules/servers/server-query.test.ts` › "the receive stamp is taken at arrival, not when
  the reply is processed" and "systemClock is monotonic and sub-millisecond" (D2); under real load also AC6's
  test (D5)
- AC6 → integration `src/main/modules/servers/scan-ping-accuracy.test.ts` › "a fixed-delay server reads within
  5 ms of its delay over 10 scans under load" (D5)
- AC7 → integration `src/main/modules/servers/scan-ping-accuracy.test.ts` › "sampling keeps a full scan within
  1.5x of a single-sample scan" (D5)

## Done

Servers now take 3 `info` ping samples per reachable server (3 more when max − min > max(20 ms, 25 % of the median))
and show the rounded median. Each send has its own socket and send stamp, the receive time is stamped on a
monotonic `performance.now()` first thing in the socket listener with processing deferred, and stage 2 (online and
LAN) no longer overwrites the stage-1 median. Real-socket tests prove fixed-delay accuracy and the time budget.

Commit: `258: server pings are the median of 3–6 samples — per-send sockets, monotonic arrival stamp, stage 2 keeps the median`

Verification (narrow gate; no e2e criteria, so no `e2e-story`): `npm run build:dev`, `npm run lint`,
`npm run typecheck` green; `npx vitest run --changed HEAD` green (17 files, 199 tests) plus the whole
`src/main/modules/servers` folder (29 files, 350 tests). Run twice: after D5 and after the review fix.
- AC1 `scan-runner.test.ts` "a reachable server gets 3 info samples" — passed
- AC2 "far-apart samples get 3 more", "close samples get no extra" + `ping-samples.test.ts` — passed
- AC3 "the emitted ping is the median of the samples" + `scan-service.test.ts` "a status reply does not overwrite the
  stage-1 median ping" (+ LAN twin in `scan-service.lan-mode.test.ts`) — passed
- AC4 `server-query.test.ts` "a late reply to the first send is timed against the first send, not the retry" — passed
- AC5 `server-query.test.ts` "the receive stamp is taken at arrival, not when the reply is processed",
  "systemClock is monotonic and sub-millisecond" — passed (AC6 does not discriminate this regression, see Decisions)
- AC6 / AC7 `scan-ping-accuracy.test.ts` — passed (41–43 ms vs 40; full-pass ratio ≈ 1.0); AC6 failed once under a
  parallel run (CPU contention), see Decisions. No manual residue.
Review: clean agent, 1 cycle, PASS with findings; the LAN stage-2 overwrite was fixed and re-verified. Not fixed:
`scan-integration.test.ts` empty-responder bound `retries + 6` is looser than strictly needed (upper bound, kept).

tiers: D 5 / hard 1 · review default · cycles 1 · agents 11

Gate regression (S35): a comment ended "(story 258)." instead of a trailing pointer, docs/systems/servers-module.md carried a seventh section, and ping-samples.ts had no area row; fixed in the comment, the doc (folded into Map) and areas.json (servers-scan).
