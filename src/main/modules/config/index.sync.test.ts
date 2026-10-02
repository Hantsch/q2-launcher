import { unwrapOk } from '../../../test-support/outcome'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type DiscardProfileResult,
  type ProfileSyncState,
  type WriteTargetResult,
} from '@shared/modules/config'
import { type Installation, type LaunchState, type Outcome } from '@shared/types'
import { pathExists } from '../../lib/fs-utils'
import { type AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { type ModuleHandler } from '../types'
import { renderProfileFile } from './render'
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
 * Story 022 D7's acceptance line: every mutating handler awaits the sync run
 * before returning (so the file is already on disk by the time the caller sees
 * the list), `setup()` retries persisted failures/pending writes once at start,
 * and `syncState` reports without ever writing.
 *
 * Boots `configModule.setup()` with the same duck-typed `app` + real
 * temp-file-backed `StateStore` pattern as the `preview` handler block above,
 * plus a `launch` (the sync run reads it) and the `electron` mock at the top of
 * this file for `userDataDir()`.
 */
describe('story 022 D7: on-disk sync wired into the config handlers', () => {
  async function boot(
    options: {
      installations?: Installation[]
      launchState?: LaunchState
      /** Runs before `setup()` - for the retry-sweep tests, which need state seeded first. */
      seed?: (state: StateStore) => void
    } = {},
  ): Promise<{ handlers: Map<string, ModuleHandler>; state: StateStore }> {
    const insts = options.installations ?? []
    const state = new StateStore(join(dir, 'state.json'))
    await state.load()
    options.seed?.(state)
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
        launch: { getState: () => options.launchState ?? idleState() },
        state,
      } as unknown as AppContext,
      log,
    })
    return { handlers, state }
  }

  it('create returns the unchanged profile list and the canonical file is already on disk', async () => {
    const { handlers } = await boot({ installations: [installation()] })

    const list = unwrapOk<ConfigProfile[]>(await handlers.get(CONFIG_HANDLERS.create)!({
      name: 'Fresh',
      from: 'empty',
    }))

    // Contract unchanged: still a plain `ConfigProfile[]`.
    expect(list).toHaveLength(1)
    const created = list[0]!
    expect(created.name).toBe('Fresh')
    // No extra await needed here - the handler awaited the sync itself.
    expect(await readFile(join(userDataBox.current, 'Fresh.cfg'), 'latin1')).toBe(
      renderProfileFile(created),
    )
  })

  it('creating a profile with no installation at all still produces the canonical file', async () => {
    const { handlers } = await boot()

    const list = unwrapOk<ConfigProfile[]>(await handlers.get(CONFIG_HANDLERS.create)!({
      name: 'Solo',
      from: 'empty',
    }))

    expect(list[0]!.assignments).toEqual([])
    expect(await readFile(join(userDataBox.current, 'Solo.cfg'), 'latin1')).toBe(
      renderProfileFile(list[0]!),
    )
  })

  it('setCvars persists the edit and marks the profile dirty, and writes no file at all (story 043 D4)', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    seedConfigProfiles(state, [profile()])
    await state.settle()

    const list = unwrapOk<ConfigProfile[]>(await handlers.get(CONFIG_HANDLERS.setCvars)!({
      profileId: 'p1',
      cvars: { sensitivity: '7' },
    }))

    // Story 022 decision 8, deliberately inverted by story 043 D4: the edit is in `state.json`
    // immediately (a crash must not lose it) and marked as not-yet-in-the-file, but nothing on disk
    // was touched - only `save` writes profile content now.
    expect(list.map((p) => p.id)).toEqual(['p1'])
    const updated = list.find((p) => p.id === 'p1')!
    expect(updated.cvars['sensitivity']).toBe('7')
    expect(updated.dirty).toBe(true)
    expect(configState(state).profiles.get()[0]!.cvars['sensitivity']).toBe('7')
    expect(configState(state).profiles.get()[0]!.dirty).toBe(true)
    expect(await pathExists(join(userDataBox.current, 'Profile.cfg'))).toBe(false)
    expect(await pathExists(join(dir, 'baseq2', 'Profile.cfg'))).toBe(false)
  })

  it('every content mutation marks the profile dirty and leaves an existing canonical file byte-identical (story 043 D4)', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    seedConfigProfiles(state, [profile()])
    await state.settle()
    // One save first, so there ARE files the mutations below could have clobbered.
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const canonical = join(userDataBox.current, 'Profile.cfg')
    const installationCopy = join(dir, 'baseq2', 'Profile.cfg')
    const saved = await readFile(canonical, 'latin1')
    const savedCopy = await readFile(installationCopy, 'latin1')

    const mutations: [string, unknown][] = [
      [CONFIG_HANDLERS.setCvars, { profileId: 'p1', cvars: { sensitivity: '11' } }],
      [CONFIG_HANDLERS.setBinds, { profileId: 'p1', binds: { x: '+attack' } }],
      [CONFIG_HANDLERS.setLayers, { profileId: 'p1', layers: [] }],
      [CONFIG_HANDLERS.setActions, { profileId: 'p1', categories: [], actions: [] }],
      [CONFIG_HANDLERS.setWriteUnbindall, { profileId: 'p1', writeUnbindall: false }],
      [CONFIG_HANDLERS.setWriteCatalogDefaults, { profileId: 'p1', writeCatalogDefaults: false }],
      [CONFIG_HANDLERS.setSectionHeaderStyle, { profileId: 'p1', sectionHeaderStyle: 'brackets' }],
      // `rename` last, and named `id` rather than `profileId`: it is the one whose file name would
      // move on disk, so it is also the one whose skipped write is most visible below.
      [CONFIG_HANDLERS.rename, { id: 'p1', name: 'Renamed' }],
    ]
    for (const [type, payload] of mutations) {
      // Each mutation is checked on its own: one handler still calling the sync engine would show
      // up here as a changed file, and nowhere else.
      const list = unwrapOk<ConfigProfile[]>(await handlers.get(type)!(payload))
      expect(list.find((p) => p.id === 'p1')!.dirty, `${type} marks the profile dirty`).toBe(true)
      expect(await readFile(canonical, 'latin1'), `${type} wrote no canonical file`).toBe(saved)
      expect(await readFile(installationCopy, 'latin1'), `${type} wrote no copy`).toBe(savedCopy)
      // Not even under the name a renamed profile now resolves to.
      expect(await pathExists(join(userDataBox.current, 'Renamed.cfg'))).toBe(false)
      expect(await pathExists(join(dir, 'baseq2', 'Renamed.cfg'))).toBe(false)
    }
  })

  it('discard restores the baseline and leaves both files byte-identical (story 049 D3)', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    seedConfigProfiles(state, [profile()])
    await state.settle()
    // The save is what seeds the baseline, and what puts the files there that a discard could clobber.
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const canonical = join(userDataBox.current, 'Profile.cfg')
    const installationCopy = join(dir, 'baseq2', 'Profile.cfg')
    const saved = await readFile(canonical, 'latin1')
    const savedCopy = await readFile(installationCopy, 'latin1')

    // Unsaved edits of three kinds, including the rename that a save would move the file for.
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '99' } })
    await handlers.get(CONFIG_HANDLERS.setBinds)!({ profileId: 'p1', binds: { x: '+attack' } })
    await handlers.get(CONFIG_HANDLERS.rename)!({ id: 'p1', name: 'Renamed' })

    const result = unwrapOk<DiscardProfileResult>(await handlers.get(CONFIG_HANDLERS.discard)!({
      profileId: 'p1',
    }))
    expect(result.status).toBe('discarded')
    if (result.status !== 'discarded') throw new Error('unreachable')

    // The returned profile is back at what the file on disk says...
    const restored = result.profiles.find((p) => p.id === 'p1')!
    expect(restored.cvars['sensitivity']).toBe('3')
    expect(restored.binds).toEqual({})
    expect(restored.name).toBe('Profile')
    expect(restored.dirty).toBe(false)
    expect(configState(state).profiles.get()[0]!.name).toBe('Profile')

    // ...and getting there wrote nothing: same bytes in both places, and no file under the name the
    // profile briefly had. Rendering the restored profile reproduces the file it never touched.
    expect(await readFile(canonical, 'latin1')).toBe(saved)
    expect(await readFile(installationCopy, 'latin1')).toBe(savedCopy)
    expect(renderProfileFile(restored)).toBe(saved)
    expect(await pathExists(join(userDataBox.current, 'Renamed.cfg'))).toBe(false)
    expect(await pathExists(join(dir, 'baseq2', 'Renamed.cfg'))).toBe(false)
  })

  /**
   * Story 054 D11: order is array position (story 019/052/053/059), and every reorder already
   * persists through the same `setActions`/`setCvars` handlers a rename or an edit does - so a pure
   * reorder (nothing about any row/section changed, only its array position) has to mark the profile
   * dirty exactly like the "every content mutation" case above, and Discard has to put the array back
   * the way it was, not just the fields a value-level diff would notice.
   *
   * The reordered arrays below are handed to `setActions`/`setCvars` directly rather than through
   * `entry-order.ts`/`cvar-sections.ts`'s `moveCategory`/`moveSubcategory`/`moveSectionToIndex`/
   * `moveSubsectionToIndex` helpers those stories added: this is a main-process test
   * (`tsconfig.node.json`), and those pure helpers live under `src/renderer` (`tsconfig.web.json`) -
   * out of reach here by the same module-boundary rule `docs/ARCHITECTURE.md` draws elsewhere. The
   * arrays constructed by hand are exactly what those helpers would produce (same ids, same content,
   * only the position swapped), and the helpers themselves are unit-tested against every one of these
   * moves in `entry-order.test.ts`/`cvar-sections.test.ts`.
   */
  it('story 054 D11: a pure reorder of categories/sub-categories/actions/cvar sections marks the profile dirty, and Discard restores the previous order', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })

    const categoryA = {
      id: 'cat-a',
      name: 'Alpha',
      subcategories: [
        { id: 'sub-1', name: 'One' },
        { id: 'sub-2', name: 'Two' },
      ],
    }
    const categoryB = { id: 'cat-b', name: 'Bravo' }
    const actionA1 = {
      id: 'a1',
      categoryId: 'cat-a',
      name: 'First',
      kind: 'bind' as const,
      commands: [{ kind: 'raw' as const, text: '+forward' }],
    }
    const actionA2 = {
      id: 'a2',
      categoryId: 'cat-a',
      name: 'Second',
      kind: 'bind' as const,
      commands: [{ kind: 'raw' as const, text: '+back' }],
    }
    const cvarSectionOne = {
      id: 'cvs-1',
      name: 'Player',
      cvars: [],
      subsections: [
        { id: 'cvsub-1', name: 'Movement', cvars: [] },
        { id: 'cvsub-2', name: 'Look', cvars: [] },
      ],
    }
    const cvarSectionTwo = { id: 'cvs-2', name: 'Network', cvars: [] }

    seedConfigProfiles(state, [
      profile({
        categories: [categoryA, categoryB],
        actions: [actionA1, actionA2],
        cvarSections: [cvarSectionOne, cvarSectionTwo],
      }),
    ])
    await state.settle()
    // The saved baseline Discard has to come back to.
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })

    // The reorder: category B moves before A, A's two sub-categories swap, the two actions swap -
    // no name, no id, no content anywhere changed, only array position (D2's `moveCategory`/
    // `moveSubcategory`/`moveEntryToPosition`).
    const reorderedCategoryA = {
      ...categoryA,
      subcategories: [categoryA.subcategories[1]!, categoryA.subcategories[0]!],
    }
    const actionsResult = unwrapOk<ConfigProfile[]>(await handlers.get(CONFIG_HANDLERS.setActions)!({
      profileId: 'p1',
      categories: [categoryB, reorderedCategoryA],
      actions: [actionA2, actionA1],
    }))
    const afterActionsReorder = actionsResult.find((p) => p.id === 'p1')!
    expect(afterActionsReorder.categories!.map((c) => c.id)).toEqual(['cat-b', 'cat-a'])
    expect(
      afterActionsReorder
        .categories!.find((c) => c.id === 'cat-a')!
        .subcategories!.map((s) => s.id),
    ).toEqual(['sub-2', 'sub-1'])
    expect(afterActionsReorder.actions!.map((a) => a.id)).toEqual(['a2', 'a1'])
    // AC1: the reorder alone already shows up as an unsaved change.
    expect(afterActionsReorder.dirty).toBe(true)

    // The cvar-section half of the same reorder: the two sections swap, and the one section's two
    // sub-sections swap too (D9's `moveSectionToIndex`/`moveSubsectionToIndex`).
    const reorderedCvarSectionOne = {
      ...cvarSectionOne,
      subsections: [cvarSectionOne.subsections[1]!, cvarSectionOne.subsections[0]!],
    }
    const cvarsResult = unwrapOk<ConfigProfile[]>(await handlers.get(CONFIG_HANDLERS.setCvars)!({
      profileId: 'p1',
      cvars: profile().cvars,
      cvarSections: [cvarSectionTwo, reorderedCvarSectionOne],
    }))
    const afterCvarsReorder = cvarsResult.find((p) => p.id === 'p1')!
    expect(afterCvarsReorder.cvarSections!.map((s) => s.id)).toEqual(['cvs-2', 'cvs-1'])
    expect(
      afterCvarsReorder.cvarSections!.find((s) => s.id === 'cvs-1')!.subsections!.map((s) => s.id),
    ).toEqual(['cvsub-2', 'cvsub-1'])
    expect(afterCvarsReorder.dirty).toBe(true)

    // AC2: Discard puts every one of those arrays back to the saved order - categories, the
    // sub-categories inside them, the actions array and the cvar sections/sub-sections alike.
    const discardResult = unwrapOk<DiscardProfileResult>(await handlers.get(CONFIG_HANDLERS.discard)!({
      profileId: 'p1',
    }))
    expect(discardResult.status).toBe('discarded')
    if (discardResult.status !== 'discarded') throw new Error('unreachable')
    const restored = discardResult.profiles.find((p) => p.id === 'p1')!
    expect(restored.dirty).toBe(false)
    expect(restored.categories!.map((c) => c.id)).toEqual(['cat-a', 'cat-b'])
    expect(
      restored.categories!.find((c) => c.id === 'cat-a')!.subcategories!.map((s) => s.id),
    ).toEqual(['sub-1', 'sub-2'])
    expect(restored.actions!.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(restored.cvarSections!.map((s) => s.id)).toEqual(['cvs-1', 'cvs-2'])
    expect(
      restored.cvarSections!.find((s) => s.id === 'cvs-1')!.subsections!.map((s) => s.id),
    ).toEqual(['cvsub-1', 'cvsub-2'])
  })

  it('setSectionHeaderStyle (story 042 D7) persists the new style, marks the profile dirty and writes nothing until a save', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    seedConfigProfiles(state, [profile()])
    await state.settle()

    const list = unwrapOk<ConfigProfile[]>(await handlers.get(CONFIG_HANDLERS.setSectionHeaderStyle)!({
      profileId: 'p1',
      sectionHeaderStyle: 'brackets',
    }))

    expect(list.map((p) => p.id)).toEqual(['p1'])
    const updated = list.find((p) => p.id === 'p1')!
    expect(updated.sectionHeaderStyle).toBe('brackets')
    // Story 043 D4: this setter is write-affecting (it changes what `renderProfileFile` emits), so
    // it is a content mutation and takes the same explicit-save route as `setCvars` - no file yet.
    expect(updated.dirty).toBe(true)
    expect(await pathExists(join(userDataBox.current, 'Profile.cfg'))).toBe(false)
    expect(await pathExists(join(dir, 'baseq2', 'Profile.cfg'))).toBe(false)

    // ...and the save that follows writes the NEW rendering to both places.
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const expected = renderProfileFile(updated)
    expect(await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(expected)
  })

  it("setWriteCatalogDefaults (story 059 D9) toggles whether an imported profile's rendered file carries a Defaults section, and survives reload", async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    // Story 059 decision: `cvarSections: []` is what an imported/empty-seeded profile looks like -
    // no real section places `sensitivity`, so it is the catalogue cvar `Defaults` either does or
    // does not pick up depending on the toggle.
    seedConfigProfiles(state, [profile({ cvarSections: [] })])
    await state.settle()

    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const onText = await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')
    expect(onText).toContain('Defaults')

    const toggledOff = unwrapOk<ConfigProfile[]>(await handlers.get(CONFIG_HANDLERS.setWriteCatalogDefaults)!({
      profileId: 'p1',
      writeCatalogDefaults: false,
    }))
    const updated = toggledOff.find((p) => p.id === 'p1')!
    expect(updated.writeCatalogDefaults).toBe(false)
    expect(updated.dirty).toBe(true)

    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const offText = await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')
    expect(offText).not.toContain('Defaults')

    // Toggling back on restores the section - the flag round-trips through state, not just render.
    const toggledOn = unwrapOk<ConfigProfile[]>(await handlers.get(CONFIG_HANDLERS.setWriteCatalogDefaults)!({
      profileId: 'p1',
      writeCatalogDefaults: true,
    }))
    expect(toggledOn.find((p) => p.id === 'p1')!.writeCatalogDefaults).toBe(true)
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    expect(await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')).toContain('Defaults')
  })

  it("setWriteCatalogDefaults (story 059 D9) is a no-op for a template profile's rendered file either way", async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    // The default `profile()` fixture carries `STANDARD_TEMPLATE.cvarSections`, which places every
    // catalogue cvar in a real section - nothing is ever unplaced, so `Defaults` never has anything
    // to hold regardless of the toggle (D1/D2's design).
    seedConfigProfiles(state, [profile()])
    await state.settle()

    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const onText = await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')
    expect(onText).not.toContain('Defaults')

    await handlers.get(CONFIG_HANDLERS.setWriteCatalogDefaults)!({
      profileId: 'p1',
      writeCatalogDefaults: false,
    })
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })
    const offText = await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')
    expect(offText).toBe(onText)
  })

  it('syncState reports inSync for both copies right after a save synced them', async () => {
    const inst = installation()
    const { handlers, state } = await boot({ installations: [inst] })
    seedConfigProfiles(state, [profile()])
    await state.settle()
    await handlers.get(CONFIG_HANDLERS.setCvars)!({ profileId: 'p1', cvars: { sensitivity: '7' } })
    // Story 043 D4: the mutation alone no longer syncs anything - the save does.
    await handlers.get(CONFIG_HANDLERS.save)!({ profileId: 'p1' })

    const result = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>

    if (!result.ok) throw new Error('expected syncState to succeed')
    expect(result.value.own.status).toBe('inSync')
    expect(result.value.own.fileName).toBe('Profile.cfg')
    expect(result.value.installations).toEqual([
      {
        installationId: 'i1',
        path: join(dir, 'baseq2', 'Profile.cfg'),
        fileName: 'Profile.cfg',
        status: 'inSync',
      },
    ])
  })

  it('setup() retries a persisted write failure once and clears it on success', async () => {
    const seeded = profile({ assignments: [] })
    const { state } = await boot({
      seed: (s) => {
        seedConfigProfiles(s, [seeded])
        configState(s).writeFailures.update(() => ({
          'p1|own': { messageKey: 'config.error.writeFailed', at: '2026-01-01T00:00:00.000Z' },
        }))
      },
    })

    expect(await readFile(join(userDataBox.current, 'Profile.cfg'), 'latin1')).toBe(
      renderProfileFile(seeded),
    )
    expect(configState(state).writeFailures.get()).toEqual({})
  })

  it('setup() skips stale bookkeeping for a profile that no longer exists, without throwing', async () => {
    const { state } = await boot({
      seed: (s) => {
        seedConfigProfiles(s, [])
        configState(s).writeFailures.update(() => ({
          'ghost|own': { messageKey: 'config.error.writeFailed', at: '2026-01-01T00:00:00.000Z' },
        }))
      },
    })

    // Resolved without throwing (getting here is the assertion) and the
    // dangling entries are simply left alone - cleaning them up is not D7's job.
    expect(configState(state).writeFailures.get()['ghost|own']).toBeDefined()
    expect(await pathExists(userDataBox.current)).toBe(false)
  })

  it('syncState fails with profileNotFound for an unknown id', async () => {
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ assignments: [] })])
    await state.settle()

    const result = await handlers.get(CONFIG_HANDLERS.syncState)!({ profileId: 'nope' })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
  })

  it('syncState is read-only: reports missing and creates nothing', async () => {
    const { handlers, state } = await boot()
    seedConfigProfiles(state, [profile({ assignments: [] })])
    await state.settle()
    const canonical = join(userDataBox.current, 'Profile.cfg')
    expect(await pathExists(canonical)).toBe(false)

    const result = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>

    if (!result.ok) throw new Error('expected syncState to succeed')
    expect(result.value.own.status).toBe('missing')
    expect(result.value.installations).toEqual([])
    // The regression this guards: someone rebuilding `syncState` on
    // `syncProfile`, which writes.
    expect(await pathExists(canonical)).toBe(false)
  })

  it('write retries through the new sync engine and clears a persisted failure on success', async () => {
    const inst = installation()
    const { handlers, state } = await boot({
      installations: [inst],
      seed: (s) => {
        seedConfigProfiles(s, [profile()])
        // Simulates a previous mutation's sync run having failed to write this
        // installation's copy (e.g. a locked directory that has since been
        // fixed) - before story 022 D7's write-handler fix, `write` never
        // touched `configWriteFailures` at all, so this entry would have
        // survived a successful retry forever and `syncState` would have kept
        // reporting `error` regardless of what was actually on disk.
        configState(s).writeFailures.update(() => ({
          'p1|i1': { messageKey: 'config.error.writeFailed', at: '2026-01-01T00:00:00.000Z' },
        }))
      },
    })

    const result = (await handlers.get(CONFIG_HANDLERS.write)!({
      profileId: 'p1',
    })) as Outcome<WriteTargetResult[]>

    if (!result.ok) throw new Error('expected write to succeed')
    expect(result.value).toEqual([{ installationId: 'i1', status: 'written' }])
    expect(configState(state).writeFailures.get()).toEqual({})

    const synced = (await handlers.get(CONFIG_HANDLERS.syncState)!({
      profileId: 'p1',
    })) as Outcome<ProfileSyncState>
    if (!synced.ok) throw new Error('expected syncState to succeed')
    expect(synced.value.installations).toEqual([
      {
        installationId: 'i1',
        path: join(dir, 'baseq2', 'Profile.cfg'),
        fileName: 'Profile.cfg',
        status: 'inSync',
      },
    ])
  })
})
