'use strict'

/**
 * Preloaded with `node --require` (via NODE_OPTIONS) to prove a test run never loads the real
 * `electron` package: outside an Electron process its entry point only resolves - and on first
 * use downloads - the Electron binary, which a unit-test runner must not need.
 * Used by `scripts/quiet-test-run.test.mjs`.
 *
 * Matching the bare specifier alone is not enough: vitest resolves an external dependency to its
 * file first and imports that path, so the resolved entry file is checked as well.
 */

const Module = require('node:module')
const { pathToFileURL } = require('node:url')

const FORBIDDEN = 'electron'

let entryFile = null
try {
  entryFile = require.resolve(FORBIDDEN, { paths: [process.cwd()] })
} catch {
  // Not installed: nothing on disk to load, so only the bare specifier can be caught.
}
const entryUrl = entryFile ? pathToFileURL(entryFile).href : null

function fail(how, from) {
  throw new Error(
    `forbid-electron: the real \`${FORBIDDEN}\` package was loaded (${how} from ${from}); ` +
      'tests must resolve it to src/test-support/electron-stub.ts or vi.mock it',
  )
}

const originalLoad = Module._load
Module._load = function forbidElectronLoad(request, parent, isMain) {
  if (request === FORBIDDEN) fail('require', parent && parent.filename)
  if (entryFile && Module._resolveFilename(request, parent, isMain) === entryFile) {
    fail('require', parent && parent.filename)
  }
  return originalLoad.call(this, request, parent, isMain)
}

// An ESM import never passes through Module._load, so resolution is hooked as well.
if (typeof Module.registerHooks === 'function') {
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === FORBIDDEN) fail('import', context.parentURL)
      const resolved = nextResolve(specifier, context)
      if (entryUrl && resolved.url === entryUrl) fail('import', context.parentURL)
      return resolved
    },
  })
}
