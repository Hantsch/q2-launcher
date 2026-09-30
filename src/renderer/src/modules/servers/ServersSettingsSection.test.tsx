// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getModuleManifest } from '@shared/types'
import { SERVERS_HANDLERS, type MasterSource, type ServersScanSettings } from '@shared/modules/servers'
import { initI18n } from '../../i18n'
import type { ServersSettingsSection as ServersSettingsSectionType } from './ServersSettingsSection'

const SOURCES: MasterSource[] = [
  { id: 'a', type: 'udp-master', address: 'master.q2servers.com:27900', enabled: true },
]

const DEFAULT_SCAN_SETTINGS: ServersScanSettings = {
  concurrency: 8,
  timeoutMs: 2000,
  retries: 1,
  minSpacingMs: 30_000,
  autoScanOnOpen: true,
  autoRefreshEnabled: false,
  autoRefreshIntervalMs: 60_000,
}

/** The stub `window.q2.invoke` falls back to for every call this file's tests don't override for
 * one render - re-installed in `afterEach` so one test's override never leaks into the next. */
function defaultInvoke(
  _channel: string,
  args: { type: string },
): Promise<{ ok: true; value: unknown }> {
  if (args?.type === SERVERS_HANDLERS.scanGetSettings) {
    return Promise.resolve({ ok: true, value: DEFAULT_SCAN_SETTINGS })
  }
  if (args?.type === SERVERS_HANDLERS.scanPatchSettings) {
    return Promise.resolve({ ok: true, value: DEFAULT_SCAN_SETTINGS })
  }
  return Promise.resolve({ ok: true, value: SOURCES })
}

/**
 * Story 106 D3, extended by story 111 D4, extended by story 115 D4.
 *
 * `../index` pulls in the renderer module registry, which (like `modules/index.test.ts`) needs
 * `window.q2` stubbed at module scope before it's imported, even though this file never calls
 * `callModule` itself.
 */
;(globalThis as unknown as { q2: unknown }).q2 = {
  invoke: vi.fn(defaultInvoke),
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
  ;(globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }).q2.invoke.mockImplementation(
    defaultInvoke,
  )
})

describe('servers module registration', () => {
  // The global testTimeout (vitest.config.ts) isn't consistently enough headroom for this one:
  // `../index` pulls in the entire renderer module registry, making this the heaviest dynamic
  // `import()` in the suite - it's the one file that still timed out under CI-level CPU
  // contention after the global bump to 20s, so it gets its own longer allowance instead of
  // raising the default further for every other test.
  it(
    'the servers renderer module contributes a settings section and a minimal manual-scan view',
    async () => {
      const { rendererModule } = await import('../index')
      const { ServersView } = await import('./ServersView')
      const module = rendererModule('servers')

      expect(module).toBeDefined()
      // Story 115 D5 stood `ServersView` in as a manual-scan-only stand-in; the full game
      // browser ([[118]]-[[132]], done S22-S25) has since landed, so the manifest's `status`
      // flipped to `'available'` and the nav rail's "planned" badge is gone.
      expect(module?.View).toBe(ServersView)
      expect(module?.settingsSection).toBeDefined()
      expect(module?.settingsSection?.Section).toBe(ServersSettingsSection)

      const manifest = getModuleManifest('servers')
      expect(manifest?.status).toBe('available')
    },
    40_000,
  )

  it('the section renders the master-source list fetched from main', async () => {
    render(createElement(ServersSettingsSection))

    await act(async () => {
      await Promise.resolve()
    })

    const row = screen.getByTestId('servers-source-row-a')
    expect(row.textContent).toContain('master.q2servers.com:27900')
  })
})

/** Story 115 D4: the "Scan" sub-section this deliverable adds below the master-source list. */
describe('servers scan settings', () => {
  const invokeMock = () =>
    (globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }).q2.invoke

  const selectIn = (testid: string): HTMLSelectElement =>
    within(screen.getByTestId(testid)).getByRole('combobox') as HTMLSelectElement

  const switchIn = (testid: string): HTMLButtonElement =>
    within(screen.getByTestId(testid)).getByRole('switch') as HTMLButtonElement

  it('every one of the 7 controls carries its servers-scan-settings-* testid', async () => {
    render(createElement(ServersSettingsSection))

    for (const testid of [
      'servers-scan-settings-auto-scan-on-open',
      'servers-scan-settings-auto-refresh-enabled',
      'servers-scan-settings-auto-refresh-interval',
      'servers-scan-settings-concurrency',
      'servers-scan-settings-timeout',
      'servers-scan-settings-retries',
      'servers-scan-settings-min-spacing',
    ]) {
      expect(await screen.findByTestId(testid)).toBeTruthy()
    }
  })

  it('renders the values getScanSettings() resolved with, not a hardcoded default', async () => {
    render(createElement(ServersSettingsSection))

    await waitFor(() => expect(invokeMock()).toHaveBeenCalled())

    await waitFor(() =>
      expect(selectIn('servers-scan-settings-concurrency').value).toBe(
        String(DEFAULT_SCAN_SETTINGS.concurrency),
      ),
    )
    expect(selectIn('servers-scan-settings-timeout').value).toBe(
      String(DEFAULT_SCAN_SETTINGS.timeoutMs),
    )
    expect(selectIn('servers-scan-settings-retries').value).toBe(
      String(DEFAULT_SCAN_SETTINGS.retries),
    )
    expect(selectIn('servers-scan-settings-min-spacing').value).toBe(
      String(DEFAULT_SCAN_SETTINGS.minSpacingMs),
    )
    expect(selectIn('servers-scan-settings-auto-refresh-interval').value).toBe(
      String(DEFAULT_SCAN_SETTINGS.autoRefreshIntervalMs),
    )
    expect(switchIn('servers-scan-settings-auto-scan-on-open').getAttribute('aria-checked')).toBe(
      String(DEFAULT_SCAN_SETTINGS.autoScanOnOpen),
    )
    expect(
      switchIn('servers-scan-settings-auto-refresh-enabled').getAttribute('aria-checked'),
    ).toBe(String(DEFAULT_SCAN_SETTINGS.autoRefreshEnabled))
  })

  it('the auto-refresh-interval select is disabled while autoRefreshEnabled is off, enabled once on', async () => {
    render(createElement(ServersSettingsSection))

    await waitFor(() =>
      expect(selectIn('servers-scan-settings-auto-refresh-interval').disabled).toBe(true),
    )
    cleanup()

    invokeMock().mockImplementation((_channel: string, args: { type: string }) => {
      if (args?.type === SERVERS_HANDLERS.scanGetSettings) {
        return Promise.resolve({
          ok: true,
          value: { ...DEFAULT_SCAN_SETTINGS, autoRefreshEnabled: true },
        })
      }
      return Promise.resolve({ ok: true, value: SOURCES })
    })

    render(createElement(ServersSettingsSection))

    await waitFor(() =>
      expect(selectIn('servers-scan-settings-auto-refresh-interval').disabled).toBe(false),
    )
  })

  it('changing a control patches settings and renders main’s returned value, not the requested one', async () => {
    const RETURNED_SETTINGS: ServersScanSettings = { ...DEFAULT_SCAN_SETTINGS, concurrency: 32 }

    invokeMock().mockImplementation((_channel: string, args: { type: string }) => {
      if (args?.type === SERVERS_HANDLERS.scanGetSettings) {
        return Promise.resolve({ ok: true, value: DEFAULT_SCAN_SETTINGS })
      }
      if (args?.type === SERVERS_HANDLERS.scanPatchSettings) {
        return Promise.resolve({ ok: true, value: RETURNED_SETTINGS })
      }
      return Promise.resolve({ ok: true, value: SOURCES })
    })

    render(createElement(ServersSettingsSection))

    const concurrency = await waitFor(() => {
      const select = selectIn('servers-scan-settings-concurrency')
      expect(select.value).toBe(String(DEFAULT_SCAN_SETTINGS.concurrency))
      return select
    })

    fireEvent.change(concurrency, { target: { value: '16' } })

    await waitFor(() =>
      expect(invokeMock()).toHaveBeenCalledWith('module:invoke', {
        moduleId: 'servers',
        type: SERVERS_HANDLERS.scanPatchSettings,
        payload: { concurrency: 16 },
      }),
    )

    // Not the requested '16' - the value main's mocked response actually resolved with.
    await waitFor(() => expect(concurrency.value).toBe(String(RETURNED_SETTINGS.concurrency)))
  })
})
