// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../test-support/mock-client'
import type { DemoRow } from '@shared/modules/replays'

vi.mock('../../store/useLauncher', () => ({
  useLauncher: Object.assign((select: (s: unknown) => unknown) => select({ pushToast: vi.fn() }), {
    getState: () => ({ pushToast: vi.fn() }),
  }),
}))
vi.mock('./client', (importOriginal) => mockClient<typeof import('./client')>(importOriginal))

import { useBulkActions } from './useBulkActions'
import { useDemoEditorStore } from './demo-editor-store'

const rows = ['a', 'b', 'c'].map((id) => ({ id, fileName: `${id}.dm2` }) as unknown as DemoRow)

beforeEach(() => {
  useDemoEditorStore.getState().close()
})

describe('useBulkActions', () => {
  it('keeps failed and skipped demos selected and the outcome visible after a run', async () => {
    useDemoEditorStore.getState().selectAll(['a', 'b', 'c'])
    const { result } = renderHook(() => useBulkActions({ rows, reread: () => Promise.resolve() }))

    await act(async () => {
      await result.current.run('delete', ['a', 'b', 'c'], () =>
        Promise.resolve({
          ok: true,
          value: {
            items: [
              { demoId: 'a', status: 'done', reasonKey: null },
              { demoId: 'b', status: 'failed', reasonKey: 'replays.bulk.reason.inUse' },
              { demoId: 'c', status: 'skipped', reasonKey: 'replays.bulk.reason.alreadyThere' },
            ],
          },
        } as never),
      )
    })

    expect(useDemoEditorStore.getState().selectedIds).toEqual(['b', 'c'])
    expect(result.current.outcome).toMatchObject({ done: 1, failed: 1, skipped: 1 })
    expect(result.current.outcome?.entries.map((entry) => entry.name)).toEqual(['b.dm2', 'c.dm2'])
  })
})
