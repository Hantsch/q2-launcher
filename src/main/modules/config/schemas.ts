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

/**
 * Structural validation only - a cvar name must be a non-empty string, same as
 * a cvar value. This deliberately does not validate cvar-name semantics (that
 * is a later story's job); it only rejects garbage shapes before they reach
 * `ProfilesStore`.
 */
export const setProfileCvarsInputSchema = z.object({
  profileId: z.string().min(1),
  cvars: z.record(z.string().min(1), z.string()),
})

export const writeProfileInputSchema = z.object({
  profileId: z.string().min(1),
})

export const previewProfileInputSchema = z.object({
  profileId: z.string().min(1),
  installationId: z.string().min(1),
})

export const setPlayedModsInputSchema = z.object({
  installationId: z.string().min(1),
  playedMods: z.array(z.string().min(1)).max(64),
})

/**
 * Story 005 import payloads. Deviation from the story text: it says these
 * belong in `main/lib/schemas.ts`, but every other config-module IPC payload
 * schema already lives here instead - that repo convention wins over the
 * stale story text.
 */
export const importScanInputSchema = z.object({
  installationId: z.string().min(1),
})

export const importPreviewInputSchema = z.object({
  installationId: z.string().min(1),
  gameDir: z.string().min(1).max(64),
})

export const importCommitInputSchema = z.object({
  installationId: z.string().min(1),
  gameDir: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
})
