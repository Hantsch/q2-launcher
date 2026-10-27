import { beforeAll, describe, expect, it } from 'vitest'
import i18next from 'i18next'
import { initI18n } from '../../i18n'
import { fullLocation, shortLocation } from './location-label'

beforeAll(async () => {
  await initI18n('en')
})

describe('location label', () => {
  it('short and full labels for country, LAN, Unknown and missing', () => {
    const t = i18next.t.bind(i18next)
    const germany = { kind: 'country', country: 'DE', continent: 'EU' } as const
    const brazil = { kind: 'country', country: 'BR', continent: 'SA' } as const

    expect(shortLocation(germany, t, 'en')).toBe('EU · Germany')
    expect(fullLocation(germany, t, 'en')).toBe('Germany, Europe')
    expect(fullLocation(brazil, t, 'en')).toBe('Brazil, South America')

    expect(shortLocation({ kind: 'lan' }, t, 'en')).toBe('LAN')
    expect(fullLocation({ kind: 'lan' }, t, 'en')).toBe('LAN')

    for (const location of [{ kind: 'unknown' } as const, undefined]) {
      expect(shortLocation(location, t, 'en')).toBe('Unknown')
      expect(fullLocation(location, t, 'en')).toBe('Unknown')
    }
  })
})
