// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useDraggable } from '@dnd-kit/core'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FolderEntry } from '@shared/replays/demo-folders'
import { initI18n } from '../../../i18n'
import { DemoDragZone } from './DemoDragZone'
import { DemoFolderRow } from './DemoFolderRow'

beforeAll(async () => {
  await initI18n('en')
  // jsdom lays nothing out: give the demo and the folder row distinct rects so the nearest-folder
  // lookup of a keyboard drag has something to measure.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this.dataset.testid === 'replays-folder-row' ? 100 : 0
    return {
      top,
      left: 0,
      bottom: top + 40,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: top,
    } as DOMRect
  })
})

afterEach(cleanup)

const folder: FolderEntry = {
  ref: { sourceKey: 'src', path: ['a'] },
  name: 'a',
  archive: false,
  demoCount: 0,
}

function Demo() {
  const { setNodeRef, listeners } = useDraggable({ id: 'demo-1', data: { fileName: 'x.dm2' } })
  return (
    <div
      ref={setNodeRef}
      tabIndex={0}
      data-testid="demo"
      onKeyDown={listeners?.onKeyDown as React.KeyboardEventHandler<HTMLDivElement>}
    />
  )
}

describe('DemoDragZone keyboard drag', () => {
  it('moves a demo onto a folder with Ctrl+Space, an arrow and Enter', async () => {
    const onMove = vi.fn()
    const { getByTestId } = render(
      <DemoDragZone onMove={onMove}>
        <Demo />
        <DemoFolderRow folder={folder} onOpen={vi.fn()} />
      </DemoDragZone>,
    )
    const demo = getByTestId('demo')

    fireEvent.keyDown(demo, { code: 'Space', key: ' ' })
    await new Promise((r) => setTimeout(r, 20))
    expect(getByTestId('replays-folder-row').getAttribute('data-drop-over')).toBeNull()

    fireEvent.keyDown(demo, { code: 'Space', key: ' ', ctrlKey: true })
    await new Promise((r) => setTimeout(r, 20))
    fireEvent.keyDown(document, { code: 'ArrowDown', key: 'ArrowDown' })
    await waitFor(() =>
      expect(getByTestId('replays-folder-row').getAttribute('data-drop-over')).toBe('true'),
    )
    fireEvent.keyDown(document, { code: 'Enter', key: 'Enter' })

    await waitFor(() => expect(onMove).toHaveBeenCalledWith('demo-1', folder.ref))
  })
})
