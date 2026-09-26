import type { ScanScope, ScanTarget, ServersState } from '@shared/modules/servers'
import type { ParsedServerAddress } from '@shared/servers/address'
import { parseServerAddress } from '@shared/servers/address'
import { buildScanAddressSet } from './address-set'
import { listFavourites } from './favourites'

/**
 * Story 117 D2: maps a `ScanScope` to the exact `ScanTarget[]` this scan round will touch - pure,
 * no I/O. Mirrors `favourites.ts`'s pure-helper shape for this module.
 *
 * - `all` delegates to 114's own union resolver (`buildScanAddressSet`) unchanged, with the same
 *   inputs it always took, so "Refresh servers" and the auto-scan are provably the same address
 *   set, not a parallel implementation (AC1).
 * - `favourites` returns only the current favourites (`listFavourites(state)`), ignoring
 *   `resolvedSourceAddresses` and `state.manualServers` entirely - a favourites-only refresh never
 *   touches a non-favourite address (AC2).
 * - `server` returns exactly one target for the given address, `origins: []` (mirrors
 *   `scan-runner.ts`'s own fallback for a selected address that is in no known list) - allowed
 *   even when that address is in no source/favourite/manual list.
 */
export function resolveScanScopeAddresses(
  state: Pick<ServersState, 'favourites' | 'manualServers'>,
  scope: ScanScope,
  resolvedSourceAddresses: ParsedServerAddress[],
): ScanTarget[] {
  switch (scope.kind) {
    case 'all':
      return buildScanAddressSet({
        sourceAddresses: resolvedSourceAddresses,
        favourites: state.favourites,
        manualServers: state.manualServers,
      })
    case 'favourites':
      // Review fix (story 117): normalize defensively, mirroring the `server` branch below and
      // `address-set.ts`'s own `normalize` - `addFavourite` already normalizes on add, so this is
      // belt-and-suspenders, but a favourite address that predates a stricter validator must still
      // key the same way `answeredOnline`/`mergeStaleRound` do, or it could never be marked stale.
      return listFavourites({ favourites: state.favourites } as ServersState).map((favourite) => {
        const parsed = parseServerAddress(favourite.address)
        return {
          address: parsed.ok ? parsed.normalized : favourite.address.trim(),
          origins: ['favourite'],
        }
      })
    case 'server': {
      const parsed = parseServerAddress(scope.address)
      const address = parsed.ok ? parsed.normalized : scope.address.trim()
      return [{ address, origins: [] }]
    }
  }
}
