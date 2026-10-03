import { z } from 'zod'
import { parseForgivingRows } from './forgiving'
import { engineKindSchema, settingsObjectSchema, sourceSchema } from '@shared/schemas'
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
  // Mirrors `CheckSeverity` (`@shared/types/installation`: `'ok' | 'info' | 'warn' | 'error'`) -
  // `'info'` was missing here, which silently discarded a persisted `ValidationCheck` array (the
  // whole array, via `.catch([])` below) on the very first load of any installation whose only
  // check was info-severity (e.g. `validation.pak0NotRetail`, the demo-data marker `inspector.ts`
  // has produced).
  severity: z.enum(['ok', 'info', 'warn', 'error']),
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
  // Additive and optional, same convention as `executablePath` right above and as
  // `icon`/`lastFailure` below - a record predating this field (or written on Windows, where the
  // header is never read) simply lacks the key, and a mangled value degrades to "kind not known"
  // rather than dropping the whole installation. No migration step: `migrations.ts`'s own rule is
  // that a new optional field needs none (story 103)
  executableKind: z.enum(['pe', 'elf', 'script', 'unknown']).optional().catch(undefined),
  // The user's runner choice, a `DetectedRunner.id` or `'native'`. Same additive,
  // forgiving convention as `executableKind` right above - a record predating this field simply
  // lacks the key, and a mangled value degrades to "never chosen" (the default cascade decides)
  // rather than dropping the whole installation. Deliberately an open string, not an enum: Proton
  // ids are derived from folder names at detection time, so no fixed list can be checked here
  // (story 103)
  runner: z.string().min(1).optional().catch(undefined),
  // The Steam appid recovered from disk layout, same additive/forgiving convention
  // as `executableKind` above - a record predating this field simply lacks the key, and a mangled
  // value degrades to "appid not known" rather than dropping the whole installation (story 104)
  steamAppId: z.string().optional().catch(undefined),
  // The user's chosen `STEAM_APP_CLIENTS` entry index. Same convention as
  // `steamAppId` right above - absent means "never chosen" (the table's own default decides)
  // (story 104)
  steamClient: z.number().optional().catch(undefined),
  launchArgs: z.array(z.string()).catch([]),
  activeGameDir: z.string().catch(''),
  detectedVersion: z.string().optional(),
  source: sourceSchema.catch('unknown'),
  // Health is re-derived on startup, so a stale value here is harmless.
  status: statusSchema.catch('unknown'),
  checks: z.array(checkSchema).catch([]),
  gameDirs: z.array(z.string()).catch([]),
  favorite: z.boolean().catch(false),
  // Additive and forgiving, same convention as `moduleData` below - a record
  // predating this field simply lacks the key, and a hand-mangled value degrades to "no icon set"
  // (the default fallback icon) rather than dropping the whole installation (story 067)
  icon: z
    .union([
      z.object({ kind: z.literal('shipped'), id: z.string().min(1) }),
      z.object({ kind: z.literal('custom') }),
    ])
    .optional()
    .catch(undefined),
  // The last bootstrap failure, same additive/forgiving convention as `icon` right
  // above - a record predating this field simply lacks the key, and a hand-mangled value degrades
  // to "no failure on record" (the default, playable-looking state) rather than dropping the whole
  // installation row (story 077)
  lastFailure: z
    .object({
      errorKey: z.string().min(1),
      at: z.number().finite(),
      jobId: z.string().min(1),
      // The interpolation values a templated `errorKey` needs. Forgiving one
      // level deeper than the field it sits in - a mangled `params` degrades to "no params" (the
      // sentence then renders with its placeholders unresolved, which is what an installation
      // written before this field already does) rather than taking the whole `lastFailure` with it.
      params: z
        .record(z.string(), z.union([z.string(), z.number().finite()]))
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
  sortOrder: z.number().finite().catch(0),
  createdAt: z.string().catch(nowIso),
  updatedAt: z.string().catch(nowIso),
  lastValidatedAt: z.string().optional(),
  lastPlayedAt: z.string().optional(),
  totalPlaytimeSeconds: z.number().finite().nonnegative().catch(0),
  moduleData: z.record(z.string(), z.unknown()).optional(),
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
  return parseForgivingRows(installationSchema, raw)
}

// IPC-payload schemas live in `src/shared/ipc-schemas.ts` -
// they are strict (a bad payload is a bug, not a state to repair) and shared
// needs them for the preload/renderer side too (story 036)
