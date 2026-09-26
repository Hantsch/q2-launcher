// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '../../i18n'

let ServerRulesPanel: typeof import('./ServerRulesPanel').ServerRulesPanel

beforeAll(async () => {
  await initI18n('en')
  ;({ ServerRulesPanel } = await import('./ServerRulesPanel'))
})

afterEach(() => {
  cleanup()
})

function renderPanel(serverinfo: Record<string, string> | undefined) {
  render(createElement(ServerRulesPanel, { serverinfo }))
}

describe('ServerRulesPanel (story 123 D3)', () => {
  it('renders every reported key as a row', () => {
    renderPanel({
      hostname: 'Fixture Server',
      mapname: 'q2dm1',
      gamename: 'baseq2',
      maxclients: '16',
      protocol: '34',
      deathmatch: '1',
      fraglimit: '20',
      matchmode: '1',
      actionversion: '2.1',
    })

    const panel = screen.getByTestId('servers-detail-rules')
    for (const key of [
      'hostname',
      'mapname',
      'gamename',
      'maxclients',
      'protocol',
      'deathmatch',
      'fraglimit',
      'matchmode',
      'actionversion',
    ]) {
      expect(within(panel).getAllByTestId('rule-row').some((row) => row.dataset.key === key)).toBe(
        true,
      )
    }
  })

  it('shows the dmflags caveat with the decoded rules', () => {
    renderPanel({
      hostname: 'Fixture Server',
      dmflags: '65800', // 8 + 256 + 65536
    })

    const dmflagsSection = screen.getByTestId('rules-dmflags')
    expect(dmflagsSection.textContent).toContain(
      'Vanilla Quake II meaning — mods may reuse these bits for other rules.',
    )
    expect(dmflagsSection.textContent).toContain('No falling damage')
    expect(dmflagsSection.textContent).toContain('No friendly fire')
    expect(dmflagsSection.textContent).toContain('Unknown bit 16')
  })

  it('a malformed value degrades on its own row', () => {
    renderPanel({
      hostname: 'Fixture Server',
      timelimit: 'abc',
    })

    const panel = screen.getByTestId('servers-detail-rules')
    const rows = within(panel).getAllByTestId('rule-row')
    const timelimitRow = rows.find((row) => row.dataset.key === 'timelimit')
    expect(timelimitRow?.textContent).toContain('abc')
    expect(timelimitRow?.textContent).toContain('not understood')

    const hostnameRow = rows.find((row) => row.dataset.key === 'hostname')
    expect(hostnameRow?.textContent).toContain('Fixture Server')
  })

  it('states an empty state without status data', () => {
    renderPanel(undefined)

    const panel = screen.getByTestId('servers-detail-rules')
    expect(panel.textContent).toContain(
      'No rule data yet — the server has not answered a full status query.',
    )
    expect(screen.queryByTestId('rules-known')).toBeNull()
    expect(screen.queryByTestId('rules-raw')).toBeNull()
    expect(screen.queryByTestId('rules-dmflags')).toBeNull()
  })
})
