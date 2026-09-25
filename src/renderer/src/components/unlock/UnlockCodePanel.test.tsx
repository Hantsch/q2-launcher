// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RedeemResult, UnlockRejectReason, UnlockState } from '@shared/types'
import { initI18n } from '../../i18n'
import type { UnlockCodePanel as UnlockCodePanelType } from './UnlockCodePanel'

const EMPTY_STATE: UnlockState = { installationId: 'ABCD-1234-EFGH', codes: [] }

let getStateResult: UnlockState = EMPTY_STATE
let redeemResult: RedeemResult = { ok: false, reason: 'not-a-code' }

function defaultInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  // `unlock:getState` is a plain `handle` channel - it resolves to the `UnlockState` value
  // directly, unlike `unlock:redeem` (`handleOutcome`) and `app:copyText`, which resolve to an
  // `Outcome<T>` wrapper. Mirrors `src/main/ipc/unlock.ts` and `src/shared/ipc.ts` exactly.
  if (channel === 'unlock:getState') {
    return Promise.resolve(getStateResult)
  }
  if (channel === 'unlock:redeem') {
    return Promise.resolve({ ok: true, value: redeemResult })
  }
  if (channel === 'app:copyText') {
    return Promise.resolve({ ok: true, value: null })
  }
  return Promise.reject(new Error(`unexpected channel ${channel} ${JSON.stringify(args)}`))
}

;(globalThis as unknown as { q2: unknown }).q2 = {
  invoke: vi.fn(defaultInvoke),
  on: vi.fn(() => () => {}),
}

let UnlockCodePanel: typeof UnlockCodePanelType

beforeAll(async () => {
  await initI18n('en')
  ;({ UnlockCodePanel } = await import('./UnlockCodePanel'))
})

afterEach(() => {
  cleanup()
  getStateResult = EMPTY_STATE
  redeemResult = { ok: false, reason: 'not-a-code' }
  ;(globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }).q2.invoke.mockImplementation(
    defaultInvoke,
  )
})

async function renderPanel() {
  render(createElement(UnlockCodePanel))
  await act(async () => {
    await Promise.resolve()
  })
}

async function submitCode(code: string) {
  fireEvent.change(screen.getByTestId('unlock-code-input'), { target: { value: code } })
  fireEvent.click(screen.getByTestId('unlock-code-submit'))
  await act(async () => {
    await Promise.resolve()
  })
}

describe('UnlockCodePanel', () => {
  it('shows the installation id and copies it verbatim', async () => {
    await renderPanel()

    const idEl = await screen.findByTestId('unlock-installation-id')
    expect(idEl.textContent).toBe('ABCD-1234-EFGH')

    fireEvent.click(screen.getByTestId('unlock-copy-id'))

    await waitFor(() =>
      expect(
        (globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }).q2.invoke,
      ).toHaveBeenCalledWith('app:copyText', 'ABCD-1234-EFGH'),
    )
  })

  it('each of the five rejection reasons renders its own distinct text', async () => {
    const reasons: UnlockRejectReason[] = [
      'not-a-code',
      'bad-signature',
      'wrong-installation',
      'redeem-window-elapsed',
      'feature-expired',
    ]

    const seenTexts = new Set<string>()

    for (const reason of reasons) {
      redeemResult = { ok: false, reason }
      await renderPanel()

      await submitCode('SOME-CODE')

      const alert = await screen.findByTestId('unlock-result-rejected')
      expect(alert.textContent).toBeTruthy()
      expect(seenTexts.has(alert.textContent!)).toBe(false)
      seenTexts.add(alert.textContent!)

      cleanup()
    }

    expect(seenTexts.size).toBe(5)
  })

  it('an accepted code lists its features and expiry immediately', async () => {
    const expiry = Date.UTC(2027, 0, 15)
    redeemResult = {
      ok: true,
      code: { features: ['servers-pro'], featureExpiry: expiry, label: null, status: 'active' },
    }
    await renderPanel()

    await submitCode('GOOD-CODE')

    const accepted = await screen.findByTestId('unlock-result-accepted')
    expect(accepted.textContent).toContain('servers-pro')
    expect(accepted.textContent).toMatch(/2027/)
  })

  it('an accepted code without expiry says it does not expire', async () => {
    redeemResult = {
      ok: true,
      code: { features: ['servers-pro'], featureExpiry: null, label: null, status: 'active' },
    }
    await renderPanel()

    await submitCode('GOOD-CODE')

    const accepted = await screen.findByTestId('unlock-result-accepted')
    expect(accepted.textContent).toContain('Does not expire')
  })

  it('an expired stored code says it expired', async () => {
    const expiry = Date.UTC(2020, 0, 1)
    getStateResult = {
      installationId: 'ABCD-1234-EFGH',
      codes: [{ features: ['servers-pro'], featureExpiry: expiry, label: null, status: 'expired' }],
    }
    await renderPanel()

    const row = await screen.findByTestId('unlock-code-row')
    expect(row.textContent).toMatch(/expired/i)
  })
})
