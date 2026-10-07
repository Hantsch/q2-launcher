import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '../../lib/logger'
import { parseModCatalog, toCatalogEntryDto } from './catalog-parse'

function fakeLogger(): Logger {
  return { warn: vi.fn() } as unknown as Logger
}

function pkg(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    version: '1',
    url: 'https://example.com/p1.zip',
    mirrors: [],
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    contents: [{ from: '.', to: 'gamedir' }],
    ...over,
  }
}

function version(packages: unknown[]) {
  return {
    version: '1.0',
    prerelease: false,
    variants: [{ platform: 'win32', arch: 'x64', packages }],
    contentOnly: { packages: [] },
  }
}

function entry(over: Record<string, unknown> = {}) {
  return {
    id: 'rogue',
    gamedir: 'rogue',
    name: 'Rogue',
    description: 'A mission pack.',
    license: 'GPL-2.0',
    projectUrl: 'https://example.com/',
    sourceUrl: 'https://example.com/src',
    pinned: '1.0',
    versions: [version([pkg()])],
    ...over,
  }
}

const env = (entries: unknown[], schemaVersion = 1) => ({ schemaVersion, entries })

describe('parseModCatalog', () => {
  it('an invalid entry is dropped with a warning and the others survive', () => {
    const log = fakeLogger()
    const bad = entry({ id: 'bad', gamedir: 'bad', versions: [{ version: '1.0' }] })
    const result = parseModCatalog(env([entry(), bad, entry({ id: 'ctf', gamedir: 'ctf' })]), log)
    if (!result.ok) throw new Error('expected ok')
    expect(result.entries.map((e) => e.id)).toEqual(['rogue', 'ctf'])
    expect(log.warn).toHaveBeenCalledTimes(1)
    const message = String(vi.mocked(log.warn).mock.calls[0][0])
    expect(message).toContain('index 1')
    expect(message).toContain('bad')
  })

  it('drops an entry whose pinned names no version, and duplicate id / gamedir', () => {
    const log = fakeLogger()
    const result = parseModCatalog(
      env([
        entry(),
        entry({ pinned: '9.9', id: 'x', gamedir: 'x' }),
        entry({ gamedir: 'other' }),
        entry({ id: 'dup2', gamedir: 'ROGUE' }),
      ]),
      log,
    )
    if (!result.ok) throw new Error('expected ok')
    expect(result.entries).toHaveLength(1)
    expect(log.warn).toHaveBeenCalledTimes(3)
  })

  it('each drop reason keeps its log wording', () => {
    const log = fakeLogger()
    const result = parseModCatalog(
      env([
        entry(),
        entry({ pinned: '9.9', id: 'x', gamedir: 'x' }),
        entry({ gamedir: 'other' }),
        entry({ id: 'dup2', gamedir: 'ROGUE' }),
        entry({ id: 'dup2', gamedir: 'free' }),
      ]),
      log,
    )
    if (!result.ok) throw new Error('expected ok')
    // The gamedir-duplicate row did not reserve its id, so the later "dup2" survives.
    expect(result.entries.map((e) => e.id)).toEqual(['rogue', 'dup2'])
    expect(vi.mocked(log.warn).mock.calls.map((c) => c[0])).toEqual([
      'mod catalog entry at index 1 (id: x) dropped: pinned "9.9" names no listed version',
      'mod catalog entry at index 2 (id: rogue) dropped: duplicate id',
      'mod catalog entry at index 3 (id: dup2) dropped: duplicate gamedir "ROGUE"',
    ])
  })

  it('a malformed envelope is refused', () => {
    const log = fakeLogger()
    expect(parseModCatalog({ entries: [] }, log)).toEqual({
      ok: false,
      reason: 'malformed-envelope',
    })
    expect(parseModCatalog({ schemaVersion: 1, entries: 'x' }, log)).toEqual({
      ok: false,
      reason: 'malformed-envelope',
    })
    expect(parseModCatalog(null, log)).toEqual({ ok: false, reason: 'malformed-envelope' })
    expect(parseModCatalog(env([], 2), log)).toEqual({
      ok: false,
      reason: 'unsupported-schema-version',
    })
  })

  it('an entry with an unsafe gamedir is refused at parse time', () => {
    for (const gamedir of ['..', 'a/b', 'baseq2', 'BaseQ2', 'C:\\x', 'm\u00f6del']) {
      const log = fakeLogger()
      const result = parseModCatalog(env([entry({ gamedir })]), log)
      if (!result.ok) throw new Error('expected ok')
      expect(result.entries, gamedir).toEqual([])
      expect(log.warn).toHaveBeenCalledTimes(1)
    }
  })

  it('an unsafe contents path is refused', () => {
    for (const from of ['../x', 'a/../b', 'a\\..\\b', '/etc', '\\x', 'C:/x', 'C:x', '']) {
      const bad = entry({ versions: [version([pkg({ contents: [{ from, to: 'gamedir' }] })])] })
      const result = parseModCatalog(env([bad]), fakeLogger())
      if (!result.ok) throw new Error('expected ok')
      expect(result.entries, from).toEqual([])
    }
    for (const from of ['.', 'ctf', 'aqtion/action', 'file.dll']) {
      const good = entry({ versions: [version([pkg({ contents: [{ from, to: 'gamedir' }] })])] })
      const result = parseModCatalog(env([good]), fakeLogger())
      if (!result.ok) throw new Error('expected ok')
      expect(result.entries, from).toHaveLength(1)
    }
  })

  it('refuses a plain-http package url unless the harness allowance applies', () => {
    const http = entry({ versions: [version([pkg({ url: 'http://127.0.0.1:8080/p.zip' })])] })
    const strict = parseModCatalog(env([http]), fakeLogger())
    const harness = parseModCatalog(env([http]), fakeLogger(), { httpsOnly: false })
    if (!strict.ok || !harness.ok) throw new Error('expected ok')
    expect(strict.entries).toHaveLength(0)
    expect(harness.entries).toHaveLength(1)
  })

  it('unknown fields never reach the projection', () => {
    const raw = entry({ secret: 'x' }) as Record<string, unknown>
    ;(raw.versions as Record<string, unknown>[])[0].extra = 1
    const result = parseModCatalog(env([raw]), fakeLogger())
    if (!result.ok) throw new Error('expected ok')
    expect(result.entries[0]).not.toHaveProperty('secret')
    const dto = toCatalogEntryDto(result.entries[0])
    expect(JSON.stringify(dto)).not.toContain('secret')
    expect(dto).not.toHaveProperty('variants')
    expect(dto.versions).toEqual([{ version: '1.0', prerelease: false }])
    expect(Object.keys(dto).sort()).toEqual(
      [
        'description',
        'gamedir',
        'id',
        'license',
        'name',
        'pinned',
        'projectUrl',
        'sourceUrl',
        'versions',
      ].sort(),
    )
  })
})
