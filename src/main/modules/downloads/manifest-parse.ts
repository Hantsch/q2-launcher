import type { EngineKind } from '@shared/types'
import type { Logger } from '../../lib/logger'
import { engineKindSchema } from '@shared/schemas'
import {
  harnessLoopbackManifestPackageSchema,
  manifestEnvelopeSchema,
  manifestPackageSchema,
  type ManifestPinnedEntry,
  type PlatformTaggedManifestPackage,
} from './schemas'

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
  | {
      ok: true
      packages: PlatformTaggedManifestPackage[]
      /**
       * Story 100 D5: already resolved *for one platform* - an engine whose pin names no package
       * this host can run is simply absent here, never present with a package id the host cannot
       * execute. Every consumer downstream (the cache, `ManifestSnapshot.pinned`, the renderer)
       * therefore never has to know about platforms at all.
       */
      pinned: Partial<Record<EngineKind, string>>
      /**
       * Story 100 D7: whether this file's raw `pinned` object configured at least one entry, for
       * any engine, on any platform - read straight off the envelope before platform resolution
       * drops anything. Lets a caller distinguish "this file pins nothing at all" from "this file
       * pins something, just not for this host" once `pinned` above has come back empty either way.
       */
      hasAnyPin: boolean
    }
  | { ok: false; reason: 'malformed-envelope' | 'unsupported-schema-version' }

const SUPPORTED_SCHEMA_VERSION = 1

/**
 * Story 100 D5: what a package row with **no** `platforms` field means. Every manifest published
 * before that field existed - including the live remote one at the time of writing - lists
 * Windows-only payloads, so `['win32']` is what those files actually meant.
 *
 * The two alternatives were both wrong in a way that matters in production, where no test runs:
 * reading an absent field as "runs anywhere" hands a Linux host a `.exe`, and reading it as "runs
 * nowhere" silently kills the Windows download path the moment this launcher meets a manifest
 * older than itself. This is a tolerance at an external-document boundary, not an internal shim.
 */
const IMPLIED_PLATFORMS: readonly string[] = ['win32']

/**
 * Story 100 D5: the same reading for a bare-string `pinned` value (`{ q2pro: "<id>" }`, the shape
 * every manifest published before this deliverable uses) - it pins for Windows and for nothing
 * else. An explicit `{ win32: "<id>" }` record means exactly the same thing.
 */
const IMPLIED_PIN_PLATFORM = 'win32'

/**
 * The platforms a package declares it can run on, with the compatibility reading above applied.
 * An *explicitly* empty list is left empty: "the author said no platform" is a statement, unlike
 * a field that predates the whole concept.
 */
export function packagePlatforms(pkg: PlatformTaggedManifestPackage): readonly string[] {
  return pkg.platforms ?? IMPLIED_PLATFORMS
}

/** Whether `platform` (as `process.platform` spells it) can run `pkg`'s payload. */
export function packageRunsOnPlatform(
  pkg: PlatformTaggedManifestPackage,
  platform: string,
): boolean {
  return packagePlatforms(pkg).includes(platform)
}

export interface ParseManifestFileOptions {
  /**
   * Story 074 D8. Defaults to `true`: every package/mirror URL must be https, the production rule
   * this file has always applied. `false` selects the separately named
   * `harnessLoopbackManifestPackageSchema` instead, which additionally accepts a plain-http
   * `127.0.0.1` URL - the *only* producer of `false` is `resolveDownloadSource()`
   * (`harness.ts`), under its `Q2L_UI_HARNESS === '1' && isDev` double gate, and it is threaded in
   * as a plain value so nothing in this file has to read `process.env`.
   */
  httpsOnly?: boolean
  /**
   * Story 100 D5: the host platform the pins are resolved for, spelled the way `process.platform`
   * spells it. Defaults to the running platform, so no existing caller changes; it is threaded in
   * as a plain value for the same reason `httpsOnly` above is - a test can then prove the Linux
   * reading on a Windows host (and the other way round) without stubbing anything global.
   */
  platform?: NodeJS.Platform
}

export function parseManifestFile(
  raw: unknown,
  log: Logger,
  options: ParseManifestFileOptions = {},
): ManifestParseResult {
  // Which of the two schemas this call uses is decided once, here, from a value the caller was
  // handed - not per row and not from the environment.
  const packageSchema =
    options.httpsOnly === false ? harnessLoopbackManifestPackageSchema : manifestPackageSchema

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

  const packages: PlatformTaggedManifestPackage[] = []
  for (const [index, row] of envelope.data.packages.entries()) {
    const result = packageSchema.safeParse(row)
    if (!result.success) {
      const id = idOf(row)
      log.warn(`manifest package at index ${index}${id ? ` (id: ${id})` : ''} dropped: ${result.error.message}`)
      continue
    }
    packages.push(result.data)
  }

  // Read once, here, from the option the caller was handed - not deep inside the resolver.
  const platform: string = options.platform ?? process.platform
  const pinned = resolvePinned(envelope.data.pinned, packages, platform, log)
  const hasAnyPin = Object.keys(envelope.data.pinned ?? {}).length > 0

  return { ok: true, packages, pinned, hasAnyPin }
}

/** Best-effort id for a log line about a row that failed its own schema - never trusted for anything else. */
function idOf(row: unknown): string | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const id = (row as Record<string, unknown>).id
  return typeof id === 'string' ? id : undefined
}

/**
 * Resolves `pinned` (an engine-kind-keyed map of package ids, e.g.
 * `{ q2pro: '<id>' }` or, since story 100 D5, `{ q2pro: { win32: '<id>' } }`)
 * against the packages that survived parsing above - never against the raw
 * input. A pinned id that names a dropped (or never existent) package is
 * logged and simply has no pin for that engine: a dropped package must never
 * silently promote a different version to default (story's binding decision).
 *
 * Story 100 D5 adds one more way to have no pin, with the same rule behind it: a pin that names a
 * package `platform` cannot run resolves to *nothing*, never to "the other platform's build". Two
 * independent gates have to agree - the pin has to be for this platform (a bare string is a
 * Windows pin, see `IMPLIED_PIN_PLATFORM`) *and* the package it names has to declare this
 * platform (absent declaration is Windows, see `IMPLIED_PLATFORMS`) - so neither half of a
 * half-migrated manifest can hand a host a binary it cannot execute.
 */
function resolvePinned(
  rawPinned: Record<string, ManifestPinnedEntry> | undefined,
  survivors: PlatformTaggedManifestPackage[],
  platform: string,
  log: Logger,
): Partial<Record<EngineKind, string>> {
  const pinned: Partial<Record<EngineKind, string>> = {}
  if (!rawPinned) return pinned

  const survivorsById = new Map(survivors.map((pkg) => [pkg.id, pkg]))
  for (const [engine, entry] of Object.entries(rawPinned)) {
    const engineKind = engineKindSchema.safeParse(engine)
    if (!engineKind.success) {
      log.warn(`manifest pin dropped: "${engine}" is not a recognised engine kind`)
      continue
    }

    const id = pinnedIdForPlatform(entry, platform)
    if (id === undefined) {
      // Not a warning: "this engine has no build for this platform" is a normal, expected state
      // (it is exactly what a Windows-only manifest says to a Linux host), not a manifest fault.
      continue
    }

    const pkg = survivorsById.get(id)
    if (pkg === undefined) {
      log.warn(`manifest pin for engine "${engine}" dropped: package id "${id}" did not survive parsing`)
      continue
    }
    if (!packageRunsOnPlatform(pkg, platform)) {
      log.warn(
        `manifest pin for engine "${engine}" dropped: package "${id}" declares platforms ` +
          `[${packagePlatforms(pkg).join(', ')}] and this host is "${platform}"`,
      )
      continue
    }

    pinned[engineKind.data] = id
  }
  return pinned
}

/**
 * The package id one `pinned` entry names for `platform`, or `undefined` when it names none.
 * A bare string is the pre-D5 shape and pins for Windows only (`IMPLIED_PIN_PLATFORM`); a record
 * is read by exact platform key, so an unknown or absent key is "nothing for this platform"
 * rather than a fallback to some other platform's build.
 */
function pinnedIdForPlatform(entry: ManifestPinnedEntry, platform: string): string | undefined {
  if (typeof entry === 'string') {
    return platform === IMPLIED_PIN_PLATFORM && entry.length > 0 ? entry : undefined
  }
  const id = entry[platform]
  return typeof id === 'string' && id.length > 0 ? id : undefined
}
