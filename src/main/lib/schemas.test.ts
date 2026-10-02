import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('schemas.ts uses the forgiving helpers', () => {
  it('schemas.ts holds no hand-rolled row parser', () => {
    const source = readFileSync(join(__dirname, 'schemas.ts'), 'utf8')
    expect(source.match(/safeParse/g)?.length ?? 0).toBeLessThanOrEqual(1)
    expect(source).not.toMatch(/function parse\w*Row\(/)
    expect(source).not.toContain('raw === undefined ? {} : raw')
  })
})
