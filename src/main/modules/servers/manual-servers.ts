import type { ManualServerEntry } from '@shared/modules/servers'
import { parseServerAddress, serverAddressRejectionKey } from '@shared/servers/address'

/**
 * Story 113 D2: the manual-servers collection's two operations, as pure functions over
 * `ServersState['manualServers']` - no I/O, no `AppContext`, mirroring `favourites.ts` (story
 * 112 D2)'s shape for this sibling collection.
 *
 * Unlike a favourite, a manual entry's address is never trusted input from a prior validated
 * source (D-A/AC1): it is raw text the user typed, so `addManualServer` runs it through
 * `parseServerAddress` and refuses - never persists - anything the validator rejects, returning
 * the rejection's i18n key via `serverAddressRejectionKey()` (mirrors `ManualServerAddResult` in
 * `src/shared/modules/servers.ts`). Only a successfully parsed address, in its canonical
 * `normalized` form, is ever stored.
 *
 * Add is idempotent on the normalized address (dedupe, D-B): adding an address already on the
 * list returns the existing entry unchanged (original `addedAt` kept, no duplicate row).  Remove
 * is idempotent in the other direction (AC6): removing an address that is not on the list is a
 * no-op that still succeeds.
 *
 * Nothing here mutates its input: every returned list is a new array; entries themselves are
 * never mutated in place.
 */

/**
 * Normalizes a candidate address via `parseServerAddress` for a *lookup* against already-stored
 * (already-normalized) entries - falls back to the trimmed raw input when parsing fails, same
 * convention as `favourites.ts`'s `normalizeAddress`, since a caller may pass an unnormalized
 * string to `removeManualServer`.
 */
function normalizeForLookup(address: string): string {
  const parsed = parseServerAddress(address)
  return parsed.ok ? parsed.normalized : address.trim()
}

/**
 * Validates and adds `input.address` to `list`. Refuses (never persists) an address
 * `parseServerAddress` rejects, returning its rejection i18n key (AC1). On success, dedupes on
 * the normalized address (D-B): an address already stored returns its existing entry as-is,
 * without updating `addedAt` or the list. Otherwise appends a fresh `ManualServerEntry`
 * (`origin: 'manual'`, `addedAt` set to now) and returns it alongside the updated list (AC2).
 */
export function addManualServer(
  list: readonly ManualServerEntry[],
  input: { address: string },
):
  | { ok: true; entry: ManualServerEntry; list: ManualServerEntry[] }
  | { ok: false; reasonKey: string } {
  const parsed = parseServerAddress(input.address)
  if (!parsed.ok) {
    return { ok: false, reasonKey: serverAddressRejectionKey(parsed.reason) }
  }

  const existing = list.find((entry) => entry.address === parsed.normalized)
  if (existing !== undefined) {
    return { ok: true, entry: existing, list: [...list] }
  }

  const entry: ManualServerEntry = {
    address: parsed.normalized,
    origin: 'manual',
    addedAt: new Date().toISOString(),
  }
  const next = [...list, entry]
  return { ok: true, entry, list: next }
}

/**
 * Removes `address` from `list`. An address that is not present (in either raw or normalized
 * form) is a no-op that succeeds (AC6) - the list comes back unchanged either way.
 */
export function removeManualServer(
  list: readonly ManualServerEntry[],
  address: string,
): ManualServerEntry[] {
  const normalized = normalizeForLookup(address)
  return list.filter((entry) => entry.address !== normalized)
}
