// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../i18n'

const { getMapPresenceMock, getCatalogMock, installModMock, listModsMock, activeRef, jobsRef } =
  vi.hoisted(() => ({
    getMapPresenceMock: vi.fn(),
    getCatalogMock: vi.fn(),
    installModMock: vi.fn(),
    listModsMock: vi.fn(),
    activeRef: { current: null as { id: string; gameDirs: string[] } | null },
    jobsRef: { current: [] as { id: string; status: string }[] },
  }))

vi.mock('../mods/client', () => ({
  getMapPresence: getMapPresenceMock,
  getCatalog: getCatalogMock,
  installMod: installModMock,
  listMods: listModsMock,
  onInstallDecision: () => () => {},
}))
vi.mock('../../store/useLauncher', () => ({
  useActiveInstallation: () => activeRef.current,
  useLauncher: (select: (s: { jobs: unknown[] }) => unknown) => select({ jobs: jobsRef.current }),
}))

const CATALOG = {
  ok: true,
  value: {
    status: 'ok',
    fetchedAt: '',
    fromCache: false,
    ageMs: 0,
    entries: [{ id: 'ctf', gamedir: 'CTF' }],
  },
}

let ServerLocalContentSection: typeof import('./ServerLocalContentSection').ServerLocalContentSection

beforeAll(async () => {
  await initI18n('en')
  ;({ ServerLocalContentSection } = await import('./ServerLocalContentSection'))
})

beforeEach(() => {
  activeRef.current = { id: 'inst-1', gameDirs: ['baseq2', 'opentdm'] }
  jobsRef.current = []
  getMapPresenceMock.mockResolvedValue({ ok: true, value: { available: true } })
  getCatalogMock.mockResolvedValue(CATALOG)
  installModMock.mockResolvedValue({ ok: true, value: { jobId: 'job-1' } })
  listModsMock.mockResolvedValue({ ok: true, value: { gameDirs: [], activeInstalls: [] } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderSection(mod: string | undefined, map: string | undefined) {
  await act(async () => {
    render(createElement(ServerLocalContentSection, { mod, map }))
  })
}

describe('ServerLocalContentSection (story 192 D3)', () => {
  it('says the mod is installed when its gamedir is in the installation', async () => {
    await renderSection('opentdm', 'tdm1')
    const el = screen.getByTestId('servers-detail-mod-status')
    expect(el.getAttribute('data-state')).toBe('installed')
    expect(el.textContent).toBe('Mod installed')
  })

  it('says the mod is missing for an unknown gamedir', async () => {
    await renderSection('zzunknown', 'nomap')
    const el = screen.getByTestId('servers-detail-mod-status')
    expect(el.getAttribute('data-state')).toBe('missing')
    expect(el.textContent).toBe('Mod missing')
  })

  it('shows no mod statement for the base game', async () => {
    await renderSection(undefined, 'q2dm1')
    expect(screen.queryByTestId('servers-detail-mod-status')).toBeNull()
  })

  it('shows map available and map missing from the lookup', async () => {
    await renderSection('opentdm', 'tdm1')
    expect(screen.getByTestId('servers-detail-map-status').getAttribute('data-state')).toBe(
      'available',
    )
    expect(screen.getByTestId('servers-detail-map-status').textContent).toBe('Map available')
    expect(getMapPresenceMock).toHaveBeenCalledWith({
      installationId: 'inst-1',
      map: 'tdm1',
      gameDir: 'opentdm',
    })
    cleanup()
    getMapPresenceMock.mockResolvedValue({ ok: true, value: { available: false } })
    await renderSection('opentdm', 'nomap')
    const el = screen.getByTestId('servers-detail-map-status')
    expect(el.getAttribute('data-state')).toBe('missing')
    expect(el.textContent).toBe('Map missing — the server will send it')
  })

  it('shows no map statement while the lookup is pending or when it fails', async () => {
    getMapPresenceMock.mockReturnValue(new Promise(() => {}))
    await renderSection('opentdm', 'tdm1')
    expect(screen.queryByTestId('servers-detail-map-status')).toBeNull()
    cleanup()
    getMapPresenceMock.mockResolvedValue({ ok: false, error: { code: 'x', messageKey: 'y' } })
    await renderSection('opentdm', 'tdm1')
    expect(screen.queryByTestId('servers-detail-map-status')).toBeNull()
  })

  it('shows only a hint without an active installation', async () => {
    activeRef.current = null
    await renderSection('opentdm', 'tdm1')
    expect(screen.getByTestId('servers-detail-local-content-no-installation').textContent).toBe(
      'No active installation',
    )
    expect(screen.queryByTestId('servers-detail-mod-status')).toBeNull()
    expect(screen.queryByTestId('servers-detail-map-status')).toBeNull()
    expect(getMapPresenceMock).not.toHaveBeenCalled()
  })

  it('treats an unsafe gamedir as missing text and looks the map up without a gameDir', async () => {
    await renderSection('../evil', 'q2dm1')
    expect(screen.getByTestId('servers-detail-mod-status').getAttribute('data-state')).toBe(
      'missing',
    )
    expect(getMapPresenceMock).toHaveBeenCalledWith({ installationId: 'inst-1', map: 'q2dm1' })
  })
})

describe('ServerLocalContentSection install (story 192 D4)', () => {
  it('Install calls the mods install with the active installation and the matched catalog id', async () => {
    await renderSection('ctf', 'q2ctf1')
    const button = screen.getByTestId('servers-detail-mod-install')
    expect(button.textContent).toContain('Install')
    await act(async () => {
      fireEvent.click(button)
    })
    expect(installModMock).toHaveBeenCalledTimes(1)
    expect(installModMock).toHaveBeenCalledWith('inst-1', 'ctf')
  })

  it('offers no Install when the catalog is unavailable, rejected, has no entry or the gamedir is unsafe', async () => {
    getCatalogMock.mockResolvedValue({ ok: true, value: { status: 'unavailable' } })
    await renderSection('ctf', 'm')
    expect(screen.queryByTestId('servers-detail-mod-install')).toBeNull()
    cleanup()
    getCatalogMock.mockRejectedValue(new Error('x'))
    await renderSection('ctf', 'm')
    expect(screen.queryByTestId('servers-detail-mod-install')).toBeNull()
    cleanup()
    getCatalogMock.mockResolvedValue(CATALOG)
    await renderSection('zzunknown', 'm')
    expect(screen.getByTestId('servers-detail-mod-status').getAttribute('data-state')).toBe(
      'missing',
    )
    expect(screen.queryByTestId('servers-detail-mod-install')).toBeNull()
    cleanup()
    await renderSection('../evil', 'm')
    expect(screen.queryByTestId('servers-detail-mod-install')).toBeNull()
    cleanup()
    await renderSection('opentdm', 'm')
    expect(screen.queryByTestId('servers-detail-mod-install')).toBeNull()
  })

  it('keeps a disabled "Installing…" button while a job for the catalog id is active', async () => {
    listModsMock.mockResolvedValue({
      ok: true,
      value: { gameDirs: [], activeInstalls: [{ catalogId: 'ctf', jobId: 'job-9' }] },
    })
    jobsRef.current = [{ id: 'job-9', status: 'running' }]
    await renderSection('ctf', 'q2ctf1')
    const button = screen.getByTestId('servers-detail-mod-install') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('Installing…')
  })
})
