import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Story 106 D4: a platform-parity guard for the servers module.
 *
 * D1-D3 built the servers module (main handler, shared contract, renderer
 * view) as placeholder/zeroed data with no platform-specific behaviour yet.
 * This test locks that in - it never lets a `process.platform`/`os.platform`
 * check or a `win32`/`linux` literal creep into the module - and separately
 * asserts CLAUDE.md still states the "Platform parity is explicit." rule
 * that would govern any future platform branch here. It never writes to
 * CLAUDE.md, only reads it.
 */

const REPO_ROOT = join(__dirname, '../../../../')

const FORBIDDEN_SNIPPETS = ["process.platform", "os.platform", "'win32'", '"win32"', "'linux'", '"linux"']

const SOURCE_EXTENSIONS = ['.ts', '.tsx']

function listSourceFiles(root: string): string[] {
  const files: string[] = []

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry)
      const stats = statSync(fullPath)
      if (stats.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (fullPath === __filename) continue
      if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue
      if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
        files.push(fullPath)
      }
    }
  }

  const rootStats = statSync(root)
  if (rootStats.isDirectory()) {
    walk(root)
  } else if (root !== __filename) {
    files.push(root)
  }

  return files
}

describe('platform parity guard', () => {
  it('CLAUDE.md carries the platform-parity rule and the servers module declares no platform branch', () => {
    const claudeMd = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf-8')
    expect(claudeMd).toContain('Platform parity is explicit.')

    const targets = [
      join(REPO_ROOT, 'src/main/modules/servers'),
      join(REPO_ROOT, 'src/renderer/src/modules/servers'),
      join(REPO_ROOT, 'src/shared/modules/servers.ts'),
    ]

    const filesToScan = targets.flatMap((target) => listSourceFiles(target))
    expect(filesToScan.length).toBeGreaterThan(0)

    for (const file of filesToScan) {
      const content = readFileSync(file, 'utf-8')
      for (const snippet of FORBIDDEN_SNIPPETS) {
        expect(content, `${file} must not reference ${snippet}`).not.toContain(snippet)
      }
    }
  })
})
