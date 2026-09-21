import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stubPlatform } from '../../test-support/platform'
import { listDir, looksExecutable } from './fs-utils'

/**
 * Story 100 D3, AC3. `looksExecutable` decides what `inspectInstallation` offers as the client
 * executable, so these run against real files in a real temp dir - a mocked `stat` would prove
 * nothing about the execute bit, which is the whole point of the non-Windows branch.
 *
 * Windows' `stat` never reports execute bits (libuv derives `st_mode` from the read-only
 * attribute alone, so `chmod(path, 0o755)` there leaves `mode & 0o111 === 0`). The cases that
 * need a genuinely `+x` file are therefore skipped on a Windows host and proven by the
 * `ubuntu-latest` CI leg (story 100 D1); everything that only needs a *non*-executable file, and
 * every stubbed-Windows case, runs on either host.
 */
const HOST_REPORTS_EXECUTE_BITS = process.platform !== 'win32'

let dir: string
let restorePlatform: (() => void) | undefined

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-fs-utils-')))
})

afterEach(async () => {
  restorePlatform?.()
  restorePlatform = undefined
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/**
 * The Quake II root of the acceptance criterion: three extension-less files that are not
 * programs, one extension-less file that is, and a game directory - which is not a file at all.
 */
async function writeLinuxShapedRoot(): Promise<string> {
  const root = join(dir, 'q2pro-linux')
  await mkdir(join(root, 'baseq2'), { recursive: true })
  for (const name of ['README', 'LICENSE', 'CHANGELOG']) {
    await writeFile(join(root, name), `${name} text`)
  }
  await writeFile(join(root, 'q2pro'), 'ELF stand-in')
  await chmod(join(root, 'q2pro'), 0o755)
  return root
}

/** What `rankExecutables` offers, minus the ranking: the root's entries that look executable. */
async function executablesIn(root: string): Promise<string[]> {
  const listing = await listDir(root)
  const found: string[] = []
  for (const name of listing.names) {
    if (await looksExecutable(root, name)) found.push(name)
  }
  return found
}

describe('looksExecutable', () => {
  it.skipIf(!HOST_REPORTS_EXECUTE_BITS)(
    'off Windows only a file with an execute bit is an executable',
    async () => {
      const root = await writeLinuxShapedRoot()
      restorePlatform = stubPlatform('linux')

      expect(await looksExecutable(root, 'q2pro')).toBe(true)
      expect(await looksExecutable(root, 'README')).toBe(false)
      // A directory carries `+x` too, and must never be offered as a program.
      expect(await looksExecutable(root, 'baseq2')).toBe(false)
      expect(await looksExecutable(root, 'does-not-exist')).toBe(false)

      expect(await executablesIn(root)).toEqual(['q2pro'])
    },
  )

  it('README and LICENSE in a Quake II root are not offered as engines', async () => {
    const root = await writeLinuxShapedRoot()
    restorePlatform = stubPlatform('linux')

    const executables = await executablesIn(root)
    expect(executables).not.toContain('README')
    expect(executables).not.toContain('LICENSE')
    expect(executables).not.toContain('CHANGELOG')
  })

  it('on Windows the same root offers nothing, because nothing is a .exe', async () => {
    const root = await writeLinuxShapedRoot()
    restorePlatform = stubPlatform('win32')

    expect(await executablesIn(root)).toEqual([])
    expect(await looksExecutable(root, 'q2pro')).toBe(false)
  })

  it('on Windows a root with q2pro.exe still offers it, execute bit or not', async () => {
    const root = join(dir, 'q2pro-windows')
    await mkdir(join(root, 'baseq2'), { recursive: true })
    await writeFile(join(root, 'README'), 'README text')
    await writeFile(join(root, 'q2pro.exe'), 'PE stand-in')
    restorePlatform = stubPlatform('win32')

    expect(await looksExecutable(root, 'q2pro.exe')).toBe(true)
    expect(await executablesIn(root)).toEqual(['q2pro.exe'])
  })
})
