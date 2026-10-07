import { describe, expect, it } from 'vitest'
import {
  findCatalogEntryByGameDir,
  isSafeGameName,
  mapLookupTarget,
  serverModStatus,
} from './server-local-content'

const catalog = [
  { id: 'rogue', gameDir: 'rogue' },
  { id: 'ctf-pack', gameDir: 'CTF' },
]

describe('isSafeGameName', () => {
  it('accepts plain names including baseq2', () => {
    for (const n of ['baseq2', 'q2dm1', 'my-mod_1.2', 'A']) expect(isSafeGameName(n)).toBe(true)
  })
  it('refuses traversal, spaces, dots, empty and overlong', () => {
    for (const n of ['../x', 'a/b', 'a\\b', 'my mod', '.', '..', '', 'ä', 'x'.repeat(65)])
      expect(isSafeGameName(n)).toBe(false)
    expect(isSafeGameName('x'.repeat(64))).toBe(true)
  })
})

describe('serverModStatus', () => {
  it('baseq2 and an empty mod are the base game', () => {
    for (const serverMod of [undefined, '', '   ', 'baseq2', 'BaseQ2', ' baseq2 ']) {
      expect(serverModStatus({ serverMod, gameDirs: ['rogue'], catalog })).toEqual({ kind: 'base' })
    }
  })

  it('a gamedir in gameDirs is installed, case-insensitively', () => {
    expect(serverModStatus({ serverMod: 'rogue', gameDirs: ['rogue'], catalog })).toEqual({
      kind: 'installed',
      gameDir: 'rogue',
    })
    expect(serverModStatus({ serverMod: 'ROGUE', gameDirs: ['rogue'], catalog: null })).toEqual({
      kind: 'installed',
      gameDir: 'rogue',
    })
    expect(serverModStatus({ serverMod: 'ctf', gameDirs: ['Ctf'], catalog: null }).kind).toBe(
      'installed',
    )
  })

  it('a safe, absent mod is missing and installable when the catalog has it', () => {
    expect(serverModStatus({ serverMod: 'Ctf', gameDirs: [], catalog })).toEqual({
      kind: 'missing',
      gameDir: 'Ctf',
      safe: true,
      catalogId: 'ctf-pack',
    })
  })

  it('no catalog entry or an unavailable catalog gives no catalogId', () => {
    expect(serverModStatus({ serverMod: 'zaero', gameDirs: [], catalog })).toEqual({
      kind: 'missing',
      gameDir: 'zaero',
      safe: true,
      catalogId: null,
    })
    expect(serverModStatus({ serverMod: 'rogue', gameDirs: [], catalog: null })).toMatchObject({
      kind: 'missing',
      catalogId: null,
    })
    expect(serverModStatus({ serverMod: 'rogue', gameDirs: [], catalog: [] })).toMatchObject({
      kind: 'missing',
      catalogId: null,
    })
  })

  it('an unsafe gamedir is never installed, never installable and never a lookup target', () => {
    const unsafeCatalog = [
      { id: 'evil', gameDir: '../x' },
      { id: 'dot', gameDir: '.' },
      { id: 'sp', gameDir: 'my mod' },
    ]
    for (const mod of ['../x', 'my mod', '.', '..']) {
      const status = serverModStatus({
        serverMod: mod,
        gameDirs: [mod, '../x', 'my mod', '.', '..'],
        catalog: unsafeCatalog,
      })
      expect(status).toEqual({ kind: 'missing', gameDir: mod, safe: false, catalogId: null })
      expect(mapLookupTarget(status, 'q2dm1')).toEqual({ map: 'q2dm1' })
      expect(mapLookupTarget(status, 'q2dm1')).not.toHaveProperty('gameDir')
    }
  })
})

describe('findCatalogEntryByGameDir', () => {
  it('matches case-insensitively and returns the entry', () => {
    expect(findCatalogEntryByGameDir(catalog, 'ctf')).toBe(catalog[1])
    expect(findCatalogEntryByGameDir(catalog, 'ROGUE')).toBe(catalog[0])
  })
  it('returns null for no match, null catalog or unsafe name', () => {
    expect(findCatalogEntryByGameDir(catalog, 'nope')).toBeNull()
    expect(findCatalogEntryByGameDir(null, 'rogue')).toBeNull()
    expect(findCatalogEntryByGameDir([{ id: 'x', gameDir: '..' }], '..')).toBeNull()
  })
})

describe('mapLookupTarget', () => {
  const installed = { kind: 'installed', gameDir: 'rogue' } as const
  const missing = { kind: 'missing', gameDir: 'zaero', safe: true, catalogId: null } as const

  it('is null for an empty or unsafe map', () => {
    for (const map of [undefined, '', '../x', 'a b', '.', '..'])
      expect(mapLookupTarget(installed, map)).toBeNull()
  })
  it('carries the gamedir for installed and safe-missing', () => {
    expect(mapLookupTarget(installed, 'q2dm1')).toEqual({ map: 'q2dm1', gameDir: 'rogue' })
    expect(mapLookupTarget(missing, 'q2dm1')).toEqual({ map: 'q2dm1', gameDir: 'zaero' })
  })
  it('has no gamedir for base', () => {
    expect(mapLookupTarget({ kind: 'base' }, 'q2dm1')).toEqual({ map: 'q2dm1' })
  })
})
