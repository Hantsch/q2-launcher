import { z } from 'zod'
import { VALUE_SOURCES } from '../demos/effective-values'
import { demoUnreadableSchema } from '../demos/readability'
import { demoListFilterSchema, type DemoListFilter } from '../replays/list-filter'
import { DEMO_SORT_COLUMNS, type DemoListSort } from '../replays/list-sort'
import type { NameFacts } from '../replays/name-template'
import type { NameTemplatesView } from '../replays/name-templates'
import { sidecarFieldsSchema, type SidecarFields } from '../replays/sidecar'
import { timelineActionSchema } from '../replays/timeline'
import { absolutePathSchema } from '../schemas'
import type { CinemaAvailability } from '../replays/cinema'
import type { DomainResult } from '../types'

/** The replays module's contract. */
export const REPLAYS_HANDLERS = {
  /** Resolves to the current `ReplaysOverview` - cache-first, no network of its own. */
  overviewRead: 'overview.read',
  /** Resolves to the current `NameTemplatesView`. */
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
  /** Resolves to the current user-added extra demo folder list. */
  extraFoldersList: 'extraFolders.list',
  /** Adds a user-picked extra demo folder; refuses on an invalid/unresolvable/duplicate path. */
  extraFoldersAdd: 'extraFolders.add',
  /** Removes an extra demo folder by id; an unknown id is a no-op. */
  extraFoldersRemove: 'extraFolders.remove',
  /** Starts a background index scan; resolves to `ReplaysScanStartResult` at once. */
  scanStart: 'scan.start',
  /**
   * Resolves to the current index: the cached rows until this process's first scan finishes,
   * the last successful scan's rows after that.
   */
  indexRead: 'index.read',
  /** Resolves to the current sidecar for a demo id, or `{ state: 'none' }` if it has none. */
  sidecarRead: 'sidecar.read',
  /** Full-replacement save of a demo's sidecar fields, id-addressed. */
  sidecarWrite: 'sidecar.write',
  /** The persisted list-sort handlers, mirroring `SERVERS_HANDLERS.listGetSort`/ `listSetSort`. */
  listGetSort: 'list.getSort',
  listSetSort: 'list.setSort',
  /**
   * The persisted list-filter handlers, mirroring `listGetSort`/`listSetSort` right above
   * exactly.
   */
  listGetFilter: 'listFilter.read',
  listSetFilter: 'listFilter.write',
  /** The missing-mod warning's persisted state. */
  modWarningRead: 'modWarning.read',
  modWarningSetEnabled: 'modWarning.setEnabled',
  modWarningTrustMod: 'modWarning.trustMod',
  modWarningResetTrusted: 'modWarning.resetTrusted',
  /** Reveals a demo's file in the OS file manager, resolved from its id in main. */
  demosReveal: 'demos.reveal',
  /** Copies a demo's resolved absolute path to the clipboard. */
  demosCopyPath: 'demos.copyPath',
  /** Renames a demo (and its sidecar, if any) to a new stem, id-addressed. */
  demoRename: 'demo.rename',
  /** Plays a demo in Q2PRO (`+demo <file>`), id-addressed. */
  demoPlay: 'demo.play',
  /** Steers the running demo (pause, jump, seek, speed). */
  playbackTimeline: 'playback.timeline',
  /** Sends one user-typed console line to the running demo. */
  playbackConsoleSend: 'playback.consoleSend',
  /** Re-places the running demo's window over the launcher's stage rect. */
  playbackStage: 'playback.stage',
  /**
   * Ends the running demo - asks the game to `quit`, and terminates it if it has not exited
   * within main's timeout (or at once when the quit is refused).
   */
  playbackStop: 'playback.stop',
  /** Enters (`{ enter: true }`) or leaves cinema mode for the running demo. */
  playbackCinema: 'playback.cinema',
  /** The current `ReplaysPlaybackDisplay` (what the last `playback.display` push said). */
  playbackDisplayRead: 'playback.display.read',
} as const

/**
 * Main -> renderer pushes of this module, delivered through the module event channel (same
 * convention as `SERVERS_EVENTS`/`HOME_EVENTS`).
 */
export const REPLAYS_EVENTS = {
  /**
   * A `ReplaysScanProgress` - pushed when a scan starts, as it advances, and once when it ends
   * (`running: false`, success or failure alike).
   */
  scanProgress: 'scan.progress',
  /** A `ReplaysPlaybackPosition` - pushed every 250 ms while a demo plays. */
  playbackPosition: 'playback.position',
  /** A `ReplaysPlaybackState` - `playing` on attach, `finished` when the demo ends, `ended`. */
  playbackState: 'playback.state',
  /** A `ReplaysPlaybackDisplay` - pushed when the demo goes fullscreen or comes back. */
  playbackDisplay: 'playback.display',
} as const

export interface ReplaysPlaybackPosition {
  positionMs: number | null
  durationMs: number | null
  /** The engine's own pause state; null when it did not report one (the view then infers it). */
  paused: boolean | null
}

/**
 * How the running demo is shown. `speed` is held in main (the last accepted `speed` timeline
 * action, 1 at session start); `cinemaAvailability` follows the main window.
 */
export interface ReplaysPlaybackDisplay {
  fullscreen: boolean
  cinema: boolean
  speed: number
  cinemaAvailability: CinemaAvailability
  /** Why the staged game could not be kept on top (an i18n key), or null. */
  stageNotice: { key: string } | null
}

export interface ReplaysPlaybackState {
  state: 'playing' | 'finished' | 'ended'
}

/**
 * `overview.read` takes no payload - same `z.void()` convention as `serversNoInputSchema` in
 * `servers.ts`.
 */
export const replaysNoInputSchema = z.void()

/**
 * What `overview.read` resolves to: whether a demo scan is currently in progress and how many demos
 * are known so far.
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
 * grow unbounded, printable ASCII only.
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

/**
 * Every reason a demo row can fail to parse: the shared header parsers' reasons (kept in sync by
 * hand with Dm2Unparsable/Mvd2Unparsable) plus the zip-entry-only codes (story 143)
 */
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
 * resolve it back to a real file by id.
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

/**
 * A file's on-disk creation/modification stamps, as `fs.stat` reports them (milliseconds since
 * epoch).
 */
export const fileTimeSchema = z.object({
  birthtimeMs: z.number().finite(),
  mtimeMs: z.number().finite(),
})
export type DemoFileTime = z.infer<typeof fileTimeSchema>

/**
 * File-name-template match facts (`NameFacts`, `src/shared/replays/name-template.ts`), mirrored as
 * a zod schema so an index entry can carry them across IPC (story 139)
 */
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

/** A demo main found during a scan. */
export const discoveredDemoSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  fileName: z.string().min(1),
  format: demoFormatSchema,
  gzip: z.boolean(),
  source: demoSourceSchema,
  /** Non-null when this row came from an entry inside a zip; null for a loose file. */
  archiveEntry: z
    .object({ archivePath: z.string().min(1), entryPath: z.string().min(1) })
    .nullable(),
  /** The map name parsed from the demo's own header, or null when unparsable/not yet parsed. */
  map: z.string().nullable(),
  /** Why the header couldn't be parsed, or null for a parseable row. */
  unparsableReason: demoUnparsableReasonSchema.nullable(),
  /** Whether this row's header parsed at all. */
  readable: z.boolean(),
  /** Mirrors `readable`: null for a readable row, the structured reason. */
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
  /**
   * Name-template match facts for this file's name, or null when no template matched (story 139)
   */
  nameFacts: nameFactsSchema.nullable(),
})

export type DemoFormat = z.infer<typeof demoFormatSchema>
export type DemoSource = z.infer<typeof demoSourceSchema>
export type DiscoveredDemo = z.infer<typeof discoveredDemoSchema>

/** The scan-progress key of one `DemoSource` - one key per distinct source. */
export function demoSourceKey(source: DemoSource): string {
  return source.kind === 'installation'
    ? `installation:${source.installationId}:${source.gameDir}`
    : `extraFolder:${source.path}`
}

/** `scan.start`'s result: `started: false` means a scan was already running (single-flight) -
 * nothing new was kicked off. */
export const replaysScanStartResultSchema = z.object({ started: z.boolean() })
export type ReplaysScanStartResult = z.infer<typeof replaysScanStartResultSchema>

/** Every distinct way one discovery source can fail to contribute what it should. */
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
 * failure is one zip within that source rather than the source's folder itself.
 */
export const replaysSourceErrorSchema = z.object({
  source: demoSourceSchema,
  archiveName: z.string().min(1).nullable(),
  reason: replaysSourceErrorReasonSchema,
})
export type ReplaysSourceError = z.infer<typeof replaysSourceErrorSchema>

/**
 * A single effective field, mirroring `Effective<T>` (`src/shared/demos/effective-values.ts`) -
 * either a value plus the rung it came from, or both null when no rung had one.
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
 * `index.read`'s real row shape - a discovered demo plus its sidecar (state and whatever fields
 * validated) and its resolved effective values, composed in main.
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

/**
 * `scan.progress`'s payload: per-source `scanned` / `total` counts, keyed by `demoSourceKey`, plus
 * this scan's source errors so far.
 */
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
 * `MasterSourcesResult` uses in `servers.ts`.
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

/**
 * A demo id (`discoveredDemoSchema.id`'s standalone counterpart): looser than the content-derived
 * hex fingerprint on purpose, so a `sidecar.*` payload naming an id the index no longer knows about
 * still reaches the handler as an ordinary "unknown id" outcome rather than a schema rejection.
 */
export const replaysDemoIdSchema = z.string().min(1).max(512)

/** `sidecar.read`'s payload: the demo id to look up. */
export const replaysSidecarReadSchema = z.object({ demoId: replaysDemoIdSchema })

/** `demos.reveal`/`demos.copyPath`'s payload: the demo id to resolve - never a path. */
export const replaysDemoFileActionSchema = z.object({ demoId: replaysDemoIdSchema }).strict()

/** `demos.reveal`/`demos.copyPath`'s result: the path itself never crosses IPC, only whether the
 * action ran and, on refusal, why - mirrors `ExtraFoldersResult`'s ok/refusal union shape above. */
export type DemoFileActionResult = DomainResult<
  Record<never, never>,
  'replays.play.error.notFound' | 'replays.play.error.fileMissing'
>

/**
 * `demo.rename`'s payload: the demo id plus the new name STEM - never a path; main validates the
 * stem itself (`validateDemoRename`) and resolves the id to the real file.
 */
export const replaysDemoRenameSchema = z
  .object({ id: replaysDemoIdSchema, name: z.string().max(255) })
  .strict()

/**
 * `playback.consoleSend`'s payload: one free console line. The loose 1024 cap only bounds the
 * payload; main's `validateConsoleLine` is the authority (printable, one line, 255).
 */
export const replaysConsoleSendSchema = z.object({ line: z.string().max(1024) }).strict()

/**
 * The launcher's stage as a rect in CSS pixels of the renderer's content area - integers only,
 * origin non-negative, size 1-16384. `.strict()` so an extra key is refused.
 */
export const replaysStageRectSchema = z
  .object({
    x: z.number().int().min(0).max(16384),
    y: z.number().int().min(0).max(16384),
    width: z.number().int().min(1).max(16384),
    height: z.number().int().min(1).max(16384),
  })
  .strict()
export type ReplaysStageRect = z.infer<typeof replaysStageRectSchema>

/** `playback.stage`'s payload - where the stage is now, or `null` when there is none. */
export const replaysPlaybackStageSchema = z
  .object({ rect: replaysStageRectSchema.nullable() })
  .strict()
export type ReplaysPlaybackStagePayload = z.infer<typeof replaysPlaybackStageSchema>

/** `playback.cinema`'s payload - enter (`true`) or leave (`false`) cinema mode. */
export const replaysPlaybackCinemaSchema = z.object({ enter: z.boolean() }).strict()
export type ReplaysPlaybackCinemaPayload = z.infer<typeof replaysPlaybackCinemaSchema>

/** `playback.display.read` takes an empty object. */
export const replaysPlaybackDisplayReadSchema = z.object({}).strict()

/** What `demo.play` reports about the stage - `null` when no rect was sent. */
export type ReplaysStageResult = DomainResult<Record<never, never>>
export interface ReplaysDemoPlayResult {
  stage: ReplaysStageResult | null
}

/**
 * `demo.play`'s payload: the demo id plus the installation the renderer believes it is playing in -
 * never a path.
 */
export const replaysDemoPlaySchema = z
  .object({
    demoId: replaysDemoIdSchema,
    installationId: z.string().min(1).max(512),
    /** The user confirmed the "mod not fully installed" warning; main re-checks everything else. */
    acknowledgeModMissing: z.boolean().optional(),
    /** Where the launcher's stage is; absent, the game opens in its own window. */
    stage: replaysStageRectSchema.optional(),
  })
  .strict()

/**
 * `sidecar.write`'s payload: the demo id plus the full replacement set of sidecar fields, and -
 * only when replacing a broken sidecar the user has confirmed.
 */
export const replaysSidecarWriteSchema = z
  .object({
    demoId: replaysDemoIdSchema,
    fields: sidecarFieldsSchema,
    confirmReplace: z.string().optional(),
  })
  .strict()

/**
 * The persisted/IPC shape of a `DemoListSort` - `.strict()` so a payload carrying an unknown key is
 * rejected outright, same convention as `serverListSortSchema` (`servers.ts`).
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

/** The missing-mod warning state as seen by the renderer. */
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

/** Every `replays` handler paired with its payload schema. */
export const REPLAYS_HANDLER_SCHEMAS = {
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
} satisfies Record<(typeof REPLAYS_HANDLERS)[keyof typeof REPLAYS_HANDLERS], z.ZodTypeAny>

/** Handlers whose payload is allowed to carry a filesystem path/dir/folder/file value. */
export const REPLAYS_PATH_PAYLOAD_HANDLERS: readonly string[] = ['extraFolders.add']

/**
 * One user-added extra demo folder - a filesystem path the user picked via a native folder-picker
 * dialog.
 */
export interface ReplaysExtraFolder {
  id: string
  path: string
  addedAt: string
}

/** One persisted extra-folder row, as it would be read back out of `state.json`. */
export const storedExtraFolderSchema = z.object({
  id: z.string().min(1),
  path: absolutePathSchema,
  addedAt: z.string(),
})

/**
 * Handlers that may create, change or delete a sidecar file - the only ones no-write guard
 * test exempts from "must never write a sidecar".
 */
export const REPLAYS_SIDECAR_WRITING_HANDLERS: readonly string[] = ['sidecar.write']

/**
 * Every distinct way a sidecar read can go wrong, one per i18n key under
 * `replays.sidecar.issue.<kind>`.
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
 * problem.
 */
export type SidecarState =
  { state: 'none' } | { state: 'ok' } | { state: 'error'; issues: SidecarIssue[] }

/** What `sidecar.write` answers. `saved` is the persisted outcome (story 146) */
export type SidecarSaveResult =
  | { status: 'saved'; state: 'written' | 'deleted' | 'unchanged' }
  | { status: 'needsConfirmation'; fileName: string; issues: SidecarIssue[]; fingerprint: string }

type ReplaysSchemas = typeof REPLAYS_HANDLER_SCHEMAS

/** One handler's contract entry; `req` is the schema's parsed output. */
type ReplaysHandler<K extends keyof ReplaysSchemas, Res> = {
  req: z.infer<ReplaysSchemas[K]>
  res: Res
}

/** The replays module's typed contract. */
export type ReplaysContract = {
  handlers: {
    [REPLAYS_HANDLERS.overviewRead]: ReplaysHandler<'overview.read', ReplaysOverview>
    [REPLAYS_HANDLERS.nameTemplatesList]: ReplaysHandler<'nameTemplates.list', NameTemplatesView>
    [REPLAYS_HANDLERS.nameTemplatesAdd]: ReplaysHandler<'nameTemplates.add', NameTemplatesView>
    [REPLAYS_HANDLERS.nameTemplatesUpdate]: ReplaysHandler<
      'nameTemplates.update',
      NameTemplatesView
    >
    [REPLAYS_HANDLERS.nameTemplatesRemove]: ReplaysHandler<
      'nameTemplates.remove',
      NameTemplatesView
    >
    [REPLAYS_HANDLERS.nameTemplatesReorder]: ReplaysHandler<
      'nameTemplates.reorder',
      NameTemplatesView
    >
    [REPLAYS_HANDLERS.nameTemplatesReset]: ReplaysHandler<'nameTemplates.reset', NameTemplatesView>
    [REPLAYS_HANDLERS.nameTemplatesRestore]: ReplaysHandler<
      'nameTemplates.restore',
      NameTemplatesView
    >
    [REPLAYS_HANDLERS.extraFoldersList]: ReplaysHandler<'extraFolders.list', ReplaysExtraFolder[]>
    [REPLAYS_HANDLERS.extraFoldersAdd]: ReplaysHandler<'extraFolders.add', ExtraFoldersResult>
    [REPLAYS_HANDLERS.extraFoldersRemove]: ReplaysHandler<'extraFolders.remove', ExtraFoldersResult>
    [REPLAYS_HANDLERS.scanStart]: ReplaysHandler<'scan.start', ReplaysScanStartResult>
    [REPLAYS_HANDLERS.indexRead]: ReplaysHandler<'index.read', DemoRow[]>
    [REPLAYS_HANDLERS.sidecarRead]: ReplaysHandler<
      'sidecar.read',
      { state: SidecarState; values: Partial<SidecarFields> }
    >
    [REPLAYS_HANDLERS.sidecarWrite]: ReplaysHandler<'sidecar.write', SidecarSaveResult>
    [REPLAYS_HANDLERS.listGetSort]: ReplaysHandler<'list.getSort', DemoListSort | null>
    [REPLAYS_HANDLERS.listSetSort]: ReplaysHandler<'list.setSort', DemoListSort | null>
    [REPLAYS_HANDLERS.listGetFilter]: ReplaysHandler<'listFilter.read', DemoListFilter>
    [REPLAYS_HANDLERS.listSetFilter]: ReplaysHandler<'listFilter.write', DemoListFilter>
    [REPLAYS_HANDLERS.modWarningRead]: ReplaysHandler<'modWarning.read', ReplaysModWarning>
    [REPLAYS_HANDLERS.modWarningSetEnabled]: ReplaysHandler<
      'modWarning.setEnabled',
      ReplaysModWarning
    >
    [REPLAYS_HANDLERS.modWarningTrustMod]: ReplaysHandler<'modWarning.trustMod', ReplaysModWarning>
    [REPLAYS_HANDLERS.modWarningResetTrusted]: ReplaysHandler<
      'modWarning.resetTrusted',
      ReplaysModWarning
    >
    [REPLAYS_HANDLERS.demosReveal]: ReplaysHandler<'demos.reveal', DemoFileActionResult>
    [REPLAYS_HANDLERS.demosCopyPath]: ReplaysHandler<'demos.copyPath', DemoFileActionResult>
    [REPLAYS_HANDLERS.demoRename]: ReplaysHandler<'demo.rename', { demo: DiscoveredDemo }>
    [REPLAYS_HANDLERS.demoPlay]: ReplaysHandler<'demo.play', ReplaysDemoPlayResult>
    [REPLAYS_HANDLERS.playbackTimeline]: ReplaysHandler<'playback.timeline', void>
    [REPLAYS_HANDLERS.playbackConsoleSend]: ReplaysHandler<'playback.consoleSend', void>
    [REPLAYS_HANDLERS.playbackStage]: ReplaysHandler<'playback.stage', void>
    [REPLAYS_HANDLERS.playbackStop]: ReplaysHandler<'playback.stop', void>
    [REPLAYS_HANDLERS.playbackCinema]: ReplaysHandler<'playback.cinema', void>
    [REPLAYS_HANDLERS.playbackDisplayRead]: ReplaysHandler<
      'playback.display.read',
      ReplaysPlaybackDisplay
    >
  }
  events: {
    [REPLAYS_EVENTS.scanProgress]: ReplaysScanProgress
    [REPLAYS_EVENTS.playbackPosition]: ReplaysPlaybackPosition
    [REPLAYS_EVENTS.playbackState]: ReplaysPlaybackState
    [REPLAYS_EVENTS.playbackDisplay]: ReplaysPlaybackDisplay
  }
}
