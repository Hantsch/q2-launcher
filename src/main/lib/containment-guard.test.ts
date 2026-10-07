import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainDir = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : []
  })
}

describe('path containment rule', () => {
  it('no local containment copy is left under src/main', () => {
    const banned = ['function ' + 'isInsideDir', 'startsWith(' + 'normalize(']
    const offenders = sourceFiles(mainDir).filter((file) => {
      const text = readFileSync(file, 'utf8')
      return banned.some((needle) => text.includes(needle))
    })
    expect(offenders).toEqual([])
  })

  it('ARCHITECTURE.md names isInside as the path rule', () => {
    const doc = readFileSync(join(mainDir, '..', '..', 'docs', 'ARCHITECTURE.md'), 'utf8')
    const paragraph = doc
      .split(/\r?\n\r?\n/)
      .find((p) => p.includes('**Paths are never trusted.**'))
    expect(paragraph).toBeDefined()
    expect(paragraph).toContain('isInside')
  })
})
