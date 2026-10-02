// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { getModuleManifest } from '@shared/types'
import type { ReplaysExtraFolder } from '@shared/modules/replays'
import en from '../../i18n/locales/en.json'
import { initI18n } from '../../i18n'
import { moduleIcon } from '../../components/shell/moduleIcons'
import type { ReplaysSettingsSection as ReplaysSettingsSectionType } from './ReplaysSettingsSection'

const NO_EXTRA_FOLDERS: ReplaysExtraFolder[] = []

/** The stub `window.q2.invoke` falls back to for every call this file's tests don't override for
 * one render - re-installed in `afterEach` so one test's override never leaks into the next. */
function defaultInvoke(
  channel: string,
  payload: { type?: string } | undefined,
): Promise<{ ok: true; value: unknown }> {
  if (channel === 'installations:pickFolder') {
    return Promise.resolve(null as unknown as { ok: true; value: unknown })
  }
  if (payload?.type === 'nameTemplates.list') {
    // The real handler itself returns `Outcome<NameTemplatesView>` (its own domain refusal), and
    // the module registry wraps that in its own transport-level `ok(...)` on top - see client.ts's
    // doc comment on `listNameTemplates`. This stub mirrors that nesting.
    return Promise.resolve({
      ok: true,
      value: { entries: [], canRestore: false },
    })
  }
  if (payload?.type === 'modWarning.read') {
    return Promise.resolve({ ok: true, value: { enabled: true, trustedMods: [] } })
  }
  if (payload?.type === 'extraFolders.list') {
    return Promise.resolve({ ok: true, value: NO_EXTRA_FOLDERS })
  }
  return Promise.resolve({ ok: true, value: { scanning: false, demoCount: 0 } })
}

/**
 * Story 135 D3, mirrors `modules/servers/ServersSettingsSection.test.tsx`. Story 140 D3 extends the
 * stub so it also answers `nameTemplates.list` - the section now renders `NameTemplatesList`, which
 * fetches on mount. Story 142 D4 extends it again so it also answers `extraFolders.list` and the
 * `installations:pickFolder` channel `ExtraFoldersList` calls directly (not through `module:invoke`).
 *
 * `../index` pulls in the renderer module registry, which needs `window.q2` stubbed at module
 * scope before it's imported, even though this file never calls `callModule` itself.
 */
;(globalThis as unknown as { q2: unknown }).q2 = {
  invoke: vi.fn(defaultInvoke),
  on: vi.fn(() => () => {}),
}

let ReplaysSettingsSection: typeof ReplaysSettingsSectionType

beforeAll(async () => {
  await initI18n('en')
  // Dynamic, run after the `window.q2` stub above is in place - a static import at the top of this
  // file would pull in `./client` -> `bridge.ts`'s module-scope `requireBridge()` before the stub
  // exists (ES module imports are hoisted ahead of this file's own top-level statements).
  ;({ ReplaysSettingsSection } = await import('./ReplaysSettingsSection'))
})

afterEach(() => {
  cleanup()
  ;(
    globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }
  ).q2.invoke.mockImplementation(defaultInvoke)
})

function stringAt(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object' && key in acc
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      en,
    )
}

describe('replays module registration', () => {
  it('the replays renderer module contributes a settings section and its own view', async () => {
    const { rendererModule } = await import('../index')
    const module = rendererModule('replays')

    expect(module).toBeDefined()
    // Story 141 D4: `ReplaysView` replaces the planned-module fallback.
    expect(module?.View).toBeDefined()
    expect(module?.settingsSection).toBeDefined()
    expect(module?.settingsSection?.Section).toBe(ReplaysSettingsSection)

    const manifest = getModuleManifest('replays')
    expect(manifest?.status).toBe('available')
  })

  it('the section renders the naming-pattern list once it has loaded', async () => {
    render(createElement(ReplaysSettingsSection))

    const list = await screen.findByTestId('replays-name-templates')
    expect(list).toBeDefined()
  })

  it('every string this story shows comes from the top-level replays block', async () => {
    const manifest = getModuleManifest('replays')
    const { rendererModule } = await import('../index')
    const module = rendererModule('replays')

    const keys = [
      manifest?.titleKey,
      manifest?.descriptionKey,
      manifest?.plannedIntroKey,
      ...(manifest?.plannedHighlightKeys ?? []),
      module?.settingsSection?.titleKey,
      module?.settingsSection?.descriptionKey,
    ]

    expect(keys.length).toBeGreaterThan(0)

    for (const key of keys) {
      expect(key).toBeDefined()
      expect(key as string).toMatch(/^replays\./)
      const value = stringAt(key as string)
      expect(typeof value).toBe('string')
      expect((value as string).length).toBeGreaterThan(0)
    }
  })

  it('moduleIcon("Film") resolves to a real icon, not the fallback', async () => {
    const { CircleHelp } = await import('lucide-react')
    expect(moduleIcon('Film')).not.toBe(CircleHelp)
  })
})

/** Story 142 D4: the extra-demo-folders block this deliverable adds alongside `NameTemplatesList`. */
describe('replays extra folders', () => {
  const invokeMock = () =>
    (globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }).q2.invoke

  it('the section lists, adds and removes extra folders through the module client', async () => {
    const folders: ReplaysExtraFolder[] = [{ id: 'f1', path: 'C:/demos', addedAt: '2026-01-01' }]

    invokeMock().mockImplementation((channel: string, payload: { type?: string }) => {
      if (channel === 'installations:pickFolder') {
        return Promise.resolve('C:/more-demos')
      }
      if (payload?.type === 'extraFolders.list') {
        return Promise.resolve({ ok: true, value: folders })
      }
      if (payload?.type === 'extraFolders.add') {
        return Promise.resolve({
          ok: true,
          value: {
            ok: true,
            folders: [...folders, { id: 'f2', path: 'C:/more-demos', addedAt: '2026-01-02' }],
          },
        })
      }
      if (payload?.type === 'extraFolders.remove') {
        return Promise.resolve({ ok: true, value: { ok: true, folders: [] } })
      }
      return defaultInvoke(channel, payload)
    })

    render(createElement(ReplaysSettingsSection))

    const row = await screen.findByTestId('replays-extra-folder-row')
    expect(row.textContent).toContain('C:/demos')

    const addButton = await screen.findByTestId('replays-extra-folders-add')
    await act(async () => {
      addButton.click()
      await Promise.resolve()
    })

    await waitFor(() => {
      const rows = screen.getAllByTestId('replays-extra-folder-row')
      expect(rows.map((r) => r.textContent)).toEqual(
        expect.arrayContaining([expect.stringContaining('C:/more-demos')]),
      )
    })

    const removeButtons = screen.getAllByTestId('replays-extra-folder-remove')
    await act(async () => {
      removeButtons[0].click()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryByTestId('replays-extra-folder-row')).toBeNull()
      expect(screen.getByText(en.replays.extraFolders.empty)).toBeTruthy()
    })
  })

  it('a rejected folder shows its reason as visible text', async () => {
    invokeMock().mockImplementation((channel: string, payload: { type?: string }) => {
      if (channel === 'installations:pickFolder') {
        return Promise.resolve('C:/not-a-folder')
      }
      if (payload?.type === 'extraFolders.list') {
        return Promise.resolve({ ok: true, value: [] })
      }
      if (payload?.type === 'extraFolders.add') {
        return Promise.resolve({ ok: true, value: { ok: false, reason: 'notAFolder' } })
      }
      return defaultInvoke(channel, payload)
    })

    render(createElement(ReplaysSettingsSection))

    const addButton = await screen.findByTestId('replays-extra-folders-add')
    await act(async () => {
      addButton.click()
      await Promise.resolve()
    })

    const alert = await screen.findByTestId('replays-extra-folders-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toBe(en.replays.extraFolders.error.notAFolder)
    expect(alert.textContent).not.toContain('replays.extraFolders.error.notAFolder')
  })

  it('a cancelled pick adds nothing', async () => {
    const folders: ReplaysExtraFolder[] = [{ id: 'f1', path: 'C:/demos', addedAt: '2026-01-01' }]

    invokeMock().mockImplementation((channel: string, payload: { type?: string }) => {
      if (channel === 'installations:pickFolder') {
        return Promise.resolve(null)
      }
      if (payload?.type === 'extraFolders.list') {
        return Promise.resolve({ ok: true, value: folders })
      }
      return defaultInvoke(channel, payload)
    })

    render(createElement(ReplaysSettingsSection))

    const row = await screen.findByTestId('replays-extra-folder-row')
    expect(row.textContent).toContain('C:/demos')

    invokeMock().mockClear()
    const addButton = screen.getByTestId('replays-extra-folders-add')
    await act(async () => {
      addButton.click()
      await Promise.resolve()
    })

    expect(
      invokeMock().mock.calls.some(
        (call) => (call[1] as { type?: string } | undefined)?.type === 'extraFolders.add',
      ),
    ).toBe(false)
    expect(screen.getAllByTestId('replays-extra-folder-row')).toHaveLength(1)
  })
})

/** Story 182 D3: the missing-mod warning's switch and reset. */
describe('replays mod warning settings', () => {
  it('mod warning switch and reset call their handlers and render the returned state', async () => {
    const invoke = (globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }).q2.invoke
    invoke.mockImplementation(
      (channel: string, payload: { type?: string; payload?: { enabled: boolean } }) => {
        if (payload?.type === 'modWarning.read') {
          return Promise.resolve({ ok: true, value: { enabled: true, trustedMods: ['opentdm'] } })
        }
        if (payload?.type === 'modWarning.setEnabled') {
          return Promise.resolve({
            ok: true,
            value: { enabled: payload.payload?.enabled, trustedMods: ['opentdm'] },
          })
        }
        if (payload?.type === 'modWarning.resetTrusted') {
          return Promise.resolve({ ok: true, value: { enabled: false, trustedMods: [] } })
        }
        return defaultInvoke(channel, payload)
      },
    )

    render(createElement(ReplaysSettingsSection))

    await waitFor(() => {
      expect(screen.getByTestId('replays-mod-warning-trusted').textContent).toContain('opentdm')
    })
    const reset = screen.getByTestId('replays-mod-warning-reset') as HTMLButtonElement
    expect(reset.disabled).toBe(false)

    const toggle = screen.getByTestId('replays-mod-warning-enabled')
    expect(toggle?.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle as Element)
    await waitFor(() => {
      expect(screen.getByTestId('replays-mod-warning-enabled').getAttribute('aria-checked')).toBe(
        'false',
      )
    })
    expect(invoke).toHaveBeenCalledWith(
      'module:invoke',
      expect.objectContaining({ type: 'modWarning.setEnabled', payload: { enabled: false } }),
    )

    fireEvent.click(reset)
    await waitFor(() => {
      expect(screen.getByTestId('replays-mod-warning-trusted').textContent).toBe(
        en.replays.modWarning.trustedEmpty,
      )
    })
    expect((screen.getByTestId('replays-mod-warning-reset') as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(invoke).toHaveBeenCalledWith(
      'module:invoke',
      expect.objectContaining({ type: 'modWarning.resetTrusted' }),
    )
  })
})
