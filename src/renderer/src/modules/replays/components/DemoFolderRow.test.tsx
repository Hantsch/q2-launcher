// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FolderEntry } from '@shared/replays/demo-folders'
import { initI18n } from '../../../i18n'
import { DemoFolderRow } from './DemoFolderRow'

beforeAll(async () => {
  await initI18n('en')
})

afterEach(cleanup)

const folder = (over: Partial<FolderEntry> = {}): FolderEntry => ({
  ref: { sourceKey: 'src', path: ['a'] },
  name: 'a',
  archive: false,
  demoCount: 1,
  ...over,
})

describe('the folder row rename control', () => {
  it('is absent on a source root', () => {
    render(
      <DemoFolderRow
        folder={folder({ ref: { sourceKey: 'src', path: [] } })}
        onOpen={vi.fn()}
        onRename={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('replays-folder-rename')).toBeNull()
  })

  it('asks to rename the folder without opening it', () => {
    const onRename = vi.fn()
    const onOpen = vi.fn()
    const entry = folder()
    render(<DemoFolderRow folder={entry} onOpen={onOpen} onRename={onRename} />)
    const button = screen.getByTestId('replays-folder-rename')
    fireEvent.click(button)
    fireEvent.doubleClick(button)
    expect(onRename).toHaveBeenCalledWith(entry)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('is disabled inside a zip and the read-only reason stays visible', () => {
    const onRename = vi.fn()
    render(
      <DemoFolderRow folder={folder({ archive: true })} onOpen={vi.fn()} onRename={onRename} />,
    )
    const button = screen.getByTestId('replays-folder-rename') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('Archive — read-only')).toBeTruthy()
    expect(button.getAttribute('aria-describedby')).toBe(
      screen.getByTestId('replays-folder-archive').id,
    )
  })
})
