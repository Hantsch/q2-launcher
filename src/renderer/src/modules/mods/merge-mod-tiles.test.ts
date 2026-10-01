import { describe, expect, it } from 'vitest'
import type { ModCatalogEntry, ModGameDir } from '@shared/modules/mods'
import { mergeModTiles } from './merge-mod-tiles'

const entry = (gamedir: string, name: string): ModCatalogEntry => ({
  id: gamedir,
  gamedir,
  name,
  description: `${name} description`,
  license: 'GPL-2.0',
  projectUrl: 'https://example.invalid',
  sourceUrl: 'https://example.invalid',
  pinned: 'v1',
  versions: [{ version: 'v1', prerelease: false }],
})
const dir = (gameDir: string): ModGameDir => ({
  gameDir,
  folderPath: `/g/${gameDir}`,
  origin: 'manual',
})

describe('mergeModTiles', () => {
  it('makes a catalog tile with name and description for an absent directory', () => {
    expect(mergeModTiles([entry('action', 'Action')], [])).toEqual([
      {
        gameDir: 'action',
        name: 'Action',
        description: 'Action description',
        local: null,
        catalog: entry('action', 'Action'),
      },
    ])
  })

  it('merges a local directory into the catalog tile, case-insensitively', () => {
    const tiles = mergeModTiles([entry('ctf', 'CTF')], [dir('CTF')])
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({ gameDir: 'CTF', name: 'CTF', local: dir('CTF') })
  })

  it('keeps local-only directories unchanged and after the catalog tiles', () => {
    const tiles = mergeModTiles([entry('action', 'Action')], [dir('rogue')])
    expect(tiles.map((t) => t.gameDir)).toEqual(['action', 'rogue'])
    expect(tiles[1]).toEqual({
      gameDir: 'rogue',
      name: null,
      description: null,
      local: dir('rogue'),
      catalog: null,
    })
  })

  it('yields one tile for duplicate catalog gamedirs', () => {
    expect(mergeModTiles([entry('a', 'A'), entry('A', 'A2')], [])).toHaveLength(1)
  })
})
