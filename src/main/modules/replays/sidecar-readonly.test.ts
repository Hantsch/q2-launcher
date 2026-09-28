import { readdir, readFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSidecarStore, type ResolvedDemo } from './sidecar-store'

/**
 * Story 147: proof that a broken sidecar is reported, never overwritten, and never touched by a
 * plain read. `sidecar-store.ts`'s `read()` is the only read path this codebase has today - an
 * index/detail response's `sidecarState` would carry exactly what `read()` returns - so exercising
 * it here is exercising the whole read path.
 */
describe('sidecar read path never writes', () => {
  let dir: string

  async function setUp(demoName: string, sidecarContent: string) {
    dir = await mkdtemp(join(tmpdir(), 'q2-launcher-sidecar-readonly-'))
    const demoPath = join(dir, demoName)
    await writeFile(demoPath, 'demo-bytes')
    const sidecarPath = `${demoPath}.json`
    await writeFile(sidecarPath, sidecarContent)
    return { demoPath, sidecarPath }
  }

  async function teardown() {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }

  function storeFor(mapping: Record<string, ResolvedDemo | undefined>) {
    return createSidecarStore({ resolveDemo: (id) => mapping[id] })
  }

  describe('no-write proof', () => {
    const cases: Array<{
      label: string
      content: string
      expectedKind: string
      expectedParams?: Record<string, unknown>
    }> = [
      { label: 'invalid JSON', content: '{ not valid json', expectedKind: 'invalidJson' },
      {
        label: 'one invalid field',
        content: JSON.stringify({ schemaVersion: 1, name: 'ok', rating: 'high' }),
        expectedKind: 'invalidField',
        expectedParams: { field: 'rating' },
      },
      {
        label: 'a newer schemaVersion',
        content: JSON.stringify({ schemaVersion: 999, name: 'ok' }),
        expectedKind: 'unknownVersion',
        expectedParams: { version: '999' },
      },
    ]

    for (const { label, content, expectedKind, expectedParams } of cases) {
      it(`leaves bytes and mtime untouched for ${label}`, async () => {
        try {
          const { demoPath, sidecarPath } = await setUp('demo.dm2', content)
          const bytesBefore = await readFile(sidecarPath, 'utf8')
          const statBefore = await stat(sidecarPath)

          const store = storeFor({ demo: { kind: 'file', absolutePath: demoPath } })
          const result = await store.read('demo')

          expect(result.ok).toBe(true)
          if (!result.ok) throw new Error('expected ok')
          expect(result.value.state.state).toBe('error')
          if (result.value.state.state === 'error') {
            const issue = result.value.state.issues.find((i) => i.kind === expectedKind)
            expect(issue).toBeDefined()
            if (expectedParams) {
              expect(issue?.params).toEqual(expect.objectContaining(expectedParams))
            }
          }

          const bytesAfter = await readFile(sidecarPath, 'utf8')
          const statAfter = await stat(sidecarPath)
          expect(bytesAfter).toBe(bytesBefore)
          expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs)
        } finally {
          await teardown()
        }
      })
    }
  })

  describe('partial use', () => {
    it('keeps a valid name alongside an invalid rating, dropping only the bad field', async () => {
      try {
        const { demoPath } = await setUp(
          'demo.dm2',
          JSON.stringify({ schemaVersion: 1, name: 'good name', rating: 'high' }),
        )
        const store = storeFor({ demo: { kind: 'file', absolutePath: demoPath } })
        const result = await store.read('demo')

        expect(result.ok).toBe(true)
        if (!result.ok) throw new Error('expected ok')
        expect(result.value.state.state).toBe('error')
        expect(result.value.values.name).toBe('good name')
        expect(result.value.values.rating).toBeUndefined()
      } finally {
        await teardown()
      }
    })

    it('keeps a valid map alongside a newer schemaVersion', async () => {
      try {
        const { demoPath } = await setUp(
          'demo.dm2',
          JSON.stringify({ schemaVersion: 999, map: 'q2dm1' }),
        )
        const store = storeFor({ demo: { kind: 'file', absolutePath: demoPath } })
        const result = await store.read('demo')

        expect(result.ok).toBe(true)
        if (!result.ok) throw new Error('expected ok')
        expect(result.value.state.state).toBe('error')
        expect(result.value.values.map).toBe('q2dm1')
      } finally {
        await teardown()
      }
    })
  })

  describe('structural: only index.ts and tests import the write-capable store', () => {
    it('finds no importer of ./sidecar-store outside the allowed list', async () => {
      const mainRoot = join(__dirname, '..', '..')
      const allowedImporters = new Set([
        'src/main/modules/replays/index.ts',
        'src/main/modules/replays/sidecar-store.test.ts',
        'src/main/modules/replays/sidecar-guard.test.ts',
        'src/main/modules/replays/sidecar-readonly.test.ts',
      ])

      const importSpecifierRe = /from\s+['"]([^'"]*sidecar-store)['"]/g

      async function collectTsFiles(dirPath: string): Promise<string[]> {
        const entries = await readdir(dirPath, { withFileTypes: true })
        const files: string[] = []
        for (const entry of entries) {
          const full = join(dirPath, entry.name)
          if (entry.isDirectory()) {
            files.push(...(await collectTsFiles(full)))
          } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            files.push(full)
          } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
            // Test files are scanned too (they're allowed importers, but an unexpected non-listed
            // test file importing the store should still be caught).
            files.push(full)
          }
        }
        return files
      }

      const files = await collectTsFiles(mainRoot)
      const unexpectedImporters: string[] = []

      for (const file of files) {
        const content = await readFile(file, 'utf8')
        importSpecifierRe.lastIndex = 0
        if (!importSpecifierRe.test(content)) continue

        const relative = file.split(/[/\\]/).join('/')
        const projectRelative = relative.slice(relative.indexOf('src/main'))

        if (!allowedImporters.has(projectRelative)) {
          unexpectedImporters.push(projectRelative)
        }
      }

      expect(unexpectedImporters, `unexpected importers of sidecar-store: ${unexpectedImporters.join(', ')}`).toEqual(
        [],
      )
    })
  })
})
