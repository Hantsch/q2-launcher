import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONFIG_HANDLERS, type ConfigProfile, type TidyUpApplyResult } from '@shared/modules/config'
import { type Installation, type Outcome } from '@shared/types'
import { type AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { type ModuleHandler } from '../types'
import { renderProfileFile } from '@shared/config/render'
import { configModule } from './index'
import {
  collectHandlers,
  idleState,
  installation,
  log,
  profile,
  installConfigTestDir,
  userDataBox,
} from './index.test-helpers'
import { configState } from './persisted'
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

/**
 * Handler wiring only: payload validation and one happy path through the real module. The
 * once-per-batch and overwrite rules are pinned on the service in profile-writes.sync.test.ts.
 */
describe('CONFIG_HANDLERS.tidyUpApply handler', () => {
  async function bootTidyUp(
    seeded: ConfigProfile,
    insts: Installation[] = [],
  ): Promise<{
    handler: ModuleHandler
    handlers: Map<string, ModuleHandler>
    state: StateStore
    commits: () => number
  }> {
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    const handlers = new Map<string, ModuleHandler>()
    await configModule.setup({
      handle: collectHandlers(handlers),
      emit: () => {},
      onDispose: () => {},
      app: {
        installations: {
          find: (id: string) => insts.find((i) => i.id === id),
          list: () => insts,
        },
        launch: { getState: () => idleState() },
        state,
      } as unknown as AppContext,
      log,
    })
    seedConfigProfiles(state, [seeded])
    await state.settle()
    // Spied only *after* seeding, so the count is the handler's own commits.
    const spy = vi.spyOn(configState(state).profiles, 'update')
    return {
      handler: handlers.get(CONFIG_HANDLERS.tidyUpApply)!,
      handlers,
      state,
      commits: () => spy.mock.calls.length,
    }
  }

  const preservedLine = { file: 'config.cfg', line: 7, text: 'alias +test "echo hi"' }

  function messyProfile(): ConfigProfile {
    return profile({
      cvars: {},
      // Two spellings of one key - the duplicate-bind shape an import produces.
      // Deliberately non-catalogue commands, so `commit`'s own `adoptRawBinds`
      // pass has nothing to adopt and cannot muddy what this test asserts.
      binds: { MOUSE1: 'echo one', mouse1: 'echo two' },
      layers: [
        { id: 'l1', name: 'Empty', mode: 'hold', triggerKey: 'ALT', overrides: { '1': '  ' } },
      ],
      unrecognized: [preservedLine],
    })
  }

  it('applies a batch, bumps updatedAt exactly once, commits once and syncs once', async () => {
    const inst = installation()
    const seeded = messyProfile()
    const { handler, state, commits } = await bootTidyUp(seeded, [inst])

    const result = (await handler({
      profileId: 'p1',
      ops: [
        {
          kind: 'removeShadowedBind',
          scope: 'base',
          key: 'MOUSE1',
          claim: { source: 'baseBind', command: 'echo one' },
        },
        { kind: 'removeEmptyLayer', layerId: 'l1' },
        {
          kind: 'reclassifyPreservedLine',
          ...preservedLine,
          target: { field: 'cvars', name: 'sensitivity', value: '5' },
        },
      ],
    })) as Outcome<TidyUpApplyResult>

    if (!result.ok) throw new Error('expected tidyUp.apply to succeed')
    expect(result.value.applied).toHaveLength(3)
    expect(result.value.rejected).toEqual([])

    const updated = result.value.profile
    expect(updated.binds).toEqual({ mouse1: 'echo two' })
    expect(updated.layers).toEqual([])
    expect(updated.cvars).toEqual({ sensitivity: '5' })
    expect(updated.unrecognized).toEqual([])

    // One bump for the whole batch, and the value the handler returned is the
    // value that got persisted - not one of three intermediate ones.
    expect(updated.updatedAt).not.toBe(seeded.updatedAt)
    expect(configState(state).profiles.get()[0]!.updatedAt).toBe(updated.updatedAt)
    // Two commits: the batch itself is still exactly ONE content
    // commit (the `updatedAt` assertions right above are what that means), and the second is the
    // sync run seeding the profile's `fileHash` baseline from the bytes it just confirmed on disk -
    // bookkeeping about the file, which bumps no timestamp and changes no profile content.
    expect(commits()).toBe(2)

    // ...and the one sync run wrote the fully-tidied file to both places.
    const expected = renderProfileFile(updated)
    expect(await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(expected)
  })

  it('fails a malformed payload without touching the profile', async () => {
    const seeded = messyProfile()
    const { handler, commits } = await bootTidyUp(seeded)

    const badOp = (await handler({
      profileId: 'p1',
      ops: [{ kind: 'removeEmptyLayer' }],
    })) as Outcome<TidyUpApplyResult>
    const unknownKind = (await handler({
      profileId: 'p1',
      ops: [{ kind: 'reformatEverything' }],
    })) as Outcome<TidyUpApplyResult>
    const noProfile = (await handler({ ops: [] })) as Outcome<TidyUpApplyResult>

    for (const result of [badOp, unknownKind, noProfile]) {
      expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    }
    expect(commits()).toBe(0)
  })
})
