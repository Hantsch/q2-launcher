import type { FavouriteServerEntry, ManualServerEntry, ScanOrigin, ScanTarget } from '@shared/modules/servers'
import type { ParsedServerAddress } from '@shared/servers/address'
import { parseServerAddress } from '@shared/servers/address'

/**
 * Story 114 D3: the address set one scan round sweeps - a pure merge of three inputs of different
 * shape and provenance into the `ScanTarget[]` the runner (a later deliverable, D4+) iterates.
 *
 * ## Inputs
 *
 * - `sourceAddresses`: every address resolved this round from the enabled master/list sources,
 *   already flattened across all of them by the caller. Typed as `ParsedServerAddress[]` (not
 *   `string[]`) because that is exactly what `resolveUdpMasterSource`/`resolveHttpListSource`
 *   (`src/main/modules/servers/{udp-master-source,http-list-source}.ts`) hand back on success -
 *   reusing that shape means D4/D5/D6 never need to re-derive or re-parse anything to call this
 *   function; they just concatenate the two sources' `addresses` arrays.
 * - `favourites`: the current `ServersState['favourites']` list (`FavouriteServerEntry[]`, same
 *   shape `listFavourites()` in `./favourites.ts` returns).
 * - `manualServers`: the current `ServersState['manualServers']` list (`ManualServerEntry[]`).
 *
 * ## Keying and merge (AC6)
 *
 * Every address, regardless of which input it came from, is re-normalized through
 * `parseServerAddress`/`formatServerAddress` here (falling back to a trimmed string if parsing
 * fails, same defence-in-depth convention as `favourites.ts`'s `normalizeAddress` - a favourite or
 * manual entry that predates a stricter validator, or was accepted under AC5's "never seen live"
 * allowance, must still land in the set rather than being dropped). The same normalized address
 * appearing under more than one input collapses to a single `ScanTarget` whose `origins` array
 * gathers every origin it was seen under, without duplicates.
 *
 * ## Every favourite is present (AC4)
 *
 * Favourites are merged unconditionally, independent of whether `sourceAddresses` mentions them -
 * so a favourite an empty/failed source round didn't return is still a target this round.
 *
 * ## Output order
 *
 * Deterministic stable insertion order: sources first, then favourites, then manual servers, each
 * in their own input order - never re-sorted, so tests (and any later diffing) are not flaky.
 */

/** The inputs `buildScanAddressSet` merges - see the file doc comment for why each is shaped this
 * way. */
export interface BuildScanAddressSetInput {
  sourceAddresses: ParsedServerAddress[]
  favourites: FavouriteServerEntry[]
  manualServers: ManualServerEntry[]
}

/** Normalizes a candidate address via `parseServerAddress`, falling back to the trimmed raw input
 * when parsing fails - mirrors `favourites.ts`'s `normalizeAddress`. */
function normalize(address: string): string {
  const parsed = parseServerAddress(address)
  return parsed.ok ? parsed.normalized : address.trim()
}

/** Pure: builds the `ScanTarget[]` for one scan round from the three inputs above. No I/O, no
 * network, no `AppContext` - see the file doc comment. */
export function buildScanAddressSet(input: BuildScanAddressSetInput): ScanTarget[] {
  const targets = new Map<string, ScanTarget>()

  const merge = (address: string, origin: ScanOrigin): void => {
    const normalized = normalize(address)
    const existing = targets.get(normalized)
    if (existing === undefined) {
      targets.set(normalized, { address: normalized, origins: [origin] })
      return
    }
    if (!existing.origins.includes(origin)) existing.origins.push(origin)
  }

  for (const source of input.sourceAddresses) merge(source.normalized, 'source')
  for (const favourite of input.favourites) merge(favourite.address, 'favourite')
  for (const manual of input.manualServers) merge(manual.address, 'manual')

  return Array.from(targets.values())
}
