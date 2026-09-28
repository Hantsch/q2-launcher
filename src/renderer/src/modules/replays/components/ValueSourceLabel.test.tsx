// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { VALUE_SOURCES, type ValueSource } from '@shared/demos/effective-values'
import en from '../../../i18n/locales/en.json'
import { initI18n } from '../../../i18n'
import { ValueSourceLabel } from './ValueSourceLabel'

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

/** Every `ValueSource`'s exact en label, keyed the same way `replays.source.<source>` is. A
 * missing/renamed i18n key must fail this test, not just produce empty text. */
const EXPECTED_LABEL: Record<ValueSource, string> = {
  sidecar: 'set by you',
  demo: 'from the demo',
  name: 'from the file name',
  file: 'file time',
  guessed: 'guessed',
}

function stringAt(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' && key in acc ? (acc as Record<string, unknown>)[key] : undefined), en)
}

describe('ValueSourceLabel', () => {
  it('every value source is shown as visible text', () => {
    for (const source of VALUE_SOURCES) {
      render(createElement(ValueSourceLabel, { source }))

      const label = screen.getByTestId('value-source')
      expect(label.textContent).toBe(EXPECTED_LABEL[source])

      cleanup()
    }
  })

  it('every value source has an en label', () => {
    for (const source of VALUE_SOURCES) {
      const value = stringAt(`replays.source.${source}`)
      expect(typeof value).toBe('string')
      expect((value as string).length).toBeGreaterThan(0)
    }
  })

  it('renders nothing when the source is null', () => {
    const { container } = render(createElement(ValueSourceLabel, { source: null }))

    expect(container.textContent).toBe('')
    expect(screen.queryByTestId('value-source')).toBeNull()
  })
})
