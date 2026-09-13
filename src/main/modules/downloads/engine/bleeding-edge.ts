import type { ManifestPackage } from '@shared/modules/downloads'
import type { EngineKind } from '@shared/types/engine'

/**
 * Story 092 D4 (AC4/AC5): probes Q2PRO's own nightly-build feed for "what does bleeding-edge
 * currently mean" - a `version.txt` published next to the pinned package's moving-target asset
 * (Decisions (Sprint): "Fetch Q2PRO's version.txt next to the nightly release asset ... not the
 * GitHub Releases API - no rate limit, simpler parsing").
 *
 * Deliberately not routed through `harness.ts`'s `DownloadSource`/`fetchContentJson()`: that
 * abstraction exists to redirect the *curated content repo's own fixed host* (`CONTENT_REPO_RAW_
 * BASE`) under the UI harness's gate. This probe's URL is never a hardcoded host to begin with -
 * it is derived, at call time, from the manifest's own pinned `ManifestPackage.url` (INST-M1: "no
 * download URL in launcher code"), so there is nothing here for that abstraction to override. A
 * test substitutes a fixture the same way `manifest-service.test.ts` does for `fetchContentJson`'s
 * own global `fetch` calls: `vi.stubGlobal('fetch', fetchMock)` against a fixture `ManifestPackage`
 * URL, not a second `DownloadSource`-shaped seam.
 */

/** The file `probeBleedingEdge` expects to sit next to the pinned package's asset. */
const VERSION_FILE_NAME = 'version.txt'

/** Same per-request timeout budget `fetchContentJson`/`ManifestService` use for a manifest fetch. */
const PROBE_TIMEOUT_MS = 10_000

/** `probeBleedingEdge`'s answer (AC5): what "latest" currently resolves to, and its size. */
export interface BleedingEdgeProbe {
  /** The version `version.txt` reported, trimmed. */
  version: string
  /** The asset's `Content-Length`, as reported by the `HEAD` request. */
  sizeBytes: number
  /** The asset URL the probe resolved against - the pinned package's own `url`, echoed back so a
   * caller does not have to re-derive it from the package a second time. */
  url: string
}

/**
 * `downloads.error.bleedingEdgeUnsupported`: bleeding edge was asked for on an engine kind the
 * channel does not support this sprint (every engine except Q2PRO - Decisions (Sprint): "r1q2 has
 * no such file, so bleeding edge stays Q2PRO-only in v1"), or the manifest has no pinned Q2PRO
 * package to derive the probe URL from at all.
 */
export class BleedingEdgeUnsupportedError extends Error {
  constructor(reason: string) {
    super(`bleeding edge is not supported: ${reason}`)
    this.name = 'BleedingEdgeUnsupportedError'
  }
}

/**
 * `downloads.error.bleedingEdgeProbeFailed`: the `version.txt` fetch or the asset `HEAD` failed
 * outright, or `version.txt` did not contain a usable version - a network/transport failure or a
 * garbage upstream file, never a thrown programming error.
 */
export class BleedingEdgeProbeFailedError extends Error {
  constructor(reason: string) {
    super(`bleeding-edge probe failed: ${reason}`)
    this.name = 'BleedingEdgeProbeFailedError'
  }
}

/**
 * Replaces the pinned asset URL's final path segment with `version.txt` - "next to the nightly
 * release asset" (Decisions (Sprint)), i.e. the same directory, not the same file name with a
 * different extension. Throws neither: an unparsable `assetUrl` (which `manifestPackageSchema`
 * already refused to let into a `ManifestPackage` in the first place) would only ever reach here
 * as a genuine programming error, not a caller mistake to degrade gracefully.
 */
function versionTxtUrlFor(assetUrl: string): string {
  const url = new URL(assetUrl)
  const segments = url.pathname.split('/')
  segments[segments.length - 1] = VERSION_FILE_NAME
  url.pathname = segments.join('/')
  return url.toString()
}

/**
 * Story 092 D4 (AC4): probes the bleeding-edge channel for `engine` - Q2PRO only. `pinnedPackage`
 * is the caller's own `manifestService.pinnedEnginePackage(engine)` result: this function makes no
 * manifest call of its own (Decisions (Sprint), INST-M1) and never chooses a host by itself.
 *
 * Rejects with `BleedingEdgeUnsupportedError` for any engine other than `'q2pro'`, or when
 * `pinnedPackage` is `undefined` (no manifest pin to derive a URL from - the same "nothing to
 * probe" case as an unpinned engine). Rejects with `BleedingEdgeProbeFailedError` for any transport
 * failure, non-2xx response, empty/unparsable `version.txt`, or a missing/invalid
 * `Content-Length` on the `HEAD` response.
 */
export async function probeBleedingEdge(
  engine: EngineKind,
  pinnedPackage: ManifestPackage | undefined,
): Promise<BleedingEdgeProbe> {
  if (engine !== 'q2pro') {
    throw new BleedingEdgeUnsupportedError(`engine "${engine}" does not offer a bleeding-edge channel`)
  }
  if (pinnedPackage === undefined) {
    throw new BleedingEdgeUnsupportedError('no pinned Q2PRO package to derive the probe URL from')
  }

  const assetUrl = pinnedPackage.url
  const versionUrl = versionTxtUrlFor(assetUrl)

  let version: string
  try {
    const response = await fetch(versionUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!response.ok) {
      throw new Error(`unexpected status ${response.status}`)
    }
    version = (await response.text()).trim()
  } catch (error) {
    throw new BleedingEdgeProbeFailedError(`fetching ${versionUrl} failed: ${String(error)}`)
  }
  if (version.length === 0) {
    throw new BleedingEdgeProbeFailedError(`${versionUrl} did not contain a version`)
  }

  let sizeBytes: number
  try {
    const response = await fetch(assetUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`unexpected status ${response.status}`)
    }
    const contentLength = response.headers.get('content-length')
    if (contentLength === null) {
      throw new Error('response carried no Content-Length header')
    }
    sizeBytes = Number(contentLength)
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new Error(`unusable Content-Length "${contentLength}"`)
    }
  } catch (error) {
    throw new BleedingEdgeProbeFailedError(`HEAD ${assetUrl} failed: ${String(error)}`)
  }

  return { version, sizeBytes, url: assetUrl }
}
