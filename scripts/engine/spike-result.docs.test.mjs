import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const normalise = (text) => text.replace(/\r\n/g, '\n')
const result = normalise(readFileSync(join(ROOT, 'spikes/281-engine-build/RESULT.md'), 'utf-8'))

const patchLines = () => {
  const dir = join(ROOT, 'engine/patches')
  return readdirSync(dir)
    .filter((name) => name.endsWith('.patch'))
    .map((name) => normalise(readFileSync(join(dir, name), 'utf-8')))
    .join('')
    .split('\n')
    .filter((_, i, all) => i < all.length - 1 || all[i] !== '').length
}

describe('the engine build spike result', () => {
  test('the spike result states the -O2 verdict', () => {
    expect(result).toMatch(/-O2 verdict:\*\*\s*(builds and validates|does not validate)/)
  })

  test("the spike result's patch size matches the series and covers every level", () => {
    expect(result).toContain(`**MashedD patch series:** ${patchLines()} lines`)
    for (const level of ['O0', 'O1', 'O2']) {
      expect(result).toMatch(new RegExp(String.raw`\|\s*${level}\s*\|\s*\d+\s*\|\s*\d+\s*\|`))
    }
  })
})
