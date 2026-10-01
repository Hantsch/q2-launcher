// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Job } from '@shared/types'
import { initI18n } from '../../../i18n'
import type { ModTileModel } from '../merge-mod-tiles'
import { ModTile } from './ModTile'

const catalog = {
  id: 'action',
  gamedir: 'action',
  name: 'Action Quake 2',
  description: 'd',
  license: 'GPL-2.0',
  projectUrl: 'https://example.invalid',
  sourceUrl: 'https://example.invalid',
  pinned: 'v1',
  versions: [{ version: 'v1', prerelease: false }],
}
const tile = (local: ModTileModel['local']): ModTileModel => ({
  gameDir: 'action',
  name: 'Action Quake 2',
  description: 'd',
  local,
  catalog,
})
const job = (overrides: Partial<Job>): Job => ({
  id: 'j1',
  moduleId: 'mods',
  kind: 'mod-install',
  labelKey: 'mods.job.install',
  labelParams: { name: 'Action Quake 2' },
  status: 'running',
  progress: { ratio: 0.4, bytesDone: 4, bytesTotal: 10 },
  cancellable: true,
  startedAt: new Date().toISOString(),
  ...overrides,
})

beforeAll(async () => {
  await initI18n('en')
})
afterEach(cleanup)

describe('ModTile install state', () => {
  it('a content-only install shows the not-playable reason', () => {
    render(
      createElement(ModTile, {
        mod: tile({
          gameDir: 'action',
          folderPath: '/g/action',
          origin: 'catalog',
          catalogId: 'action',
          version: 'v1',
          contentOnly: true,
          engineKind: 'q2pro',
          arch: 'x64',
        }),
      }),
    )
    expect(screen.getByTestId('mods-content-only-reason').textContent).toBe(
      'Not playable locally with Q2PRO 64-bit: no matching build',
    )
    expect(screen.getByTestId('mods-tile-status-action').textContent).toBe(
      'Installed, content only',
    )
    expect(screen.queryByTestId('mods-install-action')).toBeNull()
  })

  it('a content-only install with an unknown arch shows no bitness', () => {
    render(
      createElement(ModTile, {
        mod: tile({
          gameDir: 'action',
          folderPath: '/g/action',
          origin: 'catalog',
          catalogId: 'action',
          version: 'v1',
          contentOnly: true,
          engineKind: 'q2pro',
          arch: 'unknown',
        }),
      }),
    )
    expect(screen.getByTestId('mods-content-only-reason').textContent).toBe(
      'Not playable locally with Q2PRO: no matching build',
    )
  })

  it('offers Install on a not installed catalog tile', () => {
    const onInstall = vi.fn()
    render(createElement(ModTile, { mod: tile(null), onInstall }))
    fireEvent.click(screen.getByTestId('mods-install-action'))
    expect(onInstall).toHaveBeenCalledWith('action')
  })

  it('shows progress while running and the waiting reason while waiting', () => {
    const { rerender } = render(createElement(ModTile, { mod: tile(null), job: job({}) }))
    expect(screen.getByTestId('mods-tile-progress-action')).toBeTruthy()
    expect(screen.queryByTestId('mods-install-action')).toBeNull()
    rerender(
      createElement(ModTile, {
        mod: tile(null),
        job: job({
          status: 'waiting',
          waitingReason: { key: 'mods.job.waitingForDecision', params: { folder: 'Action' } },
        }),
      }),
    )
    expect(screen.getByTestId('mods-tile-status-action').textContent).toContain('Action')
    expect(screen.getByTestId('mods-tile-status-action').getAttribute('role')).toBe('status')
  })
})
