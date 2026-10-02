import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type RawFilesResult,
  type RefreshFromFilesResult,
  type SaveRawTextResult,
} from '@shared/modules/config'
import { type Installation, type Outcome } from '@shared/types'
import { pathExists } from '../../lib/fs-utils'
import { type AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { type ModuleHandler } from '../types'
import { hashCanonicalFileContent, readFileState } from './file-source'
import { renderProfileFile, sentinelLine } from './render'
import { MAX_RAW_CONFIG_TEXT_LENGTH } from './schemas'
import { configModule } from './index'
import {
  collectHandlers,
  idleState,
  installation,
  log,
  profile,
  shellMock,
  useConfigTestDir,
  userDataBox,
} from './index.test-helpers'

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
 * Story 023 D1: `rawFiles`' read-only report of the profile's own canonical
 * file plus one entry per assigned installation. Same boot pattern as the
 * story 022 D7 block above (own local helper, since that one is private to
 * its own `describe`) - a duck-typed `app` with a real, temp-file-backed
 * `StateStore`, so mutations actually land on disk and `rawFiles` has
 * something real to read back.
 */
describe('CONFIG_HANDLERS.rawFiles handler (story 023 D1)', () => {
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

  it('reports canonical onDisk: false for a freshly created, unassigned profile, then true after an explicit save', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()

    const before = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!before.ok) throw new Error('expected rawFiles to succeed')
    expect(before.value.canonical.onDisk).toBe(false)
    expect(before.value.canonical.content).toBe('')
    expect(before.value.installations).toEqual([])

    await handlers.get(CONFIG_HANDLERS.setCvars)!({
      profileId: 'p1',
      cvars: { sensitivity: '9' },
    })
    // Story 043 D4: only a save puts the file on disk now.
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })

    const after = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!after.ok) throw new Error('expected rawFiles to succeed')
    expect(after.value.canonical.onDisk).toBe(true)
    const updated = (await handlers.get(CONFIG_HANDLERS.list)!(undefined)) as ConfigProfile[]
    expect(after.value.canonical.content).toBe(
      renderProfileFile(updated.find((p) => p.id === 'p1')!),
    )
  })

  it('reports matches: true right after a save, and false once the on-disk copy is edited independently', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '9' } })
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })

    const inSync = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!inSync.ok) throw new Error('expected rawFiles to succeed')
    expect(inSync.value.installations).toEqual([
      {
        installationId: inst.id,
        path: join(dir, 'baseq2', 'Profile.cfg'),
        onDisk: true,
        matches: true,
        playedMods: [],
      },
    ])

    await writeFile(join(dir, 'baseq2', 'Profile.cfg'), 'hand-edited\n', 'latin1')

    const outOfSync = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>
    if (!outOfSync.ok) throw new Error('expected rawFiles to succeed')
    expect(outOfSync.value.installations[0]!.onDisk).toBe(true)
    expect(outOfSync.value.installations[0]!.matches).toBe(false)
  })

  it('reports one entry per assignment', async () => {
    const inst1 = installation({ id: 'i1' })
    const inst2 = installation({ id: 'i2', rootPath: join(dir, 'inst2') })
    await mkdir(join(inst2.rootPath, 'baseq2'), { recursive: true })
    const { handlers, state } = await boot([inst1, inst2])
    state.setConfigProfiles([
      profile({
        assignments: [
          { installationId: 'i1', isDefault: true },
          { installationId: 'i2', isDefault: true },
        ],
      }),
    ])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '9' } })

    const result = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>

    if (!result.ok) throw new Error('expected rawFiles to succeed')
    expect(result.value.installations.map((i) => i.installationId).sort()).toEqual(['i1', 'i2'])
  })

  it('echoes playedMods from app.state.configPlayedMods() for each installation entry', async () => {
    const inst = installation({ gameDirs: ['baseq2', 'ctf'] })
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    state.setConfigPlayedMods({ i1: ['ctf'] })
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '9' } })

    const result = (await handlers.get(CONFIG_HANDLERS.rawFiles)!({
      profileId: 'p1',
    })) as Outcome<RawFilesResult>

    if (!result.ok) throw new Error('expected rawFiles to succeed')
    expect(result.value.installations).toEqual([
      expect.objectContaining({ installationId: 'i1', playedMods: ['ctf'] }),
    ])
  })

  it('fails with config.error.profileNotFound for an unknown profile id', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([])
    await state.settle()

    const result = await handlers.get(CONFIG_HANDLERS.rawFiles)!({ profileId: 'nope' })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
  })
})

/**
 * Story 023 D2: `openFile`, the module's one privileged path. Every assertion
 * below is about the same thing - that `shell` is only ever reached for a file
 * main itself resolved from ids AND verified to be this profile's own `.cfg`
 * (AC 8). Same boot pattern as the `rawFiles` block above: a duck-typed `app`
 * over a real, temp-file-backed `StateStore`, so a mutation really does put the
 * file on disk and the checks have something real to look at.
 */
describe('CONFIG_HANDLERS.openFile handler (story 023 D2)', () => {
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

  /**
   * Boots, seeds one profile and saves it, so its files are really on disk. Story 043 D4: it is the
   * save that writes now, not the `setCvars` that used to stand in for one here.
   */
  async function bootSynced(
    installations: Installation[] = [],
    seeded: ConfigProfile = profile({ assignments: [] }),
  ): Promise<Map<string, ModuleHandler>> {
    const { handlers, state } = await boot(installations)
    state.setConfigProfiles([seeded])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({
      profileId: seeded.id,
      cvars: { sensitivity: '9' },
    })
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: seeded.id })
    return handlers
  }

  it("opens the profile's own canonical file with the path main resolved itself", async () => {
    const handlers = await bootSynced()

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: null,
      mode: 'open',
    })

    expect(result).toEqual({ ok: true, value: null })
    expect(shellMock.openPath).toHaveBeenCalledTimes(1)
    expect(shellMock.openPath).toHaveBeenCalledWith(join(userDataBox.current, 'Profile.cfg'))
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it("reveals an assigned installation's copy, and reveal never opens", async () => {
    const inst = installation()
    const handlers = await bootSynced([inst], profile())

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: 'i1',
      mode: 'reveal',
    })

    expect(result).toEqual({ ok: true, value: null })
    expect(shellMock.showItemInFolder).toHaveBeenCalledTimes(1)
    expect(shellMock.showItemInFolder).toHaveBeenCalledWith(join(dir, 'baseq2', 'Profile.cfg'))
    expect(shellMock.openPath).not.toHaveBeenCalled()
  })

  it('surfaces a non-empty shell.openPath error as config.error.openFailed', async () => {
    const handlers = await bootSynced()
    shellMock.openPath.mockResolvedValueOnce('no application is associated with .cfg')

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: null,
      mode: 'open',
    })

    expect(result).toEqual({
      ok: false,
      error: {
        key: 'config.error.openFailed',
        params: { message: 'no application is associated with .cfg' },
      },
    })
  })

  it('refuses an unknown profile id without touching shell', async () => {
    const handlers = await bootSynced()

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'nope',
      installationId: null,
      mode: 'open',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
    expect(shellMock.openPath).not.toHaveBeenCalled()
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('refuses an unknown installation id without touching shell', async () => {
    const handlers = await bootSynced([installation()], profile())

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: 'ghost',
      mode: 'open',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationNotFound' } })
    expect(shellMock.openPath).not.toHaveBeenCalled()
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('refuses an installation that exists but is not assigned to this profile', async () => {
    // i2 is a real, registered installation with a real synced file of its own -
    // it is simply not one of p1's targets, which is what must be refused here.
    const inst2 = installation({ id: 'i2', rootPath: join(dir, 'inst2') })
    await mkdir(join(inst2.rootPath, 'baseq2'), { recursive: true })
    const handlers = await bootSynced([installation(), inst2], profile())

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: 'i2',
      mode: 'reveal',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationNotFound' } })
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('refuses a file that is not on disk without touching shell', async () => {
    // No sync ran, so the canonical file was never written - AC 5's "the file is
    // not on disk" half, surfaced as the reason the UI disables the action with.
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    expect(await pathExists(join(userDataBox.current, 'Profile.cfg'))).toBe(false)

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: null,
      mode: 'open',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.fileNotFound' } })
    expect(shellMock.openPath).not.toHaveBeenCalled()
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('opens a canonical file still in the legacy sentinel shape too (story 051 D3)', async () => {
    // A file synced by a pre-051 launcher build never gets rewritten just by
    // being read - the open-in-editor guard must still recognise it as p1's
    // own file via the legacy sentinel, not only the new banner shape.
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await mkdir(userDataBox.current, { recursive: true })
    await writeFile(
      join(userDataBox.current, 'Profile.cfg'),
      `${sentinelLine('p1')}\nset sensitivity "3"\n`,
      'latin1',
    )

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: null,
      mode: 'open',
    })

    expect(result).toEqual({ ok: true, value: null })
    expect(shellMock.openPath).toHaveBeenCalledWith(join(userDataBox.current, 'Profile.cfg'))
  })

  it("refuses a foreign file sitting at the resolved path - not this profile's own file", async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    // Exists, is a `.cfg`, sits exactly where this profile's canonical file
    // would - and is somebody else's. The sentinel is what tells them apart.
    await mkdir(userDataBox.current, { recursive: true })
    await writeFile(
      join(userDataBox.current, 'Profile.cfg'),
      'seta sensitivity "1"\n// hand-written\n',
      'latin1',
    )

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: null,
      mode: 'open',
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.fileNotFound' } })
    expect(shellMock.openPath).not.toHaveBeenCalled()
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('refuses a malformed payload (a path where an id belongs) without touching shell', async () => {
    const handlers = await bootSynced()

    const result = await handlers.get(CONFIG_HANDLERS.openFile)!({
      profileId: 'p1',
      installationId: 'C:\\Windows\\System32\\calc.exe',
      mode: 'launch',
    })

    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    expect(shellMock.openPath).not.toHaveBeenCalled()
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })
})

/**
 * Story 057 D4: `saveRawText` - the Raw file tab's editor writing the user's own text onto the
 * canonical file.
 *
 * Every test here starts from a real `save`, so the text being edited is the file the launcher
 * itself wrote (which is the only state the editor is offered in) and the ownership header under
 * test is the real one, never a hand-built fixture that could drift from what `render.ts` emits.
 */
describe('CONFIG_HANDLERS.saveRawText handler (story 057 D4)', () => {
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

  const canonicalPath = (fileName = 'Profile.cfg'): string => join(userDataBox.current, fileName)

  async function saveRaw(
    handlers: Map<string, ModuleHandler>,
    text: string,
    options: { profileId?: string; force?: boolean } = {},
  ): Promise<Outcome<SaveRawTextResult>> {
    return (await handlers.get(CONFIG_HANDLERS.saveRawText)!({
      profileId: options.profileId ?? 'p1',
      text,
      ...(options.force === undefined ? {} : { force: options.force }),
    })) as Outcome<SaveRawTextResult>
  }

  /** A saved profile plus the exact bytes its canonical file holds - the editor's starting point. */
  async function seeded(handlers: Map<string, ModuleHandler>, state: StateStore): Promise<string> {
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    return readFile(canonicalPath(), 'latin1')
  }

  function only(state: StateStore, profileId = 'p1'): ConfigProfile {
    return state.configProfiles().find((p) => p.id === profileId)!
  }

  it('writes exactly the given bytes, latin-1, with no reformatting of any kind', async () => {
    const { handlers, state } = await boot()
    const onDisk = await seeded(handlers, state)

    // Deliberately awkward but entirely legal latin-1 text: high bytes (é, ÿ, °), a tab, a CRLF
    // line, trailing whitespace, a blank line and NO trailing newline at the end. A writer that
    // re-rendered, trimmed or re-encoded anything would change at least one of these bytes.
    const raw =
      `${onDisk}` +
      '// café ÿ ° sensitivity notes\r\n' +
      '\tset q2l_raw_test "1"   \n' +
      '\n' +
      'set no_trailing_newline "2"'

    const result = await saveRaw(handlers, raw)

    if (!result.ok) throw new Error(`expected a raw save, got ${JSON.stringify(result.error)}`)
    if (result.value.status !== 'saved') {
      throw new Error(`expected saved, got ${result.value.status}`)
    }
    // Byte-for-byte off the disk, not through a latin1 decode that could hide a re-encoding.
    expect(await readFile(canonicalPath())).toEqual(Buffer.from(raw, 'latin1'))
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(result.value.path).toBe(canonicalPath())

    // The read-back landed in the profile, and the file-state record was reseeded from the bytes
    // actually written.
    const saved = only(state)
    expect(saved.cvars.q2l_raw_test).toBe('1')
    expect(saved.dirty).toBe(false)
    expect(saved.fileHash).toBe(hashCanonicalFileContent(raw))
    expect(saved.fileState).toBe('unchanged')
    expect(result.value.profile.fileHash).toBe(hashCanonicalFileContent(raw))
  })

  it("reports the lines it could not read back, and never the file's own comment lines", async () => {
    const { handlers, state } = await boot()
    const onDisk = await seeded(handlers, state)

    // A clean launcher-written file first: its banners and header prose are comments the writer
    // regenerates, so an honest "preserved" report is empty for it.
    const clean = await saveRaw(handlers, onDisk)
    if (!clean.ok || clean.value.status !== 'saved') throw new Error('expected the first save')
    expect(clean.value.preservedLines).toEqual([])
    expect(clean.value.droppedAliases).toEqual([])

    const raw = `${onDisk}wave hi\n// just a note\n`
    const result = await saveRaw(handlers, raw)

    if (!result.ok || result.value.status !== 'saved') throw new Error('expected a raw save')
    // `onDisk` ends in a newline, so its `split` produces one trailing empty element - which is
    // exactly the 1-based line number the appended `wave hi` lands on.
    expect(result.value.preservedLines).toEqual([
      { file: 'Profile.cfg', line: onDisk.split('\n').length, text: 'wave hi' },
    ])
    // ...and the line is still in the file, which is the source of truth.
    expect(await readFile(canonicalPath(), 'latin1')).toBe(raw)
  })

  it('reports an alias the text defines twice, whose earlier body the read-back lost', async () => {
    const { handlers, state } = await boot()
    const onDisk = await seeded(handlers, state)

    const raw = `${onDisk}alias q2l_dup "say one"\nalias q2l_dup "say two"\n`
    const result = await saveRaw(handlers, raw)

    if (!result.ok || result.value.status !== 'saved') throw new Error('expected a raw save')
    expect(result.value.droppedAliases).toEqual(['q2l_dup'])
    // The write itself is untouched by the warning - the file still says both lines.
    expect(await readFile(canonicalPath(), 'latin1')).toBe(raw)
  })

  it('refuses and reports a whole-file conflict when the file changed underneath', async () => {
    const { handlers, state } = await boot()
    const onDisk = await seeded(handlers, state)
    const seededHash = only(state).fileHash

    const handEdited = `${onDisk}// hand-edited elsewhere\n`
    await writeFile(canonicalPath(), handEdited, 'latin1')
    const raw = `${onDisk}set typed_in_the_editor "1"\n`

    const result = await saveRaw(handlers, raw)

    if (!result.ok) throw new Error('expected saveRawText to answer, not fail')
    if (result.value.status !== 'conflict') {
      throw new Error(`expected conflict, got ${result.value.status}`)
    }
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(result.value.diskContent).toBe(handEdited)
    // `ourContent` is what THIS save would have written: the typed text, not a render.
    expect(result.value.ourContent).toBe(raw)
    // Nothing written, nothing adopted, the baseline untouched.
    expect(await readFile(canonicalPath(), 'latin1')).toBe(handEdited)
    expect(only(state).fileHash).toBe(seededHash)
    expect(only(state).cvars.typed_in_the_editor).toBeUndefined()
  })

  it('force: true overwrites the conflicting file with the typed text', async () => {
    const { handlers, state } = await boot()
    const onDisk = await seeded(handlers, state)

    await writeFile(canonicalPath(), `${onDisk}// hand-edited elsewhere\n`, 'latin1')
    const raw = `${onDisk}set typed_in_the_editor "1"\n`

    const refused = await saveRaw(handlers, raw)
    if (!refused.ok || refused.value.status !== 'conflict') {
      throw new Error('expected the ordinary raw save to still refuse')
    }

    const forced = await saveRaw(handlers, raw, { force: true })

    if (!forced.ok) throw new Error('expected the forced raw save to answer')
    if (forced.value.status !== 'saved') {
      throw new Error(`expected saved, got ${forced.value.status}`)
    }
    expect(await readFile(canonicalPath(), 'latin1')).toBe(raw)
    expect(only(state).cvars.typed_in_the_editor).toBe('1')
    expect(only(state).fileHash).toBe(hashCanonicalFileContent(raw))
  })

  it("rejects text that no longer carries the profile's ownership tag, and writes nothing", async () => {
    const { handlers, state } = await boot()
    const onDisk = await seeded(handlers, state)
    const before = only(state)

    // The header block deleted - what "select all, paste someone else's config" produces.
    const disowned = 'set sensitivity "5"\nbind w "+forward"\n'
    expect(disowned.includes(sentinelLine('p1'))).toBe(false)

    const result = await saveRaw(handlers, disowned)

    expect(result).toEqual({ ok: false, error: { key: 'config.error.rawTextNotOwned' } })
    expect(await readFile(canonicalPath(), 'latin1')).toBe(onDisk)
    expect(only(state)).toEqual(before)
  })

  it("rejects text carrying the OTHER profile's ownership tag", async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([
      profile({ id: 'p1', name: 'Profile', assignments: [] }),
      profile({ id: 'p2', name: 'Second', assignments: [] }),
    ])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p2' })
    const ownFile = await readFile(canonicalPath(), 'latin1')
    const otherFile = await readFile(canonicalPath('Second.cfg'), 'latin1')

    // Launcher-owned text, but for the wrong profile: pasting p2's file into p1's editor would
    // leave two files claiming the same id and one profile with no file of its own.
    const result = await saveRaw(handlers, otherFile)

    expect(result).toEqual({ ok: false, error: { key: 'config.error.rawTextNotOwned' } })
    expect(await readFile(canonicalPath(), 'latin1')).toBe(ownFile)
    expect(await readFile(canonicalPath('Second.cfg'), 'latin1')).toBe(otherFile)
  })

  it('rejects text with a character outside latin-1, and writes nothing', async () => {
    const { handlers, state } = await boot()
    const onDisk = await seeded(handlers, state)

    // A checkmark and a CJK character - both perfectly typeable, neither representable in a byte.
    const result = await saveRaw(handlers, `${onDisk}// ✓ 你好\n`)

    expect(result).toEqual({ ok: false, error: { key: 'config.error.rawTextNotLatin1' } })
    expect(await readFile(canonicalPath(), 'latin1')).toBe(onDisk)
  })

  it('rejects text with a control byte no config file can hold, and writes nothing', async () => {
    const { handlers, state } = await boot()
    const onDisk = await seeded(handlers, state)

    // A NUL pasted out of a binary file: latin-1 by code point, but exactly what `readFileState`
    // calls `unparseable` - writing it would leave the profile's own file unreadable.
    const result = await saveRaw(handlers, `${onDisk}set nul "\u0000"\n`)

    expect(result).toEqual({ ok: false, error: { key: 'config.error.rawTextNotLatin1' } })
    expect(await readFile(canonicalPath(), 'latin1')).toBe(onDisk)
  })

  it('leaves no phantom external edit behind: the next guard run sees an unchanged file', async () => {
    const { handlers, state } = await boot()
    const onDisk = await seeded(handlers, state)
    const raw = `${onDisk}set guard_check "1"\r\n`

    const first = await saveRaw(handlers, raw)
    if (!first.ok || first.value.status !== 'saved') throw new Error('expected the raw save')

    // 1. The guard every other operation uses, run directly against the stored baseline.
    const guard = await readFileState(userDataBox.current, 'Profile.cfg', only(state).fileHash)
    expect(guard.state).toBe('unchanged')

    // 2. The refresh handler (window focus / tab open) - the one that would say "changed outside
    //    the launcher" to the user.
    const refreshed = (await handlers.get(CONFIG_HANDLERS.refreshFromFiles)!({
      profileId: 'p1',
    })) as Outcome<RefreshFromFilesResult>
    if (!refreshed.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(refreshed.value).toEqual([
      { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
    ])

    // 3. A second raw save of the same text: no conflict, and still byte-identical afterwards.
    const second = await saveRaw(handlers, raw)
    if (!second.ok) throw new Error('expected the second raw save to answer')
    expect(second.value.status).toBe('saved')
    expect(await readFile(canonicalPath())).toEqual(Buffer.from(raw, 'latin1'))
  })

  it('writes the file the ownership stamp actually sits in, without renaming it', async () => {
    const { handlers, state } = await boot()
    const onDisk = await seeded(handlers, state)
    // A rename only marks the profile dirty (story 043 D4), so the file still sits under its old
    // name - the editor is editing `Profile.cfg`, and that is where the text has to land.
    await handlers.get(CONFIG_HANDLERS.rename)!({ id: 'p1', name: 'Renamed' })
    const raw = `${onDisk}set after_rename "1"\n`

    const result = await saveRaw(handlers, raw)

    if (!result.ok || result.value.status !== 'saved') throw new Error('expected the raw save')
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(await readFile(canonicalPath(), 'latin1')).toBe(raw)
    expect(await pathExists(canonicalPath('Renamed.cfg'))).toBe(false)
    // The adopt takes the name from the file, so the unsaved rename does not survive - the file is
    // the source of truth, and it still says "Profile".
    expect(only(state).name).toBe('Profile')
    expect(only(state).dirty).toBe(false)
  })

  it('reports a file it cannot read at all instead of writing over it', async () => {
    const { handlers, state } = await boot()
    state.setConfigProfiles([profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const onDisk = await readFile(canonicalPath(), 'latin1')

    vi.mocked(readFileState).mockResolvedValueOnce({
      state: 'readError',
      error: new Error('EACCES (contrived for this test)'),
    })

    const result = await saveRaw(handlers, `${onDisk}set unread "1"\n`)

    if (!result.ok) throw new Error('expected saveRawText to answer, not fail')
    if (result.value.status !== 'unreadable') {
      throw new Error(`expected unreadable, got ${result.value.status}`)
    }
    expect(result.value.reason).toBe('readError')
    expect(await readFile(canonicalPath(), 'latin1')).toBe(onDisk)
  })

  it('fails with config.error.profileNotFound for an unknown profile id', async () => {
    const { handlers } = await boot()

    const result = await saveRaw(handlers, 'anything', { profileId: 'nope' })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
  })

  it('rejects a payload the schema refuses (text over the length cap) before the handler runs', async () => {
    const { handlers, state } = await boot()
    const onDisk = await seeded(handlers, state)

    const result = await saveRaw(handlers, 'x'.repeat(MAX_RAW_CONFIG_TEXT_LENGTH + 1))

    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    expect(await readFile(canonicalPath(), 'latin1')).toBe(onDisk)
  })

  /**
   * Story 079 D3 (AC1): a raw save is a content mutation like any other, so it now cascades to
   * every assigned installation the same way `save` (story 043 D4) does - and the copy is
   * byte-identical to what the user typed, never a re-render of it (the whole point of D3's
   * `refuseCanonicalWriteFor`: hand-formatted or otherwise non-render-fixed-point text must reach
   * the installation exactly as typed, not through `renderProfileFile`).
   */
  it('saveRawText cascades the typed bytes to every assigned installation', async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([profile()])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const onDisk = await readFile(canonicalPath(), 'latin1')

    // Deliberately not a render fixed point (hand-formatted spacing), so a cascade that re-rendered
    // instead of copying the typed bytes would be caught by this assertion.
    const raw = `${onDisk}\tset q2l_typed_raw   "1"   \n`
    const result = await saveRaw(handlers, raw)

    if (!result.ok || result.value.status !== 'saved') {
      throw new Error(`expected a raw save, got ${JSON.stringify(result)}`)
    }
    // The canonical file still says exactly what was typed - the cascade must not have re-rendered
    // it (that is D3's whole reason for `refuseCanonicalWriteFor`).
    expect(await readFile(canonicalPath(), 'latin1')).toBe(raw)
    const copy = await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')
    expect(copy).toBe(raw)
    expect(only(state).fileHash).toBe(hashCanonicalFileContent(raw))
  })

  /**
   * Story 079 D3 (AC9, partial): the per-profile `canonicalWriteAllowed` rule still applies to
   * every OTHER profile a raw-save cascade touches - a dirty sibling assigned to the same
   * installation contributes its own on-disk file, never its unsaved edits, exactly as it does
   * after a structured save (see the `canonicalWriteAllowed` describe in `sync.test.ts`).
   */
  it("saveRawText's cascade leaves a dirty sibling on the same installation untouched", async () => {
    const inst = installation()
    const { handlers, state } = await boot([inst])
    state.setConfigProfiles([
      profile({
        id: 'p1',
        name: 'Profile',
        assignments: [{ installationId: inst.id, isDefault: true }],
      }),
      profile({
        id: 'p2',
        name: 'Second',
        assignments: [{ installationId: inst.id, isDefault: false }],
      }),
    ])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p2' })
    const siblingCopyBefore = await readFile(join(dir, 'baseq2', 'Second.cfg'), 'latin1')
    const siblingCanonicalBefore = await readFile(canonicalPath('Second.cfg'), 'latin1')
    // An unsaved UI edit on the sibling - marks it dirty without writing its file.
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p2', cvars: { sensitivity: '42' } })

    const onDisk = await readFile(canonicalPath(), 'latin1')
    const raw = `${onDisk}set q2l_typed_raw "1"\n`
    const result = await saveRaw(handlers, raw)
    if (!result.ok || result.value.status !== 'saved') {
      throw new Error(`expected a raw save, got ${JSON.stringify(result)}`)
    }

    // The saved profile's own copy cascades...
    expect(await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(raw)
    // ...while the dirty sibling's copy and canonical file are untouched by this cascade: no trace
    // of its unsaved "42" anywhere on disk.
    expect(await readFile(join(dir, 'baseq2', 'Second.cfg'), 'latin1')).toBe(siblingCopyBefore)
    expect(await readFile(canonicalPath('Second.cfg'), 'latin1')).toBe(siblingCanonicalBefore)
    expect(siblingCopyBefore).not.toContain('42')
  })
})
