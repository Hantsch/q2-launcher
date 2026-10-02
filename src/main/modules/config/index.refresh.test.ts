import { unwrapOk } from '../../../test-support/outcome'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type RefreshFromFilesResult,
} from '@shared/modules/config'
import { type Installation, type Outcome } from '@shared/types'
import { type AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { type ModuleHandler } from '../types'
import { hashCanonicalFileContent, readFileState } from './file-source'
import { renderProfileFile } from './render'
import { configModule } from './index'
import {
  collectHandlers,
  idleState,
  installation,
  log,
  profile,
  useConfigTestDir,
  userDataBox,
} from './index.test-helpers'
import { configState } from './persisted'
import { seedConfigProfiles } from '../../../test-support/config-state'

/**
 * Story 043 D5: `readFileState` is wrapped (delegating to the real implementation by default) so
 * `refreshFromFiles`' `unparseable`/`readError` branches - defensive boundaries a real file cannot
 * realistically trigger - can still be exercised with `mockResolvedValueOnce`.
 */
vi.mock('./file-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./file-source')>()
  return { ...actual, readFileState: vi.fn(actual.readFileState) }
})

vi.mock('electron', async () => {
  const h = await import('./index.test-helpers')
  return { app: { getPath: () => h.userDataBox.current }, shell: h.shellMock }
})

const getDir = useConfigTestDir()
let dir: string
beforeEach(() => {
  dir = getDir()
})

/**
 * Story 043 D5: `refreshFromFiles` - the re-read side of the story's "re-read on window focus, tab
 * open, and before write" decision. Same duck-typed `app` + real temp-file-backed `StateStore` boot
 * as the sections above.
 */
describe('CONFIG_HANDLERS.refreshFromFiles handler (story 043 D5)', () => {
  async function boot(
    installations: Installation[] = [],
  ): Promise<{ handlers: Map<string, ModuleHandler>; state: StateStore }> {
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    const handlers = new Map<string, ModuleHandler>()
    await configModule.setup({
      handle: collectHandlers(handlers),
      emit: () => {},
      onDispose: () => {},
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
    return { handlers, state }
  }

  async function refresh(
    handlers: Map<string, ModuleHandler>,
    profileId?: string,
  ): Promise<Outcome<RefreshFromFilesResult>> {
    return (await handlers.get(CONFIG_HANDLERS.refreshFromFiles)!(
      profileId === undefined ? {} : { profileId },
    )) as Outcome<RefreshFromFilesResult>
  }

  it('reports unchanged and leaves state.json untouched when the file matches the cached hash', async () => {
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const before = configState(state).profiles.get()[0]!

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toEqual([
      { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
    ])
    // Nothing in state.json changed - not even a re-stamped `fileSeenAt`.
    expect(configState(state).profiles.get()[0]).toEqual(before)
  })

  it('adopts a hand-edit (cvar value and header display name) when the profile carries no unsaved edits', async () => {
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const path = join(userDataBox.current, 'Profile.cfg')
    const onDisk = await readFile(path, 'latin1')

    // Hand-edit: bump the cvar value and change the header's display-name comment - the exact
    // scenario the acceptance line names ("changes a cvar value or display-name comment").
    const edited = onDisk
      .replace(/sensitivity(\s*)"3"/, 'sensitivity$1"5"')
      .replace('Profile', 'Hand-Edited')
    expect(edited).not.toBe(onDisk)
    await writeFile(path, edited, 'latin1')
    const newHash = hashCanonicalFileContent(edited)

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toHaveLength(1)
    const entry = result.value[0]!
    if (entry.outcome !== 'adopted') throw new Error(`expected adopted, got ${entry.outcome}`)
    expect(entry.profile.id).toBe('p1')
    expect(entry.profile.assignments).toEqual([])
    expect(entry.profile.cvars['sensitivity']).toBe('5')
    expect(entry.profile.name).toBe('Hand-Edited')
    expect(entry.profile.fileHash).toBe(newHash)

    // The store itself was updated, not just the response.
    const stored = configState(state).profiles.get()[0]!
    expect(stored.id).toBe('p1')
    expect(stored.assignments).toEqual([])
    expect(stored.cvars['sensitivity']).toBe('5')
    expect(stored.name).toBe('Hand-Edited')
    expect(stored.fileHash).toBe(newHash)
    expect(stored.dirty).toBe(false)
    expect(stored.fileState).toBe('unchanged')
  })

  it('reports a conflict and adopts nothing when the file changed on disk while the profile carries unsaved edits', async () => {
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    // An unsaved UI edit - marks the profile dirty without writing the file.
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '7' } })
    const before = configState(state).profiles.get()[0]!
    expect(before.dirty).toBe(true)

    const path = join(userDataBox.current, 'Profile.cfg')
    const onDisk = await readFile(path, 'latin1')
    const edited = onDisk.replace(/sensitivity(\s*)"3"/, 'sensitivity$1"9"')
    expect(edited).not.toBe(onDisk)
    await writeFile(path, edited, 'latin1')

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toHaveLength(1)
    const entry = result.value[0]!
    if (entry.outcome !== 'conflict') throw new Error(`expected conflict, got ${entry.outcome}`)
    expect(entry.conflict.status).toBe('conflict')
    expect(entry.conflict.fileName).toBe('Profile.cfg')
    expect(entry.conflict.diskContent).toBe(edited)
    expect(entry.conflict.ourContent).toBe(renderProfileFile(before))

    // Nothing about the cached profile was touched - byte-identical to before the call.
    expect(configState(state).profiles.get()[0]).toEqual(before)
  })

  it('story 043 D8: discardLocalEdits: true adopts the disk version even though the profile is dirty', async () => {
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    // An unsaved UI edit - marks the profile dirty without writing the file.
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '7' } })

    const path = join(userDataBox.current, 'Profile.cfg')
    const onDisk = await readFile(path, 'latin1')
    const edited = onDisk.replace(/sensitivity(\s*)"3"/, 'sensitivity$1"9"')
    expect(edited).not.toBe(onDisk)
    await writeFile(path, edited, 'latin1')
    const newHash = hashCanonicalFileContent(edited)

    const result = (await handlers.get(CONFIG_HANDLERS.refreshFromFiles)!({
      profileId: 'p1',
      discardLocalEdits: true,
    })) as Outcome<RefreshFromFilesResult>

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toHaveLength(1)
    const entry = result.value[0]!
    if (entry.outcome !== 'adopted') throw new Error(`expected adopted, got ${entry.outcome}`)
    // The disk version won, not the discarded unsaved edit (sensitivity 7).
    expect(entry.profile.cvars['sensitivity']).toBe('9')
    expect(entry.profile.fileHash).toBe(newHash)

    // The store itself reflects the discard: no longer dirty, disk content adopted.
    const stored = configState(state).profiles.get()[0]!
    expect(stored.dirty).toBe(false)
    expect(stored.cvars['sensitivity']).toBe('9')
    expect(stored.fileHash).toBe(newHash)
  })

  it('sets fileState: missing and never deletes the record when the file is gone', async () => {
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const before = configState(state).profiles.get()[0]!
    await rm(join(userDataBox.current, 'Profile.cfg'))

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toEqual([{ profileId: 'p1', outcome: 'missing', fileState: 'missing' }])

    const stored = configState(state).profiles.get()[0]!
    expect(stored.id).toBe('p1')
    expect(stored.fileState).toBe('missing')
    // Untouched: neither dirty nor the hash baseline are disturbed by a missing file.
    expect(stored.dirty).toBe(before.dirty)
    expect(stored.fileHash).toBe(before.fileHash)
    expect(stored.cvars).toEqual(before.cvars)
  })

  it('reports the unparseable diagnostic and leaves the cached profile fully usable', async () => {
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const before = configState(state).profiles.get()[0]!

    vi.mocked(readFileState).mockResolvedValueOnce({
      state: 'unparseable',
      file: 'Profile.cfg',
      line: 42,
      message: 'contrived parse failure for this test',
    })

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toEqual([
      {
        profileId: 'p1',
        outcome: 'unparseable',
        fileState: 'unparseable',
        file: 'Profile.cfg',
        line: 42,
        message: 'contrived parse failure for this test',
      },
    ])

    // The last good cache stays exactly as usable as it was: same content, still listed, still
    // renderable - only the display hint changed.
    const stored = configState(state).profiles.get()[0]!
    expect(stored.cvars).toEqual(before.cvars)
    expect(stored.dirty).toBe(before.dirty)
    expect(stored.fileHash).toBe(before.fileHash)
    expect(stored.fileState).toBe('unparseable')
    expect(() => renderProfileFile(stored)).not.toThrow()
    const list = unwrapOk<ConfigProfile[]>(await handlers.get(CONFIG_HANDLERS.list)!(undefined))
    expect(list.map((p) => p.id)).toEqual(['p1'])
  })

  it('reports readError conservatively, touching nothing about the cached profile but the hint', async () => {
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const before = configState(state).profiles.get()[0]!

    vi.mocked(readFileState).mockResolvedValueOnce({
      state: 'readError',
      error: new Error('EACCES (contrived for this test)'),
    })

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(result.value).toEqual([
      {
        profileId: 'p1',
        outcome: 'readError',
        fileState: 'readError',
        message: 'EACCES (contrived for this test)',
      },
    ])
    const stored = configState(state).profiles.get()[0]!
    expect(stored.cvars).toEqual(before.cvars)
    expect(stored.dirty).toBe(before.dirty)
    expect(stored.fileHash).toBe(before.fileHash)
    expect(stored.fileState).toBe('readError')
  })

  it('checks only the given profile when profileId is passed, and every profile when it is omitted', async () => {
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [
      profile({ id: 'p1', name: 'One', assignments: [] }),
      profile({ id: 'p2', name: 'Two', cvars: { sensitivity: '4' }, assignments: [] }),
    ])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p2' })

    const scoped = await refresh(handlers, 'p1')
    if (!scoped.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(scoped.value.map((r) => r.profileId)).toEqual(['p1'])

    const all = await refresh(handlers)
    if (!all.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(all.value.map((r) => r.profileId).sort()).toEqual(['p1', 'p2'])
    expect(all.value.every((r) => r.outcome === 'unchanged')).toBe(true)
  })

  it('fails with config.error.profileNotFound for an unknown profile id', async () => {
    const { handlers } = await boot()

    const result = await refresh(handlers, 'nope')

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
  })

  /**
   * Story 079 D3 (AC2): adopting an external edit is a content mutation like any other, so it now
   * cascades to every assigned installation - the copy lands byte-identical to the adopted file
   * (the hand-edit itself), never a re-render of it.
   */
  it('refreshFromFiles cascades the adopted file', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    seedConfigProfiles(state, [profile()])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const path = join(userDataBox.current, 'Profile.cfg')
    const onDisk = await readFile(path, 'latin1')
    const edited = onDisk.replace(/sensitivity(\s*)"3"/, 'sensitivity$1"5"')
    expect(edited).not.toBe(onDisk)
    await writeFile(path, edited, 'latin1')

    const result = await refresh(handlers, 'p1')

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    const entry = result.value[0]!
    if (entry.outcome !== 'adopted') throw new Error(`expected adopted, got ${entry.outcome}`)

    expect(await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(edited)
    // The canonical file itself was not re-written by the cascade - it still says exactly the
    // hand-edited bytes that were adopted.
    expect(await readFile(path, 'latin1')).toBe(edited)
  })

  /**
   * Story 079 D3 (AC2): the "take the file" conflict resolution (`discardLocalEdits: true`) adopts
   * the disk version exactly like the silent re-read above, and cascades it the same way.
   */
  it('taking the file in a conflict cascades it', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    seedConfigProfiles(state, [profile()])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    // An unsaved UI edit - marks the profile dirty without writing the file.
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '7' } })

    const path = join(userDataBox.current, 'Profile.cfg')
    const onDisk = await readFile(path, 'latin1')
    const edited = onDisk.replace(/sensitivity(\s*)"3"/, 'sensitivity$1"9"')
    expect(edited).not.toBe(onDisk)
    await writeFile(path, edited, 'latin1')

    const result = (await handlers.get(CONFIG_HANDLERS.refreshFromFiles)!({
      profileId: 'p1',
      discardLocalEdits: true,
    })) as Outcome<RefreshFromFilesResult>

    if (!result.ok) throw new Error('expected refreshFromFiles to succeed')
    const entry = result.value[0]!
    if (entry.outcome !== 'adopted') throw new Error(`expected adopted, got ${entry.outcome}`)

    expect(await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(edited)
    expect(await readFile(path, 'latin1')).toBe(edited)
  })
})
