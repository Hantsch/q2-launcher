// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HomeLayout } from '@shared/modules/home'
import type { Outcome } from '@shared/types'
import { initI18n } from '../../../i18n'
import { Dashboard } from './Dashboard'

/**
 * Story 086 D6, the timing half of AC8. `useTileLift.test.tsx` covers the lift state machine with
 * injected callbacks; this file covers the one thing that can only be seen with the real
 * `Dashboard` and a *slow* `setHomeLayout`: a cancel (Escape, blur or Tab) that fires while the
 * keystroke before it is still being persisted.
 *
 * `useTileLift` calls `onKeyboardChange` fire-and-forget, so Escape can reach `Dashboard` before
 * the preceding ArrowRight has committed and before any re-render has happened. A cancel that read
 * the layout out of its render closure would then see the tile still on its origin, conclude there
 * is nothing to revert, and let the in-flight move stick permanently - the exact case a fast
 * keyboard user (or a held, repeating arrow key) hits. `npm run ui:flow home-dashboard-keyboard`
 * cannot reach it: through the real IPC bridge the write always wins the race.
 */

const ORIGIN: HomeLayout = { tiles: [{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }] }

/** Every layout handed to `setHomeLayout`, in call order. */
let writes: HomeLayout[] = []
/** While set, `setHomeLayout` blocks on it - the test decides when a write lands. */
let gate: Promise<void> | null = null
let openGate: () => void = () => {}

function holdWrites(): void {
  gate = new Promise<void>((resolve) => {
    openGate = () => {
      gate = null
      resolve()
    }
  })
}

const getHomeLayout = vi.fn<() => Promise<Outcome<HomeLayout>>>(async () => ({
  ok: true,
  value: ORIGIN,
}))
const setHomeLayout = vi.fn(async (next: HomeLayout): Promise<Outcome<HomeLayout>> => {
  writes.push(next)
  if (gate) await gate
  return { ok: true, value: next }
})

vi.mock('../client', () => ({
  getHomeLayout: () => getHomeLayout(),
  setHomeLayout: (next: HomeLayout) => setHomeLayout(next),
  resetHomeLayout: async () => ({ ok: true, value: ORIGIN }),
}))

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  writes = []
  gate = null
  getHomeLayout.mockClear()
  setHomeLayout.mockClear()
})

/** Renders the dashboard, waits for the layout fetch, and switches arrange mode on. */
async function renderArranging(): Promise<HTMLElement> {
  render(<Dashboard />)
  const toggle = await screen.findByTestId('dashboard-arrange-toggle')
  fireEvent.click(toggle)
  return screen.getByTestId('dashboard-tile-grip-playtime')
}

/** Lets every already-queued promise continuation run (a macrotask drains the microtask queue),
 * inside `act` so React's own re-renders are flushed with them. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The placement `setHomeLayout` was last given for the tile under test. */
function lastWrittenTile(): HomeLayout['tiles'][number] | undefined {
  return writes.at(-1)?.tiles.find((tile) => tile.moduleId === 'playtime')
}

describe("the dashboard's keyboard lift", () => {
  it('reverts a move that was still in flight when Escape arrived (AC8)', async () => {
    const grip = await renderArranging()
    holdWrites()

    fireEvent.keyDown(grip, { key: ' ' })
    fireEvent.keyDown(grip, { key: 'ArrowRight' })
    // No await in between: the move's write is still blocked on the gate, so React has had no
    // chance to re-render with it - which is precisely the situation the cancel has to survive.
    fireEvent.keyDown(grip, { key: 'Escape' })

    // The move's write is out and stuck on the gate; nothing has re-rendered, and the cancel is
    // waiting for it rather than having already decided there was nothing to revert.
    await flush()
    expect(writes).toHaveLength(1)
    expect(lastWrittenTile()?.x).toBe(1)

    openGate()
    await flush()

    // The move landed, and the cancel - which waited for it - then put the tile back.
    expect(writes).toHaveLength(2)
    expect(lastWrittenTile()).toEqual(ORIGIN.tiles[0])
    expect(screen.getByTestId('dashboard-tile-playtime').style.gridColumn).toBe('1 / span 6')
  })

  it('announces the cancel and writes nothing when the session changed nothing (AC9)', async () => {
    const grip = await renderArranging()

    fireEvent.keyDown(grip, { key: ' ' })
    await act(async () => {
      fireEvent.keyDown(grip, { key: 'Escape' })
    })

    expect(writes).toHaveLength(0)
    expect(screen.getByText('Cancelled - Playtime is back where it was.')).toBeTruthy()
  })

  it('serialises two keystrokes pressed faster than a write completes', async () => {
    const grip = await renderArranging()
    holdWrites()

    fireEvent.keyDown(grip, { key: ' ' })
    fireEvent.keyDown(grip, { key: 'ArrowRight' })
    fireEvent.keyDown(grip, { key: 'ArrowDown', shiftKey: true })

    // Only the first write has started - the resize is queued behind it rather than evaluated
    // against a layout that does not know about the move yet.
    await flush()
    expect(writes).toHaveLength(1)

    openGate()
    await flush()

    expect(writes).toHaveLength(2)
    // The resize was applied on top of the committed move, not on top of the pre-move layout.
    expect(lastWrittenTile()).toEqual({ moduleId: 'playtime', x: 1, y: 0, w: 6, h: 6 })
  })
})
