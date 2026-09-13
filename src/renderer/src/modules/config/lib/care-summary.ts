/**
 * Care tab summary — story 025 D8.
 *
 * Two independent jobs live here, both pure aggregation over data every
 * other Care section already computes:
 *
 * 1. `dedupedFindingCounts` — the tab badge's error/warning counts
 *    (`ConfigView.tsx`), deduplicated across the validation report and the
 *    tidy-up list. Story 019's alias-wiring rules
 *    (`aliasUnreferenced`/`undefinedAlias`/`aliasDuplicate`) feed BOTH lists:
 *    `tidy-up-findings.ts` runs `validateActions` once at a fixed engine
 *    (`r1q2`, its own `TIDY_UP_ENGINE`) and carries the resulting `Finding.id`
 *    forward as `TidyUpFinding.sourceFindingId` (see that file's own doc
 *    comment), so a naive sum of `totalCounts(validation)` and
 *    `tidyUpFindings.length` counts those rows twice. The dedup key is the
 *    finding id itself, EXCEPT for alias-wiring ids
 *    (`${engine}:actions:${rule}:${sequence}`, minted by `validateActions` in
 *    `@shared/config/validate-actions.ts`): that rule family "carries no
 *    engine-specific facts" (that module's own doc comment), so the same
 *    underlying problem mints an id tagged with whichever engine happened to
 *    validate it - `q2pro:actions:aliasUnreferenced:0` in the report for a
 *    q2pro-assigned profile, but always `r1q2:actions:aliasUnreferenced:0` in
 *    the tidy-up list, since that list runs at one fixed engine regardless of
 *    assignment. `dedupKey` strips that leading `<engine>:` segment for ids
 *    shaped `<engine>:actions:...` before comparing, on both sides, so the two
 *    collide as decision 18 requires. Every other id
 *    (`validateStructure`/`validateCvars` findings, and the tidy-up-only kinds
 *    like `bindConflict:...`/`layerEmpty:...`/`preserved:...`) is compared
 *    as-is: those are genuinely engine-specific in content, or already
 *    engine-agnostic in shape, so normalizing them could wrongly collide two
 *    different findings.
 *
 *    Story 079 D7 (AC6) adds a third source into the same count: every Files
 *    row (`care-sync.ts`'s `CareSyncRow`) that is not `inSync` - drifted,
 *    missing or a failed write are each "something to do" exactly like an
 *    unresolved finding, so the badge counts them alongside validation and
 *    tidy-up rather than only inside the Care tab's own Files list. Keyed as
 *    `files:${row.target}` so it de-duplicates per row (one row per
 *    canonical/installation target) and can never collide with a finding id.
 *
 *    Story 079 review (finding 4): the canonical row reads `outOfSync` for two different reasons
 *    (`care-sync.ts`'s `canonicalOutOfSyncReason`) - the file was changed outside the launcher
 *    (`externalEdit`, genuine drift), or the profile simply has edits the user has not saved yet
 *    (`unsavedChanges`, true of every dirty profile the moment it is typed into). Only the first is
 *    drift; the second is normal, transient, mid-edit state that `fileItems` (`care-items.ts`)
 *    already gives no action for - the badge must agree, or it lights up on every keystroke. So a
 *    canonical row whose reason is `unsavedChanges` is excluded from this count; every other
 *    non-`inSync` row (installation `outOfSync`/`missing`/`failed`, canonical `externalEdit`/
 *    `missing`/`failed`) still counts exactly as before.
 * 2. `careSummary` — the Care-level "all clear vs. something to do" rollup
 *    (story 025 AC 7, rewritten by story 058 D1 around `care-items.ts`). Each
 *    group answers `clean`, `{ items: n }`, or `notChecked`, and the whole tab
 *    is `allClear` only when there are zero items AND every source actually
 *    answered.
 *
 *    Two sources can fail to answer, and neither may ever read as clean:
 *    - the report, when `validation.status !== 'ok'` — nothing was validated
 *      against at all (story 025 review finding F2, story 058 decision 3). The
 *      tab renders that as its own explicit "nothing to validate against"
 *      state, so the summary must not call it clean.
 *    - the files check, while its fetch is still loading or has errored (story
 *      025 review finding F3) — neither is evidence of cleanliness, and the
 *      summary must still answer for every other group rather than vanishing.
 *
 *    Story 058 decision 4 removed the third one: Care no longer tracks the
 *    redundant-copies cleanup at all (it is an action on the installation in
 *    Library now), so `CareCleanupStatus` and its permanent `notChecked` — the
 *    branch that forced a "Not all clear" banner on a profile with nothing to
 *    do — are gone from this module rather than merely unused.
 *
 * Both functions are pure: no DOM, no hooks, no IPC. `CareTab.tsx` calls them
 * with data it either already holds (`validation`, a freshly-computed
 * `analyzeTidyUp(profile)`, the items `buildCareItems` derived) or has been
 * handed by the hook that owns the sync fetch — this module never reaches into
 * IPC itself, same discipline as `validation-scope.ts`.
 */

import type { Finding } from '@shared/config/validation'
import { engineLabel } from '@shared/types/engine'
import type { CareItem, CareItemGroup } from './care-items'
import { canonicalOutOfSyncReason, type CareSyncRow } from './care-sync'
import type { TidyUpFinding } from './tidy-up-findings'
import type { ProfileValidation } from './validation-scope'

/** Mirrors `care-items.ts`'s own (unexported) `fileLevel`: `'failed'` is the only sync state that
 * describes a write that actually went wrong, so it is the only one that counts as an error here -
 * every other non-`inSync` state (`outOfSync`/`missing`) is a warning, same tone as the Files item
 * it produces. Kept as its own tiny copy rather than importing `care-items.ts`, which already imports
 * `dedupKey` from this module - importing back would make the two files circular. */
function fileFindingLevel(row: CareSyncRow): 'error' | 'warning' {
  return row.state === 'failed' ? 'error' : 'warning'
}

/** Error/warning counts, deduplicated by finding id — see the file doc comment. */
export interface DedupedFindingCounts {
  errors: number
  warnings: number
}

function worseLevel(a: 'error' | 'warning', b: 'error' | 'warning'): 'error' | 'warning' {
  return a === 'error' || b === 'error' ? 'error' : 'warning'
}

/** Matches only alias-wiring finding ids (`${engine}:actions:${rule}:${sequence}`,
 * `@shared/config/validate-actions.ts`) — never the tidy-up-only minted ids
 * (`bindConflict:...`, `layerEmpty:...`, `preserved:...`), which do not start
 * with an engine kind followed by `:actions:`. */
const ACTIONS_FINDING_ID = /^[^:]+:actions:/

/**
 * The dedup identity for a finding id (see the file doc comment): alias-wiring
 * ids are engine-tag-only differences between the report and the tidy-up
 * list, so the leading `<engine>:` segment is stripped before comparing.
 * Every other id is returned unchanged.
 *
 * Exported for `care-items.ts`, which drops the health row for a finding the
 * tidy-up list also reports (story 058 AC 3): the badge and the item list must
 * mean the same thing by "one finding", so they share this one rule rather
 * than growing a second copy of it.
 */
export function dedupKey(id: string): string {
  return ACTIONS_FINDING_ID.test(id) ? id.slice(id.indexOf(':') + 1) : id
}

/**
 * The tab badge's own counts (`ConfigView.tsx`): every distinct finding id
 * across the validation report and the tidy-up list, counted once each, plus
 * (story 079 D7, AC6) every Files row that is not `inSync` - a drifted,
 * missing or failed-write copy is exactly as much "something to do" as an
 * unresolved finding, so the badge counts it the same way.
 *
 * `info`-level validation findings are excluded, same as `totalCounts` and
 * the badge's own existing tone logic - neither has ever counted infos.
 *
 * The Files rows share the same `levelById` map as the findings, keyed as
 * `files:${row.target}` - one entry per row, which is already the dedup unit
 * `toCareSyncRows` produces (one row per canonical/installation target, never
 * more than one for the same file). That key can never collide with a finding
 * id (`dedupKey` only ever strips a leading `<engine>:` segment from an
 * `<engine>:actions:...`-shaped id), so validation/tidy-up findings and Files
 * drift are summed into one total rather than double-counted against each
 * other - there is nothing for them to collide on in the first place.
 */
export function dedupedFindingCounts(
  validation: ProfileValidation,
  tidyUpFindings: TidyUpFinding[],
  driftRows: CareSyncRow[] = [],
  /** `profile.dirty` - only used to tell the canonical row's two `outOfSync` causes apart (see the
   * file doc comment); undefined behaves like `false` (`canonicalOutOfSyncReason`'s own default),
   * so an omitted profile never suppresses a genuine `externalEdit` row. */
  profileDirty?: boolean,
): DedupedFindingCounts {
  const levelById = new Map<string, 'error' | 'warning'>()

  const record = (id: string, level: Finding['level'] | 'error' | 'warning'): void => {
    if (level === 'info') return
    const key = dedupKey(id)
    const existing = levelById.get(key)
    levelById.set(key, existing ? worseLevel(existing, level) : level)
  }

  for (const engine of validation.byEngine) {
    for (const finding of engine.findings) record(finding.id, finding.level)
  }
  for (const finding of tidyUpFindings) record(finding.sourceFindingId, finding.level)
  for (const row of driftRows) {
    if (row.state === 'inSync') continue
    if (canonicalOutOfSyncReason(row, profileDirty) === 'unsavedChanges') continue
    record(`files:${row.target}`, fileFindingLevel(row))
  }

  let errors = 0
  let warnings = 0
  for (const level of levelById.values()) {
    if (level === 'error') errors++
    else warnings++
  }
  return { errors, warnings }
}

/** One group's state, for the Care-level summary. `'notChecked'` is what keeps
 * "nothing found" and "nothing was looked at" apart: the health group answers
 * it when `validation.status !== 'ok'` (nothing was validated against), the
 * files group while its fetch is still loading or has errored. Neither is
 * evidence of cleanliness, and neither may ever contribute to `allClear`. */
export type SectionStatus =
  | { readonly kind: 'clean' }
  | { readonly kind: 'items'; readonly count: number }
  | { readonly kind: 'notChecked' }

function statusFor(count: number): SectionStatus {
  return count === 0 ? { kind: 'clean' } : { kind: 'items', count }
}

/**
 * What the sync fetch reports out (story 025 review finding F3) - distinguishes
 * "still loading" and "the fetch failed" from "loaded, here are the rows", so
 * the Care summary can answer something for the files group instead of never
 * rendering while the fetch is in flight or silently omitting it when it fails.
 */
export type CareSyncStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly rows: CareSyncRow[] }
  | { readonly kind: 'error' }

export interface CareSummaryInput {
  /** Exactly the list the tab renders (`buildCareItems`) - passed in rather
   * than rebuilt here, so the summary and the rows can never disagree about
   * how many things there are to do. */
  items: CareItem[]
  validation: ProfileValidation
  /** The sync fetch's status, lifted up by whoever owns it - never computed
   * here from IPC. */
  sync: CareSyncStatus
}

/** One line the All clear block prints: what was checked, and what came back.
 * Keys, never prose - the renderer translates and counts. */
export interface CareSummaryLine {
  group: CareItemGroup
  messageKey: string
  params: Record<string, string | number>
}

export interface CareSummary {
  health: SectionStatus
  files: SectionStatus
  tidy: SectionStatus
  /** True only when there is nothing to do AND every source actually answered:
   * zero items plus a validated report plus a resolved sync fetch. An
   * unvalidated report or an unresolved/errored fetch can never contribute a
   * false "nothing to report". */
  allClear: boolean
  /** One line per checked thing, in group order, for the All clear block
   * (AC 1). Always present - a line says what it knows, including that it does
   * not know yet. */
  lines: CareSummaryLine[]
}

const ALL_CLEAR_PREFIX = 'config.care.allClear.'

function countIn(items: CareItem[], group: CareItemGroup): number {
  return items.filter((item) => item.group === group).length
}

/**
 * The Care tab's rollup and the lines its All clear block prints.
 *
 * The health group only reads its items when `validation.status === 'ok'` -
 * anything else means there was nothing to validate against at all, and a
 * trivially-empty list in that state must read as `notChecked`, never `clean`
 * (F2). Likewise the files group only reads rows when
 * `input.sync.kind === 'loaded'` - still loading or errored both read as
 * `notChecked` rather than guessing (F3), and `buildCareItems` has no rows to
 * turn into items in either case, so the item count alone would look clean.
 * That is exactly why `allClear` is not simply `items.length === 0`.
 */
export function careSummary(input: CareSummaryInput): CareSummary {
  const validated = input.validation.status === 'ok'
  const health: SectionStatus = validated
    ? statusFor(countIn(input.items, 'health'))
    : { kind: 'notChecked' }
  const files: SectionStatus =
    input.sync.kind === 'loaded'
      ? statusFor(countIn(input.items, 'files'))
      : { kind: 'notChecked' }
  // The tidy-up analyzer is synchronous and always answers, so this group has
  // no `notChecked` state at all.
  const tidy = statusFor(countIn(input.items, 'tidy'))

  const allClear =
    input.items.length === 0 &&
    health.kind === 'clean' &&
    files.kind === 'clean' &&
    tidy.kind === 'clean'

  const inSyncCount =
    input.sync.kind === 'loaded'
      ? input.sync.rows.filter((row) => row.state === 'inSync').length
      : 0

  const lines: CareSummaryLine[] = [
    {
      group: 'health',
      messageKey: `${ALL_CLEAR_PREFIX}${validated ? 'health' : 'healthNotChecked'}`,
      params: validated
        ? {
            engines: input.validation.byEngine.map((entry) => engineLabel(entry.engine)).join(', '),
            count: input.validation.byEngine.length,
          }
        : {},
    },
    {
      group: 'files',
      messageKey: `${ALL_CLEAR_PREFIX}${input.sync.kind === 'loaded' ? 'files' : 'filesNotChecked'}`,
      params: input.sync.kind === 'loaded' ? { count: inSyncCount } : {},
    },
    { group: 'tidy', messageKey: `${ALL_CLEAR_PREFIX}tidy`, params: {} },
  ]

  return { health, files, tidy, allClear, lines }
}
