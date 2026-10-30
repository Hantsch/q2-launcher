// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = join(__dirname, '../renderer/src/styles')
const LITERAL = /\brgba?\(|\bhsla?\(|#[0-9a-fA-F]{3,8}\b/g

// Blanking keeps every newline so reported line numbers match the source file.
function blank(text: string, re: RegExp): string {
  return text.replace(re, (m) => m.replace(/[^\n]/g, ' '))
}

describe('style sheets name colours through tokens only', () => {
  it('no style sheet outside the @theme block holds a colour literal', () => {
    const offenders: string[] = []
    for (const file of readdirSync(STYLES).filter((f) => f.endsWith('.css'))) {
      let text = blank(readFileSync(join(STYLES, file), 'utf8'), /\/\*[\s\S]*?\*\//g)
      if (file === 'index.css') text = blank(text, /@theme\s*\{[\s\S]*?\n\}/)
      text.split('\n').forEach((line, i) => {
        if (line.match(LITERAL)) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
