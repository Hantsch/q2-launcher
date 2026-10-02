import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Story 205 D11: ARCHITECTURE.md must describe the typed module seam, not the old per-module chore. */
const doc = readFileSync(resolve(__dirname, '../../../docs/ARCHITECTURE.md'), 'utf-8')

describe('ARCHITECTURE.md', () => {
  it('Adding a module names defineModule and createModuleClient', () => {
    const start = doc.indexOf('## Adding a module')
    expect(start).toBeGreaterThan(-1)
    const end = doc.indexOf('\n## ', start + 1)
    const section = doc.slice(start, end === -1 ? undefined : end)
    expect(section).toContain('defineModule')
    expect(section).toContain('createModuleClient')
    expect(doc).not.toContain("Type safety per call is the module's own job")
  })
})
