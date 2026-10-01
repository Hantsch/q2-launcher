import { z } from 'zod'
import { isSafeGameDirName } from '@shared/mods/gamedir'
import { harnessLoopbackUrlSchema, httpsUrlSchema, sha256Schema } from '../downloads/schemas'

/**
 * Runtime validation for the mod catalog (`mods/manifest.json` in the content repository).
 * Structural only; a bad *entry* is dropped whole by `catalog-parse.ts`, never repaired.
 * Unknown fields are stripped (zod's default), so they never reach the projection.
 */

/** `from` is a path inside the archive: relative, no `..` segment, no drive letter, no root. */
export function isSafeContentsFrom(from: string): boolean {
  if (from.length === 0 || from.includes('\0')) return false
  if (from.startsWith('/') || from.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(from)) return false
  return !from.replace(/\\/g, '/').split('/').includes('..')
}

const contentsEntrySchema = z.object({
  from: z.string().refine(isSafeContentsFrom, 'must be a relative path without ".." segments'),
  to: z.literal('gamedir'),
})

function packageSchemaWith(urlSchema: z.ZodType<string>) {
  return z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    url: urlSchema,
    mirrors: z.array(urlSchema),
    sizeBytes: z.number().int().positive(),
    sha256: sha256Schema,
    contents: z.array(contentsEntrySchema).min(1),
  })
}

function entrySchemaWith(urlSchema: z.ZodType<string>) {
  const pkg = packageSchemaWith(urlSchema)
  const variant = z.object({
    platform: z.enum(['win32', 'linux']),
    arch: z.enum(['x86', 'x64', 'arm64']),
    packages: z.array(pkg),
  })
  const version = z.object({
    version: z.string().min(1),
    prerelease: z.boolean(),
    variants: z.array(variant),
    contentOnly: z.object({ packages: z.array(pkg) }),
  })
  return z.object({
    id: z.string().min(1),
    gamedir: z.string().refine(isSafeGameDirName, 'not a safe game directory name'),
    name: z.string().min(1).max(64),
    description: z.string().max(280),
    license: z.string().min(1),
    projectUrl: httpsUrlSchema,
    sourceUrl: httpsUrlSchema,
    pinned: z.string().min(1),
    versions: z.array(version).min(1),
  })
}

export const modCatalogEntrySchema = entrySchemaWith(httpsUrlSchema)

/** Harness only: also accepts a plain-http `127.0.0.1` package/mirror URL (see downloads/schemas). */
export const harnessLoopbackModCatalogEntrySchema = entrySchemaWith(harnessLoopbackUrlSchema)

export type ModCatalogEntryParsed = z.infer<typeof modCatalogEntrySchema>

export const modCatalogEnvelopeSchema = z.object({
  schemaVersion: z.number(),
  entries: z.array(z.unknown()),
})
