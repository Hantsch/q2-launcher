import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '../../lib/logger'
import {
  classifyCheckError,
  configureAutoUpdater,
  createUpdateChecker,
  releaseNotesHtmlToMarkdown,
  type AutoUpdaterCheckResult,
  type AutoUpdaterLike,
} from './checker'

/**
 * Story 097 D4 acceptance tests. Every test fakes the `autoUpdater`-like object directly, so this
 * file never imports `electron-updater` or Electron - `createUpdateChecker()` only reaches the
 * real package via a dynamic `import()` that these tests never trigger, because they always pass
 * an `autoUpdater` fake.
 */

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
}

function fakeAutoUpdater(
  checkForUpdates: () => Promise<AutoUpdaterCheckResult | null>,
): AutoUpdaterLike {
  return {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    logger: null,
    checkForUpdates,
  }
}

describe('configureAutoUpdater', () => {
  it('turns autoDownload and autoInstallOnAppQuit off and allowPrerelease on', () => {
    const target = fakeAutoUpdater(async () => null)
    const log = fakeLogger()

    configureAutoUpdater(target, log)

    expect(target.autoDownload).toBe(false)
    expect(target.autoInstallOnAppQuit).toBe(false)
    expect(target.allowPrerelease).toBe(true)
    expect(target.logger).toBe(log)
  })
})

describe('createUpdateChecker - an available release', () => {
  it('is normalised to version, notes and releasedAt', async () => {
    const autoUpdater = fakeAutoUpdater(async () => ({
      isUpdateAvailable: true,
      updateInfo: {
        version: '1.0.0-beta.2',
        releaseNotes: 'Fixed the thing.',
        releaseDate: '2026-09-12T10:00:00.000Z',
      },
    }))
    const check = createUpdateChecker({ autoUpdater })

    const outcome = await check()

    expect(outcome).toEqual({
      ok: true,
      available: true,
      update: {
        version: '1.0.0-beta.2',
        notes: 'Fixed the thing.',
        releasedAt: '2026-09-12T10:00:00.000Z',
      },
    })
  })

  it('joins array-form release notes and caps them at 20000 characters', async () => {
    const autoUpdater = fakeAutoUpdater(async () => ({
      isUpdateAvailable: true,
      updateInfo: {
        version: '1.0.0-beta.3',
        releaseNotes: [
          { version: '1.0.0-beta.3', note: 'a'.repeat(15_000) },
          { version: '1.0.0-beta.2', note: 'b'.repeat(15_000) },
        ],
        releaseDate: null,
      },
    }))
    const check = createUpdateChecker({ autoUpdater })

    const outcome = await check()

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !outcome.available) throw new Error('expected an available outcome')
    expect(outcome.update.notes).toHaveLength(20_000)
    expect(outcome.update.notes.startsWith('a'.repeat(100))).toBe(true)
    expect(outcome.update.releasedAt).toBeNull()
  })

  it('treats a missing note entry as an empty string rather than "null"', async () => {
    const autoUpdater = fakeAutoUpdater(async () => ({
      isUpdateAvailable: true,
      updateInfo: {
        version: '1.0.0-beta.4',
        releaseNotes: [{ version: '1.0.0-beta.4', note: null }],
        releaseDate: '2026-09-13T00:00:00.000Z',
      },
    }))
    const check = createUpdateChecker({ autoUpdater })

    const outcome = await check()

    expect(outcome).toEqual({
      ok: true,
      available: true,
      update: { version: '1.0.0-beta.4', notes: '', releasedAt: '2026-09-13T00:00:00.000Z' },
    })
  })
})

describe('createUpdateChecker - no newer release', () => {
  it('reports available: false when isUpdateAvailable is false', async () => {
    const autoUpdater = fakeAutoUpdater(async () => ({
      isUpdateAvailable: false,
      updateInfo: { version: '1.0.0-beta.1', releaseNotes: null, releaseDate: null },
    }))
    const check = createUpdateChecker({ autoUpdater })

    await expect(check()).resolves.toEqual({ ok: true, available: false })
  })

  it('reports available: false when checkForUpdates() itself resolves null', async () => {
    const autoUpdater = fakeAutoUpdater(async () => null)
    const check = createUpdateChecker({ autoUpdater })

    await expect(check()).resolves.toEqual({ ok: true, available: false })
  })
})

describe('classifyCheckError', () => {
  it('maps an offline/network-style error to "network"', () => {
    const error = Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), {
      code: 'ENOTFOUND',
    })
    expect(classifyCheckError(error)).toBe('network')
  })

  it('maps an HTTP-style error response to "http"', () => {
    const error = Object.assign(new Error('HttpError: 404 Not Found'), { statusCode: 404 })
    expect(classifyCheckError(error)).toBe('http')
  })

  it('maps a missing-config-style error to "notConfigured"', () => {
    const error = Object.assign(
      new Error("ENOENT: no such file or directory, open 'app-update.yml'"),
      { code: 'ENOENT' },
    )
    expect(classifyCheckError(error)).toBe('notConfigured')
  })

  it('maps some unknown/other thrown error to "unknown"', () => {
    expect(classifyCheckError(new Error('something unrelated broke'))).toBe('unknown')
    expect(classifyCheckError('a thrown string, not even an Error')).toBe('unknown')
  })
})

describe('createUpdateChecker - error mapping end to end', () => {
  it('resolves with the reason classifyCheckError would give, for each distinct cause', async () => {
    const cases: Array<{
      error: unknown
      reason: 'network' | 'http' | 'notConfigured' | 'unknown'
    }> = [
      { error: Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }), reason: 'network' },
      { error: Object.assign(new Error('bad gateway'), { statusCode: 502 }), reason: 'http' },
      {
        error: Object.assign(new Error('ENOENT: app-update.yml'), { code: 'ENOENT' }),
        reason: 'notConfigured',
      },
      { error: new Error('boom'), reason: 'unknown' },
    ]

    for (const { error, reason } of cases) {
      const autoUpdater = fakeAutoUpdater(async () => {
        throw error
      })
      const check = createUpdateChecker({ autoUpdater, log: fakeLogger() })
      await expect(check()).resolves.toEqual({ ok: false, reason })
    }
  })

  it('never throws itself even when checkForUpdates() rejects', async () => {
    const autoUpdater = fakeAutoUpdater(async () => {
      throw new Error('rejected')
    })
    const check = createUpdateChecker({ autoUpdater, log: fakeLogger() })

    await expect(check()).resolves.toEqual({ ok: false, reason: 'unknown' })
  })
})

describe('createUpdateChecker - resolving the real electron-updater module', () => {
  afterEach(() => {
    vi.doUnmock('electron-updater')
    vi.resetModules()
  })

  it('does not reject when the module fails to resolve, and retries instead of replaying a cached rejection', async () => {
    vi.resetModules()
    // `electron-updater`'s own `autoUpdater` export is a lazy getter (see checker.ts's top
    // comment) - accessing it is what can throw, not the dynamic `import()` itself. The first
    // access fails (simulating a platform-updater construction error); every access after that
    // succeeds, so a later check can retry instead of being stuck replaying the first failure.
    let accesses = 0
    const updater = fakeAutoUpdater(async () => null)
    vi.doMock('electron-updater', () => ({
      get autoUpdater() {
        accesses += 1
        if (accesses === 1) throw new Error('platform updater construction failed')
        return updater
      },
    }))

    const { createUpdateChecker: freshCreateUpdateChecker } = await import('./checker')
    const check = freshCreateUpdateChecker({ log: fakeLogger() })

    await expect(check()).resolves.toEqual({ ok: false, reason: 'unknown' })
    await expect(check()).resolves.toEqual({ ok: true, available: false })
  })
})

describe('releaseNotesHtmlToMarkdown', () => {
  it("maps GitHub's rendered release body back onto the ### / - subset", () => {
    // The shape GitHub's releases.atom delivers for a `### Added` + `- **Linux** — …` body.
    const html = [
      '<h3>Added</h3>',
      '<ul>',
      '<li><strong>Linux</strong> — a Windows build<br>',
      'now plays on Linux &amp; Steam&#39;s too.</li>',
      '<li><a href="https://example.com">Link</a> &lt;script&gt;</li>',
      '</ul>',
      '<h3>Fixed</h3>',
      '<ul>',
      '<li>A <code>bug</code>.</li>',
      '</ul>',
    ].join('\n')

    expect(releaseNotesHtmlToMarkdown(html)).toBe(
      [
        '### Added',
        '',
        "- Linux — a Windows build now plays on Linux & Steam's too.",
        '',
        '- Link <script>',
        '',
        '### Fixed',
        '',
        '- A bug.',
      ].join('\n'),
    )
  })

  it('passes a body without tags through unchanged', () => {
    expect(releaseNotesHtmlToMarkdown('### Added\n- a <b thing')).toBe('### Added\n- a <b thing')
  })

  it('is what the checker hands on as notes', async () => {
    const autoUpdater = fakeAutoUpdater(async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: '1.0.0', releaseNotes: '<h3>Added</h3><ul><li>x</li></ul>' },
    }))

    const outcome = await createUpdateChecker({ autoUpdater })()

    if (!outcome.ok || !outcome.available) throw new Error('expected an available outcome')
    expect(outcome.update.notes).toBe('### Added\n\n- x')
  })
})
