// @vitest-environment jsdom
import { createElement, useRef, type MutableRefObject } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { ok } from '@shared/types'
import { RawDraftProvider, useRawDraft, type RawDraftHandle } from './raw-draft'
import { useFileSourceRefresh } from './useFileSourceRefresh'
import { refreshProfilesFromFiles } from '../client'

/**
 * Review fix (story 057): the focus-resume re-read must not run while the Raw file tab holds a
 * typed-but-unsaved draft.
 *
 * The bug this pins down was pure wiring, which is why this test renders the real hook against the
 * real `RawDraftProvider` instead of asserting on a pure helper: a raw draft deliberately never sets
 * `profile.dirty`, so main's `refreshFromFiles` treated the profile as clean, adopted whatever the
 * external editor had just written and rebased `fileHash` to it. The next raw save's conflict guard
 * then compared the typed text against that fresh hash, found "unchanged" and overwrote the external
 * edit with no conflict dialog at all - the exact loss AC5 and the story's Test Plan step 8 exist to
 * prevent. Nothing about main's guard is wrong, so nothing about it is tested here; what is tested is
 * that the renderer no longer moves the ground under it.
 *
 * `@testing-library/react` under the jsdom pragma, mirroring `raw-draft.provider.test.ts` next door -
 * `vitest.config.ts` runs `environment: 'node'` and only collects `*.test.ts`, so everything here is
 * built with `createElement` rather than JSX. Both of the hook's real dependencies are mocked: they
 * are the two modules whose import graph reaches `window.q2` at module load.
 */

const pushToast = vi.fn()
/** What `useWindowFocused` reports on the next render - flipped by `resumeFocus` below. */
let focused = true

vi.mock('../../../store/useLauncher', () => ({
  useWindowFocused: () => focused,
  useLauncher: (selector: (state: { pushToast: typeof pushToast }) => unknown) =>
    selector({ pushToast }),
}))

vi.mock('../client', () => ({
  refreshProfilesFromFiles: vi.fn(),
  // Pulled in by `RawDraftProvider` and the conflict dialog it mounts.
  saveConfigProfileRawText: vi.fn(),
  saveConfigProfile: vi.fn(),
}))

const refresh = vi.mocked(refreshProfilesFromFiles)

const FILE_TEXT = 'set sensitivity "3"\nbind w "+forward"\n'
const TYPED = `${FILE_TEXT}bind q "+zoom"\n`

const PROFILE: ConfigProfile = {
  id: 'p1',
  name: 'Profile One',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  cvars: {},
  binds: {},
  assignments: [],
}

/** Publishes the draft handle to the test, the same way `raw-draft.provider.test.ts` does. */
let latest: RawDraftHandle | null = null

function Probe() {
  latest = useRawDraft()
  return null
}

/**
 * `ConfigView`'s wiring, reduced to the two parts under test: the re-read hook lives *above* the
 * draft provider (it has to keep running for the whole view, and the provider only exists while a
 * profile's detail is open), so it learns about the draft through the ref the provider's
 * `onActiveChange` writes - exactly as `ConfigView` does it.
 */
function Refresher({
  profileId,
  activeRef,
}: {
  profileId: string | null
  activeRef: MutableRefObject<boolean>
}) {
  useFileSourceRefresh({
    profileId,
    isSuspended: () => activeRef.current,
    onResult: () => {},
  })
  return createElement(Probe)
}

function Wiring({ profileId }: { profileId: string | null }) {
  const activeRef = useRef(false)
  return createElement(RawDraftProvider, {
    profile: PROFILE,
    onSaved: () => {},
    onActiveChange: (active: boolean) => {
      activeRef.current = active
    },
    children: createElement(Refresher, { profileId, activeRef }),
  })
}

function mount(profileId: string | null = PROFILE.id) {
  const view = render(createElement(Wiring, { profileId }))
  /** One window-focus resume: `didFocusResume` only fires on a false -> true transition. */
  const resumeFocus = async (): Promise<void> => {
    for (const next of [false, true]) {
      focused = next
      await act(async () => {
        view.rerender(createElement(Wiring, { profileId }))
      })
    }
  }
  return { ...view, resumeFocus }
}

beforeEach(() => {
  focused = true
  latest = null
  pushToast.mockReset()
  refresh.mockReset()
  refresh.mockResolvedValue(ok([]))
})

afterEach(() => {
  cleanup()
})

describe('useFileSourceRefresh', () => {
  it('re-reads the selected profile when the window regains focus', async () => {
    const view = mount()
    refresh.mockClear()

    await view.resumeFocus()

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith({ profileId: 'p1' })
  })

  it('does not re-read while the Raw file tab holds an unsaved draft', async () => {
    const view = mount()
    act(() => latest!.setText(TYPED, FILE_TEXT))
    expect(latest!.active).toBe(true)
    refresh.mockClear()

    // Alt-tab to an external editor that writes the same file, then back.
    await view.resumeFocus()

    // Nothing was adopted, so `fileHash` still describes the text the draft was typed on top of -
    // which is what lets the next raw save's guard see the external edit and raise the conflict.
    expect(refresh).not.toHaveBeenCalled()
  })

  it('re-reads again once the draft is gone', async () => {
    const view = mount()
    act(() => latest!.setText(TYPED, FILE_TEXT))
    act(() => latest!.discard())
    refresh.mockClear()

    await view.resumeFocus()

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('reports the draft as gone when the detail screen unmounts with one still open', () => {
    const seen: boolean[] = []
    const view = render(
      createElement(RawDraftProvider, {
        profile: PROFILE,
        onSaved: () => {},
        onActiveChange: (active: boolean) => seen.push(active),
        children: createElement(Probe),
      }),
    )

    act(() => latest!.setText(TYPED, FILE_TEXT))
    expect(seen.at(-1)).toBe(true)
    view.unmount()

    // Going back to the profile list throws the draft away with the provider; a consumer left
    // holding `true` would have suppressed its re-reads for the rest of the session.
    expect(seen.at(-1)).toBe(false)
  })
})
