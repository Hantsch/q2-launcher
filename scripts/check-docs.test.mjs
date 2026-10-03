import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { checkDocs, fixDocs } from './check-docs.mjs'

const roots = []

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'check-docs-'))
  roots.push(root)
  const all = {
    'package.json': '{"version":"1.2.3"}',
    'README.md': '**Status: beta (1.2.3).**\n',
    ...files,
  }
  for (const [rel, content] of Object.entries(all)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe('check-docs', () => {
  test('a broken relative md link is reported', () => {
    const root = fixture({
      'docs/a.md': '[ok](b.md) [bad](missing.md#x)\n',
      'docs/b.md': 'b\n',
    })
    expect(checkDocs(root).brokenLinks).toEqual([{ file: 'docs/a.md', target: 'missing.md#x' }])
  })

  test('links in code spans, fences, external and anchor-only links are ignored', () => {
    const root = fixture({
      'docs/a.md': [
        'inline `[x](nope.md)` here',
        '```',
        '[y](nope2.md)',
        '```',
        '[ext](https://example.com/z.md) [anchor](#top) [img](pic.png)',
        '',
      ].join('\n'),
    })
    expect(checkDocs(root)).toEqual({ brokenLinks: [], versionMismatch: null })
  })

  test('a README version that differs from package.json is reported', () => {
    const root = fixture({ 'README.md': '**Status: pre-release (0.3.0).**\n' })
    expect(checkDocs(root).versionMismatch).toEqual({ readme: '0.3.0', pkg: '1.2.3' })
    const none = fixture({ 'README.md': 'no status\n' })
    expect(checkDocs(none).versionMismatch).toEqual({ readme: null, pkg: '1.2.3' })
  })

  test('--fix rewrites a link to a uniquely moved file and leaves an ambiguous one', () => {
    const root = fixture({
      'docs/a.md': '[m](old/moved.md#sec) [d](dup.md)\n',
      'docs/new/moved.md': 'm\n',
      'docs/x/dup.md': '1\n',
      'docs/y/dup.md': '2\n',
    })
    const result = fixDocs(root)
    expect(result.fixed).toHaveLength(1)
    expect(result.unresolved).toEqual([{ file: 'docs/a.md', target: 'dup.md' }])
    expect(readFileSync(path.join(root, 'docs/a.md'), 'utf8')).toBe(
      '[m](new/moved.md#sec) [d](dup.md)\n',
    )
  })
})

describe('the repo itself', () => {
  test("the repo's docs have no broken links and README matches package.json", () => {
    const result = checkDocs(path.resolve(import.meta.dirname, '..'))
    expect(result.brokenLinks).toEqual([])
    expect(result.versionMismatch).toBeNull()
  })
})
