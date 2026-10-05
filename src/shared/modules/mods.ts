import { z } from 'zod'
import type { EngineKind } from '../types/engine'
import { isSafeGameName } from '../mods/server-local-content'

/**
 * The mods module's contract.
 *
 * Main implements the handlers, the renderer gets a typed client, and this file
 * is the only thing they share. The renderer never sends a path: it names an
 * installation and a game directory, main resolves the folder.
 */
export const MODS_HANDLERS = {
  list: 'list',
  reveal: 'reveal',
  catalogGet: 'catalog.get',
  /** Story 190: start installing one catalog mod. Resolves to `Outcome<{ jobId }>` once the job exists. */
  install: 'install',
  /** Story 190: answers a pending `installDecision`. Resolves to `Outcome<null>`. */
  resolveInstall: 'install.resolve',
  /** Story 191: what removing a mod would touch. Resolves to `Outcome<ModRemovalPreview>`; deletes nothing. */
  removalPreview: 'removal.preview',
  /** Story 191: start removing a mod the launcher installed. Resolves to `Outcome<{ jobId }>`. */
  remove: 'remove',
  /** Story 192: does the installation have a server's map? Resolves to `Outcome<ModMapPresence>`. */
  mapPresence: 'map.presence',
  /** Story 249: the maps a mod (plus baseq2) offers. Resolves to `Outcome<ModMapList>`. */
  mapsList: 'maps.list',
  /** Story 249: the installation's remembered launch choice. Resolves to `Outcome<ModLastLaunch | null>`. */
  lastLaunchGet: 'launch.last.get',
  /** Story 249: remembers the installation's launch choice. Resolves to `Outcome<null>`. */
  lastLaunchRemember: 'launch.last.remember',
  /** Story 194: what updating a mod would touch. Resolves to `Outcome<ModUpdatePreview>`; writes nothing. */
  updatePreview: 'update.preview',
  /** Story 194: start updating a catalog mod to its pinned version. Resolves to `Outcome<{ jobId }>`. */
  update: 'update',
} as const

/** What `updatePreview` answers: names and versions for the confirm dialog and the recorded files the user changed. */
export interface ModUpdatePreview {
  installationName: string
  modName: string
  gameDir: string
  installedVersion: string
  targetVersion: string
  /** Gamedir-relative paths of recorded files whose bytes differ from what the launcher installed. */
  changedFiles: string[]
}

/** What happens to a recorded file the user changed since it was installed. */
export type ModUpdateChangedPolicy = 'overwrite' | 'keep'

/** What `mapPresence` answers: whether `maps/<map>.bsp` exists loose, in a pak or in a pkz. */
export interface ModMapPresence {
  available: boolean
}

/** What `mapsList` answers: map names (no `.bsp`), each with its BSP title when one could be read. */
export interface ModMapList {
  maps: Array<{ name: string; title?: string }>
}

/** What `removalPreview` answers: names for the confirm dialog and the recorded files the user changed. */
export interface ModRemovalPreview {
  installationName: string
  modName: string
  gameDir: string
  /** Gamedir-relative paths of recorded files whose bytes differ from what the launcher installed. */
  changedFiles: string[]
}

export type ModRemoveChangedFiles = 'delete' | 'keep'

/** Story 190: main -> renderer pushes of this module, delivered through the module event channel. */
export const MODS_EVENTS = {
  /** A `ModInstallDecisionEvent` - an install met a folder it did not create and waits for a choice. */
  installDecision: 'install.decision',
} as const

export type ModInstallChoice = 'overwrite' | 'keep' | 'cancel'

export interface ModInstallDecisionEvent {
  jobId: string
  installationId: string
  catalogId: string
  /** The existing folder's own name. */
  folder: string
  /** Gamedir-relative paths of existing files whose bytes differ. May be empty. */
  conflicts: string[]
}

export interface ModActiveInstall {
  catalogId: string
  jobId: string
  /** Present while the install waits for the user's choice. */
  decision?: { folder: string; conflicts: string[] }
}

/** `catalog` = the launcher installed it (an install record exists); `manual` = anything else. */
export type ModGameDirOrigin = 'manual' | 'catalog'

export interface ModGameDir {
  /** The game directory's folder name, e.g. `rogue`. Never `baseq2`. */
  gameDir: string
  /** Absolute folder under the installation root. */
  folderPath: string
  origin: ModGameDirOrigin
  /** From the install record; present only when the launcher has a parsable record for it. */
  catalogId?: string
  version?: string
  contentOnly?: boolean
  engineKind?: EngineKind
  arch?: 'x86' | 'x64' | 'arm64' | 'unknown'
  pkzUnsupported?: boolean
  /**
   * Story 194: `update-available` when the catalog's pinned version differs from the recorded one (a
   * catalog install only). Replaces plain "installed"; `contentOnly` stays so the renderer can still
   * show the content-only reason.
   */
  status?: 'update-available'
  installedVersion?: string
  pinnedVersion?: string
}

export interface ModsListResult {
  installationId: string
  gameDirs: ModGameDir[]
  /** Installs running right now for this installation. */
  activeInstalls: ModActiveInstall[]
}

/** One selectable version of a catalog mod, as the renderer sees it (no packages, no URLs). */
export interface ModCatalogVersion {
  version: string
  prerelease: boolean
}

/** One catalog mod, projected for the wire: variants and packages stay in main. */
export interface ModCatalogEntry {
  id: string
  gamedir: string
  name: string
  description: string
  license: string
  projectUrl: string
  sourceUrl: string
  /** The `version` selected by default; always one of `versions`. */
  pinned: string
  versions: ModCatalogVersion[]
}

export type ModCatalogState =
  | {
      status: 'ok'
      entries: ModCatalogEntry[]
      fetchedAt: string
      fromCache: boolean
      ageMs: number
    }
  | { status: 'unavailable' }

/** One file a mod install wrote, recorded for later verify/uninstall. */
export interface ModInstallFile {
  /** Relative to the game directory, forward slashes. */
  path: string
  sizeBytes: number
  sha256: string
}

/** The launcher's record of one catalog mod install (`moduleData.mods.records[]`). */
export interface ModInstallRecord {
  catalogId: string
  /** The game directory's folder name, e.g. `rogue`. */
  gameDir: string
  version: string
  variantId: string
  engineKind: EngineKind
  arch: 'x86' | 'x64' | 'arm64' | 'unknown'
  platform: 'win32' | 'linux'
  /** True when the mod is content only (no native game library written). */
  contentOnly: boolean
  /** True when an r1q2-family engine got a `.pkz` file it cannot read. */
  pkzUnsupported?: boolean
  /** Epoch ms. */
  installedAt: number
  files: ModInstallFile[]
}

/** Every `mods.error.*` key the mods module sends across IPC or reports on a job - closed, so each one resolves in the locale. */
export const MODS_ERROR_KEYS = [
  'mods.error.installationNotFound',
  'mods.error.gameDirNotFound',
  'mods.error.revealFailed',
  'mods.error.unknownMod',
  'mods.error.alreadyInstalled',
  'mods.error.noVariant',
  'mods.error.badPackage',
  'mods.error.writeFailed',
  'mods.error.noPendingDecision',
] as const

export type ModsErrorKey = (typeof MODS_ERROR_KEYS)[number]

// IPC payload validation for the mods module's handlers (strict, like the config module's).

export const listInputSchema = z.object({ installationId: z.string().min(1) })

export const catalogGetInputSchema = z.object({ refresh: z.boolean().optional() }).strict()
export const revealInputSchema = listInputSchema.extend({
  // A game dir is a single folder name, never a path - this blocks traversal
  // (same rule as `activeGameDir` in `src/shared/ipc-schemas.ts`).
  gameDir: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_.-]+$/, 'invalid game directory'),
})

/** Story 190: both ids are looked up in main (installation library, catalog); neither is a path. */
export const installInputSchema = z
  .object({
    installationId: z.string().min(1),
    catalogId: z.string().min(1).max(128),
    version: z.string().min(1).max(64).optional(),
  })
  .strict()

export const resolveInstallInputSchema = z
  .object({
    jobId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'invalid job id'),
    choice: z.enum(['overwrite', 'keep', 'cancel']),
  })
  .strict()

/** Story 191: the mod is named by its catalog id (the install record's key), never by a path. */
const modIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.-]+$/, 'invalid mod id')

export const removalPreviewInputSchema = z
  .object({ installationId: z.string().min(1), modId: modIdSchema })
  .strict()

/** Story 192: `gameDir` and `map` come from a game server - single safe names, never paths. */
const safeGameNameSchema = z.string().refine(isSafeGameName, 'invalid name')

export const mapPresenceInputSchema = z
  .object({
    installationId: z.string().min(1),
    gameDir: safeGameNameSchema.optional(),
    map: safeGameNameSchema,
  })
  .strict()

/** `gameDir` is `''` (baseq2 only) or a safe game name. */
export const mapsListInputSchema = z
  .object({
    installationId: z.string().min(1),
    gameDir: z.union([z.literal(''), safeGameNameSchema]),
  })
  .strict()

/**
 * A remembered launch choice (story 249): `gameDir` `''` is baseq2, `map` null is the game's own
 * start. Also the parser of the persisted copy, so a remembered value is held to the same names.
 */
export const modLastLaunchSchema = z.object({
  gameDir: z.union([z.literal(''), safeGameNameSchema]),
  map: safeGameNameSchema.nullable(),
  gameType: z.enum(['deathmatch', 'single']),
})

export type ModLastLaunch = z.infer<typeof modLastLaunchSchema>

export const lastLaunchGetInputSchema = z.object({ installationId: z.string().min(1) }).strict()

export const lastLaunchRememberInputSchema = modLastLaunchSchema
  .extend({ installationId: z.string().min(1) })
  .strict()

export const updatePreviewInputSchema = z
  .object({ installationId: z.string().min(1), catalogId: modIdSchema })
  .strict()

export const updateInputSchema = z
  .object({
    installationId: z.string().min(1),
    catalogId: modIdSchema,
    changedPolicy: z.enum(['overwrite', 'keep']),
  })
  .strict()

export const removeInputSchema = z
  .object({
    installationId: z.string().min(1),
    modId: modIdSchema,
    changedFiles: z.enum(['delete', 'keep']),
  })
  .strict()

/** Every `mods` handler paired with its payload schema. */
export const MODS_HANDLER_SCHEMAS = {
  [MODS_HANDLERS.list]: listInputSchema,
  [MODS_HANDLERS.reveal]: revealInputSchema,
  [MODS_HANDLERS.catalogGet]: catalogGetInputSchema,
  [MODS_HANDLERS.install]: installInputSchema,
  [MODS_HANDLERS.resolveInstall]: resolveInstallInputSchema,
  [MODS_HANDLERS.removalPreview]: removalPreviewInputSchema,
  [MODS_HANDLERS.remove]: removeInputSchema,
  [MODS_HANDLERS.mapPresence]: mapPresenceInputSchema,
  [MODS_HANDLERS.mapsList]: mapsListInputSchema,
  [MODS_HANDLERS.lastLaunchGet]: lastLaunchGetInputSchema,
  [MODS_HANDLERS.lastLaunchRemember]: lastLaunchRememberInputSchema,
  [MODS_HANDLERS.updatePreview]: updatePreviewInputSchema,
  [MODS_HANDLERS.update]: updateInputSchema,
} satisfies Record<(typeof MODS_HANDLERS)[keyof typeof MODS_HANDLERS], z.ZodTypeAny>

type ModsSchemas = typeof MODS_HANDLER_SCHEMAS

/** The mods module's typed contract; `req` is each schema's parsed output. */
export type ModsContract = {
  handlers: {
    [MODS_HANDLERS.list]: { req: z.infer<ModsSchemas['list']>; res: ModsListResult }
    [MODS_HANDLERS.reveal]: { req: z.infer<ModsSchemas['reveal']>; res: null }
    [MODS_HANDLERS.catalogGet]: { req: z.infer<ModsSchemas['catalog.get']>; res: ModCatalogState }
    [MODS_HANDLERS.install]: { req: z.infer<ModsSchemas['install']>; res: { jobId: string } }
    [MODS_HANDLERS.resolveInstall]: { req: z.infer<ModsSchemas['install.resolve']>; res: null }
    [MODS_HANDLERS.removalPreview]: {
      req: z.infer<ModsSchemas['removal.preview']>
      res: ModRemovalPreview
    }
    [MODS_HANDLERS.remove]: { req: z.infer<ModsSchemas['remove']>; res: { jobId: string } }
    [MODS_HANDLERS.mapPresence]: { req: z.infer<ModsSchemas['map.presence']>; res: ModMapPresence }
    [MODS_HANDLERS.mapsList]: { req: z.infer<ModsSchemas['maps.list']>; res: ModMapList }
    [MODS_HANDLERS.lastLaunchGet]: {
      req: z.infer<ModsSchemas['launch.last.get']>
      res: ModLastLaunch | null
    }
    [MODS_HANDLERS.lastLaunchRemember]: {
      req: z.infer<ModsSchemas['launch.last.remember']>
      res: null
    }
    [MODS_HANDLERS.updatePreview]: {
      req: z.infer<ModsSchemas['update.preview']>
      res: ModUpdatePreview
    }
    [MODS_HANDLERS.update]: { req: z.infer<ModsSchemas['update']>; res: { jobId: string } }
  }
  events: {
    [MODS_EVENTS.installDecision]: ModInstallDecisionEvent
  }
}
