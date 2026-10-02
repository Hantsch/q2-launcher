import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type ProfileSyncState,
  type RawFilesResult,
  type SaveProfileResult,
  type SaveRawTextResult,
  type WriteTargetResult,
} from '@shared/modules/config'
import { fail, type Installation, type LaunchState, type Outcome } from '@shared/types'
import { pathExists } from '../../lib/fs-utils'
import { type AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { type ModuleHandler } from '../types'
import { hashCanonicalFileContent } from './file-source'
import { renderProfileFile } from './render'
import { configModule } from './index'
import { ownedProfileIdFromContent, writeTargetFile } from './writer'
import { diffProfileAgainstBaseline } from '@shared/config/profile-diff'
import {
  collectHandlers,
  idleState,
  installation,
  log,
  profile,
  runningState,
  useConfigTestDir,
  userDataBox,
} from './index.test-helpers'

/**
 * Story 175 D1: `writeTargetFile` is wrapped the same way (delegating to the real writer by
 * default) so `commitCvars`' write-failure branch can be exercised with `mockRejectedValueOnce`.
 */
vi.mock('./writer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./writer')>()
  return { ...actual, writeTargetFile: vi.fn(actual.writeTargetFile) }
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
 * Story 043 D4: the deliberate inversion of story 022 decision 8 - content mutations stop writing
 * and only `save` does, after re-reading the file it is about to overwrite.
 *
 * The two failure modes this block exists to catch are the ones the story names: a hand-edit
 * clobbered by a write the launcher made without reading the file first, and unsaved edits leaking
 * onto disk (into an installation, which the engine actually loads) through some *other* handler's
 * sync run. Everything is asserted on the real temp-dir bytes, never on the handler's return value
 * alone - a report of a write that did not happen, or of a skip that actually wrote, would look
 * identical from the outside.
 */
describe('story 043 D4: explicit save', () => {
  async function boot(
    installations: Installation[] = [],
    seed?: (state: StateStore) => void,
    launchState: LaunchState = idleState(),
  ): Promise<{ handlers: Map<string, ModuleHandler>; state: StateStore }> {
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    seed?.(state)
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
        launch: { getState: () => launchState },
        state,
      } as unknown as AppContext,
      log,
    })
    return { handlers, state }
  }

  const canonicalPath = (fileName: string): string => join(userDataBox.current, fileName)
  const copyPath = (fileName: string): string => join(dir, 'baseq2', fileName)

  async function save(
    handlers: Map<string, ModuleHandler>,
    profileId = 'p1',
  ): Promise<Outcome<SaveProfileResult>> {
    return (await handlers.get(CONFIG_HANDLERS.save)!({ profileId })) as Outcome<SaveProfileResult>
  }

  function only(state: StateStore, profileId = 'p1'): ConfigProfile {
    return state.configProfiles().find((p) => p.id === profileId)!
  }

  it('writes the canonical file and the installation copy, clears dirty and seeds the hash baseline', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '7' } })

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to succeed')
    if (result.value.status !== 'saved')
      throw new Error(`expected saved, got ${result.value.status}`)
    const expected = renderProfileFile(result.value.profile)
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    // The installation cascade is unchanged by this deliverable - it still runs, from the same
    // canonical content (story AC6).
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(result.value.sync.own.status).toBe('inSync')

    const saved = only(state)
    expect(saved.dirty).toBe(false)
    // Seeded from exactly the bytes on disk, which is what keeps this write from being read back as
    // an external edit by the very next save.
    expect(saved.fileHash).toBe(hashCanonicalFileContent(expected))
    expect(saved.fileSeenAt).toBeTypeOf('number')

    // Proof of that property: an immediate second save sees `unchanged`, not a conflict.
    const again = await save(handlers)
    if (!again.ok) throw new Error('expected the second save to succeed')
    expect(again.value.status).toBe('saved')
  })

  it('a save while the game runs writes the copy and reads inSync, nothing is persisted as pending', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst], undefined, runningState(inst.id))
    state.setConfigProfiles([profile()])
    await state.settle()

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to succeed')
    if (result.value.status !== 'saved')
      throw new Error(`expected saved, got ${result.value.status}`)
    const expected = renderProfileFile(result.value.profile)
    // Story 079 D4: a running game defers nothing - the canonical file and the installation copy
    // are written exactly as they would be if the installation were idle.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(result.value.sync.own.status).toBe('inSync')
    expect(result.value.sync.installations).toEqual([
      {
        installationId: 'i1',
        path: copyPath('Profile.cfg'),
        fileName: 'Profile.cfg',
        status: 'inSync',
      },
    ])

    // Nothing is left behind to retry, and `writeState` (the pending-write report) is empty.
    const writeState = await handlers.get(CONFIG_HANDLERS.writeState)!(undefined)
    expect(writeState).toEqual({})
  })

  it('refuses to write and reports a whole-file conflict when the file changed underneath', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    const seededHash = only(state).fileHash

    // A hand-edit in Notepad: the launcher's own file, one line appended.
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '9' } })

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to answer, not fail')
    if (result.value.status !== 'conflict') {
      throw new Error(`expected conflict, got ${result.value.status}`)
    }
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(result.value.diskContent).toBe(handEdited)
    expect(result.value.ourContent).toBe(renderProfileFile(only(state)))
    expect(result.value.ourContent).not.toBe(handEdited)
    // The whole point: nothing was written, and the edits are still recorded as unsaved.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(only(state).dirty).toBe(true)
    expect(only(state).fileHash).toBe(seededHash)
  })

  it('story 043 D8: force: true bypasses the conflict, writes our version and clears dirty', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)

    // A hand-edit in Notepad, plus an unsaved UI edit - the exact conflict shape `save` (without
    // `force`) still refuses, and the shape `ConfigConflictDialog` is built from.
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '9' } })

    const ordinary = await save(handlers)
    if (!ordinary.ok || ordinary.value.status !== 'conflict') {
      throw new Error('expected the ordinary save to still refuse')
    }

    const forced = (await handlers.get(CONFIG_HANDLERS.save)!({
      profileId: 'p1',
      force: true,
    })) as Outcome<SaveProfileResult>

    if (!forced.ok) throw new Error('expected the forced save to succeed')
    if (forced.value.status !== 'saved') {
      throw new Error(`expected saved, got ${forced.value.status}`)
    }
    const expected = renderProfileFile(forced.value.profile)
    expect(expected).not.toBe(handEdited)
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(only(state).dirty).toBe(false)
    expect(only(state).fileHash).toBe(hashCanonicalFileContent(expected))
  })

  it('looks the file up by its ownership sentinel, so a rename cannot make a hand-edit invisible', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await save(handlers)

    // A rename no longer moves the file, so the profile's file still sits under its OLD name -
    // exactly where a naive "read the name this profile now resolves to" check would find nothing
    // and conclude it was free to write.
    await handlers.get(CONFIG_HANDLERS.rename)!({ id: 'p1', name: 'Renamed' })
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to answer, not fail')
    if (result.value.status !== 'conflict') {
      throw new Error(`expected conflict, got ${result.value.status}`)
    }
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(await pathExists(canonicalPath('Renamed.cfg'))).toBe(false)
  })

  it('saving a renamed profile with nothing changed on disk moves the file to its new name', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await save(handlers)
    await handlers.get(CONFIG_HANDLERS.rename)!({ id: 'p1', name: 'Renamed' })

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to succeed')
    if (result.value.status !== 'saved')
      throw new Error(`expected saved, got ${result.value.status}`)
    expect(await readFile(canonicalPath('Renamed.cfg'), 'latin1')).toBe(
      renderProfileFile(result.value.profile),
    )
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
    expect(only(state).dirty).toBe(false)
  })

  it('reports a file it cannot read at all instead of writing over it', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    // A directory where the canonical file should be: unreadable, and specifically NOT ENOENT - so
    // it must not be treated as "nothing there, free to create".
    await mkdir(canonicalPath('Profile.cfg'), { recursive: true })

    const result = await save(handlers)

    if (!result.ok) throw new Error('expected save to answer, not fail')
    expect(result.value.status).toBe('unreadable')
    if (result.value.status !== 'unreadable') return
    expect(result.value.reason).toBe('readError')
  })

  it('assign of a DIRTY profile writes the installation from the canonical FILE, never from the unsaved edits', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await save(handlers)
    const savedFile = await readFile(canonicalPath('Profile.cfg'), 'latin1')

    // Unsaved edit, then an operation that is NOT a save but does sync (assignment relationships
    // are not profile content, so it still syncs immediately - story decision).
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '99' } })
    const unsavedRender = renderProfileFile(only(state))
    expect(unsavedRender).not.toBe(savedFile)

    const assigned = (await handlers.get(CONFIG_HANDLERS.assign)!({
      profileId: 'p1',
      installationId: 'i1',
    })) as Outcome<ConfigProfile[]>
    if (!assigned.ok) throw new Error('expected assign to succeed')

    // The canonical file is untouched...
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    // ...and the installation - the copy the engine actually loads - got the FILE's content, not
    // the unsaved edit. This is the specific leak D4 exists to close.
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).not.toBe(unsavedRender)
    expect(only(state).dirty).toBe(true)
    // The loader still went out, so the installation is usable.
    expect(await pathExists(copyPath('autoexec.cfg'))).toBe(true)
  })

  it("the retry trigger `write` publishes the canonical file too, not a dirty profile's unsaved edits", async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    const savedFile = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '99' } })
    // Delete the installation copy so the retry has something real to do.
    await rm(copyPath('Profile.cfg'))

    const result = (await handlers.get(CONFIG_HANDLERS.write)!({
      profileId: 'p1',
    })) as Outcome<WriteTargetResult[]>

    if (!result.ok) throw new Error('expected write to succeed')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(only(state).dirty).toBe(true)
  })

  /**
   * Story 079 D8, AC7: `write`'s new optional `installationId` is "Sync now" - a one-click rewrite
   * of ONE installation's copy from the canonical file. `writer.ts#writeTargetFile`'s backup-once
   * contract (~:147-160) applies exactly as it would for any other write: a copy holding content the
   * launcher did not itself generate is the user's own file and is preserved once, forever, before
   * being overwritten - this test asserts that contract is actually reached through the targeted
   * path, not skipped as "already handled".
   */
  it('write with installationId backs up a foreign copy once, then overwrites', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    const canonical = await readFile(canonicalPath('Profile.cfg'), 'latin1')

    // A foreign, hand-written copy at the installation - not launcher output.
    const foreign = 'set sensitivity "42"\n'
    await writeFile(copyPath('Profile.cfg'), foreign, 'latin1')

    const result = (await handlers.get(CONFIG_HANDLERS.write)!({
      profileId: 'p1',
      installationId: 'i1',
    })) as Outcome<WriteTargetResult[]>

    if (!result.ok) throw new Error('expected write to succeed')
    expect(result.value).toEqual([{ installationId: 'i1', status: 'written' }])
    // Backed up once before being overwritten.
    expect(await readFile(`${copyPath('Profile.cfg')}.q2l-backup`, 'latin1')).toBe(foreign)
    // Overwritten with the canonical file's own bytes.
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(canonical)
    expect(state.configWriteFailures()).toEqual({})

    // "Once, forever": a later foreign edit does not clobber the first backup.
    const secondForeign = 'set sensitivity "99"\n'
    await writeFile(copyPath('Profile.cfg'), secondForeign, 'latin1')
    await handlers.get(CONFIG_HANDLERS.write)!({ profileId: 'p1', installationId: 'i1' })
    expect(await readFile(`${copyPath('Profile.cfg')}.q2l-backup`, 'latin1')).toBe(foreign)
  })

  /**
   * Story 079 D8, AC9: a targeted "Sync now" must never publish a `dirty` profile's unsaved edits -
   * it writes the canonical file's own bytes, exactly like the untargeted retry path already does
   * (the test right above this describe block), just restricted to one installation.
   */
  it("write with installationId on a dirty profile writes the canonical file's bytes, never the unsaved edits", async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    const savedFile = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '99' } })
    const unsavedRender = renderProfileFile(only(state))
    expect(unsavedRender).not.toBe(savedFile)
    // Delete the installation copy so the targeted write has something real to do.
    await rm(copyPath('Profile.cfg'))

    const result = (await handlers.get(CONFIG_HANDLERS.write)!({
      profileId: 'p1',
      installationId: 'i1',
    })) as Outcome<WriteTargetResult[]>

    if (!result.ok) throw new Error('expected write to succeed')
    expect(result.value).toEqual([{ installationId: 'i1', status: 'written' }])
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).not.toBe(unsavedRender)
    // Still dirty: this was a sync, not a save.
    expect(only(state).dirty).toBe(true)
  })

  it('write rejects an unknown installationId and writes nothing', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    const before = await readFile(copyPath('Profile.cfg'), 'latin1')

    const result = await handlers.get(CONFIG_HANDLERS.write)!({
      profileId: 'p1',
      installationId: 'nope',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationNotFound' } })
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(before)
    expect(only(state).dirty).toBe(false)
  })

  it("write with installationId touches only the named installation, not the profile's other assignments", async () => {
    const i1 = installation({ id: 'i1', rootPath: join(dir, 'i1') })
    const i2 = installation({ id: 'i2', rootPath: join(dir, 'i2') })
    await mkdir(join(i1.rootPath, 'baseq2'), { recursive: true })
    await mkdir(join(i2.rootPath, 'baseq2'), { recursive: true })
    const { handlers, state } = await boot([i1, i2])
    state.setConfigProfiles([
      profile({
        assignments: [
          { installationId: 'i1', isDefault: true },
          { installationId: 'i2', isDefault: true },
        ],
      }),
    ])
    await state.settle()
    await save(handlers)
    const canonical = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(await readFile(join(i1.rootPath, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(canonical)
    expect(await readFile(join(i2.rootPath, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(canonical)

    // Both copies go stale...
    await writeFile(join(i1.rootPath, 'baseq2', 'Profile.cfg'), 'stale i1\n', 'latin1')
    await writeFile(join(i2.rootPath, 'baseq2', 'Profile.cfg'), 'stale i2\n', 'latin1')

    // ...but a targeted write only fixes i1.
    const result = (await handlers.get(CONFIG_HANDLERS.write)!({
      profileId: 'p1',
      installationId: 'i1',
    })) as Outcome<WriteTargetResult[]>

    if (!result.ok) throw new Error('expected write to succeed')
    expect(result.value).toEqual([{ installationId: 'i1', status: 'written' }])
    expect(await readFile(join(i1.rootPath, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(canonical)
    expect(await readFile(join(i2.rootPath, 'baseq2', 'Profile.cfg'), 'latin1')).toBe('stale i2\n')
  })

  /**
   * Story 079 D8/D9 regression (found while diagnosing the `care-drift-sync-now` e2e flow failing
   * after `raw-save-cascades`): a raw save's cascade protects the canonical file from being
   * re-rendered for that ONE `syncAndPersist` call (`refuseCanonicalWriteFor: adopted.id`,
   * `saveRawText`), but that protection does not outlive the call. The very next sync trigger - here
   * "Sync now", `write` with `installationId` - runs its own `syncAndPersist` with none of those
   * options, and the general `canonicalWriteAllowed` rule ("the on-disk hash already equals the
   * cached `fileHash`, so this write is safe") wrongly treats a hand-typed, non-render-fixed-point
   * canonical file as safe to overwrite with `renderProfileFile(profile)` - silently corrupting the
   * user's typed formatting and, as a side effect, turning every OTHER installation's already-correct
   * copy into new drift. Story 079's Decisions are explicit that a raw save "keeps 057's semantics"
   * (never re-rendered) - this asserts that holds across a subsequent Sync now too, and that the
   * targeted installation ends up byte-identical to the (unchanged) canonical file, reading `inSync`.
   */
  it('write with installationId after a non-fixed-point raw save never re-renders the canonical file, and syncs the installation from its exact bytes', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)

    // A raw save (story 057) whose typed text is legal but deliberately NOT a render fixed point.
    const onDisk = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    const typed = `${onDisk}\tset q2l_hand "1"   \n`
    const rawResult = (await handlers.get(CONFIG_HANDLERS.saveRawText)!({
      profileId: 'p1',
      text: typed,
    })) as Outcome<SaveRawTextResult>
    if (!rawResult.ok || rawResult.value.status !== 'saved') {
      throw new Error('expected the raw save to succeed')
    }
    expect(only(state).dirty).toBe(false)
    expect(renderProfileFile(only(state))).not.toBe(typed)
    // The raw save's own cascade (D3) already published the typed bytes to the installation.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(typed)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(typed)

    // An outside tool hand-edits the installation's own copy, as `care-drift-sync-now.mjs` does.
    await writeFile(copyPath('Profile.cfg'), 'set sensitivity "42"\n', 'latin1')

    const result = (await handlers.get(CONFIG_HANDLERS.write)!({
      profileId: 'p1',
      installationId: 'i1',
    })) as Outcome<WriteTargetResult[]>

    if (!result.ok) throw new Error('expected write to succeed')
    expect(result.value).toEqual([{ installationId: 'i1', status: 'written' }])
    // The canonical file's typed bytes must not be re-rendered by a targeted Sync now.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(typed)
    // The installation copy is republished from those same typed bytes.
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(typed)

    const syncResult = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!syncResult.ok) throw new Error('expected syncState to succeed')
    expect(syncResult.value.installations[0]!.status).toBe('inSync')
  })

  it('is per profile: syncing a clean profile does not publish a DIRTY sibling assigned to the same installation', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([
      profile({ id: 'p1', name: 'One' }),
      profile({ id: 'p2', name: 'Two', assignments: [{ installationId: 'i1', isDefault: false }] }),
    ])
    await state.settle()
    await save(handlers, 'p1')
    await save(handlers, 'p2')
    const siblingFile = await readFile(canonicalPath('Two.cfg'), 'latin1')

    // The sibling has unsaved edits; the OTHER profile is the one being synced.
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p2', cvars: { sensitivity: '99' } })
    const siblingUnsaved = renderProfileFile(state.configProfiles().find((p) => p.id === 'p2')!)
    await handlers.get(CONFIG_HANDLERS.setDefault)!({ profileId: 'p1', installationId: 'i1' })

    // `syncOneProfile` writes EVERY profile assigned to the installation, so the sibling's copy was
    // rewritten by this run - from its canonical file, not from its unsaved state.
    expect(await readFile(canonicalPath('Two.cfg'), 'latin1')).toBe(siblingFile)
    expect(await readFile(copyPath('Two.cfg'), 'latin1')).toBe(siblingFile)
    expect(await readFile(copyPath('Two.cfg'), 'latin1')).not.toBe(siblingUnsaved)
    expect(state.configProfiles().find((p) => p.id === 'p2')!.dirty).toBe(true)
  })

  it('assign still syncs a NON-dirty profile immediately, exactly as before', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await save(handlers)

    const assigned = (await handlers.get(CONFIG_HANDLERS.assign)!({
      profileId: 'p1',
      installationId: 'i1',
    })) as Outcome<ConfigProfile[]>

    if (!assigned.ok) throw new Error('expected assign to succeed')
    const expected = renderProfileFile(only(state))
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(only(state).dirty).toBe(false)
  })

  it("syncState and rawFiles judge a dirty profile's installation copy against the FILE, so a retry can still clear it", async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '99' } })

    // The unsaved edits live on the canonical row (the file does not say what the profile says)...
    const dirtyState = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!dirtyState.ok) throw new Error('expected syncState to succeed')
    expect(dirtyState.value.own.status).toBe('outOfSync')
    // ...while the installation copy holds exactly what the canonical file authorises, and says so -
    // the same answer the sync run that wrote it gave, and a state a Retry can actually reach.
    expect(dirtyState.value.installations[0]!.status).toBe('inSync')

    const raw = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!raw.ok) throw new Error('expected rawFiles to succeed')
    expect(raw.value.installations[0]!.matches).toBe(true)

    // A hand-edited installation copy is still reported out of sync, exactly as before.
    await writeFile(copyPath('Profile.cfg'), 'hand-edited\n', 'latin1')
    const edited = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!edited.ok) throw new Error('expected syncState to succeed')
    expect(edited.value.installations[0]!.status).toBe('outOfSync')

    // ...and the retry trigger fixes it without publishing the unsaved edits.
    await handlers.get(CONFIG_HANDLERS.write)!({ profileId: 'p1' })
    const retried = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!retried.ok) throw new Error('expected syncState to succeed')
    expect(retried.value.installations[0]!.status).toBe('inSync')
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(
      await readFile(canonicalPath('Profile.cfg'), 'latin1'),
    )
  })

  it('syncState and rawFiles judge a CLEAN profile’s installation copy against the canonical file’s bytes, never its render (story 079 D2)', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    // A raw save (story 057): the canonical file now holds exactly the typed text - clean profile,
    // hash baseline = these bytes - and that text is deliberately not a render fixed point.
    const typed = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}\tset q2l_hand "1"   \n`
    const raw = (await handlers.get(CONFIG_HANDLERS.saveRawText)!({
      profileId: 'p1',
      text: typed,
    })) as Outcome<SaveRawTextResult>
    if (!raw.ok || raw.value.status !== 'saved') throw new Error('expected the raw save to land')
    expect(only(state).dirty).toBe(false)
    expect(renderProfileFile(only(state))).not.toBe(typed)

    // A copy holding the typed bytes is in sync...
    await writeFile(copyPath('Profile.cfg'), typed, 'latin1')
    const mirrored = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!mirrored.ok) throw new Error('expected syncState to succeed')
    expect(mirrored.value.installations[0]!.status).toBe('inSync')
    const rawFiles = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!rawFiles.ok) throw new Error('expected rawFiles to succeed')
    expect(rawFiles.value.installations[0]!.matches).toBe(true)

    // ...and one holding the render - bytes nobody wrote to the canonical file - is not.
    await writeFile(copyPath('Profile.cfg'), renderProfileFile(only(state)), 'latin1')
    const rendered = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!rendered.ok) throw new Error('expected syncState to succeed')
    expect(rendered.value.installations[0]!.status).toBe('outOfSync')
  })

  it('a canonical file that moved underneath the launcher is neither published nor judged from (story 079 D2)', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    const savedFile = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    // An external edit the launcher has not read: hash ≠ `fileHash`, not our render either.
    const external = `${savedFile}set external_edit "1"\n`
    await writeFile(canonicalPath('Profile.cfg'), external, 'latin1')

    // Judged: the copy still equals the render, and still reads `outOfSync` - there is nothing it
    // is in sync with until the file is reloaded or overwritten by an explicit save.
    const judged = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!judged.ok) throw new Error('expected syncState to succeed')
    expect(judged.value.own.status).toBe('outOfSync')
    expect(judged.value.installations[0]!.status).toBe('outOfSync')
    const rawFiles = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!rawFiles.ok) throw new Error('expected rawFiles to succeed')
    expect(rawFiles.value.installations[0]!.matches).toBe(false)

    // Published: a non-save sync trigger writes neither the canonical file (043 D10) nor the copy
    // (079 D2) - the unread bytes stay where they are, and so does the copy.
    const written = (await handlers.get(CONFIG_HANDLERS.write)!({
      profileId: 'p1',
    })) as Outcome<WriteTargetResult[]>
    if (!written.ok) throw new Error('expected write to answer')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(external)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(only(state).dirty).toBe(false)
    expect(state.configWriteFailures()).toEqual({})
  })

  it('save fails with profileNotFound for an unknown id and writes nothing', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()

    const result = await save(handlers, 'nope')

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
  })
})

describe('story 175: commitCvars', () => {
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

  const canonicalPath = (fileName: string): string => join(userDataBox.current, fileName)
  const copyPath = (fileName: string): string => join(dir, 'baseq2', fileName)
  const ADDRESS = '203.0.113.7:27910'

  async function save(handlers: Map<string, ModuleHandler>): Promise<Outcome<SaveProfileResult>> {
    return (await handlers.get(CONFIG_HANDLERS.save)!({
      profileId: 'p1',
    })) as Outcome<SaveProfileResult>
  }

  async function commit(
    handlers: Map<string, ModuleHandler>,
    cvars: Record<string, string> = { adr0: ADDRESS },
  ): Promise<Outcome<ConfigProfile>> {
    return (await handlers.get(CONFIG_HANDLERS.commitCvars)!({
      profileId: 'p1',
      cvars,
    })) as Outcome<ConfigProfile>
  }

  function only(state: StateStore): ConfigProfile {
    return state.configProfiles().find((p) => p.id === 'p1')!
  }

  it('a clean profile gets the cvar on disk and in its installation copy and stays clean', async () => {
    const { handlers, state } = await boot([installation()])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)

    const result = await commit(handlers)

    if (!result.ok) throw new Error(`expected the commit to succeed, got ${result.error}`)
    expect(result.value.cvars.adr0).toBe(ADDRESS)
    const onDisk = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(onDisk).toContain('adr0')
    expect(onDisk).toContain(ADDRESS)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(onDisk)

    const committed = only(state)
    expect(committed.dirty).not.toBe(true)
    expect(committed.cvars.adr0).toBe(ADDRESS)
    expect(diffProfileAgainstBaseline(committed).count).toBe(0)
    // The launcher's own commit is not later mistaken for an external edit: a save goes through.
    const again = await save(handlers)
    if (!again.ok) throw new Error('expected the follow-up save to answer')
    expect(again.value.status).toBe('saved')
  })

  it('a dirty profile writes only the committed cvar: pending cvar and bind edits stay off disk and stay unsaved', async () => {
    const { handlers, state } = await boot([installation()])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    await handlers.get(CONFIG_HANDLERS.setCvars)!({
      profileId: 'p1',
      cvars: { sensitivity: '9.25' },
    })
    await handlers.get(CONFIG_HANDLERS.setBinds)!({
      profileId: 'p1',
      binds: { F5: 'say pendingbind' },
    })

    const result = await commit(handlers)

    if (!result.ok) throw new Error(`expected the commit to succeed, got ${result.error}`)
    for (const path of [canonicalPath('Profile.cfg'), copyPath('Profile.cfg')]) {
      const bytes = await readFile(path, 'latin1')
      expect(bytes).toContain('adr0')
      expect(bytes).toContain(ADDRESS)
      expect(bytes).not.toContain('9.25')
      expect(bytes).not.toContain('pendingbind')
    }

    const after = only(state)
    expect(after.dirty).toBe(true)
    expect(after.cvars.sensitivity).toBe('9.25')
    expect(after.binds.F5).toBe('say pendingbind')
    const diff = diffProfileAgainstBaseline(after)
    expect(diff.count).toBe(2)
    expect(diff.keys.cvars.has('sensitivity')).toBe(true)
    expect(diff.keys.cvars.has('adr0')).toBe(false)
    expect(diff.keys.binds.size).toBe(1)
  })

  it('a canonical file changed on disk is not overwritten and nothing changes', async () => {
    const { handlers, state } = await boot([installation()])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}// hand-edited\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')
    const before = only(state)

    const result = await commit(handlers)

    expect(result).toEqual(fail('config.error.commitConflict'))
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).not.toContain(ADDRESS)
    expect(only(state)).toEqual(before)
  })

  it('a write failure leaves the file and the profile record untouched', async () => {
    const { handlers, state } = await boot([installation()])
    state.setConfigProfiles([profile()])
    await state.settle()
    await save(handlers)
    const fileBefore = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    const before = only(state)
    vi.mocked(writeTargetFile).mockRejectedValueOnce(new Error('disk full'))

    const result = await commit(handlers)

    expect(result).toEqual(fail('config.error.writeFailed'))
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(fileBefore)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(fileBefore)
    expect(only(state)).toEqual(before)
  })

  it('a clean profile without a baseline commits against its live fields and stays clean', async () => {
    const { handlers, state } = await boot([installation()])
    state.setConfigProfiles([profile()])
    await state.settle()
    expect(only(state).baseline).toBeUndefined()

    const result = await commit(handlers)

    if (!result.ok) throw new Error(`expected the commit to succeed, got ${result.error}`)
    const onDisk = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(onDisk).toContain(ADDRESS)
    expect(onDisk).toContain('sensitivity')
    const committed = only(state)
    expect(committed.dirty).not.toBe(true)
    expect(committed.baseline?.cvars.adr0).toBe(ADDRESS)
    expect(committed.baseline?.cvars.sensitivity).toBe('3')
    expect(diffProfileAgainstBaseline(committed).count).toBe(0)
    // The file is exactly the live render: a plain save rewrites the same bytes.
    const again = await save(handlers)
    if (!again.ok) throw new Error('expected the follow-up save to answer')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(onDisk)
  })

  it('a dirty profile without a baseline is refused', async () => {
    const { handlers, state } = await boot([installation()])
    state.setConfigProfiles([profile({ dirty: true })])
    await state.settle()
    const before = only(state)

    const result = await commit(handlers)

    expect(result).toEqual(fail('config.error.commitNeedsSave'))
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
    expect(only(state)).toEqual(before)
  })

  it('a dirty rename writes to the file the profile still owns, not to a new name', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await save(handlers)
    await handlers.get(CONFIG_HANDLERS.rename)!({ id: 'p1', name: 'Renamed' })

    const result = await commit(handlers)

    if (!result.ok) throw new Error(`expected the commit to succeed, got ${result.error}`)
    const owned = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(ownedProfileIdFromContent(owned)).toBe('p1')
    expect(owned).toContain(ADDRESS)
    // The pending rename is not in the file either - it is still the user's to save.
    expect(owned).not.toContain('Renamed')
    expect(await pathExists(canonicalPath('Renamed.cfg'))).toBe(false)
    expect(only(state).dirty).toBe(true)
    expect(only(state).name).toBe('Renamed')
  })
})
