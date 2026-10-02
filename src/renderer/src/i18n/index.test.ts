import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { i18next, initI18n } from './index'

describe('missing translation keys', () => {
  beforeAll(async () => {
    await initI18n('en')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the caller's defaultValue when the key is missing", () => {
    expect(i18next.t('no.such.key', { defaultValue: 'Fallback label' })).toBe('Fallback label')
  })

  it('renders the key itself when the key is missing and no defaultValue is given', () => {
    // A key without a fallback is a dev-time bug and is reported; the report is not under test.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(i18next.t('no.such.key')).toBe('no.such.key')
  })
})
