import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type ProfileSyncState,
  type SaveProfileResult,
  type TidyUpApplyResult,
} from '@shared/modules/config'
import { type Installation, type Outcome } from '@shared/types'
import { pathExists } from '../../lib/fs-utils'
import { type AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { type ModuleHandler } from '../types'
import { scanRedundantCopies } from './cleanup'
import { hashCanonicalFileContent } from './file-source'
import { renderProfileFile } from './render'
import { applyCleanupIfNotRunning, configModule, restoreCleanupIfNotRunning } from './index'
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
 * Story 010 D3's own acceptance line: "a test drives scan -> apply -> restore
 * against a temp installation and a faked running launch state makes apply
 * fail without touching disk." `scanRedundantCopies`/`removeRedundantCopies`/
 * `restoreRemovedCopies` themselves are already covered against a real temp
 * tree in `cleanup.test.ts` (D1/D2) - what is uniquely D3's to prove is the
 * running-guard `applyCleanupIfNotRunning`/`restoreCleanupIfNotRunning` add on
 * top, and that `scan` has no such guard at all (decision 12).
 */
describe('applyCleanupIfNotRunning / restoreCleanupIfNotRunning', () => {
  const HAND_WRITTEN = 'bind mouse2 "+attack"\nset name "player"\n'

  async function seed(relativePath: string, content: string): Promise<void> {
    const target = join(dir, relativePath)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'latin1')
  }

  async function seedRedundantHud(): Promise<Installation> {
    await seed('baseq2/hud.cfg', HAND_WRITTEN)
    await seed('ctf/hud.cfg', HAND_WRITTEN)
    return installation({ gameDirs: ['baseq2', 'ctf'] })
  }

  it('drives scan -> apply -> restore end to end while idle', async () => {
    const inst = await seedRedundantHud()

    const findings = await scanRedundantCopies(inst)
    expect(findings).toEqual([
      { gameDir: 'ctf', fileName: 'hud.cfg', identical: true, size: HAND_WRITTEN.length },
    ])

    const applyResult = await applyCleanupIfNotRunning(inst, findings, idleState())
    expect(applyResult).toEqual({
      ok: true,
      value: { removed: [{ gameDir: 'ctf', fileName: 'hud.cfg' }], rejected: [] },
    })
    expect(await pathExists(join(dir, 'ctf', 'hud.cfg'))).toBe(false)
    expect(await readFile(join(dir, 'ctf', 'hud.cfg.q2l-backup'), 'latin1')).toBe(HAND_WRITTEN)

    const restoreResult = await restoreCleanupIfNotRunning(
      inst,
      applyResult.ok ? applyResult.value.removed : [],
      idleState(),
    )
    expect(restoreResult).toEqual({
      ok: true,
      value: { restored: [{ gameDir: 'ctf', fileName: 'hud.cfg' }], rejected: [] },
    })
    expect(await readFile(join(dir, 'ctf', 'hud.cfg'), 'latin1')).toBe(HAND_WRITTEN)
  })

  it('refuses apply on a running installation and touches no files', async () => {
    const inst = await seedRedundantHud()
    const findings = await scanRedundantCopies(inst)

    const result = await applyCleanupIfNotRunning(inst, findings, runningState(inst.id))

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationRunning' } })
    expect(await readFile(join(dir, 'ctf', 'hud.cfg'), 'latin1')).toBe(HAND_WRITTEN)
    expect(await pathExists(join(dir, 'ctf', 'hud.cfg.q2l-backup'))).toBe(false)
  })

  it('refuses restore on a running installation and touches no files', async () => {
    const inst = await seedRedundantHud()
    const findings = await scanRedundantCopies(inst)
    const applyResult = await applyCleanupIfNotRunning(inst, findings, idleState())
    const removed = applyResult.ok ? applyResult.value.removed : []

    const result = await restoreCleanupIfNotRunning(inst, removed, runningState(inst.id))

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationRunning' } })
    // Still deleted from the earlier (idle) apply, not restored by this call.
    expect(await pathExists(join(dir, 'ctf', 'hud.cfg'))).toBe(false)
  })

  it('scan is never gated by a running installation (decision 12)', async () => {
    const inst = await seedRedundantHud()

    // scanRedundantCopies takes no launchState at all - there is nothing to
    // gate. This test's own existence is the assertion: a running-guard
    // added to scan by mistake would need a `launchState` parameter that
    // does not exist on this function's signature, which would fail to
    // compile, not just fail at runtime.
    const findings = await scanRedundantCopies(inst)

    expect(findings).toEqual([
      { gameDir: 'ctf', fileName: 'hud.cfg', identical: true, size: HAND_WRITTEN.length },
    ])
  })
})

/**
 * Story 025 D3: `tidyUp.apply` - the module's one non-setter mutating handler.
 * Its acceptance is about the *once* guarantees, which only exist at this level
 * and not in the pure applier (`@shared/config/tidy-up`, covered by its own
 * unit tests): one `updatedAt` bump, one commit and one sync run for a whole
 * batch, and none of the three when nothing applied.
 *
 * Same duck-typed `app` + real temp-file-backed `StateStore` boot as the blocks
 * above, plus a `launch` (the sync run reads it).
 */
describe('CONFIG_HANDLERS.tidyUpApply handler (story 025 D3)', () => {
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
    state.setConfigProfiles([seeded])
    await state.settle()
    // Spied only *after* seeding, so the count is the handler's own commits.
    const spy = vi.spyOn(state, 'setConfigProfiles')
    return {
      handler: handlers.get(CONFIG_HANDLERS.tidyUpApply)!,
      handlers,
      state,
      commits: () => spy.mock.calls.length,
    }
  }

  const tidyUpCanonicalPath = (fileName: string): string => join(userDataBox.current, fileName)
  const tidyUpCopyPath = (fileName: string): string => join(dir, 'baseq2', fileName)

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
    expect(state.configProfiles()[0]!.updatedAt).toBe(updated.updatedAt)
    // Two commits, not one, since story 043 D4: the batch itself is still exactly ONE content
    // commit (the `updatedAt` assertions right above are what that means), and the second is the
    // sync run seeding the profile's `fileHash` baseline from the bytes it just confirmed on disk -
    // bookkeeping about the file, which bumps no timestamp and changes no profile content.
    expect(commits()).toBe(2)

    // ...and the one sync run wrote the fully-tidied file to both places.
    const expected = renderProfileFile(updated)
    expect(await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(expected)
  })

  /**
   * Story 079 review (finding 1): the regression the story's own review caught. Unlike the test
   * above, this one seeds a REAL canonical file (and installation copy) through an actual `save`
   * first - the shape every real profile is in by the time a user opens Tidy-up (clean, canonical
   * file present, `fileHash` set). Before the fix, `tidyUpApply`'s `syncAndPersist` call carried no
   * `overwriteProfileId`, so `canonicalWriteAllowed`'s general rule refused the write (the tidied
   * render no longer equals the file `save` last wrote), the canonical file kept the shadowed bind,
   * and the installation copy was republished from those same stale bytes - the tidied state lived
   * only in `state.json`, with no Save button to flush it.
   */
  it('rewrites a seeded canonical file and its installation copies (finding 1 regression)', async () => {
    const inst = installation()
    const seeded = messyProfile()
    const { handler, handlers, state } = await bootTidyUp(seeded, [inst])

    const saved = (await handlers.get(CONFIG_HANDLERS.save)!({
      profileId: 'p1',
    })) as Outcome<SaveProfileResult>
    if (!saved.ok) throw new Error('expected the seeding save to succeed')
    const seededCanonical = await readFile(tidyUpCanonicalPath('Profile.cfg'), 'latin1')
    expect(seededCanonical).toContain('MOUSE1')
    expect(await readFile(tidyUpCopyPath('Profile.cfg'), 'latin1')).toBe(seededCanonical)

    const result = (await handler({
      profileId: 'p1',
      ops: [
        {
          kind: 'removeShadowedBind',
          scope: 'base',
          key: 'MOUSE1',
          claim: { source: 'baseBind', command: 'echo one' },
        },
      ],
    })) as Outcome<TidyUpApplyResult>

    if (!result.ok) throw new Error('expected tidyUp.apply to succeed')
    const updated = result.value.profile
    expect(updated.binds).toEqual({ mouse1: 'echo two' })

    const expected = renderProfileFile(updated)
    const canonicalAfter = await readFile(tidyUpCanonicalPath('Profile.cfg'), 'latin1')
    expect(canonicalAfter).toBe(expected)
    expect(canonicalAfter).not.toContain('MOUSE1')
    expect(await readFile(tidyUpCopyPath('Profile.cfg'), 'latin1')).toBe(canonicalAfter)
    expect(state.configProfiles()[0]!.fileHash).toBe(hashCanonicalFileContent(expected))

    const synced = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!synced.ok) throw new Error('expected syncState to succeed')
    expect(synced.value.own.status).toBe('inSync')
    expect(synced.value.installations[0]!.status).toBe('inSync')
  })

  /**
   * Story 079 review (finding 1), the other half: a canonical file that moved underneath the
   * launcher between the seeding save and the tidy-up (a hand-edit `refreshFromFiles` has not yet
   * re-read) must not be silently overwritten by the tidy-up's render, just as `save` itself would
   * refuse it - `TidyUpApplyResult` has no conflict shape to report that through, so the decision
   * here is: the tidy-up still commits to `state.json` (nothing the user just did is lost) and the
   * installation copy is left alone too (`sync.ts`'s D2 rule: a moved-underneath canonical file is
   * not a source to publish from either), but the canonical file itself keeps the hand-edited bytes.
   */
  it('leaves a canonical file that moved underneath untouched, but still commits the tidy-up', async () => {
    const inst = installation()
    const seeded = messyProfile()
    const { handler, handlers, state } = await bootTidyUp(seeded, [inst])

    const saved = (await handlers.get(CONFIG_HANDLERS.save)!({
      profileId: 'p1',
    })) as Outcome<SaveProfileResult>
    if (!saved.ok) throw new Error('expected the seeding save to succeed')

    // An outside edit the launcher has not read - the ownership banner is kept intact (only
    // appended after), so the file is still recognised as this profile's own.
    const handEdited = `${await readFile(tidyUpCanonicalPath('Profile.cfg'), 'latin1')}set q2l_hand "1"\n`
    await writeFile(tidyUpCanonicalPath('Profile.cfg'), handEdited, 'latin1')
    const copyBefore = await readFile(tidyUpCopyPath('Profile.cfg'), 'latin1')

    const result = (await handler({
      profileId: 'p1',
      ops: [
        {
          kind: 'removeShadowedBind',
          scope: 'base',
          key: 'MOUSE1',
          claim: { source: 'baseBind', command: 'echo one' },
        },
      ],
    })) as Outcome<TidyUpApplyResult>

    if (!result.ok) throw new Error('expected tidyUp.apply to succeed')
    // The mutation is still committed - the tidy-up itself is never lost.
    expect(result.value.profile.binds).toEqual({ mouse1: 'echo two' })
    expect(state.configProfiles()[0]!.binds).toEqual({ mouse1: 'echo two' })

    // But the canonical file, having moved underneath, keeps the hand-edited bytes verbatim.
    expect(await readFile(tidyUpCanonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    // And the installation copy, whose only valid source is a canonical file the launcher has
    // confirmed by reading, is left exactly as it was rather than republished from stale bytes.
    expect(await readFile(tidyUpCopyPath('Profile.cfg'), 'latin1')).toBe(copyBefore)

    const synced = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!synced.ok) throw new Error('expected syncState to succeed')
    expect(synced.value.own.status).toBe('outOfSync')
  })

  it('rejects a stale op without bumping updatedAt, committing or syncing', async () => {
    const inst = installation()
    const seeded = messyProfile()
    const { handler, state, commits } = await bootTidyUp(seeded, [inst])

    const stale = { kind: 'removeEmptyLayer' as const, layerId: 'never-existed' }
    const result = (await handler({ profileId: 'p1', ops: [stale] })) as Outcome<TidyUpApplyResult>

    if (!result.ok) throw new Error('expected tidyUp.apply to succeed')
    expect(result.value.applied).toEqual([])
    expect(result.value.rejected).toEqual([stale])
    expect(result.value.profile.updatedAt).toBe(seeded.updatedAt)
    expect(result.value.profile.layers).toHaveLength(1)
    expect(state.configProfiles()[0]!.updatedAt).toBe(seeded.updatedAt)
    expect(commits()).toBe(0)
    // Nothing changed, so nothing was written - not even the canonical copy.
    expect(await pathExists(join(userDataBox.current, 'Profile.cfg'))).toBe(false)
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

  it('fails an unknown profile id', async () => {
    const { handler } = await bootTidyUp(messyProfile())

    const result = (await handler({ profileId: 'nope', ops: [] })) as Outcome<TidyUpApplyResult>

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
  })
})
