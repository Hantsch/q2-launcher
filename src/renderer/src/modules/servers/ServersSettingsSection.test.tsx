// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getModuleManifest } from '@shared/types'
import { SERVERS_HANDLERS, type MasterSource } from '@shared/modules/servers'
import { initI18n } from '../../i18n'
import type { ServersSettingsSection as ServersSettingsSectionType } from './ServersSettingsSection'

const SOURCES: MasterSource[] = [
  { id: 'a', type: 'udp-master', address: 'master.q2servers.com:27900', enabled: true },
]

/**
 * Story 106 D3, extended by story 111 D4.
 *
 * `../index` pulls in the renderer module registry, which (like `modules/index.test.ts`) needs
 * `window.q2` stubbed at module scope before it's imported, even though this file never calls
 * `callModule` itself.
 */
;(globalThis as unknown as { q2: unknown }).q2 = {
  invoke: vi.fn((_channel: string, args: { type: string }) => {
    if (args?.type === SERVERS_HANDLERS.sourcesList) return Promise.resolve({ ok: true, value: SOURCES })
    return Promise.resolve({ ok: true, value: SOURCES })
  }),
  on: vi.fn(() => () => {}),
}

let ServersSettingsSection: typeof ServersSettingsSectionType

beforeAll(async () => {
  await initI18n('en')
  // Dynamic, run after the `window.q2` stub above is in place - a static import at the top of this
  // file would pull in `./client` -> `bridge.ts`'s module-scope `requireBridge()` before the stub
  // exists (ES module imports are hoisted ahead of this file's own top-level statements).
  ;({ ServersSettingsSection } = await import('./ServersSettingsSection'))
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

  it('the section renders the master-source list fetched from main', async () => {
    render(createElement(ServersSettingsSection))

    await act(async () => {
      await Promise.resolve()
    })

    const row = screen.getByTestId('servers-source-row-a')
    expect(row.textContent).toContain('master.q2servers.com:27900')
  })
})
