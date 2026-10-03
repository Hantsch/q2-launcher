import { z } from 'zod'
import { VALUE_SOURCES } from '../demos/effective-values'
import { demoUnreadableSchema } from '../demos/readability'
import { demoListFilterSchema } from '../replays/list-filter'
import { DEMO_SORT_COLUMNS } from '../replays/list-sort'
import type { NameFacts } from '../replays/name-template'
import { sidecarFieldsSchema } from '../replays/sidecar'
import { timelineActionSchema } from '../replays/timeline'
import { absolutePathSchema } from '../schemas'
import type { CinemaAvailability } from '../replays/cinema'
import type { DomainResult } from '../types'

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
  /** Resolves to the current sidecar for a demo id, or `{ state: 'none' }` if it has none (story 146). */
  sidecarRead: 'sidecar.read',
  /** Full-replacement save of a demo's sidecar fields, id-addressed (story 146). */
  sidecarWrite: 'sidecar.write',
  /** Story 152 D2: the persisted list-sort handlers, mirroring `SERVERS_HANDLERS.listGetSort`/
   * `listSetSort` (`servers.ts`) exactly. `listGetSort` resolves to the current
   * `DemoListSort | null` (`null` meaning the default favourites-first order); `listSetSort`
   * validates and persists a new one (or clears it with `null`), resolving to what was actually
   * persisted. */
  listGetSort: 'list.getSort',
  listSetSort: 'list.setSort',
  /** Story 153 D3: the persisted list-filter handlers, mirroring `listGetSort`/`listSetSort` right
   * above exactly. `listGetFilter` resolves to the current `DemoListFilter` (`EMPTY_DEMO_LIST_FILTER`
   * when nothing stored); `listSetFilter` validates and persists a new one, resolving to what was
   * actually persisted. */
  listGetFilter: 'listFilter.read',
  listSetFilter: 'listFilter.write',
  /** Story 182 D1: the missing-mod warning's persisted state. Every handler resolves to the full
   * `ReplaysModWarning`. */
  modWarningRead: 'modWarning.read',
  modWarningSetEnabled: 'modWarning.setEnabled',
  modWarningTrustMod: 'modWarning.trustMod',
  modWarningResetTrusted: 'modWarning.resetTrusted',
  /** Story 156: reveals a demo's file in the OS file manager, resolved from its id in main. */
  demosReveal: 'demos.reveal',
  /** Story 156: copies a demo's resolved absolute path to the clipboard. */
  demosCopyPath: 'demos.copyPath',
  /** Story 157: renames a demo (and its sidecar, if any) to a new stem, id-addressed - main resolves
   * the id to the real path itself. Resolves to `Outcome<{ demo: DiscoveredDemo }>`. */
  demoRename: 'demo.rename',
  /** Story 159: plays a demo in Q2PRO (`+demo <file>`), id-addressed - main re-runs eligibility on its
   * own data and resolves/contains the file itself. Resolves to `Outcome<void>`. */
  demoPlay: 'demo.play',
  /** Story 165 D2: steers the running demo (pause, jump, seek, speed) - a fixed action union, never
   * console text. Resolves to `Outcome<void>`; no live session is the typed no-session error. */
  playbackTimeline: 'playback.timeline',
  /** Story 166 D2: sends one user-typed console line to the running demo. Main validates the line
   * again (`validateConsoleLine`) and resolves to `Outcome<void>`; a refused line or no live session
   * is a typed `replays.console.error.*` failure. */
  playbackConsoleSend: 'playback.consoleSend',
  /** Story 170 D1: re-places the running demo's window over the launcher's stage rect; story 171 D2:
   * `{ rect: null }` says there is no stage (the game window is parked off the desktop). */
  playbackStage: 'playback.stage',
  /** Story 173 D1: ends the running demo - asks the game to `quit`, and terminates it if it has not
   * exited within main's timeout (or at once when the quit is refused). Resolves to `Outcome<void>`;
   * no playback launch running is the typed no-session error. */
  playbackStop: 'playback.stop',
  /** Story 187 D5: enters (`{ enter: true }`) or leaves cinema mode for the running demo. Resolves to
   * `Outcome<void>`; entering while cinema is unavailable fails with its reason key. */
  playbackCinema: 'playback.cinema',
  /** Story 187 D5: the current `ReplaysPlaybackDisplay` (what the last `playback.display` push said). */
  playbackDisplayRead: 'playback.display.read',
} as const

/**
 * Story 144: main -> renderer pushes of this module, delivered through the module event channel
 * (same convention as `SERVERS_EVENTS`/`HOME_EVENTS`).
 */
export const REPLAYS_EVENTS = {
  /** A `ReplaysScanProgress` - pushed when a scan starts, as it advances, and once when it ends
   * (`running: false`, success or failure alike). */
  scanProgress: 'scan.progress',
  /** Story 164 D4: a `ReplaysPlaybackPosition` - pushed every 250 ms while a demo plays. */
  playbackPosition: 'playback.position',
  /** Story 164 D4: a `ReplaysPlaybackState` - `playing` on attach, `finished` when the demo ends,
   * `ended` (always last) once the game is gone or the launcher let go of it. */
  playbackState: 'playback.state',
  /** Story 172 D5: a `ReplaysPlaybackDisplay` - pushed when the demo goes fullscreen or comes back. */
  playbackDisplay: 'playback.display',
} as const

export interface ReplaysPlaybackPosition {
  positionMs: number | null
  durationMs: number | null
  /** The engine's own pause state; null when it did not report one (the view then infers it). */
  paused: boolean | null
}

/**
 * Story 172 D5 / 187 D5: how the running demo is shown. The mode is `fullscreen` when the channel says
 * so, else `cinema` while the overlay is open, else the stage preview. `speed` is held in main (the last
 * accepted `speed` timeline action, 1 at session start); `cinemaAvailability` follows the main window.
 */
export interface ReplaysPlaybackDisplay {
  fullscreen: boolean
  cinema: boolean
  speed: number
  cinemaAvailability: CinemaAvailability
}

export interface ReplaysPlaybackState {
  state: 'playing' | 'finished' | 'ended'
}

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
export const nameTemplatesUpdateSchema = z.object({
  id: z.string(),
  template: nameTemplateTextSchema,
})
export const nameTemplatesRemoveSchema = z.object({ id: z.string() })
export const nameTemplatesReorderSchema = z.object({
  ids: z.array(z.string()).max(NAME_TEMPLATES_MAX),
})
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
  archiveEntry: z
    .object({ archivePath: z.string().min(1), entryPath: z.string().min(1) })
    .nullable(),
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
  /** The game dir (mod) from the demo's own header, or null when unparsable/not yet parsed. */
  gameDir: z.string().nullable(),
  /** The recording player's name from the header (`.dm2` only), or null when unknown. */
  pov: z.string().nullable(),
  /** Player names from the header's configstrings - empty when unknown. */
  players: z.array(z.string()),
  /** Playback duration from the demo's frame count, or null when it could not be counted. */
  durationMs: z.number().int().nonnegative().nullable(),
  /** `fs.stat`'s own timestamps for this file - present whether the row is readable or not. */
  fileTime: fileTimeSchema,
  /** Story 139's name-template match facts for this file's name, or null when no template
   * matched. Computed for every row, readable or not - name matching never depends on the header
   * having parsed. */
  nameFacts: nameFactsSchema.nullable(),
})

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

/**
 * Story 151 D1: every distinct way one discovery source can fail to contribute what it should -
 * an extra folder or an installation's `demos` folder that cannot be listed at all, or one zip
 * archive within an otherwise-scannable folder that could not be expanded. `'extractor-missing'`,
 * `'archive-unreadable'` and `'archive-too-large'` mirror `zip-demos.ts`'s own `ZipListError` codes
 * one-for-one; the rest mirror `dirReadFailureReason`'s folder-level outcomes.
 */
export const replaysSourceErrorReasonSchema = z.enum([
  'missing',
  'notAFolder',
  'permissionDenied',
  'unreadable',
  'extractor-missing',
  'archive-unreadable',
  'archive-too-large',
])
export type ReplaysSourceErrorReason = z.infer<typeof replaysSourceErrorReasonSchema>

/**
 * One reported discovery failure: which source it came from, the archive's file name when the
 * failure is one zip within that source rather than the source's folder itself (`null` for a
 * folder-level failure), and why.
 */
export const replaysSourceErrorSchema = z.object({
  source: demoSourceSchema,
  archiveName: z.string().min(1).nullable(),
  reason: replaysSourceErrorReasonSchema,
})
export type ReplaysSourceError = z.infer<typeof replaysSourceErrorSchema>

/**
 * Story 150 D2: a single effective field, mirroring `Effective<T>`
 * (`src/shared/demos/effective-values.ts`) - either a value plus the rung it came from, or both
 * null when no rung had one. `effectiveSchema` is generic so each field in `effectiveValuesSchema`
 * below wraps its own value type without repeating the union.
 */
export function effectiveSchema<T extends z.ZodTypeAny>(inner: T) {
  return z.union([
    z.object({ value: inner, source: z.enum(VALUE_SOURCES) }),
    z.object({ value: z.null(), source: z.null() }),
  ])
}

/** Mirrors `EffectiveSide` (`effective-values.ts`): one side of a demo's players, with an optional
 * team/result label. */
export const effectiveSideSchema = z.object({
  team: z.string().optional(),
  result: z.string().optional(),
  players: z.array(z.string()),
})

/** Mirrors `EffectiveValues` (`effective-values.ts`) field-for-field, each wrapped in
 * `effectiveSchema` so a `DemoRow` can carry both the resolved value and which rung won it. */
export const effectiveValuesSchema = z.object({
  name: effectiveSchema(z.string()),
  map: effectiveSchema(z.string()),
  mod: effectiveSchema(z.string()),
  gamemode: effectiveSchema(z.string()),
  sides: effectiveSchema(z.array(effectiveSideSchema)),
  date: effectiveSchema(z.number()),
  pov: effectiveSchema(z.string()),
  host: effectiveSchema(z.string()),
})

/**
 * Story 150 D2: `index.read`'s real row shape - a discovered demo plus its sidecar (state and
 * whatever fields validated) and its resolved effective values, composed in main
 * (`src/main/modules/replays/demo-rows.ts`) so the renderer never has to run the resolver itself.
 */
export const demoRowSchema = discoveredDemoSchema.extend({
  sidecar: z.object({
    state: z.enum(['none', 'ok', 'error']),
    values: sidecarFieldsSchema.partial(),
  }),
  effective: effectiveValuesSchema,
})
export type DemoRow = z.infer<typeof demoRowSchema>

/** `index.read`'s result - composed demo rows (a discovered demo plus sidecar and effective values). */
export const replaysIndexReadResultSchema = z.array(demoRowSchema)

/** `scan.progress`'s payload: per-source `scanned` / `total` counts, keyed by `demoSourceKey`, plus
 * (story 151 D2) this scan's source errors so far - the previous scan's while one is still running,
 * this scan's own once the final `running: false` push goes out. */
export const replaysScanProgressSchema = z.object({
  running: z.boolean(),
  sources: z.array(
    z.object({
      sourceKey: z.string(),
      scanned: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
  ),
  sourceErrors: z.array(replaysSourceErrorSchema),
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
export type ExtraFoldersRefusalKey =
  | 'replays.extraFolders.error.notAbsolute'
  | 'replays.extraFolders.error.unresolvable'
  | 'replays.extraFolders.error.notAFolder'
  | 'replays.extraFolders.error.alreadyListed'

export type ExtraFoldersResult = DomainResult<
  { folders: ReplaysExtraFolder[] },
  ExtraFoldersRefusalKey
>

/** A demo id (`discoveredDemoSchema.id`'s standalone counterpart): looser than the content-derived
 * hex fingerprint on purpose, so a `sidecar.*` payload naming an id the index no longer knows about
 * still reaches the handler as an ordinary "unknown id" outcome rather than a schema rejection
 * (story 146). */
export const replaysDemoIdSchema = z.string().min(1).max(512)

/** `sidecar.read`'s payload: the demo id to look up. */
export const replaysSidecarReadSchema = z.object({ demoId: replaysDemoIdSchema })

/** `demos.reveal`/`demos.copyPath`'s payload: the demo id to resolve - never a path (CLAUDE.md:
 * "Paths from the renderer are never trusted"), `.strict()` so a payload smuggling a `path` key
 * alongside the id is rejected outright rather than silently ignored (story 156 AC4). */
export const replaysDemoFileActionSchema = z.object({ demoId: replaysDemoIdSchema }).strict()

/** `demos.reveal`/`demos.copyPath`'s result: the path itself never crosses IPC, only whether the
 * action ran and, on refusal, why - mirrors `ExtraFoldersResult`'s ok/refusal union shape above. */
export type DemoFileActionResult = DomainResult<
  Record<never, never>,
  'replays.play.error.notFound' | 'replays.play.error.fileMissing'
>

/** `demo.rename`'s payload (story 157): the demo id plus the new name STEM - never a path; main
 * validates the stem itself (`validateDemoRename`) and resolves the id to the real file. `.strict()`
 * for the same reason as `replaysDemoFileActionSchema` above. */
export const replaysDemoRenameSchema = z
  .object({ id: replaysDemoIdSchema, name: z.string().max(255) })
  .strict()

/** `playback.consoleSend`'s payload (story 166): one free console line. The loose 1024 cap only
 * bounds the payload; main's `validateConsoleLine` is the authority (printable, one line, 255). */
export const replaysConsoleSendSchema = z.object({ line: z.string().max(1024) }).strict()

/** Story 170 D1: the launcher's stage as a rect in CSS pixels of the renderer's content area -
 * integers only, origin non-negative, size 1-16384. `.strict()` so an extra key is refused. */
export const replaysStageRectSchema = z
  .object({
    x: z.number().int().min(0).max(16384),
    y: z.number().int().min(0).max(16384),
    width: z.number().int().min(1).max(16384),
    height: z.number().int().min(1).max(16384),
  })
  .strict()
export type ReplaysStageRect = z.infer<typeof replaysStageRectSchema>

/** Story 171 D2: `playback.stage`'s payload - where the stage is now, or `null` when there is none. */
export const replaysPlaybackStageSchema = z
  .object({ rect: replaysStageRectSchema.nullable() })
  .strict()
export type ReplaysPlaybackStagePayload = z.infer<typeof replaysPlaybackStageSchema>

/** Story 187 D5: `playback.cinema`'s payload - enter (`true`) or leave (`false`) cinema mode. */
export const replaysPlaybackCinemaSchema = z.object({ enter: z.boolean() }).strict()
export type ReplaysPlaybackCinemaPayload = z.infer<typeof replaysPlaybackCinemaSchema>

/** Story 187 D5: `playback.display.read` takes an empty object. */
export const replaysPlaybackDisplayReadSchema = z.object({}).strict()

/** Story 170 D1: what `demo.play` reports about the stage - `null` when no rect was sent. */
export type ReplaysStageResult = DomainResult<Record<never, never>>
export interface ReplaysDemoPlayResult {
  stage: ReplaysStageResult | null
}

/** `demo.play`'s payload (story 159): the demo id plus the installation the renderer believes it is
 * playing in - never a path. Main checks that id against its own eligible (active) installation and
 * refuses a mismatch. `.strict()` for the same reason as `replaysDemoFileActionSchema` above. */
export const replaysDemoPlaySchema = z
  .object({
    demoId: replaysDemoIdSchema,
    installationId: z.string().min(1).max(512),
    /** The user confirmed the "mod not fully installed" warning; main re-checks everything else. */
    acknowledgeModMissing: z.boolean().optional(),
    /** Story 170: where the launcher's stage is; absent, the game opens in its own window. */
    stage: replaysStageRectSchema.optional(),
  })
  .strict()

/** `sidecar.write`'s payload: the demo id plus the full replacement set of sidecar fields, and -
 * only when replacing a broken sidecar the user has confirmed - the fingerprint a previous
 * `needsConfirmation` response reported for that file (story 147). */
export const replaysSidecarWriteSchema = z
  .object({
    demoId: replaysDemoIdSchema,
    fields: sidecarFieldsSchema,
    confirmReplace: z.string().optional(),
  })
  .strict()

/**
 * Story 152 D2: the persisted/IPC shape of a `DemoListSort` - `.strict()` so a payload carrying an
 * unknown key is rejected outright, same convention as `serverListSortSchema` (`servers.ts`).
 */
export const demoListSortSchema = z
  .object({
    column: z.enum(DEMO_SORT_COLUMNS),
    direction: z.enum(['asc', 'desc']),
  })
  .strict()

/** `list.getSort` takes no payload - same `z.void()` convention as `replaysNoInputSchema` above. */
export const listGetSortInputSchema = replaysNoInputSchema

/** `list.setSort`'s payload - a full sort or `null` to clear it back to the default order. */
export const listSetSortInputSchema = z.object({ sort: demoListSortSchema.nullable() }).strict()

/** `listFilter.read` takes no payload - same `z.void()` convention as `listGetSortInputSchema` above. */
export const listGetFilterInputSchema = replaysNoInputSchema

/** `listFilter.write`'s payload - a full replacement `DemoListFilter`. */
export const listSetFilterInputSchema = z.object({ filter: demoListFilterSchema }).strict()

/** Story 182 D1: the missing-mod warning state as seen by the renderer. */
export interface ReplaysModWarning {
  enabled: boolean
  trustedMods: string[]
}

export const modWarningReadInputSchema = replaysNoInputSchema
export const modWarningResetTrustedInputSchema = replaysNoInputSchema
export const modWarningSetEnabledInputSchema = z.object({ enabled: z.boolean() }).strict()
/** `modWarning.trustMod`'s payload - a bare game dir name (never a path). */
export const modWarningTrustModInputSchema = z
  .object({
    gameDir: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_.-]+$/)
      .refine((dir) => dir !== '.' && dir !== '..'),
  })
  .strict()

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
  [REPLAYS_HANDLERS.extraFoldersList]: replaysNoInputSchema,
  [REPLAYS_HANDLERS.extraFoldersAdd]: extraFoldersAddSchema,
  [REPLAYS_HANDLERS.extraFoldersRemove]: extraFoldersRemoveSchema,
  [REPLAYS_HANDLERS.scanStart]: replaysNoInputSchema,
  [REPLAYS_HANDLERS.indexRead]: replaysNoInputSchema,
  [REPLAYS_HANDLERS.sidecarRead]: replaysSidecarReadSchema,
  [REPLAYS_HANDLERS.sidecarWrite]: replaysSidecarWriteSchema,
  [REPLAYS_HANDLERS.listGetSort]: listGetSortInputSchema,
  [REPLAYS_HANDLERS.listSetSort]: listSetSortInputSchema,
  [REPLAYS_HANDLERS.listGetFilter]: listGetFilterInputSchema,
  [REPLAYS_HANDLERS.listSetFilter]: listSetFilterInputSchema,
  [REPLAYS_HANDLERS.modWarningRead]: modWarningReadInputSchema,
  [REPLAYS_HANDLERS.modWarningSetEnabled]: modWarningSetEnabledInputSchema,
  [REPLAYS_HANDLERS.modWarningTrustMod]: modWarningTrustModInputSchema,
  [REPLAYS_HANDLERS.modWarningResetTrusted]: modWarningResetTrustedInputSchema,
  [REPLAYS_HANDLERS.demosReveal]: replaysDemoFileActionSchema,
  [REPLAYS_HANDLERS.demosCopyPath]: replaysDemoFileActionSchema,
  [REPLAYS_HANDLERS.demoRename]: replaysDemoRenameSchema,
  [REPLAYS_HANDLERS.demoPlay]: replaysDemoPlaySchema,
  [REPLAYS_HANDLERS.playbackTimeline]: timelineActionSchema,
  [REPLAYS_HANDLERS.playbackStage]: replaysPlaybackStageSchema,
  [REPLAYS_HANDLERS.playbackConsoleSend]: replaysConsoleSendSchema,
  [REPLAYS_HANDLERS.playbackStop]: replaysNoInputSchema,
  [REPLAYS_HANDLERS.playbackCinema]: replaysPlaybackCinemaSchema,
  [REPLAYS_HANDLERS.playbackDisplayRead]: replaysPlaybackDisplayReadSchema,
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
 * `absolutePathSchema` (absolute, NUL-free) for `path` - the same primitive every other
 * persisted/IPC path in this codebase validates against - rather than inventing a second one here.
 */
export const storedExtraFolderSchema = z.object({
  id: z.string().min(1),
  path: absolutePathSchema,
  addedAt: z.string(),
})

/** Handlers that may create, change or delete a sidecar file - the only ones AC4's no-write guard
 * test (story 146) exempts from "must never write a sidecar". */
export const REPLAYS_SIDECAR_WRITING_HANDLERS: readonly string[] = ['sidecar.write']

/**
 * Story 147: every distinct way a sidecar read can go wrong, one per i18n key under
 * `replays.sidecar.issue.<kind>`. `'unreadable'` is never produced by the pure reader
 * (`sidecar-read.ts`) - it's reserved for a later deliverable's fs layer (EACCES/EISDIR-type
 * failures reading the file itself, not its content).
 */
export type SidecarIssueKind =
  'invalidJson' | 'notAnObject' | 'invalidField' | 'unknownField' | 'unknownVersion' | 'unreadable'

/** One reported problem with a sidecar file: which kind, the i18n key to show it with (always
 * `replays.sidecar.issue.<kind>`), and the interpolation params that key expects. */
export interface SidecarIssue {
  kind: SidecarIssueKind
  key: string
  params: Record<string, unknown>
}

/**
 * A demo's sidecar as read: no file at all, a fully valid file, or a file that had at least one
 * problem - `issues` names each one, and reading never drops the whole file over a single bad
 * field (whatever validated successfully is still usable elsewhere).
 */
export type SidecarState =
  { state: 'none' } | { state: 'ok' } | { state: 'error'; issues: SidecarIssue[] }

/**
 * Story 147: what `sidecar.write` answers. `saved` is the story-146 outcome. `needsConfirmation`
 * means a broken sidecar is on disk and nothing was touched: `fingerprint` is the SHA-256 hex of
 * that file's bytes as just read, and only a retry passing it as `confirmReplace` - while the file
 * still has exactly those bytes - replaces (or, for an all-empty save, deletes) it.
 */
export type SidecarSaveResult =
  | { status: 'saved'; state: 'written' | 'deleted' | 'unchanged' }
  | { status: 'needsConfirmation'; fileName: string; issues: SidecarIssue[]; fingerprint: string }
