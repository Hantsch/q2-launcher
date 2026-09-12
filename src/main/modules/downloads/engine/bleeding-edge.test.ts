import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManifestPackage } from '@shared/modules/downloads'
import {
  BleedingEdgeProbeFailedError,
  BleedingEdgeUnsupportedError,
  probeBleedingEdge,
} from './bleeding-edge'
import { computeEngineUpdateStatus } from './update-status'

/**
 * Story 092 D4: `probeBleedingEdge` - fetches Q2PRO's `version.txt` next to the pinned package's
 * asset, `HEAD`s the asset for its size, and answers `{ version, sizeBytes, url }`.
 *
 * `fetch` is stubbed globally, the same convention `manifest-service.test.ts` uses for
 * `fetchContentJson`'s own network calls (`vi.stubGlobal('fetch', fetchMock)`) - this probe never
 * goes through `harness.ts`'s `DownloadSource` seam (see `bleeding-edge.ts`'s own doc comment for
 * why), so there is nothing else to substitute.
 */

const PINNED_Q2PRO_PACKAGE: ManifestPackage = {
  id: 'q2pro-win64',
  version: '2.34',
  sizeBytes: 12_345,
  sha256: 'a'.repeat(64),
  url: 'https://example.test/q2pro/nightly/Q2PRO-nightly-win64.zip',
  mirrors: [],
  contents: [{ from: 'q2pro.exe', to: 'root' }],
  kind: 'engine',
  engine: 'q2pro',
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A `version.txt` GET response. */
function versionResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response
}

/** A `HEAD` asset response. */
function headResponse(contentLength: string | null, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: (name: string) => (name === 'content-length' ? contentLength : null) },
  } as unknown as Response
}

describe('probeBleedingEdge', () => {
  it('parses the version from version.txt and the size from the HEAD response', async () => {
    fetchMock.mockImplementation((url: unknown, init?: RequestInit) => {
      if (url === 'https://example.test/q2pro/nightly/version.txt') {
        return Promise.resolve(versionResponse('2.35-dev+abc123\n'))
      }
      if (url === PINNED_Q2PRO_PACKAGE.url && init?.method === 'HEAD') {
        return Promise.resolve(headResponse('999000'))
      }
      throw new Error(`unexpected fetch: ${String(url)}`)
    })

    const probe = await probeBleedingEdge('q2pro', PINNED_Q2PRO_PACKAGE)

    expect(probe).toEqual({
      version: '2.35-dev+abc123',
      sizeBytes: 999_000,
      url: PINNED_Q2PRO_PACKAGE.url,
    })
  })

  it('fails with a probe-failed error when version.txt is missing (non-2xx)', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(versionResponse('', false, 404)))

    await expect(probeBleedingEdge('q2pro', PINNED_Q2PRO_PACKAGE)).rejects.toThrow(
      BleedingEdgeProbeFailedError,
    )
  })

  it('fails with a probe-failed error when version.txt is empty garbage', async () => {
    fetchMock.mockImplementation((url: unknown) => {
      if (url === 'https://example.test/q2pro/nightly/version.txt') {
        return Promise.resolve(versionResponse('   \n'))
      }
      return Promise.resolve(headResponse('123'))
    })

    await expect(probeBleedingEdge('q2pro', PINNED_Q2PRO_PACKAGE)).rejects.toThrow(
      BleedingEdgeProbeFailedError,
    )
  })

  it('fails with a probe-failed error when the HEAD response carries no Content-Length', async () => {
    fetchMock.mockImplementation((url: unknown, init?: RequestInit) => {
      if (url === 'https://example.test/q2pro/nightly/version.txt') {
        return Promise.resolve(versionResponse('2.35-dev'))
      }
      if (init?.method === 'HEAD') return Promise.resolve(headResponse(null))
      throw new Error(`unexpected fetch: ${String(url)}`)
    })

    await expect(probeBleedingEdge('q2pro', PINNED_Q2PRO_PACKAGE)).rejects.toThrow(
      BleedingEdgeProbeFailedError,
    )
  })

  it('refuses r1q2 with an unsupported error, without ever calling fetch', async () => {
    await expect(probeBleedingEdge('r1q2', undefined)).rejects.toThrow(BleedingEdgeUnsupportedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses q2pro with no pinned package with an unsupported error', async () => {
    await expect(probeBleedingEdge('q2pro', undefined)).rejects.toThrow(BleedingEdgeUnsupportedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * Story 092 D4: the handler-level equivalent of "turning bleeding edge off makes the next check
 * compare against the pin again" - `computeEngineUpdateStatus` itself is unchanged by D4 (it only
 * ever compares an already-resolved `target`), so this exercises the same target-resolution shape
 * `index.ts`'s `engine.updateStatus` handler builds: bleeding-edge on uses the probed version/
 * channel, bleeding-edge off uses the manifest's pinned version/channel - both against the exact
 * same recorded `current`.
 */
describe('target resolution once bleeding edge is toggled off', () => {
  it('compares against the pinned version again, not the last probed one', () => {
    const recordedWhileBleedingEdge = { version: '2.35-dev+abc123' }

    const whileOn = computeEngineUpdateStatus('inst-1', 'q2pro', recordedWhileBleedingEdge, {
      channel: 'bleeding-edge',
      version: '2.36-dev+def456',
    })
    expect(whileOn.updateAvailable).toBe(true)
    expect(whileOn.channel).toBe('bleeding-edge')

    // Flag flipped off: the caller now resolves `target` from the manifest pin instead - the
    // installation's recorded `current` is untouched, only which target it is compared against
    // changes.
    const afterOff = computeEngineUpdateStatus('inst-1', 'q2pro', recordedWhileBleedingEdge, {
      channel: 'pinned',
      version: '2.34',
    })
    expect(afterOff.channel).toBe('pinned')
    expect(afterOff.current).toBe('2.35-dev+abc123')
    expect(afterOff.target).toBe('2.34')
    // The recorded (bleeding-edge) version differs from the pin, so an update is still reported -
    // that is a true fact about this installation, not a bug in the resolution switch.
    expect(afterOff.updateAvailable).toBe(true)
  })
})
