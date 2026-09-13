import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HARNESS_CONTENT_REPO_BASE_ENV,
  HARNESS_EXTERNAL_URLS_FILE,
  parseHarnessBaseUrl,
  recordHarnessExternalUrl,
} from './ui-harness'

/**
 * Story 082 D4: `HARNESS_CONTENT_REPO_BASE_ENV` and `parseHarnessBaseUrl()` moved here from
 * `src/main/modules/downloads/harness.ts` so `src/main/modules/home/news/harness.ts` can reuse them
 * without a module-to-module import. This file covers the parser itself; what each caller *does*
 * with an `undefined` result (fall back to production vs. skip) is that caller's own test -
 * `downloads/harness.test.ts` and `home/news/harness.test.ts` respectively.
 *
 * Story 099 D6: `recordHarnessExternalUrl` is the file half of the `app:openExternal` recorder -
 * the gating decision itself is just `isUiHarnessEnabled()`, already covered by this file's other
 * exports' tests (`uiHarnessPickedFolders`'s "agrees with isUiHarnessEnabled" case, and
 * `downloads/harness.test.ts`'s four-case tables), so this suite focuses on what is new here: does
 * the file actually get written, correctly, across repeated calls, starting from no file at all.
 * It lives alongside the pre-existing `parseHarnessBaseUrl` coverage above, not in place of it.
 *
 * Real files in an `mkdtemp` directory via the `filePath` override, exactly like
 * `services/update/store.test.ts` - the criterion under test is what lands on disk.
 */

describe('HARNESS_CONTENT_REPO_BASE_ENV', () => {
  it('is the variable name downloads and news both read', () => {
    expect(HARNESS_CONTENT_REPO_BASE_ENV).toBe('Q2L_UI_CONTENT_REPO_BASE')
  })
})

describe('parseHarnessBaseUrl', () => {
  it('accepts a bare http 127.0.0.1 origin', () => {
    expect(parseHarnessBaseUrl('http://127.0.0.1:53129')).toBe('http://127.0.0.1:53129')
  })

  it('accepts an https 127.0.0.1 origin', () => {
    expect(parseHarnessBaseUrl('https://127.0.0.1:53129')).toBe('https://127.0.0.1:53129')
  })

  it('normalises a trailing slash away', () => {
    expect(parseHarnessBaseUrl('http://127.0.0.1:53129/')).toBe('http://127.0.0.1:53129')
  })

  it('preserves a non-trailing-slash path', () => {
    expect(parseHarnessBaseUrl('http://127.0.0.1:53129/fixtures')).toBe(
      'http://127.0.0.1:53129/fixtures',
    )
  })

  it('answers undefined for undefined', () => {
    expect(parseHarnessBaseUrl(undefined)).toBeUndefined()
  })

  it('answers undefined for an empty string', () => {
    expect(parseHarnessBaseUrl('')).toBeUndefined()
  })

  it('refuses a non-loopback host', () => {
    expect(parseHarnessBaseUrl('http://example.test:8080')).toBeUndefined()
  })

  it('refuses localhost - only the literal 127.0.0.1 counts', () => {
    expect(parseHarnessBaseUrl('http://localhost:53129')).toBeUndefined()
  })

  it('refuses a neighbouring loopback address', () => {
    expect(parseHarnessBaseUrl('http://127.0.0.2:53129')).toBeUndefined()
  })

  it('refuses a non-http(s) scheme', () => {
    expect(parseHarnessBaseUrl('file:///C:/tmp/manifests')).toBeUndefined()
  })

  it('refuses junk that is not a URL at all', () => {
    expect(parseHarnessBaseUrl('not-a-url')).toBeUndefined()
  })
})

let dir: string
let filePath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-ui-harness-'))
  filePath = join(dir, HARNESS_EXTERNAL_URLS_FILE)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readUrls(): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

describe('recordHarnessExternalUrl', () => {
  it('creates the file starting from [] and records the first url', async () => {
    await recordHarnessExternalUrl('https://example.test/one', { filePath })

    expect(await readUrls()).toEqual(['https://example.test/one'])
  })

  it('accumulates urls across repeated calls, in call order', async () => {
    await recordHarnessExternalUrl('https://example.test/one', { filePath })
    await recordHarnessExternalUrl('https://example.test/two', { filePath })
    await recordHarnessExternalUrl('https://example.test/three', { filePath })

    expect(await readUrls()).toEqual([
      'https://example.test/one',
      'https://example.test/two',
      'https://example.test/three',
    ])
  })

  it('defaults to [] and recovers instead of throwing when the existing file is malformed', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(filePath, 'not valid json', 'utf8')

    await recordHarnessExternalUrl('https://example.test/after-corruption', { filePath })

    expect(await readUrls()).toEqual(['https://example.test/after-corruption'])
  })
})
