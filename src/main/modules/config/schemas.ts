import { z } from 'zod'

/**
 * IPC payload validation for the config module's own handlers.
 *
 * These are strict, same convention as the installation payload schemas in
 * `main/lib/schemas.ts`: a bad payload here is a caller bug, not a state to
 * repair, so a handler lets `.parse()` throw rather than catching it.
 */

export const createConfigProfileInputSchema = z.object({
  name: z.string().min(1).max(120),
  from: z.enum(['empty', 'template']),
})

export const renameConfigProfileInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
})

export const removeConfigProfileInputSchema = z.object({
  id: z.string().min(1),
})

/**
 * The three assignment payloads are shape-identical (`profileId` +
 * `installationId`), so they alias one schema rather than duplicate it.
 */
export const assignProfileInputSchema = z.object({
  profileId: z.string().min(1),
  installationId: z.string().min(1),
})

export const unassignProfileInputSchema = assignProfileInputSchema
export const setDefaultProfileInputSchema = assignProfileInputSchema
