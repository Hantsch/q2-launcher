import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FIXTURE_VARIANTS, VARIANTS, writeFixture } from '../fixture.mjs'

const MAX_LINES = 1500
const here = dirname(fileURLToPath(import.meta.url))

describe('fixture layout', () => {
  it('every fixture file stays under 1,500 lines and every variant has a writer', () => {
    const files = [
      join(here, '..', 'fixture.mjs'),
      ...readdirSync(here)
        .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
        .map((f) => join(here, f)),
    ]
    for (const file of files) {
      expect(readFileSync(file, 'utf8').split('\n').length, file).toBeLessThanOrEqual(MAX_LINES)
    }
    expect(Object.keys(VARIANTS)).toEqual(FIXTURE_VARIANTS)
    for (const writer of Object.values(VARIANTS)) expect(typeof writer).toBe('function')
    expect(() => writeFixture('nope')).toThrow(/unknown fixture variant/)
  })
})
