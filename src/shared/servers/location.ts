export const CONTINENTS = ['AF', 'AS', 'EU', 'NA', 'OC', 'SA'] as const

export type Continent = (typeof CONTINENTS)[number]

/** Country level only - no city or coordinates. `country` is ISO 3166-1 alpha-2, upper case. */
export type ServerLocation =
  { kind: 'lan' } | { kind: 'unknown' } | { kind: 'country'; country: string; continent: Continent }

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** The four octets of a dotted-quad IPv4 address, or `null` for anything else. */
function parseIPv4(ip: string): [number, number, number, number] | null {
  const match = IPV4.exec(ip)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return null
  return octets as [number, number, number, number]
}

/** True for loopback, RFC 1918, link-local and CGNAT addresses; false for public and non-IPv4 input. */
export function isPrivateIPv4(ip: string): boolean {
  const octets = parseIPv4(ip)
  if (!octets) return false
  const [a, b] = octets
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

/** Localised country name; the code itself when the runtime does not know it. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

export function isIPv4(ip: string): boolean {
  return parseIPv4(ip) !== null
}

/** A filter token: `region:<Continent>`, `country:<ISO2>`, `lan` or `unknown`. */
export type LocationToken = string

export function locationTokenOf(
  kind: 'region' | 'country' | 'lan' | 'unknown',
  value?: string,
): LocationToken {
  return kind === 'region' || kind === 'country' ? `${kind}:${value ?? ''}` : kind
}

export type ParsedLocationToken =
  | { kind: 'region'; continent: Continent }
  | { kind: 'country'; country: string }
  | { kind: 'lan' }
  | { kind: 'unknown' }

/** The meaning of a token, or `null` for anything that is not one (a stale or hand-edited value). */
export function parseLocationToken(token: LocationToken): ParsedLocationToken | null {
  if (token === 'lan' || token === 'unknown') return { kind: token }
  if (token.startsWith('region:')) {
    const continent = CONTINENTS.find((c) => c === token.slice('region:'.length))
    return continent ? { kind: 'region', continent } : null
  }
  if (token.startsWith('country:')) {
    const country = token.slice('country:'.length)
    return country ? { kind: 'country', country } : null
  }
  return null
}
