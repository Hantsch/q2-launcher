// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getModuleManifest } from '@shared/types'
import { initI18n } from '../../i18n'
import { ServersSettingsSection } from './ServersSettingsSection'

/**
 * Story 106 D3.
 *
 * `../index` pulls in the renderer module registry, which (like `modules/index.test.ts`) needs
 * `window.q2` stubbed at module scope before it's imported, even though this file never calls
 * `callModule` itself.
 */
;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('servers module registration', () => {
  it('the servers renderer module contributes a settings section and no view', async () => {
    const { rendererModule } = await import('../index')
    const module = rendererModule('servers')

    expect(module).toBeDefined()
    // Mirrors `modules/index.test.ts`'s "no View" half of the mods/assets convention (Decisions):
    // the route falls back to the shell's `PlannedModuleView` until a later deliverable earns a
    // real one.
    expect(module?.View).toBeUndefined()
    expect(module?.settingsSection).toBeDefined()
    expect(module?.settingsSection?.Section).toBe(ServersSettingsSection)

    const manifest = getModuleManifest('servers')
    expect(manifest?.status).toBe('planned')
  })

  it('the section renders its placeholder while it has no controls', () => {
    render(createElement(ServersSettingsSection))

    const placeholder = screen.getByTestId('servers-settings-placeholder')
    expect(placeholder.textContent).toBeTruthy()
  })
})
