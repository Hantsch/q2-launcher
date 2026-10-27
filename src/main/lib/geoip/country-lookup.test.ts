import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findRepoRoot } from '../resource-path'
import { createCountryLookup } from './country-lookup'

const REAL_DB = join(findRepoRoot(__dirname), 'resources', 'geoip', 'dbip-country-lite.mmdb')
const MISSING_DB = join(__dirname, 'does-not-exist.mmdb')

const NETWORK_USE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"`](?:node:)?(?:net|http|https|http2|tls|dns|dgram)(?:\/promises)?['"`]|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/

describe('country lookup', () => {
  it('resolves 8.8.8.8 to a country in North America', () => {
    expect(createCountryLookup(REAL_DB).locate('8.8.8.8')).toEqual({
      kind: 'country',
      country: 'US',
      continent: 'NA',
    })
  })

  it('treats a private address as LAN without opening the database', () => {
    expect(createCountryLookup(MISSING_DB).locate('192.168.1.5')).toEqual({ kind: 'lan' })
  })

  it('treats an address the database does not know as Unknown', () => {
    const lookup = createCountryLookup(REAL_DB)
    expect(lookup.locate('192.0.2.1')).toEqual({ kind: 'unknown' })
    expect(lookup.locate('not an ip')).toEqual({ kind: 'unknown' })
    expect(lookup.locate('2001:4860:4860::8888')).toEqual({ kind: 'unknown' })
  })

  it('makes every public address Unknown when the database file is missing, logging once', () => {
    const warnings: unknown[][] = []
    const lookup = createCountryLookup(MISSING_DB, {
      warn: (...args: unknown[]) => void warnings.push(args),
    })
    expect(lookup.locate('8.8.8.8')).toEqual({ kind: 'unknown' })
    expect(lookup.locate('1.1.1.1')).toEqual({ kind: 'unknown' })
    expect(warnings).toHaveLength(1)
  })

  it('an address the database places in Antarctica is Unknown', () => {
    expect(createCountryLookup(REAL_DB).locate('31.6.16.1')).toEqual({ kind: 'unknown' })
  })

  it('imports no network module', () => {
    const source = readFileSync(join(__dirname, 'country-lookup.ts'), 'utf8')
    expect(NETWORK_USE.exec(source)).toBeNull()
  })

  it('the network-use matcher flags every import form', () => {
    const violations = [
      `import x from "net"`,
      `import { y } from 'node:http'`,
      'import z from `https`',
      `require('node:dgram')`,
      `require("tls")`,
      `await import('node:dns')`,
      `import('dns/promises')`,
      `import http2 from 'node:http2'`,
      `const r = await fetch(url)`,
      `new XMLHttpRequest()`,
      `new WebSocket(url)`,
    ]
    for (const snippet of violations) expect(NETWORK_USE.test(snippet), snippet).toBe(true)
    expect(NETWORK_USE.test(`import { readFileSync } from 'node:fs'`)).toBe(false)
    expect(NETWORK_USE.test(`import { Reader } from 'mmdb-lib'`)).toBe(false)
  })
})
