// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ServerDetail, ServersScanState } from '@shared/modules/servers'
import { initI18n } from '../../i18n'

/**
 * Story 122 D3. Mirrors `ServersView.test.tsx`'s mocking style: the module's own typed client
 * (`./client`) is stubbed directly, rather than going through `window.q2`'s `invoke`/`on` plumbing.
 */
const { readServerDetailMock, onScanChangedMock } = vi.hoisted(() => ({
  readServerDetailMock: vi.fn(),
  onScanChangedMock: vi.fn(),
}))

vi.mock('./client', () => ({
  readServerDetail: readServerDetailMock,
  onScanChanged: onScanChangedMock,
}))

/**
 * The deliverable's own test wants a section that actually throws, to prove
 * `ServerDetailSection`'s per-section boundary catches it without taking the rest of the pane
 * down. `ServerDetailHeader` is the only section this D ships, so it is the throwing stand-in here
 * - later stories (123/124) get their own sections and can mock those instead without touching this
 * file's discipline.
 */
vi.mock('./ServerDetailHeader', () => ({
  ServerDetailHeader: () => {
    throw new Error('boom')
  },
}))

let ServerDetailView: typeof import('./ServerDetailView').ServerDetailView

beforeAll(async () => {
  await initI18n('en')
  ;({ ServerDetailView } = await import('./ServerDetailView'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  onScanChangedMock.mockImplementation(() => () => {})
})

const BASE_STATE: ServersScanState = {
  running: false,
  phase: 'idle',
  stage1Done: 0,
  stage1Total: 0,
  stage2Done: 0,
  stage2Total: 0,
  sourceFailures: [],
  startedAt: null,
  finishedAt: null,
  blockedReason: null,
  scope: null,
}

const DETAIL: ServerDetail = {
  row: {
    address: '1.2.3.4:27910',
    origins: ['manual'],
    status: 'online',
    lastSeenAt: 'x',
    favourite: false,
    name: 'Fixture Server',
  },
  serverinfo: null,
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ServerDetailView (story 122 D3)', () => {
  it('a section that throws shows its fallback and the other sections still render', async () => {
    readServerDetailMock.mockResolvedValue({ ok: true, value: DETAIL })
    onScanChangedMock.mockImplementation(() => () => {})

    render(createElement(ServerDetailView, { address: DETAIL.row.address, onClose: () => {} }))
    await flush()

    // `ServerDetailHeader` is mocked (above) to throw - its `ServerDetailSection` wrapper must
    // catch it and render the fallback, while the pane itself (close button, title) still renders
    // around it rather than the whole view crashing.
    expect(await screen.findByTestId('servers-detail-section-error-header')).toBeTruthy()
    expect(screen.getByTestId('servers-detail-close')).toBeTruthy()
  })

  it('re-reads when a scan round finishes', async () => {
    readServerDetailMock.mockResolvedValue({ ok: true, value: DETAIL })
    let changedListener: ((state: ServersScanState) => void) | undefined
    onScanChangedMock.mockImplementation((listener: (state: ServersScanState) => void) => {
      changedListener = listener
      return () => {}
    })

    render(createElement(ServerDetailView, { address: DETAIL.row.address, onClose: () => {} }))
    await flush()

    expect(readServerDetailMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      changedListener?.({ ...BASE_STATE, running: false, finishedAt: '2026-01-01T00:00:00.000Z' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(readServerDetailMock).toHaveBeenCalledTimes(2)

    // A progress-only push (still running) must not trigger another read.
    await act(async () => {
      changedListener?.({ ...BASE_STATE, running: true, finishedAt: null })
      await Promise.resolve()
    })
    expect(readServerDetailMock).toHaveBeenCalledTimes(2)
  })

  it('renders the empty state for a null detail (server no longer in the list)', async () => {
    readServerDetailMock.mockResolvedValue({ ok: true, value: null })

    render(createElement(ServerDetailView, { address: 'gone:1', onClose: () => {} }))
    await flush()

    expect(screen.getByText('This server is no longer in the list')).toBeTruthy()
  })

  it('renders one error line for a rejected read, without throwing', async () => {
    readServerDetailMock.mockResolvedValue({ ok: false, error: { kind: 'internal' } })

    render(createElement(ServerDetailView, { address: 'bad:1', onClose: () => {} }))
    await flush()

    expect(await screen.findByTestId('servers-detail-read-error')).toBeTruthy()
  })

  it('the close button calls onClose', async () => {
    readServerDetailMock.mockResolvedValue({ ok: true, value: DETAIL })
    const onClose = vi.fn()

    render(createElement(ServerDetailView, { address: DETAIL.row.address, onClose }))
    await flush()

    fireEvent.click(screen.getByTestId('servers-detail-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
