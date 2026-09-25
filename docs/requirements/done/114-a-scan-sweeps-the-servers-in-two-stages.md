---
id: 114
title: a scan sweeps the servers in two stages
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the Servers view and, within a second, sees rows filling in for the servers that are
actually reachable right now — not a spinner that only resolves once the slowest server on the
internet has answered or timed out. Behind that, a second pass quietly fetches who is actually
playing on the servers that turned out to have anyone on them at all, so the occupancy sort, the
"waiting for an opponent" marker and (once unlocked) the watchlist all have real player data to work
from, without every server on the list paying the cost of a full `status` query.

This is the scan scheduler itself: the thing that turns [[106]]'s empty module into a working list.
It resolves the address set from every enabled source configured in [[111]], every favourite
([[112]]), and every manually added server ([[113]]), using the query and reply codecs [[108]] and
the master/HTTP list codecs [[109]] already built. Whether history entries also join that address
set is the concept's own open point (game-browser.md §18.4) and is [[113]]'s decision to record, not
this story's — this story only sweeps whatever [[113]] hands it. One source failing to answer
must not take the rest of the scan down with it — a dead master is exactly the kind of failure the
concept calls out (game-browser.md §7.1, GB-S3) as routine, not exceptional. And a favourite has to
show up even when every configured source has forgotten about it, because a favourite is a promise
the user made to the launcher, not a claim the launcher has to verify against a master list first
(GB-S5).

The scan is asynchronous end to end: nothing in the renderer polls for progress. Main owns the scan
state and pushes every result the moment it exists, the same `module:event` push already used for
`jobs:changed` elsewhere in the app — the store applies what arrives, it does not ask for it.

Out of scope here: the cadence this scan runs on (auto-scan on open, auto-refresh interval,
concurrency/timeout/retry budget) is [[115]]; the hard "never while the game runs" rule is [[116]];
the narrower "refresh favourites only" / "refresh one server" variants of this same mechanism are
[[117]]. This story is the two-stage sweep itself, triggered once, top to bottom.

## Acceptance Criteria

- [x] **AC1** — A scan produces list rows from stage-1 `info` replies as they arrive; the list is
      populated and usable before the stage-1 sweep across the whole address set has finished.
- [x] **AC2** — Stage 2 (`status`) is fetched only for the currently selected server and every server
      stage 1 reported as non-empty; a server stage 1 reported as empty is not queried a second time
      in the same scan.
- [x] **AC3** — A source that errors (unreachable master, malformed HTTP reply) is reported as failed
      for that source specifically, and the scan still completes using every other source's
      addresses — the whole scan does not abort because one source did.
- [x] **AC4** — Every favourite address is included in the stage-1 sweep even when no enabled source
      returns it that round.
- [x] **AC5** — Stage-1 and stage-2 results are delivered to the renderer as `module:event` pushes as
      each one arrives, not read back by the renderer polling an invoke channel.
- [x] **AC6** — The address set for one scan is the union of every enabled source's addresses, every
      favourite, and every manually added server, with duplicates (same address from two origins)
      collapsed to one entry that still carries all of its origins.

## Open Questions

None — the one open point of substance (is a scan a `Job`?) was decided by the user on [[115]] and
is carried into this story's Decisions below. Every other detail was decided during refine.

## Decisions (Sprint)

- **D-A — A scan is not a `Job`.** Carried from [[115]]'s `## Decisions (Sprint)` (user decision):
  `JobsService` stays scoped to installation-mutating work, so the scan gets its own
  `ScanService` inside the servers module that owns its state and pushes through `module:event`.
- **D-B — The history is not part of this scan's address set.** AC6 names exactly three origins
  (sources, favourites, manual) and [[113]] recorded no decision to include history, so
  game-browser.md §18.4 stays open rather than being answered by implementation drift.
- **D-C — Two event types, one event per result, no batching:** `scan.changed` (scan state and
  progress) and `scan.server` (one row, stage 1 or stage 2). ~300 small pushes over a sweep is
  cheap, and batching is a timer plus a buffer that AC1/AC5 do not ask for — if it ever costs
  anything, [[115]]'s measurement is exactly where that shows up.
- **D-D — A renderer that mounts mid-scan reads a snapshot once through `scan.read`.** AC5 forbids
  *polling* for results, not a single catch-up read; without it a view opened after the first rows
  arrived would be permanently missing them.
- **D-E — One UDP socket per server query**, opened through a `ServerUdpImpl` seam that mirrors
  `udp-master-source.ts`'s `MasterUdpImpl`. The existing socket seam deliberately carries no sender
  address, so a single multiplexed socket could not attribute a reply to a server.
- **D-F — Concurrency, per-query timeout and retries are read from `ServersState.scan`** (already
  persisted by [[110]] with provisional defaults), never from constants in the runner — that is
  precisely the seam [[115]] then puts a UI and measured defaults on.
- **D-G — `scan.start` takes an optional `selectedAddress`.** Stage 2's "currently selected server"
  (AC2) has no selection surface until [[118]]/[[122]]; the parameter exists and is honoured now,
  and without one stage 2 is exactly the non-empty set.
- **D-H — A failed source is reported as `{ sourceId, reasonKey }` in the scan state**, with
  `reasonKey` from `masterSourceFailureKey()`. CLAUDE.md: main sends i18n keys across IPC, never
  prose — the same shape [[113]] D-C fixed for address refusals.
- **D-I — An `http-list` source's `raw` mode is derived from its own URL** (`?raw=2` → binary, else
  text). The user configures one address, not an address plus a hidden mode flag.
- **D-J — Results live in memory only, never in `state.json`.** A scan result is a snapshot of a
  live network; [[110]]'s key is for the user's own data (GB-P1/GB-P2) and would go stale on disk.
- **D-K — A server that does not answer keeps its previous row, flagged stale; it is never reported
  as "zero players"** (GB-N6). The store therefore holds last-known rows across scans within a
  session, which is also what [[117]]'s scoped refreshes will later update in place.
- **D-L — At most one scan in flight; `scan.start` while one runs is refused as a value**
  (`{ ok: false, reasonKey }`). The runner needs a single-flight guard to have coherent state at
  all; [[115]] AC4 only adds the *automatic* caller's "skip, don't queue" rule on top of it.
- **D-M — No renderer view and no e2e flow in this story.** The `servers` route is still the shell's
  `PlannedModuleView` and the list UI is [[118]]/[[121]] in S25, so there is no real surface to
  drive — the same situation [[113]] D-J recorded. The gap is named in `## Acceptance Tests`, and
  the substitute is D8's real-socket integration test, not a manual step.
- **D-N — Every test and measurement talks to loopback only**, never a real master or a real game
  server (GB-A5, and [[115]]'s decision of the same name) — D8 starts its own `node:dgram`
  responders on `127.0.0.1` answering `reply-fixtures.ts` bytes.

## Plan

The scan is a new **`ScanService`** inside the existing `servers` module — no new module and no new
top-level IPC channel: everything rides `module:invoke`/`module:event`, per [[106]]'s wiring.

Order of work, bottom up. Everything below the runner is pure or injectable and lands with its own
tests, so the runner itself only has to orchestrate:

1. **Contract first** (CLAUDE.md key rule): the scan's types, event names, handler names and zod
   schemas go into `src/shared/modules/servers.ts` before any handler exists.
2. **`server-query.ts`** — the missing transport: query *one game server* for `info`/`status` over
   UDP with a timeout, retries and a measured RTT. Mirrors `udp-master-source.ts` line for line
   (injectable `ServerUdpImpl` + `Clock` + `signal`, lazy `node:dgram`, one `settle()` exit), but
   with a far simpler state machine: one datagram is the whole reply.
3. **`address-set.ts`** — pure union/dedupe of source addresses + favourites + manual servers into
   `ScanTarget[]`, each carrying *all* of its origins (AC6, AC4).
4. **`source-resolution.ts`** — runs every *enabled* source through the existing
   `resolveUdpMasterSource`/`resolveHttpListSource`, each isolated: a rejection is that source's
   failure, never the scan's (AC3).
5. **`scan-runner.ts`** — the two-stage sweep: a concurrency-capped pool over the address set
   (`info`), streaming each result out as it lands, then the same pool over {non-empty ∪ selected}
   (`status`). Abortable, single-flight, no `await` on a whole stage before the first row exists.
6. **`scan-service.ts` + `index.ts`** — holds the last-known row store and the live scan state,
   emits `scan.changed`/`scan.server`, and answers `scan.start`/`scan.read`. `dispose()` aborts a
   running scan (the module's first use of `MainModule.dispose`).
7. **Renderer client helpers only** (`modules/servers/client.ts`): `startScan`, `readScan`,
   `onScanChanged`, `onScanServer` — no view (D-M); [[118]] builds on these.
8. **Integration proof** — a real loopback UDP responder driven through the real module handler,
   standing in for the e2e this sprint cannot have.

Affected files: `src/shared/modules/servers.ts`; new `src/main/modules/servers/{server-query,
address-set,source-resolution,scan-runner,scan-service}.ts` plus tests;
`src/main/modules/servers/index.ts`; `src/renderer/src/modules/servers/client.ts`;
`src/renderer/src/i18n/locales/en.json` (scan failure/refusal keys). No shell files, no change to
`src/shared/ipc.ts`.

## Deliverables

- [x] **D1 — The scan's shared contract.** In `src/shared/modules/servers.ts`: `ScanOrigin`
  (`'source' | 'favourite' | 'manual'`), `ScanTarget`, `ServerListEntry` (address, origins,
  `status: 'online' | 'stale'`, name/map/mod/players/maxclients/needpass, `rttMs`, `players?`,
  `lastSeenAt`), `ScanSourceFailure`, `ServersScanState` (`running`, `phase`, stage-1/stage-2
  done/total, `sourceFailures`, `startedAt`, `finishedAt`), `ScanStartResult`, `ScanSnapshot`,
  `SERVERS_EVENTS = { scanChanged: 'scan.changed', scanServer: 'scan.server' }`, plus
  `SERVERS_HANDLERS.scanStart`/`scanRead` with `scanStartInputSchema` (optional `selectedAddress`,
  reusing `serverAddressSchema`) / `serversNoInputSchema`, both registered in
  `SERVERS_HANDLER_SCHEMAS`. Mirror: the existing `SERVERS_HANDLERS` block in the same file and
  `HOME_EVENTS` in `src/shared/modules/home.ts`. *Acceptance:* `servers.test.ts`'s existing "every
  handler has a schema" iteration passes with the two new handlers.
  Files: `src/shared/modules/servers.ts`, `src/shared/modules/servers.test.ts`.

- [x] **D2 — Query one game server.** New `src/main/modules/servers/server-query.ts`:
  `ServerUdpTarget`, `ServerUdpHandlers`, `ServerUdpSocket`, `ServerUdpImpl`, `dgramServerUdp`,
  `queryServer(target, { kind: 'info' | 'status', timeoutMs, retries, clock?, udpImpl?, signal? })`
  → `{ ok: true; kind; reply; rttMs } | { ok: false; reason: 'no-reply' | 'transport-error' |
  'malformed' }`. Uses `buildInfoQuery`/`buildStatusQuery` and `parseInfoReply`/`parseStatusReply`
  from `@shared/servers`. A retry re-sends on timeout and the RTT is measured from the *last* send.
  Mirror: `src/main/modules/servers/udp-master-source.ts` (seam, `Clock`, `settle()`, lazy dgram).
  *Acceptance + test:* `server-query.test.ts` — a reply is parsed and carries an RTT; a silent
  server yields `no-reply` after exactly `retries + 1` sends; a datagram arriving after settle is
  dropped; an abort closes the socket.
  Files: `server-query.ts`, `server-query.test.ts`.

- [x] **D3 — The address set.** New `src/main/modules/servers/address-set.ts`:
  `buildScanAddressSet({ sourceAddresses, favourites, manualServers }): ScanTarget[]` — pure, keyed
  by the normalized `host:port` from [[107]]'s `parseServerAddress`/`formatServerAddress`, origins
  merged and deduped, favourites always present. Mirror: `favourites.ts` (pure, list in / list out).
  *Acceptance + test:* `address-set.test.ts` — AC6's duplicate-collapses-but-keeps-both-origins
  case, and AC4's "favourite present even with zero source addresses".
  Files: `address-set.ts`, `address-set.test.ts`.

- [x] **D4 — Resolve the sources, isolated.** New `src/main/modules/servers/source-resolution.ts`:
  `resolveSources(sources, deps): Promise<{ addresses: ParsedServerAddress[]; failures:
  ScanSourceFailure[] }>` — only `enabled` sources; `udp-master` through `resolveUdpMasterSource`,
  `http-list` through `resolveHttpListSource` with `raw` derived from the URL (D-I); each call
  wrapped so a rejection becomes that source's failure. *Acceptance + test:*
  `source-resolution.test.ts` — one source failing (and one throwing) while the other still
  contributes its addresses (AC3), disabled sources skipped, the failure carries `sourceId` plus
  `masterSourceFailureKey()`.
  Files: `source-resolution.ts`, `source-resolution.test.ts`.

- [x] **D5 — The two-stage runner.** New `src/main/modules/servers/scan-runner.ts`:
  `runScan({ state, deps, selectedAddress, signal, onSourceFailure, onServer, onProgress })`.
  Stage 1: a concurrency-capped pool (`state.scan.concurrency`) of `queryServer(…, 'info')` over
  the address set, `onServer` called per result the moment it lands — never after a stage-wide
  `await`. Stage 2: the same pool over the non-empty set ∪ `selectedAddress`, `status` only; an
  address stage 1 reported empty is not queried again in the same scan. *Acceptance + test:*
  `scan-runner.test.ts` with a fake `queryServer` — rows stream before the last address resolves
  (AC1), the stage-2 target set is exactly non-empty ∪ selected and no address is queried twice in
  a stage (AC2), a source failure does not stop the sweep (AC3), an abort stops both stages.
  Files: `scan-runner.ts`, `scan-runner.test.ts`.

- [x] **D6 — The service and its handlers.** New `src/main/modules/servers/scan-service.ts`:
  `createScanService({ state, emit, deps })` — holds the last-known `ServerListEntry` map (D-J/D-K),
  the live `ServersScanState`, a single-flight `start(selectedAddress?)` (D-L) and `read()`; emits
  `scan.changed` on every state change and `scan.server` per row. Wired into
  `src/main/modules/servers/index.ts` as the `scan.start`/`scan.read` handlers plus
  `serversModule.dispose()`; `overview.read` stops being hardcoded and reports the service's real
  `scanning`/`knownServerCount`/`lastScanAt`. Mirror: `index.ts`'s existing read/run/persist blocks
  and `src/main/modules/home/index.ts`'s `onChanged: (feed) => emit(...)`.
  *Acceptance + test:* `scan-service.test.ts` — a start emits `scan.changed` and then one
  `scan.server` per row as each arrives (AC5); a second `start` during a scan is refused with a
  reason key; a silent server keeps its previous row flagged stale; `read()` returns the mid-scan
  snapshot (D-D).
  Files: `scan-service.ts`, `scan-service.test.ts`, `index.ts`, `index.test.ts`,
  `src/renderer/src/i18n/locales/en.json`.

- [x] **D7 — Renderer client helpers.** In `src/renderer/src/modules/servers/client.ts`: `startScan`,
  `readScan` (both `callModule`) and `onScanChanged`/`onScanServer` (both `onModuleEvent`, filtered
  by `moduleId: 'servers'` plus type). No component, no view (D-M). Mirror:
  `src/renderer/src/modules/home/client.ts`'s `onNewsChanged`. *Acceptance + test:* new
  `client.test.ts` — each subscription delivers only its own event type and unsubscribes cleanly,
  and nothing in this module polls `scan.read` on a timer (AC5's renderer half).
  Files: `client.ts`, `client.test.ts`.

- [x] **D8 — The real-socket integration proof** (the substitute for the missing e2e, D-M/D-N). New
  `src/main/modules/servers/scan-integration.test.ts`: two throwaway `node:dgram` responders on
  `127.0.0.1` answering real `info`/`status` bytes (one populated, one empty), one address that
  never answers, and a `ServersState` with every source disabled, one favourite and two manual
  servers — driven through the real `serversModule` handlers with a captured `emit`. Proves the
  whole path on real sockets: rows stream in (AC1), stage 2 hits only the non-empty server (AC2),
  the favourite is swept (AC4), the union is deduped (AC6), and every result arrives as an emitted
  event rather than a read (AC5).
  Files: `scan-integration.test.ts`.

## Model Hints

- D5 → `deliverable-hard` — the concurrency pool, the "stream before the stage finishes" ordering
  guarantee and the stage-1→stage-2 hand-off are the one place where a subtle bug (an `await` in
  the wrong place, a target queried twice, an abort that leaks in-flight sockets) passes every naive
  test and only surfaces against a real-sized address set.
- D1, D2, D3, D4, D6, D7, D8 → default tier; each mirrors an existing file named in its deliverable.
- Review: → `story-review-hard` — this story has no e2e coverage at all (D-M) and is the foundation
  [[115]], [[116]] and [[117]] all attach to, so the review is the only cross-cutting check the
  sprint gets on it.

## Acceptance Tests

Test names below are the real ones as written (step 7: brought in line with what the deliverable
agents actually produced; several read slightly differently from the names this section
originally predicted, and D8 covers AC1/AC2/AC4/AC5/AC6 together in one integration test rather
than one each).

- AC1 → unit `src/main/modules/servers/scan-runner.test.ts` › "stage 1 streams a row before the
  sweep has finished", plus integration `src/main/modules/servers/scan-integration.test.ts` ›
  "sweeps favourites+manual servers over real sockets, streaming rows, deduping the union,
  skipping stage 2 for an empty server, and surviving a dead target" (D5, D8).
- AC2 → unit `src/main/modules/servers/scan-runner.test.ts` › "stage 2 queries the non-empty
  servers and the selected one, and nothing twice" (plus "stage 2 is exactly the non-empty set
  without a selection, and asks a selection outside the address set too"), plus integration
  `src/main/modules/servers/scan-integration.test.ts` › same test as AC1 above (D5, D8).
- AC3 → unit `src/main/modules/servers/source-resolution.test.ts` › "isolates a source that
  returns a failure result, keeping the other source addresses (AC3)" and "isolates a source whose
  resolve call throws (unhandled rejection), keeping the other source addresses (AC3)" (D4).
- AC4 → unit `src/main/modules/servers/address-set.test.ts` › "keeps a favourite present even when
  no source returned it this round (AC4)", plus integration
  `src/main/modules/servers/scan-integration.test.ts` › same test as AC1 above (D3, D8).
- AC5 → unit `src/main/modules/servers/scan-service.test.ts` › "AC5: start() emits scan.changed,
  then one scan.server per row in arrival order" and unit
  `src/renderer/src/modules/servers/client.test.ts` › "onScanChanged receives only scan.changed
  pushes - never a scan.server one on the same subscription" / "onScanServer receives only
  scan.server pushes - never a scan.changed one on the same subscription" / "both subscriptions can
  be live at once and each only ever hears its own event type", plus integration
  `src/main/modules/servers/scan-integration.test.ts` › same test as AC1 above (D6, D7, D8).
- AC6 → unit `src/main/modules/servers/address-set.test.ts` › "collapses the same address seen as
  both a source and a favourite into one target (AC6)" and "merges all three origins for one
  address seen everywhere, without duplicate origins", plus integration
  `src/main/modules/servers/scan-integration.test.ts` › same test as AC1 above (D3, D8).

**Named gap (no e2e):** `ui-acceptance-required` is `true`, but the `servers` route still renders
the shell's `PlannedModuleView` — the list UI that would make a scan observable is [[118]]/[[121]]
in S25 (D-M). Every AC here is main-process/IPC behaviour rather than a user action, so each is
covered one level down (unit) plus D8's real-socket integration test through the module's real
handlers. This gap belongs in the S24 sprint review; e2e coverage for a scan lands with [[118]].

## Done

**Summary.** Built the two-stage scan scheduler for the `servers` module end to end: shared
contract (D1), a single-server UDP query transport (D2), the pure address-set union/dedupe (D3),
isolated per-source resolution (D4), the concurrency-capped two-stage runner (D5, hard tier), the
stateful `ScanService` with single-flight/last-known-row memory and its `scan.start`/`scan.read`
handlers wired into `index.ts` (D6), the renderer's push-only client helpers with no view (D7, per
D-M), and a real-loopback-socket integration test standing in for the missing e2e (D8). All 8
deliverables landed in order with a fresh agent each; D5 ran on the `deliverable-hard` tier per
`## Model Hints`.

**Commit message:**
```
114: sweep servers in two stages
```

**Verification — narrow gate (no `--full`):**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `test-story` (`npx vitest run --changed HEAD`) — 90 test files, 1450 tests, all passing (run
  once after the review-fix cycle; the same command at 1449 tests was already green right after
  D8, before the review's fixes added one more test).
- No `e2e-story` ran: this story maps no criterion to `e2e` — `ui-acceptance-required` is `true`,
  but the `servers` route is still the shell's `PlannedModuleView` (D-M), so every AC is proven at
  unit level plus D8's real-socket integration test through the real module handlers instead. This
  gap is named in `## Acceptance Tests` and belongs in the S24 sprint review; e2e coverage for a
  scan lands with [[118]].

**AC → test mapping, as verified:**
- AC1 (rows stream before the sweep finishes) — `scan-runner.test.ts` › "stage 1 streams a row
  before the sweep has finished" (PASS) + `scan-integration.test.ts`'s one real-socket test (PASS).
- AC2 (stage 2 = non-empty ∪ selected, nothing twice) — `scan-runner.test.ts` › "stage 2 queries
  the non-empty servers and the selected one, and nothing twice" + the asymmetric-selection variant
  (PASS) + the same integration test (PASS).
- AC3 (isolated source failure) — `source-resolution.test.ts` › the returned-failure and
  thrown-rejection cases (PASS).
- AC4 (favourite always swept) — `address-set.test.ts` › "keeps a favourite present even when no
  source returned it this round (AC4)" (PASS) + the same integration test (PASS).
- AC5 (push-only, no polling) — `scan-service.test.ts` › "AC5: start() emits scan.changed, then one
  scan.server per row in arrival order" (PASS) + `client.test.ts`'s three subscription-isolation
  tests (PASS) + the same integration test (PASS).
- AC6 (union dedupe, origins preserved) — `address-set.test.ts` › the AC6-tagged collapse test and
  the all-three-origins-merge test (PASS) + the same integration test (PASS).
- No `manual residue` — every criterion has a real automated test; D-M's e2e gap is a named,
  documented substitution (D8's real sockets), not a manual step.
- `## Acceptance Tests` was corrected in place (step 7) to the test names actually written, since
  several deliverable agents phrased them slightly differently than the plan predicted, and D8
  covers AC1/AC2/AC4/AC5/AC6 together in one integration test rather than one each.

**Review outcome (clean agent, `story-review-hard` tier per `## Model Hints`):** first pass verdict
FAIL — all six ACs individually PASSed with cited evidence, but two findings sank the overall
verdict. One review-fix cycle (of the 3 allowed) closed it:
- **Fixed:** the renderer (`client.ts`) hand-declared its own copy of the `scan.server` payload
  type instead of sharing one with main, an ARCHITECTURE.md violation with real drift risk. Moved
  the canonical shape into `@shared/modules/servers.ts` as `ScanQueryResult`/`ScanServerPush`; both
  `server-query.ts`'s `ServerQueryResult` and `scan-runner.ts`'s `ScanServerResult` are now aliases
  of it, and the renderer imports the shared type directly. No other main-side import site needed
  to change.
- **Fixed:** `scan-service.ts`'s `runSweep()` read `getServersState()` outside its `try`, so a throw
  there would skip the `finally` that resets `running` — permanently wedging D-L's single-flight
  guard for the rest of the process's life. Moved the read inside the `try`, and added a `catch`
  so an unexpected throw (there or from `runScan` rethrowing a callback error) can never become an
  unhandled rejection — `finally` still always resets state.
- **Fixed:** an aborted sweep (`dispose()` mid-scan) unconditionally ran D-K's end-of-sweep
  stale-flip over every unanswered target, contradicting the runner's own documented contract that
  an abort must never mark a row stale (`aborted` means "never got to ask", not "the server was
  silent"). `runSweep` now checks `runScan`'s returned `aborted` flag and skips the stale-flip
  entirely when true. Added a regression test (`scan-service.test.ts` › "review fix: an aborted
  sweep never stale-flips an entry it did not get to answer") proving a first scan's `'online'` row
  survives an aborted second scan unchanged.
- Re-verified after fixes: build/typecheck clean, full `servers`-tree test run green (151 tests),
  then the full narrow gate re-run (build/typecheck/`--changed HEAD`) green at 1450 tests.

**Decisions (review findings deliberately left unfixed, with reasons):**
- `resolveHttpListSource` (`http-list-source.ts`, story 109/111, not touched by this story's Plan)
  has no timeout of its own — only an externally-supplied `AbortSignal` can end a hung fetch. A
  stalled `http-list` source could in principle hang a scan indefinitely, and because that signal
  is shared with the sweep's own abort, giving source resolution its own bounded timeout would mean
  inventing a new hardcoded-constant timeout budget that no `## Decisions` in this story sanctions
  (D-F explicitly scopes timeout/retries-from-settings to the query runner, not source resolution).
  Reviewer flagged this PLAUSIBLE, not CONFIRMED. Left as a named gap for a follow-up — naturally
  fits alongside [[115]]'s own settings/budget work — rather than an unreviewed mechanism invented
  under review-fix time pressure.
- A `ServerListEntry` for an address that drops out of a later scan's address set entirely (an
  unfavourited/removed manual server, or a master that stops returning it) keeps reporting
  `status: 'online'` forever, since D-K's stale-flip only runs over *this round's* address set. Not
  in scope: D-K's own text scopes "does not answer" to addresses still in the set, and the story
  explicitly hands "the narrower refresh variants" to [[117]].
- The D8 integration test's AC1 proof is comment-level stronger than its assertions alone
  (an implementation that buffered every stage-1 row until just before stage 2 could still pass
  it) — the real proof is `scan-runner.test.ts`'s unit test, which does assert genuine ordering
  with deferred promises; D8 corroborates on real sockets rather than re-proving the ordering
  guarantee from scratch. Same reasoning for `scan-service.test.ts`'s AC5 test (both fake queries
  resolve immediately, so it doesn't independently prove "as each arrives" either) — the service
  code itself streams (verified by reading `scan-service.ts`), and the runner-level and
  integration-level tests already carry the ordering proof.
- `index.test.ts`'s new "refuses a second call" case has no deferred query holding the first scan
  open, so it is timing-sensitive in principle; `scan-service.test.ts`'s D-L test (same criterion,
  deferred promises, robust) is the one actually load-bearing for D-L.
- D-I's raw-mode-from-URL derivation (`?raw=2` → binary) has no dedicated unit test in
  `source-resolution.test.ts` — it is a `## Decisions` item, not a numbered acceptance criterion,
  so it was not required by the AC → test mapping; noted for completeness.

**Progress trail:** `docs/sprints/S24/progress.md` has one started/done line per deliverable.
