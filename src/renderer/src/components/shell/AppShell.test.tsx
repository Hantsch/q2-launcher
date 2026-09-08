// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ModuleManifest } from '@shared/types'
import { initI18n } from '../../i18n'

/**
 * Story 072 D1: `RendererModule.View` becomes optional so a module can be
 * registered (e.g. for its `settingsSection`) without owning a route yet.
 * `resolveView` must still fall back to `PlannedModuleView` in that case,
 * exactly as it does for a module that isn't registered at all. `../../modules`
 * is mocked so the test can register a module with no `View`, independent of
 * whatever the real registry looks like.
 */

const stubManifest: ModuleManifest = {
  id: 'downloads',
  titleKey: 'module.downloads.title',
  descriptionKey: 'module.downloads.description',
  icon: 'Download',
  route: '/downloads',
  nav: { section: 'secondary', order: 10 },
  status: 'planned',
  capabilities: [],
  ipcNamespace: 'module:downloads',
  requiresInstallation: false,
}

vi.mock('../../modules', () => ({
  rendererModule: vi.fn((id: string) =>
    id === 'downloads' ? { id: 'downloads', settingsSection: undefined } : undefined,
  ),
}))

// `AppShell` imports `SettingsView`, which reaches the preload bridge directly;
// jsdom has no `window.q2`, so the bridge module is stubbed here too.
vi.mock('../../lib/bridge', () => ({
  invoke: vi.fn(async () => undefined),
  onEvent: vi.fn(),
}))

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('resolveView', () => {
  it('falls back to PlannedModuleView when the registered module has no View', async () => {
    const { resolveView } = await import('./AppShell')

    render(resolveView('/downloads', [stubManifest]))

    // PlannedModuleView renders the module's title and the "planned" badge;
    // it never crashes when settingsSection-only registration has no View.
    expect(screen.getByText('Downloads')).toBeTruthy()
    expect(screen.getByText('Planned')).toBeTruthy()
  })
})
