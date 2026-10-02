import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import {
  NAME_TEMPLATES_MAX,
  nameTemplatesAddSchema,
  nameTemplatesRemoveSchema,
  nameTemplatesReorderSchema,
  nameTemplatesResetSchema,
  nameTemplatesUpdateSchema,
} from '@shared/modules/replays'
import { compileNameTemplate } from '@shared/replays/name-template'
import { SHIPPED_NAME_PATTERNS } from '@shared/replays/name-patterns'
import {
  addTemplate,
  effectiveNameTemplates,
  mergeWithShipped,
  nameTemplatesFingerprint,
  removeTemplate,
  reorderTemplates,
  resetTemplate,
  restoreShipped,
  toView,
  updateTemplate,
  type NameTemplatesState,
  type NameTemplatesView,
} from '@shared/replays/name-templates'
import { fail, ok, type Outcome } from '@shared/types/common'
import type { AppContext } from '../../context'

/**
 * Story 140 D2: the `nameTemplates.*` handler bodies. Each op follows the same three steps -
 * reconcile the persisted `NameTemplatesState` against the currently shipped pattern list
 * (`mergeWithShipped`, story 140 D1), apply the pure op the caller asked for, persist the result -
 * mirroring `src/main/modules/servers/index.ts`'s `mutate()` helper for `sources.*`: read the
 * current slice live, run a pure function over it, and only ever persist on success.
 *
 * Validation of a template's *text* (not just its shape) happens here, before the pure op ever
 * runs, via story 139's `compileNameTemplate` - the same validator the matching engine itself uses,
 * so a template this module accepts is guaranteed to compile. A rejected template writes nothing.
 */

type NameTemplatesAddInput = z.infer<typeof nameTemplatesAddSchema>
type NameTemplatesUpdateInput = z.infer<typeof nameTemplatesUpdateSchema>
type NameTemplatesRemoveInput = z.infer<typeof nameTemplatesRemoveSchema>
type NameTemplatesReorderInput = z.infer<typeof nameTemplatesReorderSchema>
type NameTemplatesResetInput = z.infer<typeof nameTemplatesResetSchema>

/** The persisted state, reconciled against the currently shipped pattern list. */
function currentMerged(app: AppContext): NameTemplatesState {
  return mergeWithShipped(app.state.replaysState().nameTemplates, SHIPPED_NAME_PATTERNS)
}

/** Persists a reconciled `NameTemplatesState`, carrying the rest of `ReplaysState` over untouched. */
function persist(app: AppContext, nameTemplates: NameTemplatesState): NameTemplatesState {
  return app.state.updateSlice('replays', (live) => ({ ...live, nameTemplates })).nameTemplates
}

function view(nameTemplates: NameTemplatesState): NameTemplatesView {
  return toView(nameTemplates, SHIPPED_NAME_PATTERNS)
}

/** Resolves to the current, reconciled `NameTemplatesView` - read-only, nothing is persisted. */
export function nameTemplatesList(app: AppContext): Outcome<NameTemplatesView> {
  return ok(view(currentMerged(app)))
}

/**
 * Appends a new user template. Refused (writing nothing) when the template text itself is invalid
 * per `compileNameTemplate`, or when the list is already at `NAME_TEMPLATES_MAX`.
 */
export function nameTemplatesAdd(
  app: AppContext,
  input: NameTemplatesAddInput,
): Outcome<NameTemplatesView> {
  const compiled = compileNameTemplate(input.template)
  if (!compiled.ok) return fail(compiled.reasonKey, compiled.params)

  const merged = currentMerged(app)
  if (merged.entries.length >= NAME_TEMPLATES_MAX) {
    return fail('replays.nameTemplates.error.tooMany')
  }

  const next = addTemplate(merged, input.template, randomUUID)
  return ok(view(persist(app, next)))
}

/**
 * Updates a user template's text, or sets/clears a shipped entry's override. Refused (writing
 * nothing) when the template text is invalid, or when `id` names no current entry.
 */
export function nameTemplatesUpdate(
  app: AppContext,
  input: NameTemplatesUpdateInput,
): Outcome<NameTemplatesView> {
  const compiled = compileNameTemplate(input.template)
  if (!compiled.ok) return fail(compiled.reasonKey, compiled.params)

  const merged = currentMerged(app)
  if (!merged.entries.some((entry) => entry.id === input.id)) {
    return fail('replays.nameTemplates.error.notFound')
  }

  const next = updateTemplate(merged, input.id, input.template, SHIPPED_NAME_PATTERNS)
  return ok(view(persist(app, next)))
}

/**
 * Removes a template (a user entry outright, a shipped one tombstoned - story 140 D1's
 * `removeTemplate`). Refused when `id` names no current entry.
 */
export function nameTemplatesRemove(
  app: AppContext,
  input: NameTemplatesRemoveInput,
): Outcome<NameTemplatesView> {
  const merged = currentMerged(app)
  if (!merged.entries.some((entry) => entry.id === input.id)) {
    return fail('replays.nameTemplates.error.notFound')
  }

  const next = removeTemplate(merged, input.id, SHIPPED_NAME_PATTERNS)
  return ok(view(persist(app, next)))
}

/**
 * Reorders the whole list. `reorderTemplates` throws when `ids` is not exactly a permutation of the
 * current entries' ids - caught here and turned into a refusal, same "never half-apply, never
 * throw across the IPC boundary" discipline every other handler in this file follows.
 */
export function nameTemplatesReorder(
  app: AppContext,
  input: NameTemplatesReorderInput,
): Outcome<NameTemplatesView> {
  const merged = currentMerged(app)
  try {
    const next = reorderTemplates(merged, input.ids)
    return ok(view(persist(app, next)))
  } catch {
    return fail('replays.nameTemplates.error.invalidReorder')
  }
}

/** Clears a shipped entry's override. A no-op for a user entry; refused for an unknown id. */
export function nameTemplatesReset(
  app: AppContext,
  input: NameTemplatesResetInput,
): Outcome<NameTemplatesView> {
  const merged = currentMerged(app)
  if (!merged.entries.some((entry) => entry.id === input.id)) {
    return fail('replays.nameTemplates.error.notFound')
  }

  const next = resetTemplate(merged, input.id)
  return ok(view(persist(app, next)))
}

/**
 * Clears every removed-shipped tombstone; never refuses. `restoreShipped` only clears the tombstone
 * set - it does not itself re-append the now-un-tombstoned pattern(s) to `entries` - so the result
 * is re-merged against the shipped list before persisting, the same way a previously-removed
 * pattern would be re-added on the next natural `mergeWithShipped` pass, just made visible in this
 * call's own response instead of waiting for the next `nameTemplates.list`.
 */
export function nameTemplatesRestore(app: AppContext): Outcome<NameTemplatesView> {
  const restored = restoreShipped(currentMerged(app))
  const next = mergeWithShipped(restored, SHIPPED_NAME_PATTERNS)
  return ok(view(persist(app, next)))
}

/**
 * The ordered, resolved template strings plus their fingerprint - what a later deliverable's demo
 * scan (story 144) consumes to decide whether a cached demo's name-derived facts need
 * re-deriving (`needsNameFactsRederive`, story 140 D1). Read-only, like `nameTemplatesList`.
 */
export function currentNameTemplates(app: AppContext): {
  templates: string[]
  fingerprint: string
} {
  const templates = effectiveNameTemplates(currentMerged(app), SHIPPED_NAME_PATTERNS)
  return { templates, fingerprint: nameTemplatesFingerprint(templates) }
}
