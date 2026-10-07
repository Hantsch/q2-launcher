import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConfigProfile, SaveRawTextResult } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { sentinelLine } from '@shared/config/render/render'
import { pathExists } from '../../lib/fs-utils'
import { seedConfigProfiles } from '../../../test-support/config-state'
import { installTempDir } from '../../../test-support/temp-dir'
import { hashCanonicalFileContent, readFileState } from './file-source'
import { installation, profile } from './index.test-helpers'
import { configState } from './persisted'
import { writesHarness, type WritesHarness } from './profile-writes.test-helpers'

const getDir = installTempDir('q2-launcher-profile-writes-raw-save-')
let dir: string
beforeEach(() => {
  dir = getDir()
})

/**
 * Saving the text the user typed, byte for byte. Every test starts from a real `save`, so the text
 * being edited is the file the launcher itself wrote (the only state the editor is offered in) and
 * the ownership header under test is the real one, never a hand-built fixture that could drift from
 * what `render.ts` emits.
 */
describe('raw save', () => {
  const canonicalPath = (fileName: string): string => join(dir, 'userData', fileName)

  const saveRaw = (
    h: WritesHarness,
    text: string,
    options: { profileId?: string; force?: boolean } = {},
  ): Promise<Outcome<SaveRawTextResult>> =>
    h.writes.saveRawText({
      profileId: options.profileId ?? 'p1',
      text,
      ...(options.force === undefined ? {} : { force: options.force }),
    })

  /** A saved profile plus the exact bytes its canonical file holds - the editor's starting point. */
  async function seeded(h: WritesHarness): Promise<string> {
    seedConfigProfiles(h.state, [profile({ assignments: [] })])
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })
    return readFile(canonicalPath('Profile.cfg'), 'latin1')
  }

  /** What the `setCvars` handler does: persist the edit, then mark the profile unsaved. */
  function editCvars(h: WritesHarness, profileId: string, cvars: Record<string, string>): void {
    h.profiles.setCvars({ profileId, cvars })
    h.profiles.setDirty(profileId, true)
  }

  /** What the `rename` handler does: rename, then mark the profile unsaved. */
  function rename(h: WritesHarness, name: string): void {
    h.profiles.rename({ id: 'p1', name })
    h.profiles.setDirty('p1', true)
  }

  function only(h: WritesHarness, profileId = 'p1'): ConfigProfile {
    return configState(h.state)
      .profiles.get()
      .find((p) => p.id === profileId)!
  }

  it('writes exactly the given bytes, latin-1, with no reformatting of any kind', async () => {
    const h = await writesHarness(dir)
    const onDisk = await seeded(h)

    // Deliberately awkward but entirely legal latin-1 text: high bytes (é, ÿ, °), a tab, a CRLF
    // line, trailing whitespace, a blank line and NO trailing newline at the end. A writer that
    // re-rendered, trimmed or re-encoded anything would change at least one of these bytes.
    const raw =
      `${onDisk}` +
      '// café ÿ ° sensitivity notes\r\n' +
      '\tset q2l_raw_test "1"   \n' +
      '\n' +
      'set no_trailing_newline "2"'

    const result = await saveRaw(h, raw)

    if (!result.ok) throw new Error(`expected a raw save, got ${JSON.stringify(result.error)}`)
    if (result.value.status !== 'saved') {
      throw new Error(`expected saved, got ${result.value.status}`)
    }
    // Byte-for-byte off the disk, not through a latin1 decode that could hide a re-encoding.
    expect(await readFile(canonicalPath('Profile.cfg'))).toEqual(Buffer.from(raw, 'latin1'))
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(result.value.path).toBe(canonicalPath('Profile.cfg'))

    // The read-back landed in the profile, and the file-state record was reseeded from the bytes
    // actually written.
    const saved = only(h)
    expect(saved.cvars.q2l_raw_test).toBe('1')
    expect(saved.dirty).toBe(false)
    expect(saved.fileHash).toBe(hashCanonicalFileContent(raw))
    expect(saved.fileState).toBe('unchanged')
    expect(result.value.profile.fileHash).toBe(hashCanonicalFileContent(raw))
  })

  it("reports the lines it could not read back, and never the file's own comment lines", async () => {
    const h = await writesHarness(dir)
    const onDisk = await seeded(h)

    // A clean launcher-written file first: its banners and header prose are comments the writer
    // regenerates, so an honest "preserved" report is empty for it.
    const clean = await saveRaw(h, onDisk)
    if (!clean.ok || clean.value.status !== 'saved') throw new Error('expected the first save')
    expect(clean.value.preservedLines).toEqual([])
    expect(clean.value.droppedAliases).toEqual([])

    const raw = `${onDisk}wave hi\n// just a note\n`
    const result = await saveRaw(h, raw)

    if (!result.ok || result.value.status !== 'saved') throw new Error('expected a raw save')
    // `onDisk` ends in a newline, so its `split` produces one trailing empty element - which is
    // exactly the 1-based line number the appended `wave hi` lands on.
    expect(result.value.preservedLines).toEqual([
      { file: 'Profile.cfg', line: onDisk.split('\n').length, text: 'wave hi' },
    ])
    // ...and the line is still in the file, which is the source of truth.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(raw)
  })

  it('reports an alias the text defines twice, whose earlier body the read-back lost', async () => {
    const h = await writesHarness(dir)
    const onDisk = await seeded(h)

    const raw = `${onDisk}alias q2l_dup "say one"\nalias q2l_dup "say two"\n`
    const result = await saveRaw(h, raw)

    if (!result.ok || result.value.status !== 'saved') throw new Error('expected a raw save')
    expect(result.value.droppedAliases).toEqual(['q2l_dup'])
    // The write itself is untouched by the warning - the file still says both lines.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(raw)
  })

  it('refuses and reports a whole-file conflict when the file changed underneath', async () => {
    const h = await writesHarness(dir)
    const onDisk = await seeded(h)
    const seededHash = only(h).fileHash

    const handEdited = `${onDisk}// hand-edited elsewhere\n`
    await writeFile(canonicalPath('Profile.cfg'), handEdited, 'latin1')
    const raw = `${onDisk}set typed_in_the_editor "1"\n`

    const result = await saveRaw(h, raw)

    if (!result.ok) throw new Error('expected saveRawText to answer, not fail')
    if (result.value.status !== 'conflict') {
      throw new Error(`expected conflict, got ${result.value.status}`)
    }
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(result.value.diskContent).toBe(handEdited)
    // `ourContent` is what THIS save would have written: the typed text, not a render.
    expect(result.value.ourContent).toBe(raw)
    // Nothing written, nothing adopted, the baseline untouched.
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(handEdited)
    expect(only(h).fileHash).toBe(seededHash)
    expect(only(h).cvars.typed_in_the_editor).toBeUndefined()
  })

  it('force: true overwrites the conflicting file with the typed text', async () => {
    const h = await writesHarness(dir)
    const onDisk = await seeded(h)

    await writeFile(canonicalPath('Profile.cfg'), `${onDisk}// hand-edited elsewhere\n`, 'latin1')
    const raw = `${onDisk}set typed_in_the_editor "1"\n`

    const refused = await saveRaw(h, raw)
    if (!refused.ok || refused.value.status !== 'conflict') {
      throw new Error('expected the ordinary raw save to still refuse')
    }

    const forced = await saveRaw(h, raw, { force: true })

    if (!forced.ok) throw new Error('expected the forced raw save to answer')
    if (forced.value.status !== 'saved') {
      throw new Error(`expected saved, got ${forced.value.status}`)
    }
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(raw)
    expect(only(h).cvars.typed_in_the_editor).toBe('1')
    expect(only(h).fileHash).toBe(hashCanonicalFileContent(raw))
  })

  it("rejects text that no longer carries the profile's ownership tag, and writes nothing", async () => {
    const h = await writesHarness(dir)
    const onDisk = await seeded(h)
    const before = only(h)

    // The header block deleted - what "select all, paste someone else's config" produces.
    const disowned = 'set sensitivity "5"\nbind w "+forward"\n'
    expect(disowned.includes(sentinelLine('p1'))).toBe(false)

    const result = await saveRaw(h, disowned)

    expect(result).toEqual({ ok: false, error: { key: 'config.error.rawTextNotOwned' } })
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(onDisk)
    expect(only(h)).toEqual(before)
  })

  it("rejects text carrying the OTHER profile's ownership tag", async () => {
    const h = await writesHarness(dir)
    seedConfigProfiles(h.state, [
      profile({ id: 'p1', name: 'Profile', assignments: [] }),
      profile({ id: 'p2', name: 'Second', assignments: [] }),
    ])
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })
    await h.writes.save({ profileId: 'p2' })
    const ownFile = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    const otherFile = await readFile(canonicalPath('Second.cfg'), 'latin1')

    // Launcher-owned text, but for the wrong profile: pasting p2's file into p1's editor would
    // leave two files claiming the same id and one profile with no file of its own.
    const result = await saveRaw(h, otherFile)

    expect(result).toEqual({ ok: false, error: { key: 'config.error.rawTextNotOwned' } })
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(ownFile)
    expect(await readFile(canonicalPath('Second.cfg'), 'latin1')).toBe(otherFile)
  })

  it('rejects text with a character outside latin-1, and writes nothing', async () => {
    const h = await writesHarness(dir)
    const onDisk = await seeded(h)

    // A checkmark and a CJK character - both perfectly typeable, neither representable in a byte.
    const result = await saveRaw(h, `${onDisk}// ✓ 你好\n`)

    expect(result).toEqual({ ok: false, error: { key: 'config.error.rawTextNotLatin1' } })
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(onDisk)
  })

  it('rejects text with a control byte no config file can hold, and writes nothing', async () => {
    const h = await writesHarness(dir)
    const onDisk = await seeded(h)

    // A NUL pasted out of a binary file: latin-1 by code point, but exactly what `readFileState`
    // calls `unparseable` - writing it would leave the profile's own file unreadable.
    const result = await saveRaw(h, `${onDisk}set nul "\u0000"\n`)

    expect(result).toEqual({ ok: false, error: { key: 'config.error.rawTextNotLatin1' } })
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(onDisk)
  })

  it('leaves no phantom external edit behind: the next guard run sees an unchanged file', async () => {
    const h = await writesHarness(dir)
    const onDisk = await seeded(h)
    const raw = `${onDisk}set guard_check "1"\r\n`

    const first = await saveRaw(h, raw)
    if (!first.ok || first.value.status !== 'saved') throw new Error('expected the raw save')

    // 1. The guard every other operation uses, run directly against the stored baseline.
    const guard = await readFileState(h.canonicalDir, 'Profile.cfg', only(h).fileHash)
    expect(guard.state).toBe('unchanged')

    // 2. The refresh handler (window focus / tab open) - the one that would say "changed outside
    //    the launcher" to the user.
    const refreshed = await h.writes.refreshFromFiles({ profileId: 'p1' })
    if (!refreshed.ok) throw new Error('expected refreshFromFiles to succeed')
    expect(refreshed.value).toEqual([
      { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' },
    ])

    // 3. A second raw save of the same text: no conflict, and still byte-identical afterwards.
    const second = await saveRaw(h, raw)
    if (!second.ok) throw new Error('expected the second raw save to answer')
    expect(second.value.status).toBe('saved')
    expect(await readFile(canonicalPath('Profile.cfg'))).toEqual(Buffer.from(raw, 'latin1'))
  })

  it('writes the file the ownership stamp actually sits in, without renaming it', async () => {
    const h = await writesHarness(dir)
    const onDisk = await seeded(h)
    // A rename only marks the profile dirty, so the file still sits under its old
    // name - the editor is editing `Profile.cfg`, and that is where the text has to land.
    rename(h, 'Renamed')
    const raw = `${onDisk}set after_rename "1"\n`

    const result = await saveRaw(h, raw)

    if (!result.ok || result.value.status !== 'saved') throw new Error('expected the raw save')
    expect(result.value.fileName).toBe('Profile.cfg')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(raw)
    expect(await pathExists(canonicalPath('Renamed.cfg'))).toBe(false)
    // The adopt takes the name from the file, so the unsaved rename does not survive - the file is
    // the source of truth, and it still says "Profile".
    expect(only(h).name).toBe('Profile')
    expect(only(h).dirty).toBe(false)
  })

  it('reports a file it cannot read at all instead of writing over it', async () => {
    const readState = vi.fn(readFileState)
    const h = await writesHarness(dir, { readFileState: readState })
    seedConfigProfiles(h.state, [profile({ assignments: [] })])
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })
    const onDisk = await readFile(canonicalPath('Profile.cfg'), 'latin1')

    readState.mockResolvedValueOnce({
      state: 'readError',
      error: new Error('EACCES (contrived for this test)'),
    })

    const result = await saveRaw(h, `${onDisk}set unread "1"\n`)

    if (!result.ok) throw new Error('expected saveRawText to answer, not fail')
    if (result.value.status !== 'unreadable') {
      throw new Error(`expected unreadable, got ${result.value.status}`)
    }
    expect(result.value.reason).toBe('readError')
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(onDisk)
  })

  it('fails with config.error.profileNotFound for an unknown profile id', async () => {
    const h = await writesHarness(dir)

    const result = await saveRaw(h, 'anything', { profileId: 'nope' })

    expect(result).toEqual({ ok: false, error: { key: 'config.error.profileNotFound' } })
  })

  /**
   * A raw save is a content mutation like any other, so it cascades to
   * every assigned installation the same way `save` does - and the copy is
   * byte-identical to what the user typed, never a re-render of it (the whole point of
   * `refuseCanonicalWriteFor`: hand-formatted or otherwise non-render-fixed-point text must reach
   * the installation exactly as typed, not through `renderProfileFile`).
   */
  it('cascades the typed bytes to every assigned installation', async () => {
    const inst = installation({ rootPath: dir })
    const h = await writesHarness(dir, { installations: [inst] })
    seedConfigProfiles(h.state, [profile()])
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })
    const onDisk = await readFile(canonicalPath('Profile.cfg'), 'latin1')

    // Deliberately not a render fixed point (hand-formatted spacing), so a cascade that re-rendered
    // instead of copying the typed bytes would be caught by this assertion.
    const raw = `${onDisk}\tset q2l_typed_raw   "1"   \n`
    const result = await saveRaw(h, raw)

    if (!result.ok || result.value.status !== 'saved') {
      throw new Error(`expected a raw save, got ${JSON.stringify(result)}`)
    }
    // The canonical file still says exactly what was typed - the cascade must not have re-rendered
    // it (that is the whole reason for `refuseCanonicalWriteFor`).
    expect(await readFile(canonicalPath('Profile.cfg'), 'latin1')).toBe(raw)
    const copy = await readFile(join(dir, 'baseq2', 'Profile.cfg'), 'latin1')
    expect(copy).toBe(raw)
    expect(only(h).fileHash).toBe(hashCanonicalFileContent(raw))
  })

  /**
   * the per-profile `canonicalWriteAllowed` rule still applies to
   * every OTHER profile a raw-save cascade touches - a dirty sibling assigned to the same
   * installation contributes its own on-disk file, never its unsaved edits, exactly as it does
   * after a structured save (see the `canonicalWriteAllowed` describe in `sync.test.ts`).
   */
  it('its cascade leaves a dirty sibling on the same installation untouched', async () => {
    const inst = installation({ rootPath: dir })
    const h = await writesHarness(dir, { installations: [inst] })
    seedConfigProfiles(h.state, [
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
    await h.state.settle()
    await h.writes.save({ profileId: 'p1' })
    await h.writes.save({ profileId: 'p2' })
    const siblingCopyBefore = await readFile(join(dir, 'baseq2', 'Second.cfg'), 'latin1')
    const siblingCanonicalBefore = await readFile(canonicalPath('Second.cfg'), 'latin1')
    // An unsaved UI edit on the sibling - marks it dirty without writing its file.
    editCvars(h, 'p2', { sensitivity: '42' })

    const onDisk = await readFile(canonicalPath('Profile.cfg'), 'latin1')
    const raw = `${onDisk}set q2l_typed_raw "1"\n`
    const result = await saveRaw(h, raw)
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
