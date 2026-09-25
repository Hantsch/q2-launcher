---
id: 117
title: a refresh only reloads what changed
status: ready # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — "Refresh servers" runs the same two-stage sweep [[114]] specifies over the same
      address set — it is not a separate, parallel implementation of a full scan.
- [ ] **AC2** — "Refresh favourites" runs stage 1 and stage 2 for the favourite addresses only, and
      does not issue any query for a non-favourite address; the rest of the list's data is left as it
      was before the refresh.
- [ ] **AC3** — "Refresh this server", available from the detail view, issues exactly one stage-2
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

- AC1 → e2e `scripts/flows/servers-scoped-refresh.mjs` › flow "servers-scoped-refresh" (the
  "Refresh servers" control makes every seeded address receive a stage-1 `info` packet) **plus**
  unit `src/main/modules/servers/scan-scope.test.ts` › "the all scope resolves to the same union
  address set as a scheduled scan" (D2/D3 — proves the same path, not a parallel one).
- AC2 → e2e `scripts/flows/servers-scoped-refresh.mjs` › flow "servers-scoped-refresh" (after
  "Refresh favourites": the favourite's responder logged packets, the non-favourite responders
  logged none, and the non-favourite rows still show their pre-refresh values) **plus** unit
  `src/main/modules/servers/scan-scope.test.ts` › "a favourites scope queries only favourite
  addresses" (D2/D3).
- AC3 → e2e `scripts/flows/servers-scoped-refresh.mjs` › flow "servers-scoped-refresh" (after
  "Refresh this server" on the selected server: exactly one `status` packet at that port, zero
  `info` packets anywhere, every other row unchanged) **plus** unit in D3's scheduler test ›
  "a single-server scope sends one status query and no info query" (D3).

## Done

<!-- Filled by `/build 117`. -->
