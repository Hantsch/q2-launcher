import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A unit-test run is quiet and needs no Electron binary: `vitest.config.ts` aliases `electron`
 * and `electron-log/main` to inert stubs (`src/test-support/`). This runs a child vitest over a
 * fixed sample of files that used to print (logger output, React warnings, a test's own
 * console.*) and that reach `electron` without mocking it, with a preload that throws on any
 * load of the real package. It is a sample, not the whole suite, because this file is itself
 * part of the suite.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vitestBin = join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs')
const forbidElectron = join(repoRoot, 'scripts', 'lib', 'forbid-electron.cjs').replaceAll('\\', '/')

const NOISY_SAMPLE = [
  'src/main/modules/config/sync.test.ts',
  'src/main/modules/registry.test.ts',
  'src/main/modules/downloads/bootstrap/job.assembly.test.ts',
  // Imports `electron` directly without a vi.mock of its own: the alias is all that stands between it and the binary.
  'src/main/modules/downloads/stage-package.test.ts',
  'src/main/services/installation-removal.test.ts',
  'src/renderer/src/modules/servers/ServerDetailView.test.tsx',
]

/** The parent run's own markers would make the child believe it is a nested worker. */
function childEnv() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')),
  )
  env.NODE_OPTIONS = `--require "${forbidElectron}"`
  env.FORCE_COLOR = '0'
  return env
}

describe('quiet test run', () => {
  it('a dot run of the noisy sample prints no stdout or stderr blocks and loads no real electron', () => {
    const run = spawnSync(process.execPath, [vitestBin, 'run', '--reporter=dot', ...NOISY_SAMPLE], {
      cwd: repoRoot,
      env: childEnv(),
      encoding: 'utf8',
    })
    const output = `${run.stdout}${run.stderr}`

    expect(run.status, output).toBe(0)
    expect(output, output).toMatch(new RegExp(`Test Files\\s+${NOISY_SAMPLE.length} passed`))
    // The dot reporter prints its progress dots on the same line, so the block header is not
    // necessarily at the start of a line.
    const blocks = output.split('\n').filter((line) => /(stdout|stderr) \|/.test(line))
    expect(blocks).toEqual([])
  }, 180_000)
})
