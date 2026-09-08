// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import type { RendererModule } from '../modules'
import { SettingsView, type SettingsViewProps } from './SettingsView'

// SettingsView reaches the preload bridge directly (open-folder / open-external
// buttons, dev-only simulate-job); jsdom has no `window.q2`, so the bridge
// module is stubbed rather than the real preload contract.
vi.mock('../lib/bridge', () => ({
  invoke: vi.fn(async () => undefined),
  onEvent: vi.fn(),
}))

/**
 * Story 072 D1: the Settings view learns to render sections contributed by
 * modules (`RendererModule.settingsSection`), sorted by `order` then module
 * id, between the shell's own Library and About sections. `modules` is an
 * injected prop (defaulting to the real `RENDERER_MODULES`) so this test can
 * prove the mechanism with a stub module instead of waiting on a real one
 * (downloads, story [[073]]+) to exist.
 */

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

function StubSection() {
  return <p data-testid="stub-section-content">stub content</p>
}

describe('SettingsView', () => {
  it("a module's contributed section renders in the shell's chrome, between Library and About", () => {
    const stubModule: RendererModule = {
      id: 'downloads',
      settingsSection: {
        // A key deliberately absent from en.json - i18next falls back to
        // rendering the key itself, which is enough to prove it's translated
        // through `t()` and stays distinct from the real Library/About headings.
        titleKey: 'test.stub.settingsSection.title',
        order: 1,
        Section: StubSection,
      },
    }

    render(createElement<SettingsViewProps>(SettingsView, { modules: [stubModule] }))

    const stubPanel = screen.getByTestId('settings-section-downloads')
    expect(stubPanel).toBeTruthy()
    expect(screen.getByTestId('stub-section-content')).toBeTruthy()

    // Ordering: Library section, then the contributed section, then About -
    // checked via DOM query order (document position), not just presence.
    const panels = Array.from(document.querySelectorAll('[class*="panel"]'))
    const libraryHeading = screen.getByText('Library')
    const aboutHeading = screen.getByText('About')

    const libraryPanel = panels.find((panel) => panel.contains(libraryHeading))!
    const aboutPanel = panels.find((panel) => panel.contains(aboutHeading))!

    expect(libraryPanel).toBeTruthy()
    expect(aboutPanel).toBeTruthy()

    const position1 = libraryPanel.compareDocumentPosition(stubPanel)
    const position2 = stubPanel.compareDocumentPosition(aboutPanel)

    // eslint-disable-next-line no-bitwise
    expect(position1 & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // eslint-disable-next-line no-bitwise
    expect(position2 & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("the shell's own sections (Library, About) still render unchanged when no module contributes a section", () => {
    render(createElement<SettingsViewProps>(SettingsView, { modules: [] }))

    expect(screen.getByText('Library')).toBeTruthy()
    expect(screen.getByText('About')).toBeTruthy()
    expect(screen.queryByTestId(/settings-section-/)).toBeNull()
  })

  it('sorts multiple contributed sections by order then module id', () => {
    const moduleB: RendererModule = {
      id: 'mods',
      settingsSection: {
        titleKey: 'test.stub.settingsSection.title',
        order: 5,
        Section: StubSection,
      },
    }
    const moduleA: RendererModule = {
      id: 'assets',
      settingsSection: {
        titleKey: 'test.stub.settingsSection.title',
        order: 5,
        Section: StubSection,
      },
    }
    const moduleFirst: RendererModule = {
      id: 'downloads',
      settingsSection: { titleKey: 'settings.section.library', order: 1, Section: StubSection },
    }

    render(
      createElement<SettingsViewProps>(SettingsView, { modules: [moduleB, moduleA, moduleFirst] }),
    )

    const testIds = Array.from(document.querySelectorAll('[data-testid^="settings-section-"]')).map(
      (el) => el.getAttribute('data-testid'),
    )

    expect(testIds).toEqual([
      'settings-section-downloads',
      'settings-section-assets',
      'settings-section-mods',
    ])
  })
})
