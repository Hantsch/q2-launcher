// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../renderer/src')
const KEYCAP_OWNER = 'modules/config/OverviewKeyboardPanel.tsx'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
  })
}

// Blanking keeps every newline so reported line numbers match the source file.
function blank(text: string, re: RegExp): string {
  return text.replace(re, (m) => m.replace(/[^\n]/g, ' '))
}

describe('font sizes come from the typography scale', () => {
  it('no source file sizes text with an arbitrary pixel class or borrows the keycap size', () => {
    const offenders: string[] = []
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/')
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/text-\[\d/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
          if (rel !== KEYCAP_OWNER && /\btext-keycap\b/.test(line))
            offenders.push(`${rel}:${i + 1}: text-keycap outside the keyboard panel`)
        })
    }
    expect(offenders).toEqual([])
  })

  it('no style sheet declares a font-size that is not a scale token', () => {
    const offenders: string[] = []
    const dir = join(SRC, 'styles')
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
      const text = blank(readFileSync(join(dir, file), 'utf8'), /\/\*[\s\S]*?\*\//g)
      text.split('\n').forEach((line, i) => {
        const m = /(?<![\w-])font-size\s*:\s*([^;}]+)/.exec(line)
        if (m && !/^(var\(--text-[\w-]+\)|inherit)\s*$/.test(m[1].trim()))
          offenders.push(`${file}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
