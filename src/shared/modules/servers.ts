import { z } from 'zod'
import { serverAddressSchema } from '../schemas'
import type { InfoReplySuccess } from '../servers/info-reply'
import { SERVER_SORT_COLUMNS } from '../servers/list-sort'
import type { ServerListSort, ServerSortColumn } from '../servers/list-sort'
import type { MasterSourceAddressRejection } from '../servers/master-source-address'
import type { ServerGamemode } from '../servers/row-markers'
import type { ServerPlayer, StatusReplySuccess } from '../servers/status-reply'

export type { ServerGamemode } from '../servers/row-markers'

/**
 * Story 119 D2: re-exported from `../servers/list-sort` (already implemented in D1) rather than
 * redefined here - this file is the shared contract's home, but the sort engine itself is pure
 * and colocated with `row-markers.ts`, so the types/constant travel through this module the same
 * way `ServerGamemode` right above does.
 */
export type {
  ServerListSort,
  ServerSortColumn,
  ServerSortDirection,
} from '../servers/list-sort'
export { SERVER_SORT_COLUMNS } from '../servers/list-sort'

/**
 * The servers module's contract.
 *
 * Each module owns one file under `src/shared/modules/` describing the data it
 * exchanges with the UI. Main implements the handlers, the renderer gets a typed
 * client, and neither side imports the other's code - this file is the only
 * thing they share. Same pattern as `home.ts`/`library.ts`/`downloads.ts`.
 *
 * Story 106 D1 adds only the shared contract: the shape of the servers
 * overview and the handler/schema map. The handler itself, the scanning
 * logic and the renderer view are later deliverables of this story.
 */
export const SERVERS_HANDLERS = {
  /** Resolves to the current `ServersOverview` - cache-first, no network of its own. */
  overviewRead: 'overview.read',
  /** Story 111 D1: master-source-list handlers. Handler logic (main) is D3, not this D - here they
   * only need names, payload schemas and a result union. */
  /** Resolves to the current master source list, in persisted order. */
  sourcesList: 'sources.list',
  /** Adds a new source; refuses on an invalid/duplicate address (`MasterSourcesResult`). */
  sourcesAdd: 'sources.add',
  /** Removes a source by id; refuses when the id is unknown. */
  sourcesRemove: 'sources.remove',
  /** Edits an existing source's address (re-validated) or toggles its `enabled` flag. */
  sourcesUpdate: 'sources.update',
  /** Applies a full permutation of source ids; refuses when the id set doesn't match exactly. */
  sourcesReorder: 'sources.reorder',
  /** Story 112 D1: favourites.* handler ids. Handler logic (main) is a later D - here they only
   * need names and payload schemas. */
  /** Resolves to the current favourites list, in persisted order. */
  favouritesList: 'favourites.list',
  /** Adds an address to the favourites list. */
  favouritesAdd: 'favourites.add',
  /** Removes an address from the favourites list. */
  favouritesRemove: 'favourites.remove',
  /** Story 113 D1: manual.* and history.* handler ids. Handler logic (main) is a later D - here
   * they only need names and payload schemas, same as story 112 D1's favourites.* entries above. */
  /** Resolves to the current manually-added servers list. */
  manualList: 'manual.list',
  /** Adds a raw, unvalidated candidate address; refuses (never throws) on a malformed one via
   * `ManualServerAddResult`. */
  manualAdd: 'manual.add',
  /** Removes a manually-added server by address; idempotent - an address that was never stored
   * still succeeds as a no-op. */
  manualRemove: 'manual.remove',
  /** Resolves to the connection history, most-recent-first. Read-only over IPC - there is no
   * `history.record` channel; only main itself ever appends to history (a later story). */
  historyRead: 'history.read',
  /** Story 114 D1: `scan.*` handler ids. Handler logic (`ScanService`, the two-stage runner) is a
   * later D - here they only need names and payload schemas, same as story 111/112/113 D1's
   * entries above. */
  /** Starts a two-stage scan across the current address set (D-L: refused as a value while one is
   * already running, never queued). */
  scanStart: 'scan.start',
  /** Resolves to a `ScanSnapshot` of the scan's current state and every last-known row (D-D) - a
   * single catch-up read for a renderer that mounts mid-scan, never polled (AC5). */
  scanRead: 'scan.read',
  /** Story 115 D1: `scan.*` settings handler ids. Handler logic (main) is a later D - here they
   * only need names and payload schemas, same as story 114 D1's `scanStart`/`scanRead` above. */
  /** Resolves to the full, persisted `ServersScanSettings`. */
  scanGetSettings: 'scan.getSettings',
  /** Validates and persists a partial `ServersScanSettings` patch; resolves to the full
   * merged+persisted settings (mirrors `DOWNLOADS_HANDLERS.patchSettings`). */
  scanPatchSettings: 'scan.patchSettings',
  /** Reports whether the Servers view is currently mounted/visible - main's own signal for when
   * auto-refresh/auto-scan-on-open are allowed to act. No meaningful return value. */
  scanSetViewActive: 'scan.setViewActive',
  /** Story 119 D2: the persisted list-sort handlers. `listGetSort` resolves to the current
   * `ServerListSort | null` (`null` meaning the default order); `listSetSort` validates and
   * persists a new one (or clears it with `null`), resolving to what was actually persisted. */
  listGetSort: 'list.getSort',
  listSetSort: 'list.setSort',
  /** Story 122 D2: resolves to a single server's `ServerDetail` - the row plus its last-known
   * `serverinfo`, or `null` for an address the scan has no row for at all. */
  detailRead: 'detail.read',
} as const

/**
 * Main-to-renderer push under the `servers` module's namespace (story 114 D-C): `scan.changed`
 * carries the scan's own progress/state, `scan.server` carries one resolved row - one event per
 * result, never batched. Mirrors `HOME_EVENTS` in `src/shared/modules/home.ts`.
 */
export const SERVERS_EVENTS = {
  scanChanged: 'scan.changed',
  scanServer: 'scan.server',
  /** Story 131 D1: pushed whenever the watchlist's persisted entries or their computed statuses
   * change - main-to-renderer, no payload of its own (the renderer re-reads via `watchlist.read`,
   * same "event just says 'something changed', read carries the value" convention as
   * `HOME_EVENTS`/`scanChanged`). */
  watchlistChanged: 'watchlist.changed',
} as const

/**
 * `overview.read` takes no payload - same `z.void()` convention as
 * `newsNoInputSchema` in `home.ts`.
 */
export const serversNoInputSchema = z.void()

/**
 * What `overview.read` resolves to: whether a scan is currently in progress, how
 * many servers are known so far, and when the last scan completed (or `null` if
 * none has ever run).
 */
export interface ServersOverview {
  scanning: boolean
  knownServerCount: number
  lastScanAt: string | null
}

export const serversOverviewSchema = z.object({
  scanning: z.boolean(),
  knownServerCount: z.number(),
  lastScanAt: z.string().nullable(),
})

/**
 * Story 110 D1: the persisted shape of the `servers` module's own top-level `state.json` key -
 * global to the launcher, never per-installation (AC6). Mirrors `home.ts`'s `HomeLayout`/
 * `DEFAULT_HOME_LAYOUT` pattern: a plain interface, a `.strict()`-free `z.object()` schema (same
 * looseness as `serversOverviewSchema` above), and a default constant. Only the shape lands here -
 * no parse function (`main/lib/schemas.ts`) and no `StateStore` wiring; those are D2/D3.
 */

/** One master/list source the scanner pulls candidate servers from. */
export interface ServerSourceEntry {
  id: string
  type: 'udp-master' | 'http-list'
  address: string
  enabled: boolean
}

export const serverSourceEntrySchema = z.object({
  id: z.string(),
  type: z.enum(['udp-master', 'http-list']),
  address: z.string(),
  enabled: z.boolean(),
})

/**
 * Story 111 D1: the source list is a thing the user edits (adds, removes, reorders, toggles), not
 * just a scanner input - so it gets its own vocabulary (`MasterSource`) even though the shape is
 * currently identical to `ServerSourceEntry` above (story 110's persisted-state element). Rather
 * than duplicate the fields, `MasterSource`/`masterSourceSchema` are aliases of
 * `ServerSourceEntry`/`serverSourceEntrySchema`: one shape, two names for two call sites (the
 * `sources` array in `ServersState` vs. the `sources.*` handler payloads/results below). If the two
 * ever need to diverge, split them then.
 */
export type MasterSourceType = ServerSourceEntry['type']
export type MasterSource = ServerSourceEntry
export const masterSourceSchema = serverSourceEntrySchema

/**
 * The one master/list source every fresh install ships with (story 111's concept, revised).
 * Originally three sources (two `udp-master` entries alongside this `http-list` one), but the two
 * UDP masters (`master.q2servers.com:27900`, `master.quakeservers.net:27900`) turned out to be
 * unreachable in practice: many networks only allow outbound UDP on well-known ports (53/443/etc),
 * silently dropping the `query` datagram on port 27900 (or its reply) while leaving generic UDP and
 * plain HTTP unaffected - confirmed by direct UDP probes against both masters (5 min, no reply)
 * alongside a working `curl` against the HTTP list on the same host. `udp-master` stays a supported
 * source type a user can add by hand; it is just no longer a shipped default. Fixed, documented
 * ids - never random uuids - so a state file, a bug report or this file's own diff can name one of
 * them stably across releases. `http-list` is stored as the absolute URL string, query string
 * included.
 */
export const DEFAULT_MASTER_SOURCES: MasterSource[] = [
  {
    id: 'default-q2servers-http',
    type: 'http-list',
    address: 'https://q2servers.com/?raw=1',
    enabled: true,
  },
]

/** A server the user has marked as a favourite. `addedAt` is an ISO timestamp string. */
export interface FavouriteServerEntry {
  address: string
  addedAt: string
}

export const favouriteServerEntrySchema = z.object({
  address: z.string(),
  addedAt: z.string(),
})

/**
 * A server the user added by hand rather than discovered through a source. `origin` is always
 * `'manual'` here - a fixed literal, not a real choice - so the row stays self-describing (story
 * 113 D-A: "stored in a way that distinguishes it from a master-discovered one") if a later story
 * ever merges manual/favourite/scanned rows into one list; it is not persisted for any other
 * purpose than that tag.
 */
export interface ManualServerEntry {
  address: string
  origin: 'manual'
  addedAt: string
}

export const manualServerEntrySchema = z.object({
  address: z.string(),
  origin: z.literal('manual'),
  addedAt: z.string(),
})

/** One entry in the connection history - the servers the user has actually connected to.
 * `connectedAt` is an ISO timestamp string (story 113 D-D's shape, verbatim field name). */
export interface ServerHistoryEntry {
  address: string
  connectedAt: string
}

export const serverHistoryEntrySchema = z.object({
  address: z.string(),
  connectedAt: z.string(),
})

/**
 * The cap on how many rows the connection history keeps (story 113). Enforced wherever history is
 * appended (main, a later D) - the oldest entries fall off once this is exceeded, never the newest.
 */
export const SERVER_HISTORY_CAP = 200

/**
 * `manual.add`'s result (story 113 D1): a refusal is a returned result, never a thrown IPC error
 * (CLAUDE.md: main sends i18n keys, never prose, across IPC). `reasonKey` is whatever
 * `serverAddressRejectionKey()` (`src/shared/servers/address.ts`) produced for the
 * `ServerAddressRejection` the handler's call to `parseServerAddress` returned - already a
 * `servers.address.reject.<reason>` i18n key, not a raw reason code, so the renderer never needs to
 * re-derive it. Per D-K, `manual.list`/`manual.add`/`history.read` resolve to the same
 * `ManualServerEntry`/`ServerHistoryEntry` rows the module already persists (story 110) - there is
 * no separate IPC-only shape.
 */
export type ManualServerAddResult =
  | { ok: true; entry: ManualServerEntry }
  | { ok: false; reasonKey: string }

/**
 * Story 115 D1: bounded-choice constants for every numeric scan-settings knob (GB-N4), mirroring
 * `MIN_CONCURRENT_DOWNLOAD_JOBS`/`MAX_CONCURRENT_DOWNLOAD_JOBS`/`ARCHIVE_CACHE_BUDGET_CHOICES_GB`
 * (`downloads.ts`): a `MIN_*`/`MAX_*` bound pair for schema validation plus a `SCAN_*_CHOICES` array
 * of the exact values the Settings UI's `<Select>`s offer - closed lists, not free-text ranges. D6
 * (this story's measurement deliverable) sets the actual shipped default from a real measurement and
 * may widen a choice list if the measured number is not already a member of it; these are the
 * starting choice lists, not the final ones.
 */

/** How many in-flight queries one scan stage runs at once. */
export const MIN_SCAN_CONCURRENCY = 1
export const MAX_SCAN_CONCURRENCY = 32
export const SCAN_CONCURRENCY_CHOICES = [4, 8, 16, 24, 32] as const

/** How long a single query waits for a reply before it counts as `no-reply`. */
export const MIN_SCAN_TIMEOUT_MS = 250
export const MAX_SCAN_TIMEOUT_MS = 5000
export const SCAN_TIMEOUT_CHOICES_MS = [500, 1000, 1500, 2000, 3000, 5000] as const

/** How many times a query that got no reply is retried before it counts as failed. */
export const MIN_SCAN_RETRIES = 0
export const MAX_SCAN_RETRIES = 3
export const SCAN_RETRIES_CHOICES = [0, 1, 2, 3] as const

/** The minimum spacing between two *automatic* scans (GB-N4/this story's Decisions) - not a
 * per-query throttle. 0/15s/30s/60s/5min. */
export const MIN_SCAN_MIN_SPACING_MS = 0
export const MAX_SCAN_MIN_SPACING_MS = 600_000
export const SCAN_MIN_SPACING_CHOICES_MS = [0, 15_000, 30_000, 60_000, 300_000] as const

/** How often auto-refresh re-scans while `autoRefreshEnabled` is on. */
export const MIN_SCAN_AUTO_REFRESH_INTERVAL_MS = 15_000
export const MAX_SCAN_AUTO_REFRESH_INTERVAL_MS = 600_000
export const SCAN_AUTO_REFRESH_INTERVAL_CHOICES_MS = [
  15_000, 30_000, 60_000, 120_000, 300_000,
] as const

/**
 * The scanner's budget knobs (GB-N4), turned into real user-facing settings by story 115. The
 * original four (`concurrency`/`timeoutMs`/`retries`/`minSpacingMs`) keep their shape; D1 adds three
 * more:
 * - `autoScanOnOpen`: whether opening the Servers view kicks off a scan automatically.
 * - `autoRefreshEnabled`: whether the view keeps re-scanning on its own once open.
 * - `autoRefreshIntervalMs`: how often it does so while `autoRefreshEnabled` is on.
 */
export interface ServersScanSettings {
  concurrency: number
  timeoutMs: number
  retries: number
  minSpacingMs: number
  autoScanOnOpen: boolean
  autoRefreshEnabled: boolean
  autoRefreshIntervalMs: number
}

export const serversScanSettingsSchema = z.object({
  concurrency: z.number(),
  timeoutMs: z.number(),
  retries: z.number(),
  minSpacingMs: z.number(),
  autoScanOnOpen: z.boolean(),
  autoRefreshEnabled: z.boolean(),
  autoRefreshIntervalMs: z.number(),
})

/**
 * The envelope persisted at the `servers` module's own top-level `state.json` key. Global to the
 * launcher (AC6) - none of its fields, at any level, carry an `installationId`; unlike
 * `configPlayedMods`/`configSwitchBinds` this is deliberately not scoped per installation.
 */
/**
 * Story 131 D1: the watchlist's own vocabulary - a user names a player to keep an eye on, and the
 * launcher looks for that name across the servers it already knows about. This deliverable is the
 * contract/types/schema/persistence only: no matcher, no worker, no service, no wiring - those are
 * D2-D5.
 */

/** How a watchlist entry's `name` is matched against a roster's player names. `'exact'` requires a
 * full match, `'substring'` a case-insensitive containment, `'regex'` a user-supplied pattern run
 * under `WATCHLIST_REGEX_BUDGET_MS`'s time budget (enforced by a later deliverable, not here). */
export type WatchlistMatchMode = 'exact' | 'substring' | 'regex'

/** One entry the user is watching for. `tooSlow` (set by a later deliverable once a regex entry is
 * measured against `WATCHLIST_REGEX_BUDGET_MS`) marks an entry the matcher has given up running -
 * see the `'too-slow'` `WatchlistEntryStatus` variant below. */
export interface WatchlistEntry {
  id: string
  name: string
  mode: WatchlistMatchMode
  tooSlow: boolean
}

export const watchlistEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(['exact', 'substring', 'regex']),
  tooSlow: z.boolean(),
})

/** How long a watchlist entry's name may be (D-L, a later deliverable's UI validation reads this
 * same constant). */
export const WATCHLIST_NAME_MAX = 64

/** The time budget a single regex entry gets against a roster before it is flagged `tooSlow` (a
 * later deliverable's matcher enforces this; this D only names the constant). */
export const WATCHLIST_REGEX_BUDGET_MS = 100

/** One roster hit for a watched name - `serverName` is optional because a row that has never
 * received an `info`/`status` reply for its address has no name to show yet. `seenAt` is the
 * roster's own time (the scan round that produced this hit), not wall-clock "now". */
export interface WatchlistMatch {
  address: string
  serverName?: string
  playerName: string
  score: number
  ping: number
  seenAt: string
}

/** A field every `WatchlistEntryStatus` variant carries: whether a fresh look at this entry is
 * queued (`'pending'`), came back with nothing usable (`'no-reply'`), or nothing of the sort is in
 * flight (`null`). */
interface WatchlistEntryStatusBase {
  recheck: 'pending' | 'no-reply' | null
}

/**
 * One entry's current computed status (a later deliverable's matcher/service produces this; this D
 * only shapes it). `'left'` means the watched name was seen at `address` as of a *previous* stage-2
 * pass but is no longer there as of the latest one - `reasonKey` points at the fixed explanation
 * that state carries (a full rescan, not this status, is what would tell the user where the name
 * went instead).
 */
export type WatchlistEntryStatus = WatchlistEntryStatusBase &
  (
    | { entry: WatchlistEntry; state: 'offline' }
    | { entry: WatchlistEntry; state: 'found'; matches: WatchlistMatch[] }
    | {
        entry: WatchlistEntry
        state: 'left'
        address: string
        checkedAt: string
        reasonKey: 'servers.watchlist.left.needsFullScan'
      }
    | { entry: WatchlistEntry; state: 'too-slow' }
  )

/** The watchlist's own computed snapshot - `asOf` is the last stage-2 row the computation had
 * processed, `null` before any stage-2 row has ever landed. */
export interface WatchlistSnapshot {
  asOf: string | null
  entries: WatchlistEntryStatus[]
}

/**
 * Story 131 D1: `watchlist.*` handler ids, kept in a map separate from `SERVERS_HANDLERS` on
 * purpose - a later completeness gate that asserts "every handler is registered in
 * `SERVERS_HANDLERS`" must not have to know about this module yet (the handlers themselves are a
 * later deliverable), so this map is deliberately excluded from that check.
 */
export const SERVERS_WATCHLIST_HANDLERS = {
  read: 'watchlist.read',
  add: 'watchlist.add',
  update: 'watchlist.update',
  remove: 'watchlist.remove',
  recheck: 'watchlist.recheck',
} as const

export const watchlistAddInputSchema = z
  .object({
    name: z.string(),
    mode: z.enum(['exact', 'substring', 'regex']),
  })
  .strict()

export const watchlistUpdateInputSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    mode: z.enum(['exact', 'substring', 'regex']),
  })
  .strict()

export const watchlistRemoveInputSchema = z.object({ id: z.string() }).strict()

export const watchlistRecheckInputSchema = z.object({ id: z.string() }).strict()

export const watchlistReadInputSchema = z.void()

export const SERVERS_WATCHLIST_HANDLER_SCHEMAS: Record<
  (typeof SERVERS_WATCHLIST_HANDLERS)[keyof typeof SERVERS_WATCHLIST_HANDLERS],
  z.ZodTypeAny
> = {
  [SERVERS_WATCHLIST_HANDLERS.read]: watchlistReadInputSchema,
  [SERVERS_WATCHLIST_HANDLERS.add]: watchlistAddInputSchema,
  [SERVERS_WATCHLIST_HANDLERS.update]: watchlistUpdateInputSchema,
  [SERVERS_WATCHLIST_HANDLERS.remove]: watchlistRemoveInputSchema,
  [SERVERS_WATCHLIST_HANDLERS.recheck]: watchlistRecheckInputSchema,
}

export interface ServersState {
  sources: ServerSourceEntry[]
  favourites: FavouriteServerEntry[]
  manualServers: ManualServerEntry[]
  history: ServerHistoryEntry[]
  scan: ServersScanSettings
  /** user-chosen list sort, story 119 */
  listSort?: ServerListSort
  /** Story 131 D1: the watchlist's persisted entries - see `WatchlistEntry` below. */
  watchlist: WatchlistEntry[]
}

export const serversStateSchema = z.object({
  sources: z.array(serverSourceEntrySchema),
  favourites: z.array(favouriteServerEntrySchema),
  manualServers: z.array(manualServerEntrySchema),
  history: z.array(serverHistoryEntrySchema),
  scan: serversScanSettingsSchema,
  watchlist: z.array(watchlistEntrySchema),
})

/**
 * The out-of-the-box state (story 110 D1, updated story 111 D2). `favourites`/`manualServers`/
 * `history` stay empty - nothing to seed there - but `sources` now ships pre-populated with
 * `DEFAULT_MASTER_SOURCES`, the one shipped master/list source, so a fresh install (or a state
 * file missing this key) has a working source list from the very first read, not an empty one the
 * user has to build by hand.
 */
export const DEFAULT_SERVERS_STATE: ServersState = {
  sources: DEFAULT_MASTER_SOURCES,
  favourites: [],
  manualServers: [],
  history: [],
  scan: {
    // Measured, not invented (story 115 D6): the budget is the N=300 row concurrency 24 /
    // timeoutMs 1000 / retries 1 of `npm run measure:scan` (median full pass ~7.5 s over the
    // modelled loopback population); the cadence values are reasoned from that pass time. Method,
    // numbers and limits: docs/requirements/115-how-hard-the-scan-works-is-a-setting.md,
    // `## Measurement (AC2)`.
    concurrency: 24,
    timeoutMs: 1000,
    retries: 1,
    minSpacingMs: 30_000,
    autoScanOnOpen: true,
    autoRefreshEnabled: false,
    autoRefreshIntervalMs: 60_000,
  },
  watchlist: [],
}

/**
 * Every `servers` handler paired with its payload schema - proves AC9's "every new channel exists
 * in the shared contract with a zod payload schema before its handler" for this module's own
 * handlers, and is what `servers.test.ts` iterates to check no handler is missing one.
 */
/**
 * Story 111 D1: payload schemas for the five `sources.*` handlers.
 *
 * `sourcesUpdate`'s payload is a union of two shapes: re-validating an edited address (`type` +
 * `address`) and toggling `enabled` are different operations with different failure modes (a bad
 * address is a `MasterSourceAddressRejection`; a toggle can't fail on the address at all) sharing
 * one channel rather than two, since both only ever act on a single existing source by `id`. A
 * handler-side check (D3) rejects a payload that supplies neither pair.
 */
export const masterSourceTypeSchema = z.enum(['udp-master', 'http-list'])

export const sourcesListInputSchema = z.void()

export const sourcesAddInputSchema = z.object({
  type: masterSourceTypeSchema,
  address: z.string(),
})

export const sourcesRemoveInputSchema = z.object({
  id: z.string(),
})

export const sourcesUpdateAddressInputSchema = z.object({
  id: z.string(),
  type: masterSourceTypeSchema,
  address: z.string(),
})

export const sourcesUpdateEnabledInputSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
})

/** Either re-validate an edited address or toggle `enabled` - never both in one call. */
export const sourcesUpdateInputSchema = z.union([
  sourcesUpdateAddressInputSchema,
  sourcesUpdateEnabledInputSchema,
])

/** A full permutation of the current source ids - not a partial move (story 111's Decisions). */
export const sourcesReorderInputSchema = z.object({
  ids: z.array(z.string()),
})

/**
 * What every `sources.*` mutation resolves to: the domain refusal is a returned result, not a
 * thrown error (mirrors `MasterSourceFailure`-shaped results in `src/main/modules/servers/` and
 * `AliasNameRejectReason` in `src/shared/config/alias-names.ts`). `sources.list` itself always
 * succeeds (it's a read), so it resolves to `MasterSource[]` directly, not this union - see the
 * handler's own payload schema/JSDoc, not this type.
 */
export type MasterSourcesRejectionReason =
  | MasterSourceAddressRejection
  | 'not-found'
  | 'duplicate-address'
  | 'invalid-reorder'

export type MasterSourcesResult =
  | { ok: true; sources: MasterSource[] }
  | { ok: false; reason: MasterSourcesRejectionReason }

/**
 * Story 112 D1: payload schemas for the three `favourites.*` handlers. `favouritesList` takes no
 * payload, same `z.void()` convention as `serversNoInputSchema` above (kept as its own alias so
 * each handler's schema reads self-documenting at the call site). `favouritesAdd`/`favouritesRemove`
 * take just the address - no wrapper object - validated with the shared `serverAddressSchema`
 * (`src/shared/schemas.ts`), which normalizes a `host:port` via `parseServerAddress` and rejects a
 * malformed one. The result shape (what these resolve to) is `FavouriteServerEntry`/
 * `FavouriteServerEntry[]` above - handler logic and any result union are a later deliverable, not
 * this one.
 */
export const favouritesListInputSchema = serversNoInputSchema

export const favouritesAddInputSchema = serverAddressSchema

export const favouritesRemoveInputSchema = serverAddressSchema

/**
 * Story 113 D1: payload schemas for the four `manual.*`/`history.*` handlers. `manualList`/
 * `historyRead` take no payload, same `z.void()` convention as `favouritesListInputSchema` above.
 * `manualAdd`'s payload is deliberately *not* `serverAddressSchema` (unlike `favouritesAdd`): it is
 * raw, unvalidated user input wrapped in `{ address }`, whose malformed case is a returned
 * `ManualServerAddResult` refusal (D-checked by the handler, a later D), not a schema-parse failure
 * at this boundary. `manualRemove` takes the same loose `{ address }` shape for the same reason as
 * `removeFavourite` (`src/main/modules/servers/favourites.ts`) is unconditionally idempotent: even a
 * currently-unparseable address must still be removable as a no-op, so this boundary cannot reject
 * it either.
 */
export const manualListInputSchema = serversNoInputSchema

export const manualAddInputSchema = z.object({
  address: z.string(),
})

export const manualRemoveInputSchema = z.object({
  address: z.string(),
})

export const historyReadInputSchema = serversNoInputSchema

/**
 * Story 114 D1: the scan's shared contract - types, event names, handler names and schemas, all
 * that this deliverable adds (Plan, step 1). The runner, the service and the renderer view are
 * later deliverables of the same story; nothing here has an implementation yet.
 */

/** Where one `ScanTarget` address was seen: an enabled master/list source (111), a favourite
 * (112) or a manually-added server (113). A target can carry more than one - see `ScanTarget`. */
export type ScanOrigin = 'source' | 'favourite' | 'manual'

/** One address the scan will sweep, plus every origin it was seen under (AC6: a duplicate
 * address from two origins collapses to one target that still carries both; AC4: a favourite is
 * always present even when no source returns it). */
export interface ScanTarget {
  address: string
  origins: ScanOrigin[]
}

/**
 * Review fix (story 114, clean-agent pass): one query's outcome, exactly as
 * `src/main/modules/servers/server-query.ts`'s `queryServer()` resolves and as
 * `src/main/modules/servers/scan-runner.ts` streams it through `onServer`/`scan.server`. Defined
 * here - not in `server-query.ts` - so the renderer client (`modules/servers/client.ts`) can import
 * the real type for the `scan.server` push instead of hand-declaring a structurally-identical copy
 * that nothing keeps in sync if either side changes. `server-query.ts` re-exports its own
 * `ServerQueryResult` name as an alias of this type, so no main-side import site needed to change.
 */
export type ScanQueryResult =
  | { ok: true; kind: 'info'; reply: InfoReplySuccess; rttMs: number }
  | { ok: true; kind: 'status'; reply: StatusReplySuccess; rttMs: number }
  | { ok: false; reason: 'no-reply' | 'transport-error' | 'malformed' }

/** One row as delivered through the `scan.server` push (D-C) - `scan-runner.ts`'s `ScanServerResult`
 * is an alias of this same shape, for the reason above. */
export interface ScanServerPush {
  stage: 'stage1' | 'stage2'
  target: ScanTarget
  result: ScanQueryResult
}

/**
 * One row of the servers list, as the scan and the renderer store hold it. `status: 'stale'`
 * marks a server that did not answer this scan - it keeps whatever it last reported rather than
 * being reported as empty or dropped (D-K, GB-N6). Every domain field below `status` is optional
 * because a target that has never yet answered (e.g. a favourite no source has ever returned)
 * still needs a row to exist. `players` starts out as the numeric count `info` reports and is
 * replaced by the full roster once stage 2's `status` reply for this address lands - the same
 * field, not two, so a consumer never has to reconcile a count against a list for one address.
 */
export interface ServerListEntry {
  address: string
  origins: ScanOrigin[]
  /** `'pending'` is a row that has never yet received a reply (e.g. a favourite no source has
   * returned) - distinct from `'stale'`, which did answer a past scan but not the current one. */
  status: 'online' | 'stale' | 'pending'
  name?: string
  map?: string
  mod?: string
  maxclients?: number
  needpass?: boolean
  /** `needpass` bit 1: the server requires a spectator password. */
  spectatorPass?: boolean
  rttMs?: number
  /** In-memory session history of this address's measured round trips, oldest first, newest
   * appended last - never persisted to `state.json`, rebuilt from nothing every process lifetime
   * exactly like `entries` itself. Capped at `RTT_HISTORY_LIMIT` entries. */
  rttHistory?: RttSample[]
  players?: number | ServerPlayer[]
  gamemode?: ServerGamemode
  /** ISO timestamp of the last reply (of either stage) actually received for this address, or
   * `null` for a row that has never received one. */
  lastSeenAt: string | null
}

/** One round's measured round trip for a `ServerListEntry`'s `rttHistory` - `rttMs: null` means the
 * address did not answer that round (a stale flip), not that it answered in zero time. */
export interface RttSample {
  at: string
  rttMs: number | null
}

/** How many of a server's most recent `RttSample`s `appendRttSample` (`scan-merge.ts`) keeps -
 * older samples are dropped, oldest first. */
export const RTT_HISTORY_LIMIT = 20

/** One row of the servers list as the renderer's list/table shows it: every `ServerListEntry`
 * field plus whether the user has favourited this address. */
export type ServerListRow = ServerListEntry & { favourite: boolean }

/**
 * One source's scan-time failure (D-H): `reasonKey` is `masterSourceFailureKey()`
 * (`src/shared/servers/master-records.ts`) applied to whatever `resolveUdpMasterSource`/
 * `resolveHttpListSource` returned for that source - already a `servers.source.error.<reason>`
 * i18n key, not a raw reason code, same convention as `ManualServerAddResult.reasonKey` above
 * (CLAUDE.md: main sends i18n keys across IPC, never prose).
 */
export interface ScanSourceFailure {
  sourceId: string
  reasonKey: string
}

/** The two stages a scan sweeps through, in order. `'idle'` is both "never run" and "finished". */
export type ScanPhase = 'idle' | 'stage1' | 'stage2'

/**
 * Story 116 D1: why a scan is currently refused/held back from starting - a closed union so a
 * later reason (if any) is a compile-time-visible addition, unlike `ScanStartResult`'s/
 * `ManualServerAddResult`'s free-text `reasonKey`. Currently only one member: the game is running
 * (docs/requirements/116-no-scan-runs-while-the-game-does.md).
 */
export type ScanBlockedReason = 'game-running'

/**
 * The scan's own live state (D-C's `scan.changed` payload). `stage1Total`/`stage2Total` are the
 * size of that stage's address set at the moment the stage started - `stage2Total` is `0` until
 * stage 1 has finished and the non-empty-plus-selected set is known. `startedAt`/`finishedAt` are
 * ISO timestamps, `null` before the first scan has ever run (`finishedAt` also `null` while
 * `running` is true). `blockedReason` (story 116 D1) is `null` unless a scan is currently being
 * held back by something outside the scan itself (e.g. the game running) - `null` rather than
 * optional, same style as `startedAt`/`finishedAt` above. `scope` (story 117 D1) is `null` unless a
 * scan is currently running or has last run with a known scope - same "null unless something has
 * actually set it yet" convention as `blockedReason`. This D only adds the field to the type; a
 * later deliverable (D3, the 116->117 evolution of the scan state) is what actually populates and
 * resets it.
 */
export interface ServersScanState {
  running: boolean
  phase: ScanPhase
  stage1Done: number
  stage1Total: number
  stage2Done: number
  stage2Total: number
  sourceFailures: ScanSourceFailure[]
  startedAt: string | null
  finishedAt: string | null
  blockedReason: ScanBlockedReason | null
  scope: ScanScope | null
}

/**
 * `scan.start`'s result (D-L): starting is a returned refusal when a scan is already running, not
 * a thrown IPC error - same shape convention as `ManualServerAddResult`/`MasterSourcesResult`
 * above. A successful start carries no data of its own - the caller learns everything through the
 * `scan.changed`/`scan.server` pushes (AC5), not through this return value.
 */
export type ScanStartResult = { ok: true } | { ok: false; reasonKey: string }

/**
 * Story 116 D1: the `reasonKey` a refused `scan.start` (or a `blockedReason: 'game-running'`
 * scan state) carries when the game is running - a distinct i18n convention from
 * `SCAN_ALREADY_RUNNING_REASON_KEY` (`servers.scan.error.<reason>`, `scan-service.ts`) because
 * this is a *blocked* state rather than an *error*, mirroring `WAITING_REASON_GAME_RUNNING`
 * (`jobs.waiting.gameRunning`, `src/main/services/write-guard.ts`). Lives here rather than in
 * `scan-service.ts` because both a later main-side deliverable and a renderer i18n-key check need
 * it.
 */
export const SCAN_BLOCKED_GAME_RUNNING_REASON_KEY = 'servers.scan.blocked.gameRunning'

/**
 * `scan.read`'s result (D-D): a one-shot catch-up snapshot for a renderer that mounts mid-scan -
 * the scan's current state plus every row known so far (both online and stale, D-K), never a
 * polled value.
 */
export interface ScanSnapshot {
  state: ServersScanState
  entries: ServerListRow[]
}

/**
 * Story 117 D1: which subset of servers a scan round touches. 'all' is exactly today's full scan
 * (114's union address set); 'favourites' touches only the favourites list; 'server' touches
 * exactly one address (allowed even when it is in no source/favourite/manual list). This is the
 * shared contract only - the scheduler/handler that actually branches on it (D2-D4) and the
 * renderer surfaces that pick it (D5-D6) are later deliverables of this story.
 */
export type ScanScope =
  | { kind: 'all' }
  | { kind: 'favourites' }
  | { kind: 'server'; address: string }

export const scanScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('favourites') }),
  z.object({ kind: z.literal('server'), address: serverAddressSchema }),
])

/**
 * `scan.start`'s payload (D-G): `selectedAddress` is optional and, when present, re-validated with
 * the same `serverAddressSchema` `favouritesAdd`/`favouritesRemove` already use above - it names
 * stage 2's "currently selected server" (AC2), which has no selection surface yet ([[118]]/[[122]]).
 * Accepts a call with no payload at all (`undefined`), same as every other optional-field handler
 * payload in this file that is still allowed to be omitted entirely.
 *
 * Story 117 D1 adds `scope` as a sibling field, also optional: a call that omits it (or the whole
 * payload) still validates, same convention as `selectedAddress`. A later deliverable (D4, not this
 * one) is responsible for defaulting a missing/omitted scope to `{ kind: 'all' }` - this schema only
 * has to accept the omission, not resolve it.
 */
export const scanStartInputSchema = z
  .object({
    selectedAddress: serverAddressSchema.optional(),
    scope: scanScopeSchema.optional(),
  })
  .optional()

/** `scan.read` takes no payload - same `z.void()` convention as `historyReadInputSchema` above. */
export const scanReadInputSchema = serversNoInputSchema

/**
 * Story 115 D1: payload schemas for the three `scan.*` settings handlers. `scanGetSettings` takes
 * no payload, same `z.void()` convention as `scanReadInputSchema` above.
 */
export const scanGetSettingsInputSchema = serversNoInputSchema

/**
 * `scan.patchSettings`'s payload - a partial `ServersScanSettings`, mirroring
 * `patchDownloadsSettingsInputSchema` (`main/modules/downloads/schemas.ts`) exactly: each present
 * numeric field is validated against its own `SCAN_*_CHOICES` list above via `.refine()` (not a
 * bare `.min()/.max()` range, which would accept an in-range value with no matching `<Select>`
 * option, or a non-integer like `0.5`), each present boolean field is just `z.boolean()`, every
 * field is individually `.optional()` so a patch can touch any subset (including none at all -
 * `{}` is a valid, no-op patch), and `.strict()` rejects a payload carrying an unknown key outright
 * - the same "a bad payload is a caller bug" convention `patchDownloadsSettingsInputSchema`'s own
 * doc comment states.
 */
export const scanPatchSettingsInputSchema = z
  .object({
    concurrency: z
      .number()
      .refine((value) => (SCAN_CONCURRENCY_CHOICES as readonly number[]).includes(value))
      .optional(),
    timeoutMs: z
      .number()
      .refine((value) => (SCAN_TIMEOUT_CHOICES_MS as readonly number[]).includes(value))
      .optional(),
    retries: z
      .number()
      .refine((value) => (SCAN_RETRIES_CHOICES as readonly number[]).includes(value))
      .optional(),
    minSpacingMs: z
      .number()
      .refine((value) => (SCAN_MIN_SPACING_CHOICES_MS as readonly number[]).includes(value))
      .optional(),
    autoScanOnOpen: z.boolean().optional(),
    autoRefreshEnabled: z.boolean().optional(),
    autoRefreshIntervalMs: z
      .number()
      .refine((value) =>
        (SCAN_AUTO_REFRESH_INTERVAL_CHOICES_MS as readonly number[]).includes(value),
      )
      .optional(),
  })
  .strict()

/** `scan.setViewActive`'s payload - whether the Servers view just mounted (`true`) or unmounted
 * (`false`). */
export const scanSetViewActiveInputSchema = z.object({ active: z.boolean() })

/**
 * Story 119 D2: the persisted/IPC shape of a `ServerListSort` - `.strict()` so a payload carrying
 * an unknown key is rejected outright, same convention as `scanPatchSettingsInputSchema`.
 */
export const serverListSortSchema = z
  .object({
    column: z.enum(SERVER_SORT_COLUMNS as [ServerSortColumn, ...ServerSortColumn[]]),
    direction: z.enum(['asc', 'desc']),
  })
  .strict()

/** `list.getSort` takes no payload - same `z.void()` convention as `scanReadInputSchema` above. */
export const listGetSortInputSchema = serversNoInputSchema

/** `list.setSort`'s payload - a full sort or `null` to clear it back to the default order. */
export const listSetSortInputSchema = z.object({ sort: serverListSortSchema.nullable() }).strict()

/**
 * Story 122 D2: `detail.read`'s payload - just the address, validated the same way
 * `favouritesAddInputSchema` already is (a bare `serverAddressSchema`, no wrapper object).
 */
export const detailReadInputSchema = serverAddressSchema

/**
 * `detail.read`'s result (story 122 D2): the row as `scan.read` already knows it (so a
 * favourite/pending placeholder still resolves rather than failing) plus the last successful
 * `status` reply's full key set. `serverinfo` is replaced whole on each new `status` reply - never
 * merged key-by-key - and is kept exactly as-is while the row goes stale (an unanswered round never
 * clears it); it stays `null` until the very first `status` reply for this address has ever landed.
 * Later stories (players, admin state, ...) extend this type with more fields alongside `row`/
 * `serverinfo`.
 */
export interface ServerDetail {
  row: ServerListRow
  serverinfo: Record<string, string> | null
}

export const SERVERS_HANDLER_SCHEMAS: Record<
  (typeof SERVERS_HANDLERS)[keyof typeof SERVERS_HANDLERS],
  z.ZodTypeAny
> = {
  [SERVERS_HANDLERS.overviewRead]: serversNoInputSchema,
  [SERVERS_HANDLERS.sourcesList]: sourcesListInputSchema,
  [SERVERS_HANDLERS.sourcesAdd]: sourcesAddInputSchema,
  [SERVERS_HANDLERS.sourcesRemove]: sourcesRemoveInputSchema,
  [SERVERS_HANDLERS.sourcesUpdate]: sourcesUpdateInputSchema,
  [SERVERS_HANDLERS.sourcesReorder]: sourcesReorderInputSchema,
  [SERVERS_HANDLERS.favouritesList]: favouritesListInputSchema,
  [SERVERS_HANDLERS.favouritesAdd]: favouritesAddInputSchema,
  [SERVERS_HANDLERS.favouritesRemove]: favouritesRemoveInputSchema,
  [SERVERS_HANDLERS.manualList]: manualListInputSchema,
  [SERVERS_HANDLERS.manualAdd]: manualAddInputSchema,
  [SERVERS_HANDLERS.manualRemove]: manualRemoveInputSchema,
  [SERVERS_HANDLERS.historyRead]: historyReadInputSchema,
  [SERVERS_HANDLERS.scanStart]: scanStartInputSchema,
  [SERVERS_HANDLERS.scanRead]: scanReadInputSchema,
  [SERVERS_HANDLERS.scanGetSettings]: scanGetSettingsInputSchema,
  [SERVERS_HANDLERS.scanPatchSettings]: scanPatchSettingsInputSchema,
  [SERVERS_HANDLERS.scanSetViewActive]: scanSetViewActiveInputSchema,
  [SERVERS_HANDLERS.listGetSort]: listGetSortInputSchema,
  [SERVERS_HANDLERS.listSetSort]: listSetSortInputSchema,
  [SERVERS_HANDLERS.detailRead]: detailReadInputSchema,
}
