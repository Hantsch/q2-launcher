// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { RttSample, ServerListEntry } from '@shared/modules/servers'
import { initI18n } from '../../i18n'

let ServerReachabilitySection: typeof import('./ServerReachabilitySection').ServerReachabilitySection

beforeAll(async () => {
  await initI18n('en')
  ;({ ServerReachabilitySection } = await import('./ServerReachabilitySection'))
})

afterEach(() => {
  cleanup()
})

function baseEntry(overrides: Partial<ServerListEntry>): ServerListEntry {
  return {
    address: '127.0.0.1:27910',
    origins: ['manual'],
    status: 'online',
    lastSeenAt: null,
    ...overrides,
  } as ServerListEntry
}

function renderSection(entry: ServerListEntry) {
  render(createElement(ServerReachabilitySection, { entry }))
}

describe('ServerReachabilitySection (story 124 D2)', () => {
  it('online entry states it answered the last scan', () => {
    renderSection(baseEntry({ status: 'online', lastSeenAt: '2026-01-01T00:00:00.000Z' }))
    const lastRound = screen.getByTestId('server-reachability-last-round')
    expect(lastRound.textContent).toMatch(/answered the last scan/i)
    expect(lastRound.textContent).not.toMatch(/last answered/i)
  })

  it('stale entry states it did not answer and shows the last-answered time', () => {
    renderSection(baseEntry({ status: 'stale', lastSeenAt: '2026-01-01T00:00:00.000Z' }))
    const lastRound = screen.getByTestId('server-reachability-last-round')
    expect(lastRound.textContent).toMatch(/did not answer the last scan/i)
    expect(lastRound.textContent).toMatch(/last answered/i)
  })

  it('renders samples newest first, null as No answer', () => {
    const rttHistory: RttSample[] = [
      { at: '2026-01-01T00:00:00.000Z', rttMs: 10 },
      { at: '2026-01-01T00:00:01.000Z', rttMs: null },
      { at: '2026-01-01T00:00:02.000Z', rttMs: 20 },
    ]
    renderSection(baseEntry({ status: 'online', rttHistory }))
    const samples = screen.getAllByTestId('server-reachability-sample')
    expect(samples).toHaveLength(3)
    expect(samples[0]?.textContent).toContain('20')
    expect(samples[1]?.textContent).toMatch(/no answer/i)
    expect(samples[2]?.textContent).toContain('10')
    // does not mutate the original array
    expect(rttHistory[0]?.rttMs).toBe(10)
  })

  it('a malformed sample degrades alone', () => {
    const rttHistory: RttSample[] = [
      { at: '2026-01-01T00:00:00.000Z', rttMs: 10 },
      { at: 'not-a-date', rttMs: Number.NaN },
      { at: '2026-01-01T00:00:02.000Z', rttMs: 20 },
    ]
    renderSection(baseEntry({ status: 'online', rttHistory }))
    const samples = screen.getAllByTestId('server-reachability-sample')
    expect(samples).toHaveLength(3)
    expect(samples[0]?.textContent).toContain('20')
    expect(samples[1]?.textContent).toMatch(/unknown/i)
    expect(samples[2]?.textContent).toContain('10')
  })

  it('a valid rttMs with an unparsable at still degrades to Unknown', () => {
    const rttHistory: RttSample[] = [
      { at: '2026-01-01T00:00:00.000Z', rttMs: 10 },
      { at: 'garbage-timestamp', rttMs: 42 },
      { at: '2026-01-01T00:00:02.000Z', rttMs: 20 },
    ]
    renderSection(baseEntry({ status: 'online', rttHistory }))
    const samples = screen.getAllByTestId('server-reachability-sample')
    expect(samples).toHaveLength(3)
    expect(samples[0]?.textContent).toContain('20')
    expect(samples[1]?.textContent).toMatch(/unknown/i)
    expect(samples[1]?.textContent).not.toContain('42')
    expect(samples[2]?.textContent).toContain('10')
  })

  it('no history shows the empty line', () => {
    renderSection(baseEntry({ status: 'online', rttHistory: undefined }))
    expect(screen.queryByTestId('server-reachability-sample')).toBeNull()
    expect(screen.getByText(/no response time measured yet this session/i)).toBeTruthy()
  })
})
