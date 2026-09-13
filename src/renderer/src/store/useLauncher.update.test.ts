// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/types'
import en from '../i18n/locales/en.json'

/**
 * The complete set of `update.error.*` keys `src/main/services/update/service.ts`'s
 * `UPDATE_ERROR_KEYS` can produce. Hardcoded rather than imported: that file lives in
 * `src/main` (`tsconfig.node.json`), and renderer code/tests belong to `tsconfig.web.json` -
 * `src/shared` is the only thing built into both (docs/ARCHITECTURE.md), so a renderer test
 * reaching into `src/main` would cross the same boundary the two-tsconfig split exists to
 * enforce. Keep this list byte-for-byte in sync with `UPDATE_ERROR_KEYS` by hand.
 */
const UPDATE_ERROR_KEYS = [
  'update.error.network',
  'update.error.http',
  'update.error.notConfigured',
  'update.error.timeout',
  'update.error.unknown',
]

/**
 * Story 097 D6: the renderer's read-only mirror of the update-check service's state - `bootstrap`
 * calls `update:getState` once, then an `update:state` push replaces it from then on. Same
 * module-scope-bridge stubbing as `useLauncher.routeFocus.test.ts` (`window.q2` is resolved at
 * *module* scope by `lib/bridge.ts`, so the stub must exist before the store is imported), but
 * `bootstrap` here calls several channels at once and subscribes to several events at once, so the
 * stub answers `invoke` per channel and keeps one listener per event channel rather than a single
 * slot.
 */

const IDLE_UPDATE_STATE: UpdateState = {
  status: 'idle',
  phase: 'idle',
  update: null,
  error: null,
  progress: null,
  dismissed: false,
  lastCheckedAt: null,
  lastSuccessAt: null,
  supported: false,
}

const AVAILABLE_UPDATE_STATE: UpdateState = {
  status: 'available',
  phase: 'available',
  update: { version: '1.2.3', notes: 'Notes', releasedAt: '2026-01-01T00:00:00.000Z' },
  error: null,
  progress: null,
  dismissed: false,
  lastCheckedAt: '2026-01-01T00:00:00.000Z',
  lastSuccessAt: '2026-01-01T00:00:00.000Z',
  supported: true,
}

const bridge = vi.hoisted(() => {
  const listeners = new Map<string, (payload: unknown) => void>()

  // Bootstrap's `Promise.all` invokes these channels; each gets a bare-minimum value that lets
  // `bootstrap` complete without throwing. `update:getState` is the one this test cares about, so
  // it starts at the idle default and each test can override it via `responses.set(...)`.
  const responses = new Map<string, unknown>([
    ['app:getInfo', {}],
    ['settings:get', { lastRoute: undefined, activeInstallationId: null, locale: 'en' }],
    ['installations:list', []],
    ['modules:list', []],
    ['jobs:list', []],
    ['launch:getState', { phase: 'idle', installationId: null }],
    ['window:getState', { maximized: false, fullScreen: false, focused: true }],
    [
      'update:getState',
      {
        status: 'idle',
        phase: 'idle',
        update: null,
        error: null,
        progress: null,
        dismissed: false,
        lastCheckedAt: null,
        lastSuccessAt: null,
        supported: false,
      } satisfies UpdateState,
    ],
  ])

  const invoke = vi.fn((channel: string) => Promise.resolve(responses.get(channel)))
  const on = vi.fn((channel: string, listener: (payload: unknown) => void) => {
    listeners.set(channel, listener)
    return () => listeners.delete(channel)
  })

  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke, on }

  return { listeners, responses, invoke }
})

const { useLauncher } = await import('./useLauncher')

function emitUpdateState(next: UpdateState): void {
  bridge.listeners.get('update:state')?.(next)
}

beforeEach(() => {
  bridge.responses.set('update:getState', IDLE_UPDATE_STATE)
  bridge.invoke.mockClear()
  useLauncher.setState({ update: IDLE_UPDATE_STATE })
})

describe('useLauncher update slice', () => {
  it('bootstrap reads the initial state from update:getState', async () => {
    bridge.responses.set('update:getState', AVAILABLE_UPDATE_STATE)

    await useLauncher.getState().bootstrap()

    expect(useLauncher.getState().update).toEqual(AVAILABLE_UPDATE_STATE)
  })

  it('an update:state event replaces the store state, not merges it', async () => {
    await useLauncher.getState().bootstrap()
    expect(useLauncher.getState().update).toEqual(IDLE_UPDATE_STATE)

    emitUpdateState(AVAILABLE_UPDATE_STATE)
    expect(useLauncher.getState().update).toEqual(AVAILABLE_UPDATE_STATE)

    const errorState: UpdateState = {
      status: 'error',
      phase: 'error',
      update: null,
      error: { key: 'update.error.network' },
      progress: null,
      dismissed: false,
      lastCheckedAt: '2026-01-02T00:00:00.000Z',
      lastSuccessAt: null,
      supported: true,
    }
    emitUpdateState(errorState)

    // A full replace: nothing from the previously-pushed `AVAILABLE_UPDATE_STATE` (e.g. its
    // `update`/`lastSuccessAt`) survives into the new state.
    expect(useLauncher.getState().update).toEqual(errorState)
  })
})

describe('update.error.* i18n coverage', () => {
  it('every key the update-check service can produce exists in en.json as a non-empty string', () => {
    for (const key of UPDATE_ERROR_KEYS) {
      const value = key
        .split('.')
        .reduce<unknown>(
          (node, segment) =>
            node && typeof node === 'object'
              ? (node as Record<string, unknown>)[segment]
              : undefined,
          en,
        )
      expect(typeof value, `${key} should be a string in en.json`).toBe('string')
      expect((value as string).length, `${key} should not be empty`).toBeGreaterThan(0)
    }
  })
})
