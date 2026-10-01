import { z } from 'zod'

/** IPC payload validation for the mods module's handlers (strict, like the config module's). */

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
