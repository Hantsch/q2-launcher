// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../../test-support/mock-client'
import type { DemoRow } from '@shared/modules/replays'
import { initI18n } from '../../../i18n'

/**
 * Story 156 D2. Mirrors `DemoDetailPanel.test.tsx`'s stubbed-client idiom (`vi.mock('../client',
 * ...)`) and `ServerRow.test.tsx`'s `window.q2` stub (this component reads `useLauncher` for
 * `pushToast`, which resolves `window.q2` at module scope via `lib/bridge.ts` - the stub must exist
 * before the store, and anything importing it, is imported).
 */
const invokeMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, value: null })))
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: vi.fn(() => () => {}) }
})

const revealDemo = vi.fn()
const copyDemoPath = vi.fn()
const renameDemo = vi.fn()
const sidecarRead = vi.fn()

vi.mock('../client', (importOriginal) =>
  mockClient<typeof import('../client')>(importOriginal, {
    revealDemo: (demoId: string) => revealDemo(demoId),
    copyDemoPath: (demoId: string) => copyDemoPath(demoId),
    renameDemo: (...args: unknown[]) => renameDemo(...args),
    sidecarRead: (...args: unknown[]) => sidecarRead(...args),
  }),
)

let DemoFileActions: typeof import('./DemoFileActions').DemoFileActions
let useLauncher: typeof import('../../../store/useLauncher').useLauncher

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoFileActions } = await import('./DemoFileActions'))
  ;({ useLauncher } = await import('../../../store/useLauncher'))
})

afterEach(() => {
  cleanup()
  revealDemo.mockReset()
  copyDemoPath.mockReset()
  renameDemo.mockReset()
  sidecarRead.mockReset()
  useLauncher.setState({ toasts: [] })
})

const NOOP = { onRename: vi.fn(), onMove: vi.fn(), onDelete: vi.fn() }
const BASE_DEMO = { id: 'demo-1', fileName: 'demo-1.dm2', archiveEntry: null } as unknown as DemoRow

describe('DemoFileActions (story 156 D2)', () => {
  it('a successful copy shows the path-copied toast (AC2)', async () => {
    copyDemoPath.mockResolvedValue({ ok: true, value: { ok: true } })

    render(createElement(DemoFileActions, { demo: BASE_DEMO, ...NOOP }))
    screen.getByTestId('replays-demo-copy-path').click()

    await vi.waitFor(() => {
      expect(copyDemoPath).toHaveBeenCalledWith('demo-1')
    })
    await vi.waitFor(() => {
      const toasts = useLauncher.getState().toasts
      expect(toasts.some((toast) => toast.messageKey === 'replays.fileActions.pathCopied')).toBe(
        true,
      )
    })
  })

  it('fileMissing shows a persistent inline alert (AC5)', async () => {
    copyDemoPath.mockResolvedValue({
      ok: true,
      value: { ok: false, reasonKey: 'replays.play.error.fileMissing' },
    })

    render(createElement(DemoFileActions, { demo: BASE_DEMO, ...NOOP }))
    screen.getByTestId('replays-demo-copy-path').click()

    const alert = await screen.findByTestId('replays-demo-file-action-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('no longer on disk')
  })

  it('an archive-entry demo disables rename and points it at the panel-rendered reason', () => {
    const archiveDemo = {
      ...BASE_DEMO,
      archiveEntry: { archivePath: 'pack.zip', entryPath: 'test.dm2' },
    } as unknown as DemoRow

    render(createElement(DemoFileActions, { demo: archiveDemo, ...NOOP }))

    const rename = screen.getByTestId('demo-rename') as HTMLButtonElement
    expect(rename.disabled).toBe(true)
    expect(rename.getAttribute('aria-describedby')).toBe('replays-archive-readonly-rename')
  })

  it('a loose demo leaves rename enabled with no read-only notice', () => {
    render(createElement(DemoFileActions, { demo: BASE_DEMO, ...NOOP }))

    const rename = screen.getByTestId('demo-rename') as HTMLButtonElement
    expect(rename.disabled).toBe(false)
    expect(rename.getAttribute('aria-describedby')).toBeNull()
  })

  it('offers Reveal, Copy path and Rename as labelled icon buttons', () => {
    render(createElement(DemoFileActions, { demo: BASE_DEMO, ...NOOP }))
    for (const [id, label] of [
      ['replays-demo-reveal', 'Reveal'],
      ['replays-demo-copy-path', 'Copy path'],
      ['demo-rename', 'Rename'],
    ]) {
      const button = screen.getByTestId(id)
      expect(button.getAttribute('aria-label')).toContain(label)
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    }
  })
  it('Move and Delete call back with the demo shown', () => {
    const onMove = vi.fn()
    const onDelete = vi.fn()
    render(createElement(DemoFileActions, { demo: BASE_DEMO, ...NOOP, onMove, onDelete }))

    screen.getByTestId('demo-move').click()
    screen.getByTestId('demo-delete').click()

    expect(onMove).toHaveBeenCalledWith(BASE_DEMO)
    expect(onDelete).toHaveBeenCalledWith(BASE_DEMO)
  })

  it('an archive-entry demo disables Move and Delete and points them at the visible reason', () => {
    const archiveDemo = {
      ...BASE_DEMO,
      archiveEntry: { archivePath: 'pack.zip', entryPath: 'test.dm2' },
    } as unknown as DemoRow

    render(createElement(DemoFileActions, { demo: archiveDemo, ...NOOP }))

    for (const id of ['demo-move', 'demo-delete']) {
      const button = screen.getByTestId(id) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('aria-describedby')).toBe('replays-archive-readonly-change')
    }
  })
})
