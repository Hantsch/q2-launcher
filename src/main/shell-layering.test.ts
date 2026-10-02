import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(__dirname, '../..')
const MAIN_SRC = resolve(REPO_ROOT, 'src/main')

function listTsFiles(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full))
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Every module specifier a file imports, re-exports, requires or mocks. */
const SPECIFIER_PATTERN =
  /(?:import|export)(?:[^'"]*?)from\s*['"]([^'"]+)['"]|(?:import|require|vi\.mock|vi\.doMock|vi\.importActual)\(\s*['"]([^'"]+)['"]/g

function specifiersOf(contents: string): string[] {
  return [...contents.matchAll(SPECIFIER_PATTERN)].map((m) => m[1] ?? m[2]).filter(Boolean)
}

describe('shell layering', () => {
  it('no shell file imports from modules', () => {
    const shellFiles = [
      resolve(MAIN_SRC, 'index.ts'),
      ...listTsFiles(resolve(MAIN_SRC, 'lib')),
      ...listTsFiles(resolve(MAIN_SRC, 'services')),
    ]
    const violations: string[] = []
    for (const file of shellFiles) {
      for (const specifier of specifiersOf(readFileSync(file, 'utf-8'))) {
        if (/(^|\/)modules\//.test(specifier)) violations.push(`${file} -> ${specifier}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('lib/schemas.ts holds at most 400 lines', () => {
    const lines = readFileSync(resolve(MAIN_SRC, 'lib/schemas.ts'), 'utf-8').split('\n').length
    expect(lines).toBeLessThanOrEqual(400)
  })

  it('ARCHITECTURE.md states the two-tier migration rule', () => {
    const doc = readFileSync(resolve(REPO_ROOT, 'docs/ARCHITECTURE.md'), 'utf-8')
    expect(doc).not.toContain('MIGRATIONS is empty')
    expect(doc).not.toContain('never touches `ipcMain`,\n   `BrowserWindow` or the state file')
    expect(doc).not.toMatch(/never touches[^.]*the state file/)
    const addingAModule = doc.slice(doc.indexOf('## Adding a module'), doc.indexOf('### Jobs'))
    expect(addingAModule).toContain('persisted.ts')
    expect(doc).toContain('Additive optional key')
    expect(doc).toContain('persisted-migrations.ts')
    expect(doc).toContain('STATE_SCHEMA_VERSION')
  })
})
