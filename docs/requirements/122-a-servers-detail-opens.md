---
id: 122
title: a server's detail opens
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user clicks a server row in the list ([[118]]) and sees what is actually happening on that
server: who is there, how full it is, and enough identifying detail (name, address, mod, map,
gamemode, engine, protocol) to know what they would be joining. Today the [[118]] list row is the
only surface a user has — a name, an occupancy count, a ping. The detail view is where the browser
answers the second half of its own vision (concept §1): not just "is anyone out there" but "what is
going on, in detail, on this one server".

This story ships the entry point to that view: its header and its players panel. The header renders
the fields concept §9 item 1 lists, built from the same [[108]] `info`/`status` results the list row
already renders a subset of. The players panel (§9 item 2) is the first place a user actually sees
individual people, not aggregate occupancy — and it is exactly where the protocol's real limit has to
be respected rather than glossed over: a `status` reply carries score, ping and name for each
connected client and nothing else (concept §6.3). Some mods list spectators with score 0, some omit
them entirely; neither case is distinguishable from a player who has not scored yet (§6.4). The view
therefore says nothing about who is spectating anywhere — not a column, not a marker, not a tooltip —
because a plausible-looking guess is worse than silence here (GB-D1's "no claim" language, the
decision the interview reached once the protocol limitation was raised).

This story is also where the view's general robustness rule (GB-D6: "a missing or malformed key
never breaks the view; each field degrades on its own") has to hold for the first time, because it
is the entry point every other detail-view story is opened through. The same discipline — one field
failing never takes the surrounding view with it — applies again in [[123]]'s rule table and dmflags
decode, and in [[124]]'s ping history and last-answer statement; it is stated once here as the
shared floor rather than re-derived as a duplicate criterion in each of the three stories.

Out of scope: the rule table and dmflags ([[123]]), ping history ([[124]]), and the view's actions
row (Join/Spectate/Favourite/Add-to-address-book/Copy-address), which belongs to milestone 9.6 — see
[[125]], [[126]], [[127]]. Together, 122/123/124 compose sections 1-5 of the detail view concept §9
describes; this story is sections 1-2. Section 6 (local mod/map availability) is deferred to the
mods/assets modules — see [[124]]'s Decisions.

## Acceptance Criteria

- [ ] **AC1** — Opening a server row from [[118]] opens a detail view whose header shows name,
      address, mod, map, gamemode, occupancy, measured ping, password marker, engine and protocol
      (concept §9 item 1).
- [ ] **AC2** — The players panel lists each connected player's name, score and ping, and the list is
      sortable by at least one of those columns.
- [ ] **AC3** — A server currently reporting zero players shows a stated empty state in the players
      panel, not a blank area.
- [ ] **AC4** — Nowhere in the view — header, players panel or any marker — does the UI claim or
      imply which players are spectating; data the protocol cannot provide is simply not rendered as
      a claim.
- [ ] **AC5** — A single missing or malformed field, in the header or in one player's row, degrades
      on its own (shown as absent/unknown) without breaking the rendering of the rest of the header
      or the rest of the player list (GB-D6).

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Decisions (Sprint)

- **Selecting a row opens the detail.** The existing row selection (`selectedAddress` in
  `ServersView.tsx`) is what opens the view, and the selected server is already the one a full scan
  gives stage 2 (`startScan({kind:'all'}, selectedAddress)`) and "Refresh selected" refreshes. That
  is concept §7.2 and GB-N10's "selected server", so a second "open" notion would only drift from it.
- **The detail is a pane next to the list, not a new route.** ServersView becomes two columns (list
  left, detail right, each scrolling on its own) while a row is selected. Routing is a flat string
  switch with no nesting (ARCHITECTURE.md › Renderer), and the concept §5 diagram puts list and
  detail inside the one `ServersView`. Closing it means clicking the selected row again or the
  pane's close button. When [[120]]'s filter hides the selected row, the pane closes with it.
- **Opening is a pure read: no automatic query.** The detail shows what main already holds. The
  next full scan fetches its `status` through the existing `selectedAddress` path, and "Refresh
  selected" (117) fetches it at once. An auto-query on open would collide with the single-flight
  guard and GB-N5's game-running refusal for no gain.
- **A new `detail.read` handler returns `ServerDetail = { row: ServerListRow; serverinfo:
  Record<string,string> | null }`.** Concept §16 names "read detail" as a handler. `serverinfo` is
  the full key set of the last *successful `status` reply*, replaced whole (not merged) and kept
  while stale (GB-N6). It lives in a scan-service map, not on `ServerListEntry`, so `scan.read`
  does not ship every server's full serverinfo. [[123]] reads its rule table from this field, and
  [[124]] extends `ServerDetail` with its ping history. The result is `null` when `scan.read` would
  list no row for the address.
- **The detail re-reads at round end.** It reads when it opens, when the address changes and when a
  `scan.changed` push carries a new `finishedAt`. That is the same cadence as 118's rows, and
  per-server streaming stays [[121]]'s concern.
- **Engine and protocol come from `serverinfo.protocol`.** `readIntKey` gives the protocol, and the
  engine is `34 → vanilla`, `35 → r1q2`, `36 → q2pro`, as the concept §6.2 table maps them. Any
  other integer shows the protocol number with engine "—". A missing or non-integer value shows
  "—" for both. The raw `version` string is a rule-table row for [[123]], not the engine label,
  because it is free-form server text.
- **Header fields reuse 118's derivations and formatting.** Gamemode comes from `row.gamemode`,
  occupancy from `knownPlayerCount`/`maxclients`, and ping from `rttMs`. The name falls back to the
  address. Every unknown value is "—", never 0 or a guess. The password marker is the same
  icon-plus-text marker the row shows. The row's formatters move to one shared renderer file so the
  row and the header cannot drift apart.
- **Players panel states.** A roster (array) → a sortable table. A known count of 0 (a number 0 or
  an empty roster) → the stated empty state (AC3). A positive number with no roster → "N connected
  — names arrive with the next detailed scan". `players` undefined → "Player data not fetched yet".
  Only a *known* zero is ever called empty (GB-N6).
- **Sorting.** The columns are name, score and ping, each with a header button and `aria-sort`.
  The default is score descending. Clicking the active column flips the direction, and clicking
  another column picks it with its natural direction (score descending, ping and name ascending).
  The sort is stable by roster order. A non-finite number or an empty name sorts last in either
  direction. The sort is not remembered: GB-L6's "remembered" is about the list. The pure sort sits
  in `src/shared/servers/player-sort.ts`, next to the other pure servers helpers (GB-A6).
- **No spectator claim, not even stylistically (AC4).** A score-0 or ping-0 player's row is
  markup-identical to any other row: no dimming, no icon, no tooltip, no column. No i18n key under
  `servers.detail` mentions spectating.
- **GB-D6 floor, twice.** (1) Each cell formats through a guard: a non-finite number or a
  non-string/empty name renders "—" in that cell only. (2) Each section of the detail (header,
  players, and later [[123]]/[[124]]'s sections) is wrapped in a `ServerDetailSection` error
  boundary. A section that throws renders one i18n'd "This section could not be shown" line, and
  the other sections keep rendering. 123/124 add their panels as further wrapped children of
  `ServerDetailView` and inherit the floor instead of re-deriving it.
- **Sizing stays on the 44px floor.** The close button and the sort headers are `min-h-11`, so no
  new CLAUDE.md deviation row is needed.
- **No `ui:verify` registry entry here.** The detail screen belongs in the registry once the view is
  complete ([[124]], the last detail section), and the registry's local scan stub is [[121]]'s
  list-states work. This story is proven by its own `ui:flow`.

## Plan

Builds on 118's `ServerListRow`/`row-markers.ts`/`ServerRow.tsx`, 119/120's `ServersView.tsx` and
117's scoped refresh. Order: shared → main → renderer.

1. **D1 (shared, pure):** `server-engine.ts` (protocol/engine from serverinfo) and `player-sort.ts`
   (stable roster sort), each with its colocated test.
2. **D2 (contract + main):** `detail.read` in `SERVERS_HANDLERS` with an address schema and the
   `ServerDetail` type. The scan service keeps the last `status` serverinfo per address and serves
   `readDetail(address)`. It is registered in the module's `index.ts`.
3. **D3 (renderer container + header):** a `readServerDetail` client, the `ServerDetailView`
   container with `ServerDetailSection` boundaries, `ServerDetailHeader`, and the ServersView
   two-column pane opened by selection. The row formatters are extracted, the i18n keys and the
   CHANGELOG are added, and a new `servers-detail` flow covers the header.
4. **D4 (players panel):** `ServerPlayersPanel` (table, sort headers, four states, cell guards)
   mounted in the container, plus its component tests. The `servers-detail` flow is extended for
   players, empty state and the no-spectator check.

Out of scope: rules/dmflags ([[123]]), reachability/stale statement ([[124]]), actions
([[125]]–[[127]]), the `ui:verify` registry entry, and an auto-query on open.

## Deliverables

- **D1 — engine and player-sort derivations (shared, pure).**
  - Create `src/shared/servers/server-engine.ts` with a colocated `server-engine.test.ts`:
    - `export type ServerEngine = 'vanilla' | 'r1q2' | 'q2pro'`.
    - `deriveProtocol(serverinfo: Record<string,string> | null | undefined): number | undefined`
      returns `readIntKey(serverinfo,'protocol')` (from `src/shared/servers/infostring.ts`), or
      `undefined` for null/undefined input.
    - `deriveEngine(protocol: number | undefined): ServerEngine | undefined` maps `34 → 'vanilla'`,
      `35 → 'r1q2'` and `36 → 'q2pro'`. Anything else is `undefined`.
  - Create `src/shared/servers/player-sort.ts` with a colocated `player-sort.test.ts`:
    - `export type PlayerSortKey = 'name' | 'score' | 'ping'`, `export type SortDir = 'asc' | 'desc'`.
    - `export const DEFAULT_PLAYER_SORT = { key: 'score', dir: 'desc' } as const`.
    - `naturalDir(key)` returns `score → 'desc'`, and `'asc'` for `ping` and `name`.
    - `sortPlayers(players: readonly ServerPlayer[], key, dir): ServerPlayer[]` returns a new array
      and leaves its input untouched. Ties keep roster order. A value that is not a finite number
      (score/ping), or a name that is not a non-empty string, sorts **last in both directions**.
      Names compare with `localeCompare(…, undefined, { sensitivity: 'base' })`. `ServerPlayer`
      comes from `src/shared/servers/status-reply.ts`.
  - Files: those four. Mirror: `src/shared/servers/infostring.ts` (pure helper plus colocated test).
  - Tests:
    - `server-engine.test.ts` › "maps protocol 34/35/36 to its engine and anything else to unknown"
      covers `'34'`, `'35'`, `'36'`, `'37'`, `'abc'`, a missing key and `null` serverinfo.
    - `player-sort.test.ts` › "sorts by each column in both directions, stable on ties".
    - `player-sort.test.ts` › "malformed values sort last in either direction" covers a `NaN` ping,
      an `Infinity` score and an empty name.
  - Acceptance: `npx vitest run src/shared/servers` passes and `npm run typecheck` is clean.

- **D2 — `detail.read` in the contract and in main.**
  - In `src/shared/modules/servers.ts`:
    - Add `detailRead: 'detail.read'` to `SERVERS_HANDLERS`.
    - Add `export const detailReadInputSchema = serverAddressSchema`, the same payload shape as
      `favouritesAddInputSchema`, and its entry in `SERVERS_HANDLER_SCHEMAS`.
    - Add `export interface ServerDetail { row: ServerListRow; serverinfo: Record<string,string> |
      null }` with a doc comment. `serverinfo` is the full key set of the last successful `status`
      reply, replaced whole on each one, kept while stale, and `null` until one arrives. Later
      detail stories extend this type.
  - Update `src/shared/modules/servers.test.ts`: its literal `SERVERS_HANDLERS` expectation, plus a
    case that `detailReadInputSchema` accepts `{ address: '127.0.0.1:27910' }`-shaped input (use
    whatever `serverAddressSchema` accepts) and rejects `{}`.
  - In `src/main/modules/servers/scan-service.ts`:
    - Add a closure `const statusInfo = new Map<string, Record<string,string>>()`. In `onServer`,
      when `row.result.ok && row.result.kind === 'status'`, run
      `statusInfo.set(address, { ...row.result.reply.serverinfo })`. An `info` reply or a failure
      never touches it.
    - Add `readDetail(address: string): ServerDetail | null`. It finds the row in
      `read().entries`, so 118's live `favourite` and `pending` placeholders apply. It returns
      `{ row, serverinfo: statusInfo.get(address) ?? null }`, or `null` when there is no row.
    - Add `readDetail` to the `ScanService` interface and the returned object.
  - In `src/main/modules/servers/index.ts`, register
    `handle(SERVERS_HANDLERS.detailRead, detailReadInputSchema, ({ address }) => scanService.readDetail(address))`.
    Match the payload shape `serverAddressSchema` actually defines.
  - Files: `src/shared/modules/servers.ts`, `src/shared/modules/servers.test.ts`,
    `src/main/modules/servers/scan-service.ts`, `scan-service.test.ts`, `index.ts`, `index.test.ts`.
  - Mirror: the `scanRead` handler registration (`index.ts:89`), and the fake-`queryServer` tests in
    `scan-service.test.ts`.
  - Tests:
    - `scan-service.test.ts` › "readDetail returns the row and the last status serverinfo, kept
      while stale". This covers: status reply A then status reply B, where B lacks a key A had, so
      the result is exactly B's keys. An `info` reply afterwards leaves it unchanged. A timed-out
      round leaves it unchanged and the row stale.
    - `scan-service.test.ts` › "readDetail is null for an unknown address and has null serverinfo
      for an info-only or pending row".
    - `index.test.ts` › "detail.read rejects a malformed address payload".
  - Acceptance: `npx vitest run src/main/modules/servers src/shared/modules` passes and
    `npm run typecheck` is clean.

- **D3 — the detail container, its header, and opening it from the row.**
  - `src/renderer/src/modules/servers/client.ts`: add
    `readServerDetail(address) → callModule<ServerDetail | null>('servers', SERVERS_HANDLERS.detailRead, …)`,
    with a test in `client.test.ts` next to the `readScan` one.
  - Create `server-format.ts` in the same folder. Move the row's value formatters out of
    `ServerRow.tsx` into it (display name with its address fallback, occupancy `x/y` with "—",
    ping `N ms` with "—", and a generic `orDash(value)` that treats non-finite numbers and
    empty/non-string strings as "—"), and make `ServerRow.tsx` import them. The row's behaviour
    does not change, and `ServerRow.test.tsx` still passes untouched.
  - Create `ServerDetailSection.tsx`: a small class error boundary, mirroring
    `src/renderer/src/components/ErrorBoundary.tsx` (`getDerivedStateFromError`), with props
    `{ id: string; children }`. On a throw it renders `<p data-testid="servers-detail-section-error-<id>">`
    with `t('servers.detail.sectionError')` ("This section could not be shown."), and siblings are
    unaffected. `componentDidCatch` logs via `console.error`.
  - Create `ServerDetailView.tsx` with props `{ address: string; onClose(): void }`:
    - It calls `readServerDetail(address)` on mount and when the address changes. It re-reads when
      an `onScanChanged` push carries a `finishedAt` different from the last one seen, and ignores a
      late response for an address that is no longer current.
    - It renders `<section aria-labelledby=… data-testid="servers-detail">` with a close
      `IconButton`/`Button` (`min-h-11`, `aria-label` via i18n, testid `servers-detail-close`).
    - It then renders an ordered list of sections, each in `<ServerDetailSection id=…>`: for now
      `header` → `<ServerDetailHeader detail>`. A doc comment says the later detail sections are
      added here, each wrapped the same way.
    - A `null` result renders `EmptyState` with `servers.detail.gone` ("This server is no longer
      in the list"). A rejected read renders one error line and never throws.
  - Create `ServerDetailHeader.tsx` with props `{ detail: ServerDetail }`, using semantic tokens and
    the `KeyValue`/`Badge` primitives (`components/ui/primitives.tsx`). Each field has testid
    `servers-detail-field-<key>`:
    - `name` is the display name, as a heading.
    - `address`, `mod`, `map`, and `gamemode` (label `servers.gamemode.<mode>` or "—").
    - `occupancy` and `ping`.
    - `password`: the row's lock marker plus text, shown only when `needpass === true`.
    - `engine`: `servers.engine.<engine>` from `deriveEngine(deriveProtocol(serverinfo))`, or "—".
    - `protocol`: the number, or "—".
    - Every value goes through `server-format.ts`, so one bad field renders "—" and nothing else.
  - `ServersView.tsx`: while `selectedAddress !== null`, the content becomes a two-column grid,
    with the list left and `<ServerDetailView address={selectedAddress} onClose={() => setSelectedAddress(null)} />`
    right. Each column scrolls on its own (`min-h-0 overflow-y-auto`). Row click, "Refresh
    selected" and [[120]]'s clear-on-filter keep working unchanged.
  - `src/renderer/src/i18n/locales/en.json`: add `servers.detail.*` (title, close, the field
    labels, sectionError, gone, readError) and `servers.engine.{vanilla,r1q2,q2pro}`
    ("Vanilla Quake II", "R1Q2", "Q2PRO"). No key mentions spectating.
  - `CHANGELOG.md`: add one `### Added` entry ("click a server and see what's going on there").
  - Tests:
    - `ServerDetailHeader.test.tsx` › "shows name, address, mod, map, gamemode, occupancy, ping,
      password, engine and protocol".
    - `ServerDetailHeader.test.tsx` › "one malformed field shows a dash and the rest still render"
      covers protocol `'abc'`, `maxclients` absent, `rttMs: NaN`, and `name` absent (the address is
      shown).
    - `ServerDetailView.test.tsx` (mocked client, mirroring `ServersView.test.tsx`) › "a section
      that throws shows its fallback and the other sections still render". Inject a throwing child
      through a test-only wrapper around `ServerDetailSection`.
    - `ServerDetailView.test.tsx` › "re-reads when a scan round finishes".
    - `ServersView.test.tsx` › "selecting a row opens its detail and the close button closes it".
    - `scripts/flows/servers-detail.mjs` (flow name `servers-detail`):
      - Fixture: every master source disabled (`SERVERS_DISABLED_SOURCES`) and the scan autos off.
        Three loopback `dgram` responders run as manual servers:
        - A: `hostname`, `mapname q2dm1`, `gamename`, `maxclients 16`, `protocol 35`,
          `deathmatch 1`, `needpass 1`, and three players: scores `12`, `0` and `5`, one of them
          with ping `0`.
        - B: 0 players.
        - C: 2 players, `protocol abc`, no `gamename`, `maxclients x`.
      - Click "Refresh servers", wait for the round, then click A's row. The header shows every
        AC1 field: engine "R1Q2", protocol 35, "Deathmatch", "3/16", password marker, the ping.
      - Click C's row: engine, protocol and mod show "—", while name, map and address still show
        (AC5).
      - Close the pane. Take screenshots per phase.
      - Mirror `scripts/flows/servers-scoped-refresh.mjs` (`bindResponder`, fixture seeding,
        `waitForFinishedAtChange`, copied, not imported) and the status byte builders in
        `src/shared/servers/reply-fixtures.ts`.
  - Files: `client.ts`, `client.test.ts`, `server-format.ts`, `ServerRow.tsx`,
    `ServerDetailSection.tsx`, `ServerDetailView.tsx` (+ test), `ServerDetailHeader.tsx` (+ test),
    `ServersView.tsx`, `ServersView.test.tsx` (all in `src/renderer/src/modules/servers/`),
    `en.json`, `CHANGELOG.md`, `scripts/flows/servers-detail.mjs`. Most of these files are thin,
    and a single boundary is crossed (the renderer).
  - Acceptance: `npx vitest run src/renderer/src/modules/servers` passes, and
    `npm run ui:flow -- servers-detail` passes with its screenshots.

- **D4 — the players panel.**
  - Create `src/renderer/src/modules/servers/ServerPlayersPanel.tsx` with props
    `{ row: ServerListRow }` and testid `servers-detail-players`. It renders one of four states:
    - `Array.isArray(row.players) && row.players.length > 0` → a `<table>`:
      - Columns name, score and ping. Each `<th aria-sort>` holds a `<button>` (`min-h-11`, testid
        `servers-detail-players-sort-<key>`, visible i18n label).
      - Sort state lives in `useState`, starts at `DEFAULT_PLAYER_SORT`, and follows the D1 click
        rule: the active column flips its direction, and another column starts at
        `naturalDir(key)`. Rows come from `sortPlayers` (`src/shared/servers/player-sort.ts`).
      - Each `<tr data-testid="servers-detail-player-row">` renders name, score and ping through
        `orDash` (`server-format.ts`), so a malformed cell shows "—" in that cell only.
      - Every row gets **the same markup**, whatever its values: no conditional class, attribute,
        icon or title by score or ping.
    - A known zero (`players === 0` or `[]`) → `EmptyState` with `servers.detail.players.empty`
      ("Nobody is on this server right now"), testid `servers-detail-players-empty`.
    - A positive number → `servers.detail.players.notFetched` ("{{count}} connected, names arrive
      with the next detailed scan").
    - `undefined` → `servers.detail.players.unknown` ("Player data not fetched yet").
  - Mount it in `ServerDetailView.tsx` as the second section:
    `<ServerDetailSection id="players"><ServerPlayersPanel row={detail.row} /></ServerDetailSection>`.
  - Add the `servers.detail.players.*` keys (column labels, sort button labels, the three states)
    to `en.json`. None of them mentions spectating.
  - Tests (`ServerPlayersPanel.test.tsx`):
    - "lists name, score and ping for each player".
    - "clicking a column header sorts by it and flips aria-sort".
    - "a known zero shows the empty state; an unknown count does not" covers `0`, `[]`, `4` and
      `undefined`.
    - "a malformed player cell shows a dash and the other rows render" covers an empty name and a
      `NaN` ping.
    - "makes no spectator claim". A roster with score-0/ping-0 players and scoring players: no text
      matching `/spectat/i` in the panel, and a score-0 row's `className` and attribute set equal a
      scoring row's. A second check walks `en.json`'s `servers.detail` subtree and finds no string
      matching `/spectat/i`.
  - Extend `scripts/flows/servers-detail.mjs`:
    - After the header checks on A: three player rows, with score order `12, 5, 0` by default.
    - Clicking the ping header puts the ping-0 player first.
    - The detail pane's `innerText` has no `/spectat/i` match (AC4).
    - Clicking B's row shows `servers-detail-players-empty` (AC3).
  - Files: `ServerPlayersPanel.tsx`, `ServerPlayersPanel.test.tsx`, `ServerDetailView.tsx`,
    `en.json`, `scripts/flows/servers-detail.mjs`.
  - Mirror: `ServerRow.tsx` for tokens, i18n and testids.
  - Acceptance: `npx vitest run src/renderer/src/modules/servers` passes, and
    `npm run ui:flow -- servers-detail` passes with its screenshots.

## Model Hints

- D1, D2, D3, D4 → default tier. D1 is two pure helpers. D2 is one handler plus a map, pinned by
  named tests on the 114/117 pattern. D3 is components on the 118 pattern plus a class boundary.
  D4 is one table component.
- Review: → default. The plausible wrong implementation is styling score-0 players as spectators
  (dimmed, no text). D4's "makes no spectator claim" test compares the row markup directly, so a
  hard second pass buys nothing here.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-detail.mjs` › flow "servers-detail" (clicking A's row opens the
  detail, and the header shows name, address, mod, map, gamemode, occupancy, ping, password, engine
  "R1Q2" and protocol 35). Also unit
  `src/renderer/src/modules/servers/ServerDetailHeader.test.tsx` › "shows name, address, mod, map,
  gamemode, occupancy, ping, password, engine and protocol" (D3), `ServersView.test.tsx` ›
  "selecting a row opens its detail and the close button closes it" (D3),
  `src/shared/servers/server-engine.test.ts` › "maps protocol 34/35/36 to its engine and anything
  else to unknown" (D1), and `src/main/modules/servers/scan-service.test.ts` › "readDetail returns
  the row and the last status serverinfo, kept while stale" (D2).
- AC2 → e2e `scripts/flows/servers-detail.mjs` › flow "servers-detail" (A lists three players by
  score by default, and a ping-header click reorders them). Also unit
  `src/renderer/src/modules/servers/ServerPlayersPanel.test.tsx` › "lists name, score and ping for
  each player" and › "clicking a column header sorts by it and flips aria-sort" (D4), and
  `src/shared/servers/player-sort.test.ts` › "sorts by each column in both directions, stable on
  ties" (D1).
- AC3 → e2e `scripts/flows/servers-detail.mjs` › flow "servers-detail" (B's detail shows
  `servers-detail-players-empty`). Also unit `ServerPlayersPanel.test.tsx` › "a known zero shows
  the empty state; an unknown count does not" (D4).
- AC4 → e2e `scripts/flows/servers-detail.mjs` › flow "servers-detail" (no `/spectat/i` anywhere in
  the open detail pane, with score-0 and ping-0 players on A). Also unit
  `ServerPlayersPanel.test.tsx` › "makes no spectator claim" (D4: the text, the row-markup equality
  and the `servers.detail` i18n subtree).
- AC5 → e2e `scripts/flows/servers-detail.mjs` › flow "servers-detail" (C's malformed
  `protocol`/`maxclients` and missing `gamename` show "—", while name, map and address still
  render). Also unit `ServerDetailHeader.test.tsx` › "one malformed field shows a dash and the rest
  still render" (D3), `ServerPlayersPanel.test.tsx` › "a malformed player cell shows a dash and the
  other rows render" (D4), `ServerDetailView.test.tsx` › "a section that throws shows its fallback
  and the other sections still render" (D3), and `player-sort.test.ts` › "malformed values sort
  last in either direction" (D1). The e2e covers the header only: `parseStatusReply` drops a
  malformed player line all-or-nothing (108), so a malformed per-player field cannot reach the
  real surface and is proven at component level.

No `manual residue`.

## Done

<!-- Filled by `/build 122`. -->
