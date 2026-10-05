// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DemoRow } from '@shared/modules/replays'
import type { FolderEntry } from '@shared/replays/demo-folders'
import { initI18n } from '../../../i18n'
import type { RowMenuActions, RowMenuTarget } from './DemoRowMenu'

// `DemoRowMenu` reads `useLauncher`, which resolves `window.q2` when first imported.
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true as const, value: null })),
    on: vi.fn(() => () => {}),
  }
})

let DemoRowMenu: typeof import('./DemoRowMenu').DemoRowMenu
let DemoFolderRow: typeof import('./DemoFolderRow').DemoFolderRow

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoRowMenu } = await import('./DemoRowMenu'))
  ;({ DemoFolderRow } = await import('./DemoFolderRow'))
})

afterEach(cleanup)

const demo = (id: string, zip = false): DemoRow =>
  ({ id, fileName: `${id}.dm2`, archiveEntry: zip ? { archivePath: 'p.zip' } : null }) as DemoRow
const folder = (over: Partial<FolderEntry> = {}): FolderEntry => ({
  ref: { sourceKey: 'src', path: ['a'] },
  name: 'a',
  archive: false,
  demoCount: 2,
  ...over,
})

function actions(): RowMenuActions {
  return {
    onRename: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    onTag: vi.fn(),
    onRenameFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
  }
}

function open(target: RowMenuTarget, handlers = actions()) {
  render(<DemoRowMenu at={{ x: 10, y: 10 }} target={target} actions={handlers} onClose={vi.fn()} />)
  return handlers
}

const labels = () => screen.getAllByRole('menuitem').map((item) => item.textContent)

describe('the demo row menu', () => {
  it('offers the five single-demo actions and focuses the first on open', () => {
    open({ kind: 'demo', demo: demo('a'), selection: [demo('a')] })
    expect(labels()).toEqual([
      'Reveal in file manager',
      'Copy path',
      'Rename demo',
      'Move…',
      'Delete…',
    ])
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0])
  })

  it('offers delete, tag and move over a selection and passes every selected id', () => {
    const a = demo('a')
    const b = demo('b')
    const handlers = open({ kind: 'demo', demo: a, selection: [a, b] })
    expect(labels()).toEqual(['Delete 2 demos…', 'Tag', 'Move 2 demos…'])
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete 2 demos/ }))
    expect(handlers.onDelete).toHaveBeenCalledWith(['a', 'b'])
  })

  it('disables rename, move and delete for a zip entry and says why in text', () => {
    open({ kind: 'demo', demo: demo('z', true), selection: [demo('z', true)] })
    for (const name of [/Rename demo/, /Move…/, /Delete…/]) {
      expect(screen.getByRole('menuitem', { name })).toHaveProperty('disabled', true)
    }
    expect(screen.getAllByText(/archive is read-only/).length).toBeGreaterThan(0)
  })

  it('disables folder delete on a source root with the reason as text', () => {
    open({ kind: 'folder', folder: folder({ ref: { sourceKey: 'src', path: [] } }) })
    expect(screen.getByRole('menuitem', { name: /Delete folder…/ })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByText("A demo source's own folder can't be deleted.")).toBeTruthy()
  })

  it('asks to delete a folder row from its menu', () => {
    const entry = folder()
    const handlers = open({ kind: 'folder', folder: entry })
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete folder…/ }))
    expect(handlers.onDeleteFolder).toHaveBeenCalledWith(entry)
  })
})

describe('the folder row menu request', () => {
  it('opens on right-click and on Shift+F10 without opening the folder', () => {
    const onContextMenu = vi.fn()
    const onOpen = vi.fn()
    render(<DemoFolderRow folder={folder()} onOpen={onOpen} onContextMenu={onContextMenu} />)
    const row = screen.getByTestId('replays-folder-row')
    fireEvent.contextMenu(row, { clientX: 5, clientY: 6 })
    expect(onContextMenu).toHaveBeenLastCalledWith(expect.anything(), { x: 5, y: 6 })
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
    fireEvent.keyDown(row, { key: 'ContextMenu' })
    expect(onContextMenu).toHaveBeenCalledTimes(3)
    expect(onOpen).not.toHaveBeenCalled()
  })
})
