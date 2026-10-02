import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_SCHEMA_VERSION } from '@shared/constants'
import { downloadsState } from './downloads/persisted'
import { homeState } from './home/persisted'
import { serversState } from './servers/persisted'
import { replaysState } from './replays/persisted'
import { StateStore } from '../services/state'
import { unlockState } from '../services/unlock/persisted'
import { useTempDir } from '../../test-support/temp-dir'
import { configState } from './config/persisted'
import { MODULE_MIGRATIONS } from './index'

const FIXTURES = join(__dirname, '__fixtures__', 'state')
const INPUTS = ['v1', 'v2', 'v3', 'v4', 'v5-full']
/** Failure-log pruning reads the clock; the fixture's timestamps are relative to this instant. */
const NOW = new Date('2026-10-02T12:00:00.000Z')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readEverySection(state: StateStore) {
  return {
    settings: state.settings(),
    installations: state.installations(),
    configProfiles: configState(state).profiles.get(),
    configPlayedMods: configState(state).playedMods.get(),
    configSwitchBinds: configState(state).switchBinds.get(),
    configWriteFailures: configState(state).writeFailures.get(),
    configFileSourceMigratedAt: configState(state).fileSourceMigratedAt.get(),
    downloads: downloadsState(state).settings.get(),
    downloadFailures: downloadsState(state).failures.get(),
    homeLayout: homeState(state).get(),
    servers: serversState(state).get(),
    unlock: unlockState(state).get(),
    replays: replaysState(state).get(),
  }
}

/** Migrations mint random action ids; the document is compared with those replaced by a marker. */
function withoutGeneratedIds(value: unknown): unknown {
  if (typeof value === 'string') return UUID.test(value) ? '<generated-id>' : value
  if (Array.isArray(value)) return value.map(withoutGeneratedIds)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, withoutGeneratedIds(inner)]),
    )
  }
  return value
}

async function readExpected(name: string): Promise<unknown> {
  const file = join(FIXTURES, `${name}.expected.json`)
  if (process.env['GOLDEN_UPDATE'] === '1') {
    const store = new StateStore(join(FIXTURES, `${name}.json`), { migrations: MODULE_MIGRATIONS })
    await store.load()
    await writeFile(
      file,
      JSON.stringify(withoutGeneratedIds(readEverySection(store)), null, 2) + '\n',
    )
  }
  return JSON.parse(await readFile(file, 'utf8'))
}

describe('loading persisted state', () => {
  const dir = useTempDir('q2l-golden-')

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('every fixture state.json loads to the golden document', async () => {
    for (const name of INPUTS) {
      const expected = await readExpected(name)
      const file = join(dir(), `${name}.state.json`)
      await writeFile(file, await readFile(join(FIXTURES, `${name}.json`), 'utf8'))

      const first = new StateStore(file, { migrations: MODULE_MIGRATIONS })
      const loaded = await first.load()
      expect(loaded.schemaVersion, name).toBe(STATE_SCHEMA_VERSION)
      expect(withoutGeneratedIds(readEverySection(first)), name).toEqual(expected)

      // Dirty the store so it writes, then prove the written file reloads to the same document.
      first.patchSettings({})
      expect((await first.settle()).ok, name).toBe(true)
      const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
      expect(Object.keys(written), name).toEqual(
        expect.arrayContaining(Object.keys(expected as Record<string, unknown>)),
      )
      const second = new StateStore(file, { migrations: MODULE_MIGRATIONS })
      await second.load()
      expect(withoutGeneratedIds(readEverySection(second)), name).toEqual(expected)
    }
  })
})
