// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'

const { resolveInstall } = vi.hoisted(() => ({
  resolveInstall: vi.fn(async () => ({ ok: true as const, value: null })),
}))
vi.mock('../client', () => ({ resolveInstall }))

const { InstallDecisionDialog } = await import('./InstallDecisionDialog')

beforeAll(async () => {
  await initI18n('en')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InstallDecisionDialog', () => {
  it('lists every conflicting file and sends the chosen answer', async () => {
    const onAnswered = vi.fn()
    render(
      createElement(InstallDecisionDialog, {
        request: {
          jobId: 'job-7',
          folder: 'Action',
          conflicts: ['pak0.pak', 'maps/a.bsp', 'gamex86_64.dll'],
        },
        onAnswered,
      }),
    )

    expect(screen.getByTestId('mods-install-decision-folder').textContent).toBe('Action')
    expect(
      screen.getAllByTestId('mods-install-decision-conflict').map((e) => e.textContent),
    ).toEqual(['pak0.pak', 'maps/a.bsp', 'gamex86_64.dll'])

    fireEvent.click(screen.getByTestId('mods-install-decision-keep'))
    await waitFor(() => expect(resolveInstall).toHaveBeenCalledWith('job-7', 'keep'))
    await waitFor(() => expect(onAnswered).toHaveBeenCalledWith('job-7'))
  })

  it('says so when no file differs', () => {
    render(
      createElement(InstallDecisionDialog, {
        request: { jobId: 'j', folder: 'ctf', conflicts: [] },
        onAnswered: vi.fn(),
      }),
    )
    expect(screen.queryByTestId('mods-install-decision-conflict')).toBeNull()
    expect(screen.getByTestId('mods-install-decision-no-conflicts')).toBeTruthy()
  })
})
