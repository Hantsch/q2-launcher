import { describe, expect, it } from 'vitest'
import { HARNESS_CONTENT_REPO_BASE_ENV, UI_HARNESS_ENV } from '../../../lib/ui-harness'
import { resolveNewsSource } from './harness'

/**
 * Story 082 D4: mirrors `downloads/harness.test.ts`'s own gate test one for one, but asserts the
 * news-specific divergence - "skip, don't fall back to production" - whenever the gate is open and
 * no valid loopback base was named. The environment is passed in as a value (never mutated on
 * `process.env`), same as downloads' own test, so every combination is assertable without
 * `beforeEach`/`afterEach` bookkeeping.
 */

const LOOPBACK_BASE = 'http://127.0.0.1:53129'

describe('resolveNewsSource: the four-case gate', () => {
  it('no harness env var set at all: production', () => {
    expect(resolveNewsSource({ isDev: false, env: {} })).toEqual({ kind: 'production' })
  })

  it('gate closed (isDev false) even with a loopback base named: still production', () => {
    expect(
      resolveNewsSource({
        isDev: false,
        env: { [UI_HARNESS_ENV]: '1', [HARNESS_CONTENT_REPO_BASE_ENV]: LOOPBACK_BASE },
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
