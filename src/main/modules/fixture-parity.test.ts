import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import log from 'electron-log/main'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_FILE, STATE_SCHEMA_VERSION } from '@shared/constants'
import { DEFAULT_SETTINGS } from '@shared/types'
import { MODULE_MIGRATIONS } from './index'
import { configState } from './config/persisted'
import { downloadsState } from './downloads/persisted'
import { homeState } from './home/persisted'
import { replaysState } from './replays/persisted'
import { serversState } from './servers/persisted'
import { StateStore, type StateSectionSpec } from '../services/state'
import { unlockState } from '../services/unlock/persisted'

type Doc = Record<string, unknown>

const isRecord = (value: unknown): value is Doc =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every `{ id: string }` row anywhere under `value`, counted per array path (`a.b[]`). */
function collectRowIds(value: unknown, path: string, out: Map<string, Map<string, number>>): void {
  if (Array.isArray(value)) {
    const rowPath = `${path}[]`
    for (const item of value) {
      if (isRecord(item) && typeof item['id'] === 'string') {
        const ids = out.get(rowPath) ?? new Map<string, number>()
        ids.set(item['id'], (ids.get(item['id']) ?? 0) + 1)
        out.set(rowPath, ids)
      }
      collectRowIds(item, rowPath, out)
    }
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectRowIds(child, path === '' ? key : `${path}.${key}`, out)
    }
  }
}

function rowIds(doc: Doc): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const [key, value] of Object.entries(doc)) {
    if (key !== 'schemaVersion' && key !== 'settings') collectRowIds(value, key, out)
  }
  return out
}

/**
 * Compares a seeded raw `state.json` with what the real load path made of it, returning one line per
 * problem. `loaded` holds the store-owned keys plus every module section's parsed value; a seeded
 * key no section claimed is absent from it, so its rows count as dropped.
 */
export function checkSeededState(
  raw: Doc,
  loaded: Doc,
  options: { legacy: boolean; legacySchemaVersion: number },
): string[] {
  const problems: string[] = []

  const expectedVersion = options.legacy ? options.legacySchemaVersion : STATE_SCHEMA_VERSION
  if (raw['schemaVersion'] !== expectedVersion) {
    problems.push(
      `schemaVersion is ${JSON.stringify(raw['schemaVersion'])}, expected ${expectedVersion}`,
    )
  }

  const loadedIds = rowIds(loaded)
  for (const [path, ids] of rowIds(raw)) {
    for (const [id, count] of ids) {
      const kept = loadedIds.get(path)?.get(id) ?? 0
      if (kept < count) problems.push(`row "${id}" at ${path} was dropped on load`)
    }
  }

  // Legacy seeds are migrated, so only a current seed's settings must survive byte-for-byte; that
  // is what surfaces a settings default added to or removed from src but not to the seed.
  if (!options.legacy) {
    const seeded = isRecord(raw['settings']) ? raw['settings'] : {}
    const parsed = isRecord(loaded['settings']) ? loaded['settings'] : {}
    for (const key of new Set([...Object.keys(seeded), ...Object.keys(parsed)])) {
      if (!Object.hasOwn(parsed, key))
        problems.push(`settings.${key} is seeded but not in the schema`)
      else if (!Object.hasOwn(seeded, key))
        problems.push(`settings.${key} is a default the seed lacks`)
      else if (!isDeepStrictEqual(seeded[key], parsed[key])) {
        problems.push(
          `settings.${key} seeded ${JSON.stringify(seeded[key])}, loaded ${JSON.stringify(parsed[key])}`,
        )
      }
    }
  }

  return problems
}

// `scripts/lib/paths.mjs` reads the override at module load, so it is set before the first import.
const previousRoot = process.env['Q2L_UI_VERIFY_ROOT']
const root = await mkdtemp(join(tmpdir(), 'q2l-fixture-parity-'))
process.env['Q2L_UI_VERIFY_ROOT'] = root
const fixture = await import('../../../scripts/lib/fixture.mjs')

afterAll(async () => {
  if (previousRoot === undefined) delete process.env['Q2L_UI_VERIFY_ROOT']
  else process.env['Q2L_UI_VERIFY_ROOT'] = previousRoot
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/** Stops whatever a writer left running (a stub HTTP server), so the test run can exit. */
async function stopSeedSideEffects(result: unknown): Promise<void> {
  if (!isRecord(result)) return
  for (const method of ['close', 'stop']) {
    const fn = result[method]
    if (typeof fn === 'function') await (fn as () => unknown).call(result)
  }
}

describe('seeded fixture state', () => {
  // Every scoped logger is the stub's one shared object, so spying on it sees all of main's logs.
  const scoped = log.scope('fixture-parity')
  const warn = vi.spyOn(scoped, 'warn')
  const error = vi.spyOn(scoped, 'error')
  const rootWarn = vi.spyOn(log, 'warn')
  const rootError = vi.spyOn(log, 'error')

  beforeEach(() => {
    for (const spy of [warn, error, rootWarn, rootError]) spy.mockClear()
  })

  afterAll(() => {
    for (const spy of [warn, error, rootWarn, rootError]) spy.mockRestore()
  })

  it('legacy seeds are older than the current schema', () => {
    expect(fixture.LEGACY_SEED_SCHEMA_VERSION).toBeLessThan(STATE_SCHEMA_VERSION)
  })

  describe('every fixture variant loads through the real StateStore without warnings or dropped rows', () => {
    it.each(fixture.FIXTURE_VARIANTS)('%s', async (variant) => {
      await stopSeedSideEffects(await fixture.writeFixture(variant))
      const statePath = join(root, 'fixture', variant, 'userdata', STATE_FILE)
      const raw = JSON.parse(await readFile(statePath, 'utf8')) as Doc

      let persistErrors = 0
      const store = new StateStore(statePath, {
        migrations: MODULE_MIGRATIONS,
        onPersistError: () => persistErrors++,
      })
      const doc = await store.load()

      // The app's own loaders register the real specs; the spy only reads back which keys they own.
      const section = vi.spyOn(store, 'section')
      configState(store)
      downloadsState(store)
      homeState(store)
      replaysState(store)
      serversState(store)
      unlockState(store)
      const specs = section.mock.calls.map(([spec]) => spec as StateSectionSpec<unknown>)
      section.mockRestore()
      const sections = Object.fromEntries(
        specs.map((spec) => [spec.key, store.section(spec).get()]),
      )

      const loaded: Doc = {
        schemaVersion: doc.schemaVersion,
        settings: store.settings(),
        installations: store.installations(),
        ...sections,
      }
      const problems = checkSeededState(raw, loaded, {
        legacy: fixture.LEGACY_SEED_VARIANTS.includes(variant),
        legacySchemaVersion: fixture.LEGACY_SEED_SCHEMA_VERSION,
      })
      await store.settle()

      expect(problems).toEqual([])
      expect(store.recoveredFrom).toBeNull()
      expect(persistErrors).toBe(0)
      expect([...warn.mock.calls, ...rootWarn.mock.calls]).toEqual([])
      expect([...error.mock.calls, ...rootError.mock.calls]).toEqual([])
    })
  })

  describe('checkSeededState', () => {
    const options = { legacy: false, legacySchemaVersion: fixture.LEGACY_SEED_SCHEMA_VERSION }
    const current = (): Doc => ({
      schemaVersion: STATE_SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS },
      installations: [{ id: 'install-a' }, { id: 'install-b' }],
      servers: { watchlist: [{ id: 'watch-a' }] },
    })

    it('a dropped installation row is reported', () => {
      expect(checkSeededState(current(), current(), options)).toEqual([])
      const loaded = { ...current(), installations: [{ id: 'install-a' }] }
      expect(checkSeededState(current(), loaded, options)).toEqual([
        'row "install-b" at installations[] was dropped on load',
      ])
    })

    it('a row under a key no section loaded is reported', () => {
      const { servers: _servers, ...loaded } = current()
      expect(checkSeededState(current(), loaded, options)).toEqual([
        'row "watch-a" at servers.watchlist[] was dropped on load',
      ])
    })

    it('a settings key the schema does not know is reported', () => {
      const raw = { ...current(), settings: { ...DEFAULT_SETTINGS, notASetting: true } }
      expect(checkSeededState(raw, current(), options)).toEqual([
        'settings.notASetting is seeded but not in the schema',
      ])
    })

    it('a stale schemaVersion on a current variant is reported', () => {
      const raw = { ...current(), schemaVersion: STATE_SCHEMA_VERSION - 1 }
      expect(checkSeededState(raw, current(), options)).toEqual([
        `schemaVersion is ${STATE_SCHEMA_VERSION - 1}, expected ${STATE_SCHEMA_VERSION}`,
      ])
    })
  })
})
