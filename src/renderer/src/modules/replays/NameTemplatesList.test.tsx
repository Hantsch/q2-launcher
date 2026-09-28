// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createInstance, type i18n as I18nInstance } from 'i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { NameTemplatesView } from '@shared/replays/name-templates'
import type { Outcome } from '@shared/types'
import en from '../../i18n/locales/en.json'
import { initI18n } from '../../i18n'

/**
 * Story 140 D3. Mirrors `home/HomeView.test.tsx`'s "every string is an i18n key" idiom (a
 * key-echoing i18n instance) and `servers/ServersSettingsSection.test.tsx`'s stubbed-client idiom
 * (`vi.mock('./client', ...)` rather than a raw `window.q2` stub, since this component calls seven
 * distinct handlers through its own typed client).
 */

const listNameTemplates = vi.fn<() => Promise<Outcome<Outcome<NameTemplatesView>>>>()
const addNameTemplate = vi.fn<(template: string) => Promise<Outcome<Outcome<NameTemplatesView>>>>()
const updateNameTemplate =
  vi.fn<(id: string, template: string) => Promise<Outcome<Outcome<NameTemplatesView>>>>()
const removeNameTemplate = vi.fn<(id: string) => Promise<Outcome<Outcome<NameTemplatesView>>>>()
const reorderNameTemplates = vi.fn<(ids: string[]) => Promise<Outcome<Outcome<NameTemplatesView>>>>()
const resetNameTemplate = vi.fn<(id: string) => Promise<Outcome<Outcome<NameTemplatesView>>>>()
const restoreNameTemplates = vi.fn<() => Promise<Outcome<Outcome<NameTemplatesView>>>>()

/** Wraps a domain-level `Outcome<NameTemplatesView>` in the transport-level envelope every real
 * `nameTemplates.*` call gets from `MainModuleRegistry.invoke()` - see `client.ts`'s doc comment. */
function transportOk(domain: Outcome<NameTemplatesView>): Outcome<Outcome<NameTemplatesView>> {
  return { ok: true, value: domain }
}

vi.mock('./client', () => ({
  listNameTemplates: () => listNameTemplates(),
  addNameTemplate: (template: string) => addNameTemplate(template),
  updateNameTemplate: (id: string, template: string) => updateNameTemplate(id, template),
  removeNameTemplate: (id: string) => removeNameTemplate(id),
  reorderNameTemplates: (ids: string[]) => reorderNameTemplates(ids),
  resetNameTemplate: (id: string) => resetNameTemplate(id),
  restoreNameTemplates: () => restoreNameTemplates(),
}))

let NameTemplatesList: typeof import('./NameTemplatesList').NameTemplatesList

beforeAll(async () => {
  await initI18n('en')
  ;({ NameTemplatesList } = await import('./NameTemplatesList'))
})

afterEach(() => {
  cleanup()
  listNameTemplates.mockReset()
  addNameTemplate.mockReset()
  updateNameTemplate.mockReset()
  removeNameTemplate.mockReset()
  reorderNameTemplates.mockReset()
  resetNameTemplate.mockReset()
  restoreNameTemplates.mockReset()
})

const SHIPPED_ENTRY = {
  id: 'q2pro-beginmapcmd',
  template: '{map}_{date}_{time}.dm2',
  origin: 'shipped' as const,
  edited: false,
}
const USER_ENTRY = {
  id: 'user-1',
  template: '{p1}_vs_{p2}',
  origin: 'user' as const,
  edited: false,
}

function rowsLocator() {
  return screen.getAllByTestId(/^replays-name-template-\d+$/)
}

describe('rows render in list order with their origin badge', () => {
  it('shows the shipped entry then the user entry, each with its own badge', async () => {
    listNameTemplates.mockResolvedValue(
      transportOk({ ok: true, value: { entries: [SHIPPED_ENTRY, USER_ENTRY], canRestore: false } }),
    )

    render(createElement(NameTemplatesList))

    await screen.findByTestId('replays-name-templates')
    const rows = rowsLocator()
    expect(rows).toHaveLength(2)

    expect(rows[0].textContent).toContain(SHIPPED_ENTRY.template)
    expect(rows[0].textContent).toContain(en.replays.nameTemplates.badge.builtIn)
    expect(rows[1].textContent).toContain(USER_ENTRY.template)
    expect(rows[1].textContent).toContain(en.replays.nameTemplates.badge.custom)
  })
})

describe('an invalid template shows its reason next to the field and cannot be added', () => {
  it('rejects an unknown token and disables Add', async () => {
    listNameTemplates.mockResolvedValue(
      transportOk({ ok: true, value: { entries: [], canRestore: false } }),
    )

    render(createElement(NameTemplatesList))
    await screen.findByTestId('replays-name-templates')

    const input = screen.getByTestId('replays-name-template-input')
    fireEvent.change(input, { target: { value: '{nope}' } })

    const error = await screen.findByTestId('replays-name-template-error')
    expect(error.textContent).toBe(en.replays.nameTemplate.error.unknownToken.replace('{{token}}', 'nope'))

    const addButton = screen.getByTestId('replays-name-template-add')
    expect((addButton as HTMLButtonElement).disabled).toBe(true)
    expect(addNameTemplate).not.toHaveBeenCalled()
  })
})

describe("a main failure is shown in the field's reason slot", () => {
  it('renders the rejected outcome in the add field error slot', async () => {
    listNameTemplates.mockResolvedValue(
      transportOk({ ok: true, value: { entries: [], canRestore: false } }),
    )
    addNameTemplate.mockResolvedValue(
      transportOk({ ok: false, error: { key: 'replays.nameTemplates.error.tooMany' } }),
    )

    render(createElement(NameTemplatesList))
    await screen.findByTestId('replays-name-templates')

    const input = screen.getByTestId('replays-name-template-input')
    fireEvent.change(input, { target: { value: '{map}_{date}' } })

    const addButton = screen.getByTestId('replays-name-template-add')
    expect((addButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(addButton)

    await waitFor(() => {
      expect(addNameTemplate).toHaveBeenCalledWith('{map}_{date}')
    })

    const error = await screen.findByTestId('replays-name-template-error')
    expect(error.textContent).toBe(en.replays.nameTemplates.error.tooMany)
  })
})

describe('every string comes from the replays block', () => {
  it('renders only i18n-sourced copy, aside from the templates’ own (data-driven) text', async () => {
    listNameTemplates.mockResolvedValue(
      transportOk({
        ok: true,
        value: {
          entries: [{ ...SHIPPED_ENTRY, edited: true }, USER_ENTRY],
          canRestore: true,
        },
      }),
    )

    const keyEcho: I18nInstance = createInstance()
    await keyEcho.init({ lng: 'en', resources: { en: { translation: {} } } })

    const { container } = render(
      <I18nextProvider i18n={keyEcho}>
        <NameTemplatesList />
      </I18nextProvider>,
    )

    await screen.findByTestId('replays-name-templates')

    // Dynamic, user/shipped-authored data - not translatable UI copy, so it's excluded from the
    // "every string is a key" sweep below.
    const dataStrings = new Set([SHIPPED_ENTRY.template, USER_ENTRY.template])

    const texts = visibleTexts(container).filter((text) => !dataStrings.has(text))
    expect(texts.length).toBeGreaterThan(0)

    for (const text of texts) {
      // With a key-echoing `t`, anything on screen that is not a dotted key is prose somebody
      // hardcoded into this component. `dnd.*` keys come from the shared `SortableList`/
      // `DragHandle` primitives this component composes, not from this component's own copy - the
      // assertions below instead confirm every string *this component itself* contributes lives
      // under the `replays` block.
      expect(text).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/)
      expect(typeof translationFor(text)).toBe('string')
    }

    const ownTexts = texts.filter((text) => !text.startsWith('dnd.'))
    expect(ownTexts.length).toBeGreaterThan(0)
    for (const text of ownTexts) {
      expect(text).toMatch(/^replays\./)
    }

    expect(texts).toContain('replays.nameTemplates.heading')
    expect(texts).toContain('replays.nameTemplates.restore')
    expect(texts).toContain('replays.nameTemplates.badge.edited')
  })
})

/** Every non-blank piece of text the user can read, in document order. */
function visibleTexts(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: string[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim()
    if (text) texts.push(text)
  }
  return texts
}

/** Resolves a dotted i18n key against the shipped English bundle. */
function translationFor(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      en,
    )
}
