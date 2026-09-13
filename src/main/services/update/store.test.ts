import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UPDATE_CACHE_VERSION,
  UPDATE_CHECK_STORE_FILE,
  UpdateCheckStore,
  updateCheckStoreFilePath,
  type UpdateCheckStoreData,
} from './store'

/**
 * Story 097 D2. Real files in an `mkdtemp` directory through the real `JsonStore` - the criterion
 * under test is what a *file on disk* does to the launcher, so a stubbed store would test nothing.
 *
 * `electron` is mocked exactly as in `feed-cache.test.ts`, so `app.getPath('userData')` - which
 * `updateCheckStoreFilePath()` is built from - points at a per-test temp folder.
 */

const userDataBox = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
}))

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-update-store-'))
  userDataBox.current = dir
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const NOTHING_KNOWN: UpdateCheckStoreData = {
  update: null,
  lastCheckedAt: null,
  lastSuccessAt: null,
}

function data(overrides: Partial<UpdateCheckStoreData> = {}): UpdateCheckStoreData {
  return {
    update: { version: '1.1.0', notes: 'Fixes things.', releasedAt: '2026-09-10T08:30:00.000Z' },
    lastCheckedAt: '2026-09-12T08:00:00.000Z',
    lastSuccessAt: '2026-09-12T08:00:00.000Z',
    ...overrides,
  }
}

/** Writes `content` where the store lives, without going through `JsonStore`. */
async function writeRawStoreFile(content: string): Promise<void> {
  await writeFile(updateCheckStoreFilePath(), content, 'utf8')
}

describe('UpdateCheckStore', () => {
  it('lives in its own userData file and round-trips update, lastCheckedAt and lastSuccessAt', async () => {
    // Its own file, not a section of state.json (Decisions (Sprint)).
    expect(updateCheckStoreFilePath()).toBe(join(dir, UPDATE_CHECK_STORE_FILE))

    await new UpdateCheckStore().save(data())

    // AC8: read back by a second instance (a fresh store, as after a restart), so nothing is
    // served out of the writer's own memory.
    expect(await new UpdateCheckStore().load()).toEqual(data())

    const raw = JSON.parse(await readFile(updateCheckStoreFilePath(), 'utf8')) as Record<
      string,
      unknown
    >
    expect(raw['cacheVersion']).toBe(UPDATE_CACHE_VERSION)
    expect(raw['update']).toEqual(data().update)
    expect(raw['lastCheckedAt']).toBe(data().lastCheckedAt)
    expect(raw['lastSuccessAt']).toBe(data().lastSuccessAt)
  })

  it('round-trips a null update (up to date, nothing available)', async () => {
    const upToDate = data({ update: null })

    await new UpdateCheckStore().save(upToDate)

    expect(await new UpdateCheckStore().load()).toEqual(upToDate)
  })

  it('a missing store file reads as nothing known', async () => {
    await expect(new UpdateCheckStore().load()).resolves.toEqual(NOTHING_KNOWN)
  })

  it('an unparseable store file degrades to nothing known instead of throwing', async () => {
    await writeRawStoreFile('{"update": [ this is not json')

    await expect(new UpdateCheckStore().load()).resolves.toEqual(NOTHING_KNOWN)
  })

  it('a store file that is valid JSON but the wrong shape degrades to nothing known', async () => {
    // Parses fine, and every field is wrong in a different way: no envelope version, an update
    // that is not an update shape, timestamps that are not strings.
    await writeRawStoreFile(
      JSON.stringify({ update: { version: 7 }, lastCheckedAt: 123, lastSuccessAt: false }),
    )

    await expect(new UpdateCheckStore().load()).resolves.toEqual(NOTHING_KNOWN)
  })

  it('a store file from another cache version degrades to nothing known', async () => {
    await writeRawStoreFile(JSON.stringify({ ...data(), cacheVersion: UPDATE_CACHE_VERSION + 1 }))

    await expect(new UpdateCheckStore().load()).resolves.toEqual(NOTHING_KNOWN)
  })
})
