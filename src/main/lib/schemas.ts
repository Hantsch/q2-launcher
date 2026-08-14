import { z } from 'zod'
import type { Installation, LauncherSettings, WindowState } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import {
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_DEFAULT_WIDTH,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
} from '@shared/constants'

/**
 * Runtime validation for everything that crosses a trust boundary: the state
 * file on disk (which a user may have hand-edited) and every IPC payload from
 * the renderer.
 *
 * Persisted schemas are deliberately forgiving - `.catch()` on each field means
 * one bad value degrades to its default instead of wiping the whole file. The
 * only strictly required fields are the ones without which a record is
 * meaningless (`id`, `rootPath`); rows missing those are dropped individually.
 */

const nowIso = (): string => new Date().toISOString()

const paramsSchema = z.record(z.string(), z.union([z.string(), z.number()]))

export const engineKindSchema = z.enum([
  'r1q2',
  'q2pro',
  'yquake2',
  'kmquake2',
  'vkquake2',
  'q2rtx',
  'vanilla',
  'remaster',
  'custom',
  'unknown',
])

const sourceSchema = z.enum([
  'manual',
  'steam',
  'gog',
  'epic',
  'bethesda',
  'retail',
  'created',
  'unknown',
])

const statusSchema = z.enum(['ok', 'warning', 'invalid', 'missing', 'unknown'])

const checkSchema = z.object({
  id: z.enum([
    'root-exists',
    'base-game-dir',
    'base-paks',
    'executable',
    'engine-identified',
    'write-access',
  ]),
  severity: z.enum(['ok', 'warn', 'error']),
  messageKey: z.string(),
  params: paramsSchema.optional(),
  fix: z
    .enum(['locate-root', 'select-executable', 'set-write-dir', 'revalidate', 'install-game-files'])
    .optional(),
})

const installationSchema = z.object({
  id: z.string().min(1),
  rootPath: z.string().min(1),
  name: z.string().min(1).catch('Quake II'),
  writeDirPath: z.string().optional(),
  engineKind: engineKindSchema.catch('unknown'),
  executablePath: z.string().optional(),
  launchArgs: z.array(z.string()).catch([]),
  activeGameDir: z.string().catch(''),
  detectedVersion: z.string().optional(),
  source: sourceSchema.catch('unknown'),
  // Health is re-derived on startup, so a stale value here is harmless.
  status: statusSchema.catch('unknown'),
  checks: z.array(checkSchema).catch([]),
  gameDirs: z.array(z.string()).catch([]),
  favorite: z.boolean().catch(false),
  sortOrder: z.number().finite().catch(0),
  createdAt: z.string().catch(nowIso),
  updatedAt: z.string().catch(nowIso),
  lastValidatedAt: z.string().optional(),
  lastPlayedAt: z.string().optional(),
  totalPlaytimeSeconds: z.number().finite().nonnegative().catch(0),
  moduleData: z.record(z.string(), z.unknown()).optional(),
})

const settingsObjectSchema = z.object({
  locale: z.enum(['system', 'en']).catch(DEFAULT_SETTINGS.locale),
  motion: z.enum(['system', 'reduced', 'full']).catch(DEFAULT_SETTINGS.motion),
  activeInstallationId: z.string().nullable().catch(null),
  lastRoute: z.string().catch(DEFAULT_SETTINGS.lastRoute),
  minimizeOnLaunch: z.boolean().catch(DEFAULT_SETTINGS.minimizeOnLaunch),
  closeAfterLaunch: z.boolean().catch(DEFAULT_SETTINGS.closeAfterLaunch),
  confirmBeforeRemoving: z.boolean().catch(DEFAULT_SETTINGS.confirmBeforeRemoving),
  scanOnFirstRun: z.boolean().catch(DEFAULT_SETTINGS.scanOnFirstRun),
  deepScanDrives: z.array(z.string()).catch([]),
})

export const settingsSchema = settingsObjectSchema.catch(() => ({ ...DEFAULT_SETTINGS }))

export const windowStateSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().min(WINDOW_MIN_WIDTH).catch(WINDOW_DEFAULT_WIDTH),
    height: z.number().finite().min(WINDOW_MIN_HEIGHT).catch(WINDOW_DEFAULT_HEIGHT),
    maximized: z.boolean().catch(false),
    fullScreen: z.boolean().catch(false),
  })
  .catch(() => ({
    width: WINDOW_DEFAULT_WIDTH,
    height: WINDOW_DEFAULT_HEIGHT,
    maximized: false,
    fullScreen: false,
  }))

/** Return types are annotated so the schemas must stay in sync with the domain types. */
export function parseSettings(raw: unknown): LauncherSettings {
  return settingsSchema.parse(raw)
}

export function parseWindowState(raw: unknown): WindowState {
  return windowStateSchema.parse(raw)
}

/** Parses one installation, returning null (and dropping just that row) on failure. */
export function parseInstallation(raw: unknown): Installation | null {
  const result = installationSchema.safeParse(raw)
  return result.success ? result.data : null
}

export function parseInstallations(raw: unknown): Installation[] {
  const rows = z.array(z.unknown()).catch([]).parse(raw)
  return rows.map(parseInstallation).filter((row): row is Installation => row !== null)
}

// ---------------------------------------------------------------------------
// IPC payloads. These are strict: a bad payload is a bug, not a state to repair.
// ---------------------------------------------------------------------------

/** Rejects empty strings and relative paths before anything touches the filesystem. */
const absolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\0'), 'path must not contain NUL')

export const addExistingInputSchema = z.object({
  rootPath: absolutePathSchema,
  name: z.string().min(1).max(120).optional(),
  executablePath: absolutePathSchema.optional(),
  source: sourceSchema.optional(),
})

export const createInstallationInputSchema = z.object({
  rootPath: absolutePathSchema,
  name: z.string().min(1).max(120),
  engineKind: engineKindSchema,
})

export const updateInstallationInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  rootPath: absolutePathSchema.optional(),
  executablePath: absolutePathSchema.optional(),
  writeDirPath: absolutePathSchema.nullable().optional(),
  launchArgs: z.array(z.string().max(500)).max(64).optional(),
  activeGameDir: z
    .string()
    .max(64)
    // A game dir is a single folder name, never a path - this blocks traversal.
    .refine((value) => value === '' || /^[A-Za-z0-9_.-]+$/.test(value), 'invalid game directory')
    .optional(),
  favorite: z.boolean().optional(),
})

export const removeInstallationInputSchema = z.object({
  id: z.string().min(1),
  deleteFromDisk: z.boolean().optional(),
})

export const scanOptionsSchema = z.object({
  scanId: z.string().min(1).max(64).optional(),
  deepScan: z.boolean().optional(),
  drives: z.array(z.string().min(1)).max(32).optional(),
})

export const launchInputSchema = z.object({
  installationId: z.string().min(1),
  gameDir: z.string().max(64).optional(),
  connect: z.string().max(200).optional(),
  extraArgs: z.array(z.string().max(500)).max(64).optional(),
})

export const pickPathInputSchema = z.object({
  title: z.string().max(200),
  buttonLabel: z.string().max(80).optional(),
  defaultPath: z.string().optional(),
})

export const settingsPatchSchema = settingsObjectSchema.partial()

export const moduleInvokeSchema = z.object({
  moduleId: z.enum(['library', 'config', 'install', 'mods', 'assets']),
  type: z.string().min(1).max(80),
  payload: z.unknown().optional(),
})

export const idListSchema = z.array(z.string().min(1)).max(500)
export const pathListSchema = z.array(absolutePathSchema).max(200)
export const idSchema = z.string().min(1)
export const nullableIdSchema = z.string().min(1).nullable()
export const urlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'only http(s) URLs may be opened')
