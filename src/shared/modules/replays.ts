import { z } from 'zod'
import { demoUnreadableSchema } from '../demos/readability'
import type { NameFacts } from '../replays/name-template'
import { absolutePathSchema } from '../schemas'

/**
 * The replays module's contract.
 *
 * Each module owns one file under `src/shared/modules/` describing the data it
 * exchanges with the UI. Main implements the handlers, the renderer gets a typed
 * client, and neither side imports the other's code - this file is the only
 * thing they share. Same pattern as `servers.ts`/`home.ts`.
 *
 * Story 135 D1 adds only the shared contract: the handler map, the overview
 * shape and its schema. The handler itself, the demo scan and the renderer view
 * are later deliverables of this story.
 */
export const REPLAYS_HANDLERS = {
  /** Resolves to the current `ReplaysOverview` - cache-first, no network of its own. */
  overviewRead: 'overview.read',
  /** Resolves to the current `NameTemplatesView` (story 140). */
  nameTemplatesList: 'nameTemplates.list',
  /** Appends a user template; payload carries the template text. */
  nameTemplatesAdd: 'nameTemplates.add',
  /** Updates a user template's text, or a shipped entry's override. */
  nameTemplatesUpdate: 'nameTemplates.update',
  /** Removes a template (a shipped one is tombstoned, not merged back in until restored). */
  nameTemplatesRemove: 'nameTemplates.remove',
  /** Reorders the whole list; payload is the full ordered id list. */
  nameTemplatesReorder: 'nameTemplates.reorder',
  /** Clears a shipped entry's override back to the shipped wording. */
  nameTemplatesReset: 'nameTemplates.reset',
  /** Clears every removed-shipped tombstone. */
  nameTemplatesRestore: 'nameTemplates.restore',
  /** Resolves to every discovered demo across every known installation (story 141). */
  demosList: 'demos.list',
  /** Resolves to the current user-added extra demo folder list (story 142 D2). */
  extraFoldersList: 'extraFolders.list',
  /** Adds a user-picked extra demo folder; refuses on an invalid/unresolvable/duplicate path. */
  extraFoldersAdd: 'extraFolders.add',
  /** Removes an extra demo folder by id; an unknown id is a no-op. */
  extraFoldersRemove: 'extraFolders.remove',
  /** Starts a background index scan (story 144); resolves to `ReplaysScanStartResult` at once. */
  scanStart: 'scan.start',
  /** Resolves to the current index (story 144): the cached rows until this process's first scan
   * finishes, the last successful scan's rows after that. Shape: `replaysIndexReadResultSchema`. */
  indexRead: 'index.read',
} as const

/**
 * Story 144: main -> renderer pushes of this module, delivered through the module event channel
 * (same convention as `SERVERS_EVENTS`/`HOME_EVENTS`).
 */
export const REPLAYS_EVENTS = {
  /** A `ReplaysScanProgress` - pushed when a scan starts, as it advances, and once when it ends
   * (`running: false`, success or failure alike). */
  scanProgress: 'scan.progress',
} as const

/**
 * `overview.read` takes no payload - same `z.void()` convention as
 * `serversNoInputSchema` in `servers.ts`.
 */
export const replaysNoInputSchema = z.void()

/**
 * What `overview.read` resolves to: whether a demo scan is currently in
 * progress and how many demos are known so far.
 */
export interface ReplaysOverview {
  scanning: boolean
  demoCount: number
}

export const replaysOverviewSchema = z.object({
  scanning: z.boolean(),
  demoCount: z.number().int().nonnegative(),
})

/**
 * Text a user or shipped-override name template may hold: non-empty, capped so a template can't
 * grow unbounded, printable ASCII only (keeps templates portable across the filesystems the
 * resulting file names will land on), and never a path separator - a template names *pieces* of a
 * file name via `{tokens}` and literals, never a directory to write into.
 */
export const nameTemplateTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\x20-\x7E]+$/)
  .refine((text) => !text.includes('/') && !text.includes('\\'), {
    message: 'must not contain a path separator',
  })

/** Upper bound on how many name templates a single reorder payload may name. */
export const NAME_TEMPLATES_MAX = 50

export const nameTemplatesAddSchema = z.object({ template: nameTemplateTextSchema })
export const nameTemplatesUpdateSchema = z.object({ id: z.string(), template: nameTemplateTextSchema })
export const nameTemplatesRemoveSchema = z.object({ id: z.string() })
export const nameTemplatesReorderSchema = z.object({ ids: z.array(z.string()).max(NAME_TEMPLATES_MAX) })
export const nameTemplatesResetSchema = z.object({ id: z.string() })

/** A demo's on-disk container format - never a factor a UI label should need beyond this enum. */
export const demoFormatSchema = z.enum(['dm2', 'mvd2'])

/** Every reason a demo row can fail to parse: the shared header parsers' reasons
 * (kept in sync by hand with Dm2Unparsable/Mvd2Unparsable) plus story 143's zip-entry-only codes. */
export const demoUnparsableReasonSchema = z.enum([
  'empty',
  'truncated',
  'not-a-demo',
  'unknown-protocol',
  'header-too-large',
  'unknown-version',
  'unreadable',
  'entry-too-large',
  'encrypted',
])
export type DemoUnparsableReason = z.infer<typeof demoUnparsableReasonSchema>

/**
 * Where a discovered demo came from: never a path, just enough to label it in the UI and let main
 * resolve it back to a real file by id. `gameDir` is a short mod/game directory name (e.g.
 * "baseq2"), not a filesystem path.
 */
export const demoSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('installation'),
    installationId: z.string().min(1),
    installationName: z.string(),
    gameDir: z.string().min(1),
  }),
  z.object({
    kind: z.literal('extraFolder'),
    path: z.string().min(1),
  }),
])

/** A file's on-disk creation/modification stamps, as `fs.stat` reports them (milliseconds since
 * epoch). Story 145 D2: every index entry carries one, readable or not. For a zip-entry row,
 * `birthtimeMs` is always `0` (a zip entry has no creation time of its own) and `mtimeMs` is the
 * entry's own modified stamp, falling back to the archive's when the entry didn't report one. */
export const fileTimeSchema = z.object({
  birthtimeMs: z.number().finite(),
  mtimeMs: z.number().finite(),
})
export type DemoFileTime = z.infer<typeof fileTimeSchema>

/** Story 139's file-name-template match facts (`NameFacts`, `src/shared/replays/name-template.ts`),
 * mirrored here as a zod schema so an index entry can carry them across IPC. Computed the same way
 * for a readable or unreadable row alike - name matching only ever looks at the file name. */
export const nameFactsSchema = z.object({
  date: z
    .object({
      year: z.number().int(),
      month: z.number().int(),
      day: z.number().int(),
      hour: z.number().int().optional(),
      minute: z.number().int().optional(),
      second: z.number().int().optional(),
    })
    .optional(),
  map: z.string().optional(),
  pov: z.string().optional(),
  players: z.array(z.string()).optional(),
  teamA: z.string().optional(),
  teamB: z.string().optional(),
  host: z.string().optional(),
}) satisfies z.ZodType<NameFacts>

/**
 * A demo main found during a scan. Identified by a content-derived id, never a filesystem path -
 * the renderer names a demo by this id and asks main to resolve it, same convention as every other
 * `replays` handler (CLAUDE.md: "Paths from the renderer are never trusted").
 */
export const discoveredDemoSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  fileName: z.string().min(1),
  format: demoFormatSchema,
  gzip: z.boolean(),
  source: demoSourceSchema,
  /** Non-null when this row came from an entry inside a zip (story 143); null for a loose file. */
  archiveEntry: z.object({ archivePath: z.string().min(1), entryPath: z.string().min(1) }).nullable(),
  /** The map name parsed from the demo's own header, or null when unparsable/not yet parsed. */
  map: z.string().nullable(),
  /** Why the header couldn't be parsed, or null for a parseable row. */
  unparsableReason: demoUnparsableReasonSchema.nullable(),
  /** Story 145 D2: whether this row's header parsed at all. An unreadable demo is never dropped
   * from the index - it stays a row, flagged `readable: false`, so the UI can still list it. */
  readable: z.boolean(),
  /** Mirrors `readable`: null for a readable row, the structured reason (`DemoUnreadable`, shared
   * with `src/shared/demos/readability.ts`) for an unreadable one. */
  unreadable: demoUnreadableSchema.nullable(),
  /** `fs.stat`'s own timestamps for this file - present whether the row is readable or not. */
  fileTime: fileTimeSchema,
  /** Story 139's name-template match facts for this file's name, or null when no template
   * matched. Computed for every row, readable or not - name matching never depends on the header
   * having parsed. */
  nameFacts: nameFactsSchema.nullable(),
})

export const demosListResultSchema = z.array(discoveredDemoSchema)

export type DemoFormat = z.infer<typeof demoFormatSchema>
export type DemoSource = z.infer<typeof demoSourceSchema>
export type DiscoveredDemo = z.infer<typeof discoveredDemoSchema>

/**
 * Story 144: the scan-progress key of one `DemoSource` - one key per distinct source (an
 * installation's game dir, or one extra folder), so the renderer can match a progress entry to the
 * rows carrying that same `source`.
 */
export function demoSourceKey(source: DemoSource): string {
  return source.kind === 'installation'
    ? `installation:${source.installationId}:${source.gameDir}`
    : `extraFolder:${source.path}`
}

/** `scan.start`'s result: `started: false` means a scan was already running (single-flight) -
 * nothing new was kicked off. */
export const replaysScanStartResultSchema = z.object({ started: z.boolean() })
export type ReplaysScanStartResult = z.infer<typeof replaysScanStartResultSchema>

/** `index.read`'s result - the same row shape `demos.list` answers with. */
export const replaysIndexReadResultSchema = demosListResultSchema

/** `scan.progress`'s payload: per-source `scanned` / `total` counts, keyed by `demoSourceKey`. */
export const replaysScanProgressSchema = z.object({
  running: z.boolean(),
  sources: z.array(
    z.object({
      sourceKey: z.string(),
      scanned: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
  ),
})
export type ReplaysScanProgress = z.infer<typeof replaysScanProgressSchema>

/** `extraFolders.add`'s payload: a native-dialog-sourced absolute path (see
 * `REPLAYS_PATH_PAYLOAD_HANDLERS` below for why this is the one exception). */
export const extraFoldersAddSchema = z.object({ path: absolutePathSchema })

/** `extraFolders.remove`'s payload: the id of the row to drop. */
export const extraFoldersRemoveSchema = z.object({ id: z.string().min(1) })

/**
 * `extraFolders.add`'s result: the reason a path was refused mirrors the ok/refusal union shape
 * `MasterSourcesResult` uses in `servers.ts` - a returned value, not a thrown error, so the
 * refusal reason survives the IPC boundary.
 */
export type ExtraFoldersResult =
  | { ok: true; folders: ReplaysExtraFolder[] }
  | { ok: false; reason: 'notAbsolute' | 'unresolvable' | 'notAFolder' | 'alreadyListed' }

/**
 * Every `replays` handler paired with its payload schema - proves AC9's "every new channel exists
 * in the shared contract with a zod payload schema before its handler" for this module's own
 * handlers, and is what `replays.test.ts` iterates to check no handler is missing one.
 */
export const REPLAYS_HANDLER_SCHEMAS: Record<
  (typeof REPLAYS_HANDLERS)[keyof typeof REPLAYS_HANDLERS],
  z.ZodTypeAny
> = {
  [REPLAYS_HANDLERS.overviewRead]: replaysNoInputSchema,
  [REPLAYS_HANDLERS.nameTemplatesList]: replaysNoInputSchema,
  [REPLAYS_HANDLERS.nameTemplatesAdd]: nameTemplatesAddSchema,
  [REPLAYS_HANDLERS.nameTemplatesUpdate]: nameTemplatesUpdateSchema,
  [REPLAYS_HANDLERS.nameTemplatesRemove]: nameTemplatesRemoveSchema,
  [REPLAYS_HANDLERS.nameTemplatesReorder]: nameTemplatesReorderSchema,
  [REPLAYS_HANDLERS.nameTemplatesReset]: nameTemplatesResetSchema,
  [REPLAYS_HANDLERS.nameTemplatesRestore]: replaysNoInputSchema,
  [REPLAYS_HANDLERS.demosList]: replaysNoInputSchema,
  [REPLAYS_HANDLERS.extraFoldersList]: replaysNoInputSchema,
  [REPLAYS_HANDLERS.extraFoldersAdd]: extraFoldersAddSchema,
  [REPLAYS_HANDLERS.extraFoldersRemove]: extraFoldersRemoveSchema,
  [REPLAYS_HANDLERS.scanStart]: replaysNoInputSchema,
  [REPLAYS_HANDLERS.indexRead]: replaysNoInputSchema,
}

/**
 * Handlers whose payload is allowed to carry a filesystem path/dir/folder/file value. Deliberately
 * empty: the renderer never sends a filesystem path to open/play/edit a demo - it names a demo by
 * an id main resolved itself, never a path the renderer picked. The only handler that may ever join
 * this list is an "add extra folder" action driven by a native folder-picker dialog, whose result
 * is canonicalised in main before it is trusted - never a free-typed or otherwise renderer-derived
 * path.
 *
 * Story 142 D2: `extraFolders.add` is that one exception - its `path` is sourced from a native
 * folder-picker dialog and canonicalised in main (`isAbsolute` check, then `canonicalizePath` +
 * `isDirectory`) before it is ever trusted or persisted.
 */
export const REPLAYS_PATH_PAYLOAD_HANDLERS: readonly string[] = ['extraFolders.add']

/**
 * Story 142 D1: one user-added extra demo folder - a filesystem path the user picked via a native
 * folder-picker dialog (never free-typed or otherwise renderer-derived, per
 * `REPLAYS_PATH_PAYLOAD_HANDLERS`'s doc comment above), plus an id to name it by in IPC/UI and an
 * ISO timestamp of when it was added. Lives in shared (not just `src/main/lib/schemas.ts`) because
 * D2/D4's IPC contract needs the same row shape and validation.
 */
export interface ReplaysExtraFolder {
  id: string
  path: string
  addedAt: string
}

/**
 * One persisted extra-folder row, as it would be read back out of `state.json`. Reuses
 * `absolutePathSchema` (non-empty, NUL-free) for `path` - the same primitive every other
 * persisted/IPC path in this codebase validates against - rather than inventing a second one here.
 */
export const storedExtraFolderSchema = z.object({
  id: z.string().min(1),
  path: absolutePathSchema,
  addedAt: z.string(),
})
