import { beforeAll, describe, expect, it } from 'vitest'
import { DEMO_UNREADABLE_REASONS } from '@shared/demos/readability'
import { initI18n } from '../../i18n'

let t: (key: string, params?: Record<string, unknown>) => string
let UNREADABLE_REASON_KEYS: typeof import('./unreadable-reason').UNREADABLE_REASON_KEYS
let unreadableReasonMessage: typeof import('./unreadable-reason').unreadableReasonMessage

beforeAll(async () => {
  const i18n = await initI18n('en')
  t = i18n.t.bind(i18n)
  ;({ UNREADABLE_REASON_KEYS, unreadableReasonMessage } = await import('./unreadable-reason'))
})

describe('unreadable-reason', () => {
  it.each(DEMO_UNREADABLE_REASONS)(
    'every unreadable reason code has an en string: %s',
    (reason) => {
      const key = UNREADABLE_REASON_KEYS[reason]
      const text = t(key, { protocol: 36, version: 2008 })

      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toBe(key)
      expect(text).not.toContain('{{')
    },
  )

  it('unknown protocol and version interpolate their number', () => {
    const protocolMessage = unreadableReasonMessage({ reason: 'unknown-protocol', protocol: 36 })
    expect(t(protocolMessage.key, protocolMessage.params)).toBe('Unknown protocol 36')

    const versionMessage = unreadableReasonMessage({ reason: 'unknown-version', version: 2008 })
    expect(t(versionMessage.key, versionMessage.params)).toBe('Unknown MVD version 2008')
  })

  it('the unreadable marker has an en string', () => {
    expect(t('replays.unreadable.marker')).toBe('Unreadable')
  })
})
