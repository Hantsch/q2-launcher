import { describe, expect, it } from 'vitest'
import { parseXauthority, pickCookie } from './xauth'

/** Fixtures are hand-written libXau records: big-endian CARD16 family, then four CARD16-prefixed fields. */
function hex(...parts: string[]): Buffer {
  const digits = parts.join('').replace(/\s+/g, '')
  if (!/^([0-9a-f]{2})*$/i.test(digits)) throw new Error(`bad hex fixture: ${digits}`)
  return Buffer.from(digits, 'hex')
}

const MIT_NAME = '00 12 4d 49 54 2d 4d 41 47 49 43 2d 43 4f 4f 4b 49 45 2d 31' // MIT-MAGIC-COOKIE-1
const COOKIE_LOCAL = '00112233445566778899aabbccddeeff'
const COOKIE_WILD = 'ffeeddccbbaa99887766554433221100'

const LOCAL_BOX_0 = hex(
  '01 00', // FamilyLocal
  '00 03 62 6f 78', // address "box"
  '00 01 30', // display "0"
  MIT_NAME,
  '00 10',
  COOKIE_LOCAL,
)
const WILD_1 = hex(
  'ff ff', // FamilyWild
  '00 00', // empty address
  '00 01 31', // display "1"
  MIT_NAME,
  '00 10',
  COOKIE_WILD,
)
const LOCAL_BOX_2_XDM = hex(
  '01 00',
  '00 03 62 6f 78',
  '00 01 32', // display "2"
  '00 13 58 44 4d 2d 41 55 54 48 4f 52 49 5a 41 54 49 4f 4e 2d 31', // XDM-AUTHORIZATION-1
  '00 08 0102030405060708',
)
const FILE = Buffer.concat([LOCAL_BOX_0, WILD_1, LOCAL_BOX_2_XDM])

describe('reading an Xauthority file', () => {
  it('reads every record with its family, address, display number, name and data', () => {
    const entries = parseXauthority(FILE)
    expect(entries).toEqual([
      {
        family: 256,
        address: hex('62 6f 78'),
        number: '0',
        name: 'MIT-MAGIC-COOKIE-1',
        data: hex(COOKIE_LOCAL),
      },
      {
        family: 65535,
        address: Buffer.alloc(0),
        number: '1',
        name: 'MIT-MAGIC-COOKIE-1',
        data: hex(COOKIE_WILD),
      },
      {
        family: 256,
        address: hex('62 6f 78'),
        number: '2',
        name: 'XDM-AUTHORIZATION-1',
        data: hex('0102030405060708'),
      },
    ])
  })

  it('keeps the complete records before a record that is cut short, never throwing', () => {
    expect(parseXauthority(FILE.subarray(0, FILE.length - 3))).toHaveLength(2)
    expect(parseXauthority(Buffer.concat([LOCAL_BOX_0, hex('01')]))).toHaveLength(1)
    expect(parseXauthority(hex('01 00 ff ff 00'))).toEqual([])
    expect(parseXauthority(Buffer.alloc(0))).toEqual([])
  })
})

describe('picking the MIT cookie for a local display', () => {
  const entries = parseXauthority(FILE)

  it('matches a FamilyLocal record by host name and display number', () => {
    expect(pickCookie(entries, { hostname: 'box', display: 0 })).toEqual(hex(COOKIE_LOCAL))
  })

  it('matches a FamilyWild record from any host', () => {
    expect(pickCookie(entries, { hostname: 'elsewhere', display: 1 })).toEqual(hex(COOKIE_WILD))
  })

  it('finds nothing for another host, another display or a non-MIT record', () => {
    expect(pickCookie(entries, { hostname: 'elsewhere', display: 0 })).toBeNull()
    expect(pickCookie(entries, { hostname: 'box', display: 3 })).toBeNull()
    expect(pickCookie(entries, { hostname: 'box', display: 2 })).toBeNull()
  })

  it('treats an empty display number as matching every display', () => {
    const anyDisplay = parseXauthority(
      hex('01 00', '00 03 62 6f 78', '00 00', MIT_NAME, '00 10', COOKIE_LOCAL),
    )
    expect(pickCookie(anyDisplay, { hostname: 'box', display: 7 })).toEqual(hex(COOKIE_LOCAL))
  })

  it('takes the first matching record in file order', () => {
    const wildFirst = parseXauthority(
      Buffer.concat([hex('ff ff 00 00 00 01 30', MIT_NAME, '00 10', COOKIE_WILD), LOCAL_BOX_0]),
    )
    expect(pickCookie(wildFirst, { hostname: 'box', display: 0 })).toEqual(hex(COOKIE_WILD))
  })
})
