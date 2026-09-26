import type { FavouriteServerEntry, ServersState } from '@shared/modules/servers'
import { parseServerAddress } from '@shared/servers/address'

/**
 * Story 112 D2: the favourites collection's three operations, as pure functions over
 * `ServersState['favourites']` - no I/O, no `AppContext`, mirroring `master-sources.ts` (story
 * 111 D3)'s shape for this exact module.
 *
 * A favourite is keyed by its normalized address (D-B/AC4), never by a scan-result id, so marking
 * the same address favourite twice never creates a duplicate row and unmarking by address removes
 * exactly that entry regardless of whether a scan ever produced it. Normalization goes through
 * `parseServerAddress` (D-C); by the time an address reaches here it should already be normalized
 * by `serverAddressSchema` at the IPC boundary (story 112 D1), but these functions call it anyway
 * as defence in depth for any caller that bypasses the schema (e.g. a direct unit test). Unlike
 * `master-sources.ts`'s `validateMasterSourceAddress`, a failed parse here is not a refusal - D-G
 * requires an address that has never been live or scanned to still be accepted (AC5), and this
 * file's functions have no rejection path in their signature - so a candidate `parseServerAddress`
 * can't parse just falls back to its own trimmed, unnormalized form.
 *
 * Both `add` and `remove` are idempotent in both directions (D-F): adding an address already on
 * the list is a no-op that keeps the original `addedAt` and returns the list unchanged; removing
 * an address that isn't on the list is a no-op that succeeds. Neither ever touches the network
 * (D-G) - only string normalization and array bookkeeping.
 *
 * Nothing here mutates its input: every returned list is a new, sorted array of shallow-cloned
 * entries (`cloneList`, same pattern as `master-sources.ts`), so the list still held by the state
 * store is never aliased into a result.
 */

/** Every list leaving this file is a fresh array of fresh row objects - see the file doc comment. */
function cloneList(favourites: readonly FavouriteServerEntry[]): FavouriteServerEntry[] {
  return favourites.map((favourite) => ({ ...favourite }))
}

/** Kept sorted by `addedAt` ascending - oldest favourite first (the Plan's step 2). */
function sortByAddedAt(favourites: FavouriteServerEntry[]): FavouriteServerEntry[] {
  return favourites.sort((a, b) => a.addedAt.localeCompare(b.addedAt))
}

/**
 * Normalizes a candidate address via `parseServerAddress`, falling back to the trimmed raw input
 * when parsing fails - see the file doc comment's D-G note. This is normalize-or-fallback, never a
 * rejection: there is no reason code returned here, only a string to key on.
 */
function normalizeAddress(address: string): string {
  const parsed = parseServerAddress(address)
  return parsed.ok ? parsed.normalized : address.trim()
}

/** Returns the current favourites, sorted by `addedAt` ascending. */
export function listFavourites(state: ServersState): FavouriteServerEntry[] {
  return sortByAddedAt(cloneList(state.favourites))
}

/**
 * Adds `address` to the favourites list. If a favourite with that normalized address already
 * exists, returns the list unchanged (same `addedAt`, no duplicate row) - otherwise appends a new
 * entry with `addedAt` set to now and returns the new, sorted list. Never touches the network
 * (D-G): an address no scan has ever seen is accepted the same as any other (AC5).
 */
export function addFavourite(state: ServersState, address: string): FavouriteServerEntry[] {
  const normalized = normalizeAddress(address)
  const existing = state.favourites.find((favourite) => favourite.address === normalized)
  if (existing !== undefined) return listFavourites(state)

  const next = cloneList(state.favourites)
  next.push({ address: normalized, addedAt: new Date().toISOString() })
  return sortByAddedAt(next)
}

/**
 * Removes `address` from the favourites list. An address that is not a favourite is a no-op that
 * succeeds (D-F) - the returned list is still a fresh, sorted clone either way.
 */
export function removeFavourite(state: ServersState, address: string): FavouriteServerEntry[] {
  const normalized = normalizeAddress(address)
  const next = state.favourites.filter((favourite) => favourite.address !== normalized)
  return sortByAddedAt(cloneList(next))
}
