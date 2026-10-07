import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findDuplicatedHelpers } from './lib/flow-helper-duplication.mjs'

const flowsDir = join(dirname(fileURLToPath(import.meta.url)), 'flows')

describe('flow helper duplication', () => {
  it('no helper is declared in more than three flow files', () => {
    const files = Object.fromEntries(
      readdirSync(flowsDir)
        .filter((f) => f.endsWith('.mjs'))
        .map((f) => [f, readFileSync(join(flowsDir, f), 'utf8')]),
    )
    expect(findDuplicatedHelpers(files)).toEqual([])
  })

  it('the guard catches a fourth copy', () => {
    const src =
      'export default async () => {}\nasync function pause(ms) {\n  await new Promise((r) => setTimeout(r, ms))\n}\n'
    const four = Object.fromEntries(['a', 'b', 'c', 'd'].map((n) => [`${n}.mjs`, src]))
    expect(findDuplicatedHelpers(four).length).toBeGreaterThan(0)
    delete four['d.mjs']
    expect(findDuplicatedHelpers(four)).toEqual([])
  })

  it('the guard catches four identical bodies under different names', () => {
    const fn = Object.fromEntries(
      [0, 1, 2, 3].map((i) => [
        `f${i}.mjs`,
        `export default async () => {}
async function p${i}(ms) {
  await new Promise((r) => setTimeout(r, ms))
}
`,
      ]),
    )
    expect(findDuplicatedHelpers(fn).length).toBeGreaterThan(0)
    const arrow = Object.fromEntries(
      [0, 1, 2, 3].map((i) => [
        `g${i}.mjs`,
        `const q${i} = async (ms) => {
  await ms
}
`,
      ]),
    )
    expect(findDuplicatedHelpers(arrow).length).toBeGreaterThan(0)
  })
})
