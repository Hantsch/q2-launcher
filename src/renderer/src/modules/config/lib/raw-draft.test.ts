import { describe, expect, it, vi } from 'vitest'
import type {
  SaveProfileConflict,
  SaveProfileUnreadable,
  SaveRawTextSaved,
} from '@shared/modules/config'
import { fail, ok } from '@shared/types'
import {
  isRawDraftDirty,
  normalizeRawText,
  rawEditingMode,
  resolveRawSaveOutcome,
} from './raw-draft'

/**
 * Story 057 D5, the pure half: the rules that decide when a raw draft may exist at all and what a
 * `config:saveRawText` outcome means. Plain `environment: 'node'` (this repo's default), like
 * `save-bar.test.ts` next door - the React wiring around these rules is covered separately in
 * `raw-draft.provider.test.ts`, which needs jsdom.
 *
 * The store and the client are mocked only so importing `raw-draft.tsx` (which mounts
 * `ConfigConflictDialog`) does not drag in `lib/bridge.ts`, which reads `window.q2` at module scope;
 * nothing here uses either of them.
 */
vi.mock('../../../store/useLauncher', () => ({ useLauncher: () => vi.fn() }))
vi.mock('../client', () => ({
  saveConfigProfileRawText: vi.fn(),
  saveConfigProfile: vi.fn(),
  refreshProfilesFromFiles: vi.fn(),
}))

describe('rawEditingMode', () => {
  it('offers no editing while the canonical file is not on disk', () => {
    expect(rawEditingMode({ onDisk: false, profileDirty: false, draftActive: false })).toBe(
      'noFile',
    )
    // Even a (hypothetical) draft cannot make a file that was never written editable.
    expect(rawEditingMode({ onDisk: false, profileDirty: false, draftActive: true })).toBe('noFile')
  })

  it('locks the editor while the profile carries structured unsaved changes', () => {
    expect(rawEditingMode({ onDisk: true, profileDirty: true, draftActive: false })).toBe(
      'lockedByChanges',
    )
  })

  it('keeps an already-open draft editable even if the profile turns dirty underneath it', () => {
    expect(rawEditingMode({ onDisk: true, profileDirty: true, draftActive: true })).toBe('editable')
  })

  it('is editable for a written file with nothing else pending', () => {
    expect(rawEditingMode({ onDisk: true, profileDirty: false, draftActive: false })).toBe(
      'editable',
    )
  })
})

describe('isRawDraftDirty', () => {
  const fileText = 'set sensitivity "3"\nbind w "+forward"\n'

  it('is false for the file text itself', () => {
    expect(isRawDraftDirty(fileText, fileText)).toBe(false)
  })

  it('ignores the line endings a textarea normalizes away', () => {
    expect(isRawDraftDirty(fileText, fileText.replace(/\n/g, '\r\n'))).toBe(false)
    expect(normalizeRawText('a\r\nb\rc\n')).toBe('a\nb\nc\n')
  })

  it('is true for any real edit', () => {
    expect(isRawDraftDirty(`${fileText}// note\n`, fileText)).toBe(true)
    expect(isRawDraftDirty('', fileText)).toBe(true)
  })
})

describe('resolveRawSaveOutcome', () => {
  const saved: SaveRawTextSaved = {
    status: 'saved',
    fileName: 'Profile.cfg',
    path: 'C:/userData/Profile.cfg',
    profile: {
      id: 'p1',
      name: 'Profile One',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      cvars: {},
      binds: {},
      assignments: [],
    },
    droppedAliases: [],
    preservedLines: [],
  }

  const conflict: SaveProfileConflict = {
    status: 'conflict',
    fileName: 'Profile.cfg',
    path: 'C:/userData/Profile.cfg',
    diskContent: 'set sensitivity "9"\n',
    ourContent: 'typed',
  }

  const unreadable = (
    reason: 'unparseable' | 'readError',
    message: string,
  ): SaveProfileUnreadable => ({
    status: 'unreadable',
    fileName: 'Profile.cfg',
    path: 'C:/userData/Profile.cfg',
    reason,
    message,
  })

  it('reports a saved result with its read-back payload', () => {
    expect(resolveRawSaveOutcome(ok(saved))).toEqual({ type: 'saved', result: saved })
  })

  it('reports a conflict so the dialog can be opened with both versions', () => {
    expect(resolveRawSaveOutcome(ok(conflict))).toEqual({ type: 'conflict', conflict })
  })

  it('passes a rejected text through as its own error key', () => {
    expect(resolveRawSaveOutcome(fail('config.error.rawTextNotLatin1'))).toEqual({
      type: 'toast',
      messageKey: 'config.error.rawTextNotLatin1',
    })
    expect(
      resolveRawSaveOutcome(fail('config.error.profileNotFound', { name: 'Profile One' })),
    ).toEqual({
      type: 'toast',
      messageKey: 'config.error.profileNotFound',
      params: { name: 'Profile One' },
    })
  })

  it("reuses the save bar's unreadable keys, with the message interpolated", () => {
    expect(resolveRawSaveOutcome(ok(unreadable('unparseable', 'line 3')))).toEqual({
      type: 'toast',
      messageKey: 'config.save.unreadableUnparseable',
      params: { message: 'line 3' },
    })
    expect(resolveRawSaveOutcome(ok(unreadable('readError', 'EACCES')))).toEqual({
      type: 'toast',
      messageKey: 'config.save.unreadableReadError',
      params: { message: 'EACCES' },
    })
  })
})
