import { describe, expect, it } from 'vitest'
import { CONTENT_REPO_RAW_BASE } from '../../lib/content-repo'
import { delimiter } from 'node:path'
import {
  isUiHarnessEnabled,
  uiHarnessPickedFolders,
  UI_HARNESS_ENV,
  UI_HARNESS_PICK_FOLDER_ENV,
} from '../../lib/ui-harness'
import {
  HARNESS_CONTENT_REPO_BASE_ENV,
  PRODUCTION_DOWNLOAD_SOURCE,
  resolveDownloadSource,
} from './harness'
import { parseManifestFile } from './manifest-parse'
import { harnessLoopbackManifestPackageSchema, manifestPackageSchema } from './schemas'
import type { Logger } from '../../lib/logger'

/**
 * Story 074 D8: the harness-only download-source override is a security-relevant backdoor - it can
 * point the launcher's manifest and package traffic at a different server - so, exactly like
 * `DialogService`'s config-file picker stub, it must be provably unreachable unless BOTH
 * `Q2L_UI_HARNESS === '1'` and `isDev` are true. This file mirrors
 * `src/main/services/dialog.test.ts`'s four gate cases one for one:
 *
 *   1. both flags off              -> production path
 *   2. only `Q2L_UI_HARNESS=1`     -> production path
 *   3. only `isDev`                -> production path
 *   4. `isDev` + a non-'1' value   -> production path
 *   5. both on                     -> harness path
 *
 * and then adds what is specific to *this* backdoor: the override is refused unless it names a
 * `127.0.0.1` loopback origin, and the production package schema is not widened by any of it.
 *
 * The environment is passed in as a value rather than mutated on `process.env`, which is what lets
 * all four combinations be asserted without any `beforeEach`/`afterEach` bookkeeping - and which is
 * also the property that makes the gate auditable in the first place (nothing caches a decision).
 */

const LOOPBACK_BASE = 'http://127.0.0.1:53129'

/** A packaged build's environment: `isDev` false, whatever the variables say. */
const HARNESS_ENV = {
  [UI_HARNESS_ENV]: '1',
  [HARNESS_CONTENT_REPO_BASE_ENV]: LOOPBACK_BASE,
  [UI_HARNESS_PICK_FOLDER_ENV]: `C:\\Program Files\\fixture-probe${delimiter}C:\\fixtures\\bootstrap-target`,
} as NodeJS.ProcessEnv

function silentLogger(): Logger {
  return { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as unknown as Logger
}

/** A manifest package row whose URL and mirror are plain-http loopback URLs. */
function loopbackPackageRow(): unknown {
  return {
    kind: 'engine',
    engine: 'q2pro',
    id: 'q2pro-fixture',
    version: '1.0',
    sizeBytes: 1234,
    sha256: 'a'.repeat(64),
    url: `${LOOPBACK_BASE}/packages/q2pro-fixture.zip`,
    mirrors: [`${LOOPBACK_BASE}/mirror/q2pro-fixture.zip`],
    contents: [{ from: '.', to: 'root' }],
  }
}

describe('the download-source override is unreachable with either gate off', () => {
  it('both flags off: the production content repo is used, Q2L_UI_CONTENT_REPO_BASE is ignored', () => {
    const source = resolveDownloadSource({
      isDev: false,
      env: { [HARNESS_CONTENT_REPO_BASE_ENV]: LOOPBACK_BASE },
    })

    expect(source).toBe(PRODUCTION_DOWNLOAD_SOURCE)
    expect(source.baseUrl).toBe(CONTENT_REPO_RAW_BASE)
    expect(source.httpsOnly).toBe(true)
  })

  it('only Q2L_UI_HARNESS=1 (isDev false): the production content repo is still used', () => {
    const source = resolveDownloadSource({ isDev: false, env: HARNESS_ENV })

    expect(source).toBe(PRODUCTION_DOWNLOAD_SOURCE)
    expect(source.baseUrl).toBe(CONTENT_REPO_RAW_BASE)
    expect(source.httpsOnly).toBe(true)
  })

  it('only isDev=true (Q2L_UI_HARNESS unset): the production content repo is still used', () => {
    const source = resolveDownloadSource({
      isDev: true,
      env: { [HARNESS_CONTENT_REPO_BASE_ENV]: LOOPBACK_BASE },
    })

    expect(source).toBe(PRODUCTION_DOWNLOAD_SOURCE)
    expect(source.httpsOnly).toBe(true)
  })

  it('only isDev=true and Q2L_UI_HARNESS set to something other than "1": still production', () => {
    const source = resolveDownloadSource({
      isDev: true,
      env: { ...HARNESS_ENV, [UI_HARNESS_ENV]: 'true' },
    })

    expect(source).toBe(PRODUCTION_DOWNLOAD_SOURCE)
    expect(source.httpsOnly).toBe(true)
  })

  it('both flags on: the loopback base is used and the https-only rule is relaxed', () => {
    const source = resolveDownloadSource({ isDev: true, env: HARNESS_ENV })

    expect(source.baseUrl).toBe(LOOPBACK_BASE)
    expect(source.httpsOnly).toBe(false)
  })

  it('both flags on but Q2L_UI_CONTENT_REPO_BASE unset: still the production source', () => {
    const source = resolveDownloadSource({ isDev: true, env: { [UI_HARNESS_ENV]: '1' } })

    expect(source).toBe(PRODUCTION_DOWNLOAD_SOURCE)
  })
})

describe('even inside the harness branch, the override must name a loopback origin', () => {
  const refused = [
    'https://raw.githubusercontent.com/evil/content/main',
    'http://example.test:8080',
    'http://localhost:53129',
    'http://127.0.0.2:53129',
    'file:///C:/tmp/manifests',
    'not-a-url',
    '',
  ]

  for (const value of refused) {
    it(`refuses ${JSON.stringify(value)} and falls back to production`, () => {
      const source = resolveDownloadSource({
        isDev: true,
        env: { [UI_HARNESS_ENV]: '1', [HARNESS_CONTENT_REPO_BASE_ENV]: value },
      })

      expect(source).toBe(PRODUCTION_DOWNLOAD_SOURCE)
    })
  }

  it('normalises a trailing slash away so the joined manifest URL has exactly one', () => {
    const source = resolveDownloadSource({
      isDev: true,
      env: { [UI_HARNESS_ENV]: '1', [HARNESS_CONTENT_REPO_BASE_ENV]: `${LOOPBACK_BASE}/` },
    })

    expect(source.baseUrl).toBe(LOOPBACK_BASE)
  })
})

describe('the production package schema is never widened by the harness variant', () => {
  it('manifestPackageSchema still refuses a plain-http loopback URL', () => {
    expect(manifestPackageSchema.safeParse(loopbackPackageRow()).success).toBe(false)
  })

  it('harnessLoopbackManifestPackageSchema accepts it', () => {
    expect(harnessLoopbackManifestPackageSchema.safeParse(loopbackPackageRow()).success).toBe(true)
  })

  it('harnessLoopbackManifestPackageSchema still refuses a plain-http NON-loopback URL', () => {
    const row = loopbackPackageRow() as Record<string, unknown>
    row.url = 'http://example.test/packages/q2pro-fixture.zip'

    expect(harnessLoopbackManifestPackageSchema.safeParse(row).success).toBe(false)
  })

  it('harnessLoopbackManifestPackageSchema still requires size, sha256, mirrors and contents', () => {
    const row = loopbackPackageRow() as Record<string, unknown>
    delete row.sha256

    expect(harnessLoopbackManifestPackageSchema.safeParse(row).success).toBe(false)
  })

  it('parseManifestFile drops a loopback row by default and keeps it only with httpsOnly: false', () => {
    const file = { schemaVersion: 1, packages: [loopbackPackageRow()], pinned: { q2pro: 'q2pro-fixture' } }

    const production = parseManifestFile(file, silentLogger())
    const harness = parseManifestFile(file, silentLogger(), { httpsOnly: false })

    expect(production.ok && production.packages).toEqual([])
    expect(production.ok && production.pinned).toEqual({})
    expect(harness.ok && harness.packages).toHaveLength(1)
    expect(harness.ok && harness.pinned).toEqual({ q2pro: 'q2pro-fixture' })
  })
})

describe('the folder-picker stub is unreachable with either gate off', () => {
  it('both flags off: undefined, so the caller opens the real dialog', () => {
    expect(
      uiHarnessPickedFolders({
        isDev: false,
        env: { [UI_HARNESS_PICK_FOLDER_ENV]: 'C:\\fixtures' },
      }),
    ).toBeUndefined()
  })

  it('only Q2L_UI_HARNESS=1 (isDev false): still the real dialog', () => {
    expect(uiHarnessPickedFolders({ isDev: false, env: HARNESS_ENV })).toBeUndefined()
  })

  it('only isDev=true (Q2L_UI_HARNESS unset): still the real dialog', () => {
    expect(
      uiHarnessPickedFolders({ isDev: true, env: { [UI_HARNESS_PICK_FOLDER_ENV]: 'C:\\fixtures' } }),
    ).toBeUndefined()
  })

  it('only isDev=true and Q2L_UI_HARNESS set to something other than "1": still the real dialog', () => {
    expect(
      uiHarnessPickedFolders({ isDev: true, env: { ...HARNESS_ENV, [UI_HARNESS_ENV]: 'true' } }),
    ).toBeUndefined()
  })

  it('both flags on: the fixture paths come back in order, and no dialog is involved', () => {
    expect(uiHarnessPickedFolders({ isDev: true, env: HARNESS_ENV })).toEqual([
      'C:\\Program Files\\fixture-probe',
      'C:\\fixtures\\bootstrap-target',
    ])
  })

  it('both flags on but Q2L_UI_PICK_FOLDER unset: an empty list (a cancel), still without a dialog', () => {
    expect(uiHarnessPickedFolders({ isDev: true, env: { [UI_HARNESS_ENV]: '1' } })).toEqual([])
  })

  it('drops empty segments, so a trailing delimiter is not a phantom pick', () => {
    expect(
      uiHarnessPickedFolders({
        isDev: true,
        env: { [UI_HARNESS_ENV]: '1', [UI_HARNESS_PICK_FOLDER_ENV]: `C:\\one${delimiter}` },
      }),
    ).toEqual(['C:\\one'])
  })

  it('agrees with isUiHarnessEnabled on all four combinations', () => {
    expect(isUiHarnessEnabled({ isDev: false, env: {} })).toBe(false)
    expect(isUiHarnessEnabled({ isDev: false, env: { [UI_HARNESS_ENV]: '1' } })).toBe(false)
    expect(isUiHarnessEnabled({ isDev: true, env: {} })).toBe(false)
    expect(isUiHarnessEnabled({ isDev: true, env: { [UI_HARNESS_ENV]: '1' } })).toBe(true)
  })
})
