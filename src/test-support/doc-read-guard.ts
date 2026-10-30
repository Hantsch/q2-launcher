import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT } from './source-tree'

/**
 * Unit-lane setup file: a test that reads project-doc prose belongs in the docs lane
 * (`*.docs.test.*`, `npm run check:docs`), so the unit lane refuses those reads outright.
 *
 * The wrapper replaces the functions on the shared `node:fs` object and then calls
 * `syncBuiltinESMExports()`, so a named `import { readFileSync } from 'node:fs'` (or
 * `node:fs/promises`) sees it too — without the sync, named ESM bindings keep the original.
 * `vitest.docs.config.ts` pins its own `setupFiles`, so the docs lane never loads this file.
 */

const PROJECT_DOC = /^(CLAUDE\.md|docs\/.+\.md|\.claude\/.+\.md)$/i
const GUARDED = Symbol.for('q2l.docReadGuard')

type Guarded = { [GUARDED]?: true }

function pathOf(target: unknown): string | null {
  if (typeof target === 'string') return target
  if (Buffer.isBuffer(target)) return target.toString('utf-8')
  // A URL from any realm (a jsdom environment swaps the global `URL`) is matched by shape.
  if (typeof target === 'object' && target !== null && typeof (target as URL).href === 'string')
    return (target as URL).href
  return null
}

/** The repo-relative POSIX path of `target` when it names a project doc, else `null`. */
function projectDocPath(target: unknown): string | null {
  let path = pathOf(target)
  if (path === null) return null
  if (path.startsWith('file:')) path = fileURLToPath(path)
  const rel = relative(REPO_ROOT, resolve(path))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  const posixRel = rel.split(sep).join('/')
  return PROJECT_DOC.test(posixRel) ? posixRel : null
}

function refuse(target: unknown): void {
  const doc = projectDocPath(target)
  if (doc !== null)
    throw new Error(`unit lane read project doc ${doc} — move the test to a *.docs.test.* file`)
}

// Every wrapper refuses synchronously, the promise API included: a rejection could be swallowed
// by a caller's `.catch`, and a silently-passing doc read is exactly what the guard is against.
function guard<F extends (...args: never[]) => unknown>(original: F): F {
  if ((original as F & Guarded)[GUARDED]) return original
  const wrapped = function (this: unknown, ...args: Parameters<F>): ReturnType<F> {
    refuse(args[0])
    return original.apply(this, args) as ReturnType<F>
  } as unknown as F & Guarded
  wrapped[GUARDED] = true
  return wrapped
}

// The same worker runs this setup once per test file against one shared `node:fs`; `guard`
// returns an already-wrapped function unchanged, so the wrappers never stack.
fs.readFileSync = guard(fs.readFileSync)
fs.readFile = guard(fs.readFile)
fs.promises.readFile = guard(fs.promises.readFile)
syncBuiltinESMExports()
