import { readFileSync } from 'node:fs'
import { Reader, type CountryResponse } from 'mmdb-lib'
import {
  CONTINENTS,
  isIPv4,
  isPrivateIPv4,
  type Continent,
  type ServerLocation,
} from '../../../shared/servers/location'
import type { Logger } from '../logger'

export interface CountryLookup {
  locate(ip: string): ServerLocation
}

const LAN: ServerLocation = { kind: 'lan' }
const UNKNOWN: ServerLocation = { kind: 'unknown' }

function isContinent(code: string | undefined): code is Continent {
  return CONTINENTS.some((continent) => continent === code)
}

/**
 * Offline IP-to-country lookup over a bundled MMDB file. The file is read lazily on the first
 * public address, so LAN-only use never touches the disk; a missing or unreadable file makes
 * every public address Unknown and is logged once instead of thrown.
 */
export function createCountryLookup(dbPath: string, log?: Pick<Logger, 'warn'>): CountryLookup {
  const cache = new Map<string, ServerLocation>()
  let reader: Reader<CountryResponse> | null = null
  let loadFailed = false

  function openReader(): Reader<CountryResponse> | null {
    if (reader || loadFailed) return reader
    try {
      reader = new Reader<CountryResponse>(readFileSync(dbPath))
    } catch (error) {
      loadFailed = true
      log?.warn('GeoIP database unavailable, locations will be unknown', error)
    }
    return reader
  }

  function lookupPublic(ip: string): ServerLocation {
    const db = openReader()
    if (!db) return UNKNOWN
    try {
      const record = db.get(ip)
      const country = record?.country?.iso_code
      const continent = record?.continent?.code
      if (!country || !isContinent(continent)) return UNKNOWN
      return { kind: 'country', country: country.toUpperCase(), continent }
    } catch {
      // a malformed IP or corrupt database record is an unknown country
      return UNKNOWN
    }
  }

  return {
    locate(ip: string): ServerLocation {
      if (isPrivateIPv4(ip)) return LAN
      if (!isIPv4(ip)) return UNKNOWN
      const cached = cache.get(ip)
      if (cached) return cached
      const location = lookupPublic(ip)
      cache.set(ip, location)
      return location
    },
  }
}
