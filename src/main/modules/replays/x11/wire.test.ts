import { describe, expect, it } from 'vitest'
import {
  decodeGetPropertyReply,
  decodeInternAtomReply,
  decodeQueryClientIdsReply,
  decodeQueryExtensionReply,
  decodeSetupReply,
  encodeChangeProperty,
  encodeConfigureWindow,
  encodeGetProperty,
  encodeInternAtom,
  encodeQueryClientIds,
  encodeQueryExtension,
  encodeSendClientMessage,
  encodeSetupRequest,
  readPacket,
} from './wire'

/**
 * Every fixture below is written by hand from the X11 protocol encoding (Appendix B) and the
 * X-Resource 1.2 spec, little-endian - never produced by the encoder under test.
 */
function hex(...parts: string[]): Buffer {
  const digits = parts.join('').replace(/\s+/g, '')
  if (!/^([0-9a-f]{2})*$/i.test(digits)) throw new Error(`bad hex fixture: ${digits}`)
  return Buffer.from(digits, 'hex')
}
const zeros = (n: number): string => '00'.repeat(n)

const WINDOW = 0x01200005

describe('X11 connection setup encoding', () => {
  it('sends byte order l, protocol 11.0 and the padded auth name and data', () => {
    const cookie = hex('00112233 44556677 8899aabb ccddeeff')
    expect(encodeSetupRequest('MIT-MAGIC-COOKIE-1', cookie)).toEqual(
      hex(
        '6c 00', // byte order 'l', unused
        '0b 00', // protocol-major-version 11
        '00 00', // protocol-minor-version 0
        '12 00', // auth name length 18
        '10 00', // auth data length 16
        '00 00', // unused
        '4d 49 54 2d 4d 41 47 49 43 2d 43 4f 4f 4b 49 45 2d 31', // MIT-MAGIC-COOKIE-1
        '00 00', // pad(18)
        '00112233 44556677 8899aabb ccddeeff', // data, pad(16) = 0
      ),
    )
  })

  it('sends a bare 12-byte header when there is no authorization', () => {
    expect(encodeSetupRequest('', Buffer.alloc(0))).toEqual(
      hex('6c 00 0b 00 00 00 00 00 00 00 00 00'),
    )
  })
})

// Success: vendor "X.Org" (5 + 3 pad), two pixmap formats, two screens - the first with a depth of
// one visual plus an empty depth, the second with no depths. Additional length 44 units = 176 bytes.
const SETUP_SUCCESS = hex(
  '01 00 0b 00 00 00 2c 00', // Success, unused, 11.0, additional length 44
  '40 e2 01 00', // release-number
  '00 00 20 01', // resource-id-base 0x01200000
  'ff ff 1f 00', // resource-id-mask 0x001fffff
  '00 01 00 00', // motion-buffer-size
  '05 00', // vendor length 5
  'ff ff', // maximum-request-length
  '02 02', // 2 screens, 2 formats
  '00 00 20 20 08 ff', // byte orders, scanline unit/pad, min/max keycode
  '00 00 00 00', // unused
  '58 2e 4f 72 67 00 00 00', // "X.Org" + pad 3
  '01 01 20 00 00 00 00 00', // FORMAT depth 1 bpp 1 pad 32
  '18 20 20 00 00 00 00 00', // FORMAT depth 24 bpp 32 pad 32
  // SCREEN 0
  '39 05 00 00', // root 0x539
  '20 00 00 00 ff ff ff 00 00 00 00 00 00 00 00 00', // colormap, white, black, input masks
  '80 07 38 04 08 02 25 01 01 00 01 00', // 1920x1080, mm, min/max maps
  '21 00 00 00', // root-visual
  '00 00 18 02', // backing-stores, save-unders, root-depth 24, 2 depths
  '18 00 01 00 00 00 00 00', // DEPTH 24, 1 visual
  '21 00 00 00 04 08 00 01 00 00 ff 00 00 ff 00 00 ff 00 00 00 00 00 00 00', // VISUALTYPE
  '01 00 00 00 00 00 00 00', // DEPTH 1, 0 visuals
  // SCREEN 1
  '3a 05 00 00', // root 0x53a
  '20 00 00 00 ff ff ff 00 00 00 00 00 00 00 00 00',
  '80 07 38 04 08 02 25 01 01 00 01 00',
  '21 00 00 00',
  '00 00 18 00', // 0 depths
)

describe('X11 setup reply decoding', () => {
  it('skips the vendor, formats and depth lists to reach every root window', () => {
    expect(SETUP_SUCCESS.length).toBe(184)
    expect(decodeSetupReply(SETUP_SUCCESS)).toEqual({
      ok: true,
      value: {
        status: 'success',
        resourceIdBase: 0x01200000,
        resourceIdMask: 0x001fffff,
        roots: [{ root: 0x539 }, { root: 0x53a }],
        byteLength: 184,
      },
    })
  })

  it('reports where the setup reply ends when the first packet follows in the same chunk', () => {
    const chunk = Buffer.concat([SETUP_SUCCESS, hex(zeros(32))])
    const decoded = decodeSetupReply(chunk)
    expect(decoded.ok && decoded.value.byteLength).toBe(184)
  })

  it('yields the reason of a Failed reply', () => {
    // Failed, reason length 7, 11.0, additional length 2 units: "No auth" + pad 1
    const buf = hex('00 07 0b 00 00 00 02 00', '4e 6f 20 61 75 74 68 00')
    expect(decodeSetupReply(buf)).toEqual({
      ok: true,
      value: { status: 'failed', reason: 'No auth', byteLength: 16 },
    })
  })

  it('yields the reason of an Authenticate reply without its padding', () => {
    // Authenticate, 5 unused, additional length 2 units: "Again" + pad 3
    const buf = hex('02 00 00 00 00 00 02 00', '41 67 61 69 6e 00 00 00')
    expect(decodeSetupReply(buf)).toEqual({
      ok: true,
      value: { status: 'authenticate', reason: 'Again', byteLength: 16 },
    })
  })

  it('asks for more bytes when the reply is cut short', () => {
    expect(decodeSetupReply(SETUP_SUCCESS.subarray(0, 100))).toEqual({
      ok: false,
      error: 'truncated',
    })
    expect(decodeSetupReply(SETUP_SUCCESS.subarray(0, 5))).toEqual({
      ok: false,
      error: 'truncated',
    })
  })

  it('rejects an unknown status or screens that overrun the declared length', () => {
    const badStatus = Buffer.from(SETUP_SUCCESS)
    badStatus[0] = 7
    expect(decodeSetupReply(badStatus)).toEqual({ ok: false, error: 'garbled' })
    const tooManyScreens = Buffer.from(SETUP_SUCCESS)
    tooManyScreens[28] = 3
    expect(decodeSetupReply(tooManyScreens)).toEqual({ ok: false, error: 'garbled' })
    const failedReasonOverrun = hex('00 09 0b 00 00 00 01 00', '4e 6f 20 61')
    expect(decodeSetupReply(failedReasonOverrun)).toEqual({ ok: false, error: 'garbled' })
  })
})

describe('X11 request encoding', () => {
  it('ChangeProperty and ConfigureWindow match the spec bytes', () => {
    expect(
      encodeChangeProperty({ window: WINDOW, property: 0x14e, type: 4, values: [0x150, 0x151] }),
    ).toEqual(
      hex(
        '12 00 08 00', // opcode 18, mode Replace, length 6 + 2
        '05 00 20 01', // window
        '4e 01 00 00', // property
        '04 00 00 00', // type ATOM
        '20 00 00 00', // format 32, 3 unused
        '02 00 00 00', // length of data in format units
        '50 01 00 00 51 01 00 00', // data
      ),
    )
    expect(
      encodeConfigureWindow({ window: WINDOW, x: 100, y: -50, width: 1920, height: 1080 }),
    ).toEqual(
      hex(
        '0c 00 07 00', // opcode 12, unused, length 3 + 4
        '05 00 20 01', // window
        '0f 00 00 00', // value-mask x|y|width|height, 2 unused
        '64 00 00 00', // x 100
        'ce ff ff ff', // y -50, sign-extended
        '80 07 00 00', // width 1920
        '38 04 00 00', // height 1080
      ),
    )
  })

  it('InternAtom pads the name to 4 bytes and counts the length in 4-byte units', () => {
    expect(encodeInternAtom('_NET_WM_STATE')).toEqual(
      hex(
        '10 00 06 00', // opcode 16, only-if-exists false, length 2 + 4
        '0d 00 00 00', // name length 13, unused
        '5f 4e 45 54 5f 57 4d 5f 53 54 41 54 45 00 00 00', // _NET_WM_STATE + pad 3
      ),
    )
  })

  it.each([
    ['', '10 00 02 00 00 00 00 00'],
    ['A', '10 00 03 00 01 00 00 00 41 00 00 00'],
    ['AB', '10 00 03 00 02 00 00 00 41 42 00 00'],
    ['ABC', '10 00 03 00 03 00 00 00 41 42 43 00'],
    ['ABCD', '10 00 03 00 04 00 00 00 41 42 43 44'],
    ['ABCDE', '10 00 04 00 05 00 00 00 41 42 43 44 45 00 00 00'],
  ])('pads a %j name to the next 4-byte boundary', (name, bytes) => {
    expect(encodeInternAtom(name)).toEqual(hex(bytes))
  })

  it('GetProperty asks for the given window, property, type and range without deleting', () => {
    expect(encodeGetProperty({ window: WINDOW, property: 0x14e, type: 6, longLength: 1 })).toEqual(
      hex(
        '14 00 06 00', // opcode 20, delete false, length 6
        '05 00 20 01', // window
        '4e 01 00 00', // property
        '06 00 00 00', // type CARDINAL
        '00 00 00 00', // long-offset
        '01 00 00 00', // long-length
      ),
    )
  })

  it('SendEvent carries a 32-byte format-32 ClientMessage with zero-filled data', () => {
    expect(
      encodeSendClientMessage({
        destination: 0x539,
        eventMask: 0x00180000,
        window: WINDOW,
        messageType: 0x14e,
        data: [1, 0x150, 0, 1],
      }),
    ).toEqual(
      hex(
        '19 00 0b 00', // opcode 25, propagate false, length 11
        '39 05 00 00', // destination (root)
        '00 00 18 00', // SubstructureNotify | SubstructureRedirect
        '21 20 00 00', // ClientMessage, format 32, sequence 0
        '05 00 20 01', // window
        '4e 01 00 00', // message type
        '01 00 00 00 50 01 00 00 00 00 00 00 01 00 00 00 00 00 00 00', // data[5]
      ),
    )
  })

  it('SendEvent refuses more than five data items', () => {
    expect(() =>
      encodeSendClientMessage({
        destination: 1,
        eventMask: 0,
        window: 2,
        messageType: 3,
        data: [1, 2, 3, 4, 5, 6],
      }),
    ).toThrow(RangeError)
  })

  it('QueryExtension pads the extension name', () => {
    expect(encodeQueryExtension('X-Resource')).toEqual(
      hex(
        '62 00 05 00', // opcode 98, unused, length 2 + 3
        '0a 00 00 00', // name length 10, unused
        '58 2d 52 65 73 6f 75 72 63 65 00 00', // X-Resource + pad 2
      ),
    )
  })

  it('X-Resource QueryClientIds asks for the local client PID of one window', () => {
    expect(encodeQueryClientIds(0x93, WINDOW)).toEqual(
      hex(
        '93 04 04 00', // major opcode, minor 4, length 2 + 2*1
        '01 00 00 00', // num-specs
        '05 00 20 01', // spec.client
        '02 00 00 00', // spec.mask LocalClientPID
      ),
    )
  })
})

describe('X11 packet framing', () => {
  it('frames a reply as 32 bytes plus its length in 4-byte units', () => {
    const reply = hex('01 20 08 00 01 00 00 00', zeros(24), '34 12 00 00')
    expect(readPacket(reply)).toEqual({
      ok: true,
      value: { kind: 'reply', sequence: 8, length: 36 },
    })
  })

  it('decodes an error packet', () => {
    // Error, BadWindow (3), sequence 12, bad value, minor 0, major 12 (ConfigureWindow), 21 unused
    const error = hex('00 03 0c 00', '05 00 20 01', '00 00', '0c', zeros(21))
    expect(readPacket(error)).toEqual({
      ok: true,
      value: {
        kind: 'error',
        sequence: 12,
        length: 32,
        code: 3,
        badValue: WINDOW,
        minorOpcode: 0,
        majorOpcode: 12,
      },
    })
  })

  it('frames a core event as 32 bytes and strips the sent-event bit', () => {
    const propertyNotify = hex('1c 00 0d 00', zeros(28))
    expect(readPacket(propertyNotify)).toEqual({
      ok: true,
      value: { kind: 'event', sequence: 13, length: 32, code: 28 },
    })
    const sentClientMessage = hex('a1 20 0e 00', zeros(28))
    expect(readPacket(sentClientMessage)).toEqual({
      ok: true,
      value: { kind: 'event', sequence: 14, length: 32, code: 33 },
    })
  })

  it('frames a GenericEvent with its extra length', () => {
    const generic = hex('23 00 0f 00 02 00 00 00', zeros(24), zeros(8))
    expect(readPacket(generic)).toEqual({
      ok: true,
      value: { kind: 'event', sequence: 15, length: 40, code: 35 },
    })
  })

  it('asks for more bytes when the header or the reply body is incomplete', () => {
    expect(readPacket(hex('01 00 08 00'))).toEqual({ ok: false, error: 'truncated' })
    expect(readPacket(hex('01 20 08 00 01 00 00 00', zeros(24)))).toEqual({
      ok: false,
      error: 'truncated',
    })
  })

  it('rejects a packet type that does not exist or an absurd reply length', () => {
    expect(readPacket(hex('81', zeros(31)))).toEqual({ ok: false, error: 'garbled' })
    expect(readPacket(hex('01 00 08 00 ff ff ff ff', zeros(24)))).toEqual({
      ok: false,
      error: 'garbled',
    })
  })
})

describe('X11 reply decoding', () => {
  it('reads the atom of an InternAtom reply', () => {
    const reply = hex('01 00 07 00 00 00 00 00', '4e 01 00 00', zeros(20))
    expect(decodeInternAtomReply(reply)).toEqual({ ok: true, value: 0x14e })
  })

  it('reads a format-32 property value as CARD32s', () => {
    const reply = hex(
      '01 20 08 00', // Reply, format 32, sequence 8
      '02 00 00 00', // reply length 2 units
      '06 00 00 00', // type CARDINAL
      '00 00 00 00', // bytes-after
      '02 00 00 00', // value length in format units
      zeros(12),
      '34 12 00 00 ff ff ff ff', // 0x1234, 0xffffffff
    )
    expect(decodeGetPropertyReply(reply)).toEqual({
      ok: true,
      value: { type: 6, format: 32, bytesAfter: 0, values: [0x1234, 0xffffffff] },
    })
  })

  it('reads a missing property as type None with no values', () => {
    const reply = hex('01 00 09 00', zeros(28))
    expect(decodeGetPropertyReply(reply)).toEqual({
      ok: true,
      value: { type: 0, format: 0, bytesAfter: 0, values: [] },
    })
  })

  it('rejects a property whose item count overruns the reply', () => {
    const reply = hex(
      '01 20 08 00 01 00 00 00 06 00 00 00 00 00 00 00 03 00 00 00',
      zeros(12),
      '34 12 00 00',
    )
    expect(decodeGetPropertyReply(reply)).toEqual({ ok: false, error: 'garbled' })
  })

  it('reads whether an extension is present and its major opcode', () => {
    const present = hex('01 00 0a 00 00 00 00 00', '01 93 00 00', zeros(20))
    expect(decodeQueryExtensionReply(present)).toEqual({
      ok: true,
      value: { present: true, majorOpcode: 0x93 },
    })
    const absent = hex('01 00 0a 00', zeros(28))
    expect(decodeQueryExtensionReply(absent)).toEqual({
      ok: true,
      value: { present: false, majorOpcode: 0 },
    })
  })

  it('reads the PID from a QueryClientIds reply, skipping a non-PID value', () => {
    const reply = hex(
      '01 00 0b 00', // Reply, sequence 11
      '08 00 00 00', // reply length 8 units
      '02 00 00 00', // num-ids
      zeros(20),
      '05 00 20 01 01 00 00 00 04 00 00 00 00 00 20 01', // spec {window, ClientXID}, 4 bytes, XID
      '05 00 20 01 02 00 00 00 04 00 00 00 92 10 00 00', // spec {window, LocalClientPID}, 4 bytes, 4242
    )
    expect(decodeQueryClientIdsReply(reply)).toEqual({ ok: true, value: 4242 })
  })

  it('reads no PID from an empty QueryClientIds reply', () => {
    expect(decodeQueryClientIdsReply(hex('01 00 0b 00', zeros(28)))).toEqual({
      ok: true,
      value: null,
    })
  })

  it('rejects a client-id value that overruns the reply', () => {
    const reply = hex(
      '01 00 0b 00 04 00 00 00 01 00 00 00',
      zeros(20),
      '05 00 20 01 02 00 00 00 08 00 00 00 92 10 00 00',
    )
    expect(decodeQueryClientIdsReply(reply)).toEqual({ ok: false, error: 'garbled' })
  })

  it('treats an error or a cut-short packet as a failed reply, never a throw', () => {
    const error = hex('00 03 0c 00', zeros(28))
    expect(decodeInternAtomReply(error)).toEqual({ ok: false, error: 'garbled' })
    expect(decodeGetPropertyReply(hex('01 20 08 00 01 00'))).toEqual({
      ok: false,
      error: 'truncated',
    })
    expect(decodeQueryClientIdsReply(hex('01 00 0b 00 04 00 00 00', zeros(24)))).toEqual({
      ok: false,
      error: 'truncated',
    })
  })
})
