import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type RefreshFromFilesResult,
  type SaveProfileResult,
} from '@shared/modules/config'
import { resolveProfileFileNames } from '@shared/config/profile-files'
import { neutralizeProse } from '@shared/config/profile-metadata'
import {
  ROUND_TRIP_FIXTURES,
  holdLayerProfile,
  latin1CategoryNameProfile,
  layeredTwoSlotEntryProfile,
} from '@shared/config/fixtures/profiles'
import { fail, type Installation, type LaunchState, type Outcome } from '@shared/types'
import type { AppContext } from '../../context'
import { scopedLogger } from '../../lib/logger'
import { StateStore } from '../../services/state'
import type { ModuleHandler, ModuleSetup } from '../types'
import { hashCanonicalFileContent, readFileState } from './file-source'
import { renderProfileFile } from './render'
import { configModule } from './index'

/**
 * Story 043 D10 - the S07 carry-over rule's adversarial pass, but over the *pipeline* D1-D9 built
 * rather than over one of its parts.
 *
 * `round-trip.test.ts` (story 042 D9) already proves the render/parse fixed point
 * `render(parse(render(p))) === render(p)`, and `file-source.test.ts`/`rebuild.test.ts`/
 * `index.test.ts` each prove their own deliverable in isolation. What has no home until here is the
 * question those cannot answer: does that fixed point still hold once 043's machinery
 * (explicit save, external-edit detection, adopt, conflict, rebuild, migration) is layered on top,
 * and does anything about a profile get lost or mislabelled while it travels
 * **write -> external edit -> re-read/adopt/conflict -> render** for real?
 *
 * So every test below drives the real handlers against a real temp directory - no mock of
 * `readFileState`, no hand-built profile that avoids the interesting shapes: the payloads are 042's
 * own fixture profiles (`@shared/config/fixtures/profiles`), which carry self-mirroring aliases,
 * modifier-only slots, hold/toggle layers, latin-1 category names and all three section-header
 * styles. A `{ cvars: {}, actions: [] }` toy profile would hide exactly the bugs this pass exists to
 * find.
 *
 * Note on the story's own D10 file list: it names `src/shared/config/render-invariants.test.ts` and
 * `src/shared/config/profile-fixtures.ts` as new files for this deliverable. Both already existed
 * (stories 038-040) and have nothing to do with 043, so this pipeline pass lives here instead, next
 * to the main-process code it exercises.
 */

const log = scopedLogger('config-file-source-pipeline-test')

function collectHandlers(handlers: Map<string, ModuleHandler>): ModuleSetup['handle'] {
  return (type, schema, handler) => {
    handlers.set(type, (payload) => {
      const parsed = schema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      return handler(parsed.data)
    })
  }
}

/** Same hoisted-box pattern `index.test.ts` uses: the handlers resolve the canonical directory
 * through `lib/paths`' `userDataDir()`, i.e. `app.getPath('userData')`, which needs a real mock. */
const userDataBox = vi.hoisted(() => ({ current: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
  shell: { openPath: async () => '', showItemInFolder: () => {} },
}))

let dir: string
/** Every store `boot()` created in this test, so pending debounced writes are flushed before the
 * temp directory is removed - a `JsonStore` write landing after `rm` is only noise, but it is noise
 * that would make a real persistence failure impossible to spot in the output. */
let stores: StateStore[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-file-source-pipeline-'))
  userDataBox.current = join(dir, 'userData')
  stores = []
  await mkdir(userDataBox.current, { recursive: true })
})

afterEach(async () => {
  for (const store of stores) await store.settle()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'i1',
    name: 'Test',
    rootPath: join(dir, 'inst1'),
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: ['baseq2'],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

function idleState(): LaunchState {
  return { phase: 'idle', installationId: null }
}

interface Booted {
  handlers: Map<string, ModuleHandler>
  state: StateStore
}

/**
 * Boots the real config module over a real, temp-file-backed `StateStore`, exactly as
 * `index.test.ts` does. `seed` runs *before* `setup()` so a test can put a pre-043 `state.json` and a
 * pre-042 file on disk and then watch the startup migration/rebuild act on them.
 */
async function boot(
  installations: Installation[] = [],
  seed?: (state: StateStore) => void | Promise<void>,
): Promise<Booted> {
  const state = new StateStore(join(dir, 'state.json'))
  stores.push(state)
  await state.load()
  await seed?.(state)
  await state.settle()
  const handlers = new Map<string, ModuleHandler>()
  await configModule.setup({
    handle: collectHandlers(handlers),
    emit: () => {},
    app: {
      installations: {
        find: (id: string) => installations.find((i) => i.id === id),
        list: () => installations,
      },
      launch: { getState: () => idleState() },
      state,
    } as unknown as AppContext,
    log,
  })
  // Flushed before the test looks at anything: `setup()`'s own startup work (AC8's migration guard,
  // the seeded hashes, a rebuilt record) is persisted through the debounced `JsonStore`, so a test
  // that boots a SECOND time over the same `state.json` would otherwise read a file that does not
  // yet carry what the first boot decided - and would see the migration run twice for reasons that
  // have nothing to do with the guard.
  await state.settle()
  return { handlers, state }
}

/** One fixture profile, re-identified so every test can talk about `p1`, and given a name that is
 * distinctive enough to be found (and hand-edited) inside the rendered header. */
function seededProfile(
  base: ConfigProfile,
  overrides: Partial<ConfigProfile> = {},
): ConfigProfile {
  return {
    ...base,
    id: 'p1',
    name: 'Adversarial',
    cvars: { ...base.cvars, sensitivity: '3' },
    assignments: [],
    ...overrides,
  }
}

function only(state: StateStore, profileId = 'p1'): ConfigProfile {
  return state.configProfiles().find((p) => p.id === profileId)!
}

function fileNameOf(state: StateStore, profileId = 'p1'): string {
  return resolveProfileFileNames(state.configProfiles()).get(profileId)!
}

function canonicalPath(fileName: string): string {
  return join(userDataBox.current, fileName)
}

async function save(
  handlers: Map<string, ModuleHandler>,
  input: { profileId?: string; force?: boolean } = {},
): Promise<Outcome<SaveProfileResult>> {
  return (await handlers.get(CONFIG_HANDLERS.save)!({
    profileId: input.profileId ?? 'p1',
    ...(input.force === undefined ? {} : { force: input.force }),
  })) as Outcome<SaveProfileResult>
}

async function refresh(
  handlers: Map<string, ModuleHandler>,
  input: { profileId?: string; discardLocalEdits?: boolean } = {},
): Promise<RefreshFromFilesResult> {
  const result = (await handlers.get(CONFIG_HANDLERS.refreshFromFiles)!(
    input,
  )) as Outcome<RefreshFromFilesResult>
  if (!result.ok) throw new Error(`refreshFromFiles failed: ${result.error.key}`)
  return result.value
}

/**
 * What must never shrink across any cycle in this file - the story's own hard requirement ("no
 * profile loses a bind, an alias name, a category or a layer"). Names, not ids: every id a
 * reconstruction mints is fresh by construction (see `round-trip.test.ts`'s own reasoning), so
 * comparing ids would compare nothing but the id factory.
 *
 * Two normalisations, both of which are about what a *file* can carry rather than about making a
 * test pass - a genuine loss stays visible through either:
 *
 * - an entry is identified by its `catalogId` when it has one, because that is what the file
 *   carries (`cid=`) and what the entry's display name is then re-derived from: a catalogue row the
 *   bind-adoption pass named `"drop rockets"` after its own command legitimately comes back under
 *   the catalogue's own label `"Rockets"`, which is the same row, better named;
 * - prose is compared through `neutralizeProse`, the very function the renderer applies before
 *   writing a name into a comment, so a deliberately forged name like
 *   `Sneaky [q2l cat=movement] category` is compared as the `(q2l ...` the file is allowed to hold
 *   (story 042's anti-forgery rule) instead of counting as a lost category.
 */
interface Inventory {
  binds: string[]
  entries: string[]
  categories: string[]
  layers: string[]
}

function inventory(profile: ConfigProfile): Inventory {
  return {
    binds: Object.keys(profile.binds).sort(),
    entries: (profile.actions ?? []).map((a) => a.catalogId ?? neutralizeProse(a.name)).sort(),
    categories: (profile.categories ?? []).map((c) => neutralizeProse(c.name)).sort(),
    layers: (profile.layers ?? []).map((l) => neutralizeProse(l.name)).sort(),
  }
}

/** Asserts nothing in `before` is missing from `after` (extra entries are allowed - a re-read
 * legitimately learns about physical bind lines the cache did not carry). */
function expectNothingLost(before: Inventory, after: Inventory, context: string): void {
  for (const key of ['binds', 'entries', 'categories', 'layers'] as const) {
    for (const name of before[key]) {
      expect(after[key], `${context}: ${key} lost "${name}"`).toContain(name)
    }
  }
}

// ---------------------------------------------------------------------------
// 1. An external edit during a UI session: conflict, and both resolutions.
// ---------------------------------------------------------------------------

describe('external edit while the UI carries unsaved edits', () => {
  /** The Notepad half of the scenario: one changed cvar value and one changed display name in the
   * header banner - a content change AND a metadata change in the same edit. */
  function handEdit(content: string): string {
    const edited = content
      .replace(/^(set sensitivity\s+)"3"/m, '$1"11"')
      .replace('Adversarial', 'Edited in Notepad')
    expect(edited).not.toBe(content)
    return edited
  }

  async function setUpConflict(): Promise<
    Booted & { fileName: string; diskText: string; ourText: string }
  > {
    const inst = installation()
    const booted = await boot([inst])
    booted.state.setConfigProfiles([
      seededProfile(holdLayerProfile, { assignments: [{ installationId: 'i1', isDefault: true }] }),
    ])
    await booted.state.settle()

    const first = await save(booted.handlers)
    if (!first.ok || first.value.status !== 'saved') throw new Error('expected the first save to work')
    const fileName = fileNameOf(booted.state)

    // Notepad edits the file...
    const diskText = handEdit(await readFile(canonicalPath(fileName), 'latin1'))
    await writeFile(canonicalPath(fileName), diskText, 'latin1')
    // ...while the UI has an unsaved edit of its own.
    await booted.handlers.get(CONFIG_HANDLERS.setCvars)!({
      profileId: 'p1',
      cvars: { ...only(booted.state).cvars, sensitivity: '9' },
    })
    expect(only(booted.state).dirty).toBe(true)

    return { ...booted, fileName, diskText, ourText: renderProfileFile(only(booted.state)) }
  }

  it('refuses the save, carries both whole files and loses neither version', async () => {
    const { handlers, state, fileName, diskText, ourText } = await setUpConflict()

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to answer, not fail')
    if (result.value.status !== 'conflict') {
      throw new Error(`expected a conflict, got ${result.value.status}`)
    }
    expect(result.value.diskContent).toBe(diskText)
    expect(result.value.ourContent).toBe(ourText)
    expect(result.value.diskContent).not.toBe(result.value.ourContent)
    // Neither version was picked: the file still holds the hand-edit, the cache still holds ours.
    expect(await readFile(canonicalPath(fileName), 'latin1')).toBe(diskText)
    expect(only(state).cvars['sensitivity']).toBe('9')
    expect(only(state).dirty).toBe(true)
    // `refreshFromFiles` must answer the same way rather than adopting behind the dialog's back.
    expect(await refresh(handlers, { profileId: 'p1' })).toEqual([
      expect.objectContaining({ profileId: 'p1', outcome: 'conflict', fileState: 'changedOnDisk' }),
    ])
    expect(only(state).cvars['sensitivity']).toBe('9')
  })

  it('resolution "overwrite with my version" ends dirty:false with a hash that matches the disk', async () => {
    const { handlers, state, fileName } = await setUpConflict()
    const before = inventory(only(state))

    const forced = await save(handlers, { force: true })

    if (!forced.ok || forced.value.status !== 'saved') throw new Error('expected the forced save to work')
    const onDisk = await readFile(canonicalPath(fileName), 'latin1')
    expect(onDisk).toBe(renderProfileFile(forced.value.profile))
    const saved = only(state)
    expect(saved.dirty).toBe(false)
    expect(saved.fileHash).toBe(hashCanonicalFileContent(onDisk))
    expect(saved.cvars['sensitivity']).toBe('9')
    expectNothingLost(before, inventory(saved), 'force-save')
    // The very next read must not call our own write an external edit.
    expect(await refresh(handlers, { profileId: 'p1' })).toEqual([
      { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
    ])
  })

  it('resolution "take the file" adopts the disk version, clears dirty and reseeds the hash', async () => {
    const { handlers, state, fileName, diskText } = await setUpConflict()
    const before = inventory(only(state))

    const results = await refresh(handlers, { profileId: 'p1', discardLocalEdits: true })

    expect(results).toEqual([
      expect.objectContaining({ profileId: 'p1', outcome: 'adopted', fileState: 'changedOnDisk' }),
    ])
    const adopted = only(state)
    // The disk version, in full: the hand-edited cvar AND the hand-edited display name.
    expect(adopted.cvars['sensitivity']).toBe('11')
    expect(adopted.name).toBe('Edited in Notepad')
    expect(adopted.dirty).toBe(false)
    expect(adopted.fileHash).toBe(hashCanonicalFileContent(diskText))
    expect(adopted.fileState).toBe('unchanged')
    // The file itself was not rewritten by adopting it.
    expect(await readFile(canonicalPath(fileName), 'latin1')).toBe(diskText)
    expectNothingLost(before, inventory(adopted), 'adopt')
    expect(await refresh(handlers, { profileId: 'p1' })).toEqual([
      { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
    ])
  })
})

// ---------------------------------------------------------------------------
// 2. Two different kinds of change landing on the same profile at once.
// ---------------------------------------------------------------------------

describe('conflicting simultaneous changes', () => {
  it('an assign never writes over a hand-edit the launcher has not read (AC5)', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([seededProfile(holdLayerProfile)])
    await state.settle()
    const saved = await save(handlers)
    if (!saved.ok || saved.value.status !== 'saved') throw new Error('expected the save to work')
    const fileName = fileNameOf(state)
    const seededHash = only(state).fileHash

    // Notepad, then an action that is NOT a save and NOT preceded by any refresh - the exact
    // sequence D4's report named as a residual risk. The profile is clean, so nothing about `dirty`
    // protects the file here; only "we have not read these bytes" can.
    const handEdited = `${await readFile(canonicalPath(fileName), 'latin1')}// hand-added by the user\n`
    await writeFile(canonicalPath(fileName), handEdited, 'latin1')

    const assigned = await handlers.get(CONFIG_HANDLERS.assign)!({
      profileId: 'p1',
      installationId: 'i1',
    })

    expect(assigned).toMatchObject({ ok: true })
    expect(await readFile(canonicalPath(fileName), 'latin1')).toBe(handEdited)
    // The stale baseline is kept, not quietly re-seeded to the bytes we refused to read.
    expect(only(state).fileHash).toBe(seededHash)
    // And the refresh that follows (focus, tab open) still finds the edit and adopts it.
    const results = await refresh(handlers, { profileId: 'p1' })
    expect(results).toEqual([
      expect.objectContaining({ profileId: 'p1', outcome: 'adopted' }),
    ])
  })

  it('the startup retry sweep never writes over a hand-edit made while the launcher was closed', async () => {
    const inst = installation()
    const first = await boot([inst])
    first.state.setConfigProfiles([
      seededProfile(holdLayerProfile, { assignments: [{ installationId: 'i1', isDefault: true }] }),
    ])
    await first.state.settle()
    const saved = await save(first.handlers)
    if (!saved.ok || saved.value.status !== 'saved') throw new Error('expected the save to work')
    const fileName = fileNameOf(first.state)
    // A write that failed last session - one of the three retry triggers, and the one that runs
    // before the renderer (and therefore before any focus re-read) exists at all.
    first.state.setConfigWriteFailures({
      'p1|i1': { messageKey: 'config.error.writeFailed', at: '2026-01-01T00:00:00.000Z' },
    })
    await first.state.settle()

    const handEdited = `${await readFile(canonicalPath(fileName), 'latin1')}// edited between sessions\n`
    await writeFile(canonicalPath(fileName), handEdited, 'latin1')

    // Next start: `setup()` runs the sweep.
    await boot([inst])

    expect(await readFile(canonicalPath(fileName), 'latin1')).toBe(handEdited)
  })

  it('a save and an assign in flight at the same time leave one coherent file and no phantom bookkeeping', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([seededProfile(holdLayerProfile)])
    await state.settle()
    await save(handlers)
    // An unsaved edit, then both actions fired without awaiting the first - two sync runs over the
    // same profile and the same files, interleaving at every `await`. Nothing serialises them today,
    // so what matters is whether the end state is still internally consistent.
    await handlers.get(CONFIG_HANDLERS.setCvars)!({
      profileId: 'p1',
      cvars: { ...only(state).cvars, sensitivity: '9' },
    })

    const [saveResult, assignResult] = await Promise.all([
      save(handlers),
      handlers.get(CONFIG_HANDLERS.assign)!({ profileId: 'p1', installationId: 'i1' }),
    ])

    expect(assignResult).toMatchObject({ ok: true })
    expect(saveResult).toMatchObject({ ok: true })
    const fileName = fileNameOf(state)
    const onDisk = await readFile(canonicalPath(fileName), 'latin1')
    const final = only(state)
    // The edit is on disk exactly once, the cache agrees with it, and the bookkeeping says so: no
    // half-written file, no stale `fileHash`, no write failure recorded for a write that worked.
    expect(final.cvars['sensitivity']).toBe('9')
    expect(onDisk).toBe(renderProfileFile(final))
    expect(final.dirty).toBe(false)
    expect(final.fileHash).toBe(hashCanonicalFileContent(onDisk))
    expect(state.configWriteFailures()).toEqual({})
    expect(state.configPendingWrites()).toEqual({})
    expect(await refresh(handlers, { profileId: 'p1' })).toEqual([
      { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
    ])
  })

  it('a rename cascade moves both files, destroys neither and leaves the bookkeeping true', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([
      seededProfile(holdLayerProfile, { id: 'p1', name: 'Duel' }),
      seededProfile(layeredTwoSlotEntryProfile, {
        id: 'p2',
        name: 'Frag',
        createdAt: '2026-02-01T00:00:00.000Z',
      }),
    ])
    await state.settle()
    await save(handlers, { profileId: 'p1' })
    await save(handlers, { profileId: 'p2' })
    const before = { p1: inventory(only(state, 'p1')), p2: inventory(only(state, 'p2')) }

    // p2 now wants p1's file name; `resolveProfileFileNames` gives the older claim (p1) the plain
    // name and moves the other to `-2`, so this is the displacement cascade in `sync.ts`.
    await handlers.get(CONFIG_HANDLERS.rename)!({ id: 'p2', name: 'Duel' })
    const renamed = await save(handlers, { profileId: 'p2' })

    if (!renamed.ok || renamed.value.status !== 'saved') {
      throw new Error(`expected the rename save to work, got ${renamed.ok ? renamed.value.status : 'fail'}`)
    }
    // Every live profile still has exactly one file, holding exactly its own content.
    for (const profileId of ['p1', 'p2'] as const) {
      const profile = only(state, profileId)
      const fileName = fileNameOf(state, profileId)
      const content = await readFile(canonicalPath(fileName), 'latin1')
      expect(content, `${profileId} owns ${fileName}`).toContain(`profile ${profileId} `)
      expect(profile.fileHash).toBe(hashCanonicalFileContent(content))
      expectNothingLost(before[profileId], inventory(profile), `${profileId} after the cascade`)
    }
    expect(state.configWriteFailures()).toEqual({})
    expect(state.configPendingWrites()).toEqual({})
    // Neither profile may be reported as changed-on-disk or missing after a cascade that wrote both.
    expect(await refresh(handlers)).toEqual([
      { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
      { profileId: 'p2', outcome: 'unchanged', fileState: 'unchanged' },
    ])
  })

  it('a renamed-but-unsaved profile is never reported as "file missing" - its file is still there under the old name', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([seededProfile(holdLayerProfile)])
    await state.settle()
    await save(handlers)
    const oldFileName = fileNameOf(state)

    // A rename only marks the profile dirty (D4), so the file legitimately still sits under its old
    // name. Reporting `missing` here would offer the user "Remove profile" for a profile whose file
    // is perfectly fine - the same lookup `save` does through the ownership sentinel is what keeps
    // this honest.
    await handlers.get(CONFIG_HANDLERS.rename)!({ id: 'p1', name: 'Renamed' })
    expect(fileNameOf(state)).not.toBe(oldFileName)

    const results = await refresh(handlers, { profileId: 'p1' })

    expect(results[0]!.outcome).not.toBe('missing')
    expect(only(state).fileState).not.toBe('missing')
    // Unchanged: the bytes under the old name are still exactly what we last wrote.
    expect(results).toEqual([{ profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' }])
  })
})

// ---------------------------------------------------------------------------
// 3. Corrupt / unparseable files.
// ---------------------------------------------------------------------------

describe('corrupt files', () => {
  async function bootSaved(): Promise<Booted & { fileName: string; good: ConfigProfile }> {
    const booted = await boot()
    booted.state.setConfigProfiles([seededProfile(latin1CategoryNameProfile)])
    await booted.state.settle()
    const saved = await save(booted.handlers)
    if (!saved.ok || saved.value.status !== 'saved') throw new Error('expected the save to work')
    return { ...booted, fileName: fileNameOf(booted.state), good: only(booted.state) }
  }

  const CORRUPTIONS: { label: string; corrupt: (good: string) => string }[] = [
    {
      label: 'NUL-truncated mid-line (an interrupted write)',
      corrupt: (good) =>
        `${good.slice(0, Math.floor(good.length / 2))}${String.fromCharCode(0).repeat(64)}`,
    },
    {
      label: 'binary garbage',
      corrupt: () =>
        Array.from({ length: 400 }, (_v, i) => String.fromCharCode((i * 7) % 32)).join(''),
    },
  ]

  for (const { label, corrupt } of CORRUPTIONS) {
    it(`reports ${label} as unparseable and keeps the last good cache intact`, async () => {
      const { handlers, state, fileName, good } = await bootSaved()
      const before = inventory(good)
      await writeFile(
        canonicalPath(fileName),
        Buffer.from(corrupt(await readFile(canonicalPath(fileName), 'latin1')), 'latin1'),
      )

      // The read layer itself must say so, with a diagnostic that names a real position.
      const read = await readFileState(userDataBox.current, fileName, good.fileHash)
      expect(read.state).toBe('unparseable')
      if (read.state === 'unparseable') {
        expect(read.file).toBe(fileName)
        expect(read.line).toBeGreaterThanOrEqual(1)
        expect(read.message.length).toBeGreaterThan(0)
      }

      // ...and the handler must not adopt any of it.
      const results = await refresh(handlers, { profileId: 'p1' })
      expect(results).toEqual([
        expect.objectContaining({ profileId: 'p1', outcome: 'unparseable', file: fileName }),
      ])
      const cached = only(state)
      expect(inventory(cached)).toEqual(before)
      expect(cached.cvars).toEqual(good.cvars)
      expect(cached.fileHash).toBe(good.fileHash)
      expect(cached.fileState).toBe('unparseable')

      // A save over it refuses rather than writing blind, and reports the same diagnostic - and the
      // corrupt file is left exactly as it is, because "unreadable" is as much a hand-edit we have
      // not read as a changed file is (the user's own copy of it is the only thing that can still
      // explain what happened, so the launcher must not stamp over it).
      const corruptBytes = await readFile(canonicalPath(fileName), 'latin1')
      const result = await save(handlers)
      if (!result.ok) throw new Error('expected save to answer, not fail')
      expect(result.value.status).toBe('unreadable')
      if (result.value.status === 'unreadable') expect(result.value.reason).toBe('unparseable')
      expect(await readFile(canonicalPath(fileName), 'latin1')).toBe(corruptBytes)
      expect(inventory(only(state))).toEqual(before)
    })
  }

  it('a malformed-but-textual file (an unterminated quote) degrades rather than being called corrupt', async () => {
    const { handlers, state, fileName, good } = await bootSaved()
    const good_text = await readFile(canonicalPath(fileName), 'latin1')
    // Story 042's own rule: text that still reads as config lines degrades to a warning, never to a
    // failure - so this must NOT be classified `unparseable`, and it must not lose the profile.
    const mangled = good_text.replace(/^(set sensitivity\s+)"3"$/m, '$1"3')
    expect(mangled).not.toBe(good_text)
    await writeFile(canonicalPath(fileName), mangled, 'latin1')

    const read = await readFileState(userDataBox.current, fileName, good.fileHash)

    expect(read.state).toBe('changedOnDisk')
    const results = await refresh(handlers, { profileId: 'p1' })
    expect(results[0]!.outcome).toBe('adopted')
    expectNothingLost(inventory(good), inventory(only(state)), 'unterminated quote')
  })

  it('an emptied file is adopted as an empty profile, never as a lost profile record', async () => {
    const { handlers, state, fileName } = await bootSaved()
    await writeFile(canonicalPath(fileName), '', 'latin1')

    const results = await refresh(handlers, { profileId: 'p1' })

    // The file is the source of truth, so "the user emptied it" is a legitimate statement about
    // content - what must never happen is the record disappearing or the launcher crashing.
    expect(results[0]!.outcome).toBe('adopted')
    expect(state.configProfiles()).toHaveLength(1)
    expect(only(state).id).toBe('p1')
  })
})

// ---------------------------------------------------------------------------
// 4. A deleted file, under a clean and under a dirty profile.
// ---------------------------------------------------------------------------

describe('a canonical file deleted outside the launcher', () => {
  for (const dirty of [false, true]) {
    it(`reports missing and keeps the record for a ${dirty ? 'dirty' : 'clean'} profile`, async () => {
      const { handlers, state } = await boot()
      state.setConfigProfiles([seededProfile(holdLayerProfile)])
      await state.settle()
      await save(handlers)
      const fileName = fileNameOf(state)
      const before = inventory(only(state))
      if (dirty) {
        await handlers.get(CONFIG_HANDLERS.setCvars)!({
          profileId: 'p1',
          cvars: { ...only(state).cvars, sensitivity: '9' },
        })
      }

      await rm(canonicalPath(fileName))
      const results = await refresh(handlers, { profileId: 'p1' })

      expect(results).toEqual([{ profileId: 'p1', outcome: 'missing', fileState: 'missing' }])
      expect(state.configProfiles()).toHaveLength(1)
      expectNothingLost(before, inventory(only(state)), 'missing file')
      expect(only(state).dirty).toBe(dirty)

      // "Rewrite from cache" is a save, and a save must treat "nothing there" as ours to write -
      // including (especially) when the cache carries unsaved edits.
      const rewritten = await save(handlers)
      if (!rewritten.ok || rewritten.value.status !== 'saved') {
        throw new Error(`expected the rewrite to save, got ${rewritten.ok ? rewritten.value.status : 'fail'}`)
      }
      const onDisk = await readFile(canonicalPath(fileName), 'latin1')
      expect(onDisk).toBe(renderProfileFile(rewritten.value.profile))
      if (dirty) expect(rewritten.value.profile.cvars['sensitivity']).toBe('9')
      expect(only(state).dirty).toBe(false)
      expect(only(state).fileHash).toBe(hashCanonicalFileContent(onDisk))
      expect(await refresh(handlers, { profileId: 'p1' })).toEqual([
        { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
      ])
    })
  }
})

// ---------------------------------------------------------------------------
// 5. AC8's one-time migration of a pre-042 profile.
// ---------------------------------------------------------------------------

describe('AC8 migration of a pre-042 profile', () => {
  /** A `state.json` record as it would have been before this story: no `fileHash`, no `fileSeenAt`,
   * no `dirty`, no `fileState`. */
  function pre043Record(): ConfigProfile {
    const record = seededProfile(latin1CategoryNameProfile)
    delete record.fileHash
    delete record.fileSeenAt
    delete record.dirty
    delete record.fileState
    return record
  }

  /** The file such a profile would have on disk before story 040/042: the old sentinel wording, no
   * `[q2l ...]` metadata tags at all. */
  const PRE_040_FILE =
    '// q2-launcher profile p1 - generated, do not edit\n' +
    'unbindall\n' +
    'set sensitivity "3"\n' +
    'bind w "+forward"\n'

  it('brings the file to the current format, seeds the hash and loses nothing from the record', async () => {
    const record = pre043Record()
    const fileName = resolveProfileFileNames([record]).get('p1')!
    const { state } = await boot([], async (s) => {
      s.setConfigProfiles([record])
      await writeFile(canonicalPath(fileName), PRE_040_FILE, 'latin1')
    })

    expect(state.configFileSourceMigratedAt()).not.toBeNull()
    const migrated = only(state)
    // Content: exactly what the cache said, in the current format - not a re-parse of the old file.
    expectNothingLost(inventory(record), inventory(migrated), 'migration')
    expect(migrated.cvars).toEqual(record.cvars)
    const onDisk = await readFile(canonicalPath(fileName), 'latin1')
    expect(onDisk).toBe(renderProfileFile(migrated))
    expect(onDisk).toContain('[q2l v=')
    expect(onDisk).not.toContain('generated, do not edit')
    // The seeded hash is the whole point: the first read after a migration must be `unchanged`.
    expect(migrated.fileHash).toBe(hashCanonicalFileContent(onDisk))
    expect(migrated.dirty).toBe(false)
    const read = await readFileState(userDataBox.current, fileName, migrated.fileHash)
    expect(read.state).toBe('unchanged')
  })

  it('runs once: a second start rewrites nothing and re-reads as unchanged', async () => {
    const record = pre043Record()
    const fileName = resolveProfileFileNames([record]).get('p1')!
    const first = await boot([], async (s) => {
      s.setConfigProfiles([record])
      await writeFile(canonicalPath(fileName), PRE_040_FILE, 'latin1')
    })
    const migratedAt = first.state.configFileSourceMigratedAt()
    const afterFirst = await readFile(canonicalPath(fileName), 'latin1')
    const statFirst = await stat(canonicalPath(fileName))

    const second = await boot()

    expect(second.state.configFileSourceMigratedAt()).toBe(migratedAt)
    expect(await readFile(canonicalPath(fileName), 'latin1')).toBe(afterFirst)
    expect((await stat(canonicalPath(fileName))).mtimeMs).toBe(statFirst.mtimeMs)
    expect(await refresh(second.handlers)).toEqual([
      { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
    ])
  })

  it('migrates a profile that never had a file at all', async () => {
    const record = pre043Record()
    const fileName = resolveProfileFileNames([record]).get('p1')!
    const { state, handlers } = await boot([], (s) => void s.setConfigProfiles([record]))

    const onDisk = await readFile(canonicalPath(fileName), 'latin1')
    expect(onDisk).toBe(renderProfileFile(only(state)))
    expect(only(state).fileHash).toBe(hashCanonicalFileContent(onDisk))
    expect(await refresh(handlers)).toEqual([
      { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
    ])
  })
})

// ---------------------------------------------------------------------------
// 6. A record lost from state.json, rebuilt from the file with the same id.
// ---------------------------------------------------------------------------

describe('rebuild from the file with the sentinel id', () => {
  it('restores a deleted record with the same id and no loss of content', async () => {
    const first = await boot()
    first.state.setConfigProfiles([seededProfile(layeredTwoSlotEntryProfile)])
    await first.state.settle()
    const saved = await save(first.handlers)
    if (!saved.ok || saved.value.status !== 'saved') throw new Error('expected the save to work')
    const fileName = fileNameOf(first.state)
    const before = inventory(only(first.state))
    const onDisk = await readFile(canonicalPath(fileName), 'latin1')

    // The crash/hand-edit case: the record is gone, the file is not.
    first.state.setConfigProfiles([])
    await first.state.settle()
    // A foreign `.cfg` next to it must not be adopted as a profile.
    await writeFile(canonicalPath('hand-written.cfg'), 'set sensitivity "5"\n', 'latin1')

    const second = await boot()

    const profiles = second.state.configProfiles()
    expect(profiles).toHaveLength(1)
    const rebuilt = profiles[0]!
    expect(rebuilt.id).toBe('p1')
    expect(rebuilt.name).toBe('Adversarial')
    expectNothingLost(before, inventory(rebuilt), 'rebuild')
    expect(rebuilt.assignments).toEqual([])
    expect(rebuilt.dirty).toBe(false)
    expect(rebuilt.fileHash).toBe(hashCanonicalFileContent(onDisk))
    // The file was read, never rewritten, by the rebuild.
    expect(await readFile(canonicalPath(fileName), 'latin1')).toBe(onDisk)
    expect(await refresh(second.handlers)).toEqual([
      { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
    ])
  })

  it('rebuilds a record whose persisted row is corrupt, keeping the id', async () => {
    const first = await boot()
    first.state.setConfigProfiles([seededProfile(holdLayerProfile)])
    await first.state.settle()
    await save(first.handlers)
    const fileName = fileNameOf(first.state)
    const before = inventory(only(first.state))

    // A hand-mangled `state.json` row: `parseConfigProfile` drops it on load, so by the time the
    // rebuild runs a corrupt record IS a missing record.
    const statePath = join(dir, 'state.json')
    const raw = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>
    ;(raw['configProfiles'] as Record<string, unknown>[])[0]!['name'] = 42
    await writeFile(statePath, JSON.stringify(raw), 'utf8')

    const second = await boot()

    const profiles = second.state.configProfiles()
    expect(profiles).toHaveLength(1)
    expect(profiles[0]!.id).toBe('p1')
    expectNothingLost(before, inventory(profiles[0]!), 'rebuild from a corrupt row')
    expect(await readFile(canonicalPath(fileName), 'latin1')).toContain('profile p1 ')
  })
})

// ---------------------------------------------------------------------------
// 7. The whole cycle over every 042 fixture: nothing lost, fixed point holds.
// ---------------------------------------------------------------------------

describe('write -> external edit -> re-read -> render over every 042 fixture', () => {
  /**
   * The one fixture whose content the file format genuinely cannot carry, so it gets its own,
   * explicit test below instead of being silently excluded here: an entry with **no key** whose
   * command is exactly its catalogue default renders to nothing at all - no alias line (a
   * self-mirroring catalogue command drops its own line, story 034/038), no bind line (there is no
   * key), no anchor line (those exist for modifier-carrying slots). See the test for what that means
   * and why it is a named limitation rather than a bug fixed here.
   */
  const NO_FILE_REPRESENTATION = new Set(['Keyless catalogue entry'])

  for (const fixture of ROUND_TRIP_FIXTURES.filter((f) => !NO_FILE_REPRESENTATION.has(f.name))) {
    it(`keeps every bind, entry, category and layer of "${fixture.name}"`, async () => {
      const { handlers, state } = await boot()
      state.setConfigProfiles([{ ...fixture, id: 'p1', assignments: [] }])
      await state.settle()

      const saved = await save(handlers)
      if (!saved.ok || saved.value.status !== 'saved') {
        throw new Error(`expected a save for ${fixture.name}`)
      }
      const before = inventory(only(state))
      const fileName = fileNameOf(state)
      const written = await readFile(canonicalPath(fileName), 'latin1')
      expect(written).toBe(renderProfileFile(saved.value.profile))

      // An external edit that changes nothing structural: one appended comment plus CRLF line
      // endings, both of which a user's editor really does produce on Windows.
      const external = `${written.replace(/\n/g, '\r\n')}// touched by hand\r\n`
      await writeFile(canonicalPath(fileName), external, 'latin1')

      const results = await refresh(handlers, { profileId: 'p1' })
      expect(results[0]!.outcome).toBe('adopted')
      const adopted = only(state)
      expectNothingLost(before, inventory(adopted), `${fixture.name} after adopting a CRLF edit`)

      // And the fixed point survives one more full turn of the pipeline: saving the adopted profile
      // and re-reading it reports `unchanged`, and a second adopt cycle is stable.
      const resaved = await save(handlers)
      if (!resaved.ok || resaved.value.status !== 'saved') {
        throw new Error(`expected a re-save for ${fixture.name}`)
      }
      expect(await refresh(handlers, { profileId: 'p1' })).toEqual([
        { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
      ])
      expectNothingLost(
        inventory(adopted),
        inventory(only(state)),
        `${fixture.name} after a second cycle`,
      )
    })
  }

  /**
   * ACCEPTED LIMITATION, pinned rather than hidden (story 043 D10).
   *
   * An entry with no key at all whose command is exactly its catalogue default has no
   * representation in the rendered file - the whole profile renders to a header plus `unbindall`.
   * Once the file is the source of truth, adopting that file (or rebuilding from it) therefore
   * cannot bring the entry back, and the row disappears from the Controls grid.
   *
   * Not fixed here, deliberately: the fix is a new anchor line in `render.ts`'s output for keyless
   * entries, i.e. a change to story 042's on-disk format and to every test that pins it, which is
   * neither this deliverable's file set nor a change to make in a story's last deliverable. The
   * bounded cost is what makes that acceptable: such an entry is by definition not bound to
   * anything, so nothing about the profile's actual behaviour in the engine is lost with it - only a
   * half-configured row in the UI, and only once the file has actually been edited outside the
   * launcher. Worth a follow-up story; recorded here so it can never be found again as a surprise.
   */
  it('names, rather than hides, the one shape the file cannot carry: a keyless catalogue entry', async () => {
    const fixture = ROUND_TRIP_FIXTURES.find((f) => f.name === 'Keyless catalogue entry')!
    const { handlers, state } = await boot()
    state.setConfigProfiles([{ ...fixture, id: 'p1', assignments: [] }])
    await state.settle()
    await save(handlers)
    const fileName = fileNameOf(state)
    expect(inventory(only(state)).entries).not.toEqual([])

    // The rendered file carries no line for the entry - which is the limitation itself.
    const written = await readFile(canonicalPath(fileName), 'latin1')
    expect(written).not.toContain('moveleft')

    await writeFile(canonicalPath(fileName), `${written}// touched by hand\n`, 'latin1')
    const results = await refresh(handlers, { profileId: 'p1' })

    expect(results[0]!.outcome).toBe('adopted')
    // The profile itself survives; the keyless entry does not, because the file never held it.
    expect(state.configProfiles()).toHaveLength(1)
    expect(inventory(only(state)).entries).toEqual([])
  })
})
