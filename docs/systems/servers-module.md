# Servers module

Status: **Implemented.** The game browser: scans master sources and the LAN for Quake II servers,
lists and filters them, keeps favourites, history and a name watchlist, and joins a server. The
long design reference is [game-browser.md](game-browser.md).

This document describes the module as built. `servers` is a registered module; its contract is
`src/shared/modules/servers.ts`.

## Purpose

- Build the address set (master sources, favourites, manual servers) and query every address in
  two stages (`info`, then `status` on demand), streaming one row per result.
- Show the rows in a sortable, filterable list with a detail view (players, rules, reachability,
  local content) and one-click join.
- Persist the user's sources, favourites, history, scan settings, sort, watchlist and quick
  filters.

## Map

**Main** (`src/main/modules/servers/`)

- `index.ts` — the module: registers every handler and pushes the events.
- `scan-service.ts` / `scan-runner.ts` / `scan-guard.ts` / `scan-merge.ts` — the scan: one scan at a
  time (a second start is refused as a value), the two-stage runner, row merging.
- `scan-scope.ts` / `scan-cadence.ts` / `address-set.ts` / `source-resolution.ts` — which addresses
  a scan covers, auto-refresh timing while the view is active, address-set assembly.
- `master-sources.ts` / `udp-master-source.ts` / `http-list-source.ts` — master source list
  handling and the two transports.
- `server-query.ts` / `lan-discovery.ts` — one-server UDP queries and LAN broadcast discovery.
- `favourites.ts` / `history-log.ts` / `quick-filter-entries.ts` — the persisted collections.
- `watchlist-service.ts` / `watchlist-entries.ts` / `watchlist-matcher.ts` /
  `watchlist-regex-host.ts` — watchlist entries and name matching (regex runs isolated).
- `persisted.ts` — the forgiving parse of the module's state section.

**Shared** (`src/shared/`, pure)

- `modules/servers.ts` — handler maps, events, schemas, state types and defaults.
- `servers/` — `address.ts`, `protocol.ts`, `info-reply.ts`, `status-reply.ts`,
  `master-records.ts`, `http-list.ts`, `master-source-address.ts`, `list-filter.ts`,
  `list-sort.ts`, `player-sort.ts`, `quick-filters.ts`, `row-markers.ts`, `dmflags.ts`.

**Renderer** (`src/renderer/src/modules/servers/`)

- `ServersView.tsx`, `ServersTabStrip.tsx`, `ServersToolbar.tsx`, `ServersModeToggle.tsx`,
  `ServerListHeader.tsx`, `ServerListFilterBar.tsx`, `ServerRow.tsx`, `ServersListStatus.tsx` —
  the list.
- `ServerDetailView.tsx` and its `ServerDetailSection.tsx`, `ServerPlayersPanel.tsx`,
  `ServerRulesPanel.tsx` sections.
- `join/useJoinFlow.tsx`, `join/join-flow.ts`, `join/JoinServerButton.tsx` — joining.
- `watchlist/WatchlistPanel.tsx` with `watchlist/useWatchlist.ts`; `useServerScan.ts`,
  `useQuickFilters.ts`, `client.ts`, `list-state.ts`, `list-grid.ts`, `locale/en.json`.

## Persisted state

`persisted.ts` stores the `servers` slot of state.json; every collection is parsed forgivingly
(a bad row costs only itself) and every address is re-validated and normalised.

- `sources` — master sources, deduplicated by id; seeded with the shipped default when absent.
- `favourites`, `manualServers`, `history` — keyed by normalised address; history is capped.
- `scan` — concurrency, timeout, retries, min spacing, auto-scan-on-open, auto-refresh; each knob
  falls back to its own default.
- `listSort` — the chosen sort, `null` for the default order.
- `watchlist` — entries keyed by id.
- `quickFilters` — named filters, unique by lower-cased name, capped. Criteria include the ping limit; entries saved before it load as Any.

## Handlers

`SERVERS_HANDLERS`:

- `overviewRead` — scanning flag, known server count, last scan time.
- `sourcesList` — the master sources in order.
- `sourcesAdd` — adds a source; refuses an invalid or duplicate address.
- `sourcesRemove` — removes a source by id.
- `sourcesUpdate` — edits a source's address or enabled flag.
- `sourcesReorder` — applies a full permutation of source ids.
- `favouritesAdd` — adds a favourite.
- `favouritesRemove` — removes a favourite.
- `historyRead` — the connection history, newest first (main alone appends).
- `scanStart` — starts a scan; refused while one runs. Scopes: all, favourites, one server, or `addresses` (the servers the filter shows; an address the launcher does not know is refused, and in LAN mode only known rows are re-queried — no discovery, nothing cleared).
- `scanRead` — snapshot of scan state and every last-known row.
- `scanGetSettings` — the persisted scan settings.
- `scanPatchSettings` — validates and persists a settings patch.
- `scanSetViewActive` — tells main whether the view is visible (gates auto-refresh).
- `listGetSort` — the persisted sort or `null`.
- `listSetSort` — persists a sort, or clears it with `null`.
- `detailRead` — one server's row plus its last `serverinfo`.
- `scanSetMode` — switches online and LAN lists (in memory, default online).
- `quickFiltersList` — the saved quick filters.
- `quickFiltersSave` — saves a filter; returns the list or a refusal key.
- `quickFiltersRename` — renames a filter; returns the list or a refusal key.
- `quickFiltersRemove` — removes a filter (idempotent).

`SERVERS_WATCHLIST_HANDLERS`:

- `read` — entries with their computed statuses.
- `add` — adds an entry (exact, substring or regex).
- `update` — edits an entry's name and mode.
- `remove` — removes an entry.
- `recheck` — re-evaluates the entries against the known rows.

Events: `SERVERS_EVENTS` pushes `scanChanged`, `scanServer` (one row per result) and
`watchlistChanged`.

## External inputs

- Network: UDP `query` to UDP master sources (reply collected until a quiet period); HTTP GET of
  q2servers-style lists (`?raw=1`/`?raw=2`) with a time and size cap; UDP `info`/`status` queries
  to each game server; UDP broadcast on every usable IPv4 interface (port 27910) in LAN mode.
- Files: state.json (the `servers` slot) only.
- Engine processes: none read; joining hands `+connect <address>` to the game launch, with the
  address re-validated in main.

## Limitations

- LAN discovery is IPv4 broadcast only; a machine without a usable interface reports a typed
  error instead of an empty list.
- One scan at a time; a start during a scan is refused, not queued.
- No server data is persisted beyond the address collections — rows are rebuilt by scanning.
- History is append-only from main and capped; there is no import or export of the lists.
