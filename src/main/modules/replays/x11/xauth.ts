/**
 * `.Xauthority` reader (story 198). Pure: the caller reads the file. The format is libXau's: a
 * sequence of records, each a big-endian CARD16 family followed by four big-endian CARD16
 * length-prefixed byte strings (address, display number, auth name, auth data), with no padding.
 */

export const XAUTH_FAMILY_LOCAL = 256
export const XAUTH_FAMILY_WILD = 65535
export const MIT_MAGIC_COOKIE = 'MIT-MAGIC-COOKIE-1'

export interface XauthEntry {
  family: number
  /** For FamilyLocal the host name; for network families the raw address bytes. */
  address: Buffer
  /** The display number as decimal text; empty matches every display. */
  number: string
  name: string
  data: Buffer
}

/**
 * Every complete record in `buf`. A record cut short ends the read and is dropped, the entries
 * before it are kept - libXau stops at the first short read the same way. Never throws.
 */
export function parseXauthority(buf: Buffer): XauthEntry[] {
  const entries: XauthEntry[] = []
  let at = 0
  const field = (): Buffer | null => {
    if (at + 2 > buf.length) return null
    const size = buf.readUInt16BE(at)
    if (at + 2 + size > buf.length) return null
    const bytes = buf.subarray(at + 2, at + 2 + size)
    at += 2 + size
    return bytes
  }
  while (at + 2 <= buf.length) {
    const family = buf.readUInt16BE(at)
    at += 2
    const address = field()
    const number = field()
    const name = field()
    const data = field()
    if (!address || !number || !name || !data) break
    entries.push({
      family,
      address: Buffer.from(address),
      number: number.toString('latin1'),
      name: name.toString('latin1'),
      data: Buffer.from(data),
    })
  }
  return entries
}

/**
 * The MIT-MAGIC-COOKIE-1 data for a local display, or null. The first entry in file order wins
 * (libXau's choice): FamilyLocal whose address is this host name, or FamilyWild for any host, and
 * whose display number is `display` or empty.
 */
export function pickCookie(
  entries: readonly XauthEntry[],
  target: { hostname: string; display: number },
): Buffer | null {
  const host = Buffer.from(target.hostname)
  const display = String(target.display)
  const match = entries.find(
    (e) =>
      e.name === MIT_MAGIC_COOKIE &&
      (e.family === XAUTH_FAMILY_WILD ||
        (e.family === XAUTH_FAMILY_LOCAL && e.address.equals(host))) &&
      (e.number === '' || e.number === display),
  )
  return match ? match.data : null
}
