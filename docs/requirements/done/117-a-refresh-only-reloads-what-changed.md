---
id: 117
title: a refresh only reloads what changed
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user checking whether their three favourite servers filled up does not need to wait for, or pay
the network cost of, a full sweep of every server on every configured master — and a user sitting
on a server's detail view wanting a fresher ping does not need the whole list to reload around them.
The concept calls this out directly: "damit man nicht immer alles neu laden muss" (game-browser.md
§3, §7.2.1, GB-N9) — refreshes are scoped to what the user actually asked to see updated, not a
single "reload everything" button standing in for all of them.

This story adds two narrower entry points on top of [[114]]'s two-stage scan and reuses its
machinery rather than duplicating it: a favourites-only refresh runs stage 1 and stage 2 for the
favourite addresses only, and a single-server refresh from the detail view issues exactly one stage-2
`status` query for that one address. Both still go through [[116]]'s no-scan-while-playing guard and
[[115]]'s manual-scan-is-always-available rule — scoping the work does not exempt it from the one
hard rule.

The concept explicitly parks a fourth possible control — a dedicated "re-check the watchlist"
refresh — as a decision for later, made from the [[115]] measurement rather than guessed now (§7.2.1,
§18 open point #16): if a full pass turns out cheap, "refresh servers" already covers it and a
fourth button is clutter. That decision belongs to sprint 9.7's watchlist stories ([[131]]), not
here — this story ships the three refreshes the concept already commits to (all servers, favourites,
one server) and leaves the fourth where the concept leaves it.

## Acceptance Criteria

- [x] **AC1** — "Refresh servers" runs the same two-stage sweep [[114]] specifies over the same
      address set — it is not a separate, parallel implementation of a full scan.
- [x] **AC2** — "Refresh favourites" runs stage 1 and stage 2 for the favourite addresses only, and
      does not issue any query for a non-favourite address; the rest of the list's data is left as it
      was before the refresh.
- [x] **AC3** — "Refresh this server", available from the detail view, issues exactly one stage-2
      `status` query for that server's address and updates only that server's row and detail — no
      other row changes as a result.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Decisions (Sprint)

- **Scope is a parameter, not a second scheduler.** [[114]]'s single scan entry point gains a
  `ScanScope` argument (`{ kind: 'all' } | { kind: 'favourites' } | { kind: 'server', address }`)
  instead of 117 adding `runFavouritesScan`/`runSingleScan` functions — AC1's "not a separate,
  parallel implementation" is a structural requirement, and one code path with a scope is the only
  shape that cannot drift.
- **`all` is literally today's scan.** The `all` scope resolves to exactly [[114]]'s union address
  set (enabled sources + favourites + manual servers) with no separate branch, so "Refresh servers"
  and the auto-scan are the same run with the same scope value.
- **A single-server refresh sends `status` only, no `info`.** AC3 says "exactly one stage-2 `status`
  query", and per concept §6.1 the `status` reply carries the full serverinfo line *plus* players —
  everything a row needs — so a preceding `info` query would be a second packet buying nothing.
- **Out-of-scope rows are untouched, not stale.** A scoped run merges its replies into the existing
  server map; addresses outside the scope keep their data and their existing stale flag unchanged —
  [[116]]'s "no reply this round → stale" only applies to addresses that were actually in this
  round's scope, otherwise every favourites refresh would falsely stale the whole list.
- **Scoped refreshes obey the same two rules as a full scan.** They are manual triggers, so
  [[115]] AC3's "manual is always available" covers all three regardless of the auto-scan settings;
  and they pass through [[116]]'s launch-state guard and are refused with the same visible reason
  while a game runs — a smaller scan is still a scan.
- **Single-flight spans scopes.** [[115]] AC4's "at most one scan in flight" is enforced on the
  scheduler, not per scope: a refresh requested while any scan runs is refused (not queued), and the
  controls render disabled with that reason rather than silently dropping the click.
- **"Refresh this server" lives on the selected server in this sprint.** The real detail view is
  [[122]] and does not exist yet, so the control ships on the S24 servers view's selected-server
  affordance (the same "currently selected server" [[114]] AC2 already needs for stage 2); [[122]]
  re-homes the identical control into the detail header.
- **One handler, one payload.** The three controls share a single `scan.start` handler carrying the
  scope, not three channels — and the `server` scope's address is re-validated against
  `serverAddressSchema` in main, because a renderer-supplied address is never trusted (CLAUDE.md).
- **The scan event carries its scope.** [[114]]'s `module:event` scan push gains a `scope` field so
  the view can name what is refreshing ("Refreshing favourites…") without the renderer inferring it
  from which rows moved.
- **No fourth "re-check watchlist" control.** Concept §7.2.1 / §18.16 defers it to the [[115]]
  measurement and the watchlist stories; it is explicitly out of scope here and belongs to [[131]].
- **The e2e flow talks to a local fake Quake II responder.** A real internet scan is neither
  deterministic nor offline-safe, so the flow spawns `dgram` responders on `127.0.0.1` and asserts
  *which ports received which packet* — the only way AC2's "does not issue any query for a
  non-favourite address" and AC3's "exactly one query" are observable at all.

## Plan

Builds strictly on top of [[114]] (scheduler, two stages, `module:event` pushes, servers view),
[[115]] (settings, single-flight, a scan is **not** a `Job`) and [[116]] (launch-state guard, stale
marking). Where a name below differs from what 114/115/116 actually land, adapt to theirs — the
seam this story owns is "a scan run takes an explicit scope", not the file names.

1. **Shared contract first** (CLAUDE.md: IPC is contract-first). `ScanScope` type + zod schema in
   `src/shared/modules/servers.ts`; `scan.start`'s payload schema takes the scope; the scan event
   payload gains `scope`.
2. **Scope → address set** (pure, main): one function that maps a scope to the addresses this run
   will touch — `all` delegates to 114's union resolver, `favourites` returns the favourites slice,
   `server` returns the single validated address.
3. **Scheduler honours the scope:** stage 1 sweeps only the scope's addresses; stage 2 follows 114's
   rule within that set; the `server` scope short-circuits to one `status` query with no stage 1.
   The merge is additive — out-of-scope rows are neither rewritten nor staled.
4. **Handler + guards:** `scan.start` validates the payload, re-validates the address, then goes
   through 116's guard and 115's single-flight before reaching the scheduler; plus the client fn.
5. **Renderer:** "Refresh servers" / "Refresh favourites" in the view's toolbar, "Refresh this
   server" on the selected server; all three disabled with visible reason text while a scan runs or
   a game is live (i18n keys, never prose over IPC).
6. **Proof:** unit tests per D plus one e2e flow driving all three controls against fake UDP
   responders that record exactly which address was queried with what.

Out of scope: a watchlist re-check control ([[131]]), the real detail view ([[122]]), any change to
the scan's cadence settings ([[115]]) or to the stale rule itself ([[116]]).

## Deliverables

- **D1 — `ScanScope` in the shared contract.** Add the `ScanScope` union + `scanScopeSchema` (the
  `server` variant's address via `serverAddressSchema` from `src/shared/schemas.ts`), extend
  `scan.start`'s payload schema to carry it, and add `scope` to the scan event payload.
  Files: `src/shared/modules/servers.ts`, `src/shared/modules/servers.test.ts`.
  Mirror: the existing `SERVERS_HANDLER_SCHEMAS` / `sourcesUpdateInputSchema` pattern in that file.
  Acceptance: every handler still has a schema (the existing contract test), and the schema rejects
  a `server` scope carrying a malformed address.

- **D2 — scope → address set (pure).** `resolveScanScopeAddresses(state, scope)` in
  `src/main/modules/servers/scan-scope.ts` + its colocated test: `all` → 114's union resolver
  unchanged, `favourites` → `listFavourites(state)`'s addresses only, `server` → exactly one address
  (allowed even when it is in no source/favourite/manual list).
  Mirror: `src/main/modules/servers/favourites.ts`'s pure-helper-plus-colocated-test shape.
  Acceptance: unit test proves a favourites scope yields *only* favourite addresses given a state
  that also holds sources and manual servers.

- **D3 — the scheduler runs a scope.** Thread the scope through 114's scan run: stage 1 over the
  scope's addresses only, stage 2 per 114's rule inside that set, and a `server` scope that issues a
  single `status` with no stage-1 query; merge results into the existing server map without touching
  or staling out-of-scope entries. Files: 114's scheduler/run files under
  `src/main/modules/servers/` (~2-3 files) + their tests, driven by a fake query transport.
  Acceptance: unit tests assert the exact set of addresses queried per scope, that a `server` scope
  sends one `status` and zero `info`, and that an out-of-scope row keeps its data and stale flag.

- **D4 — handler, guard and client.** `scan.start` accepts the scope, zod-validates it, re-validates
  the `server` address in main, and passes through 116's launch-state guard and 115's single-flight
  before reaching the scheduler; add the renderer client function.
  Files: `src/main/modules/servers/index.ts` (+ test), `src/renderer/src/modules/servers/client.ts`.
  Mirror: `index.ts`'s existing `sources.*` handler registration.
  Acceptance: unit test — a scoped start while a game is "running" is refused with the guard's
  reason key, and one while a scan is already in flight is refused rather than queued.

- **D5 — the three controls.** "Refresh servers" and "Refresh favourites" in the servers view's
  toolbar, "Refresh this server" on the selected server; each disabled with visible reason text
  (scan in flight / game running) and new i18n keys under `servers.*`.
  Files: 114's servers view + a small `ScopedRefreshControls.tsx` under
  `src/renderer/src/modules/servers/`, `src/renderer/src/i18n/locales/en.json`, the module's store
  slice, plus a component test.
  Mirror: `ServersSettingsSection.tsx` for testid and i18n conventions.
  Acceptance: component test — the favourites control calls the client with
  `{ kind: 'favourites' }`, and all three render disabled with a visible reason while a scan runs.

- **D6 — the e2e proof.** `scripts/flows/servers-scoped-refresh.mjs`: seed a fixture with every
  master source disabled, three manual servers on `127.0.0.1`, one of them a favourite; spawn
  `dgram` responders that log every received packet per port; drive all three controls and assert
  the packet log per address. Add the responder as a reusable helper if 114 has not already.
  Files: `scripts/flows/servers-scoped-refresh.mjs` (+ helper under `scripts/flows/`).
  Mirror: `scripts/flows/servers-master-sources.mjs` (fixture seeding, idempotency) and
  `scripts/flows/news-feed.mjs` (a local server started inside the flow).
  Acceptance: `npm run ui:flow -- servers-scoped-refresh` passes and its screenshots land.

## Model Hints

- D3 → `deliverable-hard` — it is the only D that edits code three other in-flight stories own at
  once: it must keep 114's two-stage rule intact while narrowing the address set, and must not let
  116's "no reply → stale" fire for addresses this round never asked, a silent regression no
  compiler and no single-story test catches.
- D1, D2, D4, D5, D6 → default tier (contract, pure helper, handler wiring, small UI, one flow).
- Review: → `story-review-hard` — AC1 is a *structural* claim ("not a separate, parallel
  implementation") that a cheap diff review will tick green on a second scan path that merely
  happens to produce the right rows.

## Acceptance Tests

Corrected in place (step 7) to the real test names actually written — the deliverable agents
phrased several of them slightly differently than this section originally predicted.

- AC1 → e2e `scripts/flows/servers-scoped-refresh.mjs` › flow "servers-scoped-refresh" (the
  "Refresh servers" control makes every seeded address receive a stage-1 `info` packet) **plus**
  unit `src/main/modules/servers/scan-scope.test.ts` › "all scope" › "resolves to the same union
  address set as buildScanAddressSet for the same inputs (AC1)" (D2 — proves the same path, not a
  parallel one, by delegating to and deep-equalling 114's own union resolver directly).
- AC2 → e2e `scripts/flows/servers-scoped-refresh.mjs` › flow "servers-scoped-refresh" (after
  "Refresh favourites": the favourite's responder logged packets, the non-favourite responders
  logged none, and the non-favourite rows still show their pre-refresh values) **plus** unit
  `src/main/modules/servers/scan-scope.test.ts` › "favourites scope" › "returns only favourite
  addresses, ignoring sources and manual servers entirely (AC2)" (D2) **and**
  `src/main/modules/servers/scan-service.test.ts` › "AC2: a favourites scope queries only favourite
  addresses, not sources or manual servers" (D3, the real end-to-end proof through `ScanService`).
- AC3 → e2e `scripts/flows/servers-scoped-refresh.mjs` › flow "servers-scoped-refresh" (after
  "Refresh this server" on the selected server: exactly one `status` packet at that port, zero
  `info` packets anywhere, every other row unchanged) **plus** unit
  `src/main/modules/servers/scan-service.test.ts` › "AC3: a single-server scope sends one status
  query and no info query" (D3).

No `manual residue` — every criterion has a real, passing automated test.

## Done

**Summary.** Threaded a `ScanScope` (`{kind:'all'}` / `{kind:'favourites'}` / `{kind:'server', address}`)
through [[114]]'s existing single `scan.start` entry point end to end, reconciling the story's
speculative plan (written before [[114]]/[[115]]/[[116]] landed) with their real, final API shapes:
the shared contract (D1: `ScanScope`/`scanScopeSchema`, `scope` on the scan-start payload and on
`ServersScanState`), a pure scope→address-set resolver (D2, `scan-scope.ts`,
`resolveScanScopeAddresses`), the scheduler itself (D3, `deliverable-hard` tier — `ScanService.start`
now takes `{ scope?, selectedAddress? }`, defaulting `scope` to `{kind:'all'}`; `'favourites'`/`'server'`
skip source resolution entirely; the `'server'` scope is implemented by reusing [[114]]'s existing
stage-2 "selected address" mechanism with an empty stage-1 target list — zero changes to
`scan-runner.ts` — rather than adding a second code path, which is the literal structural proof AC1
asks for; `mergeStaleRound` is always fed the scope's own resolved address set, never the possibly-
empty set handed to `runScan`, so out-of-scope rows are never rewritten or staled), the handler/guard/
client wiring (D4 — the existing single-flight and game-running guard apply unchanged to every scope),
the three renderer controls (D5 — "Refresh servers" keeps its identity and testid, plus new "Refresh
favourites" and a row-click-to-select "Refresh this server"; all three now disabled while a scan runs
or the game is running, each with its own visible-text reason, a deliberate change from 115/116's
"always enabled, re-clicking is safe"), and the e2e proof (D6, three loopback UDP responders, one of
them a favourite, asserting exact per-address packet counts and byte-for-byte-unchanged out-of-scope
rows across all three controls in one session). All 6 deliverables landed in order with a fresh agent
each; D3 ran on the `deliverable-hard` tier per `## Model Hints`. One review-fix cycle (of the 3
allowed) followed the clean-agent review.

**Commit message:**
```
117: a refresh only reloads what changed
```

**Verification — narrow gate (no `--full`):**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `test-story` (`npx vitest run --changed HEAD`) — 90 test files, 1490 tests, all passing (run once
  right after all 6 deliverables landed — one pre-existing story-115 regex test broke on D4's
  legitimate handler-signature change, fixed during this verification pass, see below — and once
  more after the review-fix cycle; both runs green).
- `e2e-story` (`npm run ui:flow -- servers-scoped-refresh`, D6's own new flow, the one every
  criterion maps to) — PASS, run twice (right after D6 landed, and again after the review-fix
  cycle's two small edits) — screenshots landed under `.ui-verify/screenshots/flows/`.
- The review additionally ran (and re-ran clean) the two other in-sprint stories' own e2e flows as a
  regression check for D5's "disabled while running" behavior change on the shared `servers-refresh`
  button: `npm run ui:flow -- servers-no-scan-while-playing` and
  `npm run ui:flow -- servers-scan-settings` — both PASS, no regression.

**AC → test mapping, as verified** (see `## Acceptance Tests` above, corrected in place per step 7 to
the real test names):
- AC1 — e2e `servers-scoped-refresh` PASS + `scan-scope.test.ts`'s "all scope" test PASS (deep-equals
  114's own `buildScanAddressSet` output for the same inputs, proving the same path, not a parallel
  one).
- AC2 — e2e PASS (favourite's responder logged packets, both non-favourites logged zero, their rows
  byte-for-byte unchanged) + `scan-scope.test.ts`'s "favourites scope" test PASS +
  `scan-service.test.ts`'s "AC2" test PASS (the real end-to-end proof through `ScanService`).
- AC3 — e2e PASS (exactly one `status` packet at the selected port, zero `info` packets anywhere,
  every other row unchanged) + `scan-service.test.ts`'s "AC3" test PASS.
- No `manual residue` — every criterion has a real, passing automated test.

**Decisions (reconciling the speculative plan with 114/115/116's real, final code — made during
implementation, per this sprint's "decide yourself, document here" rule):**
- **`ScanService.start`'s real signature** is `start(options?: { scope?: ScanScope; selectedAddress?:
  string }): ScanStartResult`, not the story's placeholder "`scan.start` gains a `ScanScope` argument"
  — `selectedAddress` (114's own pre-existing "currently selected server" concept, orthogonal to
  scope) had to keep coexisting, so an options object replaced the old single positional parameter.
  `scan-cadence.ts`'s existing bare `scanService.start()` calls needed no change: an omitted scope
  defaults to `{kind:'all'}`, which is exactly what an automatic trigger already meant.
- **The `'server'` scope adds no new code path to `scan-runner.ts`.** Calling the existing `runScan`
  with `targets: []` and `selectedAddress: scope.address` already produces exactly one `status`
  query and zero `info` queries, through 114's own pre-existing stage-2 "selected address" fallback
  logic — confirmed by reading `scan-runner.ts` before relying on it, both during D3's build and
  independently during review. This is what makes AC1's "not a separate, parallel implementation"
  hold structurally, not just by coincidence of output.
- **`mergeStaleRound` is always fed the scope's own resolved address set, never `runScan`'s
  (possibly-empty) `targets` argument.** This is the one place a silent regression was genuinely
  possible (per `## Model Hints`'s own risk callout) — verified explicitly by both D3's agent (by
  temporarily swapping the argument and watching the single-server-timeout test fail) and the
  reviewer (independently, by reading the code).
- **Source resolution is skipped entirely for `'favourites'`/`'server'` scopes** (no master/list
  source network call at all) — `sourceFailures` is `[]` for those rounds. Not spelled out in the
  story's own Plan/Decisions, but follows directly from AC2's "does not issue any query for a
  non-favourite address" once "query" is read to include the master-source network traffic
  `resolveSources` makes, not just game-server UDP.
- **"Refresh this server" lives on a real row-click-to-select affordance**, not a pre-existing one —
  none existed before this story (114/115/116's `ServersView.tsx` had no selection concept at all).
  Rows are now buttons; clicking toggles `selectedAddress` (component-local state, no new IPC/store).
- **All three refresh controls are now disabled while a scan is running, not just while blocked** —
  a deliberate reversal of 115/116's documented "always enabled, even mid-scan, re-clicking is safe."
  Justified by this story's own Decision ("a refresh requested while any scan runs is refused (not
  queued), and the controls render disabled with that reason rather than silently dropping the
  click"). Verified not to regress either earlier story's own e2e flow (see Verification above).
  115/116's story files still describe the old behavior in prose; that is a documentation staleness
  only, not touched here (both are already `status: done` and moved to `requirements/done/`).
- **"Refresh servers" now also passes the view's `selectedAddress`** (review fix, see below) so a
  full scan still honors 114 AC2's "currently selected server" stage-2 concept now that a real
  selection exists for the first time.

**Review outcome (clean agent, `story-review-hard` tier per `## Model Hints`):** verdict **PASS**,
with 7 non-blocking findings. The reviewer independently re-ran the full verification (tests, both
tsc projects, this story's own e2e flow, and the two other in-sprint stories' e2e flows as a
regression check) rather than trusting the implementation's own reports. Two findings were fixed in
one review-fix cycle (of the 3 allowed); the rest are documented below as deliberately left, each
with its reason:
- **Fixed — a scoped-refresh timing gap against 114 AC2.** "Refresh servers" (`{kind:'all'}`) did not
  pass the view's `selectedAddress`, so a server the user had just selected (this story's own new
  affordance) would not get a guaranteed stage-2 `status` query from a full refresh if stage 1
  reported it empty — narrowing 114 AC2's own "currently selected server" guarantee now that a real
  selection UI exists. Fixed: `handleRefresh` now calls `startScan({kind:'all'}, selectedAddress ??
  undefined)`. No test asserted the old (gap-having) behavior, so nothing was weakened; re-verified
  clean (full changed-tests run, both tsc projects, the story's own e2e flow, all still green).
- **Fixed — an unreachable-in-practice normalization gap.** `scan-scope.ts`'s `'favourites'` branch
  used a stored favourite's address raw instead of normalizing it the same way the `'server'` branch
  and `address-set.ts`'s own `buildScanAddressSet` already do; `addFavourite` already normalizes on
  add, so this was very unlikely to matter in practice, but a favourite predating a stricter
  validator could in principle never be matched by `mergeStaleRound`'s `answeredOnline` lookup and so
  never flip stale on a timeout. Fixed defensively, mirroring the file's own existing normalize-or-
  fallback pattern; re-verified clean.
- **Left as documented, currently inert — origins are overwritten, not merged, on a scoped round.**
  `mergeSuccessfulReply` (`scan-service.ts`) writes `origins: target.origins` verbatim; for a
  `'server'` scope that is `[]`, for `'favourites'` it is `['favourite']` — either way, a
  successfully-refreshed row's `origins` field loses whatever other origins (`'manual'`, `'source'`)
  it previously carried, until the next full scan restores them. Nothing in the renderer or main
  reads `ServerListEntry.origins` today (confirmed by both D3's own agent and the reviewer,
  independently, via grep), so this is real but currently has no observable effect and violates no
  AC. Not fixed: merging origins correctly (union with the existing entry's origins, not replacing
  them) is a real but separate design decision the story's own Plan/Deliverables never raise, and
  inventing it under review-fix time pressure risks getting the merge semantics wrong in a way
  nothing in this story tests for. Left as a named follow-up candidate for whichever later story
  first reads `origins` for real (a natural fit alongside [[131]]'s watchlist work).
- **Left as documented, no AC impact.** A scoped round still bumps `ScanService`'s own `lastScanAt`
  and resets `sourceFailures` to `[]`, the same as a full scan — meaning a favourites-only or
  single-server manual refresh counts as "the list was just refreshed" for [[115]]'s cadence-spacing
  purposes, and briefly hides the last full scan's source failures (not rendered anywhere today).
  Redesigning `lastScanAt`/`sourceFailures` to be scope-aware would mean changing [[115]]'s cadence
  semantics, which this story's own Plan explicitly puts out of scope ("any change to the scan's
  cadence settings ([[115]])... is out of scope"). Named as a follow-up candidate, not invented here.
- **Left as documented, cosmetic only.** `ServersScanState.scope` is pushed to the renderer (per this
  story's own Decision, "so the view can name what is refreshing") but `ServersView.tsx` never reads
  it — the status line still says a generic "Scanning…" regardless of scope. No AC requires a
  per-scope label, and D5's own view stays "deliberately minimal" per 115's original framing; left
  for whichever story next touches this deliberately-bare view's copy.
- **Left as documented, cosmetic only.** The pre-existing "Refresh servers" button's visible label is
  still `module.servers.view.refresh` = "Scan now" (115's original wording), sitting next to the new
  "Refresh favourites"/"Refresh this server" labels — a naming inconsistency, not a functional gap.
  Not changed here: no AC or Decision asks for a copy change, and relabeling a shipped control's text
  outside what a story actually asks for is exactly the kind of unrequested edit this sprint's own
  discipline (fix only what's asked, document the rest) argues against.
- **Judged, not a defect.** The reviewer flagged `scan-scope.test.ts`'s "all scope" test as
  "circular" (it compares `resolveScanScopeAddresses({kind:'all'}, ...)` against a direct call to
  `buildScanAddressSet` with the same inputs). This is the intended proof, not a weakness: D2's own
  acceptance line asks for exactly this ("proves the same path, not a parallel one"), and AC1's
  literal wording is a structural claim about delegation, which a deep-equal-against-the-delegate-
  function comparison is the correct way to demonstrate. No change made.

**Progress trail:** `docs/sprints/S24/progress.md` has one started/done line per deliverable.
