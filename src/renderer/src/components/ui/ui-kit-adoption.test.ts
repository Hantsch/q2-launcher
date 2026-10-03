import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const ENTRIES = Object.entries(SOURCES)

function filesMatching(pattern: RegExp, exceptFile?: string): string[] {
  return ENTRIES.filter(
    ([path, source]) => !path.endsWith(`/${exceptFile ?? '\0'}`) && pattern.test(source),
  ).map(([path]) => path)
}

function importers(name: string): string[] {
  const pattern = new RegExp(String.raw`from\s+['"][^'"]*/${name}['"]`)
  return filesMatching(pattern, `${name}.tsx`)
}

describe('ui-kit adoption', () => {
  it('scans the renderer sources', () => {
    expect(ENTRIES.length).toBeGreaterThan(100)
  })

  it('fewer than 5 renderer files hold their own submitting state', () => {
    expect(filesMatching(/const \[submitting, setSubmitting\]/).length).toBeLessThan(5)
  })

  it('role=tablist only inside Tabs', () => {
    const pattern = /role\s*[=:]\s*\{?\s*['"]tablist['"]/
    expect(filesMatching(pattern, 'Tabs.tsx')).toEqual([])
  })

  it('getDerivedStateFromError and class error boundaries only inside ErrorBoundary', () => {
    expect(filesMatching(/getDerivedStateFromError/, 'ErrorBoundary.tsx')).toEqual([])
    expect(
      filesMatching(/class\s+\w+\s+extends\s+(React\.)?Component\b/, 'ErrorBoundary.tsx'),
    ).toEqual([])
  })

  it('NameDialog and ConfirmDialog are adopted', () => {
    expect(importers('NameDialog').length).toBeGreaterThanOrEqual(10)
    expect(importers('ConfirmDialog').length).toBeGreaterThanOrEqual(10)
  })
})
