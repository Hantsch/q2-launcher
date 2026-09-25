import { describe, expect, it } from 'vitest'
import type { FavouriteServerEntry, ManualServerEntry } from '@shared/modules/servers'
import type { ParsedServerAddress } from '@shared/servers/address'
import { buildScanAddressSet } from './address-set'

/**
 * Story 114 D3: `buildScanAddressSet` - pure, list in / list out, no `AppContext` (mirrors
 * `favourites.test.ts`'s scope for this module).
 */

function sourceAddress(normalized: string): ParsedServerAddress {
  const [host, port] = normalized.split(':')
  return { host: host as string, port: Number(port), kind: 'ipv4', normalized }
}

function favourite(address: string): FavouriteServerEntry {
  return { address, addedAt: '2024-01-01T00:00:00.000Z' }
}

function manual(address: string): ManualServerEntry {
  return { address, origin: 'manual', addedAt: '2024-01-01T00:00:00.000Z' }
}

describe('buildScanAddressSet', () => {
  it('collapses the same address seen as both a source and a favourite into one target (AC6)', () => {
    const result = buildScanAddressSet({
      sourceAddresses: [sourceAddress('10.0.0.1:27910')],
      favourites: [favourite('10.0.0.1:27910')],
      manualServers: [],
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.address).toBe('10.0.0.1:27910')
    expect(result[0]?.origins.sort()).toEqual(['favourite', 'source'])
  })

  it('keeps a favourite present even when no source returned it this round (AC4)', () => {
    const result = buildScanAddressSet({
      sourceAddresses: [],
      favourites: [favourite('10.0.0.9:27910')],
      manualServers: [],
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ address: '10.0.0.9:27910', origins: ['favourite'] })
  })

  it('includes manual servers as their own target', () => {
    const result = buildScanAddressSet({
      sourceAddresses: [],
      favourites: [],
      manualServers: [manual('10.0.0.5:27910')],
    })

    expect(result).toEqual([{ address: '10.0.0.5:27910', origins: ['manual'] }])
  })

  it('dedupes on the normalized address, not the exact string, when a favourite is unnormalized', () => {
    const result = buildScanAddressSet({
      sourceAddresses: [sourceAddress('10.0.0.1:27910')],
      favourites: [favourite('  10.0.0.1:27910  ')],
      manualServers: [],
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.origins.sort()).toEqual(['favourite', 'source'])
  })

  it('merges all three origins for one address seen everywhere, without duplicate origins', () => {
    const result = buildScanAddressSet({
      sourceAddresses: [sourceAddress('10.0.0.1:27910')],
      favourites: [favourite('10.0.0.1:27910')],
      manualServers: [manual('10.0.0.1:27910')],
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.origins.sort()).toEqual(['favourite', 'manual', 'source'])
  })

  it('keeps distinct addresses as separate targets, in source/favourite/manual insertion order', () => {
    const result = buildScanAddressSet({
      sourceAddresses: [sourceAddress('10.0.0.1:27910')],
      favourites: [favourite('10.0.0.2:27910')],
      manualServers: [manual('10.0.0.3:27910')],
    })

    expect(result.map((target) => target.address)).toEqual([
      '10.0.0.1:27910',
      '10.0.0.2:27910',
      '10.0.0.3:27910',
    ])
  })

  it('returns an empty list when every input is empty', () => {
    expect(buildScanAddressSet({ sourceAddresses: [], favourites: [], manualServers: [] })).toEqual([])
  })
})
