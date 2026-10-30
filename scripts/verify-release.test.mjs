import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'verify-release.mjs'),
  'utf-8',
)

describe('verify:release', () => {
  test('verify:release starts no act run and needs no Docker', () => {
    expect(SOURCE).not.toMatch(/\.\/lib\/act\.mjs/)
    expect(SOURCE).not.toMatch(/\.\/lib\/build-linux-workflow\.mjs/)
    expect(SOURCE).not.toMatch(/\.github\/workflows\//)
  })
})
