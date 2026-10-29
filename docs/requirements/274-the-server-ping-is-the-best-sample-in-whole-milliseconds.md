---
id: 274
title: The server ping is the best sample in whole milliseconds
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

As a player, I want the ping shown for a server — in the list and after refreshing a server — to be
a whole number of milliseconds and the best (lowest) round trip measured, so the number is easy to
read and matches what a good connect gets.

Today (user feedback 2026-10-29): after a ping refresh the user sees decimal places. The scan
reports the median of 3–6 samples (`src/main/modules/servers/ping-samples.ts`, story 258), rounded by
`medianPing`, but raw clock differences reach the UI through paths that skip it (candidates:
`server-query.ts:272`, `lan-discovery.ts:193`, the single-sample return in `scan-runner.ts:246-251`).
`formatPing` (`src/renderer/src/modules/servers/server-format.ts:32`) and the reachability history
(`ServerReachabilitySection.tsx:27`) print the value as-is.

## Acceptance Criteria

- [ ] **AC1** — The ping a scan stores for a server is the minimum of its successful samples, not
      the median.
- [ ] **AC2** — Every ping value that reaches the renderer (list row, detail header, reachability
      history, LAN rows, single-server refresh) is a whole number of ms.
- [ ] **AC3** — After refreshing a server, the server list shows its ping without a decimal point.
- [ ] **AC4** — Max-ping filter and ping sort use the same best-sample value the row shows.

## Open Questions

- ~~Keep the extra samples taken when the first ones are far apart, or drop to a fixed 3 samples? The
  spread rule existed to stabilise a median.~~ answered → Decisions (Sprint)
- ~~Rounding: `Math.round` or `Math.floor` for the best sample?~~ answered → Decisions (Sprint)
- ~~`rttHistory` persisted by earlier sessions may hold fractional values: round on read or
  leave?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Ping: `Math.round` of the best sample, fixed 3 samples (spread rule dropped), persisted fractional `rttHistory` rounded on read.
- Round at the measurement (`server-query.ts` reply stamp, `lan-discovery.ts` reply), not in the
  renderer: one place then covers row, detail header, reachability history, LAN rows, the
  `scanServer` push and filter/sort alike; rounding each sample then taking the min equals
  `Math.round` of the min, so the (User) rule holds.
- "`rttHistory` rounded on read" needs no code: `rttHistory` is in-memory only and never persisted
  (`ServerListEntry.rttHistory` doc in `src/shared/modules/servers.ts`), so once the source rounds
  no fractional value can exist on any read.
- The single-server refresh keeps its one `status` query (stage-2-only path, stories 117/250) and
  stores that sample, now in whole ms: AC1 is about the scan's `info` sampling and AC3 only asks for
  no decimals.

## Plan

Root cause: `server-query.ts` (`receivedAt - sentAt`, `performance.now()`) and `lan-discovery.ts`
(`clock.now() - lastSendAt`) produce fractional ms; only the stage-1 median path rounds, so a
single-server refresh (stage 2 only, one `status` sample) and LAN discovery rows reach the UI raw.

1. **Sampling (main, `ping-samples.ts` + `scan-runner.ts`):** replace `medianPing` with
   `bestPing(samples) = Math.round(Math.min(...samples))`; delete `samplesFarApart`,
   `PING_SAMPLES_EXTRA` and the spread re-sample branch in `scan-runner.ts` `queryOne` — exactly
   `PING_SAMPLES_FIRST` (3) samples, failed samples dropped as today. Update the file docs.
2. **Whole ms at the source (main):** `server-query.ts` `onReply` rounds `rttMs`;
   `lan-discovery.ts` `onMessage` rounds likewise. Every consumer (merge, history, push, filter,
   sort, `formatPing`) then sees integers with no change of its own.
3. **Real surface:** the existing `servers-scoped-refresh` flow gets a step asserting the
   refreshed row's ping reads `<int> ms` (loopback RTT is sub-ms, so today it shows decimals).
4. Systems doc `docs/systems/servers-module.md` ping paragraph + one CHANGELOG `### Fixed` line.

AC4 needs no code: `src/shared/servers/list-filter.ts:119` and `list-sort.ts:115-116` read
`row.rttMs`, the same field `formatPing` prints; existing tests prove it.

## Deliverables

- [ ] **D1 — The scan's ping is the best of 3 samples.** In
      `src/main/modules/servers/ping-samples.ts` replace `medianPing` with
      `bestPing(samples: readonly number[]): number` = `Math.round(Math.min(...samples))`; delete
      `samplesFarApart`, `rawMedian` and `PING_SAMPLES_EXTRA`; rewrite the file doc (best sample,
      fixed count, no spread rule, story 274). In `src/main/modules/servers/scan-runner.ts`
      `queryOne` drop the `samplesFarApart(...) && collectSamples(udp, PING_SAMPLES_EXTRA, ...)`
      branch and return `{ ...first, rttMs: bestPing(collected) }`; update the file doc bullet
      (~lines 19-22: `rttMs` replaced by the lowest sample, no extra samples). Tests:
      `src/main/modules/servers/ping-samples.test.ts` — replace the median / far-apart /
      sample-count describes with `bestPing` cases "the best sample is the lowest regardless of
      order" (`[90, 20, 40]` → 20) and "the best sample is rounded to whole ms" (`[20.6, 31]` → 21);
      `src/main/modules/servers/scan-runner.test.ts` — new test "a scan stores the lowest of its
      three ping samples" (fake `queryServer` answering `info` with rtts 12, 80, 95 in some order —
      far apart on purpose — → emitted stage-1 row `rttMs` 12 and exactly 3 `info` queries for
      that address). `src/main/modules/servers/scan-integration.test.ts` ~line 260: the bound
      becomes `SCAN_SETTINGS.retries + PING_SAMPLES_FIRST`, drop the `PING_SAMPLES_EXTRA` import
      and the "never far apart" remark ~line 270; `src/main/modules/servers/scan-ping-accuracy.test.ts`
      header comment "the median of three samples hides a single late stamp" → "the best of three
      samples …" (comment only).
- [ ] **D2 — Every ping is whole milliseconds at the source.** In
      `src/main/modules/servers/server-query.ts` `onReply` (~line 272) set
      `const rttMs = Math.round(receivedAt - sentAt)` with a one-line why (the UI shows whole ms;
      rounding here covers stage 1, stage 2 and the single-server refresh alike). In
      `src/main/modules/servers/lan-discovery.ts` `onMessage` (~line 193) round
      `clock.now() - lastSendAt` the same way. Tests (both files already have a `fakeClock`):
      `src/main/modules/servers/server-query.test.ts` — "a fractional round trip is reported in
      whole milliseconds" (fake clock advances e.g. 12.6 ms before the reply → `rttMs` 13);
      `src/main/modules/servers/lan-discovery.test.ts` — "a LAN reply's round trip is whole
      milliseconds" (fractional advance → `Number.isInteger(rttMs)` and the rounded value). Docs: in
      `docs/systems/servers-module.md` (ping paragraph, ~lines 30-34) state: ping is the lowest of
      3 `info` samples, whole ms (rounded at measurement), no extra samples; stage 2 never overrides
      it; single-server refresh and LAN rounds take their one sample, also whole ms. `CHANGELOG.md`
      under `## Unreleased` add a `### Fixed` heading with one line: "Server ping shows whole
      milliseconds, the best of three round trips."
- [ ] **D3 — The refreshed row shows its ping without decimals (real surface).** In
      `scripts/flows/servers-scoped-refresh.mjs`, after the existing "select a non-favourite row,
      then "Refresh this server" touches only it" phase (~line 264, once the round has finished),
      add a step "the refreshed server's ping reads whole milliseconds": the text of
      `servers-row-<selected address>` must match `/\b\d+ ms\b/` and must not match
      `/\d\.\d+ ms/`; and the flow's existing `scan.read` call result must have every entry's
      `rttMs` and every numeric `rttHistory[].rttMs` pass `Number.isInteger`. Loopback round trips
      are sub-ms, so without D2 the row shows decimals and this step fails. No new flow file.

## Model Hints

- D1, D2, D3 → default tier (small, local changes with direct unit/e2e proof).
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/servers/scan-runner.test.ts` › "a scan stores the lowest of its three ping samples" (D1); helper proved by `src/main/modules/servers/ping-samples.test.ts` › "the best sample is the lowest regardless of order"
- AC2 → unit `src/main/modules/servers/server-query.test.ts` › "a fractional round trip is reported in whole milliseconds" (every scan stage, the single-server refresh and the history sample take this value) and `src/main/modules/servers/lan-discovery.test.ts` › "a LAN reply's round trip is whole milliseconds" (D2); end to end by the D3 step below, which also checks every `rttMs`/`rttHistory` value from `scan.read`
- AC3 → e2e `scripts/flows/servers-scoped-refresh.mjs` › "the refreshed server's ping reads whole milliseconds" (D3)
- AC4 → existing unit `src/shared/servers/list-filter.test.ts` › "a limit shows only online rows below it" and `src/shared/servers/list-sort.test.ts` › "an unknown column value sorts last in both directions" — both read `row.rttMs`, the field `formatPing` prints, which D1/D2 make the best whole-ms sample; existing e2e `scripts/flows/servers-ping-filter.mjs` walks the Max ping filter on the real surface

## Done

<Leave empty. Filled by `/build 274` after implementation:

- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
