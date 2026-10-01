import { describe, expect, it } from 'vitest'
import type { ModInstallRecord } from '@shared/modules/mods'
import { readModsState, recordedGameDirs, withRecord } from './install-records'

function record(over: Partial<ModInstallRecord> = {}): ModInstallRecord {
  return {
    catalogId: 'rogue',
    gameDir: 'rogue',
    version: '1.0',
    variantId: 'win32-x64',
    engineKind: 'q2pro',
    arch: 'x64',
    platform: 'win32',
    contentOnly: false,
    installedAt: 1,
    files: [{ path: 'pak0.pak', sizeBytes: 3, sha256: 'ab' }],
    ...over,
  }
}

describe('mod install record', () => {
  it('a malformed record is dropped, others survive', () => {
    const good = record()
    const state = readModsState({ mods: { records: [good, { gameDir: 'x' }, 42, null] } })
    expect(state.records).toEqual([good])
    expect(readModsState('garbage')).toEqual({ records: [] })
    expect(readModsState({ mods: 5 })).toEqual({ records: [] })
    expect(recordedGameDirs({ mods: { records: [good] } })).toEqual(new Set(['rogue']))
  })

  it('a record with a path escaping the gamedir is dropped', () => {
    const good = record()
    const bad = (path: string): ModInstallRecord => record({ files: [{ path, sizeBytes: 1, sha256: 'ab' }] })
    const rows = ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\b', 'a\0b', 'a//b'].map(bad)
    expect(readModsState({ mods: { records: [...rows, good] } }).records).toEqual([good])
  })

  it("writing a record keeps other modules' moduleData", () => {
    const old = record({ gameDir: 'Rogue', version: '0.9' })
    const next = withRecord({ downloads: { version: '2.34' }, mods: { records: [old] } }, record())
    expect(next['downloads']).toEqual({ version: '2.34' })
    expect(readModsState(next).records).toEqual([record()])
  })
})
