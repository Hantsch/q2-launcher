import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONFIG_HANDLERS,
  type ConfigAction,
  type ConfigActionCategory,
  type ConfigProfile,
} from '@shared/modules/config'
import type { AltLayer } from '@shared/config/alt-layers'
import { fail, type Installation } from '@shared/types'
import { scopedLogger } from '../../lib/logger'
import type { AppContext } from '../../context'
import { StateStore } from '../../services/state'
import type { ModuleHandler, ModuleSetup } from '../types'
import { readImportableFiles } from './core/import-reader'
import {
  commitImportFiles,
  gameDirBelongsToInstallation,
  pickImportFiles,
  previewImportFiles,
} from './import'
import { PickedFilesRegistry } from './picked-files'
import { renderLoaderFile, renderProfileFile } from './render'

/**
 * Story 005 D3 / story 066 D5: the handler logic in `import.ts`, tested directly against a
 * real temp fixture tree (same style as `core/import-reader.test.ts` and
 * `index.test.ts`'s `writeProfileToAssignedInstallations` suite) rather than
 * through `configModule.setup()` - except where the point of the test IS the wiring, in which case
 * it boots the module the same duck-typed way `index.test.ts` does.
 *
 * Story 066 D5 re-addressed every case here from `{ installationId, gameDir }` to picked file ids:
 * each test registers the file(s) it wrote in a real `PickedFilesRegistry` (standing in for what
 * `import.pickFiles` does with the OS dialog's result) and passes the ids back, which is the only
 * addressing the flow has left.
 */

/**
 * The reader is wrapped in a delegating spy - every test still exercises the real read - so the
 * refusal tests can assert what matters about an unknown id: that the filesystem is never touched
 * for the request at all, not merely that the call answered with a failure.
 */
vi.mock('./core/import-reader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./core/import-reader')>()
  return { ...actual, readImportableFiles: vi.fn(actual.readImportableFiles) }
})

/**
 * `configModule.setup()`'s commit path resolves the canonical profile directory through
 * `lib/paths`' `userDataDir()`, and `openFile`-style handlers pull `shell` in - so `electron` is
 * mocked exactly as in `index.test.ts`, pointed at a per-test temp folder through a hoisted box.
 */
const userDataBox = vi.hoisted(() => ({ current: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
  shell: { openPath: async () => '', showItemInFolder: () => {} },
}))

const log = scopedLogger('config-import-test')

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'q2-launcher-import-handlers-'))
  userDataBox.current = join(root, 'userData')
  vi.mocked(readImportableFiles).mockClear()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function write(relativePath: string, content: string): Promise<void> {
  const target = join(root, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.from(content, 'latin1'))
}

function lines(...parts: string[]): string {
  return `${parts.join('\n')}\n`
}

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'i1',
    name: 'Test',
    rootPath: root,
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: ['xatrix', 'rogue'],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

/**
 * Registers `<root>/<relativePath>` in a fresh session registry and returns the registry plus the
 * ids, in order - the file-mode stand-in for the old `{ installationId, gameDir }` addressing.
 * Nothing here ever hands a path to the function under test.
 */
function pickedFiles(relativePaths: readonly string[]): {
  picked: PickedFilesRegistry
  fileIds: string[]
} {
  const picked = new PickedFilesRegistry()
  const fileIds = picked
    .register(relativePaths.map((relativePath) => join(root, relativePath)))
    .map((file) => file.id)
  return { picked, fileIds }
}

/** A `DialogService.pickConfigFiles` stand-in that records what it was asked and answers `paths`. */
function fakePicker(paths: readonly string[]): {
  pickConfigFiles: (options: { defaultPath?: string }) => Promise<string[]>
  calls: { defaultPath?: string }[]
} {
  const calls: { defaultPath?: string }[] = []
  return {
    calls,
    pickConfigFiles: async (options) => {
      calls.push(options)
      return [...paths]
    },
  }
}

function fakeCreateProfile() {
  const calls: {
    name: string
    cvars: Record<string, string>
    binds: Record<string, string>
    unrecognized: { file: string; line: number; text: string }[]
    actions: ConfigAction[]
    categories: ConfigActionCategory[]
    layers: AltLayer[]
  }[] = []
  const stubProfiles: ConfigProfile[] = [
    {
      id: 'new-profile',
      name: 'stub',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      cvars: {},
      binds: {},
      assignments: [],
    },
  ]
  const createProfile = (input: (typeof calls)[number]): ConfigProfile[] => {
    calls.push(input)
    return stubProfiles
  }
  return { calls, stubProfiles, createProfile }
}

/**
 * Boots the real `configModule` over a real, temp-file-backed `StateStore` and a duck-typed `app` -
 * the same harness shape `index.test.ts` uses, plus the `dialog` service story 066 D4 added, so the
 * three import channels can be driven through their registered handlers (payload validation
 * included) rather than only as plain functions.
 */
async function bootModule(
  options: { installations?: Installation[]; pickedPaths?: readonly string[] } = {},
): Promise<{
  handlers: Map<string, ModuleHandler>
  state: StateStore
  picker: ReturnType<typeof fakePicker>
}> {
  const { configModule } = await import('./index')
  const insts = options.installations ?? []
  const picker = fakePicker(options.pickedPaths ?? [])
  const state = new StateStore(join(root, 'state.json'))
  await state.load()

  const handlers = new Map<string, ModuleHandler>()
  const handle: ModuleSetup['handle'] = (type, schema, handler) => {
    handlers.set(type, (payload) => {
      const parsed = schema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      return handler(parsed.data)
    })
  }

  await configModule.setup({
    handle,
    emit: () => {},
    app: {
      installations: { find: (id: string) => insts.find((i) => i.id === id), list: () => insts },
      launch: { getState: () => ({ phase: 'idle', installationId: null }) },
      state,
      dialog: picker,
    } as unknown as AppContext,
    log,
  })

  return { handlers, state, picker }
}

describe('gameDirBelongsToInstallation', () => {
  it('accepts baseq2 even though it is never listed in gameDirs', () => {
    expect(gameDirBelongsToInstallation(installation({ gameDirs: [] }), 'baseq2')).toBe(true)
  })

  it('accepts a listed gamedir and rejects an unlisted one', () => {
    const inst = installation({ gameDirs: ['xatrix'] })
    expect(gameDirBelongsToInstallation(inst, 'xatrix')).toBe(true)
    expect(gameDirBelongsToInstallation(inst, 'rogue')).toBe(false)
  })
})

describe('pickImportFiles', () => {
  it('hands back opaque handles that carry no path, and registers what the picker returned', async () => {
    await write('picked/dm.cfg', lines('set sensitivity "3"'))
    const picker = fakePicker([join(root, 'picked', 'dm.cfg')])
    const registry = new PickedFilesRegistry()

    const result = await pickImportFiles(picker, registry, log, { defaultPath: join(root, 'baseq2') })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Exactly three fields, and not one of them is (or contains) an absolute path: `dirName` is the
    // containing folder's NAME only. `toEqual` on the whole object is the point - an extra
    // path-carrying field would fail here.
    expect(result.value).toEqual([
      { id: expect.any(String), fileName: 'dm.cfg', dirName: 'picked' },
    ])
    // Belt and braces: no part of the real folder's spelling appears anywhere in what the renderer
    // would receive (`root` as it would be serialised, escaping included).
    expect(JSON.stringify(result.value)).not.toContain(JSON.stringify(root).slice(1, -1))
    expect(picker.calls).toEqual([{ defaultPath: join(root, 'baseq2') }])
    expect(registry.size).toBe(1)
  })

  it('treats a cancelled dialog as an empty, successful pick and registers nothing', async () => {
    const registry = new PickedFilesRegistry()

    const result = await pickImportFiles(fakePicker([]), registry, log)

    expect(result).toEqual({ ok: true, value: [] })
    expect(registry.size).toBe(0)
  })

  it('keeps an earlier pick resolvable when a second pick adds more files', async () => {
    await write('picked/a.cfg', lines('set sensitivity "3"'))
    await write('picked/b.cfg', lines('set sensitivity "4"'))
    const registry = new PickedFilesRegistry()

    const first = await pickImportFiles(fakePicker([join(root, 'picked', 'a.cfg')]), registry, log)
    const second = await pickImportFiles(fakePicker([join(root, 'picked', 'b.cfg')]), registry, log)

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(registry.resolve([first.value[0]!.id, second.value[0]!.id])).toEqual([
      join(root, 'picked', 'a.cfg'),
      join(root, 'picked', 'b.cfg'),
    ])
  })
})

describe('previewImportFiles', () => {
  it('reports counts and preserved lines without writing anything', async () => {
    await write(
      'baseq2/config.cfg',
      // `alias +wave "say hi"` used to land in `preserved` before story 041's
      // reader learned to recognize `alias` (D1/D2) - it is now a parsed alias
      // definition (see the `previewImportFiles` describe block below for that
      // field), so a genuinely unrecognized command is what exercises
      // `preserved` here.
      lines('set sensitivity "3"', 'bind x "+attack"', 'wave hi', 'exec extra.cfg'),
    )
    await write('baseq2/extra.cfg', lines('bind y "+jump"'))
    await write('baseq2/autoexec.cfg', lines('set sensitivity "5"'))

    const before = await readdir(join(root, 'baseq2'))
    const { picked, fileIds } = pickedFiles(['baseq2/config.cfg', 'baseq2/autoexec.cfg'])

    const result = await previewImportFiles(picked, log, { fileIds })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.cvarCount).toBe(1)
    expect(result.value.bindCount).toBe(2)
    expect(result.value.preserved).toEqual([{ file: 'config.cfg', line: 3, text: 'wave hi' }])
    // The picked list is the load order, `exec` expands in place, and only bare file names ever
    // cross the module boundary - never a folder, let alone an absolute path.
    expect(result.value.filesRead).toEqual(['config.cfg', 'extra.cfg', 'autoexec.cfg'])

    const after = await readdir(join(root, 'baseq2'))
    expect(after).toEqual(before)
  })

  // Story 041 (D6): the alias-shaped preview fields, wired through
  // `buildImportedActions` with an empty `layerAliases`.
  it('reports aliasCount, messageCount, duplicateAliases and ambiguousRebindAliases', async () => {
    await write(
      'baseq2/config.cfg',
      lines(
        'set sensitivity "3"',
        'bind x "+attack"',
        'alias cali "bind KP_END fuck; bind KP_DOWNARROW gun"',
        'alias greeting "say hi there"',
        'alias a "b"',
        'alias a "c"',
      ),
    )
    const { picked, fileIds } = pickedFiles(['baseq2/config.cfg'])

    const result = await previewImportFiles(picked, log, { fileIds })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // cali, greeting, a (last-definition-wins, so one entry for "a").
    expect(result.value.aliasCount).toBe(3)
    // Only "greeting" is exactly one say/say_team command.
    expect(result.value.messageCount).toBe(1)
    expect(result.value.duplicateAliases).toEqual([{ name: 'a', file: 'config.cfg', line: 6 }])
    expect(result.value.ambiguousRebindAliases).toEqual([
      {
        name: 'cali',
        body: 'bind KP_END fuck; bind KP_DOWNARROW gun',
        file: 'config.cfg',
        line: 3,
      },
    ])
  })

  it('folds the picked files left to right, so a later file wins', async () => {
    await write('picked/first.cfg', lines('set sensitivity "3"', 'bind x "+attack"'))
    await write('picked/second.cfg', lines('set sensitivity "9"'))
    const { picked, fileIds } = pickedFiles(['picked/first.cfg', 'picked/second.cfg'])

    const result = await previewImportFiles(picked, log, { fileIds })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.filesRead).toEqual(['first.cfg', 'second.cfg'])
    expect(result.value.cvarCount).toBe(1)
    expect(result.value.bindCount).toBe(1)
  })
})

describe('commitImportFiles', () => {
  it('re-parses from disk and creates a profile carrying cvars, binds and unrecognized', async () => {
    await write(
      'baseq2/config.cfg',
      lines('set sensitivity "3"', 'bind x "+attack"', 'alias a "b"'),
    )

    const before = await readdir(join(root, 'baseq2'))
    const { calls, stubProfiles, createProfile } = fakeCreateProfile()
    const { picked, fileIds } = pickedFiles(['baseq2/config.cfg'])

    const result = await commitImportFiles(picked, log, { fileIds, name: 'Imported' }, createProfile)

    expect(result).toEqual({ ok: true, value: stubProfiles })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.name).toBe('Imported')
    expect(calls[0]!.cvars).toEqual({ sensitivity: '3' })
    expect(calls[0]!.binds).toEqual({ x: '+attack' })
    expect(calls[0]!.unrecognized).toEqual([])
    // "a" has no rebinding bind segment, so it converts as a plain alias entry.
    expect(calls[0]!.actions).toHaveLength(1)
    expect(calls[0]!.actions[0]!.name).toBe('a')
    expect(calls[0]!.actions[0]!.kind).toBe('alias')
    expect(calls[0]!.layers).toEqual([])
    // Import is read-only - the picked files are untouched.
    const after = await readdir(join(root, 'baseq2'))
    expect(after).toEqual(before)
  })

  // Story 041 (D6): the answers to "attempt as layer" flow through to
  // `buildImportedActions`, validated against this import's own ambiguous list.
  describe('layerAliases (story 041 D6)', () => {
    async function writeAmbiguousFixture(): Promise<void> {
      await write(
        'baseq2/config.cfg',
        lines('alias cali "bind KP_END fuck; bind KP_DOWNARROW gun"'),
      )
    }

    it('with no layerAliases, converts an ambiguous alias as a plain alias entry', async () => {
      await writeAmbiguousFixture()
      const { calls, createProfile } = fakeCreateProfile()
      const { picked, fileIds } = pickedFiles(['baseq2/config.cfg'])

      const result = await commitImportFiles(
        picked,
        log,
        { fileIds, name: 'Imported' },
        createProfile,
      )

      expect(result.ok).toBe(true)
      expect(calls[0]!.layers).toEqual([])
      expect(calls[0]!.actions).toHaveLength(1)
      expect(calls[0]!.actions[0]!.name).toBe('cali')
      expect(calls[0]!.actions[0]!.kind).toBe('alias')
    })

    it('with a valid layerAliases entry, converts that alias into a layer and produces no action for it', async () => {
      await writeAmbiguousFixture()
      const { calls, createProfile } = fakeCreateProfile()
      const { picked, fileIds } = pickedFiles(['baseq2/config.cfg'])

      const result = await commitImportFiles(
        picked,
        log,
        { fileIds, name: 'Imported', layerAliases: ['cali'] },
        createProfile,
      )

      expect(result.ok).toBe(true)
      expect(calls[0]!.actions).toEqual([])
      expect(calls[0]!.layers).toHaveLength(1)
      expect(calls[0]!.layers[0]!.name).toBe('cali')
      expect(calls[0]!.layers[0]!.overrides).toEqual({ KP_END: 'fuck', KP_DOWNARROW: 'gun' })
    })

    it('rejects a layerAliases entry that is not ambiguous in this import, and never calls createProfile', async () => {
      await writeAmbiguousFixture()
      const { calls, createProfile } = fakeCreateProfile()
      const { picked, fileIds } = pickedFiles(['baseq2/config.cfg'])

      const result = await commitImportFiles(
        picked,
        log,
        { fileIds, name: 'Imported', layerAliases: ['not-a-real-alias'] },
        createProfile,
      )

      expect(result).toEqual({ ok: false, error: { key: 'config.error.invalidLayerAlias' } })
      expect(calls).toEqual([])
    })
  })
})

/**
 * Story 066 D5 - the path-trust boundary itself, plus AC9 ("import from files needs no
 * installation") and AC10 ("nothing is written until Create is pressed, and the commit re-reads
 * the picked files from disk").
 */
describe('story 066 D5: import from picked files', () => {
  /** The whole flow, exactly as the module wires it: pick -> preview -> commit. */
  it('import from files needs no installation', async () => {
    await write('picked/dm.cfg', lines('set sensitivity "3"', 'bind x "+attack"'))
    const registry = new PickedFilesRegistry()

    // Nothing in this test - not the picker, not the registry, not either handler function - takes
    // an installation, an installation id or a gamedir. There is no parameter left to pass one to.
    const pickResult = await pickImportFiles(
      fakePicker([join(root, 'picked', 'dm.cfg')]),
      registry,
      log,
    )
    expect(pickResult.ok).toBe(true)
    if (!pickResult.ok) return
    const fileIds = pickResult.value.map((file) => file.id)

    const preview = await previewImportFiles(registry, log, { fileIds })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.value.cvarCount).toBe(1)
    expect(preview.value.bindCount).toBe(1)

    const { calls, createProfile } = fakeCreateProfile()
    const commit = await commitImportFiles(
      registry,
      log,
      { fileIds, name: 'From files' },
      createProfile,
    )

    expect(commit.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.cvars).toEqual({ sensitivity: '3' })
    expect(calls[0]!.binds).toEqual({ x: '+attack' })
  })

  it('preview and commit work with no installation selected', async () => {
    await write('picked/dm.cfg', lines('set sensitivity "3"', 'bind x "+attack"'))
    // One installation is registered, but none is the active/selected one - the flow must not care,
    // and the picker's start folder falls back rather than failing.
    const { handlers, state, picker } = await bootModule({
      installations: [installation()],
      pickedPaths: [join(root, 'picked', 'dm.cfg')],
    })
    expect(state.settings().activeInstallationId).toBeNull()

    const picked = (await handlers.get(CONFIG_HANDLERS.importPickFiles)!(undefined)) as {
      ok: true
      value: { id: string }[]
    }
    expect(picked.ok).toBe(true)
    expect(picker.calls).toEqual([{ defaultPath: join(root, 'baseq2') }])
    const fileIds = picked.value.map((file) => file.id)

    const preview = (await handlers.get(CONFIG_HANDLERS.importPreviewFiles)!({ fileIds })) as {
      ok: boolean
      value: { cvarCount: number }
    }
    expect(preview.ok).toBe(true)
    expect(preview.value.cvarCount).toBe(1)

    const commit = (await handlers.get(CONFIG_HANDLERS.importCommitFiles)!({
      fileIds,
      name: 'No selection',
    })) as { ok: boolean; value: ConfigProfile[] }
    expect(commit.ok).toBe(true)
    expect(commit.value.map((profile) => profile.name)).toEqual(['No selection'])
    expect(state.configProfiles()[0]!.cvars).toEqual({ sensitivity: '3' })
  })

  it('preview and commit work on an empty installation list', async () => {
    await write('picked/dm.cfg', lines('set sensitivity "3"', 'bind x "+attack"'))
    // No installation registered anywhere in the launcher (AC9's second half).
    const { handlers, state, picker } = await bootModule({
      installations: [],
      pickedPaths: [join(root, 'picked', 'dm.cfg')],
    })

    const picked = (await handlers.get(CONFIG_HANDLERS.importPickFiles)!(undefined)) as {
      ok: true
      value: { id: string }[]
    }
    expect(picked.ok).toBe(true)
    // Nothing to derive a start folder from, so none is passed - the OS picks its own default.
    expect(picker.calls).toEqual([{}])
    const fileIds = picked.value.map((file) => file.id)

    const preview = (await handlers.get(CONFIG_HANDLERS.importPreviewFiles)!({ fileIds })) as { ok: boolean }
    expect(preview.ok).toBe(true)

    const commit = (await handlers.get(CONFIG_HANDLERS.importCommitFiles)!({
      fileIds,
      name: 'Installation-free',
    })) as { ok: boolean; value: ConfigProfile[] }
    expect(commit.ok).toBe(true)
    expect(commit.value).toHaveLength(1)
    expect(commit.value[0]!.assignments).toEqual([])
    expect(state.configProfiles()).toHaveLength(1)
  })

  /**
   * AC10's second half, proven by really editing the file on disk between the two calls rather than
   * by counting reader calls: whatever the preview saw is irrelevant, only what commit reads is
   * stored.
   */
  it('commit re-reads the picked files from disk', async () => {
    await write('picked/dm.cfg', lines('set sensitivity "3"', 'bind x "+attack"'))
    const { picked, fileIds } = pickedFiles(['picked/dm.cfg'])

    const preview = await previewImportFiles(picked, log, { fileIds })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.value.cvarCount).toBe(1)
    expect(preview.value.bindCount).toBe(1)

    // Same path, different content - the user edited the file after previewing it.
    await write('picked/dm.cfg', lines('set sensitivity "9"', 'bind x "+attack"', 'bind y "+jump"'))

    const { calls, createProfile } = fakeCreateProfile()
    const commit = await commitImportFiles(
      picked,
      log,
      { fileIds, name: 'Re-read' },
      createProfile,
    )

    expect(commit.ok).toBe(true)
    // The commit reflects the NEW bytes, not the previewed ones.
    expect(calls[0]!.cvars).toEqual({ sensitivity: '9' })
    expect(calls[0]!.binds).toEqual({ x: '+attack', y: '+jump' })
  })

  it('preview writes nothing', async () => {
    await write('picked/dm.cfg', lines('set sensitivity "3"', 'bind x "+attack"'))
    const sourceBefore = await readFile(join(root, 'picked', 'dm.cfg'), 'latin1')

    // Through the real module, so `ProfilesStore`/`StateStore` are the real thing: if preview wrote
    // anything at all, it would show up in the persisted profile list.
    const { handlers, state } = await bootModule({
      pickedPaths: [join(root, 'picked', 'dm.cfg')],
    })
    const picked = (await handlers.get(CONFIG_HANDLERS.importPickFiles)!(undefined)) as {
      value: { id: string }[]
    }
    const fileIds = picked.value.map((file) => file.id)

    const preview = (await handlers.get(CONFIG_HANDLERS.importPreviewFiles)!({ fileIds })) as { ok: boolean }

    expect(preview.ok).toBe(true)
    expect(state.configProfiles()).toEqual([])
    // The picked file itself is byte-identical, and no sibling was created next to it.
    expect(await readFile(join(root, 'picked', 'dm.cfg'), 'latin1')).toBe(sourceBefore)
    expect(await readdir(join(root, 'picked'))).toEqual(['dm.cfg'])

    // And the commit that follows is what creates the profile - the preview left nothing half-done.
    const commit = (await handlers.get(CONFIG_HANDLERS.importCommitFiles)!({ fileIds, name: 'Created' })) as {
      ok: boolean
    }
    expect(commit.ok).toBe(true)
    expect(state.configProfiles()).toHaveLength(1)
  })

  /**
   * AC4/D5: the registry is the only thing that turns an id into a path, so an id the renderer made
   * up resolves to nothing - and does so before the reader is ever called, for the whole request,
   * even when it travels alongside ids that ARE real.
   */
  it('an id the renderer invented is refused', async () => {
    await write('picked/dm.cfg', lines('set sensitivity "3"'))
    const { picked, fileIds } = pickedFiles(['picked/dm.cfg'])
    const invented = [
      // Shaped like a real handle (a v4 UUID this session never handed out)...
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      // ...and not shaped like one at all.
      '../../../etc/passwd',
      join(root, 'picked', 'dm.cfg'),
      '',
    ]
    const { calls, createProfile } = fakeCreateProfile()

    for (const id of invented) {
      expect(await previewImportFiles(picked, log, { fileIds: [id] })).toEqual({
        ok: false,
        error: { key: 'config.error.pickedFileNotFound' },
      })
      expect(
        await commitImportFiles(picked, log, { fileIds: [id], name: 'Nope' }, createProfile),
      ).toEqual({ ok: false, error: { key: 'config.error.pickedFileNotFound' } })
    }

    // One real id plus one invented one refuses the WHOLE request - the real file is not imported
    // "as much as possible".
    const mixed = [fileIds[0]!, invented[0]!]
    expect(await previewImportFiles(picked, log, { fileIds: mixed })).toEqual({
      ok: false,
      error: { key: 'config.error.pickedFileNotFound' },
    })
    expect(
      await commitImportFiles(picked, log, { fileIds: mixed, name: 'Nope' }, createProfile),
    ).toEqual({ ok: false, error: { key: 'config.error.pickedFileNotFound' } })

    // Nothing was read and nothing was created for any of those calls.
    expect(vi.mocked(readImportableFiles)).not.toHaveBeenCalled()
    expect(calls).toEqual([])

    // The real id still works afterwards - a refusal does not poison the session.
    const good = await previewImportFiles(picked, log, { fileIds })
    expect(good.ok).toBe(true)
    expect(vi.mocked(readImportableFiles)).toHaveBeenCalledTimes(1)
  })

  it('resolves ids in the order given, never in registration order', async () => {
    await write('picked/first.cfg', lines('set sensitivity "3"'))
    await write('picked/second.cfg', lines('set sensitivity "9"'))
    const { picked, fileIds } = pickedFiles(['picked/first.cfg', 'picked/second.cfg'])

    const reversed = await previewImportFiles(picked, log, { fileIds: [...fileIds].reverse() })

    expect(reversed.ok).toBe(true)
    if (!reversed.ok) return
    expect(reversed.value.filesRead).toEqual(['second.cfg', 'first.cfg'])
  })
})

/**
 * Story 042 D5: `ownWrittenFile`/`metadataVersion`/`sourceProfileId`/`metadataWarnings` on
 * `previewImportFiles`, and `commitImportFiles`'s use of `restoreProfileParts` (D4) - including the
 * case the acceptance line calls out explicitly: the sentinel is only reached through the loader's
 * `exec` chain, never in the file the user actually picked.
 */
describe('story 042 D5: ownWrittenFile / metadata restore', () => {
  const sourceProfile: ConfigProfile = {
    id: 'source-profile-id',
    name: 'Source',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: { sensitivity: '3' },
    binds: {},
    assignments: [],
  }
  const profileFileName = 'q2l-profile-source-profile-id.cfg'

  /**
   * `autoexec.cfg` is the loader `renderLoaderFile` actually writes for an installation's default
   * profile: its own sentinel line, naming `sourceProfile.id`, followed by `exec <profileFileName>`
   * - the profile's own cvars/tags live only in the exec'd file, never in `autoexec.cfg` itself.
   * The user picks `autoexec.cfg`; file-mode `exec` resolution reaches the sibling profile file.
   */
  async function writeOwnWrittenFixture(): Promise<void> {
    await write('baseq2/autoexec.cfg', renderLoaderFile(sourceProfile, profileFileName))
    await write(`baseq2/${profileFileName}`, renderProfileFile(sourceProfile))
  }

  describe('previewImportFiles', () => {
    it('reports ownWrittenFile true, with metadataVersion/sourceProfileId, for a file whose sentinel is only reached through the exec chain', async () => {
      await writeOwnWrittenFixture()
      const { picked, fileIds } = pickedFiles(['baseq2/autoexec.cfg'])

      const result = await previewImportFiles(picked, log, { fileIds })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      // The picked file itself carries neither the sentinel nor the `v` marker - both only exist in
      // `q2l-profile-source-profile-id.cfg`, reached solely via `autoexec.cfg`'s `exec` line.
      expect(result.value.ownWrittenFile).toBe(true)
      expect(result.value.sourceProfileId).toBe('source-profile-id')
      expect(result.value.metadataVersion).not.toBeNull()
    })

    it('reports ownWrittenFile false, with metadataVersion/sourceProfileId null, for a foreign config', async () => {
      await write('baseq2/config.cfg', lines('set sensitivity "3"', 'bind x "+attack"'))
      const { picked, fileIds } = pickedFiles(['baseq2/config.cfg'])

      const result = await previewImportFiles(picked, log, { fileIds })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.ownWrittenFile).toBe(false)
      expect(result.value.metadataVersion).toBeNull()
      expect(result.value.sourceProfileId).toBeNull()
      expect(result.value.metadataWarnings).toEqual([])
    })
  })

  describe('commitImportFiles', () => {
    it('skips the ambiguous-alias review step for an own-written file, so a stray layerAliases answer does not fail the commit', async () => {
      await writeOwnWrittenFixture()
      const { picked, fileIds } = pickedFiles(['baseq2/autoexec.cfg'])
      const calls: unknown[] = []
      const createProfile = (input: unknown): ConfigProfile[] => {
        calls.push(input)
        return [
          {
            id: 'stub',
            name: 'Restored',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            cvars: {},
            binds: {},
            assignments: [],
          },
        ]
      }

      const result = await commitImportFiles(
        picked,
        log,
        {
          fileIds,
          name: 'Restored',
          // Not ambiguous in this import at all - a foreign file would reject the whole commit for
          // this (see the 041 D6 suite above); an own-written file must not, since there is nothing
          // to guess (D4 already resolved slot pairing deterministically from tags).
          layerAliases: ['not-a-real-alias'],
        },
        createProfile,
      )

      expect(result.ok).toBe(true)
      expect(calls).toHaveLength(1)
    })

    it('never adopts sourceProfileId as the new profile id, so importing the same own-written file twice yields two distinct profiles', async () => {
      await writeOwnWrittenFixture()
      const { picked, fileIds } = pickedFiles(['baseq2/autoexec.cfg'])

      let minted = 0
      const mintingCreateProfile = (input: {
        name: string
        cvars: Record<string, string>
        binds: Record<string, string>
      }): ConfigProfile[] => {
        minted += 1
        return [
          {
            id: `minted-${minted}`,
            name: input.name,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            cvars: input.cvars,
            binds: input.binds,
            assignments: [],
          },
        ]
      }

      const first = await commitImportFiles(
        picked,
        log,
        { fileIds, name: 'Restored' },
        mintingCreateProfile,
      )
      const second = await commitImportFiles(
        picked,
        log,
        { fileIds, name: 'Restored' },
        mintingCreateProfile,
      )

      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      if (!first.ok || !second.ok) return
      expect(first.value[0]!.id).not.toBe(second.value[0]!.id)
      // Never the source file's own profile id either (AC4).
      expect(first.value[0]!.id).not.toBe('source-profile-id')
      expect(second.value[0]!.id).not.toBe('source-profile-id')
    })
  })
})
