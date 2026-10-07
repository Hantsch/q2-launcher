import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubPlatform } from '../../test-support/platform'

const renameFailures = vi.hoisted(() => ({ left: 0, code: 'EPERM', calls: 0 }))
vi.mock('node:fs/promises', async (importActual) => {
  const actual = await importActual<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      renameFailures.calls += 1
      if (renameFailures.left > 0) {
        renameFailures.left -= 1
        throw Object.assign(new Error('rename refused'), { code: renameFailures.code })
      }
      return actual.rename(...args)
    },
  }
})

import { writeFileAtomic } from './fs-utils'

describe('writeFileAtomic', () => {
  let dir: string
  let restorePlatform = (): void => {}
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q2l-atomic-'))
    renameFailures.left = 0
    renameFailures.code = 'EPERM'
    renameFailures.calls = 0
  })
  afterEach(async () => {
    restorePlatform()
    await rm(dir, { recursive: true, force: true })
  })

  it('on Windows a rename the OS refuses for a moment is retried', async () => {
    restorePlatform = stubPlatform('win32')
    renameFailures.left = 2
    const target = join(dir, 'a.json')
    await writeFileAtomic(target, '{"a":1}', 'utf8')
    expect(await readFile(target, 'utf8')).toBe('{"a":1}')
    expect(renameFailures.calls).toBe(3)
  })

  it('a refusal that never lifts is thrown after the retries', async () => {
    restorePlatform = stubPlatform('win32')
    renameFailures.left = 99
    await expect(writeFileAtomic(join(dir, 'a.json'), 'x', 'utf8')).rejects.toMatchObject({
      code: 'EPERM',
    })
  })

  it('off Windows the first refusal is final', async () => {
    restorePlatform = stubPlatform('linux')
    renameFailures.left = 1
    await expect(writeFileAtomic(join(dir, 'a.json'), 'x', 'utf8')).rejects.toMatchObject({
      code: 'EPERM',
    })
    expect(renameFailures.calls).toBe(1)
  })
})
