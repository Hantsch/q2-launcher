---
id: 250
title: Scan now refreshes only the servers my filter shows
status: done # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player with a filter active, "Scan now" refreshes just the servers I can see, so I get fresh
player counts and pings for them quickly instead of waiting for the whole list.

User feedback 2026-10-04: refresh only filtered servers — when filters are active, Scan now should
only refresh the servers left in the filter.

Today Scan now always runs a full round (`ScanScope 'all'`): master query, `info` to every address,
then `status` to every non-empty server. Other scopes are favourites and one server; there is no
scope for an arbitrary set of addresses. Filtering happens only in the renderer.

Concept: [servers-module.md](../../systems/servers-module.md), [game-browser.md](../../systems/game-browser.md).

## Acceptance Criteria

- [x] **AC1** — With a filter active, the button reads "Refresh N shown" and refreshes exactly the
      servers the list currently shows (both scan stages, no master query).
- [x] **AC2** — With no filter active, the button reads "Scan now" and runs the full scan as today.
- [x] **AC3** — A full scan stays reachable while a filter is active (e.g. a split-button entry
      "Scan all").
- [x] **AC4** — A server that no longer matches after the refresh leaves the list, like with any live
      update.
- [x] **AC5** — The visible set is sent as a validated list of addresses; main refuses addresses it
      does not already know.
- [x] **AC6** — Works in Online and LAN mode; in LAN it only re-queries known rows, no broadcast.
- [x] **AC7** — The existing scan rules still hold: one scan at a time, refused while the game runs.

## Open Questions

- ~~**Q1** — Does the free-text search count as "a filter" here? Recommendation: yes — it narrows the
  visible list the same way.~~ answered → Decisions (Sprint)
- ~~**Q2** — Should automatic refreshes (auto-refresh interval) also be limited to the filtered set?
  Recommendation: no — only the manual button; auto-refresh keeps the whole list fresh.~~ answered → Decisions (Sprint)
- ~~**Q3** — With [[247]]'s ping filter, servers above the limit are never re-pinged by this button and
  cannot come back until a full scan. Acceptable? Recommendation: yes, AC3 covers it.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Free-text search as filter: yes, counts as a filter.
- **(User)** Auto-refresh: only the manual button follows the filter; auto-refresh keeps the whole list.
- **(User)** Servers above 247's ping limit not re-pinged until a full scan: acceptable.
- New scope `{ kind: 'addresses', addresses }` (zod: `serverAddressSchema` items, min 1, max
  `SCAN_SCOPE_ADDRESSES_MAX = 10_000`): the existing scope union already narrows rounds, so a fourth kind
  reuses the guard, runner and merge, and the cap only bounds a hostile payload, far above real list sizes.
- "Known" means the addresses `read()` returns for the active mode (rows plus the online favourite/manual
  placeholders): that is exactly the set the renderer's list can show.
- Any unknown address refuses the whole start as a value (`servers.scan.error.unknownAddress`), no partial
  round: a well-behaved renderer never sends one, so a partial run would only hide a bug.
- Each target keeps the known row's origins (placeholder: favourite/manual; LAN: `['lan']`):
  `mergeSuccessfulReply` overwrites `origins` with the target's, so empty origins would erase them.
- Online: stale merge over the scope's addresses only. LAN: no discovery, no list clear, no stale merge.
  This mirrors how the LAN `'server'` scope already works, which AC6 asks for.
- `selectedAddress` is honoured when it lies inside the scope, so a selected empty server still gets its
  `status` refresh, the same as in a full scan.
- `ServersScanState.scope` carries `{ kind: 'addresses', count }`, never the list: the state is pushed on
  every progress tick, and no renderer code reads `scope`.
- "Filter active" is `isFilterActive` (`src/shared/servers/list-filter.ts`), which already counts the
  search and will count 247's ping limit, so the button follows the same definition the filter bar uses.
- Split button = the primary `Button` plus a chevron `Button` opening the existing `Menu` with one item
  "Scan all", shown only while a filter is active. No new UI primitive, because there is only one use.
- With a filter active and 0 shown, the primary is disabled with a visible reason line under the toolbar;
  "Scan all" stays enabled. This follows the toolbar's "every disabled control has a visible reason" rule.
- Auto-scan-on-open, auto-refresh, "Refresh favourites" and the watchlist keep their scopes unchanged,
  following the user's auto-refresh decision.
- Label is one key "Refresh {{count}} shown" (no plural forms), because the wording reads correctly for 1 too.
- The renderer handles a refused start like the existing refusals (no toast): busy/blocked already
  show their visible reasons, and the unknown-address case is a caller bug.

## Plan

1. **Contract** (`src/shared/modules/servers.ts`): add the `addresses` kind to `ScanScope` +
   `scanScopeSchema`, `SCAN_SCOPE_ADDRESSES_MAX`, `SCAN_UNKNOWN_ADDRESS_REASON_KEY`, and a
   `ScanStateScope` type (scope with `addresses` summarised to `count`) for `ServersScanState.scope`.
2. **Main** (`scan-scope.ts`, `scan-service.ts`): `start()` keeps guard → single-flight order; it then
   checks every address against the active mode's known set (refusing if any is unknown), resolves targets
   with their known origins, and runs online (two stages, no source resolution, stale merge over the scope)
   or LAN (runScan over the known rows, no discovery, no clear).
3. **Renderer**: `useServerScan` gains `refreshShown(addresses, selected)`. `ServersToolbar` takes
   `filterActive` + `shownCount` + `onRefreshShown`: while a filter is active it shows "Refresh N shown"
   plus a chevron menu with "Scan all", otherwise it shows "Scan now" as today. `ServersView` passes
   `isFilterActive(filter)`, `visible.length` and `visible.map(r => r.address)`.
4. **Proof + docs**: a new flow `servers-refresh-shown` (online, three loopback responders), a LAN step
   in `servers-lan-mode`, the systems docs and the changelog.

Order D1 → D2 → D3. The handler in `src/main/modules/servers/index.ts` forwards `payload.scope`
unchanged, so it needs no edit (`scan-cadence.test.ts` pins that line).

## Deliverables

- [x] **D1 — `addresses` scan scope in contract and main, plus its unit tests.**
  Files: `src/shared/modules/servers.ts` (`ScanScope` gains `{ kind: 'addresses'; addresses: string[] }`;
  `scanScopeSchema` entry `z.array(serverAddressSchema).min(1).max(SCAN_SCOPE_ADDRESSES_MAX)`;
  `export const SCAN_SCOPE_ADDRESSES_MAX = 10_000`; `export const SCAN_UNKNOWN_ADDRESS_REASON_KEY =
  'servers.scan.error.unknownAddress'`; `ScanStateScope` = the other kinds unchanged, or
  `{ kind: 'addresses'; count: number }`, used as the type of `ServersScanState.scope`),
  `src/main/modules/servers/scan-scope.ts`, `src/main/modules/servers/scan-service.ts`,
  `src/renderer/src/modules/servers/locale/en.json` (`servers.scan.error.unknownAddress`: "That server
  is no longer in the list." next to `already-running`), the `en.bundle.json` snapshot (`vitest -u`).
  Behaviour in `start()`, keeping the existing guard order (game-running → already-running → LAN
  favourites refusal): normalise each address (`parseServerAddress(...).normalized`) and de-duplicate.
  The known set is `read(sweepMode).entries` (rows plus online placeholders). If any address is not
  known → `refuse(SCAN_UNKNOWN_ADDRESS_REASON_KEY)` with no query sent. Otherwise
  build `ScanTarget`s with each known row's `origins` (LAN: `['lan']`), store the summarised scope in
  `scanState.scope`, and run:
  - **online** (`runOnlineRound`): no `resolveSources`; `runTargets = scopeTargets = those targets`;
    `runSelectedAddress = selectedAddress` only when it is in the scope; `mergeStaleRound` over
    `scopeTargets` only.
  - **LAN** (`runLanRound`): no `lanDiscovery`, no `entries.clear()`; `runScan` over the targets with
    the existing `onServer` filter (only rows already in the list are stored).
  In `scan-scope.ts` add the `addresses` case to `resolveScanScopeAddresses`, taking the known rows as
  a new parameter (pure, no I/O). Mirror the existing `'server'`/`'favourites'` branches; no second
  scan path.
  Tests: `src/main/modules/servers/scan-service.scoped-rounds.test.ts` (new `describe('addresses
  scope (story 250)')`, injected `queryServer`/`lanDiscovery`/`fetchImpl` spies as the file already
  does) and `src/main/modules/servers/scan-scope.test.ts`, plus the schema cases. Put them in the
  existing schema test for the servers contract if one exists (`src/shared/modules/servers*.test.ts`),
  otherwise in a new `src/shared/modules/servers.scan-scope.test.ts`. Named tests are listed under
  Acceptance Tests.

- [x] **D2 — Toolbar: "Refresh N shown" with a "Scan all" split entry, plus its component tests.**
  Files: `src/renderer/src/modules/servers/useServerScan.ts` (add `refreshShown: (addresses: string[],
  selected?: string) => void` → `startScan({ kind: 'addresses', addresses }, selected)`; the
  `refresh`/`refreshFavourites`/`refreshServer` shape stays),
  `src/renderer/src/modules/servers/ServersToolbar.tsx`, `src/renderer/src/modules/servers/ServersView.tsx`,
  `src/renderer/src/i18n/locales/en.shell.json` (next to `module.servers.view.refresh`: `refreshShown`
  "Refresh {{count}} shown", `scanAll` "Scan all", `scanOptions` "More scan options", `refreshShownNone`
  "No servers shown — use Scan all or clear the filter."), the `en.bundle.json` snapshot,
  `src/renderer/src/modules/servers/ServersView.test.tsx`.
  New toolbar props: `filterActive: boolean`, `shownCount: number` and `onRefreshShown: () => void`.
  With `filterActive`, the `servers-refresh` button reads `refreshShown` (count = shownCount) and
  calls `onRefreshShown`. It is disabled while busy/blocked or when `shownCount === 0`, in which case
  the `servers-refresh-none` reason line shows. Beside it sits a chevron `Button`
  (`data-testid="servers-refresh-options"`, `aria-label` = `scanOptions`, `aria-haspopup="menu"`,
  `aria-expanded`), wrapped in the existing `Menu` (`src/renderer/src/components/ui/Menu.tsx`,
  `side="below"`) with one item `{ id: 'scan-all', label: scanAll }` → `onRefresh`. It is disabled
  while busy/blocked. Without a filter: today's single "Scan now" button, no chevron.
  `ServersView` passes `filterActive={isFilterActive(filter)}`, `shownCount={visible.length}` and
  `onRefreshShown={() => scan.refreshShown(visible.map((r) => r.address), selectedAddress ?? undefined)}`.
  Use tokens only, `size="sm"` (28px floor deviation), and add the focus ring through `Button`.

- [x] **D3 — e2e proof, systems docs and changelog.**
  Files: new `scripts/flows/servers-refresh-shown.mjs`, which mirrors `scripts/flows/servers-scoped-refresh.mjs`
  (three responders via `makeResponderBinder(..., { counted: true })` from `scripts/lib/servers-stub.mjs`,
  `readFinishedAt`/`waitForFinishedAtChange` from `scripts/lib/servers-flow.mjs`, the same fixture
  with disabled sources and auto-behaviours off; give the responders distinct hostnames so a search
  term matches exactly one or two). Steps: (1) "Scan now" with no filter → all three get info+status;
  (2) type a search matching A and B → button text "Refresh 2 shown", click → A and B get
  info+status, C gets zero packets, and the http-list/master is not contacted (sources disabled, so
  assert `scan.read` `state.sourceFailures` is empty); (3) open `servers-refresh-options`, click the
  menuitem named "Scan all" → C is queried too; (4) clear the search → button reads "Scan now".
  `scripts/flows/servers-lan-mode.mjs`: append a step after the LAN scan. Type a search matching the
  LAN hostname → "Refresh 1 shown" → click. The LAN row is still listed and refreshed (`data-finished-at`
  changed), and the list is not emptied.
  `docs/systems/servers-module.md` (`scanStart` line: the scopes incl. `addresses` and the unknown-address
  refusal), `docs/systems/game-browser.md` line ~48 ("Refreshes are scoped" gains "the servers the
  filter shows"), and `CHANGELOG.md` under `## Unreleased` (one line: "Scan now refreshes only the
  servers your filter shows; Scan all is one click away.").

## Model Hints

- D1 → deliverable-hard — the new scope threads through `runOnlineRound`/`runLanRound`, where a wrong
  `runTargets`/`scopeTargets`, an emptied `origins` or a LAN `entries.clear()` silently corrupts rows
  outside the scope; the existing tests cannot see that.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-refresh-shown.mjs` › "servers-refresh-shown"; unit
  `src/main/modules/servers/scan-service.scoped-rounds.test.ts` › "an addresses round queries exactly
  those addresses through both stages and never resolves sources"; component
  `src/renderer/src/modules/servers/ServersView.test.tsx` › "with a filter active the button reads Refresh N
  shown and starts the addresses scope with the visible rows"
- AC2 → e2e `scripts/flows/servers-refresh-shown.mjs` › "servers-refresh-shown" (steps 1 and 4); component
  `src/renderer/src/modules/servers/ServersView.test.tsx` › "with no filter the button reads Scan now, has no
  options menu and starts the all scope"
- AC3 → e2e `scripts/flows/servers-refresh-shown.mjs` › "servers-refresh-shown" (step 3); component
  `src/renderer/src/modules/servers/ServersView.test.tsx` › "Scan all in the options menu starts the all scope
  while a filter is active"
- AC4 → component `src/renderer/src/modules/servers/ServersView.test.tsx` › "a row that stops matching the
  filter after a scan.server push leaves the list"
- AC5 → unit `src/main/modules/servers/scan-service.scoped-rounds.test.ts` › "an addresses round naming an
  address the active list does not know is refused with no query sent"; unit (schema test file per D1) ›
  "the addresses scope rejects an empty list, an invalid address and more than SCAN_SCOPE_ADDRESSES_MAX"
- AC6 → e2e `scripts/flows/servers-lan-mode.mjs` › "servers-lan-mode"; unit
  `src/main/modules/servers/scan-service.scoped-rounds.test.ts` › "a LAN addresses round re-queries known
  LAN rows without discovery and keeps the list"
- AC7 → unit `src/main/modules/servers/scan-service.scoped-rounds.test.ts` › "an addresses round is refused
  while a scan runs and while the game runs"; component
  `src/renderer/src/modules/servers/ServersView.test.tsx` › "the refresh-shown button and the options menu
  are disabled while a scan runs or the game blocks it"

## Done

Scan now follows the filter: with one active the button reads "Refresh N shown" and refreshes exactly the
visible servers (new `addresses` scan scope, both stages, no master query); a chevron menu keeps "Scan all".
Unknown addresses are refused whole; LAN re-queries known rows only. Auto-refresh and favourites are unchanged.

**Commit message:** `250: Scan now refreshes only the servers the filter shows — addresses scan scope, "Refresh N shown" + Scan all menu, servers-refresh-shown flow`

**Verification (narrow gate):** build, typecheck, lint green; `npx vitest run --changed HEAD` 180 files green; comments + architecture tests green (after fixing two story-pointer placements). Flows: `--affected` not used; the new flow is not in `areas.json` (rows capped at 12, registering worsened flow-select.test), so all 25 `servers-*` flows incl. servers-refresh-shown and servers-lan-mode were run by name in 3 batches: all OK. Review (default tier, 1 cycle): PASS.
AC → test: AC1/2/3 → ServersView.test.tsx component tests + servers-refresh-shown flow; AC4 → ServersView.test.tsx "a row that stops matching…"; AC5 → scoped-rounds unknown-address test + servers.test.ts schema test; AC6 → scoped-rounds LAN test + servers-lan-mode; AC7 → scoped-rounds refused test + ServersView disabled test. All ran and passed. No manual residue.

**Decisions:** `scrollToSourceSettings.ts` extracted from ServersView.tsx to stay under the renderer-health line cap (pure move). New flow left out of `areas.json` (see above). Review nits left: AC4 test mostly re-exercises live filtering; AC1 component test does not pass a selected address through the view; "http-list not contacted" is asserted as empty `sourceFailures` as the plan prescribes.
Open: an `all` round leaves a silent favourite as a stale row, contradicting a scan-service header comment ("never gets a row") — pre-existing, untouched.

tiers: D 3 / hard 1 · review default · cycles 1 · agents 6
