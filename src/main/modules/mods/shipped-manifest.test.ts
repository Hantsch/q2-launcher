import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '../../lib/logger'
import { parseModCatalog } from './catalog-parse'

const MANIFEST_PATH = join(
  __dirname, '..', '..', '..', '..', 'content', 'q2_community_content', 'mods', 'manifest.json',
)

describe('shipped mods/manifest.json', () => {
  it('parses mods/manifest.json with action, opentdm and ctf and drops nothing', () => {
    const log = { warn: vi.fn() } as unknown as Logger
    const result = parseModCatalog(JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')), log)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.entries.map((e) => e.id)).toEqual(expect.arrayContaining(['action', 'opentdm', 'ctf']))
    expect(result.entries).toHaveLength(3)
    expect(log.warn).not.toHaveBeenCalled()
  })
})
