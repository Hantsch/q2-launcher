import { z } from 'zod'
import {
  DEFAULT_MASTER_SOURCES,
  DEFAULT_SERVERS_STATE,
  SCAN_AUTO_REFRESH_INTERVAL_CHOICES_MS,
  SCAN_CONCURRENCY_CHOICES,
  SCAN_MIN_SPACING_CHOICES_MS,
  SCAN_RETRIES_CHOICES,
  SCAN_TIMEOUT_CHOICES_MS,
  favouriteServerEntrySchema,
  manualServerEntrySchema,
  quickFilterSchema,
  serverHistoryEntrySchema,
  serverListSortSchema,
  serverSourceEntrySchema,
  watchlistEntrySchema,
  type ServerListSort,
  type ServerSourceEntry,
  type ServersScanSettings,
  type ServersState,
} from '@shared/modules/servers'
import { QUICK_FILTER_MAX } from '@shared/servers/quick-filters'
import { parseServerAddress } from '@shared/servers/address'
import { validateMasterSourceAddress } from '@shared/servers/master-source-address'
import { parseForgivingEnvelope, parseKeyedRows } from '../../lib/forgiving'
import type { StateSection, StateSectionSpec, StateStore } from '../../services/state'
import { capServerHistory } from './history-log'

/**
 * Story 110 D2: the persisted `servers` top-level `state.json` key. Defensive at two levels, same
 * combination `parseHomeLayout`/`parseDownloadsSettings` use separately: an envelope check (a raw
 * value that isn't even "an object with array-ish collection keys" falls back to fresh defaults (`parseForgivingEnvelope`'s `fallback()`) - never the shared constant itself, so a caller mutating the result can't
 * corrupt the default for the next call) plus row-level dropping within each collection
 * (`parseForgivingRows`'s convention: one malformed row costs only itself, siblings survive) plus
 * field-level `.catch()` on `scan`'s four knobs (`downloadsSettingsSchema`'s convention: one bad
 * knob falls back to its own default, not the whole `scan` object).
 *
 * Every address (`sources`/`favourites`/`manualServers`/`history`) is re-validated with
 * `parseServerAddress` - the zod schemas here only check that `address` is *a string*, not that
 * it's a safe one (see `src/shared/servers/address.ts`'s file doc comment for why an unvalidated
 * address is a `+connect` argument-injection risk, not just a wrong-hostname one). A row whose
 * address fails that check is dropped like any other malformed row, and a row that survives has its
 * `address` field replaced by `parseServerAddress`'s own normalized `host:port` form rather than
 * whatever casing/shape the raw value carried.
 *
 * Finally, `sources` is deduplicated by `id` and each of the three address-keyed collections is
 * deduplicated by normalized address (first occurrence wins) - the same "avoid duplicate React
 * keys from a hand-edited or foreign file" reasoning as `parseHomeLayout`'s `moduleId` dedupe pass.
 */
/**
 * Story 115 D2, review fix: extends the four original knobs with the three settings D1 added, and
 * checks every numeric field against its own `SCAN_*_CHOICES` list (not a bare `.min()/.max()`
 * range, which accepts an in-range value with no matching `<Select>` option, e.g. an old
 * pre-choice-list persisted value like `concurrency: 8`/`timeoutMs: 2000`/`minSpacingMs: 50`) -
 * mirrors `downloadsSettingsSchema`'s `archiveCacheBudgetGB` field exactly: `.refine()` against the
 * choice list, `.catch(default)` on top, so a value that is not a member of that field's own choice
 * list falls back to that field's own default the same as a non-number value does, never dropping
 * the whole `scan` object. The whole-object `.catch()` below stays as the "not even an object"
 * fallback tier, coexisting with these field-level tiers.
 */
const serversScanSettingsForgivingSchema = z
  .object({
    concurrency: z
      .number()
      .refine((value) => (SCAN_CONCURRENCY_CHOICES as readonly number[]).includes(value))
      .catch(DEFAULT_SERVERS_STATE.scan.concurrency),
    timeoutMs: z
      .number()
      .refine((value) => (SCAN_TIMEOUT_CHOICES_MS as readonly number[]).includes(value))
      .catch(DEFAULT_SERVERS_STATE.scan.timeoutMs),
    retries: z
      .number()
      .refine((value) => (SCAN_RETRIES_CHOICES as readonly number[]).includes(value))
      .catch(DEFAULT_SERVERS_STATE.scan.retries),
    minSpacingMs: z
      .number()
      .refine((value) => (SCAN_MIN_SPACING_CHOICES_MS as readonly number[]).includes(value))
      .catch(DEFAULT_SERVERS_STATE.scan.minSpacingMs),
    autoScanOnOpen: z.boolean().catch(DEFAULT_SERVERS_STATE.scan.autoScanOnOpen),
    autoRefreshEnabled: z.boolean().catch(DEFAULT_SERVERS_STATE.scan.autoRefreshEnabled),
    autoRefreshIntervalMs: z
      .number()
      .refine((value) =>
        (SCAN_AUTO_REFRESH_INTERVAL_CHOICES_MS as readonly number[]).includes(value),
      )
      .catch(DEFAULT_SERVERS_STATE.scan.autoRefreshIntervalMs),
  })
  .catch(() => ({ ...DEFAULT_SERVERS_STATE.scan }))

function parseServersScanSettings(raw: unknown): ServersScanSettings {
  return serversScanSettingsForgivingSchema.parse(raw)
}

/**
 * The envelope shape loose enough that "missing/garbled collection key" degrades per-key, while
 * anything that isn't even an object (or is `null`) fails outright and falls back to
 * fresh defaults wholesale.
 *
 * Story 111 D2: `sources` is the one field with a real, non-empty default -
 * `DEFAULT_MASTER_SOURCES`, the one shipped master/list source - applied via a genuine zod
 * `.default()`, not read-time re-seeding logic (the story's own decision: "Defaults are the
 * `sources` field's zod default, not a re-seed on read"). `.catch([])` still sits underneath it for
 * a *present-but-malformed* value (e.g. `sources` is a string) - same "field-level fallback" rule
 * every other field here follows - while `.default()` only fires when the key is `undefined`
 * (absent entirely, or present as `undefined`), which is the one case that means "never customised"
 * rather than "customised to empty". A *present* `sources: []` is neither: it parses straight
 * through as `[]` and is returned as-is, exactly as the story requires ("an explicitly stored `[]`
 * stays empty").
 */
const serversStateEnvelopeSchema = z.object({
  sources: z
    .array(z.unknown())
    .catch([])
    .default(() => structuredClone(DEFAULT_MASTER_SOURCES)),
  favourites: z.array(z.unknown()).catch([]),
  manualServers: z.array(z.unknown()).catch([]),
  history: z.array(z.unknown()).catch([]),
  // Story 131 D1: missing entirely (every `state.json` predating this story) degrades to `[]` via
  // `.catch([])`, same as every other collection here - no `.default()` needed since `[]` is also
  // this field's own out-of-the-box value (unlike `sources`, which seeds real rows).
  watchlist: z.array(z.unknown()).catch([]),
  // Story 197 D1: absent (every `state.json` predating it) or malformed degrades to `[]`.
  quickFilters: z.array(z.unknown()).catch([]),
})

export function parseServersState(raw: unknown): ServersState {
  // `undefined` is "the `servers` key is missing" (a file predating story 110) - treated as `{}`
  // by `parseForgivingEnvelope`, so `sources`' `.default()` decides rather than the fallback.
  const envelope = parseForgivingEnvelope(serversStateEnvelopeSchema, raw, () => ({
    sources: structuredClone(DEFAULT_MASTER_SOURCES),
    favourites: [],
    manualServers: [],
    history: [],
    watchlist: [],
    quickFilters: [],
  }))

  const sources = parseKeyedRows(serverSourceEntrySchema, envelope.sources, {
    refine: (row): ServerSourceEntry | null => {
      const address = validateMasterSourceAddress(row.type, row.address)
      return address.ok ? { ...row, address: address.normalized } : null
    },
    keyOf: (row) => row.id,
  })
  const refineAddress = <T extends { address: string }>(row: T): T | null => {
    const address = parseServerAddress(row.address)
    return address.ok ? { ...row, address: address.normalized } : null
  }
  const byAddress = (row: { address: string }): string => row.address
  const favourites = parseKeyedRows(favouriteServerEntrySchema, envelope.favourites, {
    refine: refineAddress,
    keyOf: byAddress,
  })
  const manualServers = parseKeyedRows(manualServerEntrySchema, envelope.manualServers, {
    refine: refineAddress,
    keyOf: byAddress,
  })
  // Story 113 D-G: the history cap is a store invariant - a hand-edited file carrying 500 rows must
  // not reintroduce an unbounded list. It only cuts the tail, after the dedupe.
  const history = capServerHistory(
    parseKeyedRows(serverHistoryEntrySchema, envelope.history, {
      refine: refineAddress,
      keyOf: byAddress,
    }),
  )
  const scan = parseServersScanSettings((raw as { scan?: unknown } | null)?.scan)

  // Story 119 D2: `listSort` is field-level-forgiving - an absent or malformed value parses to `null`
  // rather than degrading the rest of the state, so it is read straight off `raw`.
  const listSortResult = serverListSortSchema.safeParse(
    (raw as { listSort?: unknown } | null)?.listSort,
  )
  const listSort: ServerListSort | null = listSortResult.success ? listSortResult.data : null

  const watchlist = parseKeyedRows(watchlistEntrySchema, envelope.watchlist, {
    keyOf: (row) => row.id,
  })

  // Story 197 D1: case-insensitive duplicate names (first wins), then the first `QUICK_FILTER_MAX`
  // kept - the cap is a store invariant like the history cap.
  const quickFilters = parseKeyedRows(quickFilterSchema, envelope.quickFilters, {
    keyOf: (row) => row.name.toLowerCase(),
  }).slice(0, QUICK_FILTER_MAX)

  return {
    sources,
    favourites,
    manualServers,
    history,
    scan,
    watchlist,
    quickFilters,
    listSort,
  }
}

/** A deep clone, so nothing that mutates the persisted state can corrupt the shipped default. */
function defaultServersState(): ServersState {
  return structuredClone(DEFAULT_SERVERS_STATE)
}

const serversSpec: StateSectionSpec<ServersState> = {
  key: 'servers',
  parse: parseServersState,
  defaults: defaultServersState,
}

/** The servers module's persisted state; the same handle on every call for one store. */
export function serversState(state: StateStore): StateSection<ServersState> {
  return state.section(serversSpec)
}
