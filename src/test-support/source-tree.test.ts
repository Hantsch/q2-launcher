import { describe, expect, it } from 'vitest'
import {
  isNodeOrElectron,
  isTestFile,
  listSourceFiles,
  resolveSpecifier,
  scanImports,
  stripComments,
} from './source-tree'

const EVERY_FORM = `/**
 * Talks to the window, the way \`import { app } from 'electron'\` would in main.
 */
// import { ipcMain } from 'electron'
import a from './default'
import type { B } from '../types'
import {
  c,
  d,
} from '@shared/multi'
import * as e from 'node:path'
import f, { g } from 'bare-pkg'
export { h } from './reexport'
export type { I } from './type-reexport'
export * from './star'
export * as j from './star-as'
import './side-effect.css'
const k = await import('./dynamic')
const l = require('./required')
const url = 'https://example.com/import' // trailing comment with from 'electron'
const quote = /['"]/ /* block from 'electron' */
`

describe('scanImports', () => {
  it('scanImports finds every import form and ignores comments', () => {
    expect(scanImports(EVERY_FORM)).toEqual([
      './default',
      '../types',
      '@shared/multi',
      'node:path',
      'bare-pkg',
      './reexport',
      './type-reexport',
      './star',
      './star-as',
      './side-effect.css',
      './dynamic',
      './required',
    ])
  })

  it('keeps a // inside a string while stripping comments', () => {
    const stripped = stripComments(`const u = 'https://x.test' // gone\nconst r = /\\/\\//`)
    expect(stripped).toContain("'https://x.test'")
    expect(stripped).not.toContain('gone')
    expect(stripped).toContain('/\\/\\//')
  })

  it('does not lose an import after a regex literal that contains a quote', () => {
    expect(scanImports(`const q = /["']/g\nimport x from './after'`)).toEqual(['./after'])
  })
})

describe('isNodeOrElectron', () => {
  it('flags bare and node: builtins and electron, not packages or repo paths', () => {
    for (const spec of ['fs', 'path', 'child_process', 'fs/promises', 'node:fs', 'electron'])
      expect(isNodeOrElectron(spec), spec).toBe(true)
    for (const spec of ['react', 'zod', 'src/shared/ipc', 'fs-extra'])
      expect(isNodeOrElectron(spec), spec).toBe(false)
  })
})

describe('resolveSpecifier', () => {
  it('resolves relative specifiers to repo-relative paths without extension', () => {
    expect(resolveSpecifier('src/main/a/b.ts', '../c/d')).toBe('src/main/c/d')
    expect(resolveSpecifier('src/main/a/b.ts', './e.ts')).toBe('src/main/a/e')
  })

  it('maps the tsconfig path aliases', () => {
    expect(resolveSpecifier('src/x.ts', '@shared/ipc')).toBe('src/shared/ipc')
    expect(resolveSpecifier('src/x.ts', '@main/lib/y')).toBe('src/main/lib/y')
    expect(resolveSpecifier('src/x.ts', '@renderer/lib/z')).toBe('src/renderer/src/lib/z')
  })

  it('resolves a directory import to its index', () => {
    expect(resolveSpecifier('src/main/context.ts', './modules')).toBe('src/main/modules/index')
  })

  it('returns bare specifiers unchanged', () => {
    expect(resolveSpecifier('src/x.ts', 'electron')).toBe('electron')
    expect(resolveSpecifier('src/x.ts', 'node:fs')).toBe('node:fs')
  })
})

describe('listSourceFiles', () => {
  it('lists .ts/.tsx files as repo-relative POSIX paths', () => {
    const files = listSourceFiles('src/test-support')
    expect(files).toContain('src/test-support/source-tree.ts')
    expect(files.every((f) => /^src\/test-support\/[^\\]+\.tsx?$/.test(f))).toBe(true)
  })

  it('tells test files from production files', () => {
    expect(isTestFile('src/a.test.ts')).toBe(true)
    expect(isTestFile('src/a.spec.tsx')).toBe(true)
    expect(isTestFile('src/modules/config/test/fixtures.ts')).toBe(true)
    expect(isTestFile('src/a.ts')).toBe(false)
    expect(isTestFile('src/test-support/a.ts')).toBe(false)
  })
})
