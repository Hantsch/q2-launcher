import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT, readRepoFile } from './source-tree'

const REFUSED = /unit lane read project doc (.+) — move the test to a \*\.docs\.test\.\* file/

describe('doc read guard', () => {
  it('reading a project doc in the unit lane throws', () => {
    expect(() => readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf-8')).toThrow(
      'unit lane read project doc CLAUDE.md',
    )
    expect(() => readRepoFile('docs/ARCHITECTURE.md')).toThrow(
      'unit lane read project doc docs/ARCHITECTURE.md',
    )
    expect(() => readFileSync(pathToFileURL(join(REPO_ROOT, 'docs/ROADMAP.md')))).toThrow(REFUSED)
    expect(() => readFileSync(Buffer.from(join(REPO_ROOT, 'CLAUDE.md')))).toThrow(REFUSED)
    expect(() => readFile(join(REPO_ROOT, '.claude/commands/build.md'), 'utf-8')).toThrow(
      'unit lane read project doc .claude/commands/build.md',
    )
  })

  it('reading source, fixtures and README stays allowed', async () => {
    expect(readRepoFile('src/test-support/source-tree.ts')).toContain('REPO_ROOT')
    expect(readFileSync(join(REPO_ROOT, 'docs/fixtures/dm.cfg'), 'utf-8').length).toBeGreaterThan(0)
    expect(readRepoFile('README.md').length).toBeGreaterThan(0)
    expect(await readFile(join(REPO_ROOT, 'package.json'), 'utf-8')).toContain('"vitest"')
  })
})
