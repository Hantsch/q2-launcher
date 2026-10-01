import { describe, expect, it } from 'vitest'
import { isSafeGameDirName } from './gamedir'

describe('isSafeGameDirName', () => {
  it('accepts ordinary game directory names', () => {
    for (const name of ['rogue', 'action', 'ctf', 'open-tdm', 'my_mod.v2', 'a'.repeat(64)]) {
      expect(isSafeGameDirName(name)).toBe(true)
    }
  })

  it('refuses traversal, separators, dot names, baseq2 and non-ASCII', () => {
    const bad = [
      '', '.', '..', '../x', 'a/b', 'a\\b', '/abs', 'C:', 'C:\\x', 'a b', 'a\0b',
      'baseq2', 'BaseQ2', 'BASEQ2', 'm\u00f6del', '\u30e2\u30c3\u30c9', 'a'.repeat(65),
    ]
    for (const name of bad) expect(isSafeGameDirName(name), JSON.stringify(name)).toBe(false)
    expect(isSafeGameDirName(undefined)).toBe(false)
    expect(isSafeGameDirName(42)).toBe(false)
  })
})
