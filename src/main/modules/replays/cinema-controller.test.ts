import { describe, expect, it } from 'vitest'
import type { CinemaAvailability } from '@shared/replays/cinema'
import { fail, ok, type Outcome } from '@shared/types'
import { createCinemaController } from './cinema-controller'

/** Story 187 D5: the cinema controller orders pin, overlay and fullscreen so the follower never
 * reacts to the overlay's focus change unpinned. */

const DISPLAY = '2560x1440+0+0'

function setup(
  opts: {
    availability?: CinemaAvailability
    session?: boolean
    fullscreen?: Outcome<void>
    follower?: boolean
    failOpen?: boolean
    settled?: () => Promise<void>
  } = {},
) {
  const calls: string[] = []
  const closedCbs = new Set<() => void>()
  let open = false
  const window = {
    open: async () => {
      calls.push('open')
      if (opts.failOpen) {
        // The real window closes itself when its page fails to load.
        calls.push('close')
        throw new Error('load failed')
      }
      open = true
    },
    close: () => {
      calls.push('close')
      open = false
      // The real overlay reports its close too - the controller must tell its own close apart.
      closedCbs.forEach((cb) => cb())
    },
    isOpen: () => open,
    onClosed: (cb: () => void) => {
      closedCbs.add(cb)
      return () => closedCbs.delete(cb)
    },
  }
  const controller = createCinemaController({
    availability: () => opts.availability ?? { available: true },
    displayGeometry: () => DISPLAY,
    pin: (geometry) => {
      calls.push(`pin ${geometry}`)
      return opts.follower ?? true
    },
    settled: opts.settled ?? (() => Promise.resolve()),
    window,
    hasSession: () => opts.session ?? true,
    enterFullscreen: () => {
      calls.push('fullscreen')
      return opts.fullscreen ?? ok(undefined)
    },
    emitDisplay: () => calls.push('display'),
  })
  /** The user closed the overlay themselves (Alt+F4 / its own Escape). */
  const userCloses = (): void => {
    open = false
    closedCbs.forEach((cb) => cb())
  }
  return { controller, calls, isOverlayOpen: () => open, userCloses }
}

describe('cinema controller', () => {
  it('enter pins before opening the overlay', async () => {
    const t = setup()
    expect(await t.controller.set(true)).toEqual(ok(undefined))
    expect(t.calls).toEqual([`pin ${DISPLAY}`, 'open', 'display'])
    expect(t.controller.isOpen()).toBe(true)
    expect(t.isOverlayOpen()).toBe(true)
  })

  it('opens the overlay only once the game has run the pin', async () => {
    let release = (): void => undefined
    const t = setup({ settled: () => new Promise<void>((resolve) => (release = resolve)) })
    const entering = t.controller.set(true)
    await Promise.resolve()
    expect(t.calls).toEqual([`pin ${DISPLAY}`])
    release()
    expect(await entering).toEqual(ok(undefined))
    expect(t.calls).toEqual([`pin ${DISPLAY}`, 'open', 'display'])
  })

  it('leaving while the pin is still on its way never opens the overlay', async () => {
    let release = (): void => undefined
    const t = setup({ settled: () => new Promise<void>((resolve) => (release = resolve)) })
    const entering = t.controller.set(true)
    await t.controller.set(false)
    release()
    expect(await entering).toEqual(ok(undefined))
    expect(t.calls).toEqual([`pin ${DISPLAY}`, 'pin null', 'display'])
    expect(t.isOverlayOpen()).toBe(false)
    expect(t.controller.isOpen()).toBe(false)
  })

  it('enter refuses when unavailable', async () => {
    const t = setup({
      availability: {
        available: false,
        reason: { key: 'replays.cinema.unavailable.notPrimaryDisplay' },
      },
    })
    expect(await t.controller.set(true)).toEqual(
      fail('replays.cinema.unavailable.notPrimaryDisplay'),
    )
    expect(t.calls).toEqual([])
    expect(t.isOverlayOpen()).toBe(false)

    const none = setup({ session: false })
    expect(await none.controller.set(true)).toEqual(fail('replays.playback.error.noSession'))
    expect(none.calls).toEqual([])
  })

  it('enter refuses when there is no follower to pin', async () => {
    const t = setup({ follower: false })
    expect(await t.controller.set(true)).toEqual(fail('replays.cinema.unavailable.noStage'))
    expect(t.calls).not.toContain('open')
    expect(t.isOverlayOpen()).toBe(false)
    expect(t.controller.isOpen()).toBe(false)
  })

  it('enter refuses while the demo is fullscreen, and works again once back on the stage', async () => {
    const t = setup()
    t.controller.onDisplayChange(true)
    expect(await t.controller.set(true)).toEqual(fail('replays.cinema.unavailable.fullscreen'))
    expect(t.calls).toEqual([])
    t.controller.onDisplayChange(false)
    expect(await t.controller.set(true)).toEqual(ok(undefined))
    expect(t.controller.isOpen()).toBe(true)
  })

  it('a failed overlay load ends unpinned and not open', async () => {
    const t = setup({ failOpen: true })
    await expect(t.controller.set(true)).rejects.toThrow('load failed')
    expect(t.controller.isOpen()).toBe(false)
    expect(t.isOverlayOpen()).toBe(false)
    expect(t.calls).toEqual([`pin ${DISPLAY}`, 'open', 'close', 'pin null'])
  })

  it('the overlay closing leaves cinema and unpins', async () => {
    const byUser = setup()
    await byUser.controller.set(true)
    byUser.calls.length = 0
    byUser.userCloses()
    expect(byUser.calls).toEqual(['pin null', 'display'])
    expect(byUser.controller.isOpen()).toBe(false)

    const byHandler = setup()
    await byHandler.controller.set(true)
    byHandler.calls.length = 0
    expect(await byHandler.controller.set(false)).toEqual(ok(undefined))
    // Close first, then unpin - never an unpinned follower while the overlay is up.
    expect(byHandler.calls).toEqual(['close', 'pin null', 'display'])
    expect(byHandler.isOverlayOpen()).toBe(false)
  })

  it('fullscreen from cinema closes the overlay and back-to-window returns to the stage', async () => {
    const t = setup()
    await t.controller.set(true)
    t.calls.length = 0
    expect(t.controller.enterFullscreen()).toEqual(ok(undefined))
    // The overlay is gone but the pin stays, so its focus change reaches a pinned follower.
    expect(t.calls).toEqual(['fullscreen', 'close'])
    expect(t.isOverlayOpen()).toBe(false)
    expect(t.controller.isOpen()).toBe(false)
    t.controller.onDisplayChange(true)
    expect(t.calls).toEqual(['fullscreen', 'close'])
    t.calls.length = 0
    t.controller.onDisplayChange(false)
    expect(t.calls).toEqual(['pin null'])

    // A failed fullscreen leaves cinema as it was.
    const refused = setup({ fullscreen: fail('replays.playback.error.noSession') })
    await refused.controller.set(true)
    refused.calls.length = 0
    refused.controller.enterFullscreen()
    expect(refused.calls).toEqual(['fullscreen'])
    expect(refused.isOverlayOpen()).toBe(true)
  })

  it('finished and ended close the overlay', async () => {
    const finished = setup()
    await finished.controller.set(true)
    finished.calls.length = 0
    finished.controller.onPlaybackState('finished')
    expect(finished.calls).toEqual(['close', 'pin null', 'display'])
    expect(finished.isOverlayOpen()).toBe(false)

    const ended = setup()
    await ended.controller.set(true)
    ended.calls.length = 0
    ended.controller.onPlaybackState('ended')
    expect(ended.calls).toEqual(['close', 'display'])
    expect(ended.isOverlayOpen()).toBe(false)
    expect(ended.controller.isOpen()).toBe(false)
  })
})
