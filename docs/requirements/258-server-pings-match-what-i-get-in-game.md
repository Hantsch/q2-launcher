---
id: 258
title: Server pings match what I get in game
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — A scan takes 3 ping samples per reachable server.
- [ ] **AC2** — When the 3 samples are far apart (threshold in Decisions), 3 more are taken.
- [ ] **AC3** — The ping shown, sorted on and filtered on is the median of the samples of the latest scan.
- [ ] **AC4** — Each sample is timed against its own send (a late reply to an earlier send is not measured
      against a retry).
- [ ] **AC5** — Sample timing uses a monotonic high-resolution clock and is not inflated by the processing of
      other servers' replies (proved with a fake socket that delays processing, not the send/receive).
- [ ] **AC6** — Against a local test server with a fixed delay, the shown ping stays within ±5 ms of that
      delay over 10 consecutive scans.
- [ ] **AC7** — A full scan with the extra samples takes no more than 1.5× the time of today's scan over the
      same fixture servers.

## Open Questions

## Decisions (Sprint)

- **(User)** Staggered sampling: 3 pings per server; if they are far apart, 3 more; the value shown, sorted
  and filtered on is the median of all samples.
- "Far apart" proposed at the cut: max − min > 20 ms or > 25 % of the median; refine may tune the threshold
  against a measurement and records it here.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
