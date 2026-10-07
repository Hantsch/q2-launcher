import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

describe('flow assertion rules', () => {
  test('UI-VERIFICATION.md says what a flow may assert and the sprint profile points at it', () => {
    const doc = read('docs/UI-VERIFICATION.md')
    const start = doc.indexOf('## What a flow may assert')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(start).toBeLessThan(doc.indexOf('## How to write a flow'))

    const section = doc.slice(start, doc.indexOf('## How to write a flow'))
    expect(section).toMatch(/cvar values/i)
    expect(section).toMatch(/Tab-key/i)
    expect(section).toMatch(/fixture ordinals/i)
    expect(section).toMatch(/pixel geometry/i)

    const profile = read('.claude/ai-scrum.md')
    const notes = profile.slice(profile.indexOf('## Notes'))
    expect(notes).toContain('docs/UI-VERIFICATION.md#what-a-flow-may-assert')
  })
})
