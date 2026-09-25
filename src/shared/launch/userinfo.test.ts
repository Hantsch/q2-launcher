import { describe, expect, it } from 'vitest'
import en from '../../renderer/src/i18n/locales/en.json'
import {
  CONNECT_CFG_NAME,
  parseUserinfoValue,
  renderConnectCfg,
  userinfoRejectionKey,
  type UserinfoRejection,
} from './userinfo'

describe('CONNECT_CFG_NAME', () => {
  it('names the one-shot connect cfg', () => {
    expect(CONNECT_CFG_NAME).toBe('q2launcher-connect.cfg')
  })
})

describe('a userinfo value is printable ASCII without quote, backslash or semicolon', () => {
  it('accepts a plain value', () => {
    expect(parseUserinfoValue('hunter2 x')).toEqual({ ok: true })
  })

  it('rejects an empty value', () => {
    expect(parseUserinfoValue('')).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects a value longer than 63 characters', () => {
    const tooLong = 'a'.repeat(64)
    expect(parseUserinfoValue(tooLong)).toEqual({ ok: false, reason: 'too-long' })
  })

  it.each([
    ['double quote', 'a"b'],
    ['semicolon', 'a;b'],
    ['backslash', 'a\\b'],
    ['newline', 'a\nb'],
    ['non-ASCII', 'é'],
  ])('rejects %s as a forbidden character', (_label, value) => {
    expect(parseUserinfoValue(value)).toEqual({ ok: false, reason: 'forbidden-character' })
  })
})

describe('the connect cfg sets only the present keys, quoted, in fixed order', () => {
  it('writes both keys, password before spectator, when both are present', () => {
    const cfg = renderConnectCfg({ password: 'hunter2', spectator: '1' })
    expect(cfg).toBe(
      '// written by Q2 Launcher for one launch, removed when the game exits\n' +
        'set password "hunter2"\n' +
        'set spectator "1"\n',
    )
  })

  it('writes only password when spectator is absent', () => {
    const cfg = renderConnectCfg({ password: 'hunter2' })
    expect(cfg).not.toContain('spectator')
    expect(cfg).toContain('set password "hunter2"\n')
  })

  it('writes only spectator when password is absent', () => {
    const cfg = renderConnectCfg({ spectator: '1' })
    expect(cfg).not.toContain('password')
    expect(cfg).toContain('set spectator "1"\n')
  })

  it('writes just the header when nothing is present', () => {
    expect(renderConnectCfg({})).toBe(
      '// written by Q2 Launcher for one launch, removed when the game exits\n',
    )
  })

  it('throws on a value that fails validation, as defence in depth', () => {
    expect(() => renderConnectCfg({ password: 'a;b' })).toThrow()
  })
})

describe('userinfoRejectionKey', () => {
  it('maps a reason code to its i18n key', () => {
    expect(userinfoRejectionKey('empty')).toBe('launch.userinfo.reject.empty')
    expect(userinfoRejectionKey('too-long')).toBe('launch.userinfo.reject.too-long')
  })
})

describe('every userinfo rejection has an i18n key', () => {
  // Hardcoded rather than derived, so a reason added to `userinfo.ts` but missing here (or vice
  // versa) is a compile error, mirroring `src/shared/servers/address.test.ts`.
  const ALL_REASONS: UserinfoRejection[] = ['empty', 'too-long', 'forbidden-character']

  function stringAt(path: string): string | undefined {
    const value: unknown = path
      .split('.')
      .reduce<unknown>(
        (acc, key) => (acc && typeof acc === 'object' && key in acc ? (acc as Record<string, unknown>)[key] : undefined),
        en,
      )
    return typeof value === 'string' ? value : undefined
  }

  it.each(ALL_REASONS)('%s resolves to a non-empty en.json string', (reason) => {
    const key = userinfoRejectionKey(reason)
    const message = stringAt(key)
    expect(typeof message).toBe('string')
    expect(message?.length).toBeGreaterThan(0)
  })
})
