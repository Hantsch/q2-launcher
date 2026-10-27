// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'index.css'), 'utf8')

function token(name: string): string {
  const match = new RegExp(String.raw`--color-${name}:\s*(#[0-9a-fA-F]{6})\b`).exec(css)
  if (!match) throw new Error(`--color-${name} is not a hex token in index.css`)
  return match[1].toLowerCase()
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('side colour tokens', () => {
  it('the side colours meet text contrast on every surface', () => {
    for (const side of ['side-1', 'side-2']) {
      for (const surface of ['base', 'panel', 'raised']) {
        expect(
          contrast(token(side), token(surface)),
          `${side} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('the two sides are distinct colours', () => {
    expect(token('side-1')).not.toBe(token('side-2'))
  })
})
