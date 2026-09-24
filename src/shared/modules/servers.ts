import { z } from 'zod'
import { serverAddressSchema } from '../schemas'
import type { MasterSourceAddressRejection } from '../servers/master-source-address'

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
 * The three master/list sources every fresh install ships with (story 111's concept). Fixed,
 * documented ids - never random uuids - so a state file, a bug report or this file's own diff can
 * name one of them stably across releases. `udp-master` addresses are pre-normalized `host:port`
 * (default port 27900, per `validateMasterSourceAddress`); `http-list` is stored as the absolute
 * URL string, query string included.
 */
export const DEFAULT_MASTER_SOURCES: MasterSource[] = [
  {
    id: 'default-q2servers-udp',
    type: 'udp-master',
    address: 'master.q2servers.com:27900',
    enabled: true,
  },
  {
    id: 'default-quakeservers-udp',
    type: 'udp-master',
    address: 'master.quakeservers.net:27900',
    enabled: true,
  },
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

/** A server the user added by hand rather than discovered through a source. */
export interface ManualServerEntry {
  address: string
  addedAt: string
}

export const manualServerEntrySchema = z.object({
  address: z.string(),
  addedAt: z.string(),
})

/** One entry in the connection history - the servers the user has actually connected to. */
export interface ServerHistoryEntry {
  address: string
  lastConnectedAt: string
}

export const serverHistoryEntrySchema = z.object({
  address: z.string(),
  lastConnectedAt: z.string(),
})

/**
 * The scanner's budget knobs (GB-N4). Provisional defaults - story 115 turns these into a real,
 * user-facing setting; here they only need to be sensible placeholders.
 */
export interface ServersScanSettings {
  concurrency: number
  timeoutMs: number
  retries: number
  minSpacingMs: number
}

export const serversScanSettingsSchema = z.object({
  concurrency: z.number(),
  timeoutMs: z.number(),
  retries: z.number(),
  minSpacingMs: z.number(),
})

/**
 * The envelope persisted at the `servers` module's own top-level `state.json` key. Global to the
 * launcher (AC6) - none of its fields, at any level, carry an `installationId`; unlike
 * `configPlayedMods`/`configSwitchBinds` this is deliberately not scoped per installation.
 */
export interface ServersState {
  sources: ServerSourceEntry[]
  favourites: FavouriteServerEntry[]
  manualServers: ManualServerEntry[]
  history: ServerHistoryEntry[]
  scan: ServersScanSettings
}

export const serversStateSchema = z.object({
  sources: z.array(serverSourceEntrySchema),
  favourites: z.array(favouriteServerEntrySchema),
  manualServers: z.array(manualServerEntrySchema),
  history: z.array(serverHistoryEntrySchema),
  scan: serversScanSettingsSchema,
})

/**
 * The out-of-the-box state (story 110 D1, updated story 111 D2). `favourites`/`manualServers`/
 * `history` stay empty - nothing to seed there - but `sources` now ships pre-populated with
 * `DEFAULT_MASTER_SOURCES`, the three shipped master/list sources, so a fresh install (or a state
 * file missing this key) has a working source list from the very first read, not an empty one the
 * user has to build by hand.
 */
export const DEFAULT_SERVERS_STATE: ServersState = {
  sources: DEFAULT_MASTER_SOURCES,
  favourites: [],
  manualServers: [],
  history: [],
  scan: {
    concurrency: 8,
    timeoutMs: 2000,
    retries: 1,
    minSpacingMs: 50,
  },
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
}
