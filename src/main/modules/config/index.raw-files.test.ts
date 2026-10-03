import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type RawFilesResult,
  type SaveRawTextResult,
} from '@shared/modules/config'
import { type Installation, type Outcome } from '@shared/types'
import { pathExists } from '../../lib/fs-utils'
import { type AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { type ModuleHandler } from '../types'
import { sentinelLine } from '@shared/config/render/render'
import { MAX_RAW_CONFIG_TEXT_LENGTH } from './schemas'
import { configModule } from './index'
import {
  collectHandlers,
  idleState,
  installation,
  log,
  profile,
  shellMock,
  installConfigTestDir,
  userDataBox,
} from './index.test-helpers'
import { seedConfigProfiles } from '../../../test-support/config-state'

vi.mock('electron', async () => {
  const h = await import('./index.test-helpers')
  return { app: { getPath: () => h.userDataBox.current }, shell: h.shellMock }
})

const getDir = installConfigTestDir()
let dir: string
beforeEach(() => {
  dir = getDir()
})

/** One happy path through the real module; the report's cases are pinned in profile-writes.reads.test.ts. */
describe('CONFIG_HANDLERS.rawFiles handler', () => {
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

  it('reports one entry per assignment', async () => {
    const inst1 = installation({ id: 'i1' })
    const inst2 = installation({ id: 'i2', rootPath: join(dir, 'inst2') })
    await mkdir(join(inst2.rootPath, 'baseq2'), { recursive: true })
    const { handlers, state } = await boot([inst1, inst2])
    seedConfigProfiles(state, [
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
})

/**
 * `openFile` is the module's one privileged path: `shell` is only reached for a file main itself
 * resolved from ids AND verified to be this profile's own `.cfg`. Boots over a real, temp-file-backed
 * `StateStore` so a save really puts the file on disk.
 */
describe('CONFIG_HANDLERS.openFile handler', () => {
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
        os: shellMock,
      } as unknown as AppContext,
      log,
    })
    return { handlers, state }
  }

  /**
   * Boots, seeds one profile and saves it, so its files are really on disk.
   */
  async function bootSynced(
    installations: Installation[] = [],
    seeded: ConfigProfile = profile({ assignments: [] }),
  ): Promise<Map<string, ModuleHandler>> {
    const { handlers, state } = await boot(installations)
    seedConfigProfiles(state, [seeded])
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

    expect(result).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
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

    expect(result).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('refuses a file that is not on disk without touching shell', async () => {
    // No sync ran, so the canonical file was never written -
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ assignments: [] })])
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

  it('opens a canonical file still in the legacy sentinel shape too', async () => {
    // A file synced by a pre-051 launcher build never gets rewritten just by
    // being read - the open-in-editor guard must still recognise it as p1's
    // own file via the legacy sentinel, not only the new banner shape.
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ assignments: [] })])
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
    seedConfigProfiles(state, [profile({ assignments: [] })])
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
 * `saveRawText` - the Raw file tab's editor writing the user's own text onto the
 * canonical file.
 *
 * Every test here starts from a real `save`, so the text being edited is the file the launcher
 * itself wrote (which is the only state the editor is offered in) and the ownership header under
 * test is the real one, never a hand-built fixture that could drift from what `render.ts` emits.
 */
describe('CONFIG_HANDLERS.saveRawText handler', () => {
  async function boot(): Promise<Map<string, ModuleHandler>> {
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    const handlers = new Map<string, ModuleHandler>()
    await configModule.setup({
      handle: collectHandlers(handlers),
      emit: () => {},
      onDispose: () => {},
      app: {
        installations: { find: () => undefined, list: () => [] },
        launch: { getState: () => idleState() },
        state,
      } as unknown as AppContext,
      log,
    })
    seedConfigProfiles(state, [profile({ assignments: [] })])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    return handlers
  }

  it('rejects a payload the schema refuses (text over the length cap) before the handler runs', async () => {
    const handlers = await boot()
    const path = join(userDataBox.current, 'Profile.cfg')
    const onDisk = await readFile(path, 'latin1')

    const result = (await handlers.get(CONFIG_HANDLERS.saveRawText)!({
      profileId: 'p1',
      text: 'x'.repeat(MAX_RAW_CONFIG_TEXT_LENGTH + 1),
    })) as Outcome<SaveRawTextResult>

    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    expect(await readFile(path, 'latin1')).toBe(onDisk)
  })
})
