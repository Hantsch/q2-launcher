// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigCvarSection, ConfigProfile } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import { ProfileChangesProvider } from './lib/profile-changes'

/**
 * Story 054 D10: Settings drags - sections, sub-sections and cvars each reorder/move by drag,
 * including a cvar dragged out of the reserved `Other` bucket into a real section (D9's own case).
 *
 * Driven through dnd-kit's *keyboard* sensor, exactly like `ControlsGrid.dnd.test.tsx` (D4) and for
 * the same reason: jsdom has no layout engine, so a pointer drag's measured-rect math cannot be
 * exercised here, while the keyboard sensor dispatches plain `keydown` events and only needs the
 * stubbed rects below - the same `onDragEnd`/`onDropOutside` mapping this file is actually about,
 * whichever sensor drove it there.
 *
 * `SettingsTab`'s own `client.ts` reaches the shared `bridge`, so the same "stub `window.q2` before
 * the module is imported" idiom `ControlsTab.dnd.test.tsx` uses is needed here too.
 */
const bridge = vi.hoisted(() => {
  const stub = {
    invoke: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    on: () => () => {},
  }
  ;(globalThis as unknown as { q2: unknown }).q2 = stub
  return stub
})

// eslint-disable-next-line import/first -- must be imported after the bridge stub above exists.
const { SettingsTab } = await import('./SettingsTab')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function baseProfile(cvarSections: ConfigCvarSection[], cvars: Record<string, string> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars,
    binds: {},
    assignments: [],
    cvarSections: cvarSections.map((section) => ({
      ...section,
      cvars: [...section.cvars],
      subsections: section.subsections?.map((sub) => ({ ...sub, cvars: [...sub.cvars] })),
    })),
    // No unplaced catalogue cvars on screen - keeps the rendered row list to exactly the cvars a
    // test names, so a keyboard step count means what the test says it means.
    writeCatalogDefaults: false,
  }
}

let container: HTMLDivElement
let root: Root
/** Every `SetProfileCvarsInput`-shaped payload the tab tried to persist, in order. */
let saved: { cvars: Record<string, string>; cvarSections?: ConfigCvarSection[] }[]

beforeAll(async () => {
  await initI18n('en')
})

function rectAt(index: number): DOMRect {
  const top = index >= 0 ? index * 40 : 0
  const height = index >= 0 ? 40 : 0
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 800,
    width: 800,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/** Every element this test's drags can target, in rendered order - a section header, a sub-section
 * header or a cvar row's own wrapper, identified by whichever of the three `data-*` attributes
 * `SettingsTab` gives it. Recomputed on every call (rather than a static list) so it stays correct
 * across the whole file, but never changes *during* one drag - dnd-kit only ever changes an item's
 * `style.transform`, not its DOM position - so a rect map built once per drag is faithful. */
function draggableElements(): Element[] {
  return [...container.querySelectorAll('[data-section-id], [data-subsection-id], [data-cvar-name]')]
}

function stubRects(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const isDraggable =
      this.hasAttribute('data-section-id') ||
      this.hasAttribute('data-subsection-id') ||
      this.hasAttribute('data-cvar-name')
    if (!isDraggable) return rectAt(-1)
    return rectAt(draggableElements().indexOf(this))
  })
}

function Harness({ profile }: { profile: ConfigProfile }) {
  const [draft, setDraft] = useState<ConfigProfile>(profile)
  return (
    <ProfileChangesProvider profile={profile}>
      <SettingsTab
        profile={profile}
        draft={draft}
        patch={(partial) =>
          setDraft((prev) => ({
            ...prev,
            ...(typeof partial === 'function' ? partial(prev) : partial),
          }))
        }
        onChanged={() => {}}
      />
    </ProfileChangesProvider>
  )
}

function renderTab(profile: ConfigProfile): void {
  act(() => {
    root.render(<Harness profile={profile} />)
  })
}

function gripInside(selector: string): HTMLButtonElement {
  const host = container.querySelector(selector)
  const grip = host?.querySelector<HTMLButtonElement>('button[aria-label="Drag to reorder"]')
  if (!grip) throw new Error(`no grip found for ${selector}`)
  return grip
}

const cvarGrip = (name: string) => gripInside(`[data-cvar-name="${name}"]`)
const sectionGrip = (id: string) => gripInside(`[data-section-id="${id}"]`)
const subsectionGrip = (id: string) => gripInside(`[data-subsection-id="${id}"]`)

/** dnd-kit (re)measures droppable rects on an animation frame while a drag is active. */
async function pressKey(target: HTMLElement, code: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

/** Space picks the item up, each arrow moves it one step, Space drops it. */
async function dragBy(grip: HTMLButtonElement, direction: 'ArrowUp' | 'ArrowDown', steps: number) {
  grip.focus()
  await pressKey(grip, 'Space')
  for (let step = 0; step < steps; step += 1) await pressKey(grip, direction)
  await pressKey(grip, 'Space')
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  saved = []
  bridge.invoke = vi.fn((_channel: string, payload: unknown) => {
    const envelope = payload as {
      type: string
      payload?: { cvars?: Record<string, string>; cvarSections?: ConfigCvarSection[] }
    }
    if (envelope.type === 'setCvars' && envelope.payload) {
      saved.push({ cvars: envelope.payload.cvars ?? {}, cvarSections: envelope.payload.cvarSections })
    }
    return Promise.resolve({ ok: true, value: [] })
  }) as unknown as typeof bridge.invoke
  stubRects()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('SettingsTab drag (story 054 D10)', () => {
  it('reorders two cvars inside one section by dragging the second past the first', async () => {
    const profile = baseProfile([
      { id: 'sec-a', name: 'Alpha', cvars: ['cl_maxfps', 'crosshair'] },
    ])
    renderTab(profile)

    await dragBy(cvarGrip('cl_maxfps'), 'ArrowDown', 1)

    expect(saved).toHaveLength(1)
    const sectionA = saved[0]!.cvarSections!.find((section) => section.id === 'sec-a')!
    expect(sectionA.cvars).toEqual(['crosshair', 'cl_maxfps'])
  })

  it('moves a cvar from one section into another', async () => {
    const profile = baseProfile([
      { id: 'sec-a', name: 'Alpha', cvars: ['cl_maxfps'] },
      { id: 'sec-b', name: 'Beta', cvars: ['sensitivity'] },
    ])
    renderTab(profile)

    // Two steps: the first arrow-down lands on section B's own header (a different sortable axis,
    // filtered out of a cvar row's own collision candidates), which resolves back to the dragged
    // row itself - a second step is what actually reaches `sensitivity`.
    await dragBy(cvarGrip('cl_maxfps'), 'ArrowDown', 2)

    expect(saved).toHaveLength(1)
    const [sectionA, sectionB] = saved[0]!.cvarSections!
    expect(sectionA!.cvars).toEqual([])
    expect(sectionB!.cvars).toEqual(['sensitivity', 'cl_maxfps'])
  })

  it('moves a cvar out of the reserved Other bucket into a real section', async () => {
    const profile = baseProfile(
      [{ id: 'sec-a', name: 'Alpha', cvars: ['cl_maxfps'] }],
      { custom_thing: '5' },
    )
    renderTab(profile)

    // Rendered order: Alpha's header, cl_maxfps, the (undraggable) Other header, custom_thing.
    await dragBy(cvarGrip('custom_thing'), 'ArrowUp', 1)

    expect(saved).toHaveLength(1)
    const sectionA = saved[0]!.cvarSections!.find((section) => section.id === 'sec-a')!
    expect(sectionA.cvars).toEqual(['custom_thing', 'cl_maxfps'])
    // Its value in `profile.cvars` survives the move untouched (D9: placement only).
    expect(saved[0]!.cvars.custom_thing).toBe('5')
  })

  it('reorders two sections by dragging one section header past the other', async () => {
    const profile = baseProfile([
      { id: 'sec-a', name: 'Alpha', cvars: ['cl_maxfps'] },
      { id: 'sec-b', name: 'Beta', cvars: ['sensitivity'] },
    ])
    renderTab(profile)

    // Two steps for the same reason as the cross-section cvar move above: the first arrow-down
    // lands on `cl_maxfps` (a row, filtered out of a section header's own candidates), which
    // resolves back to the dragged header itself.
    await dragBy(sectionGrip('sec-a'), 'ArrowDown', 2)

    expect(saved).toHaveLength(1)
    expect(saved[0]!.cvarSections!.map((section) => section.id)).toEqual(['sec-b', 'sec-a'])
  })

  it('reorders two sub-sections of the same section by dragging one header past the other', async () => {
    const profile = baseProfile([
      {
        id: 'sec-a',
        name: 'Alpha',
        cvars: [],
        subsections: [
          { id: 'sub-1', name: 'Sub1', cvars: ['cl_maxfps'] },
          { id: 'sub-2', name: 'Sub2', cvars: ['crosshair'] },
        ],
      },
    ])
    renderTab(profile)

    // Two steps for the same reason: the first arrow-down lands on sub-1's own `cl_maxfps` row.
    await dragBy(subsectionGrip('sub-1'), 'ArrowDown', 2)

    expect(saved).toHaveLength(1)
    const sectionA = saved[0]!.cvarSections!.find((section) => section.id === 'sec-a')!
    expect(sectionA.subsections!.map((sub) => sub.id)).toEqual(['sub-2', 'sub-1'])
  })

  it('review-fix (finding 5): lands a reorder at the right real index around a "ghost" cvar name the row resolver drops from rendering', async () => {
    // `cl_maxfps` is listed by both sections; the story's decision claims it for the first section
    // that lists it (`sec-a`), so `sec-b`'s own copy renders no row at all - a "ghost" name still
    // present in `sec-b.cvars` but invisible on screen. Rendered order in sec-b is therefore just
    // [sensitivity, crosshair].
    const profile = baseProfile([
      { id: 'sec-a', name: 'Alpha', cvars: ['cl_maxfps'] },
      { id: 'sec-b', name: 'Beta', cvars: ['cl_maxfps', 'sensitivity', 'crosshair'] },
    ])
    renderTab(profile)

    // Drag crosshair up past sensitivity, entirely inside sec-b's rendered rows.
    await dragBy(cvarGrip('crosshair'), 'ArrowUp', 1)

    expect(saved).toHaveLength(1)
    const sectionB = saved[0]!.cvarSections!.find((section) => section.id === 'sec-b')!
    // The ghost (`cl_maxfps`) must stay put at the front of the real array - only the two rendered
    // names swap - not be pushed aside by an index computed from the rendered (ghost-free) list.
    expect(sectionB.cvars).toEqual(['cl_maxfps', 'crosshair', 'sensitivity'])
  })

  it('disables cvar grips (with an explaining tooltip) while the filter narrows the list, but leaves section grips enabled', async () => {
    const profile = baseProfile([{ id: 'sec-a', name: 'Alpha', cvars: ['cl_maxfps'] }])
    renderTab(profile)

    const filterInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Filter cvars…"]',
    )!
    await act(async () => setInputValue(filterInput, 'cl_maxfps'))

    const cvarGripEl = cvarGrip('cl_maxfps')
    expect(cvarGripEl.getAttribute('aria-disabled')).toBe('true')
    expect(cvarGripEl.getAttribute('title')).toBe(
      'Clear the filter, turn off Unsaved only, and expand Advanced to reorder by dragging',
    )

    const sectionGripEl = sectionGrip('sec-a')
    expect(sectionGripEl.getAttribute('aria-disabled')).not.toBe('true')

    await dragBy(cvarGripEl, 'ArrowDown', 1)
    expect(saved).toEqual([])
  })
})
