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
