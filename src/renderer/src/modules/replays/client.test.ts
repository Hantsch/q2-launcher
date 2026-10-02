// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NameTemplatesView } from '@shared/replays/name-templates'

/** Same module-scope-bridge stubbing as `home/client.test.ts`: the client imports `moduleClient.ts`,
 * which reaches `window.q2` through `lib/bridge.ts` at import time. */
const invokeMock = vi.fn()
;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: vi.fn(() => () => {}) }

const { listNameTemplates } = await import('./client')

const VIEW: NameTemplatesView = { entries: [], canRestore: false }

beforeEach(() => {
  invokeMock.mockReset()
})

describe('replays client', () => {
  it('a handler ok arrives as the function’s value', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: VIEW })

    const result = await listNameTemplates()

    expect(invokeMock).toHaveBeenCalledWith('module:invoke', {
      moduleId: 'replays',
      type: 'nameTemplates.list',
    })
    expect(result).toEqual({ ok: true, value: VIEW })
  })

  it('a handler fail arrives as the function’s fail', async () => {
    const error = { key: 'replays.nameTemplates.error.tooMany' }
    invokeMock.mockResolvedValue({ ok: false, error })

    expect(await listNameTemplates()).toEqual({ ok: false, error })
  })
})
