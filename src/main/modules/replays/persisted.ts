import { z } from 'zod'
import {
  demoListSortSchema,
  nameTemplateTextSchema,
  storedExtraFolderSchema,
  type ReplaysExtraFolder,
} from '@shared/modules/replays'
import type { DemoListSort } from '@shared/replays/list-sort'
import {
  EMPTY_DEMO_LIST_FILTER,
  demoListFilterSchema,
  normalizeDemoListFilter,
  type DemoListFilter,
} from '@shared/replays/list-filter'
import {
  DEFAULT_NAME_TEMPLATES_STATE,
  type NameTemplatesState,
  type StoredNameTemplate,
} from '@shared/replays/name-templates'
import { parseForgivingEnvelope, parseKeyedRows } from '../../lib/forgiving'
import { pathKey } from '../../lib/fs-utils'
import type { StateSection, StateSectionSpec, StateStore } from '../../services/state'

/**
 * The replays module's own top-level `state.json` key. Purely additive: a file written before a
 * field existed simply lacks it and loads that field's default.
 */
export interface ReplaysState {
  nameTemplates: NameTemplatesState
  /** User-added extra demo folders. */
  extraFolders: ReplaysExtraFolder[]
  /** User-chosen demo list sort; `null` means the default order. Key is always present. */
  listSort: DemoListSort | null
  /** Not optional: `EMPTY_DEMO_LIST_FILTER` is itself the "no filter applied" value. */
  listFilter: DemoListFilter
  /** The missing-mod warning: whether it is asked at all, and the lowercase game dirs the user
   * said "don't ask again" for. */
  modWarning: { enabled: boolean; trustedMods: string[] }
  /**
   * The level (integer percent 0-100) the last demo session ended at, for every installation alike;
   * null until a session changed it. Mute is never remembered, only the level under it (story 237).
   */
  demoVolume: number | null
}

const demoVolumeSchema = z.number().int().min(0).max(100)

const storedNameTemplateSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    kind: z.literal('shipped'),
    shippedId: z.string().min(1),
    template: z.string().nullable(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('user'),
    template: z.string(),
  }),
])

const nameTemplatesStateEnvelopeSchema = z.object({
  entries: z.array(z.unknown()).catch([]),
  removedShippedIds: z.array(z.unknown()).catch([]),
})

/**
 * Entries get a second, domain-specific check after the structural parse: a non-null `template`
 * must be text `nameTemplateTextSchema` accepts, so a hand-edited file can never smuggle in a
 * template the compiler/matcher would choke on. A shipped row with `template: null` has no text.
 */
function parseNameTemplatesState(raw: unknown): NameTemplatesState {
  const envelope = parseForgivingEnvelope(nameTemplatesStateEnvelopeSchema, raw, () => ({
    entries: [],
    removedShippedIds: [],
  }))
  const entries = parseKeyedRows(storedNameTemplateSchema, envelope.entries, {
    refine: (row): StoredNameTemplate | null =>
      row.template !== null && !nameTemplateTextSchema.safeParse(row.template).success ? null : row,
    keyOf: (row) => row.id,
  })
  const removedShippedIds = parseKeyedRows(z.string(), envelope.removedShippedIds, {
    keyOf: (id) => id,
  })
  return { entries, removedShippedIds }
}

const extraFoldersEnvelopeSchema = z.object({
  extraFolders: z.array(z.unknown()).catch([]),
})

/**
 * Dedupe-by-key on `pathKey(row.path)` so the same folder can never appear twice under different
 * casing/trailing-slash spellings. Pure and synchronous - no disk access; whether a folder still
 * exists is a scan-time concern, not a parse-time one.
 */
function parseExtraFolders(raw: unknown): ReplaysExtraFolder[] {
  const envelope = parseForgivingEnvelope(extraFoldersEnvelopeSchema, raw, () => ({
    extraFolders: [],
  }))
  return parseKeyedRows(storedExtraFolderSchema, envelope.extraFolders, {
    keyOf: (row) => pathKey(row.path),
  })
}

const MOD_DIR_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

const modDirSchema = z
  .string()
  .regex(MOD_DIR_PATTERN)
  .refine((dir) => dir !== '.' && dir !== '..')
  .transform((dir) => dir.toLowerCase())

/** Forgiving parse of `modWarning` - non-boolean `enabled` -> `true`; invalid entries dropped;
 * game dirs lowercased and deduped (after lowercasing, so case variants collapse). */
const modWarningSchema = z
  .object({
    enabled: z.boolean().catch(true),
    trustedMods: z
      .array(z.unknown())
      .catch([])
      .transform((rows) => parseKeyedRows(modDirSchema, rows, { keyOf: (dir) => dir })),
  })
  .catch(() => ({ enabled: true, trustedMods: [] as string[] }))

/**
 * `undefined`/missing input degrades to the default, and each nested collection (`nameTemplates`,
 * `extraFolders`) is parsed by its own forgiving parser above, since each has its own
 * envelope/row-level rules.
 */
export function parseReplaysState(raw: unknown): ReplaysState {
  const nameTemplates = parseNameTemplatesState(
    (raw as { nameTemplates?: unknown } | null | undefined)?.nameTemplates,
  )
  const extraFolders = parseExtraFolders(raw)

  // `listSort` is field-level-forgiving: an absent or malformed value becomes `null` (default
  // order) rather than degrading the rest of the state.
  const listSortResult = demoListSortSchema.safeParse(
    (raw as { listSort?: unknown } | null)?.listSort,
  )
  const listSort: DemoListSort | null = listSortResult.success ? listSortResult.data : null

  // `listFilter` is forgiving the same way, but degrades to `EMPTY_DEMO_LIST_FILTER` rather than an
  // absent key, since that value already means "no filter".
  const listFilterResult = demoListFilterSchema.safeParse(
    (raw as { listFilter?: unknown } | null)?.listFilter,
  )
  const listFilter: DemoListFilter = listFilterResult.success
    ? normalizeDemoListFilter(listFilterResult.data)
    : EMPTY_DEMO_LIST_FILTER

  const modWarning = modWarningSchema.parse((raw as { modWarning?: unknown } | null)?.modWarning)

  const demoVolumeResult = demoVolumeSchema.safeParse(
    (raw as { demoVolume?: unknown } | null)?.demoVolume,
  )
  const demoVolume = demoVolumeResult.success ? demoVolumeResult.data : null

  return { nameTemplates, extraFolders, listFilter, modWarning, listSort, demoVolume }
}

/** Remembers the level a demo session ended at; the same section handle every other slot writes through. */
export function rememberDemoVolume(state: StateStore, percent: number): void {
  replaysState(state).update((live) => ({ ...live, demoVolume: percent }))
}

const replaysSpec: StateSectionSpec<ReplaysState> = {
  key: 'replays',
  parse: parseReplaysState,
  // Deep clones so nothing can mutate the shared module-level defaults for the rest of the
  // process's lifetime.
  defaults: () => ({
    nameTemplates: structuredClone(DEFAULT_NAME_TEMPLATES_STATE),
    extraFolders: [],
    listFilter: { ...EMPTY_DEMO_LIST_FILTER },
    modWarning: { enabled: true, trustedMods: [] },
    listSort: null,
    demoVolume: null,
  }),
}

/** The replays module's persisted section; the same handle on every call for one store. */
export function replaysState(state: StateStore): StateSection<ReplaysState> {
  return state.section(replaysSpec)
}
