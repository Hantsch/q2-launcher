import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../../test-support/source-tree'
import { MODULE_LOCALES_EN } from '../modules/locales'
import { deepMerge, en } from './bundle'

// Keys are sorted on purpose: the split files merge shell-first, so the original interleaved
// namespace order is not preserved - only the content is pinned.
function sorted(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sorted(v)]),
  )
}

describe('the English bundle', () => {
  it('the merged bundle matches the pre-split snapshot', async () => {
    await expect(JSON.stringify(sorted(en), null, 2) + '\n').toMatchFileSnapshot(
      './__snapshots__/en.bundle.json',
    )
  })

  it('a leaf collision between locale files throws', () => {
    expect(() => deepMerge({ a: { b: 'x' } }, { a: { b: 'y' } })).toThrow('a.b')
    expect(deepMerge({ a: { b: 'x' } }, { a: { c: 'y' } })).toEqual({ a: { b: 'x', c: 'y' } })
  })

  it('every module locale file on disk is registered in modules/locales.ts', () => {
    const modules = join(REPO_ROOT, 'src/renderer/src/modules')
    const onDisk = readdirSync(modules, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && existsSync(join(modules, entry.name, 'locale/en.json')),
    )
    expect(MODULE_LOCALES_EN).toHaveLength(onDisk.length)
  })

  it("ARCHITECTURE.md's Adding-a-module names the module locale file", () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs/ARCHITECTURE.md'), 'utf8')
    const step = doc.slice(doc.indexOf('5. **Strings**'))
    expect(step.slice(0, 300)).toContain('modules/<id>/locale/en.json')
  })
})
