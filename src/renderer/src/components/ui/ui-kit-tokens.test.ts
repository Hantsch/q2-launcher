import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob('./*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const FILES = [
  'NameDialog.tsx',
  'ConfirmDialog.tsx',
  'Tabs.tsx',
  'RadioGroup.tsx',
  'controls.tsx',
  'ErrorBoundary.tsx',
]
const HEX = /#[0-9a-fA-F]{3,8}\b/
const PALETTE =
  /\b(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/

describe('ui-kit tokens', () => {
  it('ui primitives use tokens only', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      const source = SOURCES[`./${file}`] ?? ''
      expect(source, `${file} must exist`).toBeDefined()
      if (HEX.test(source)) offenders.push(`${file}: hex colour`)
      if (PALETTE.test(source)) offenders.push(`${file}: raw palette class`)
    }
    expect(offenders).toEqual([])
  })
})
