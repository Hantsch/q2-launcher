import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('docs facts', () => {
  test('CLAUDE.md has one 44px deviation row and a comment convention', () => {
    const claude = read('CLAUDE.md')
    const rows = claude.split('\n').filter((l) => l.startsWith('| `/design-tokens` (44px'))
    expect(rows).toHaveLength(1)
    expect(claude).toContain('## Comments')
    expect(claude).toContain('(story 052)')
  })

  test('CLAUDE.md and CONTRIBUTING name no install or scaffolded module', () => {
    for (const f of ['CLAUDE.md', 'CONTRIBUTING.md']) {
      const text = read(f)
      expect(text, f).not.toContain('`install`')
      expect(text, f).not.toMatch(/scaffolded but not implemented/)
    }
  })

  test('ipc-schemas header is current', () => {
    const src = read('src/shared/ipc-schemas.ts')
    expect(src).not.toContain('exported-but-unused')
    expect(src).not.toContain('Not yet wired')
  })

  test('the templates carry Decisions (Sprint) and Regression gate and docs/README names the real test paths', () => {
    expect(read('docs/requirements/_TEMPLATE.md')).toContain('## Decisions (Sprint)')
    expect(read('docs/sprints/_TEMPLATE/sprint.md')).toContain('## Regression gate')
    const readme = read('docs/README.md')
    expect(readme).toContain('scripts/flows/<name>.mjs')
    expect(readme).toContain('src/**/*.test.ts(x)')
    expect(readme).toContain('scripts/**/*.test.mjs')
  })
})
