import type { ModCatalogEntry } from '@shared/modules/mods'
import { parseKeyedRows } from '../../lib/forgiving'
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

  const entries = parseKeyedRows(entrySchema, envelope.data.entries, {
    refine: (e) => (e.versions.some((v) => v.version === e.pinned) ? e : null),
    keyOf: { id: (e) => e.id, gamedir: (e) => e.gamedir.toLowerCase() },
    onDrop: (drop) => {
      const id = idOf(drop.row)
      const label = `mod catalog entry at index ${drop.index}${id ? ` (id: ${id})` : ''}`
      if (drop.reason === 'invalid') log.warn(`${label} dropped: ${drop.error.message}`)
      else if (drop.reason === 'refused')
        log.warn(`${label} dropped: pinned "${drop.parsed.pinned}" names no listed version`)
      else if (drop.key === 'id') log.warn(`${label} dropped: duplicate id`)
      else log.warn(`${label} dropped: duplicate gamedir "${drop.parsed.gamedir}"`)
    },
  })
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
