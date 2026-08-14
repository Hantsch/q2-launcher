import { describe, expect, it } from 'vitest'
import type { EngineKind, Installation } from '@shared/types'
import { buildLaunchArgs, isSafeEarlyToken, previewCommand } from './launch-plan'

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'test',
    name: 'Test',
    rootPath: 'C:\\Quake2',
    engineKind: 'r1q2' as EngineKind,
    executablePath: 'C:\\Quake2\\r1q2.exe',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: ['baseq2'],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

describe('buildLaunchArgs', () => {
  it('passes the engine default switches', () => {
    // r1q2 wants -nopathcheck; other engines declare none.
    expect(buildLaunchArgs(installation()).args).toEqual(['-nopathcheck'])
    expect(buildLaunchArgs(installation({ engineKind: 'vanilla' })).args).toEqual([])
  })

  it('never sets the base game directory', () => {
    expect(buildLaunchArgs(installation({ activeGameDir: 'baseq2' })).args).not.toContain('+set')
    expect(buildLaunchArgs(installation({ activeGameDir: 'BASEQ2' })).args).not.toContain('+set')
    expect(buildLaunchArgs(installation({ activeGameDir: '' })).args).not.toContain('+set')
  })

  it('sets a mod game directory', () => {
    expect(buildLaunchArgs(installation({ activeGameDir: 'ctf' })).args).toEqual([
      '-nopathcheck',
      '+set',
      'game',
      'ctf',
    ])
  })

  it('lets a per-launch game directory override the stored one', () => {
    const result = buildLaunchArgs(installation({ activeGameDir: 'ctf' }), { gameDir: 'rogue' })
    expect(result.args).toContain('rogue')
    expect(result.args).not.toContain('ctf')
  })

  it('drops a game directory that could not survive the trip into r1q2', () => {
    // r1q2's early parser cannot group spaces and treats bytes > 126 as
    // separators; quotes and backslashes get mangled by Windows argument
    // escaping, which r1q2's hand-rolled parser never undoes.
    for (const bad of ['my mod', 'mödchen', 'a"b', 'a\\b']) {
      const result = buildLaunchArgs(installation({ activeGameDir: bad }))
      expect(result.args).not.toContain('+set')
      expect(result.dropped).toEqual([{ reason: 'unsafe-token', value: bad }])
    }
  })

  it('puts +connect last so it runs after the config is applied', () => {
    const result = buildLaunchArgs(
      installation({ activeGameDir: 'ctf', launchArgs: ['+set', 'cl_maxfps', '125'] }),
      { connect: '1.2.3.4:27910', extraArgs: ['+exec', 'match.cfg'] },
    )
    expect(result.args).toEqual([
      '-nopathcheck',
      '+set',
      'game',
      'ctf',
      '+set',
      'cl_maxfps',
      '125',
      '+exec',
      'match.cfg',
      '+connect',
      '1.2.3.4:27910',
    ])
  })
})

describe('isSafeEarlyToken', () => {
  it('accepts printable ASCII without spaces', () => {
    expect(isSafeEarlyToken('ctf')).toBe(true)
    expect(isSafeEarlyToken('my-mod_2.0')).toBe(true)
  })

  it('rejects spaces, empty strings, non-ASCII, quotes and backslashes', () => {
    expect(isSafeEarlyToken('')).toBe(false)
    expect(isSafeEarlyToken('my mod')).toBe(false)
    expect(isSafeEarlyToken('mödchen')).toBe(false)
    expect(isSafeEarlyToken('a"b')).toBe(false)
    expect(isSafeEarlyToken('a\\b')).toBe(false)
  })
})

describe('previewCommand', () => {
  it('quotes only what needs quoting', () => {
    expect(previewCommand('C:\\Program Files\\Quake2\\r1q2.exe', ['+set', 'game', 'ctf'])).toBe(
      '"C:\\Program Files\\Quake2\\r1q2.exe" +set game ctf',
    )
  })
})
