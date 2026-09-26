import { describe, expect, it } from 'vitest'

import {
  DEFAULT_UDP_MASTER_PORT,
  HTTP_LIST_MAX_LENGTH,
  masterSourceAddressRejectionKey,
  validateMasterSourceAddress,
  type MasterSourceAddressRejection,
} from './master-source-address'

describe('validateMasterSourceAddress - udp-master', () => {
  it('accepts a host:port pair unchanged (normalized, lowercase host)', () => {
    expect(validateMasterSourceAddress('udp-master', 'Master.Q2Servers.com:27900')).toEqual({
      ok: true,
      normalized: 'master.q2servers.com:27900',
    })
  })

  it('defaults a missing port to 27900', () => {
    expect(validateMasterSourceAddress('udp-master', 'master.q2servers.com')).toEqual({
      ok: true,
      normalized: `master.q2servers.com:${DEFAULT_UDP_MASTER_PORT}`,
    })
  })

  it('accepts an IPv4 literal with a defaulted port', () => {
    expect(validateMasterSourceAddress('udp-master', '192.168.1.10')).toEqual({
      ok: true,
      normalized: `192.168.1.10:${DEFAULT_UDP_MASTER_PORT}`,
    })
  })

  it('rejects malformed addresses with parseServerAddress reason codes', () => {
    expect(validateMasterSourceAddress('udp-master', '')).toEqual({ ok: false, reason: 'empty' })
    expect(validateMasterSourceAddress('udp-master', 'example.com:notaport')).toEqual({
      ok: false,
      reason: 'port-not-numeric',
    })
    expect(validateMasterSourceAddress('udp-master', 'example.com:70000')).toEqual({
      ok: false,
      reason: 'port-out-of-range',
    })
    expect(validateMasterSourceAddress('udp-master', 'fe80::1')).toEqual({
      ok: false,
      reason: 'ipv6-not-supported',
    })
    expect(validateMasterSourceAddress('udp-master', '+set sv_cheats 1')).toEqual({
      ok: false,
      reason: 'argument-token',
    })
  })

  it('does not default a port onto an already-malformed multi-colon candidate', () => {
    expect(validateMasterSourceAddress('udp-master', 'a:b:c')).toEqual({
      ok: false,
      reason: 'too-many-colons',
    })
  })
})

describe('validateMasterSourceAddress - http-list', () => {
  it('accepts an absolute http/https URL, query string included, stored whole', () => {
    expect(validateMasterSourceAddress('http-list', 'https://q2servers.com/?raw=1')).toEqual({
      ok: true,
      normalized: 'https://q2servers.com/?raw=1',
    })
    expect(validateMasterSourceAddress('http-list', 'http://example.com/list')).toEqual({
      ok: true,
      normalized: 'http://example.com/list',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(validateMasterSourceAddress('http-list', '  https://q2servers.com/?raw=1  ')).toEqual({
      ok: true,
      normalized: 'https://q2servers.com/?raw=1',
    })
  })

  it('rejects an empty address', () => {
    expect(validateMasterSourceAddress('http-list', '   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects a relative or unparsable URL', () => {
    expect(validateMasterSourceAddress('http-list', '/relative/path')).toEqual({
      ok: false,
      reason: 'invalid-url',
    })
    expect(validateMasterSourceAddress('http-list', 'not a url')).toEqual({
      ok: false,
      reason: 'invalid-url',
    })
  })

  it('rejects a non-http(s) protocol', () => {
    expect(validateMasterSourceAddress('http-list', 'ftp://example.com/list')).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    })
    expect(validateMasterSourceAddress('http-list', 'file:///etc/passwd')).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    })
  })

  it('rejects embedded credentials', () => {
    expect(validateMasterSourceAddress('http-list', 'https://user:pass@example.com/list')).toEqual({
      ok: false,
      reason: 'credentials-not-allowed',
    })
  })

  it('rejects a control character', () => {
    expect(validateMasterSourceAddress('http-list', 'https://example.com/list')).toEqual({
      ok: false,
      reason: 'forbidden-character',
    })
  })

  it('rejects an over-length URL', () => {
    const long = `https://example.com/?q=${'a'.repeat(HTTP_LIST_MAX_LENGTH)}`
    expect(validateMasterSourceAddress('http-list', long)).toEqual({
      ok: false,
      reason: 'url-too-long',
    })
  })
})

describe('masterSourceAddressRejectionKey', () => {
  it('maps every reason to servers.sources.reject.<reason>', () => {
    const reasons: MasterSourceAddressRejection[] = [
      'empty',
      'forbidden-character',
      'url-too-long',
      'invalid-url',
      'unsupported-protocol',
      'credentials-not-allowed',
      'missing-port',
      'port-not-numeric',
    ]
    for (const reason of reasons) {
      expect(masterSourceAddressRejectionKey(reason)).toBe(`servers.sources.reject.${reason}`)
    }
  })
})
