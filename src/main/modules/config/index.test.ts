import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONFIG_HANDLERS,
  type ConfigAction,
  type ConfigProfile, type RawFilesResult } from '@shared/modules/config'
import type { Installation, Outcome } from '@shared/types'
import { seedConfigProfiles } from '../../../test-support/config-state'
import { unwrapOk } from '../../../test-support/outcome'
import type { AppContext } from '../../context'
import { StateStore } from '../../services/state'
import type { ModuleHandler } from '../types'
import { configModule } from './index'
import {
  collectHandlers,
  idleState,
  installation,
  installConfigTestDir,
  log,
  profile,
  shellMock,
} from './index.test-helpers'
import { configState } from './persisted'

vi.mock('electron', async () => {
  const h = await import('./index.test-helpers')
  return { app: { getPath: () => h.userDataBox.current }, shell: h.shellMock }
})

const getDir = installConfigTestDir()
let dir: string
beforeEach(() => {
  dir = getDir()
})

interface Booted {
  handlers: Map<string, ModuleHandler>
  state: StateStore
  pickFile: string
}

/** The real module over a temp-file-backed `StateStore`, one saved profile and two installations. */
async function boot(): Promise<Booted> {
  const inst1: Installation = installation({ id: 'i1', rootPath: dir })
  const inst2: Installation = installation({ id: 'i2', rootPath: join(dir, 'inst2') })
  await mkdir(join(inst2.rootPath, 'baseq2'), { recursive: true })
  const installations = [inst1, inst2]
  const pickFile = join(dir, 'pick.cfg')
  await writeFile(pickFile, 'set sensitivity "3"\nbind a "+forward"\n', 'latin1')

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
      dialog: { pickConfigFiles: async () => [pickFile] },
    } as unknown as AppContext,
    log,
  })
  seedConfigProfiles(state, [profile()])
  await state.settle()
  return { handlers, state, pickFile }
}

const ALL_CHANNELS: string[] = Object.values(CONFIG_HANDLERS)

/** A payload each channel's schema refuses; the void-payload channels refuse any value at all. */
const INVALID_PAYLOADS: Record<string, unknown> = {
  [CONFIG_HANDLERS.list]: 'x',
  [CONFIG_HANDLERS.create]: {},
  [CONFIG_HANDLERS.rename]: {},
  [CONFIG_HANDLERS.remove]: {},
  [CONFIG_HANDLERS.assign]: {},
  [CONFIG_HANDLERS.unassign]: {},
  [CONFIG_HANDLERS.setDefault]: {},
  [CONFIG_HANDLERS.setCvars]: {},
  [CONFIG_HANDLERS.commitCvars]: {},
  [CONFIG_HANDLERS.setBinds]: {},
  [CONFIG_HANDLERS.setLayers]: {},
  [CONFIG_HANDLERS.setActions]: {},
  [CONFIG_HANDLERS.write]: {},
  [CONFIG_HANDLERS.save]: {},
  [CONFIG_HANDLERS.saveRawText]: {},
  [CONFIG_HANDLERS.refreshFromFiles]: { profileId: 7 },
  [CONFIG_HANDLERS.preview]: {},
  [CONFIG_HANDLERS.writeState]: 'x',
  [CONFIG_HANDLERS.syncState]: {},
  [CONFIG_HANDLERS.rawFiles]: {},
  [CONFIG_HANDLERS.openFile]: {
    profileId: 'p1',
    installationId: 'C:\\Windows\\calc.exe',
    mode: 'launch',
  },
  [CONFIG_HANDLERS.setPlayedMods]: {},
  [CONFIG_HANDLERS.switchBinds]: 'x',
  [CONFIG_HANDLERS.setSwitchBind]: {},
  [CONFIG_HANDLERS.setWriteUnbindall]: {},
  [CONFIG_HANDLERS.setWriteCatalogDefaults]: {},
  [CONFIG_HANDLERS.setSectionHeaderStyle]: {},
  [CONFIG_HANDLERS.discard]: {},
  [CONFIG_HANDLERS.importPickFiles]: 'x',
  [CONFIG_HANDLERS.importPreviewFiles]: {},
  [CONFIG_HANDLERS.importCommitFiles]: {},
  [CONFIG_HANDLERS.cleanupScan]: {},
  [CONFIG_HANDLERS.cleanupApply]: {},
  [CONFIG_HANDLERS.cleanupRestore]: {},
  [CONFIG_HANDLERS.tidyUpApply]: {},
}

/** Results of the channels already answered, for payloads that need an id an earlier call minted. */
type Answers = Record<string, unknown>

/**
 * One valid payload per channel, in an order that gives each one the state it needs (a save before
 * the file-reading and commit channels, a pick before the import ones, the created profile removed last).
 */
const HAPPY_PATHS: [string, (answers: Answers) => unknown][] = [
  [CONFIG_HANDLERS.list, () => undefined],
  [CONFIG_HANDLERS.create, () => ({ name: 'Created', from: 'empty' })],
  [CONFIG_HANDLERS.rename, () => ({ id: 'p1', name: 'Profile' })],
  [CONFIG_HANDLERS.setCvars, () => ({ profileId: 'p1', cvars: { sensitivity: '4' } })],
  [CONFIG_HANDLERS.setBinds, () => ({ profileId: 'p1', binds: { a: '+forward' } })],
  [CONFIG_HANDLERS.setLayers, () => ({ profileId: 'p1', layers: [] })],
  [CONFIG_HANDLERS.setActions, () => ({ profileId: 'p1', categories: [], actions: [] })],
  [CONFIG_HANDLERS.setWriteUnbindall, () => ({ profileId: 'p1', writeUnbindall: true })],
  [
    CONFIG_HANDLERS.setWriteCatalogDefaults,
    () => ({ profileId: 'p1', writeCatalogDefaults: true }),
  ],
  [
    CONFIG_HANDLERS.setSectionHeaderStyle,
    () => ({ profileId: 'p1', sectionHeaderStyle: 'dashes' }),
  ],
  [CONFIG_HANDLERS.save, () => ({ profileId: 'p1' })],
  [CONFIG_HANDLERS.commitCvars, () => ({ profileId: 'p1', cvars: { sensitivity: '5' } })],
  [CONFIG_HANDLERS.assign, () => ({ profileId: 'p1', installationId: 'i2' })],
  [CONFIG_HANDLERS.setDefault, () => ({ profileId: 'p1', installationId: 'i2' })],
  [CONFIG_HANDLERS.unassign, () => ({ profileId: 'p1', installationId: 'i2' })],
  [CONFIG_HANDLERS.write, () => ({ profileId: 'p1' })],
  [CONFIG_HANDLERS.rawFiles, () => ({ profileId: 'p1' })],
  [
    CONFIG_HANDLERS.saveRawText,
    (answers) => ({
      profileId: 'p1',
      text: unwrapOk<RawFilesResult>(answers[CONFIG_HANDLERS.rawFiles] as Outcome<RawFilesResult>)
        .canonical.content,
    }),
  ],
  [CONFIG_HANDLERS.refreshFromFiles, () => ({})],
  [CONFIG_HANDLERS.preview, () => ({ profileId: 'p1', installationId: 'i1' })],
  [CONFIG_HANDLERS.writeState, () => undefined],
  [CONFIG_HANDLERS.syncState, () => ({ profileId: 'p1' })],
  [CONFIG_HANDLERS.openFile, () => ({ profileId: 'p1', installationId: null, mode: 'open' })],
  [CONFIG_HANDLERS.setPlayedMods, () => ({ installationId: 'i1', playedMods: ['ctf'] })],
  [CONFIG_HANDLERS.switchBinds, () => undefined],
  [CONFIG_HANDLERS.setSwitchBind, () => ({ installationId: 'i1', key: null })],
  [CONFIG_HANDLERS.discard, () => ({ profileId: 'p1' })],
  [CONFIG_HANDLERS.importPickFiles, () => undefined],
  [CONFIG_HANDLERS.importPreviewFiles, (answers) => ({ fileIds: pickedIds(answers) })],
  [
    CONFIG_HANDLERS.importCommitFiles,
    (answers) => ({ fileIds: pickedIds(answers), name: 'Imported' }),
  ],
  [CONFIG_HANDLERS.cleanupScan, () => ({ installationId: 'i1' })],
  [CONFIG_HANDLERS.cleanupApply, () => ({ installationId: 'i1', entries: [] })],
  [CONFIG_HANDLERS.cleanupRestore, () => ({ installationId: 'i1', entries: [] })],
  [CONFIG_HANDLERS.tidyUpApply, () => ({ profileId: 'p1', ops: [] })],
  [
    CONFIG_HANDLERS.remove,
    (answers) => {
      const created = unwrapOk<ConfigProfile[]>(
        answers[CONFIG_HANDLERS.create] as Outcome<ConfigProfile[]>,
      )
      return { id: created.find((p) => p.name === 'Created')!.id }
    },
  ],
]

function pickedIds(answers: Answers): string[] {
  const picked = unwrapOk<{ id: string }[]>(
    answers[CONFIG_HANDLERS.importPickFiles] as Outcome<{ id: string }[]>,
  )
  return picked.map((file) => file.id)
}

const orphanAction: ConfigAction = {
  id: 'ab12cd34-0000-0000-0000-000000000000',
  categoryId: 'gone',
  name: 'Drop RL',
  kind: 'bind',
  commands: [{ kind: 'raw', text: 'drop rl' }],
}

describe('config module handlers', () => {
  it('registers every CONFIG_HANDLERS channel', async () => {
    const { handlers } = await boot()

    expect([...handlers.keys()].sort()).toEqual([...ALL_CHANNELS].sort())
  })

  it('rejects an invalid payload on every channel before the handler runs', async () => {
    const { handlers, state } = await boot()
    expect(Object.keys(INVALID_PAYLOADS).sort()).toEqual([...ALL_CHANNELS].sort())
    const before = structuredClone(configState(state).profiles.get())

    for (const channel of ALL_CHANNELS) {
      const result = await handlers.get(channel)!(INVALID_PAYLOADS[channel])
      expect(result, channel).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    }

    expect(configState(state).profiles.get()).toEqual(before)
    expect(shellMock.openPath).not.toHaveBeenCalled()
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('setActions refuses an action in a category the profile does not have', async () => {
    const { handlers, state } = await boot()
    const before = structuredClone(configState(state).profiles.get())

    const result = await handlers.get(CONFIG_HANDLERS.setActions)!({
      profileId: 'p1',
      categories: [{ id: 'weapons', name: 'Weapons' }],
      actions: [orphanAction],
    })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.unknownCategory' } })
    expect(configState(state).profiles.get()).toEqual(before)
  })

  it('setActions still saves a profile that already holds an orphaned entry', async () => {
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ categories: [], actions: [orphanAction] })])
    await state.settle()

    const result = await handlers.get(CONFIG_HANDLERS.setActions)!({
      profileId: 'p1',
      categories: [],
      actions: [{ ...orphanAction, name: 'Renamed' }],
    })

    expect(result).toMatchObject({ ok: true })
    expect(configState(state).profiles.get()[0]!.actions?.[0]?.name).toBe('Renamed')
  })

  it('every channel answers its happy path', async () => {
    const { handlers } = await boot()
    expect(HAPPY_PATHS.map(([channel]) => channel).sort()).toEqual([...ALL_CHANNELS].sort())
    const answers: Answers = {}

    for (const [channel, payload] of HAPPY_PATHS) {
      const result = (await handlers.get(channel)!(payload(answers))) as Outcome<unknown>
      expect(result, channel).toMatchObject({ ok: true })
      answers[channel] = result
    }
  })
})

/** The config main-side tests describe behaviour; a story number in a title is history, not behaviour. */
describe('config main-side test titles', () => {
  it('no config main-side describe names a story number', async () => {
    const root = join(__dirname)
    const offenders: string[] = []
    const walk = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (entry.name.endsWith('.test.ts')) {
          const text = await readFile(path, 'utf8')
          for (const match of text.matchAll(/describe\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
            if (/story \d/i.test(match[2]!)) offenders.push(`${relative(root, path)}: ${match[2]}`)
          }
        }
      }
    }
    await walk(root)

    expect(offenders).toEqual([])
  })
})
