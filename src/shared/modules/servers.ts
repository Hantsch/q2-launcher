import { z } from 'zod'

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
 * The out-of-the-box state (story 110, D1) - every collection empty. Seeding the three real master
 * sources is story 111's job, not this default's: a safe empty default is what a fresh install (or
 * a state file missing this key) gets.
 */
export const DEFAULT_SERVERS_STATE: ServersState = {
  sources: [],
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
export const SERVERS_HANDLER_SCHEMAS: Record<
  (typeof SERVERS_HANDLERS)[keyof typeof SERVERS_HANDLERS],
  z.ZodTypeAny
> = {
  [SERVERS_HANDLERS.overviewRead]: serversNoInputSchema,
}
