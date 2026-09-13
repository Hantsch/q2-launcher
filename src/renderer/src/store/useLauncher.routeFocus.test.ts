// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Story 087 D5: the shell's one-shot route focus - the "open this thing" hint `setRoute` can carry
 * and the destination view consumes exactly once.
 *
 * `store/useLauncher.ts` reaches `lib/bridge.ts`, which resolves `window.q2` at *module* scope and
 * throws when it is missing, so the bridge is stubbed via `vi.hoisted` before the store is imported
 * (`InstallationProfilesPanel.test.ts`'s precedent). `setRoute` also fires a `settings:patch` for
 * `lastRoute`; the stub records those calls so the "never persisted" half of the contract can be
 * asserted too. No React rendering here - the store's actions are called directly.
 */

const invoked = vi.hoisted(() => {
  const calls: Array<{ channel: string; payload?: unknown }> = []
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: (channel: string, payload?: unknown) => {
      calls.push({ channel, payload })
      return Promise.resolve(undefined)
    },
    on: () => () => {},
  }
  return calls
})

const { useLauncher, ROUTE_HOME } = await import('./useLauncher')

beforeEach(() => {
  useLauncher.setState({ route: ROUTE_HOME, routeFocus: null })
  invoked.length = 0
})

afterEach(() => {
  useLauncher.setState({ route: ROUTE_HOME, routeFocus: null })
})

describe('useLauncher route focus', () => {
  it('hands a focus set for the current route back exactly once', () => {
    useLauncher.getState().setRoute('/config', 'profile-1')

    expect(useLauncher.getState().route).toBe('/config')
    expect(useLauncher.getState().consumeRouteFocus()).toBe('profile-1')
    // Consumed: a second read (a remount of the destination view) gets nothing.
    expect(useLauncher.getState().consumeRouteFocus()).toBeUndefined()
    expect(useLauncher.getState().routeFocus).toBeNull()
  })

  it('a route switch without a focus argument leaves nothing to consume', () => {
    useLauncher.getState().setRoute('/config')

    expect(useLauncher.getState().routeFocus).toBeNull()
    expect(useLauncher.getState().consumeRouteFocus()).toBeUndefined()
  })

  it('a never-consumed focus is not handed to whichever route is navigated to next', () => {
    useLauncher.getState().setRoute('/config', 'profile-1')
    useLauncher.getState().setRoute('/library')

    expect(useLauncher.getState().consumeRouteFocus()).toBeUndefined()
    expect(useLauncher.getState().routeFocus).toBeNull()
  })

  it('is not persisted: only the route reaches settings.lastRoute', () => {
    useLauncher.getState().setRoute('/config', 'profile-1')

    expect(invoked).toEqual([{ channel: 'settings:patch', payload: { lastRoute: '/config' } }])
  })
})
