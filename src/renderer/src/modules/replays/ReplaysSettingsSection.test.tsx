// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { getModuleManifest } from '@shared/types'
import en from '../../i18n/locales/en.json'
import { initI18n } from '../../i18n'
import { moduleIcon } from '../../components/shell/moduleIcons'
import type { ReplaysSettingsSection as ReplaysSettingsSectionType } from './ReplaysSettingsSection'

/**
 * Story 135 D3, mirrors `modules/servers/ServersSettingsSection.test.tsx`.
 *
 * `../index` pulls in the renderer module registry, which needs `window.q2` stubbed at module
 * scope before it's imported, even though this file never calls `callModule` itself.
 */
;(globalThis as unknown as { q2: unknown }).q2 = {
  invoke: vi.fn(() => Promise.resolve({ ok: true, value: { scanning: false, demoCount: 0 } })),
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
})

function stringAt(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' && key in acc ? (acc as Record<string, unknown>)[key] : undefined),
      en,
    )
}

describe('replays module registration', () => {
  it('the replays renderer module contributes a settings section and no view', async () => {
    const { rendererModule } = await import('../index')
    const module = rendererModule('replays')

    expect(module).toBeDefined()
    expect(module?.View).toBeUndefined()
    expect(module?.settingsSection).toBeDefined()
    expect(module?.settingsSection?.Section).toBe(ReplaysSettingsSection)

    const manifest = getModuleManifest('replays')
    expect(manifest?.status).toBe('planned')
  })

  it('the section renders its placeholder while it has no controls', async () => {
    render(createElement(ReplaysSettingsSection))

    const placeholder = screen.getByTestId('replays-settings-placeholder')
    expect(placeholder.textContent).toBe(en.replays.settings.placeholder)
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
      'replays.settings.placeholder',
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
