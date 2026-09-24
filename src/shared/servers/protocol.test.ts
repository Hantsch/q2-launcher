import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  buildInfoQuery,
  buildStatusQuery,
  decodeLatin1,
  encodeLatin1,
  OOB_PREFIX,
  readConnectionlessReply,
} from './protocol'

describe('buildStatusQuery / buildInfoQuery', () => {
  it('builds both query datagrams with the connectionless prefix', () => {
    const status = buildStatusQuery()
    expect(Array.from(status.subarray(0, 4))).toEqual([0xff, 0xff, 0xff, 0xff])
    expect(status[status.length - 1]).toBe(0x0a)
    expect(decodeLatin1(status)).toContain('status')

    const info = buildInfoQuery(34)
    expect(Array.from(info.subarray(0, 4))).toEqual([0xff, 0xff, 0xff, 0xff])
    expect(info[info.length - 1]).toBe(0x0a)
    expect(decodeLatin1(info)).toContain('info 34')
  })

  it('throws RangeError for an out-of-range or non-integer protocol', () => {
    expect(() => buildInfoQuery(0)).toThrow(RangeError)
    expect(() => buildInfoQuery(256)).toThrow(RangeError)
    expect(() => buildInfoQuery(34.5)).toThrow(RangeError)

    expect(() => buildInfoQuery(1)).not.toThrow()
    expect(() => buildInfoQuery(34)).not.toThrow()
    expect(() => buildInfoQuery(255)).not.toThrow()
  })
})

describe('decodeLatin1 / encodeLatin1', () => {
  it('round-trips all 256 byte values exactly', () => {
    const original = new Uint8Array(256)
    for (let i = 0; i < 256; i++) original[i] = i

    const decoded = decodeLatin1(original)
    const reEncoded = encodeLatin1(decoded)

    expect(reEncoded).toEqual(original)
  })
})

describe('readConnectionlessReply', () => {
  it('a broken envelope is rejected with its own reason', () => {
    expect(readConnectionlessReply(new Uint8Array(0), 'info')).toEqual({ ok: false, reason: 'too-short' })
    expect(readConnectionlessReply(new Uint8Array([0xff]), 'info')).toEqual({ ok: false, reason: 'too-short' })

    const wrongPrefix = new Uint8Array([0x00, 0x00, 0x00, 0x00, ...encodeLatin1('info\n')])
    expect(readConnectionlessReply(wrongPrefix, 'info')).toEqual({ ok: false, reason: 'not-connectionless' })

    const printReply = new Uint8Array([...OOB_PREFIX, ...encodeLatin1('print\nsome serverinfo\n')])
    expect(readConnectionlessReply(printReply, 'info')).toEqual({ ok: false, reason: 'unexpected-command' })

    const infoReply = new Uint8Array([...OOB_PREFIX, ...encodeLatin1('info\n\\hostname\\my server\n')])
    expect(readConnectionlessReply(infoReply, 'info')).toEqual({
      ok: true,
      body: '\\hostname\\my server\n',
    })
  })
})

describe('purity', () => {
  it('no codec in the servers folder imports node, electron or the IPC layer', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const files = readdirSync(here).filter((name: string) => name.endsWith('.ts') && !name.endsWith('.test.ts'))

    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const source = readFileSync(join(here, file), 'utf-8')
      expect(source, `${file} imports node:*`).not.toMatch(/from\s+['"]node:/)
      expect(source, `${file} imports electron`).not.toMatch(/from\s+['"]electron['"]/)
      expect(source, `${file} imports the IPC layer`).not.toMatch(/from\s+['"][^'"]*\/ipc[^'"]*['"]/)
    }
  })
})
