// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Installation, ValidationCheck } from '@shared/types'
import type { RepairOffer, RepairPlan } from '@shared/modules/downloads'
import { initI18n } from '../../../i18n'
import { useLauncher } from '../../../store/useLauncher'
import { RepairDialog } from './RepairDialog'

/**
 * Story 093 D5. Mirrors `DownloadsView.test.tsx`'s conventions: `./client` is stubbed via
 * `vi.mock` so the fetched plan is controlled exactly, and the real Zustand store
 * (`useLauncher.setState`) seeds `installations`/`jobs`/`dialog` directly rather than driving a
 * real IPC round trip. `useFixAction` (`components/installations/ChecksList`) is stubbed the same
 * way so the `'set-write-dir'` offer's assertion is "was the hook called with the right fix",
 * never the fix's own IPC behaviour (that belongs to `ChecksList`'s own tests).
 */

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn(() => () => {}),
  }
})

const getRepairPlan = vi.fn()
const startRepair = vi.fn()

vi.mock('../client', () => ({
  getRepairPlan: (...args: unknown[]) => getRepairPlan(...(args as [])),
  startRepair: (...args: unknown[]) => startRepair(...(args as [])),
}))

const runFixMock = vi.fn(async () => {})

vi.mock('../../../components/installations/ChecksList', () => ({
  useFixAction: () => runFixMock,
}))

const installation: Installation = {
  id: 'inst-1',
  name: 'Quake II',
  rootPath: 'D:\\Games\\Quake II',
  engine: 'q2pro',
  status: 'ok',
  checks: [],
} as unknown as Installation

function finding(overrides: Partial<ValidationCheck> = {}): ValidationCheck {
  return {
    id: 'base-paks',
    severity: 'error',
    messageKey: 'validation.pak0Missing',
    ...overrides,
  }
}

function offer(overrides: Partial<RepairOffer> = {}): RepairOffer {
  return {
    kind: 'retail-copy',
    messageKey: 'validation.pak0Missing',
    ...overrides,
  }
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useLauncher.setState({ installations: [], jobs: [], dialog: { kind: 'none' } })
})

describe('RepairDialog', () => {
  it('fetches the plan on open and renders one row per offer', async () => {
    const plan: RepairPlan = {
      installationId: installation.id,
      offers: [
        offer({ kind: 'retail-copy' }),
        offer({ kind: 'set-write-dir', messageKey: 'validation.notWritable' }),
      ],
      findings: [finding()],
    }
    getRepairPlan.mockResolvedValue({ ok: true, value: plan })
    useLauncher.setState({ installations: [installation] })

    render(<RepairDialog installationId={installation.id} />)

    await waitFor(() => expect(getRepairPlan).toHaveBeenCalledWith(installation.id))
    expect(await screen.findByTestId('repair-offer-retail-copy')).toBeTruthy()
    expect(screen.getByTestId('repair-offer-set-write-dir')).toBeTruthy()
  })

  it("switches the module dialog's view to 'retail-upgrade' for the retail-copy offer", async () => {
    const plan: RepairPlan = {
      installationId: installation.id,
      offers: [offer({ kind: 'retail-copy' })],
      findings: [finding()],
    }
    getRepairPlan.mockResolvedValue({ ok: true, value: plan })
    const openDialog = vi.fn()
    useLauncher.setState({ installations: [installation], openDialog })

    render(<RepairDialog installationId={installation.id} />)

    const button = await screen.findByTestId('repair-offer-retail-copy')
    button.click()

    expect(openDialog).toHaveBeenCalledWith({
      kind: 'module',
      moduleId: 'downloads',
      view: 'retail-upgrade',
      installationId: installation.id,
    })
    expect(startRepair).not.toHaveBeenCalled()
  })

  it("calls useFixAction with 'set-write-dir' for the set-write-dir offer", async () => {
    const plan: RepairPlan = {
      installationId: installation.id,
      offers: [offer({ kind: 'set-write-dir', messageKey: 'validation.notWritable' })],
      findings: [finding({ messageKey: 'validation.notWritable' })],
    }
    getRepairPlan.mockResolvedValue({ ok: true, value: plan })
    useLauncher.setState({ installations: [installation] })

    render(<RepairDialog installationId={installation.id} />)

    const button = await screen.findByTestId('repair-offer-set-write-dir')
    button.click()

    await waitFor(() => expect(runFixMock).toHaveBeenCalledWith(installation, 'set-write-dir'))
    expect(startRepair).not.toHaveBeenCalled()
  })

  it('renders findings and the empty-state message with no action button when there are no offers', async () => {
    const plan: RepairPlan = {
      installationId: installation.id,
      offers: [],
      findings: [finding({ messageKey: 'validation.engineUnknown' })],
    }
    getRepairPlan.mockResolvedValue({ ok: true, value: plan })
    useLauncher.setState({ installations: [installation] })

    render(<RepairDialog installationId={installation.id} />)

    expect(await screen.findByTestId('repair-empty')).toBeTruthy()
    expect(screen.queryAllByTestId(/repair-offer-/)).toHaveLength(0)
  })
})
