import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { serverAddressSchema } from '../schemas'
import {
  formatServerAddress,
  parseServerAddress,
  serverAddressRejectionKey,
  type ServerAddressRejection,
} from './address'
// A static import, not a runtime `fs.readFile`: `src/shared` may never import `node:*`
// (docs/ARCHITECTURE.md), even in a test, since this file type-checks under `tsconfig.web.json`
// too (which carries no node types at all). See `src/shared/config/comment-labels.test.ts` for the
// same pattern.
import en from '../../renderer/src/i18n/locales/en.json'

describe('parseServerAddress', () => {
  it('accepts a hostname and an IPv4 literal with a port', () => {
    const hostname = parseServerAddress('Quake2.Example.com:27910')
    expect(hostname).toEqual({
      ok: true,
      host: 'quake2.example.com',
      port: 27910,
      kind: 'hostname',
      normalized: 'quake2.example.com:27910',
    })

    const ipv4 = parseServerAddress('192.168.1.10:27911')
    expect(ipv4).toEqual({
      ok: true,
      host: '192.168.1.10',
      port: 27911,
      kind: 'ipv4',
      normalized: '192.168.1.10:27911',
    })
  })

  it('rejects each malformed address with its own reason', () => {
    const cases: Array<[string, ServerAddressRejection]> = [
      ['', 'empty'],
      ['   ', 'empty'],
      ['example.com:27910 extra', 'extra-tokens'],
      ['example.com:27910 junk', 'extra-tokens'],
      [`bad"quote.com:27910`, 'forbidden-character'],
      [`bad'quote.com:27910`, 'forbidden-character'],
      [`bad\\slash.com:27910`, 'forbidden-character'],
      [`bad;semicolon.com:27910`, 'forbidden-character'],
      ['+set sv_cheats 1', 'argument-token'],
      ['example.com', 'missing-port'],
      ['example.com:', 'missing-port'],
      ['example.com:notaport', 'port-not-numeric'],
      ['example.com:0', 'port-out-of-range'],
      ['example.com:65536', 'port-out-of-range'],
      ['a:b:c:27910', 'too-many-colons'],
      ['[::1]:27910', 'ipv6-not-supported'],
      ['fe80::1:27910', 'ipv6-not-supported'],
      [':27910', 'host-empty'],
      [`${'a'.repeat(254)}:27910`, 'host-too-long'],
      ['bad_host.com:27910', 'host-label-invalid'],
      ['1.2.3.300:27910', 'ipv4-octet-out-of-range'],
    ]

    for (const [input, reason] of cases) {
      const result = parseServerAddress(input)
      expect(result, `input: ${JSON.stringify(input)}`).toEqual({ ok: false, reason })
    }
  })

  it('rejects a host outside the documented character set', () => {
    expect(parseServerAddress(':27910')).toEqual({ ok: false, reason: 'host-empty' })
    expect(parseServerAddress(`${'a'.repeat(254)}:27910`)).toEqual({ ok: false, reason: 'host-too-long' })
    expect(parseServerAddress('bad_host.com:27910')).toEqual({ ok: false, reason: 'host-label-invalid' })
    expect(parseServerAddress('-leading.com:27910')).toEqual({ ok: false, reason: 'host-label-invalid' })
    expect(parseServerAddress('trailing-.com:27910')).toEqual({ ok: false, reason: 'host-label-invalid' })
    expect(parseServerAddress(`${'a'.repeat(64)}.com:27910`)).toEqual({ ok: false, reason: 'host-label-invalid' })
  })

  it('rejects an IPv4 octet out of range, including a leading-zero octet', () => {
    expect(parseServerAddress('1.2.3.300:27910')).toEqual({ ok: false, reason: 'ipv4-octet-out-of-range' })
    expect(parseServerAddress('10.0.0.010:27910')).toEqual({ ok: false, reason: 'ipv4-octet-out-of-range' })
  })

  it('rejects a non-4-label all-numeric host as an invalid hostname', () => {
    // `1.2.3` is not a 4-label dotted-decimal candidate, so it falls through to the hostname
    // branch, where an all-numeric label is rejected too (see address.ts's file doc comment).
    expect(parseServerAddress('1.2.3:27910')).toEqual({ ok: false, reason: 'host-label-invalid' })
  })

  it('never fills in a default port', () => {
    expect(parseServerAddress('example.com')).toEqual({ ok: false, reason: 'missing-port' })
  })
})

describe('formatServerAddress', () => {
  it('builds the canonical lowercase host + decimal port form', () => {
    expect(formatServerAddress('Example.COM', 27910)).toBe('example.com:27910')
  })
})

describe('serverAddressRejectionKey', () => {
  it('maps a reason code to its i18n key', () => {
    expect(serverAddressRejectionKey('empty')).toBe('servers.address.reject.empty')
    expect(serverAddressRejectionKey('ipv4-octet-out-of-range')).toBe(
      'servers.address.reject.ipv4-octet-out-of-range',
    )
  })
})

describe('serverAddressSchema', () => {
  it('parses a valid address into its normalized string', () => {
    expect(serverAddressSchema.parse('q2.example.com:27910')).toBe('q2.example.com:27910')
  })

  it('fails a malformed address with the reason code as the issue message', () => {
    const result = serverAddressSchema.safeParse('q2.example.com')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('missing-port')
    }
  })
})

describe('every rejection reason has its own i18n key', () => {
  // Hardcoded rather than derived, and typed as `ServerAddressRejection[]` so a mismatch against
  // the union (a reason added to `address.ts` but missing here, or vice versa) is a compile error.
  const ALL_REASONS: ServerAddressRejection[] = [
    'empty',
    'extra-tokens',
    'forbidden-character',
    'argument-token',
    'missing-port',
    'port-not-numeric',
    'port-out-of-range',
    'too-many-colons',
    'ipv6-not-supported',
    'host-empty',
    'host-too-long',
    'host-label-invalid',
    'ipv4-octet-out-of-range',
  ]

  function stringAt(path: string): string | undefined {
    const value: unknown = path
      .split('.')
      .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' && key in acc ? (acc as Record<string, unknown>)[key] : undefined), en)
    return typeof value === 'string' ? value : undefined
  }

  it.each(ALL_REASONS)('%s resolves to a non-empty en.json string', (reason) => {
    const key = serverAddressRejectionKey(reason)
    const message = stringAt(key)
    expect(typeof message).toBe('string')
    expect(message?.length).toBeGreaterThan(0)
  })
})

describe('purity', () => {
  it('imports nothing from node, electron or the IPC layer', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, 'address.ts'), 'utf-8')

    expect(source).not.toMatch(/from\s+['"]node:/)
    expect(source).not.toMatch(/from\s+['"]electron['"]/)
    expect(source).not.toMatch(/from\s+['"][^'"]*\/(ipc|preload)[^'"]*['"]/)
    expect(source).not.toMatch(/from\s+['"]\.\.\/ipc['"]/)
  })
})
