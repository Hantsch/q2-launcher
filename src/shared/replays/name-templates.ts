/**
 * The user's ordered list of demo file-name templates (concept for story 140): a mix of shipped
 * patterns (each tracked by a stable `shippedId` so a later release can change or add to
 * `SHIPPED_NAME_PATTERNS` without disturbing a user's list) and freely added user templates, plus
 * the bookkeeping (`removedShippedIds`) that lets a shipped pattern be removed and later restored.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 * Ids for newly added user entries are never generated here - callers pass a `newId`.
 */
import { z } from 'zod'

export type StoredNameTemplate =
  | { id: string; kind: 'shipped'; shippedId: string; template: string | null }
  | { id: string; kind: 'user'; template: string }

export interface NameTemplatesState {
  entries: StoredNameTemplate[]
  removedShippedIds: string[]
}

export const DEFAULT_NAME_TEMPLATES_STATE: NameTemplatesState = {
  entries: [],
  removedShippedIds: [],
}

export interface NameTemplateEntry {
  id: string
  template: string
  origin: 'shipped' | 'user'
  edited: boolean
}

export interface NameTemplatesView {
  entries: NameTemplateEntry[]
  canRestore: boolean
}

export const nameTemplateEntrySchema = z.object({
  id: z.string(),
  template: z.string(),
  origin: z.enum(['shipped', 'user']),
  edited: z.boolean(),
})

export const nameTemplatesViewSchema = z.object({
  entries: z.array(nameTemplateEntrySchema),
  canRestore: z.boolean(),
})

type ShippedPattern = { id: string; template: string }

/**
 * Reconciles `state.entries` with the currently shipped pattern list: a shipped entry whose
 * `shippedId` no longer exists is dropped when unedited (`template === null`) or converted to a
 * plain user entry (keeping its `id` and its override text) when edited; every shipped id that is
 * neither already present nor tombstoned in `removedShippedIds` is appended, in shipped list
 * order, as an unedited shipped entry whose `id` is its `shippedId`.
 */
export function mergeWithShipped(state: NameTemplatesState, shipped: readonly ShippedPattern[]): NameTemplatesState {
  const shippedIds = new Set(shipped.map((s) => s.id))
  const removed = new Set(state.removedShippedIds)

  const kept: StoredNameTemplate[] = []
  const present = new Set<string>()
  for (const entry of state.entries) {
    if (entry.kind === 'user') {
      kept.push(entry)
      continue
    }
    if (shippedIds.has(entry.shippedId)) {
      kept.push(entry)
      present.add(entry.shippedId)
      continue
    }
    // Shipped id vanished from the release's list.
    if (entry.template === null) continue // unedited - drop silently
    kept.push({ id: entry.id, kind: 'user', template: entry.template })
  }

  const appended: StoredNameTemplate[] = []
  for (const s of shipped) {
    if (present.has(s.id) || removed.has(s.id)) continue
    appended.push({ id: s.id, kind: 'shipped', shippedId: s.id, template: null })
  }

  return { entries: [...kept, ...appended], removedShippedIds: state.removedShippedIds }
}

function resolve(entry: StoredNameTemplate, shipped: readonly ShippedPattern[]): NameTemplateEntry {
  if (entry.kind === 'user') {
    return { id: entry.id, template: entry.template, origin: 'user', edited: false }
  }
  const shippedText = shipped.find((s) => s.id === entry.shippedId)?.template ?? ''
  return {
    id: entry.id,
    template: entry.template ?? shippedText,
    origin: 'shipped',
    edited: entry.template !== null,
  }
}

/** Resolves every stored entry to its display shape, in list order. */
export function toView(state: NameTemplatesState, shipped: readonly ShippedPattern[]): NameTemplatesView {
  return {
    entries: state.entries.map((entry) => resolve(entry, shipped)),
    canRestore: state.removedShippedIds.length > 0,
  }
}

/** Ordered resolved template strings, top to bottom - what the pattern-matching engine consumes. */
export function effectiveNameTemplates(state: NameTemplatesState, shipped: readonly ShippedPattern[]): string[] {
  return state.entries.map((entry) => resolve(entry, shipped).template)
}

export function addTemplate(state: NameTemplatesState, template: string, newId: () => string): NameTemplatesState {
  const entry: StoredNameTemplate = { id: newId(), kind: 'user', template }
  return { entries: [...state.entries, entry], removedShippedIds: state.removedShippedIds }
}

/**
 * Updates a user entry's text, or sets/clears a shipped entry's override. When the new text equals
 * that shipped id's current shipped text, no override is stored (`template: null`) - editing a
 * shipped entry back to its built-in wording is indistinguishable from never having edited it.
 */
export function updateTemplate(
  state: NameTemplatesState,
  id: string,
  template: string,
  shipped: readonly ShippedPattern[],
): NameTemplatesState {
  const entries = state.entries.map((entry): StoredNameTemplate => {
    if (entry.id !== id) return entry
    if (entry.kind === 'user') return { ...entry, template }
    const shippedText = shipped.find((s) => s.id === entry.shippedId)?.template
    return { ...entry, template: template === shippedText ? null : template }
  })
  return { entries, removedShippedIds: state.removedShippedIds }
}

/**
 * Removes a user entry outright; removes a shipped entry from the list and tombstones its
 * `shippedId` in `removedShippedIds` so a later `mergeWithShipped` does not re-add it until
 * `restoreShipped` is called.
 */
export function removeTemplate(
  state: NameTemplatesState,
  id: string,
  _shipped: readonly ShippedPattern[],
): NameTemplatesState {
  const target = state.entries.find((entry) => entry.id === id)
  if (target === undefined) return state
  const entries = state.entries.filter((entry) => entry.id !== id)
  if (target.kind === 'user') return { entries, removedShippedIds: state.removedShippedIds }
  const removedShippedIds = state.removedShippedIds.includes(target.shippedId)
    ? state.removedShippedIds
    : [...state.removedShippedIds, target.shippedId]
  return { entries, removedShippedIds }
}

/**
 * Reorders entries to match `ids`, which must be exactly a permutation of the current entries'
 * ids (same members, same count) - anything else (a missing id, an extra id, a duplicate) throws
 * rather than silently dropping or duplicating an entry.
 */
export function reorderTemplates(state: NameTemplatesState, ids: readonly string[]): NameTemplatesState {
  const currentIds = state.entries.map((e) => e.id)
  const sameMembers =
    ids.length === currentIds.length &&
    new Set(ids).size === currentIds.length &&
    currentIds.every((id) => ids.includes(id))
  if (!sameMembers) {
    throw new Error('reorderTemplates: ids must be exactly a permutation of the current entries')
  }
  const byId = new Map(state.entries.map((e) => [e.id, e] as const))
  const entries = ids.map((id) => byId.get(id) as StoredNameTemplate)
  return { entries, removedShippedIds: state.removedShippedIds }
}

/** Clears a shipped entry's override, reverting its display text to the shipped wording. No-op for a user entry or an unknown id. */
export function resetTemplate(state: NameTemplatesState, id: string): NameTemplatesState {
  const entries = state.entries.map((entry): StoredNameTemplate =>
    entry.id === id && entry.kind === 'shipped' ? { ...entry, template: null } : entry,
  )
  return { entries, removedShippedIds: state.removedShippedIds }
}

/** Clears every tombstone; the removed shipped patterns reappear on the next merge/view. */
export function restoreShipped(state: NameTemplatesState): NameTemplatesState {
  return { entries: state.entries, removedShippedIds: [] }
}

/** Stable FNV-1a (32-bit) hex digest of the templates joined by `\n` - no `node:crypto` dependency. */
export function nameTemplatesFingerprint(templates: readonly string[]): string {
  const text = templates.join('\n')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** True when cached name-facts should be rederived: a missing cached fingerprint, or one that differs. */
export function needsNameFactsRederive(cachedFp: string | undefined, currentFp: string): boolean {
  return cachedFp !== currentFp
}
