import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '../../lib/logger'
import { parseModCatalog } from './catalog-parse'
import { selectVariant } from './engine-target'

const MANIFEST_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'content',
  'q2_community_content',
  'mods',
  'manifest.json',
)

describe('shipped mods/manifest.json', () => {
  it('parses mods/manifest.json with action, opentdm and ctf and drops nothing', () => {
    const log = { warn: vi.fn() } as unknown as Logger
    const result = parseModCatalog(JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')), log)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.entries.map((e) => e.id)).toEqual(
      expect.arrayContaining(['action', 'opentdm', 'ctf']),
    )
    expect(result.entries).toHaveLength(3)
    expect(log.warn).not.toHaveBeenCalled()
  })

  describe('OpenTDM r388', () => {
    const openTdmR388 = () => {
      const log = { warn: vi.fn() } as unknown as Logger
      const result = parseModCatalog(JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')), log)
      if (!result.ok) throw new Error('expected ok result')
      const version = result.entries
        .find((e) => e.id === 'opentdm')
        ?.versions.find((v) => v.version === 'r388')
      if (!version) throw new Error('opentdm r388 missing')
      return version
    }

    it('OpenTDM on a 64-bit Windows Q2PRO installs content-only with only its example config', () => {
      const selection = selectVariant(openTdmR388(), {
        platform: 'win32',
        arch: 'x86_64',
        engineKind: 'q2pro',
      })
      if (!('variant' in selection)) throw new Error('expected a variant')
      expect(selection.contentOnly).toBe(true)
      expect(selection.variant.packages.flatMap((p) => p.contents.map((c) => c.from))).toEqual([
        'example-opentdm.cfg',
      ])
    })

    it('OpenTDM on a 32-bit Windows engine still installs its game library', () => {
      const selection = selectVariant(openTdmR388(), {
        platform: 'win32',
        arch: 'x86',
        engineKind: 'r1q2',
      })
      if (!('variant' in selection)) throw new Error('expected a variant')
      expect(selection.contentOnly).toBe(false)
    })
  })
})
