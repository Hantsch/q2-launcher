import { describe, expect, it } from 'vitest'
import type { ModInstallRecord } from '@shared/modules/mods'
import {
  readLastLaunch,
  readModsState,
  recordedGameDirs,
  withLastLaunch,
  withRecord,
  withRecords,
} from './install-records'

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
    const bad = (path: string): ModInstallRecord =>
      record({ files: [{ path, sizeBytes: 1, sha256: 'ab' }] })
    const rows = ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\b', 'a\0b', 'a//b'].map(bad)
    expect(readModsState({ mods: { records: [...rows, good] } }).records).toEqual([good])
  })

  it("writing a record keeps other modules' moduleData", () => {
    const old = record({ gameDir: 'Rogue', version: '0.9' })
    const next = withRecord({ downloads: { version: '2.34' }, mods: { records: [old] } }, record())
    expect(next['downloads']).toEqual({ version: '2.34' })
    expect(readModsState(next).records).toEqual([record()])
  })

  it('a record write keeps the remembered launch', () => {
    const choice = { gameDir: 'rogue', map: 'rmine1', gameType: 'single' as const }
    const remembered = withLastLaunch({ mods: { records: [record()] } }, choice)
    const installed = withRecord(remembered, record({ catalogId: 'xatrix', gameDir: 'xatrix' }))
    expect(readLastLaunch(installed)).toEqual(choice)
    const removed = withRecords(installed, [])
    expect(readLastLaunch(removed)).toEqual(choice)
    expect(readModsState(removed).records).toEqual([])
  })

  it('remembering a launch keeps the install records', () => {
    const rec = record()
    const next = withLastLaunch(
      { downloads: { version: '2.34' }, mods: { records: [rec] } },
      { gameDir: '', map: null, gameType: 'deathmatch' },
    )
    expect(readModsState(next).records).toEqual([rec])
    expect(recordedGameDirs(next)).toEqual(new Set(['rogue']))
    expect(next['downloads']).toEqual({ version: '2.34' })
    expect(readLastLaunch(next)).toEqual({ gameDir: '', map: null, gameType: 'deathmatch' })
  })

  it('a garbage lastLaunch reads as null', () => {
    const at = (lastLaunch: unknown) => readLastLaunch({ mods: { records: [], lastLaunch } })
    expect(readLastLaunch(undefined)).toBeNull()
    expect(readLastLaunch({ mods: { records: [] } })).toBeNull()
    expect(at(42)).toBeNull()
    expect(at({ gameDir: '../x', map: null, gameType: 'single' })).toBeNull()
    expect(at({ gameDir: 'rogue', map: 'a/b', gameType: 'single' })).toBeNull()
    expect(at({ gameDir: 'rogue', map: null, gameType: 'coop' })).toBeNull()
    expect(at({ gameDir: 'rogue', gameType: 'single' })).toBeNull()
  })
})
