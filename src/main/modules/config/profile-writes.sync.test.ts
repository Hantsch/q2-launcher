import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ConfigProfile,
  CreateConfigProfileInput,
  DiscardProfileResult,
  SaveProfileResult,
  SaveRawTextResult,
  TidyUpApplyResult,
} from '@shared/modules/config'
import type { TidyUpOp } from '@shared/config/profile/tidy-up'
import type { Outcome } from '@shared/types'
import { renderProfileFile } from '@shared/config/render/render'
import { pathExists } from '../../lib/fs-utils'
import { seedConfigProfiles } from '../../../test-support/config-state'
import { unwrapOk } from '../../../test-support/outcome'
import { installTempDir } from '../../../test-support/temp-dir'
import { hashCanonicalFileContent } from './file-source'
import { installation, profile } from './index.test-helpers'
import { configState } from './persisted'
import {
  markUnsaved,
  profileRecord,
  writesHarness,
  type WritesHarness,
} from './profile-writes.test-helpers'
import { writeTargetFile } from './writer'

// The sync engine writes the canonical file through `writer.ts` directly, so holding or failing
// that write mid-run (the overlapping-runs test) needs the module's own export wrapped. It
// delegates to the real writer unless a test overrides it.
vi.mock('./writer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./writer')>()
  return { ...actual, writeTargetFile: vi.fn(actual.writeTargetFile) }
})

const getDir = installTempDir('q2-launcher-profile-writes-sync-')
let dir: string
beforeEach(() => {
  dir = getDir()
})

const canonicalPath = (fileName: string): string => join(dir, 'userData', fileName)
const copyPath = (fileName: string): string => join(dir, 'baseq2', fileName)

/** What the `create` handler does: the store call, then the sync tail of the service. */
async function createProfile(
  h: WritesHarness,
  input: CreateConfigProfileInput,
): Promise<ConfigProfile[]> {
  return unwrapOk<ConfigProfile[]>(await h.writes.syncAppended(h.profiles.create(input)))
}

/** What the `setCvars` handler does: persist the edit, then mark the profile unsaved. */
function editCvars(h: WritesHarness, cvars: Record<string, string>): void {
  h.profiles.setCvars({ profileId: 'p1', cvars })
  markUnsaved(h)
}

/** What the `rename` handler does: rename, then mark the profile unsaved. */
function rename(h: WritesHarness, name: string): ConfigProfile[] {
  h.profiles.rename({ id: 'p1', name })
  return markUnsaved(h)
}

/** What the `discard` handler answers: the restored list, or `noBaseline`. */
function discard(h: WritesHarness): DiscardProfileResult {
  const outcome = h.profiles.discard('p1')
  return outcome.outcome === 'noBaseline'
    ? { status: 'noBaseline' }
    : { status: 'discarded', profiles: outcome.profiles }
}

async function save(h: WritesHarness, profileId = 'p1'): Promise<Outcome<SaveProfileResult>> {
  return h.writes.save({ profileId })
}

async function seeded(
  profiles: ConfigProfile[],
  options: Parameters<typeof writesHarness>[1] = {},
): Promise<WritesHarness> {
  const h = await writesHarness(dir, options)
  seedConfigProfiles(h.state, profiles)
  await h.state.settle()
  return h
}

/**
 * Every operation that syncs awaits the sync run before returning (so the file is already on disk
 * by the time the caller sees the list), and the sync state reports without ever writing.
 */
describe('sync after a profile mutation', () => {
  it('create returns the unchanged profile list and the canonical file is already on disk', async () => {
    const h = await writesHarness(dir, { installations: [installation({ rootPath: dir })] })

    const list = await createProfile(h, { name: 'Fresh', from: 'empty' })

    // Contract unchanged: still a plain `ConfigProfile[]`.
    expect(list).toHaveLength(1)
    const created = list[0]!
    expect(created.name).toBe('Fresh')
    // No extra await needed here - the sync was awaited itself.
    expect(await readFile(canonicalPath('Fresh.cfg'), 'latin1')).toBe(renderProfileFile(created))
  })

  it('creating a profile with no installation at all still produces the canonical file', async () => {
    const h = await writesHarness(dir)

    const list = await createProfile(h, { name: 'Solo', from: 'empty' })

    expect(list[0]!.assignments).toEqual([])
    expect(await readFile(canonicalPath('Solo.cfg'), 'latin1')).toBe(renderProfileFile(list[0]!))
  })

  it('setCvars persists the edit and marks the profile dirty, and writes no file at all', async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })

    h.profiles.setCvars({ profileId: 'p1', cvars: { sensitivity: '7' } })
    const list = markUnsaved(h)

    // The edit is in `state.json` immediately (a crash must not lose it) and marked as
    // not-yet-in-the-file, but nothing on disk was touched - only `save` writes profile content.
    expect(list.map((p) => p.id)).toEqual(['p1'])
    const updated = list.find((p) => p.id === 'p1')!
    expect(updated.cvars['sensitivity']).toBe('7')
    expect(updated.dirty).toBe(true)
    expect(configState(h.state).profiles.get()[0]!.cvars['sensitivity']).toBe('7')
    expect(configState(h.state).profiles.get()[0]!.dirty).toBe(true)
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
    expect(await pathExists(copyPath('Profile.cfg'))).toBe(false)
  })

  it('every content mutation marks the profile dirty and leaves an existing canonical file byte-identical', async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    // One save first, so there ARE files the mutations below could have clobbered.
    await save(h)
    const saved = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    const savedCopy = await readFile(copyPath('Profile.cfg'), 'latin1')

    const mutations: [string, () => void][] = [
      [
        'setCvars',
        () => void h.profiles.setCvars({ profileId: 'p1', cvars: { sensitivity: '11' } }),
      ],
      ['setBinds', () => void h.profiles.setBinds({ profileId: 'p1', binds: { x: '+attack' } })],
      ['setLayers', () => void h.profiles.setLayers({ profileId: 'p1', layers: [] })],
      [
        'setActions',
        () => void h.profiles.setActions({ profileId: 'p1', categories: [], actions: [] }),
      ],
      [
        'setWriteUnbindall',
        () => void h.profiles.setWriteUnbindall({ profileId: 'p1', writeUnbindall: false }),
      ],
      [
        'setWriteCatalogDefaults',
        () =>
          void h.profiles.setWriteCatalogDefaults({ profileId: 'p1', writeCatalogDefaults: false }),
      ],
      [
        'setSectionHeaderStyle',
        () =>
          void h.profiles.setSectionHeaderStyle({
            profileId: 'p1',
            sectionHeaderStyle: 'brackets',
          }),
      ],
      // `rename` last: it is the one whose file name would move on disk, so it is also the one
      // whose skipped write is most visible below.
      ['rename', () => void h.profiles.rename({ id: 'p1', name: 'Renamed' })],
    ]
    for (const [type, mutate] of mutations) {
      // Each mutation is checked on its own: one still calling the sync engine would show up here
      // as a changed file, and nowhere else.
      mutate()
      const list = markUnsaved(h)
      expect(list.find((p) => p.id === 'p1')!.dirty, `${type} marks the profile dirty`).toBe(true)
      expect(
        await readFile(canonicalPath('Profile.cfg'), 'latin1'),
        `${type} wrote no canonical file`,
      ).toBe(saved)
      expect(await readFile(copyPath('Profile.cfg'), 'latin1'), `${type} wrote no copy`).toBe(
        savedCopy,
      )
      // Not even under the name a renamed profile now resolves to.
      expect(await pathExists(canonicalPath('Renamed.cfg'))).toBe(false)
      expect(await pathExists(copyPath('Renamed.cfg'))).toBe(false)
    }
  })

  it('discard restores the baseline and leaves both files byte-identical', async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    // The save is what seeds the baseline, and what puts the files there that a discard could clobber.
    await save(h)
    const saved = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    const savedCopy = await readFile(copyPath('Profile.cfg'), 'latin1')

    // Unsaved edits of three kinds, including the rename that a save would move the file for.
    editCvars(h, { sensitivity: '99' })
    h.profiles.setBinds({ profileId: 'p1', binds: { x: '+attack' } })
    markUnsaved(h)
    rename(h, 'Renamed')

    const result = discard(h)
    expect(result.status).toBe('discarded')
    if (result.status !== 'discarded') throw new Error('unreachable')

    // The returned profile is back at what the file on disk says...
    const restored = result.profiles.find((p) => p.id === 'p1')!
    expect(restored.cvars['sensitivity']).toBe('3')
    expect(restored.binds).toEqual({})
    expect(restored.name).toBe('Profile')
    expect(restored.dirty).toBe(false)
    expect(configState(h.state).profiles.get()[0]!.name).toBe('Profile')

    // ...and getting there wrote nothing: same bytes in both places, and no file under the name the
    // profile briefly had. Rendering the restored profile reproduces the file it never touched.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(saved)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedCopy)
    expect(renderProfileFile(restored)).toBe(saved)
    expect(await pathExists(canonicalPath('Renamed.cfg'))).toBe(false)
    expect(await pathExists(copyPath('Renamed.cfg'))).toBe(false)
  })

  /**
   * Order is array position, and every reorder persists through the same `setActions`/`setCvars`
   * store calls a rename or an edit does - so a pure reorder (nothing about any row/section
   * changed, only its array position) has to mark the profile dirty exactly like the "every content
   * mutation" case above, and Discard has to put the array back the way it was, not just the fields
   * a value-level diff would notice.
   *
   * The reordered arrays below are handed to the store directly rather than through the renderer's
   * move helpers: this is a main-process test (`tsconfig.node.json`) and those pure helpers live
   * under `src/renderer` (`tsconfig.web.json`) - out of reach by the module-boundary rule. The
   * arrays constructed by hand are exactly what those helpers would produce (same ids, same
   * content, only the position swapped).
   */
  it('a pure reorder of categories/sub-categories/actions/cvar sections marks the profile dirty, and Discard restores the previous order', async () => {
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

    const h = await seeded(
      [
        profile({
          categories: [categoryA, categoryB],
          actions: [actionA1, actionA2],
          cvarSections: [cvarSectionOne, cvarSectionTwo],
        }),
      ],
      { installations: [installation({ rootPath: dir })] },
    )
    // The saved baseline Discard has to come back to.
    await save(h)

    // The reorder: category B moves before A, A's two sub-categories swap, the two actions swap -
    // no name, no id, no content anywhere changed, only array position.
    const reorderedCategoryA = {
      ...categoryA,
      subcategories: [categoryA.subcategories[1]!, categoryA.subcategories[0]!],
    }
    h.profiles.setActions({
      profileId: 'p1',
      categories: [categoryB, reorderedCategoryA],
      actions: [actionA2, actionA1],
    })
    const afterActionsReorder = markUnsaved(h).find((p) => p.id === 'p1')!
    expect(afterActionsReorder.categories!.map((c) => c.id)).toEqual(['cat-b', 'cat-a'])
    expect(
      afterActionsReorder
        .categories!.find((c) => c.id === 'cat-a')!
        .subcategories!.map((s) => s.id),
    ).toEqual(['sub-2', 'sub-1'])
    expect(afterActionsReorder.actions!.map((a) => a.id)).toEqual(['a2', 'a1'])
    // The reorder alone already shows up as an unsaved change.
    expect(afterActionsReorder.dirty).toBe(true)

    // The cvar-section half of the same reorder: the two sections swap, and the one section's two
    // sub-sections swap too.
    const reorderedCvarSectionOne = {
      ...cvarSectionOne,
      subsections: [cvarSectionOne.subsections[1]!, cvarSectionOne.subsections[0]!],
    }
    h.profiles.setCvars({
      profileId: 'p1',
      cvars: profile().cvars,
      cvarSections: [cvarSectionTwo, reorderedCvarSectionOne],
    })
    const afterCvarsReorder = markUnsaved(h).find((p) => p.id === 'p1')!
    expect(afterCvarsReorder.cvarSections!.map((s) => s.id)).toEqual(['cvs-2', 'cvs-1'])
    expect(
      afterCvarsReorder.cvarSections!.find((s) => s.id === 'cvs-1')!.subsections!.map((s) => s.id),
    ).toEqual(['cvsub-2', 'cvsub-1'])
    expect(afterCvarsReorder.dirty).toBe(true)

    // Discard puts every one of those arrays back to the saved order - categories, the
    // sub-categories inside them, the actions array and the cvar sections/sub-sections alike.
    const discardResult = discard(h)
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

  it('setSectionHeaderStyle persists the new style, marks the profile dirty and writes nothing until a save', async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })

    h.profiles.setSectionHeaderStyle({ profileId: 'p1', sectionHeaderStyle: 'brackets' })
    const list = markUnsaved(h)

    expect(list.map((p) => p.id)).toEqual(['p1'])
    const updated = list.find((p) => p.id === 'p1')!
    expect(updated.sectionHeaderStyle).toBe('brackets')
    // This setter is write-affecting (it changes what `renderProfileFile` emits), so it is a
    // content mutation and takes the same explicit-save route as `setCvars` - no file yet.
    expect(updated.dirty).toBe(true)
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
    expect(await pathExists(copyPath('Profile.cfg'))).toBe(false)

    // ...and the save that follows writes the NEW rendering to both places.
    await save(h)
    const expected = renderProfileFile(updated)
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(expected)
  })

  it("setWriteCatalogDefaults toggles whether an imported profile's rendered file carries a Defaults section, and survives reload", async () => {
    // `cvarSections: []` is what an imported/empty-seeded profile looks like - no real section
    // places `sensitivity`, so it is the catalogue cvar `Defaults` either does or does not pick up
    // depending on the toggle.
    const h = await seeded([profile({ cvarSections: [] })], {
      installations: [installation({ rootPath: dir })],
    })

    await save(h)
    const onText = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(onText).toContain('Defaults')

    h.profiles.setWriteCatalogDefaults({ profileId: 'p1', writeCatalogDefaults: false })
    const toggledOff = markUnsaved(h)
    const updated = toggledOff.find((p) => p.id === 'p1')!
    expect(updated.writeCatalogDefaults).toBe(false)
    expect(updated.dirty).toBe(true)

    await save(h)
    const offText = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(offText).not.toContain('Defaults')

    // Toggling back on restores the section - the flag round-trips through state, not just render.
    h.profiles.setWriteCatalogDefaults({ profileId: 'p1', writeCatalogDefaults: true })
    const toggledOn = markUnsaved(h)
    expect(toggledOn.find((p) => p.id === 'p1')!.writeCatalogDefaults).toBe(true)
    await save(h)
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toContain('Defaults')
  })

  it("setWriteCatalogDefaults is a no-op for a template profile's rendered file either way", async () => {
    // The default `profile()` fixture carries `STANDARD_TEMPLATE.cvarSections`, which places every
    // catalogue cvar in a real section - nothing is ever unplaced, so `Defaults` never has anything
    // to hold regardless of the toggle.
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })

    await save(h)
    const onText = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(onText).not.toContain('Defaults')

    h.profiles.setWriteCatalogDefaults({ profileId: 'p1', writeCatalogDefaults: false })
    markUnsaved(h)
    await save(h)
    const offText = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(offText).toBe(onText)
  })

  it('syncState reports inSync for both copies right after a save synced them', async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    editCvars(h, { sensitivity: '7' })
    // The mutation alone no longer syncs anything - the save does.
    await save(h)

    const result = await h.writes.syncState({ profileId: 'p1' })

    if (!result.ok) throw new Error('expected syncState to succeed')
    expect(result.value.own.status).toBe('inSync')
    expect(result.value.own.fileName).toBe('Profile.cfg')
    expect(result.value.installations).toEqual([
      {
        installationId: 'i1',
        path: copyPath('Profile.cfg'),
        fileName: 'Profile.cfg',
        status: 'inSync',
      },
    ])
  })

  it('syncState fails with profileNotFound for an unknown id', async () => {
    const h = await seeded([profile({ assignments: [] })])

    const result = await h.writes.syncState({ profileId: 'nope' })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
  })

  it('syncState is read-only: reports missing and creates nothing', async () => {
    const h = await seeded([profile({ assignments: [] })])
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)

    const result = await h.writes.syncState({ profileId: 'p1' })

    if (!result.ok) throw new Error('expected syncState to succeed')
    expect(result.value.own.status).toBe('missing')
    expect(result.value.installations).toEqual([])
    // The regression this guards: someone rebuilding `syncState` on `syncProfile`, which writes.
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
  })

  it('write retries through the sync engine and clears a persisted failure on success', async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    // Simulates a previous mutation's sync run having failed to write this installation's copy
    // (e.g. a locked directory that has since been fixed) - without the retry clearing it,
    // `syncState` would keep reporting `error` regardless of what is actually on disk.
    configState(h.state).writeFailures.update(() => ({
      'p1|i1': { messageKey: 'config.error.writeFailed', at: '2026-01-01T00:00:00.000Z' },
    }))

    const result = await h.writes.write({ profileId: 'p1' })

    if (!result.ok) throw new Error('expected write to succeed')
    expect(result.value).toEqual([{ installationId: 'i1', status: 'written' }])
    expect(configState(h.state).writeFailures.get()).toEqual({})

    const synced = await h.writes.syncState({ profileId: 'p1' })
    if (!synced.ok) throw new Error('expected syncState to succeed')
    expect(synced.value.installations).toEqual([
      {
        installationId: 'i1',
        path: copyPath('Profile.cfg'),
        fileName: 'Profile.cfg',
        status: 'inSync',
      },
    ])
  })
})

/**
 * Assignment changes and retries are not saves: they sync immediately, but a profile's unsaved
 * edits never reach disk through them. Everything is asserted on the real temp-dir bytes.
 */
describe('sync triggers that are not a save', () => {
  function only(h: WritesHarness, profileId = 'p1'): ConfigProfile {
    return profileRecord(h, profileId)
  }

  it('assign of a DIRTY profile writes the installation from the canonical FILE, never from the unsaved edits', async () => {
    const h = await seeded([profile({ assignments: [] })], {
      installations: [installation({ rootPath: dir })],
    })
    await save(h)
    const savedFile = await readFile(canonicalPath('Profile.cfg'), 'latin1')

    // Unsaved edit, then an operation that is NOT a save but does sync (assignment relationships
    // are not profile content, so it still syncs immediately).
    editCvars(h, { sensitivity: '99' })
    const unsavedRender = renderProfileFile(only(h))
    expect(unsavedRender).not.toBe(savedFile)

    const assigned = await h.writes.assign({ profileId: 'p1', installationId: 'i1' })
    if (!assigned.ok) throw new Error('expected assign to succeed')

    // The canonical file is untouched...
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    // ...and the installation - the copy the engine actually loads - got the FILE's content, not
    // the unsaved edit.
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).not.toBe(unsavedRender)
    expect(only(h).dirty).toBe(true)
    // The loader still went out, so the installation is usable.
    expect(await pathExists(copyPath('autoexec.cfg'))).toBe(true)
  })

  it("the retry trigger `write` publishes the canonical file too, not a dirty profile's unsaved edits", async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    await save(h)
    const savedFile = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    editCvars(h, { sensitivity: '99' })
    // Delete the installation copy so the retry has something real to do.
    await rm(copyPath('Profile.cfg'))

    const result = await h.writes.write({ profileId: 'p1' })

    if (!result.ok) throw new Error('expected write to succeed')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(only(h).dirty).toBe(true)
  })

  /**
   * `write`'s optional `installationId` is "Sync now" - a one-click rewrite of ONE installation's
   * copy from the canonical file. `writer.ts#writeTargetFile`'s backup-once contract applies
   * exactly as it would for any other write: a copy holding content the launcher did not itself
   * generate is the user's own file and is preserved once, forever, before being overwritten -
   * this test asserts that contract is actually reached through the targeted path.
   */
  it('write with installationId backs up a foreign copy once, then overwrites', async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    await save(h)
    const canonical = await readFile(canonicalPath('Profile.cfg'), 'latin1')

    // A foreign, hand-written copy at the installation - not launcher output.
    const foreign = 'set sensitivity "42"\n'
    await writeFile(copyPath('Profile.cfg'), foreign, 'latin1')

    const result = await h.writes.write({ profileId: 'p1', installationId: 'i1' })

    if (!result.ok) throw new Error('expected write to succeed')
    expect(result.value).toEqual([{ installationId: 'i1', status: 'written' }])
    // Backed up once before being overwritten.
    expect(await readFile(`${copyPath('Profile.cfg')}.q2l-backup`, 'latin1')).toBe(foreign)
    // Overwritten with the canonical file's own bytes.
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(canonical)
    expect(configState(h.state).writeFailures.get()).toEqual({})

    // "Once, forever": a later foreign edit does not clobber the first backup.
    const secondForeign = 'set sensitivity "99"\n'
    await writeFile(copyPath('Profile.cfg'), secondForeign, 'latin1')
    await h.writes.write({ profileId: 'p1', installationId: 'i1' })
    expect(await readFile(`${copyPath('Profile.cfg')}.q2l-backup`, 'latin1')).toBe(foreign)
  })

  /**
   * A targeted "Sync now" must never publish a `dirty` profile's unsaved edits - it writes the
   * canonical file's own bytes, exactly like the untargeted retry path, just restricted to one
   * installation.
   */
  it("write with installationId on a dirty profile writes the canonical file's bytes, never the unsaved edits", async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    await save(h)
    const savedFile = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    editCvars(h, { sensitivity: '99' })
    const unsavedRender = renderProfileFile(only(h))
    expect(unsavedRender).not.toBe(savedFile)
    // Delete the installation copy so the targeted write has something real to do.
    await rm(copyPath('Profile.cfg'))

    const result = await h.writes.write({ profileId: 'p1', installationId: 'i1' })

    if (!result.ok) throw new Error('expected write to succeed')
    expect(result.value).toEqual([{ installationId: 'i1', status: 'written' }])
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).not.toBe(unsavedRender)
    // Still dirty: this was a sync, not a save.
    expect(only(h).dirty).toBe(true)
  })

  it('write rejects an unknown installationId and writes nothing', async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    await save(h)
    const before = await readFile(copyPath('Profile.cfg'), 'latin1')

    const result = await h.writes.write({ profileId: 'p1', installationId: 'nope' })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.installationNotFound' } })
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(before)
    expect(only(h).dirty).toBe(false)
  })

  it("write with installationId touches only the named installation, not the profile's other assignments", async () => {
    const i1 = installation({ id: 'i1', rootPath: join(dir, 'i1') })
    const i2 = installation({ id: 'i2', rootPath: join(dir, 'i2') })
    await mkdir(join(i1.rootPath, 'baseq2'), { recursive: true })
    await mkdir(join(i2.rootPath, 'baseq2'), { recursive: true })
    const h = await seeded(
      [
        profile({
          assignments: [
            { installationId: 'i1', isDefault: true },
            { installationId: 'i2', isDefault: true },
          ],
        }),
      ],
      { installations: [i1, i2] },
    )
    await save(h)
    const canonical = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(await readFile(join(i1.rootPath, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(canonical)
    expect(await readFile(join(i2.rootPath, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(canonical)

    // Both copies go stale...
    await writeFile(join(i1.rootPath, 'baseq2', 'Profile.cfg'), 'stale i1\n', 'latin1')
    await writeFile(join(i2.rootPath, 'baseq2', 'Profile.cfg'), 'stale i2\n', 'latin1')

    // ...but a targeted write only fixes i1.
    const result = await h.writes.write({ profileId: 'p1', installationId: 'i1' })

    if (!result.ok) throw new Error('expected write to succeed')
    expect(result.value).toEqual([{ installationId: 'i1', status: 'written' }])
    expect(await readFile(join(i1.rootPath, 'baseq2', 'Profile.cfg'), 'latin1')).toBe(canonical)
    expect(await readFile(join(i2.rootPath, 'baseq2', 'Profile.cfg'), 'latin1')).toBe('stale i2\n')
  })

  /**
   * A raw save's cascade protects the canonical file from being re-rendered for that ONE
   * `syncAndPersist` call (`refuseCanonicalWriteFor`), but that protection does not outlive the
   * call. The very next sync trigger - here "Sync now", `write` with `installationId` - runs its
   * own `syncAndPersist` with none of those options, and the general `canonicalWriteAllowed` rule
   * ("the on-disk hash already equals the cached `fileHash`, so this write is safe") wrongly treats
   * a hand-typed, non-render-fixed-point canonical file as safe to overwrite with
   * `renderProfileFile(profile)` - silently corrupting the user's typed formatting and turning
   * every OTHER installation's already-correct copy into new drift. A raw save never re-renders;
   * this asserts that holds across a subsequent Sync now too, and that the targeted installation
   * ends up byte-identical to the (unchanged) canonical file, reading `inSync`.
   */
  it('write with installationId after a non-fixed-point raw save never re-renders the canonical file, and syncs the installation from its exact bytes', async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    await save(h)

    // A raw save whose typed text is legal but deliberately NOT a render fixed point.
    const onDisk = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    const typed = `${onDisk}\tset q2l_hand "1"   \n`
    const rawResult: Outcome<SaveRawTextResult> = await h.writes.saveRawText({
      profileId: 'p1',
      text: typed,
    })
    if (!rawResult.ok || rawResult.value.status !== 'saved') {
      throw new Error('expected the raw save to succeed')
    }
    expect(only(h).dirty).toBe(false)
    expect(renderProfileFile(only(h))).not.toBe(typed)
    // The raw save's own cascade already published the typed bytes to the installation.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(typed)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(typed)

    // An outside tool hand-edits the installation's own copy.
    await writeFile(copyPath('Profile.cfg'), 'set sensitivity "42"\n', 'latin1')

    const result = await h.writes.write({ profileId: 'p1', installationId: 'i1' })

    if (!result.ok) throw new Error('expected write to succeed')
    expect(result.value).toEqual([{ installationId: 'i1', status: 'written' }])
    // The canonical file's typed bytes must not be re-rendered by a targeted Sync now.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(typed)
    // The installation copy is republished from those same typed bytes.
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(typed)

    const syncResult = await h.writes.syncState({ profileId: 'p1' })
    if (!syncResult.ok) throw new Error('expected syncState to succeed')
    expect(syncResult.value.installations[0]!.status).toBe('inSync')
  })

  it('is per profile: syncing a clean profile does not publish a DIRTY sibling assigned to the same installation', async () => {
    const h = await seeded(
      [
        profile({ id: 'p1', name: 'One' }),
        profile({
          id: 'p2',
          name: 'Two',
          assignments: [{ installationId: 'i1', isDefault: false }],
        }),
      ],
      { installations: [installation({ rootPath: dir })] },
    )
    await save(h, 'p1')
    await save(h, 'p2')
    const siblingFile = await readFile(canonicalPath('Two.cfg'), 'latin1')

    // The sibling has unsaved edits; the OTHER profile is the one being synced.
    h.profiles.setCvars({ profileId: 'p2', cvars: { sensitivity: '99' } })
    markUnsaved(h, 'p2')
    const siblingUnsaved = renderProfileFile(only(h, 'p2'))
    await h.writes.setDefault({ profileId: 'p1', installationId: 'i1' })

    // `syncOneProfile` writes EVERY profile assigned to the installation, so the sibling's copy was
    // rewritten by this run - from its canonical file, not from its unsaved state.
    expect(await readFile(canonicalPath('Two.cfg'), 'latin1')).toBe(siblingFile)
    expect(await readFile(copyPath('Two.cfg'), 'latin1')).toBe(siblingFile)
    expect(await readFile(copyPath('Two.cfg'), 'latin1')).not.toBe(siblingUnsaved)
    expect(only(h, 'p2').dirty).toBe(true)
  })

  it('assign still syncs a NON-dirty profile immediately, exactly as before', async () => {
    const h = await seeded([profile({ assignments: [] })], {
      installations: [installation({ rootPath: dir })],
    })
    await save(h)

    const assigned = await h.writes.assign({ profileId: 'p1', installationId: 'i1' })

    if (!assigned.ok) throw new Error('expected assign to succeed')
    const expected = renderProfileFile(only(h))
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(only(h).dirty).toBe(false)
  })

  it("syncState and rawFiles judge a dirty profile's installation copy against the FILE, so a retry can still clear it", async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    await save(h)
    editCvars(h, { sensitivity: '99' })

    // The unsaved edits live on the canonical row (the file does not say what the profile says)...
    const dirtyState = await h.writes.syncState({ profileId: 'p1' })
    if (!dirtyState.ok) throw new Error('expected syncState to succeed')
    expect(dirtyState.value.own.status).toBe('outOfSync')
    // ...while the installation copy holds exactly what the canonical file authorises, and says so -
    // the same answer the sync run that wrote it gave, and a state a Retry can actually reach.
    expect(dirtyState.value.installations[0]!.status).toBe('inSync')

    const raw = await h.writes.rawFiles({ profileId: 'p1' })
    if (!raw.ok) throw new Error('expected rawFiles to succeed')
    expect(raw.value.installations[0]!.matches).toBe(true)

    // A hand-edited installation copy is still reported out of sync, exactly as before.
    await writeFile(copyPath('Profile.cfg'), 'hand-edited\n', 'latin1')
    const edited = await h.writes.syncState({ profileId: 'p1' })
    if (!edited.ok) throw new Error('expected syncState to succeed')
    expect(edited.value.installations[0]!.status).toBe('outOfSync')

    // ...and the retry trigger fixes it without publishing the unsaved edits.
    await h.writes.write({ profileId: 'p1' })
    const retried = await h.writes.syncState({ profileId: 'p1' })
    if (!retried.ok) throw new Error('expected syncState to succeed')
    expect(retried.value.installations[0]!.status).toBe('inSync')
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(
      await readFile(canonicalPath('Profile.cfg'), 'latin1'),
    )
  })

  it('syncState and rawFiles judge a CLEAN profile’s installation copy against the canonical file’s bytes, never its render', async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    await save(h)
    // A raw save: the canonical file now holds exactly the typed text - clean profile, hash
    // baseline = these bytes - and that text is deliberately not a render fixed point.
    const typed = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}\tset q2l_hand "1"   \n`
    const raw = await h.writes.saveRawText({ profileId: 'p1', text: typed })
    if (!raw.ok || raw.value.status !== 'saved') throw new Error('expected the raw save to land')
    expect(only(h).dirty).toBe(false)
    expect(renderProfileFile(only(h))).not.toBe(typed)

    // A copy holding the typed bytes is in sync...
    await writeFile(copyPath('Profile.cfg'), typed, 'latin1')
    const mirrored = await h.writes.syncState({ profileId: 'p1' })
    if (!mirrored.ok) throw new Error('expected syncState to succeed')
    expect(mirrored.value.installations[0]!.status).toBe('inSync')
    const rawFiles = await h.writes.rawFiles({ profileId: 'p1' })
    if (!rawFiles.ok) throw new Error('expected rawFiles to succeed')
    expect(rawFiles.value.installations[0]!.matches).toBe(true)

    // ...and one holding the render - bytes nobody wrote to the canonical file - is not.
    await writeFile(copyPath('Profile.cfg'), renderProfileFile(only(h)), 'latin1')
    const rendered = await h.writes.syncState({ profileId: 'p1' })
    if (!rendered.ok) throw new Error('expected syncState to succeed')
    expect(rendered.value.installations[0]!.status).toBe('outOfSync')
  })

  it('a canonical file that moved underneath the launcher is neither published nor judged from', async () => {
    const h = await seeded([profile()], { installations: [installation({ rootPath: dir })] })
    await save(h)
    const savedFile = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    // An external edit the launcher has not read: hash ≠ `fileHash`, not our render either.
    const external = `${savedFile}set external_edit "1"\n`
    await writeFile(canonicalPath('Profile.cfg'), external, 'latin1')

    // Judged: the copy still equals the render, and still reads `outOfSync` - there is nothing it
    // is in sync with until the file is reloaded or overwritten by an explicit save.
    const judged = await h.writes.syncState({ profileId: 'p1' })
    if (!judged.ok) throw new Error('expected syncState to succeed')
    expect(judged.value.own.status).toBe('outOfSync')
    expect(judged.value.installations[0]!.status).toBe('outOfSync')
    const rawFiles = await h.writes.rawFiles({ profileId: 'p1' })
    if (!rawFiles.ok) throw new Error('expected rawFiles to succeed')
    expect(rawFiles.value.installations[0]!.matches).toBe(false)

    // Published: a non-save sync trigger writes neither the canonical file nor the copy - the
    // unread bytes stay where they are, and so does the copy.
    const written = await h.writes.write({ profileId: 'p1' })
    if (!written.ok) throw new Error('expected write to answer')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(external)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(savedFile)
    expect(only(h).dirty).toBe(false)
    expect(configState(h.state).writeFailures.get()).toEqual({})
  })
})

describe('write failures under overlapping sync runs', () => {
  it("concurrent syncAndPersist runs keep each other's write failures", async () => {
    const i1 = installation({ id: 'i1', rootPath: join(dir, 'one') })
    const i2 = installation({ id: 'i2', rootPath: join(dir, 'two') })
    const h = await seeded(
      [
        profile({
          id: 'p1',
          name: 'First',
          assignments: [{ installationId: 'i1', isDefault: true }],
        }),
        profile({
          id: 'p2',
          name: 'Second',
          assignments: [{ installationId: 'i2', isDefault: true }],
        }),
      ],
      { installations: [i1, i2] },
    )

    let releaseFirst!: () => void
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let calls = 0
    vi.mocked(writeTargetFile).mockImplementation(async () => {
      calls += 1
      if (calls === 1) await held
      throw new Error('disk full')
    })

    const first = save(h, 'p1')
    await vi.waitFor(() => expect(calls).toBe(1))
    await save(h, 'p2')
    expect(Object.keys(configState(h.state).writeFailures.get())).toEqual(['p2|own'])
    releaseFirst()
    await first
    await h.state.settle()

    expect(Object.keys(configState(h.state).writeFailures.get()).sort()).toEqual([
      'p1|own',
      'p2|own',
    ])
    vi.mocked(writeTargetFile).mockReset()
  })
})

describe('tidyUpApply', () => {
  const preservedLine = { file: 'config.cfg', line: 7, text: 'alias +test "echo hi"' }

  const removeShadowedMouse1 = {
    kind: 'removeShadowedBind' as const,
    scope: 'base' as const,
    key: 'MOUSE1',
    claim: { source: 'baseBind' as const, command: 'echo one' },
  }

  function messyProfile(): ConfigProfile {
    return profile({
      cvars: {},
      // Two spellings of one key - the duplicate-bind shape an import produces. Non-catalogue
      // commands, so the commit's own raw-bind adoption has nothing to adopt.
      binds: { MOUSE1: 'echo one', mouse1: 'echo two' },
      layers: [
        { id: 'l1', name: 'Empty', mode: 'hold', triggerKey: 'ALT', overrides: { '1': '  ' } },
      ],
      unrecognized: [preservedLine],
    })
  }

  async function tidy(h: WritesHarness, ops: TidyUpOp[]): Promise<TidyUpApplyResult> {
    return unwrapOk<TidyUpApplyResult>(await h.writes.tidyUpApply({ profileId: 'p1', ops }))
  }

  it('applies a batch, bumps updatedAt exactly once, commits once and syncs once', async () => {
    const seededProfile = messyProfile()
    const h = await seeded([seededProfile], { installations: [installation({ rootPath: dir })] })
    // Spied only after seeding, so the count is the call's own commits.
    const commit = vi.spyOn(configState(h.state).profiles, 'update')

    const result = await tidy(h, [
      removeShadowedMouse1,
      { kind: 'removeEmptyLayer', layerId: 'l1' },
      {
        kind: 'reclassifyPreservedLine',
        ...preservedLine,
        target: { field: 'cvars', name: 'sensitivity', value: '5' },
      },
    ])

    expect(result.applied).toHaveLength(3)
    expect(result.rejected).toEqual([])
    const updated = result.profile
    expect(updated.binds).toEqual({ mouse1: 'echo two' })
    expect(updated.layers).toEqual([])
    expect(updated.cvars).toEqual({ sensitivity: '5' })
    expect(updated.unrecognized).toEqual([])

    // One bump for the whole batch, and the returned value is the persisted one.
    expect(updated.updatedAt).not.toBe(seededProfile.updatedAt)
    expect(configState(h.state).profiles.get()[0]!.updatedAt).toBe(updated.updatedAt)
    // One content commit plus the sync run seeding the `fileHash` baseline from the bytes it
    // confirmed on disk - bookkeeping that bumps no timestamp and changes no content.
    expect(commit).toHaveBeenCalledTimes(2)

    const expected = renderProfileFile(updated)
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(expected)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(expected)
  })

  it('rewrites a seeded canonical file and its installation copies', async () => {
    // The shape every real profile is in when Tidy-up opens: saved, clean, `fileHash` set. The tidy
    // render no longer equals the file the save wrote, so the write needs the explicit overwrite.
    const h = await seeded([messyProfile()], { installations: [installation({ rootPath: dir })] })
    await save(h)
    const seededCanonical = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(seededCanonical).toContain('MOUSE1')
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(seededCanonical)

    const updated = (await tidy(h, [removeShadowedMouse1])).profile

    expect(updated.binds).toEqual({ mouse1: 'echo two' })
    const expected = renderProfileFile(updated)
    const canonicalAfter = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    expect(canonicalAfter).toBe(expected)
    expect(canonicalAfter).not.toContain('MOUSE1')
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(canonicalAfter)
    expect(configState(h.state).profiles.get()[0]!.fileHash).toBe(
      hashCanonicalFileContent(expected),
    )

    const synced = await h.writes.syncState({ profileId: 'p1' })
    if (!synced.ok) throw new Error('expected syncState to succeed')
    expect(synced.value.own.status).toBe('inSync')
    expect(synced.value.installations[0]!.status).toBe('inSync')
  })

  it('leaves a canonical file that moved underneath untouched, but still commits the tidy-up', async () => {
    // `TidyUpApplyResult` has no conflict shape, so the edit is committed (nothing the user did is
    // lost) while the file the launcher has not read keeps its bytes and is not published from.
    const h = await seeded([messyProfile()], { installations: [installation({ rootPath: dir })] })
    await save(h)
    const handEdited = `${await readFile(canonicalPath('Profile.cfg'), 'latin1')}set q2l_hand "1"\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')
    const copyBefore = await readFile(copyPath('Profile.cfg'), 'latin1')

    const result = await tidy(h, [removeShadowedMouse1])

    expect(result.profile.binds).toEqual({ mouse1: 'echo two' })
    expect(configState(h.state).profiles.get()[0]!.binds).toEqual({ mouse1: 'echo two' })
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(await readFile(copyPath('Profile.cfg'), 'latin1')).toBe(copyBefore)

    const synced = await h.writes.syncState({ profileId: 'p1' })
    if (!synced.ok) throw new Error('expected syncState to succeed')
    expect(synced.value.own.status).toBe('outOfSync')
  })

  it('rejects a stale op without bumping updatedAt, committing or syncing', async () => {
    const seededProfile = messyProfile()
    const h = await seeded([seededProfile], { installations: [installation({ rootPath: dir })] })
    const commit = vi.spyOn(configState(h.state).profiles, 'update')

    const stale = { kind: 'removeEmptyLayer' as const, layerId: 'never-existed' }
    const result = await tidy(h, [stale])

    expect(result.applied).toEqual([])
    expect(result.rejected).toEqual([stale])
    expect(result.profile.updatedAt).toBe(seededProfile.updatedAt)
    expect(result.profile.layers).toHaveLength(1)
    expect(configState(h.state).profiles.get()[0]!.updatedAt).toBe(seededProfile.updatedAt)
    expect(commit).not.toHaveBeenCalled()
    expect(await pathExists(canonicalPath('Profile.cfg'))).toBe(false)
  })

  it('fails an unknown profile id', async () => {
    const h = await seeded([messyProfile()])

    expect(await h.writes.tidyUpApply({ profileId: 'nope', ops: [] })).toEqual({
      ok: false,
      error: { key: 'config.error.profileNotFound' },
    })
  })
})
