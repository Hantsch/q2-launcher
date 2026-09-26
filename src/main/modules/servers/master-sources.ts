import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type {
  MasterSource,
  MasterSourcesRejectionReason,
  MasterSourcesResult,
  sourcesAddInputSchema,
  sourcesRemoveInputSchema,
  sourcesReorderInputSchema,
  sourcesUpdateInputSchema,
} from '@shared/modules/servers'
import { validateMasterSourceAddress } from '@shared/servers/master-source-address'

/**
 * Story 111 D3: the master-source list's four mutations, as pure functions over a `MasterSource[]`.
 *
 * No I/O and no `AppContext`: each function takes the current list and returns either the full new
 * list or a refusal reason (`MasterSourcesResult`, story 111 D1). `index.ts` is the only place that
 * reads and writes `app.state`, which keeps "did the rule fire?" testable without a `StateStore`
 * and makes "nothing is persisted on a refusal" a property of one small function there rather than
 * of four.
 *
 * Two invariants everything here upholds, because `parseServersState`
 * (`src/main/lib/schemas.ts`, story 111 D2) *drops* rows that break them on the next load - a
 * violation would not throw, it would silently lose a user's source on the next start:
 *
 * - every stored `address` is the normalized output of `validateMasterSourceAddress` for that row's
 *   own `type` (a row whose address fails its type's rulebook is dropped on read), and
 * - every stored `id` is unique (`parseServersState` dedupes by `id`, first occurrence wins).
 *
 * Nothing here mutates its input: every returned list is a new array of shallow-cloned rows, so a
 * refusal can never have half-applied anything and the list still held by the state store is never
 * aliased into a result.
 */

type AddSourceInput = z.infer<typeof sourcesAddInputSchema>
type RemoveSourceInput = z.infer<typeof sourcesRemoveInputSchema>
type UpdateSourceInput = z.infer<typeof sourcesUpdateInputSchema>
type ReorderSourcesInput = z.infer<typeof sourcesReorderInputSchema>

/** Mints an id for a new source. Injectable so tests can pin ids; main uses `randomUUID`. */
export type MintSourceId = () => string

function refuse(reason: MasterSourcesRejectionReason): MasterSourcesResult {
  return { ok: false, reason }
}

function accept(sources: MasterSource[]): MasterSourcesResult {
  return { ok: true, sources }
}

/** Every list leaving this file is a fresh array of fresh row objects - see the file doc comment. */
function cloneList(sources: readonly MasterSource[]): MasterSource[] {
  return sources.map((source) => ({ ...source }))
}

/**
 * Duplicate detection compares normalized addresses only, not `type` + address: the two types'
 * normalized forms cannot collide in practice (`host:port` vs. an absolute URL), and comparing the
 * address alone means "the same list, added twice under different types" is still caught.
 */
function addressTaken(
  sources: readonly MasterSource[],
  address: string,
  exceptId?: string,
): boolean {
  return sources.some((source) => source.address === address && source.id !== exceptId)
}

/**
 * A duplicate id is the one mistake that loses data silently (`parseServersState` keeps the first
 * row and drops the rest), so a minted id is checked against the list it is about to join. A
 * `randomUUID` never collides; a stubbed or degenerate `mintId` can, and then this falls back to a
 * derived id that is free by construction rather than writing a duplicate.
 */
function mintUniqueId(taken: ReadonlySet<string>, mintId: MintSourceId): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = mintId()
    if (candidate.length > 0 && !taken.has(candidate)) return candidate
  }
  let suffix = 1
  while (taken.has(`source-${suffix}`)) suffix += 1
  return `source-${suffix}`
}

/**
 * Appends a new, enabled source. The id is minted here, in main - a renderer never supplies one
 * (story 111's Decisions) - and the stored address is the *normalized* form, never the raw input.
 * Refuses an address its type's rulebook rejects, and one already in the list.
 */
export function addSource(
  sources: readonly MasterSource[],
  input: AddSourceInput,
  mintId: MintSourceId = randomUUID,
): MasterSourcesResult {
  const address = validateMasterSourceAddress(input.type, input.address)
  if (!address.ok) return refuse(address.reason)
  if (addressTaken(sources, address.normalized)) return refuse('duplicate-address')

  const id = mintUniqueId(new Set(sources.map((source) => source.id)), mintId)
  return accept([
    ...cloneList(sources),
    { id, type: input.type, address: address.normalized, enabled: true },
  ])
}

/** Removes one source by id. An id that is not in the list is a refusal, never a silent no-op. */
export function removeSource(
  sources: readonly MasterSource[],
  input: RemoveSourceInput,
): MasterSourcesResult {
  if (!sources.some((source) => source.id === input.id)) return refuse('not-found')
  return accept(cloneList(sources.filter((source) => source.id !== input.id)))
}

/**
 * Narrows `sources.update`'s two-shape payload (story 111 D1's `z.union`). The union has already
 * rejected anything else by the time a handler runs, so `null` here only ever means "called
 * directly with a hand-built object" - it is a defence, not a reachable IPC path.
 */
type NarrowedUpdate =
  | { kind: 'address'; type: MasterSource['type']; address: string }
  | { kind: 'enabled'; enabled: boolean }

function narrowUpdate(input: UpdateSourceInput): NarrowedUpdate | null {
  const candidate = input as Partial<Record<'type' | 'address' | 'enabled', unknown>>
  const hasAddress = typeof candidate.type === 'string' && typeof candidate.address === 'string'
  const hasEnabled = typeof candidate.enabled === 'boolean'
  // Exactly one of the two shapes - both at once is ambiguous (which one did the caller mean?) and
  // neither is nothing to do; both are refused rather than guessed at.
  if (hasAddress === hasEnabled) return null
  if (hasAddress) {
    return {
      kind: 'address',
      type: candidate.type as MasterSource['type'],
      address: candidate.address as string,
    }
  }
  return { kind: 'enabled', enabled: candidate.enabled as boolean }
}

/**
 * Either re-validates an edited address (`{ id, type, address }`) or toggles `enabled`
 * (`{ id, enabled }`) - never both. Toggling never touches `type`/`address`: disabling a source
 * keeps it in the list, intact, so re-enabling it needs no retyping (story 111's Decisions).
 *
 * A payload that is neither shape is refused as `'empty'`, the closest code in D1's reason union -
 * there is no dedicated "malformed payload" reason because the zod union makes it unreachable over
 * IPC, and an update carrying no address is indistinguishable from an empty one.
 */
export function updateSource(
  sources: readonly MasterSource[],
  input: UpdateSourceInput,
): MasterSourcesResult {
  const index = sources.findIndex((source) => source.id === input.id)
  if (index === -1) return refuse('not-found')

  const update = narrowUpdate(input)
  if (update === null) return refuse('empty')

  const next = cloneList(sources)
  const current = next[index]!

  if (update.kind === 'enabled') {
    next[index] = { ...current, enabled: update.enabled }
    return accept(next)
  }

  const address = validateMasterSourceAddress(update.type, update.address)
  if (!address.ok) return refuse(address.reason)
  if (addressTaken(sources, address.normalized, current.id)) return refuse('duplicate-address')

  next[index] = { ...current, type: update.type, address: address.normalized }
  return accept(next)
}

/**
 * Applies a full permutation of the current ids. `ids` must be exactly the stored id set - same
 * members, same length, no duplicates - or nothing is applied (story 111's Decisions: a full
 * permutation is cheap to verify and impossible to half-apply, unlike an index-based move). Length
 * plus no-duplicates plus every id known is a permutation, so no second pass is needed to prove
 * nothing was dropped.
 */
export function reorderSources(
  sources: readonly MasterSource[],
  input: ReorderSourcesInput,
): MasterSourcesResult {
  if (input.ids.length !== sources.length) return refuse('invalid-reorder')
  if (new Set(input.ids).size !== input.ids.length) return refuse('invalid-reorder')

  const byId = new Map(sources.map((source) => [source.id, source]))
  const reordered: MasterSource[] = []
  for (const id of input.ids) {
    const source = byId.get(id)
    if (source === undefined) return refuse('invalid-reorder')
    reordered.push({ ...source })
  }
  return accept(reordered)
}
