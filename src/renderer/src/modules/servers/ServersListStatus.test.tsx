// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ServersScanState } from '@shared/modules/servers'
import { initI18n } from '../../i18n'
import { ServersListStatus } from './ServersListStatus'

let deriveListState: typeof import('./list-state').deriveListState

beforeAll(async () => {
  await initI18n('en')
  ;({ deriveListState } = await import('./list-state'))
})

afterEach(() => {
  cleanup()
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

describe('ServersListStatus', () => {
  it('loading shows live counts', () => {
    const scanState: ServersScanState = {
      ...BASE_STATE,
      running: true,
      stage1Total: 10,
      stage1Done: 4,
    }

    render(
      createElement(ServersListStatus, {
        listState: deriveListState(scanState, 0),
        scanState,
        sourceLabels: {},
        onOpenSourceSettings: () => {},
      }),
    )

    const status = screen.getByTestId('servers-list-loading')
    expect(status.getAttribute('data-found')).toBe('10')
    expect(status.getAttribute('data-pending')).toBe('6')
    expect(status.textContent).toContain('10 servers found')
    expect(status.textContent).toContain('6 still being queried')
  })

  it('empty state says no source returned a server and offers the source-settings link', () => {
    const scanState: ServersScanState = { ...BASE_STATE, finishedAt: 'x' }
    const onOpenSourceSettings = vi.fn()

    render(
      createElement(ServersListStatus, {
        listState: deriveListState(scanState, 0),
        scanState,
        sourceLabels: {},
        onOpenSourceSettings,
      }),
    )

    const empty = screen.getByTestId('servers-list-empty')
    expect(empty.textContent).toContain('No source returned a server')

    fireEvent.click(screen.getByTestId('servers-list-empty-settings'))
    expect(onOpenSourceSettings).toHaveBeenCalledTimes(1)
  })

  it('a failed source is named by its address with its reason', () => {
    const scanState: ServersScanState = {
      ...BASE_STATE,
      finishedAt: 'x',
      sourceFailures: [{ sourceId: 'default-q2servers-udp', reasonKey: 'servers.scan.error.already-running' }],
    }

    render(
      createElement(ServersListStatus, {
        listState: deriveListState(scanState, 0),
        scanState,
        sourceLabels: { 'default-q2servers-udp': 'master.q2servers.com:27900' },
        onOpenSourceSettings: () => {},
      }),
    )

    const failure = screen.getByTestId('servers-list-source-failure-default-q2servers-udp')
    expect(failure.textContent).toContain('master.q2servers.com:27900')
    expect(failure.textContent).not.toContain('default-q2servers-udp')
  })
})
