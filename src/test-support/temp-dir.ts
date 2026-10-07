import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'

/**
 * A fresh directory under the OS temp dir for every test, removed afterwards. Call inside a
 * `describe` (or at file top level); read the path through the returned getter, which is only
 * valid between `beforeEach` and `afterEach`. Removal retries: on Windows a just-closed file
 * handle is not always released yet (ENOTEMPTY/EBUSY).
 */
export function installTempDir(prefix: string): () => string {
  let current: string | undefined
  beforeEach(async () => {
    current = await mkdtemp(join(tmpdir(), prefix))
  })
  afterEach(async () => {
    const dir = current
    current = undefined
    if (dir !== undefined)
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })
  return () => {
    if (current === undefined) throw new Error('installTempDir: dir read outside a test')
    return current
  }
}
