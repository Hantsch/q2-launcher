import { describe, expect, it } from 'vitest'
import { countryName, isPrivateIPv4 } from './location'

describe('isPrivateIPv4', () => {
  it('covers loopback, RFC 1918, link-local and CGNAT', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.20',
      '169.254.10.10',
      '100.64.0.1',
      '100.127.255.255',
    ]) {
      expect(isPrivateIPv4(ip), ip).toBe(true)
    }
  })

  it('treats the neighbours of the private ranges as public', () => {
    for (const ip of [
      '172.15.0.1',
      '172.32.0.1',
      '100.63.0.1',
      '100.128.0.1',
      '192.169.0.1',
      '8.8.8.8',
    ]) {
      expect(isPrivateIPv4(ip), ip).toBe(false)
    }
  })

  it('is false for anything that is not an IPv4 address', () => {
    for (const ip of ['', 'localhost', '::1', '10.0.0', '10.0.0.256', '10.0.0.1:27910']) {
      expect(isPrivateIPv4(ip), ip).toBe(false)
    }
  })
})

describe('countryName', () => {
  it('returns the English name and falls back to the code', () => {
    expect(countryName('DE', 'en')).toBe('Germany')
    expect(countryName('not a code', 'en')).toBe('not a code')
  })
})
