// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FolderEntry } from '@shared/replays/demo-folders'
import { initI18n } from '../../../i18n'

const droppable = vi.hoisted(() => ({ calls: [] as { disabled?: boolean; data?: unknown }[] }))

vi.mock('@dnd-kit/core', () => ({
  useDroppable: (options: { disabled?: boolean; data?: unknown }) => {
    droppable.calls.push(options)
    return { setNodeRef: () => undefined, isOver: false }
  },
}))

import { DemoFolderRow } from './DemoFolderRow'

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  droppable.calls.length = 0
})

const folder = (over: Partial<FolderEntry> = {}): FolderEntry => ({
  ref: { sourceKey: 'src', path: ['a'] },
  name: 'a',
  archive: false,
  demoCount: 1,
  ...over,
})

describe('a folder row as a drop target', () => {
  it('takes a dropped demo into its own folder ref', () => {
    render(<DemoFolderRow folder={folder()} onOpen={vi.fn()} />)
    const last = droppable.calls.at(-1)
    expect(last?.disabled).toBe(false)
    expect(last?.data).toEqual({ ref: { sourceKey: 'src', path: ['a'] } })
  })

  it('refuses drops on an archive folder', () => {
    render(<DemoFolderRow folder={folder({ archive: true })} onOpen={vi.fn()} />)
    expect(droppable.calls.at(-1)?.disabled).toBe(true)
  })
})
