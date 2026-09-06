// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigProfile, SaveRawTextResult } from '@shared/modules/config'
import { fail, ok, type Outcome } from '@shared/types'
import { RawDraftProvider, useRawDraft, type RawDraftHandle } from './raw-draft'
import { saveConfigProfileRawText } from '../client'

/**
 * Story 057 D5: the provider's wiring against a mocked `config:saveRawText` - "the draft survives a
 * conflict", "Overwrite force-saves the typed text" and "a rejected save loses nothing" are exactly
 * the behaviours that cannot be read off the types. The pure rules this file leans on live in
 * `raw-draft.test.ts` next door, which needs no DOM.
 *
 * `@testing-library/react` under the jsdom pragma, mirroring `profile-changes.test.ts` (the sibling
 * context's own test) - `vitest.config.ts` runs `environment: 'node'` by default and only collects
 * `*.test.ts`, so everything here is built with `createElement` rather than JSX.
 */

const pushToast = vi.fn()

vi.mock('../../../store/useLauncher', () => ({
  useLauncher: (selector: (state: { pushToast: typeof pushToast }) => unknown) =>
    selector({ pushToast }),
}))

vi.mock('../client', () => ({
  saveConfigProfileRawText: vi.fn(),
  // Pulled in by `ConfigConflictDialog`, which this provider mounts for a raw conflict.
  saveConfigProfile: vi.fn(),
  refreshProfilesFromFiles: vi.fn(),
}))

const saveRawText = vi.mocked(saveConfigProfileRawText)

const FILE_TEXT = 'set sensitivity "3"\nbind w "+forward"\n'

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile One',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

function savedResult(overrides: Partial<ConfigProfile> = {}): Outcome<SaveRawTextResult> {
  return ok({
    status: 'saved',
    fileName: 'Profile.cfg',
    path: 'C:/userData/Profile.cfg',
    profile: profile({ updatedAt: '2026-02-02T00:00:00.000Z', ...overrides }),
    droppedAliases: ['+zoomin'],
    preservedLines: [{ file: 'Profile.cfg', line: 4, text: 'seta cl_weird "1"' }],
  })
}

const conflict = {
  status: 'conflict',
  fileName: 'Profile.cfg',
  path: 'C:/userData/Profile.cfg',
  diskContent: 'set sensitivity "9"\n',
  ourContent: 'typed',
} as const

const conflictResult: Outcome<SaveRawTextResult> = ok(conflict)

function mount(current: ConfigProfile = profile()) {
  const onSaved = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(RawDraftProvider, { profile: current, onSaved, children })
  const { result } = renderHook(() => useRawDraft(), { wrapper })
  return { result, onSaved }
}

beforeEach(() => {
  pushToast.mockReset()
  saveRawText.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('RawDraftProvider', () => {
  it('starts no draft until the text actually differs from the file', () => {
    const { result } = mount()

    act(() => result.current.setText(FILE_TEXT, FILE_TEXT))
    expect(result.current.active).toBe(false)
    expect(result.current.text).toBeNull()

    act(() => result.current.setText(`${FILE_TEXT}// typed\n`, FILE_TEXT))
    expect(result.current.active).toBe(true)
    expect(result.current.text).toBe(`${FILE_TEXT}// typed\n`)
  })

  it('ends the draft again when the text is typed back to what the file says', () => {
    const { result } = mount()

    act(() => result.current.setText(`${FILE_TEXT}// typed\n`, FILE_TEXT))
    act(() => result.current.setText(FILE_TEXT, FILE_TEXT))

    expect(result.current.active).toBe(false)
  })

  it('refuses to start a draft while the profile has structured unsaved changes', () => {
    const { result } = mount(profile({ dirty: true }))

    act(() => result.current.setText(`${FILE_TEXT}// typed\n`, FILE_TEXT))

    expect(result.current.active).toBe(false)
    expect(result.current.text).toBeNull()
  })

  it('discards the draft without writing anything', () => {
    const { result } = mount()
    const tokenBefore = result.current.resetToken

    act(() => result.current.setText(`${FILE_TEXT}// typed\n`, FILE_TEXT))
    act(() => result.current.discard())

    expect(result.current.active).toBe(false)
    expect(result.current.text).toBeNull()
    // Bumped so the editor remounts and the typed text actually leaves the screen.
    expect(result.current.resetToken).toBeGreaterThan(tokenBefore)
    expect(saveRawText).not.toHaveBeenCalled()
  })

  it('saves the typed text, clears the draft and keeps the read-back result for D6', async () => {
    saveRawText.mockResolvedValue(savedResult())
    const { result, onSaved } = mount()

    act(() => result.current.setText(`${FILE_TEXT}// typed\n`, FILE_TEXT))
    await act(async () => {
      result.current.save()
    })

    expect(saveRawText).toHaveBeenCalledWith({ profileId: 'p1', text: `${FILE_TEXT}// typed\n` })
    expect(result.current.active).toBe(false)
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(result.current.lastResult).toEqual({
      fileName: 'Profile.cfg',
      path: 'C:/userData/Profile.cfg',
      droppedAliases: ['+zoomin'],
      preservedLines: [{ file: 'Profile.cfg', line: 4, text: 'seta cl_weird "1"' }],
    })
  })

  it('keeps keystrokes typed while the save was in flight', async () => {
    let settle: ((outcome: Outcome<SaveRawTextResult>) => void) | undefined
    saveRawText.mockReturnValue(
      new Promise<Outcome<SaveRawTextResult>>((resolve) => {
        settle = resolve
      }),
    )
    const { result, onSaved } = mount()

    act(() => result.current.setText(`${FILE_TEXT}// typed\n`, FILE_TEXT))
    act(() => result.current.save())
    // Ctrl+S and carry on typing: the write is already on its way with the older text.
    act(() => result.current.setText(`${FILE_TEXT}// typed and then some\n`, FILE_TEXT))
    await act(async () => {
      settle?.(savedResult())
    })

    expect(saveRawText).toHaveBeenCalledWith({ profileId: 'p1', text: `${FILE_TEXT}// typed\n` })
    expect(onSaved).toHaveBeenCalledTimes(1)
    // The newer text is still there to be saved - never silently dropped by the save that raced it.
    expect(result.current.active).toBe(true)
    expect(result.current.text).toBe(`${FILE_TEXT}// typed and then some\n`)
  })

  it('never writes twice for two saves fired in the same tick', async () => {
    saveRawText.mockResolvedValue(savedResult())
    const { result } = mount()

    act(() => result.current.setText(`${FILE_TEXT}// typed\n`, FILE_TEXT))
    await act(async () => {
      result.current.save()
      result.current.save()
    })

    expect(saveRawText).toHaveBeenCalledTimes(1)
  })

  it('keeps the typed text when the save is rejected, and reports why', async () => {
    saveRawText.mockResolvedValue(fail('config.error.rawTextNotOwned'))
    const { result, onSaved } = mount()

    act(() => result.current.setText(`${FILE_TEXT}// typed\n`, FILE_TEXT))
    await act(async () => {
      result.current.save()
    })

    expect(result.current.active).toBe(true)
    expect(result.current.text).toBe(`${FILE_TEXT}// typed\n`)
    expect(onSaved).not.toHaveBeenCalled()
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: 'config.error.rawTextNotOwned' }),
    )
  })

  it('keeps the typed text on a conflict, and force-saves that same text on Overwrite', async () => {
    saveRawText.mockResolvedValue(conflictResult)
    const onSaved = vi.fn()
    const typed = `${FILE_TEXT}// typed\n`

    render(
      createElement(RawDraftProvider, {
        profile: profile(),
        onSaved,
        children: createElement(Probe),
      }),
    )

    act(() => latest!.setText(typed, FILE_TEXT))
    await act(async () => {
      latest!.save()
    })

    // Nothing was written and nothing was dropped - the dialog is now the user's choice.
    expect(latest!.active).toBe(true)
    expect(latest!.text).toBe(typed)
    expect(onSaved).not.toHaveBeenCalled()

    saveRawText.mockResolvedValue(savedResult())
    const overwrite = screen.getByTestId('config-conflict-overwrite')
    await act(async () => {
      overwrite.click()
    })

    expect(saveRawText).toHaveBeenLastCalledWith({ profileId: 'p1', text: typed, force: true })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(latest!.active).toBe(false)
    expect(screen.queryByTestId('config-conflict-overwrite')).toBeNull()
  })
})

/** Publishes the context handle to the test without a hook wrapper, so the provider's own children
 * (and therefore the conflict dialog it mounts) are part of the same render tree. */
let latest: RawDraftHandle | null = null

function Probe() {
  latest = useRawDraft()
  return null
}
