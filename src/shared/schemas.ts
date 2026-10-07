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

/**
 * Accepts only: a drive letter followed by a separator (`C:\x`, `c:/x`), a UNC path
 * (`\\server\share...`), or a leading `/`. Rejects empty strings, NUL bytes, relative paths
 * (`x`, `./x`, `..\x`) and bare or drive-relative `C:` / `C:x`. Syntactic only (no `node:path`,
 * shared stays node-free): containment and existence are checked by the main process.
 */
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/

export const absolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\0'), 'path must not contain NUL')
  .refine((value) => ABSOLUTE_PATH.test(value), 'path must be absolute')

/** Strict `host:port` validation via `parseServerAddress`; rejects with the reason code (not
 * prose) as the issue message, and transforms a valid address into its normalized string. */
export const serverAddressSchema = z
  .string()
  .superRefine((value, ctx) => {
    const result = parseServerAddress(value)
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason })
    }
  })
  .transform((value) => {
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

/**
 * A SHA-256 digest as the manifest spells it: 64 lowercase hex characters. Not
 * `.toLowerCase()`-normalised - a manifest author writing uppercase hex is a
 * fixture worth rejecting, the same "reject, don't repair" stance the rest of
 * this file takes.
 */
export const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'must be a 64-character lowercase hex sha256 digest')

/**
 * Same shape as `urlSchema` in `src/shared/ipc-schemas.ts`, but the manifest's
 * own trust boundary is stricter: every package/mirror URL must be https - a
 * curated manifest naming a plain-http download is a fixture worth rejecting,
 * not a caller mistake to tolerate.
 */
export const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https:\/\//i.test(value), 'only https URLs are allowed')

/**
 * Story 074, harness only: the same shape as `httpsUrlSchema` above, plus a plain-http
 * **loopback** URL (`http://127.0.0.1[:port]/...`). Its consumers (the harness manifest-package and
 * mod-catalog schemas) are only ever selected under the `Q2L_UI_HARNESS === '1'` gate in
 * `src/main/services/content/source.ts`, so it stays unreachable in a shipped build.
 *
 * It is a *second, separately named* schema rather than a widened `httpsUrlSchema`, on purpose: a
 * single regex quietly accepting `http://127.0.0.1` would apply to production too, and "which URLs
 * can this build accept" would then be a question about a regex instead of a question about one
 * gated branch. `127.0.0.1` literally, not `localhost` and not any other loopback spelling - the
 * harness's fixture server binds that exact address.
 */
export const harnessLoopbackUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => /^https:\/\//i.test(value) || /^http:\/\/127\.0\.0\.1(:\d{1,5})?\//i.test(value),
    'only https URLs (or, in the UI harness, a http://127.0.0.1 loopback URL) are allowed',
  )
