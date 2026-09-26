import { z } from 'zod'
import { parseUserinfoValue } from './launch/userinfo'
import { parseServerAddress } from './servers/address'
import { DEFAULT_SETTINGS } from './types'

/**
 * Shared zod primitives used by both the persisted-state schemas
 * (`src/main/lib/schemas.ts`) and the IPC-payload schemas
 * (`src/shared/ipc-schemas.ts`).
 *
 * This file must stay free of `node:*`/`electron` imports, same as the rest
 * of `src/shared` - it is compiled into both TS projects.
 */

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

export const sourceSchema = z.enum([
  'manual',
  'steam',
  'gog',
  'epic',
  'bethesda',
  'retail',
  'created',
  'unknown',
])

/** Rejects empty strings and relative paths before anything touches the filesystem. */
export const absolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\0'), 'path must not contain NUL')

/** Strict `host:port` validation via `parseServerAddress`; rejects with the reason code (not
 * prose) as the issue message, and transforms a valid address into its normalized string. */
export const serverAddressSchema = z.string().superRefine((value, ctx) => {
  const result = parseServerAddress(value)
  if (!result.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason })
  }
}).transform((value) => {
  const result = parseServerAddress(value)
  return result.ok ? result.normalized : value
})

/** Strict validation via `parseUserinfoValue`; rejects with the reason code (not prose) as the
 * issue message, same convention as `serverAddressSchema`. */
export const launchUserinfoValueSchema = z.string().superRefine((value, ctx) => {
  const result = parseUserinfoValue(value)
  if (!result.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason })
  }
})

export const settingsObjectSchema = z.object({
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
