// `npm run engine:data` - see data.mjs. The last stdout line on success is the cache path.
import { resolve } from 'node:path'
import {
  DEFAULT_LOCK,
  REPO_ROOT,
  assertOutsideRepo,
  ensureEngineData,
  readLock,
  resolveCacheDir,
} from './data.mjs'

try {
  const cacheDir = resolveCacheDir()
  assertOutsideRepo(cacheDir)
  const lockPath = process.env.Q2L_ENGINE_DATA_LOCK
    ? resolve(REPO_ROOT, process.env.Q2L_ENGINE_DATA_LOCK)
    : DEFAULT_LOCK
  const lock = readLock(lockPath)
  await ensureEngineData({ lock, cacheDir })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
