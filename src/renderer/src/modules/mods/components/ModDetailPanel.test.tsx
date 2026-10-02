// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import type { ModTileModel } from '../merge-mod-tiles'

const preview = (changedFiles: string[]) => ({
  ok: true as const,
  value: {
    installationName: 'My Quake',
    modName: 'Action Quake 2',
    gameDir: 'action',
    installedVersion: 'v1',
    targetVersion: 'v2',
    changedFiles,
  },
})
const { previewUpdate, updateMod, revealMod } = vi.hoisted(() => ({
  previewUpdate: vi.fn(),
  updateMod: vi.fn(async () => ({ ok: true as const, value: { jobId: 'job-9' } })),
  revealMod: vi.fn(async () => ({ ok: true as const, value: null })),
}))
vi.mock('../client', () => ({ previewUpdate, updateMod, revealMod }))
vi.mock('../../../lib/bridge', () => ({ invoke: vi.fn() }))

const { ModDetailPanel } = await import('./ModDetailPanel')

const catalog = {
  id: 'action',
  gamedir: 'action',
  name: 'Action Quake 2',
  description: 'd',
  license: 'GPL-2.0',
  projectUrl: 'https://example.invalid',
  sourceUrl: 'https://example.invalid',
  pinned: 'v2',
  versions: [
    { version: 'v2', prerelease: false },
    { version: 'v1', prerelease: false },
  ],
}
const tile = (local: Partial<NonNullable<ModTileModel['local']>>): ModTileModel => ({
  gameDir: 'action',
  name: 'Action Quake 2',
  description: 'd',
  local: {
    gameDir: 'action',
    folderPath: '/g/action',
    origin: 'catalog',
    catalogId: 'action',
    ...local,
  },
  catalog,
})
const updatable = tile({
  version: 'v1',
  status: 'update-available',
  installedVersion: 'v1',
  pinnedVersion: 'v2',
})
const props = { installationId: 'i1', onClose: vi.fn() }

beforeAll(async () => {
  await initI18n('en')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ModDetailPanel update', () => {
  it('shows both versions and an Update button when an update is available', () => {
    render(createElement(ModDetailPanel, { ...props, mod: updatable }))
    expect(screen.getByTestId('mods-detail-update-versions').textContent).toBe(
      'Installed v1 · Catalog v2',
    )
    expect(screen.getByTestId('mods-tile-status-action').textContent).toBe('Update available')
    expect(screen.getByTestId('mods-detail-update-action').textContent).toBe('Update')
  })

  it('offers no Update for an installed-and-current or a manual mod', () => {
    const { rerender } = render(
      createElement(ModDetailPanel, { ...props, mod: tile({ version: 'v2' }) }),
    )
    expect(screen.queryByTestId('mods-detail-update-action')).toBeNull()
    expect(screen.queryByTestId('mods-detail-update-versions')).toBeNull()
    rerender(
      createElement(ModDetailPanel, {
        ...props,
        mod: { ...tile({ origin: 'manual', catalogId: undefined }), catalog: null },
      }),
    )
    expect(screen.queryByTestId('mods-detail-update-action')).toBeNull()
  })

  it('starts the update with overwrite when no file changed', async () => {
    previewUpdate.mockResolvedValue(preview([]))
    const onUpdateStarted = vi.fn()
    render(createElement(ModDetailPanel, { ...props, mod: updatable, onUpdateStarted }))
    fireEvent.click(screen.getByTestId('mods-detail-update-action'))
    await waitFor(() => expect(updateMod).toHaveBeenCalledWith('i1', 'action', 'overwrite'))
    await waitFor(() => expect(onUpdateStarted).toHaveBeenCalledWith('action', 'job-9'))
  })

  it('asks first when files changed, sends the choice, and Cancel starts nothing', async () => {
    previewUpdate.mockResolvedValue(preview(['action.cfg']))
    render(createElement(ModDetailPanel, { ...props, mod: updatable }))
    fireEvent.click(screen.getByTestId('mods-detail-update-action'))
    expect((await screen.findByTestId('mods-update-changed-file')).textContent).toBe('action.cfg')
    fireEvent.click(screen.getByTestId('mods-update-cancel'))
    await waitFor(() => expect(screen.queryByTestId('mods-update-changed-list')).toBeNull())
    expect(updateMod).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('mods-detail-update-action'))
    await screen.findByTestId('mods-update-changed-list')
    fireEvent.click(screen.getByTestId('mods-update-changed-overwrite'))
    fireEvent.click(screen.getByTestId('mods-update-confirm'))
    await waitFor(() => expect(updateMod).toHaveBeenCalledWith('i1', 'action', 'overwrite'))
  })

  it('shows a refused or failed update as visible text and keeps Update available', () => {
    render(
      createElement(ModDetailPanel, {
        ...props,
        mod: updatable,
        failure: { key: 'mods.update.refused.upToDate' },
      }),
    )
    expect(screen.getByTestId('mods-tile-update-error-action').textContent).toBe(
      "This mod is already at the catalog's version.",
    )
    expect(screen.getByTestId('mods-tile-status-action').textContent).toBe('Update available')
    expect(screen.getByTestId('mods-detail-update-action')).toBeTruthy()
  })

  it('disables Update while another job is busy', () => {
    render(createElement(ModDetailPanel, { ...props, mod: updatable, busy: true }))
    expect((screen.getByTestId('mods-detail-update-action') as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})
