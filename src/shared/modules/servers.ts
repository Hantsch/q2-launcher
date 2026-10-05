import { z } from 'zod'
import type { DomainResult } from '../types'
import { serverAddressSchema } from '../schemas'
import type { InfoReplySuccess } from '../servers/info-reply'
import type { MaxPingMs } from '../servers/list-filter'
import { SERVER_SORT_COLUMNS } from '../servers/list-sort'
import type { ServerListSort, ServerSortColumn } from '../servers/list-sort'
import type { MasterSourceAddressRejection } from '../servers/master-source-address'
import { QUICK_FILTER_NAME_MAX, hasCriteria } from '../servers/quick-filters'
import type { QuickFilter } from '../servers/quick-filters'
import type { ServerGamemode } from '../servers/row-markers'
import type { ServerPlayer, StatusReplySuccess } from '../servers/status-reply'

export type { ServerGamemode } from '../servers/row-markers'

/**
 * Re-exported from `../servers/list-sort` rather than redefined here - this file is the shared
 * contract's home, but the sort engine itself is pure and colocated with `row-markers.ts`, so the
 * types/constant travel through this module the same way `ServerGamemode` right above does.
 */
export type { ServerListSort, ServerSortColumn, ServerSortDirection } from '../servers/list-sort'
export { SERVER_SORT_COLUMNS } from '../servers/list-sort'

/** The servers module's contract. */
export const SERVERS_HANDLERS = {
  /** Resolves to the current `ServersOverview` - cache-first, no network of its own. */
  overviewRead: 'overview.read',
  /** Master-source-list handlers. */
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
  /** Adds an address to the favourites list. */
  favouritesAdd: 'favourites.add',
  /** Removes an address from the favourites list. */
  favouritesRemove: 'favourites.remove',
  /** Resolves to the connection history, most-recent-first. */
  historyRead: 'history.read',
  /** `scan.*` handler ids. */
  /** Starts a two-stage scan across the current address set. */
  scanStart: 'scan.start',
  /** Resolves to a `ScanSnapshot` of the scan's current state and every last-known row (D-D). */
  scanRead: 'scan.read',
  /** `scan.*` settings handler ids. */
  /** Resolves to the full, persisted `ServersScanSettings`. */
  scanGetSettings: 'scan.getSettings',
  /** Validates and persists a partial `ServersScanSettings` patch. */
  scanPatchSettings: 'scan.patchSettings',
  /** Reports whether the Servers view is currently mounted/visible. */
  scanSetViewActive: 'scan.setViewActive',
  /** The persisted list-sort handlers. */
  listGetSort: 'list.getSort',
  listSetSort: 'list.setSort',
  /** Resolves to a single server's `ServerDetail`. */
  detailRead: 'detail.read',
  /** Switches the browser between the online list and the LAN list (`ServersBrowseMode`). */
  scanSetMode: 'scan.setMode',
  /** The saved quick filters. */
  quickFiltersList: 'quickFilters.list',
  quickFiltersSave: 'quickFilters.save',
  quickFiltersRename: 'quickFilters.rename',
  quickFiltersRemove: 'quickFilters.remove',
} as const

/**
 * Main-to-renderer push under the `servers` module's namespace: `scan.changed` carries the scan's
 * own progress/state, `scan.server` carries one resolved row - one event per result, never batched.
 * Mirrors `HOME_EVENTS` in `src/shared/modules/home.ts`.
 */
export const SERVERS_EVENTS = {
  scanChanged: 'scan.changed',
  scanServer: 'scan.server',
  /** Pushed whenever the watchlist's persisted entries or their computed statuses change. */
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
 * The persisted shape of the `servers` module's own top-level `state.json` key - global to the
 * launcher, never per-installation. Mirrors `home.ts`'s `HomeLayout`/ `DEFAULT_HOME_LAYOUT`
 * pattern: a plain interface, a `.strict()`-free `z.object()` schema (same looseness as
 * `serversOverviewSchema` above), and a default constant.
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
 * The source list is a thing the user edits (adds, removes, reorders, toggles), not just a scanner
 * input - so it gets its own vocabulary (`MasterSource`) even though the shape is currently
 * identical to `ServerSourceEntry` above. Rather than duplicate the fields,
 * `MasterSource`/`masterSourceSchema` are aliases of `ServerSourceEntry`/`serverSourceEntrySchema`:
 * one shape, two names for two call sites (the `sources` array in `ServersState` vs. the
 * `sources.*` handler payloads/results below). If the two ever need to diverge, split them then.
 */
export type MasterSourceType = ServerSourceEntry['type']
export type MasterSource = ServerSourceEntry
export const masterSourceSchema = serverSourceEntrySchema

/** The one master/list source every fresh install ships with. */
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
 * `'manual'` here - a fixed literal, not a real choice - so the row stays self-describing if a
 * later story ever merges manual/favourite/scanned rows into one list; it is not persisted for any
 * other purpose than that tag.
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

/**
 * One entry in the connection history - the servers the user has actually connected to.
 * `connectedAt` is an ISO timestamp string.
 */
export interface ServerHistoryEntry {
  address: string
  connectedAt: string
}

export const serverHistoryEntrySchema = z.object({
  address: z.string(),
  connectedAt: z.string(),
})

/**
 * The cap on how many rows the connection history keeps. Enforced wherever history is appended
 * (main, a later D) - the oldest entries fall off once this is exceeded, never the newest.
 */
export const SERVER_HISTORY_CAP = 200

/**
 * `manual.add`'s result: a refusal is a returned result, never a thrown IPC error (CLAUDE.md: main
 * sends i18n keys, never prose, across IPC). `reasonKey` is whatever `serverAddressRejectionKey()`
 * (`src/shared/servers/address.ts`) produced for the `ServerAddressRejection` the handler's call to
 * `parseServerAddress` returned - already a `servers.address.reject.<reason>` i18n key, not a raw
 * reason code, so the renderer never needs to re-derive it.
 */
export type ManualServerAddResult = DomainResult<{ entry: ManualServerEntry }>

/**
 * Bounded-choice constants for every numeric scan-settings knob mirroring
 * `MIN_CONCURRENT_DOWNLOAD_JOBS`/`MAX_CONCURRENT_DOWNLOAD_JOBS`/`ARCHIVE_CACHE_BUDGET_CHOICES_GB`
 * (`downloads.ts`): a `MIN_*`/`MAX_*` bound pair for schema validation plus a `SCAN_*_CHOICES`
 * array of the exact values the Settings UI's `<Select>`s offer - closed lists, not free-text
 * ranges.
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

/**
 * The minimum spacing between two *automatic* scans - not a per-query throttle. 0/15s/30s/60s/5min.
 */
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
 * The scanner's budget knobs, user-facing settings. Beyond `concurrency`/`timeoutMs`/
 * `retries`/`minSpacingMs`:
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
 * launcher - none of its fields, at any level, carry an `installationId`; unlike
 * `configPlayedMods`/`configSwitchBinds` this is deliberately not scoped per installation.
 */
/**
 * The watchlist's own vocabulary - a user names a player to keep an eye on, and the launcher looks
 * for that name across the servers it already knows about.
 */

/** How a watchlist entry's `name` is matched against a roster's player names. `'exact'` requires a
 * full match, `'substring'` a case-insensitive containment, `'regex'` a user-supplied pattern run
 * under `WATCHLIST_REGEX_BUDGET_MS`'s time budget. */
export type WatchlistMatchMode = 'exact' | 'substring' | 'regex'

/** One entry the user is watching for. `tooSlow` (set once a regex entry is
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

/** How long a watchlist entry's name may be (the UI validation reads this same
 * constant). */
export const WATCHLIST_NAME_MAX = 64

/** The time budget a single regex entry gets against a roster before it is flagged `tooSlow` (the
 * matcher enforces this). */
export const WATCHLIST_REGEX_BUDGET_MS = 100

/**
 * One roster hit for a watched name - `serverName` is optional because a row that has never
 * received an `info`/`status` reply for its address has no name to show yet. `seenAt` is the
 * roster's own time, not wall-clock "now".
 */
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
 * One entry's current computed status (produced by the matcher/service). `'left'` means the watched name was seen at `address` as of a *previous* stage-2
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
 * `watchlist.*` handler ids, kept in a map separate from `SERVERS_HANDLERS` on purpose - the
 * completeness gate that asserts "every handler is registered in `SERVERS_HANDLERS`" must not
 * cover these, so this map is deliberately excluded from that check.
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

export const SERVERS_WATCHLIST_HANDLER_SCHEMAS = {
  [SERVERS_WATCHLIST_HANDLERS.read]: watchlistReadInputSchema,
  [SERVERS_WATCHLIST_HANDLERS.add]: watchlistAddInputSchema,
  [SERVERS_WATCHLIST_HANDLERS.update]: watchlistUpdateInputSchema,
  [SERVERS_WATCHLIST_HANDLERS.remove]: watchlistRemoveInputSchema,
  [SERVERS_WATCHLIST_HANDLERS.recheck]: watchlistRecheckInputSchema,
} satisfies Record<
  (typeof SERVERS_WATCHLIST_HANDLERS)[keyof typeof SERVERS_WATCHLIST_HANDLERS],
  z.ZodTypeAny
>

export interface ServersState {
  sources: ServerSourceEntry[]
  favourites: FavouriteServerEntry[]
  manualServers: ManualServerEntry[]
  history: ServerHistoryEntry[]
  scan: ServersScanSettings
  /** User-chosen list sort (story 119) */
  listSort: ServerListSort | null
  /** The watchlist's persisted entries - see `WatchlistEntry` below. */
  watchlist: WatchlistEntry[]
  /** Saved quick filters (named filter criteria), at most `QUICK_FILTER_MAX`. */
  quickFilters: QuickFilter[]
}

const serverGamemodeSchema = z.enum([
  'ctf',
  'team',
  'deathmatch',
  'coop',
  'single',
] as const satisfies readonly ServerGamemode[])

const maxPingMsSchema = z.union([
  z.literal(50),
  z.literal(100),
  z.literal(150),
  z.literal(200),
]) satisfies z.ZodType<MaxPingMs>

export const quickFilterCriteriaSchema = z
  .object({
    mod: z.string().nullable(),
    gamemode: serverGamemodeSchema.nullable(),
    map: z.string().nullable(),
    maxPingMs: maxPingMsSchema.nullable().default(null),
    empty: z.boolean(),
    hideBotsOnly: z.boolean(),
    waitingForOpponent: z.boolean(),
  })
  .strict()

export const quickFilterSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(QUICK_FILTER_NAME_MAX),
    criteria: quickFilterCriteriaSchema.refine(hasCriteria),
  })
  .strict()

export const serversStateSchema = z.object({
  sources: z.array(serverSourceEntrySchema),
  favourites: z.array(favouriteServerEntrySchema),
  manualServers: z.array(manualServerEntrySchema),
  history: z.array(serverHistoryEntrySchema),
  scan: serversScanSettingsSchema,
  watchlist: z.array(watchlistEntrySchema),
  quickFilters: z.array(quickFilterSchema),
  // lazy: serverListSortSchema is declared further down the file
  listSort: z.lazy(() => serverListSortSchema).nullable(),
})

/**
 * The out-of-the-box state. `favourites`/`manualServers`/ `history` stay empty - nothing to seed
 * there - but `sources` now ships pre-populated with `DEFAULT_MASTER_SOURCES`, the one shipped
 * master/list source, so a fresh install (or a state file missing this key) has a working source
 * list from the very first read, not an empty one the user has to build by hand.
 */
export const DEFAULT_SERVERS_STATE: ServersState = {
  sources: DEFAULT_MASTER_SOURCES,
  favourites: [],
  manualServers: [],
  history: [],
  listSort: null,
  scan: {
    // Measured, not invented: the budget is the N=300 row concurrency 24 / timeoutMs 1000 /
    // retries 1 of `npm run measure:scan` (median full pass ~7.5 s over the modelled loopback
    // population); the cadence values are reasoned from that pass time.
    concurrency: 24,
    timeoutMs: 1000,
    retries: 1,
    minSpacingMs: 30_000,
    autoScanOnOpen: true,
    autoRefreshEnabled: false,
    autoRefreshIntervalMs: 60_000,
  },
  watchlist: [],
  quickFilters: [],
}

/**
 * Every `servers` handler paired with its payload schema; `servers.test.ts` iterates it to check
 * no handler is missing one.
 */
/** Payload schemas for the five `sources.*` handlers. */
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

/** A full permutation of the current source ids - not a partial move. */
export const sourcesReorderInputSchema = z.object({
  ids: z.array(z.string()),
})

/**
 * What every `sources.*` mutation resolves to: the domain refusal is a returned result, not a
 * thrown error (mirrors `MasterSourceFailure`-shaped results in `src/main/modules/servers/` and
 * `AliasNameRejectReason` in `src/shared/config/aliases/alias-names.ts`). `sources.list` itself
 * always succeeds (it's a read), so it resolves to `MasterSource[]` directly, not this union - see
 * the handler's own payload schema/JSDoc, not this type.
 */
export type MasterSourcesRejectionReason =
  MasterSourceAddressRejection | 'not-found' | 'duplicate-address' | 'invalid-reorder'

export type MasterSourcesRefusalKey =
  | 'servers.sources.reject.empty'
  | 'servers.address.reject.extra-tokens'
  | 'servers.address.reject.forbidden-character'
  | 'servers.address.reject.argument-token'
  | 'servers.sources.reject.missing-port'
  | 'servers.address.reject.port-not-numeric'
  | 'servers.address.reject.port-out-of-range'
  | 'servers.address.reject.too-many-colons'
  | 'servers.address.reject.ipv6-not-supported'
  | 'servers.address.reject.host-empty'
  | 'servers.address.reject.host-too-long'
  | 'servers.address.reject.host-label-invalid'
  | 'servers.address.reject.ipv4-octet-out-of-range'
  | 'servers.sources.reject.url-too-long'
  | 'servers.sources.reject.invalid-url'
  | 'servers.sources.reject.unsupported-protocol'
  | 'servers.sources.reject.credentials-not-allowed'
  | 'servers.sources.reject.not-found'
  | 'servers.sources.reject.duplicate-address'
  | 'servers.sources.reject.invalid-reorder'

export type MasterSourcesResult = DomainResult<{ sources: MasterSource[] }, MasterSourcesRefusalKey>

/**
 * Payload schemas for the `favourites.*` handlers: just the address - no wrapper object -
 * validated with the shared `serverAddressSchema` (`src/shared/schemas.ts`), which normalizes a
 * `host:port` via `parseServerAddress` and rejects a malformed one.
 */
export const favouritesAddInputSchema = serverAddressSchema

export const favouritesRemoveInputSchema = serverAddressSchema

/** `history.read` takes no payload, same `z.void()` convention as `serversNoInputSchema`. */
export const historyReadInputSchema = serversNoInputSchema

/**
 * The scan's shared contract - types, event names, handler names and schemas, all that this
 * deliverable adds (Plan, step 1). The runner, the service and the renderer view are later
 * deliverables of the same story; nothing here has an implementation yet.
 */

/** Where one `ScanTarget` address was seen: an enabled master/list source (111), a favourite
 * (112) or a manually-added server (113). A target can carry more than one - see `ScanTarget`. */
export type ScanOrigin = 'source' | 'favourite' | 'manual' | 'lan'

/**
 * Which list the servers browser shows and scans - the internet (sources, favourites, manual
 * servers) or the local network (broadcast answers only).
 */
export type ServersBrowseMode = 'online' | 'lan'

/** One address the scan will sweep, plus every origin it was seen under. */
export interface ScanTarget {
  address: string
  origins: ScanOrigin[]
}

/**
 * Review fix: one query's outcome, exactly as `src/main/modules/servers/server-query.ts`'s
 * `queryServer()` resolves and as `src/main/modules/servers/scan-runner.ts` streams it through
 * `onServer`/`scan.server`. Defined here - not in `server-query.ts` - so the renderer client
 * (`modules/servers/client.ts`) can import the real type for the `scan.server` push instead of
 * hand-declaring a structurally-identical copy that nothing keeps in sync if either side changes.
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
 * One row of the servers list, as the scan and the renderer store hold it. `status: 'stale'` marks
 * a server that did not answer this scan - it keeps whatever it last reported rather than being
 * reported as empty or dropped. Every domain field below `status` is optional because
 * a target that has never yet answered (e.g. a favourite no source has ever returned) still needs a
 * row to exist.
 */
export interface ServerListEntry {
  address: string
  origins: ScanOrigin[]
  /** `'pending'` is a row that has never yet received a reply. */
  status: 'online' | 'stale' | 'pending'
  name?: string
  map?: string
  mod?: string
  maxclients?: number
  needpass?: boolean
  /** `needpass` bit 1: the server requires a spectator password. */
  spectatorPass?: boolean
  rttMs?: number
  /**
   * In-memory session history of this address's measured round trips, oldest first, newest
   * appended last - never persisted to `state.json`, rebuilt from nothing every process
   * lifetime exactly like `entries` itself.
   */
  rttHistory?: RttSample[]
  players?: number | ServerPlayer[]
  gamemode?: ServerGamemode
  /** ISO timestamp of the last reply. */
  lastSeenAt: string | null
}

/**
 * One round's measured round trip for a `ServerListEntry`'s `rttHistory` - `rttMs: null` means the
 * address did not answer that round (a stale flip), not that it answered in zero time.
 */
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
 * `resolveHttpListSource` returned for that source - already a `servers.source.error.<reason>` i18n
 * key, not a raw reason code, same convention as `ManualServerAddResult.reasonKey` above
 * (CLAUDE.md: main sends i18n keys across IPC, never prose).
 */
export interface ScanSourceFailure {
  sourceId: string
  reasonKey: string
}

/** The two stages a scan sweeps through, in order. `'idle'` is both "never run" and "finished". */
export type ScanPhase = 'idle' | 'stage1' | 'stage2'

/**
 * Why a scan is currently refused/held back from starting - a closed union so a later reason (if
 * any) is a compile-time-visible addition, unlike `ScanStartResult`'s/ `ManualServerAddResult`'s
 * free-text `reasonKey`. Currently only one member: the game is running (story 116)
 */
export type ScanBlockedReason = 'game-running'

/**
 * The scan's own live state (D-C's `scan.changed` payload). `stage1Total`/`stage2Total` are the
 * size of that stage's address set at the moment the stage started - `stage2Total` is `0` until
 * stage 1 has finished and the non-empty-plus-selected set is known. `startedAt`/`finishedAt` are
 * ISO timestamps, `null` before the first scan has ever run (`finishedAt` also `null` while
 * `running` is true).
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
  scope: ScanStateScope | null
  /** The mode of the running scan, or of the last one (`'online'` before any scan). */
  mode: ServersBrowseMode
}

/**
 * `scan.start`'s result: starting is a returned refusal when a scan is already running, not
 * a thrown IPC error - same shape convention as `ManualServerAddResult`/`MasterSourcesResult`
 * above. A successful start carries no data of its own - the caller learns everything through the
 * `scan.changed`/`scan.server` pushes, not through this return value.
 */
export type ScanStartResult = DomainResult<Record<never, never>>

/** A watchlist add/update/remove answers the new snapshot or a refusal reason key. */
export type WatchlistMutationResult = DomainResult<{ snapshot: WatchlistSnapshot }>

/**
 * The `reasonKey` a refused `scan.start` (or a `blockedReason: 'game-running'` scan state) carries
 * when the game is running - a distinct i18n convention from `SCAN_ALREADY_RUNNING_REASON_KEY`
 * (`servers.scan.error.<reason>`, `scan-service.ts`) because this is a *blocked* state rather than
 * an *error*, mirroring `WAITING_REASON_GAME_RUNNING` (`jobs.waiting.gameRunning`,
 * `src/main/services/write-guard.ts`). Lives here rather than in `scan-service.ts` because both a
 * later main-side deliverable and a renderer i18n-key check need it.
 */
export const SCAN_BLOCKED_GAME_RUNNING_REASON_KEY = 'servers.scan.blocked.gameRunning'

/**
 * `scan.read`'s result (D-D): a one-shot catch-up snapshot for a renderer that mounts mid-scan -
 * the scan's current state plus every row known so far (both online and stale, D-K), never a
 * polled value.
 */
export interface ScanSnapshot {
  state: ServersScanState
  /** The active mode's rows only - never a mix of online and LAN rows. */
  entries: ServerListRow[]
  /** The browser's active mode (`state.mode` is the mode of the running/last scan). */
  mode: ServersBrowseMode
  /** The last LAN round - when it finished and, if discovery failed, why (i18n key). */
  lan: { lastFinishedAt: string | null; failureKey: string | null }
}

/** `scan.start` with the favourites scope is refused while the browser is in LAN mode. */
export const SCAN_FAVOURITES_NOT_IN_LAN_REASON_KEY = 'servers.scan.error.favouritesNotInLan'

/** `ScanSnapshot.lan.failureKey` values - must match `lan-discovery.ts`'s constants. */
export const SERVERS_LAN_ERROR_NO_INTERFACE_KEY = 'servers.lan.error.noInterface'
export const SERVERS_LAN_ERROR_SOCKET_REFUSED_KEY = 'servers.lan.error.socketRefused'

/**
 * Which subset of servers a scan round touches. 'all' is exactly today's full scan (114's union
 * address set); 'favourites' touches only the favourites list; 'server' touches exactly one address
 * (allowed even when it is in no source/favourite/manual list). 'addresses' touches exactly the
 * named rows of the active list - every one must already be a row there, or the whole start is
 * refused with `SCAN_UNKNOWN_ADDRESS_REASON_KEY`.
 */
export type ScanScope =
  | { kind: 'all' }
  | { kind: 'favourites' }
  | { kind: 'server'; address: string }
  | { kind: 'addresses'; addresses: string[] }

/** Upper bound on an `addresses` scope - far above any real list, low enough that a hostile payload
 * cannot make main normalise an unbounded array (story 250) */
export const SCAN_SCOPE_ADDRESSES_MAX = 10_000

export const scanScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('favourites') }),
  z.object({ kind: z.literal('server'), address: serverAddressSchema }),
  z.object({
    kind: z.literal('addresses'),
    addresses: z.array(serverAddressSchema).min(1).max(SCAN_SCOPE_ADDRESSES_MAX),
  }),
])

/** `scan.start` with an `addresses` scope naming an address the active list has no row for. */
export const SCAN_UNKNOWN_ADDRESS_REASON_KEY = 'servers.scan.error.unknownAddress'

/** The scope as `ServersScanState` reports it: an `addresses` scope carries only its size, so a
 * `scan.changed` push never ships the whole address list back to the renderer (story 250) */
export type ScanStateScope =
  Exclude<ScanScope, { kind: 'addresses' }> | { kind: 'addresses'; count: number }

/**
 * `scan.start`'s payload (D-G): `selectedAddress` is optional and, when present, re-validated with
 * the same `serverAddressSchema` `favouritesAdd`/`favouritesRemove` already use above - it names
 * stage 2's "currently selected server", which has no selection surface yet. Accepts a call with no
 * payload at all (`undefined`), same as every other optional-field handler payload in this file
 * that is still allowed to be omitted entirely.
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
 * Payload schemas for the three `scan.*` settings handlers. `scanGetSettings` takes no payload,
 * same `z.void()` convention as `scanReadInputSchema` above.
 */
export const scanGetSettingsInputSchema = serversNoInputSchema

/**
 * `scan.patchSettings`'s payload - a partial `ServersScanSettings`, mirroring
 * `patchDownloadsSettingsInputSchema` (`shared/modules/downloads.ts`) exactly: each present
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

/** `scan.setMode`'s payload - the browse mode to switch to. */
export const scanSetModeInputSchema = z.object({ mode: z.enum(['online', 'lan']) })

/**
 * The persisted/IPC shape of a `ServerListSort` - `.strict()` so a payload carrying an unknown key
 * is rejected outright, same convention as `scanPatchSettingsInputSchema`.
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
 * `detail.read`'s payload - just the address, validated the same way `favouritesAddInputSchema`
 * already is (a bare `serverAddressSchema`, no wrapper object).
 */
export const detailReadInputSchema = serverAddressSchema

/**
 * `detail.read`'s result: the row as `scan.read` already knows it (so a favourite/pending
 * placeholder still resolves rather than failing) plus the last successful `status` reply's full
 * key set. `serverinfo` is replaced whole on each new `status` reply - never merged key-by-key -
 * and is kept exactly as-is while the row goes stale; it stays `null` until the very first `status`
 * reply for this address has ever landed. Later stories (players, admin state,...) extend this type
 * with more fields alongside `row`/ `serverinfo`.
 */
export interface ServerDetail {
  row: ServerListRow
  serverinfo: Record<string, string> | null
}

/** Result of a quick-filter mutation - the persisted list or a refusal reason key. */
export type QuickFilterRefusalKey =
  | 'servers.quickFilter.error.failed'
  | 'servers.quickFilter.error.noCriteria'
  | 'servers.quickFilter.error.empty'
  | 'servers.quickFilter.error.tooLong'
  | 'servers.quickFilter.error.taken'
  | 'servers.quickFilter.error.cap'
  | 'servers.quickFilter.error.notFound'

export type QuickFiltersResult = DomainResult<{ list: QuickFilter[] }, QuickFilterRefusalKey>

export const quickFiltersListInputSchema = serversNoInputSchema
export const quickFiltersSaveInputSchema = z
  .object({ name: z.string(), criteria: quickFilterCriteriaSchema, overwrite: z.boolean() })
  .strict()
export const quickFiltersRenameInputSchema = z.object({ id: z.string(), name: z.string() }).strict()
export const quickFiltersRemoveInputSchema = z.object({ id: z.string() }).strict()

export const SERVERS_HANDLER_SCHEMAS = {
  [SERVERS_HANDLERS.overviewRead]: serversNoInputSchema,
  [SERVERS_HANDLERS.sourcesList]: sourcesListInputSchema,
  [SERVERS_HANDLERS.sourcesAdd]: sourcesAddInputSchema,
  [SERVERS_HANDLERS.sourcesRemove]: sourcesRemoveInputSchema,
  [SERVERS_HANDLERS.sourcesUpdate]: sourcesUpdateInputSchema,
  [SERVERS_HANDLERS.sourcesReorder]: sourcesReorderInputSchema,
  [SERVERS_HANDLERS.favouritesAdd]: favouritesAddInputSchema,
  [SERVERS_HANDLERS.favouritesRemove]: favouritesRemoveInputSchema,
  [SERVERS_HANDLERS.historyRead]: historyReadInputSchema,
  [SERVERS_HANDLERS.scanStart]: scanStartInputSchema,
  [SERVERS_HANDLERS.scanRead]: scanReadInputSchema,
  [SERVERS_HANDLERS.scanGetSettings]: scanGetSettingsInputSchema,
  [SERVERS_HANDLERS.scanPatchSettings]: scanPatchSettingsInputSchema,
  [SERVERS_HANDLERS.scanSetViewActive]: scanSetViewActiveInputSchema,
  [SERVERS_HANDLERS.listGetSort]: listGetSortInputSchema,
  [SERVERS_HANDLERS.listSetSort]: listSetSortInputSchema,
  [SERVERS_HANDLERS.detailRead]: detailReadInputSchema,
  [SERVERS_HANDLERS.scanSetMode]: scanSetModeInputSchema,
  [SERVERS_HANDLERS.quickFiltersList]: quickFiltersListInputSchema,
  [SERVERS_HANDLERS.quickFiltersSave]: quickFiltersSaveInputSchema,
  [SERVERS_HANDLERS.quickFiltersRename]: quickFiltersRenameInputSchema,
  [SERVERS_HANDLERS.quickFiltersRemove]: quickFiltersRemoveInputSchema,
} satisfies Record<(typeof SERVERS_HANDLERS)[keyof typeof SERVERS_HANDLERS], z.ZodTypeAny>

/** Every servers handler's payload schema, including the feature-gated watchlist ones. */
export const SERVERS_CONTRACT_SCHEMAS = {
  ...SERVERS_HANDLER_SCHEMAS,
  ...SERVERS_WATCHLIST_HANDLER_SCHEMAS,
}

type ServersSchemas = typeof SERVERS_CONTRACT_SCHEMAS

/** The servers module's typed contract; `req` is each schema's parsed output. */
export type ServersContract = {
  handlers: {
    [SERVERS_HANDLERS.overviewRead]: {
      req: z.infer<ServersSchemas['overview.read']>
      res: ServersOverview
    }
    [SERVERS_HANDLERS.sourcesList]: {
      req: z.infer<ServersSchemas['sources.list']>
      res: MasterSource[]
    }
    [SERVERS_HANDLERS.sourcesAdd]: {
      req: z.infer<ServersSchemas['sources.add']>
      res: MasterSourcesResult
    }
    [SERVERS_HANDLERS.sourcesRemove]: {
      req: z.infer<ServersSchemas['sources.remove']>
      res: MasterSourcesResult
    }
    [SERVERS_HANDLERS.sourcesUpdate]: {
      req: z.infer<ServersSchemas['sources.update']>
      res: MasterSourcesResult
    }
    [SERVERS_HANDLERS.sourcesReorder]: {
      req: z.infer<ServersSchemas['sources.reorder']>
      res: MasterSourcesResult
    }
    [SERVERS_HANDLERS.favouritesAdd]: {
      req: z.infer<ServersSchemas['favourites.add']>
      res: FavouriteServerEntry[]
    }
    [SERVERS_HANDLERS.favouritesRemove]: {
      req: z.infer<ServersSchemas['favourites.remove']>
      res: FavouriteServerEntry[]
    }
    [SERVERS_HANDLERS.historyRead]: {
      req: z.infer<ServersSchemas['history.read']>
      res: ServerHistoryEntry[]
    }
    [SERVERS_HANDLERS.scanStart]: {
      req: z.infer<ServersSchemas['scan.start']>
      res: ScanStartResult
    }
    [SERVERS_HANDLERS.scanRead]: { req: z.infer<ServersSchemas['scan.read']>; res: ScanSnapshot }
    [SERVERS_HANDLERS.scanGetSettings]: {
      req: z.infer<ServersSchemas['scan.getSettings']>
      res: ServersScanSettings
    }
    [SERVERS_HANDLERS.scanPatchSettings]: {
      req: z.infer<ServersSchemas['scan.patchSettings']>
      res: ServersScanSettings
    }
    [SERVERS_HANDLERS.scanSetViewActive]: {
      req: z.infer<ServersSchemas['scan.setViewActive']>
      res: undefined
    }
    [SERVERS_HANDLERS.listGetSort]: {
      req: z.infer<ServersSchemas['list.getSort']>
      res: ServerListSort | null
    }
    [SERVERS_HANDLERS.listSetSort]: {
      req: z.infer<ServersSchemas['list.setSort']>
      res: ServerListSort | null
    }
    [SERVERS_HANDLERS.detailRead]: {
      req: z.infer<ServersSchemas['detail.read']>
      res: ServerDetail | null
    }
    [SERVERS_HANDLERS.scanSetMode]: { req: z.infer<ServersSchemas['scan.setMode']>; res: undefined }
    [SERVERS_HANDLERS.quickFiltersList]: {
      req: z.infer<ServersSchemas['quickFilters.list']>
      res: QuickFilter[]
    }
    [SERVERS_HANDLERS.quickFiltersSave]: {
      req: z.infer<ServersSchemas['quickFilters.save']>
      res: QuickFiltersResult
    }
    [SERVERS_HANDLERS.quickFiltersRename]: {
      req: z.infer<ServersSchemas['quickFilters.rename']>
      res: QuickFiltersResult
    }
    [SERVERS_HANDLERS.quickFiltersRemove]: {
      req: z.infer<ServersSchemas['quickFilters.remove']>
      res: QuickFiltersResult
    }
    [SERVERS_WATCHLIST_HANDLERS.read]: {
      req: z.infer<ServersSchemas['watchlist.read']>
      res: WatchlistSnapshot
    }
    [SERVERS_WATCHLIST_HANDLERS.add]: {
      req: z.infer<ServersSchemas['watchlist.add']>
      res: WatchlistMutationResult
    }
    [SERVERS_WATCHLIST_HANDLERS.update]: {
      req: z.infer<ServersSchemas['watchlist.update']>
      res: WatchlistMutationResult
    }
    [SERVERS_WATCHLIST_HANDLERS.remove]: {
      req: z.infer<ServersSchemas['watchlist.remove']>
      res: WatchlistMutationResult
    }
    [SERVERS_WATCHLIST_HANDLERS.recheck]: {
      req: z.infer<ServersSchemas['watchlist.recheck']>
      res: ScanStartResult
    }
  }
  events: {
    [SERVERS_EVENTS.scanChanged]: ServersScanState
    [SERVERS_EVENTS.scanServer]: ScanServerPush
    [SERVERS_EVENTS.watchlistChanged]: WatchlistSnapshot
  }
}
