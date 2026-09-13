// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ProfileChange, ProfileChangeSet } from '@shared/config/profile-diff'
import { initI18n } from '../../../i18n'
import { ProfileChangeList } from './ProfileChangeList'

/**
 * Story 064 D2: the row is a diff, not a one-line summary. Mirrors `ControlsGrid.dnd.test.tsx`'s
 * jsdom + i18n setup (real react-dom mount under `act`, `initI18n('en')` once) rather than
 * `@testing-library/react`, which nothing in this module tree uses yet.
 *
 * Builds `ProfileChangeSet` fixtures directly - this component never computes a diff itself, only
 * renders one `profile-diff.ts` already produced - so each test only has to shape the `ProfileChange`
 * rows its assertion cares about.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function changeSet(changes: ProfileChange[]): ProfileChangeSet {
  const sections: Partial<Record<ProfileChange['section'], ProfileChange[]>> = {}
  const keys: Record<ProfileChange['section'], Set<string>> = {
    cvars: new Set(),
    binds: new Set(),
    actions: new Set(),
    layers: new Set(),
    settings: new Set(),
    unrecognized: new Set(),
  }
  for (const change of changes) {
    ;(sections[change.section] ??= []).push(change)
    keys[change.section].add(change.key)
  }
  return { changes, sections, keys, count: changes.length }
}

let container: HTMLDivElement
let root: Root

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(set: ProfileChangeSet): void {
  act(() => {
    root.render(<ProfileChangeList changeSet={set} />)
  })
}

describe('ProfileChangeList', () => {
  it('every change row shows a concrete before and a concrete after', () => {
    render(
      changeSet([
        {
          section: 'cvars',
          kind: 'changed',
          key: 'sensitivity',
          label: 'sensitivity',
          before: '3',
          after: '4.5',
        },
      ]),
    )

    const row = container.querySelector('[data-testid="config-save-changes"] li')!
    expect(row.textContent).toContain('sensitivity')
    expect(row.textContent).toContain('3')
    expect(row.textContent).toContain('4.5')
  })

  it("an added change has no before and says 'added' in text", () => {
    render(
      changeSet([
        {
          section: 'cvars',
          kind: 'added',
          key: 'newcvar',
          label: 'newcvar',
          before: undefined,
          after: '1',
        },
      ]),
    )

    const row = container.querySelector('[data-testid="config-save-changes"] li')!
    expect(row.textContent).toMatch(/Added/)
    expect(row.textContent).toContain('unset')
    expect(row.textContent).toContain('1')
  })

  it("a removed change has no after and says 'removed' in text", () => {
    render(
      changeSet([
        {
          section: 'binds',
          kind: 'removed',
          key: 'F1',
          label: 'F1',
          before: 'say gg',
          after: undefined,
        },
      ]),
    )

    const row = container.querySelector('[data-testid="config-save-changes"] li')!
    expect(row.textContent).toMatch(/Removed/)
    expect(row.textContent).toContain('say gg')
    expect(row.textContent).toContain('unbound')
  })

  it('no row renders a bare count or an unlabelled sentence', () => {
    render(
      changeSet([
        {
          section: 'settings',
          kind: 'changed',
          key: 'writeUnbindall',
          label: 'writeUnbindall',
          before: 'true',
          after: 'false',
        },
        {
          section: 'actions',
          kind: 'changed',
          key: 'a1',
          label: 'Quick gg',
          before: 'Quick gg (bind) F1: say gg',
          after: 'Quick gg (bind) F1: say gg well played',
          details: [{ field: 'commands', before: 'say gg', after: 'say gg well played' }],
        },
      ]),
    )

    const rows = [...container.querySelectorAll('[data-testid="config-save-changes"] > div > ul > li')]
    expect(rows.length).toBe(2)
    // The settings row's field name is translated, not the raw model key.
    const settingsRow = rows.find((row) => row.textContent?.includes('true'))!
    expect(settingsRow.textContent).toContain('Write unbindall')
    expect(settingsRow.textContent).not.toContain('writeUnbindall')
    // The action row's detail is labelled by its translated field name.
    const actionRow = rows.find((row) => row.textContent?.includes('Quick gg'))!
    expect(actionRow.textContent).toContain('Commands')
    expect(actionRow.textContent).not.toMatch(/^\s*\{/) // no raw JSON anywhere in the row
  })

  it('a 40-command body stays inside the bounded value block', () => {
    const commands = Array.from({ length: 40 }, (_, i) => `say cmd${i}`).join('\n')
    render(
      changeSet([
        {
          section: 'actions',
          kind: 'changed',
          key: 'a1',
          label: 'Spammer',
          before: 'Spammer (bind) F1: say cmd0',
          after: 'Spammer (bind) F1: say cmd0; ...',
          details: [{ field: 'commands', before: 'say cmd0', after: commands }],
        },
      ]),
    )

    const blocks = [...container.querySelectorAll('[data-testid="profile-change-detail-value"]')]
    expect(blocks.length).toBeGreaterThan(0)
    const afterBlock = blocks.find((block) => block.textContent?.includes('cmd39'))!
    expect(afterBlock.className).toContain('max-h-24')
    expect(afterBlock.className).toContain('overflow-y-auto')
    expect(afterBlock.className).toContain('whitespace-pre-line')
    expect(afterBlock.className).toContain('break-words')
    expect(afterBlock.textContent).toContain('cmd0')
    expect(afterBlock.textContent).toContain('cmd39')
  })
})
