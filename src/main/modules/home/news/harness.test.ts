import { describe, expect, it } from 'vitest'
import { HARNESS_CONTENT_REPO_BASE_ENV, UI_HARNESS_ENV } from '../../../lib/ui-harness'
import { resolveNewsSource } from './harness'

/**
 * Story 082 D4 (relaxed by story 101 F3): mirrors `downloads/harness.test.ts`'s own gate test one
 * for one, but asserts the news-specific divergence - "skip, don't fall back to production" -
 * whenever the gate is open and no valid loopback base was named. The gate is `Q2L_UI_HARNESS ===
 * '1'` alone; `isDev` is not part of it (see `src/main/lib/ui-harness.ts`'s module comment). The
 * environment is passed in as a value (never mutated on `process.env`), same as downloads' own
 * test, so every combination is assertable without `beforeEach`/`afterEach` bookkeeping.
 */

const LOOPBACK_BASE = 'http://127.0.0.1:53129'

describe('resolveNewsSource: the gate', () => {
  it('no harness env var set at all: production', () => {
    expect(resolveNewsSource({ isDev: false, env: {} })).toEqual({ kind: 'production' })
  })

  it('isDev false but the env var is set and names a valid loopback base: loopback, not production', () => {
    expect(
      resolveNewsSource({
        isDev: false,
        env: { [UI_HARNESS_ENV]: '1', [HARNESS_CONTENT_REPO_BASE_ENV]: LOOPBACK_BASE },
      }),
    ).toEqual({ kind: 'loopback', base: LOOPBACK_BASE })
  })

  it('isDev true but the env var is unset: still production - isDev alone is never enough', () => {
    expect(
      resolveNewsSource({
        isDev: true,
        env: { [HARNESS_CONTENT_REPO_BASE_ENV]: LOOPBACK_BASE },
      }),
    ).toEqual({ kind: 'production' })
  })

  it('gate open and a valid 127.0.0.1 loopback base is named: loopback with that base', () => {
    expect(
      resolveNewsSource({
        isDev: true,
        env: { [UI_HARNESS_ENV]: '1', [HARNESS_CONTENT_REPO_BASE_ENV]: LOOPBACK_BASE },
      }),
    ).toEqual({ kind: 'loopback', base: LOOPBACK_BASE })
  })

  it('gate open but the env var is malformed: skip, NOT a fallback to production', () => {
    expect(
      resolveNewsSource({
        isDev: true,
        env: { [UI_HARNESS_ENV]: '1', [HARNESS_CONTENT_REPO_BASE_ENV]: 'not-a-url' },
      }),
    ).toEqual({ kind: 'skip' })
  })

  it('gate open but the env var is unset: skip', () => {
    expect(resolveNewsSource({ isDev: true, env: { [UI_HARNESS_ENV]: '1' } })).toEqual({
      kind: 'skip',
    })
  })

  it('gate open but the env var names a real, non-loopback host: skip', () => {
    expect(
      resolveNewsSource({
        isDev: true,
        env: {
          [UI_HARNESS_ENV]: '1',
          [HARNESS_CONTENT_REPO_BASE_ENV]: 'https://raw.githubusercontent.com/evil/content/main',
        },
      }),
    ).toEqual({ kind: 'skip' })
  })
})
