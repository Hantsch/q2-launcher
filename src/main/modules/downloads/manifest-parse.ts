import type { EngineKind } from '@shared/types'
import type { ManifestPackage } from '@shared/modules/downloads'
import type { Logger } from '../../lib/logger'
import { engineKindSchema } from '@shared/schemas'
import { manifestEnvelopeSchema, manifestPackageSchema } from './schemas'

/**
 * The pure, main-process manifest parser (story 070 D1). Takes the already
 * `JSON.parse`d content of ONE manifest file (`engines/manifest.json` OR
 * `gamedata/manifest.json` - each has its own envelope) and turns it into
 * survivors-only packages plus a pin resolved against them, or a refusal.
 *
 * No network code here - fetching the file is D2/D3's job. This module only
 * has an opinion about a JSON value it is handed.
 *
 * Two failure modes, deliberately not conflated:
 *  - the ENVELOPE refuses the whole file (`ok: false`): either the
 *    `schemaVersion`/`packages` shape is structurally broken, or
 *    `schemaVersion` isn't exactly `1`. Treated upstream like a failed fetch
 *    (D3's business) - never a partial result.
 *  - one PACKAGE row fails: it is dropped, with a `log.warn` line, and every
 *    other row is still parsed. Mirrors the row-by-row drop convention in
 *    `src/main/lib/schemas.ts` (`parseForgivingRows`) - except here it isn't a
 *    forgiving *coercion*, a bad row is simply excluded, not defaulted.
 */
export type ManifestParseResult =
  | { ok: true; packages: ManifestPackage[]; pinned: Partial<Record<EngineKind, string>> }
  | { ok: false; reason: 'malformed-envelope' | 'unsupported-schema-version' }

const SUPPORTED_SCHEMA_VERSION = 1

export function parseManifestFile(raw: unknown, log: Logger): ManifestParseResult {
  const envelope = manifestEnvelopeSchema.safeParse(raw)
  if (!envelope.success) {
    log.warn('manifest refused: malformed envelope (missing/invalid schemaVersion or packages)')
    return { ok: false, reason: 'malformed-envelope' }
  }

  if (envelope.data.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    log.warn(
      `manifest refused: unsupported schemaVersion ${envelope.data.schemaVersion} (expected ${SUPPORTED_SCHEMA_VERSION})`,
    )
    return { ok: false, reason: 'unsupported-schema-version' }
  }

  const packages: ManifestPackage[] = []
  for (const [index, row] of envelope.data.packages.entries()) {
    const result = manifestPackageSchema.safeParse(row)
    if (!result.success) {
      const id = idOf(row)
      log.warn(`manifest package at index ${index}${id ? ` (id: ${id})` : ''} dropped: ${result.error.message}`)
      continue
    }
    packages.push(result.data)
  }

  const pinned = resolvePinned(envelope.data.pinned, packages, log)

  return { ok: true, packages, pinned }
}

/** Best-effort id for a log line about a row that failed its own schema - never trusted for anything else. */
function idOf(row: unknown): string | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const id = (row as Record<string, unknown>).id
  return typeof id === 'string' ? id : undefined
}

/**
 * Resolves `pinned` (an engine-kind-keyed map of package ids, e.g.
 * `{ q2pro: '<id>' }`) against the packages that survived parsing above -
 * never against the raw input. A pinned id that names a dropped (or never
 * existent) package is logged and simply has no pin for that engine: a
 * dropped package must never silently promote a different version to
 * default (story's binding decision).
 */
function resolvePinned(
  rawPinned: Record<string, string> | undefined,
  survivors: ManifestPackage[],
  log: Logger,
): Partial<Record<EngineKind, string>> {
  const pinned: Partial<Record<EngineKind, string>> = {}
  if (!rawPinned) return pinned

  const survivingIds = new Set(survivors.map((pkg) => pkg.id))
  for (const [engine, id] of Object.entries(rawPinned)) {
    const engineKind = engineKindSchema.safeParse(engine)
    if (!engineKind.success) {
      log.warn(`manifest pin dropped: "${engine}" is not a recognised engine kind`)
      continue
    }
    if (survivingIds.has(id)) {
      pinned[engineKind.data] = id
      continue
    }
    log.warn(`manifest pin for engine "${engine}" dropped: package id "${id}" did not survive parsing`)
  }
  return pinned
}
