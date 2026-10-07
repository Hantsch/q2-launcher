import { describe, expect, it } from 'vitest'

import type { DemoHeaderResult } from './demo-header'
import { parseDemoHeader } from './demo-header'
import { buildDm2 } from './dm2-writer'
import { buildMvd2 } from './mvd2-writer'
import { DEMO_UNREADABLE_REASONS, demoReadability } from './readability'

describe('demoReadability', () => {
  it.each(DEMO_UNREADABLE_REASONS)(
    'every unparsable reason becomes readable false with its code: %s',
    (reason) => {
      const result = { ok: false, reason } as unknown as DemoHeaderResult
      const projected = demoReadability(result)

      expect(projected.readable).toBe(false)
      expect(projected.unreadable).not.toBeNull()
      expect(projected.unreadable?.reason).toBe(reason)
      expect(projected.unreadable).not.toHaveProperty('protocol')
      expect(projected.unreadable).not.toHaveProperty('version')
    },
  )

  it('carries protocol through when present on the result', () => {
    const result = {
      ok: false,
      reason: 'unknown-protocol',
      protocol: 36,
    } as unknown as DemoHeaderResult
    const projected = demoReadability(result)

    expect(projected.readable).toBe(false)
    expect(projected.unreadable).toEqual({ reason: 'unknown-protocol', protocol: 36 })
    expect(projected.unreadable).not.toHaveProperty('version')
  })

  it('carries version through when present on the result', () => {
    const result = {
      ok: false,
      reason: 'unknown-version',
      version: 2008,
    } as unknown as DemoHeaderResult
    const projected = demoReadability(result)

    expect(projected.readable).toBe(false)
    expect(projected.unreadable).toEqual({ reason: 'unknown-version', version: 2008 })
    expect(projected.unreadable).not.toHaveProperty('protocol')
  })

  it('a parsed header is readable with no reason', () => {
    const dm2 = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings: { 33: 'maps/q2dm1.bsp' },
      terminate: true,
    })
    const mvd2 = buildMvd2({
      version: 2013,
      gameDir: 'baseq2',
      clientNum: 0,
      configstrings: {},
      terminate: true,
    })

    expect(demoReadability(parseDemoHeader(dm2))).toEqual({ readable: true, unreadable: null })
    expect(demoReadability(parseDemoHeader(mvd2))).toEqual({ readable: true, unreadable: null })
  })

  it("the real parsers' failures project to their reason", () => {
    const empty = demoReadability(parseDemoHeader(new Uint8Array(0)))
    expect(empty).toEqual({ readable: false, unreadable: { reason: 'empty' } })

    // A well-formed block (length header in bounds) whose first message's opcode isn't
    // svc_serverdata (12): the parser recognizes the shape but rejects the content.
    const notADemoBytes = new Uint8Array(64)
    notADemoBytes[0] = 50 // int32 LE block length = 50, fits in the remaining 60 bytes
    notADemoBytes[4] = 99 // opcode, not svc_serverdata
    for (let i = 5; i < notADemoBytes.length; i++) notADemoBytes[i] = (i * 37 + 11) & 0xff
    const notADemo = demoReadability(parseDemoHeader(notADemoBytes))
    expect(notADemo).toEqual({ readable: false, unreadable: { reason: 'not-a-demo' } })

    // buildDm2 only accepts the protocols its own type allows; mutate the bytes afterward to an
    // invalid one. Layout: [int32 block length][byte opcode][int32 protocol]... — protocol lives
    // at absolute offset 5..8.
    const dm2Bytes = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings: {},
      terminate: true,
    })
    dm2Bytes[5] = 35
    dm2Bytes[6] = 0
    dm2Bytes[7] = 0
    dm2Bytes[8] = 0
    const unknownProtocol = demoReadability(parseDemoHeader(dm2Bytes))
    expect(unknownProtocol).toEqual({
      readable: false,
      unreadable: { reason: 'unknown-protocol', protocol: 35 },
    })

    // Layout: "MVD2"(4) + [uint16 block length](2) + [byte cmd](1) + [int32 protocol](4) +
    // [uint16 version] — version lives at absolute offset 11..12.
    const mvd2Bytes = buildMvd2({
      version: 2013,
      gameDir: 'baseq2',
      clientNum: 0,
      configstrings: {},
      terminate: true,
    })
    mvd2Bytes[11] = 2008 & 0xff
    mvd2Bytes[12] = (2008 >> 8) & 0xff
    const unknownVersion = demoReadability(parseDemoHeader(mvd2Bytes))
    expect(unknownVersion).toEqual({
      readable: false,
      unreadable: { reason: 'unknown-version', version: 2008 },
    })
  })
})
