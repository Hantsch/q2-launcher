import type { ModCatalogEntry } from '@shared/modules/mods'
import type { Logger } from '../../lib/logger'
import {
  harnessLoopbackModCatalogEntrySchema,
  modCatalogEntrySchema,
  modCatalogEnvelopeSchema,
  type ModCatalogEntryParsed,
} from './catalog-schema'

export type ModCatalogParseResult =
  | { ok: true; entries: ModCatalogEntryParsed[] }
  | { ok: false; reason: 'malformed-envelope' | 'unsupported-schema-version' }

const SUPPORTED_SCHEMA_VERSION = 1

export interface ParseModCatalogOptions {
  /** Defaults to true. `false` (UI harness only) also accepts a `http://127.0.0.1` package URL. */
  httpsOnly?: boolean
}

/**
 * Parses the already-`JSON.parse`d mod catalog. The envelope refuses the whole file; every entry
 * is parsed alone, and any invalid part drops that whole entry with exactly one warning.
 */
export function parseModCatalog(
  raw: unknown,
  log: Logger,
  options: ParseModCatalogOptions = {},
): ModCatalogParseResult {
  const entrySchema =
    options.httpsOnly === false ? harnessLoopbackModCatalogEntrySchema : modCatalogEntrySchema

  const envelope = modCatalogEnvelopeSchema.safeParse(raw)
  if (!envelope.success) {
    log.warn('mod catalog refused: malformed envelope (missing/invalid schemaVersion or entries)')
    return { ok: false, reason: 'malformed-envelope' }
  }
  if (envelope.data.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    log.warn(
      `mod catalog refused: unsupported schemaVersion ${envelope.data.schemaVersion} (expected ${SUPPORTED_SCHEMA_VERSION})`,
    )
    return { ok: false, reason: 'unsupported-schema-version' }
  }

  const entries: ModCatalogEntryParsed[] = []
  const ids = new Set<string>()
  const gamedirs = new Set<string>()
  for (const [index, row] of envelope.data.entries.entries()) {
    const label = `mod catalog entry at index ${index}${idOf(row) ? ` (id: ${idOf(row)})` : ''}`
    const result = entrySchema.safeParse(row)
    if (!result.success) {
      log.warn(`${label} dropped: ${result.error.message}`)
      continue
    }
    const entry = result.data
    if (!entry.versions.some((v) => v.version === entry.pinned)) {
      log.warn(`${label} dropped: pinned "${entry.pinned}" names no listed version`)
      continue
    }
    if (ids.has(entry.id)) {
      log.warn(`${label} dropped: duplicate id`)
      continue
    }
    const dir = entry.gamedir.toLowerCase()
    if (gamedirs.has(dir)) {
      log.warn(`${label} dropped: duplicate gamedir "${entry.gamedir}"`)
      continue
    }
    ids.add(entry.id)
    gamedirs.add(dir)
    entries.push(entry)
  }
  return { ok: true, entries }
}

/** The wire projection: identity and versions only, never variants or packages. */
export function toCatalogEntryDto(entry: ModCatalogEntryParsed): ModCatalogEntry {
  return {
    id: entry.id,
    gamedir: entry.gamedir,
    name: entry.name,
    description: entry.description,
    license: entry.license,
    projectUrl: entry.projectUrl,
    sourceUrl: entry.sourceUrl,
    pinned: entry.pinned,
    versions: entry.versions.map((v) => ({ version: v.version, prerelease: v.prerelease })),
  }
}

function idOf(row: unknown): string | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const id = (row as Record<string, unknown>).id
  return typeof id === 'string' ? id : undefined
}
