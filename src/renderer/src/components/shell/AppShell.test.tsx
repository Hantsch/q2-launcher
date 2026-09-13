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
 *
 * Story 081 D2 (AC2): home stopped being a shell screen. The mocked registry is
 * what makes that testable - the home view rendered below exists only inside this
 * file, so it can only reach the screen through `rendererModule()`. A shell that
 * imported a home component again would render something else.
 */

/** Only reachable through the mocked registry - the shell cannot import this. */
function HomeModuleStub() {
  return <div>home module view</div>
}

const homeManifest: ModuleManifest = {
  id: 'home',
  titleKey: 'module.home.title',
  descriptionKey: 'module.home.description',
  icon: 'Home',
  route: '/home',
  nav: null,
  status: 'available',
  capabilities: [],
  ipcNamespace: 'module:home',
  requiresInstallation: false,
}

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
  rendererModule: vi.fn((id: string) => {
    if (id === 'home') return { id: 'home', View: HomeModuleStub }
    if (id === 'downloads') return { id: 'downloads', settingsSection: undefined }
    return undefined
  }),
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

  it('the shell resolves the home route through the module registry', async () => {
    const { resolveView } = await import('./AppShell')
    const modules = [homeManifest, stubManifest]

    // The home route itself: no special case left in the shell, just the generic
    // route -> manifest -> registered view lookup.
    const { unmount } = render(resolveView('/home', modules))
    expect(screen.getByText('home module view')).toBeTruthy()
    unmount()

    // ...and the same lookup catches an unknown route, e.g. a persisted `lastRoute`
    // naming a module that has since been renamed away.
    render(resolveView('/install', modules))
    expect(screen.getByText('home module view')).toBeTruthy()
  })

  it('renders the planned-module placeholder for home when no view is registered', async () => {
    const { resolveView } = await import('./AppShell')

    // Registry mock answers `undefined` for 'mods', so an unknown route whose home
    // fallback has no renderer half still lands on a real screen, not a blank pane.
    render(
      resolveView('/nowhere', [{ ...homeManifest, id: 'mods', titleKey: 'module.mods.title' }]),
    )

    expect(screen.getByText('Mods')).toBeTruthy()
  })
})
