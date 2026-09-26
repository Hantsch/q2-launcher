import { describe, expect, it } from 'vitest'
import type { FavouriteServerEntry, ManualServerEntry, ServersState } from '@shared/modules/servers'
import type { ParsedServerAddress } from '@shared/servers/address'
import { buildScanAddressSet } from './address-set'
import { resolveScanScopeAddresses } from './scan-scope'

/**
 * Story 117 D2: `resolveScanScopeAddresses` - pure, list in / list out, no `AppContext` (mirrors
 * `address-set.test.ts`/`favourites.test.ts`'s scope for this module).
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

describe('resolveScanScopeAddresses', () => {
  describe('all scope', () => {
    it('resolves to the same union address set as buildScanAddressSet for the same inputs (AC1)', () => {
      const resolvedSourceAddresses = [sourceAddress('10.0.0.1:27910')]
      const favourites: FavouriteServerEntry[] = [favourite('10.0.0.2:27910')]
      const manualServers: ManualServerEntry[] = [manual('10.0.0.3:27910')]
      const state = { favourites, manualServers } as Pick<ServersState, 'favourites' | 'manualServers'>

      const viaScope = resolveScanScopeAddresses(state, { kind: 'all' }, resolvedSourceAddresses)
      const viaBuild = buildScanAddressSet({ sourceAddresses: resolvedSourceAddresses, favourites, manualServers })

      expect(viaScope).toEqual(viaBuild)
    })
  })

  describe('favourites scope', () => {
    it('returns only favourite addresses, ignoring sources and manual servers entirely (AC2)', () => {
      const favourites: FavouriteServerEntry[] = [favourite('10.0.0.9:27910')]
      const manualServers: ManualServerEntry[] = [manual('10.0.0.5:27910')]
      const resolvedSourceAddresses = [sourceAddress('10.0.0.1:27910')]
      const state = { favourites, manualServers } as Pick<ServersState, 'favourites' | 'manualServers'>

      const result = resolveScanScopeAddresses(state, { kind: 'favourites' }, resolvedSourceAddresses)

      expect(result).toEqual([{ address: '10.0.0.9:27910', origins: ['favourite'] }])
    })

    it('returns an empty list when there are no favourites, even with non-empty sources/manual servers', () => {
      const manualServers: ManualServerEntry[] = [manual('10.0.0.5:27910')]
      const resolvedSourceAddresses = [sourceAddress('10.0.0.1:27910')]
      const state = { favourites: [], manualServers } as Pick<ServersState, 'favourites' | 'manualServers'>

      const result = resolveScanScopeAddresses(state, { kind: 'favourites' }, resolvedSourceAddresses)

      expect(result).toEqual([])
    })
  })

  describe('server scope', () => {
    it('returns exactly one target for the given address with no origins', () => {
      const state = { favourites: [], manualServers: [] } as Pick<ServersState, 'favourites' | 'manualServers'>

      const result = resolveScanScopeAddresses(state, { kind: 'server', address: '10.0.0.1:27910' }, [])

      expect(result).toEqual([{ address: '10.0.0.1:27910', origins: [] }])
    })

    it('still returns the one target when the address is in no source/favourite/manual list', () => {
      const favourites: FavouriteServerEntry[] = [favourite('10.0.0.9:27910')]
      const manualServers: ManualServerEntry[] = [manual('10.0.0.5:27910')]
      const state = { favourites, manualServers } as Pick<ServersState, 'favourites' | 'manualServers'>

      const result = resolveScanScopeAddresses(
        state,
        { kind: 'server', address: '192.168.1.1:27910' },
        [sourceAddress('10.0.0.1:27910')],
      )

      expect(result).toEqual([{ address: '192.168.1.1:27910', origins: [] }])
    })
  })
})
