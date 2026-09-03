import { describe, expect, it } from 'vitest'
import type {
  ConfigProfile,
  RefreshFromFilesInput,
  RefreshFromFilesResult,
  RefreshedProfileResult,
} from '@shared/modules/config'
import { fail, ok, type Outcome } from '@shared/types'
import {
  adoptProfileFromFile,
  applyRefreshedProfile,
  didFocusResume,
  droppedAliasWarning,
  noticeForRefreshedProfile,
  type FileSourceToast,
} from './file-source-refresh'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Test profile',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

describe('didFocusResume', () => {
  it('is true on a false -> true transition', () => {
    expect(didFocusResume(false, true)).toBe(true)
  })

  it('is false while already focused (no re-trigger on every render)', () => {
    expect(didFocusResume(true, true)).toBe(false)
  })

  it('is false on a true -> false transition (losing focus)', () => {
    expect(didFocusResume(true, false)).toBe(false)
  })

  it('is false while staying unfocused', () => {
    expect(didFocusResume(false, false)).toBe(false)
  })
})

describe('applyRefreshedProfile', () => {
  it('leaves the list untouched for an unchanged result', () => {
    const list = [profile()]
    const result: RefreshedProfileResult = { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' }

    expect(applyRefreshedProfile(list, result)).toBe(list)
  })

  it('leaves the list untouched for a conflict result - main adopted nothing', () => {
    const list = [profile({ dirty: true })]
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'conflict',
      fileState: 'changedOnDisk',
      conflict: {
        status: 'conflict',
        fileName: 'p1.cfg',
        path: 'c:/x/p1.cfg',
        diskContent: 'disk',
        ourContent: 'ours',
      },
    }

    expect(applyRefreshedProfile(list, result)).toBe(list)
  })

  it('replaces the matching profile wholesale on adopted', () => {
    const stale = profile({ cvars: { sensitivity: '3' } })
    const adopted = profile({ cvars: { sensitivity: '5' }, name: 'Hand-Edited', fileState: 'unchanged' })
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'adopted',
      fileState: 'changedOnDisk',
      profile: adopted,
      droppedAliases: [],
    }

    const next = applyRefreshedProfile([stale], result)

    expect(next).toEqual([adopted])
  })

  it('patches only fileState on missing, leaving cached content untouched', () => {
    const cached = profile({ cvars: { sensitivity: '3' } })
    const result: RefreshedProfileResult = { profileId: 'p1', outcome: 'missing', fileState: 'missing' }

    const next = applyRefreshedProfile([cached], result)

    expect(next).toEqual([{ ...cached, fileState: 'missing' }])
  })

  it('patches only fileState on unparseable, leaving cached content untouched', () => {
    const cached = profile({ cvars: { sensitivity: '3' } })
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'unparseable',
      fileState: 'unparseable',
      file: 'Profile.cfg',
      line: 12,
      message: 'unexpected token',
    }

    const next = applyRefreshedProfile([cached], result)

    expect(next).toEqual([{ ...cached, fileState: 'unparseable' }])
  })

  it('patches only fileState on readError, leaving cached content untouched', () => {
    const cached = profile({ cvars: { sensitivity: '3' } })
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'readError',
      fileState: 'readError',
      message: 'EACCES',
    }

    const next = applyRefreshedProfile([cached], result)

    expect(next).toEqual([{ ...cached, fileState: 'readError' }])
  })

  it('leaves other profiles in the list untouched', () => {
    const other = profile({ id: 'p2', name: 'Other' })
    const cached = profile({ id: 'p1' })
    const result: RefreshedProfileResult = { profileId: 'p1', outcome: 'missing', fileState: 'missing' }

    const next = applyRefreshedProfile([other, cached], result)

    expect(next[0]).toBe(other)
  })
})

describe('noticeForRefreshedProfile', () => {
  it('reports a reloaded notice for adopted - never a silent swap', () => {
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'adopted',
      fileState: 'changedOnDisk',
      profile: profile(),
      droppedAliases: [],
    }

    expect(noticeForRefreshedProfile(result)).toEqual({ kind: 'reloaded', droppedAliases: [] })
  })

  // Story-050 review (finding 4, second round): an adopt that lost an entry to a duplicated alias
  // name has to carry that fact all the way to the notice - `ConfigView` pushes its own toast off
  // this list, and an empty one is the only thing that means "nothing was dropped".
  it('carries the dropped alias names through the reloaded notice', () => {
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'adopted',
      fileState: 'changedOnDisk',
      profile: profile(),
      droppedAliases: ['fire'],
    }

    expect(noticeForRefreshedProfile(result)).toEqual({
      kind: 'reloaded',
      droppedAliases: ['fire'],
    })
  })

  it('reports a conflict notice for conflict', () => {
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'conflict',
      fileState: 'changedOnDisk',
      conflict: {
        status: 'conflict',
        fileName: 'p1.cfg',
        path: 'c:/x/p1.cfg',
        diskContent: 'disk',
        ourContent: 'ours',
      },
    }

    expect(noticeForRefreshedProfile(result)).toEqual({ kind: 'conflict' })
  })

  it('carries file/line/message through for an unparseable diagnostic', () => {
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'unparseable',
      fileState: 'unparseable',
      file: 'Profile.cfg',
      line: 12,
      message: 'unexpected token',
    }

    expect(noticeForRefreshedProfile(result)).toEqual({
      kind: 'diagnostic',
      file: 'Profile.cfg',
      line: 12,
      message: 'unexpected token',
    })
  })

  it('carries only message through for a readError diagnostic - it has no position', () => {
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'readError',
      fileState: 'readError',
      message: 'EACCES',
    }

    expect(noticeForRefreshedProfile(result)).toEqual({ kind: 'diagnostic', message: 'EACCES' })
  })

  it('has nothing to surface for unchanged', () => {
    const result: RefreshedProfileResult = { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' }

    expect(noticeForRefreshedProfile(result)).toBeNull()
  })

  it('has nothing to surface for missing - the banner reads fileState directly', () => {
    const result: RefreshedProfileResult = { profileId: 'p1', outcome: 'missing', fileState: 'missing' }

    expect(noticeForRefreshedProfile(result)).toBeNull()
  })
})

/**
 * Story-050 review, finding 1 (third round): the two *manual* adopt paths.
 *
 * `ConfigView`'s automatic triggers already warned about an alias name the reloaded file defined
 * twice, but Care -> Sync -> **Reload** (`CareSyncSection.tsx#handleReload`) and the conflict
 * dialog's **Take the file** (`ConfigConflictDialog.tsx#takeFile`) each read `entry.outcome ===
 * 'adopted'` themselves and used only `entry.profile` - so a user who hand-edited their `.cfg` into
 * that collision and pressed either button lost an entry with no word about it. Both buttons now
 * have no adopt logic of their own at all: their whole body is `adoptProfileFromFile` below plus
 * the follow-up that is genuinely theirs (`fetchSyncState`, `onResolved`/`onClose`), so the tests
 * here drive the handler each click runs rather than a rendering of the toast.
 *
 * `refresh`/`pushToast` are the real dependencies each component passes - `client.ts`'s
 * `refreshProfilesFromFiles` and the store's `pushToast` - substituted here because a plain-node
 * vitest run has neither `window.q2` nor a DOM. Each case below passes the deps in exactly the
 * shape its component does, including whether it sets `discardLocalEdits`. That the produced
 * `droppedAliases` are real is `main/modules/config/file-source-pipeline.test.ts`'s job: it drives
 * save -> external edit -> `refreshFromFiles` over a real temp directory and pins
 * `adopted.droppedAliases` to `['fire']`, which is the payload these results reproduce.
 *
 * Known gap, recorded in the story: the click itself is not rendered. `vitest.config.ts` runs
 * `environment: 'node'` and this repo's one jsdom-based test cannot run on the installed Node
 * (jsdom 30 needs Node >= 22.19, the toolchain here is Node 20), so no test in this repo renders a
 * `.tsx` component today.
 */
describe('adoptProfileFromFile', () => {
  /** Collects what a component's `pushToast` would have shown. */
  function toastSpy(): { pushed: FileSourceToast[]; push: (toast: FileSourceToast) => void } {
    const pushed: FileSourceToast[] = []
    return { pushed, push: (toast) => pushed.push(toast) }
  }

  /** Stands in for `client.ts#refreshProfilesFromFiles`, recording the input the handler sent. */
  function refreshStub(
    outcome: Outcome<RefreshFromFilesResult>,
  ): {
    calls: RefreshFromFilesInput[]
    refresh: (input: RefreshFromFilesInput) => Promise<Outcome<RefreshFromFilesResult>>
  } {
    const calls: RefreshFromFilesInput[] = []
    return {
      calls,
      refresh: async (input) => {
        calls.push(input)
        return outcome
      },
    }
  }

  const adoptedProfile = profile({ name: 'Hand-Edited', fileState: 'unchanged' })

  function adopted(droppedAliases: string[]): RefreshedProfileResult {
    return {
      profileId: 'p1',
      outcome: 'adopted',
      fileState: 'changedOnDisk',
      profile: adoptedProfile,
      droppedAliases,
    }
  }

  it('warns about the dropped alias on Care -> Sync -> Reload, and adopts all the same', async () => {
    const toasts = toastSpy()
    // Exactly `handleReload`'s dep set: no `discardLocalEdits` (that button is only offered when
    // the profile is not dirty, so there is nothing to discard).
    const stub = refreshStub(ok([adopted(['fire'])]))

    const result = await adoptProfileFromFile({
      profileId: 'p1',
      refresh: stub.refresh,
      pushToast: toasts.push,
    })

    expect(stub.calls).toEqual([{ profileId: 'p1' }])
    expect(result).toEqual({ kind: 'adopted', profile: adoptedProfile })
    // The reload succeeded, so this is a `warning` and not an error - and it never auto-dismisses,
    // because losing an entry has to stay readable after the fact.
    expect(toasts.pushed).toEqual([
      {
        level: 'warning',
        messageKey: 'config.fileSource.aliasDropped',
        params: { count: 1, names: 'fire' },
        timeoutMs: 0,
      },
    ])
  })

  it('warns about the dropped alias on the conflict dialog Take the file', async () => {
    const toasts = toastSpy()
    const stub = refreshStub(ok([adopted(['fire', 'zoom'])]))

    // Exactly `takeFile`'s dep set - `discardLocalEdits` is the one difference between the two
    // buttons, and it must reach the handler or the adopt would come back a conflict again.
    const result = await adoptProfileFromFile({
      profileId: 'p1',
      discardLocalEdits: true,
      refresh: stub.refresh,
      pushToast: toasts.push,
    })

    expect(stub.calls).toEqual([{ profileId: 'p1', discardLocalEdits: true }])
    expect(result).toEqual({ kind: 'adopted', profile: adoptedProfile })
    expect(toasts.pushed).toEqual([
      {
        level: 'warning',
        messageKey: 'config.fileSource.aliasDropped',
        params: { count: 2, names: 'fire, zoom' },
        timeoutMs: 0,
      },
    ])
  })

  // The guard against a warning that fires on every reload - the mirror of the healthy-profile
  // case `file-source-pipeline.test.ts` pins on the main side.
  it('says nothing for an adopt that lost nothing', async () => {
    const toasts = toastSpy()
    const stub = refreshStub(ok([adopted([])]))

    const result = await adoptProfileFromFile({
      profileId: 'p1',
      refresh: stub.refresh,
      pushToast: toasts.push,
    })

    expect(result).toEqual({ kind: 'adopted', profile: adoptedProfile })
    expect(toasts.pushed).toEqual([])
  })

  it('reports a failed call once and tells the caller not to report it again', async () => {
    const toasts = toastSpy()
    const stub = refreshStub(fail('config.error.refreshFailed', { name: 'Profile' }))

    const result = await adoptProfileFromFile({
      profileId: 'p1',
      refresh: stub.refresh,
      pushToast: toasts.push,
    })

    expect(result).toEqual({ kind: 'failed' })
    expect(toasts.pushed).toEqual([
      {
        level: 'error',
        messageKey: 'config.error.refreshFailed',
        params: { name: 'Profile' },
        timeoutMs: 0,
      },
    ])
  })

  // The file moved again between the button rendering and the click. Nothing is pushed here: the
  // two callers word this differently (Care re-fetches its row, the dialog says
  // `takeFileFailed`), so it stays their message to make.
  it('says nothing for a result that adopted nothing, leaving the wording to the caller', async () => {
    const toasts = toastSpy()
    const stub = refreshStub(
      ok([{ profileId: 'p1', outcome: 'missing', fileState: 'missing' }]),
    )

    const result = await adoptProfileFromFile({
      profileId: 'p1',
      refresh: stub.refresh,
      pushToast: toasts.push,
    })

    expect(result).toEqual({ kind: 'notAdopted' })
    expect(toasts.pushed).toEqual([])
  })

  it('ignores a result for another profile rather than adopting it', async () => {
    const toasts = toastSpy()
    const stub = refreshStub(ok([{ ...adopted(['fire']), profileId: 'p2' }]))

    const result = await adoptProfileFromFile({
      profileId: 'p1',
      refresh: stub.refresh,
      pushToast: toasts.push,
    })

    expect(result).toEqual({ kind: 'notAdopted' })
    expect(toasts.pushed).toEqual([])
  })
})

describe('droppedAliasWarning', () => {
  // One definition for all three adopt paths (`ConfigView`'s automatic refresh, Care's Reload, the
  // conflict dialog's Take the file), so they cannot word the same loss differently.
  it('is null when nothing was dropped', () => {
    expect(droppedAliasWarning([])).toBeNull()
  })

  it('names every dropped alias and never auto-dismisses', () => {
    expect(droppedAliasWarning(['fire', 'zoom'])).toEqual({
      level: 'warning',
      messageKey: 'config.fileSource.aliasDropped',
      params: { count: 2, names: 'fire, zoom' },
      timeoutMs: 0,
    })
  })
})
