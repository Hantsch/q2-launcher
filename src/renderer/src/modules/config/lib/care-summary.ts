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
 * 2. `careSummary` — the Care-level "all clear vs. not checked" rollup (AC 7,
 *    decision 17/18). Each section answers `clean`, `{ items: n }`, or
 *    `notChecked` - reachable by the cleanup section (needs a user-run scan),
 *    the report section (nothing was actually validated against, i.e.
 *    `validation.status !== 'ok'` - `ValidationPanel` already renders this as
 *    its own explicit empty state, so the summary must not call the same
 *    state "clean") and the sync section (still loading, or its fetch
 *    errored - neither is evidence of cleanliness). The overall line is
 *    `allClear` only when every section is clean AND the cleanup has actually
 *    been scanned this session — an unscanned cleanup, an unvalidated report
 *    or an unresolved/errored sync fetch can never contribute a false "nothing
 *    to report".
 *
 * Both functions are pure: no DOM, no hooks, no IPC. `CareTab.tsx` calls them
 * with data it either already holds (`validation`, a freshly-computed
 * `analyzeTidyUp(profile)`) or has been handed via a callback prop from a
 * section that owns its own fetch (`CareSyncSection`'s sync rows,
 * `CleanupPanel`'s scan status) — this module never reaches into IPC itself,
 * same discipline as `validation-scope.ts`.
 */

import type { Finding } from '@shared/config/validation'
import type { CareSyncRow } from './care-sync'
import type { TidyUpFinding } from './tidy-up-findings'
import { totalCounts, type ProfileValidation } from './validation-scope'

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
 */
function dedupKey(id: string): string {
  return ACTIONS_FINDING_ID.test(id) ? id.slice(id.indexOf(':') + 1) : id
}

/**
 * The tab badge's own counts (`ConfigView.tsx`): every distinct finding id
 * across the validation report and the tidy-up list, counted once each.
 * Mirrors `validation-scope.ts`'s `totalCounts` in shape - `{ errors,
 * warnings }` - but sourced from two lists instead of one, with the
 * cross-list id collision resolved rather than summed.
 *
 * `info`-level validation findings are excluded, same as `totalCounts` and
 * the badge's own existing tone logic - neither has ever counted infos.
 */
export function dedupedFindingCounts(
  validation: ProfileValidation,
  tidyUpFindings: TidyUpFinding[],
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

  let errors = 0
  let warnings = 0
  for (const level of levelById.values()) {
    if (level === 'error') errors++
    else warnings++
  }
  return { errors, warnings }
}

/** One section's state, for the Care-level summary. `'notChecked'` was
 * originally reachable only by the cleanup section (decision 17); F2/F3 of
 * story 025's review add two more reasons a section can answer `notChecked`
 * rather than `clean` with a coincidentally-zero count: the report section
 * when `validation.status !== 'ok'` (nothing was actually validated against),
 * and the sync section while its fetch is still loading or has errored
 * (neither is evidence of cleanliness - same treatment as an unscanned
 * cleanup). */
export type SectionStatus =
  | { readonly kind: 'clean' }
  | { readonly kind: 'items'; readonly count: number }
  | { readonly kind: 'notChecked' }

function statusFor(count: number): SectionStatus {
  return count === 0 ? { kind: 'clean' } : { kind: 'items', count }
}

/** What `CleanupPanel` reports out via its `onStatusChange` callback prop -
 * `scanned` false whenever there is no successful scan result for the
 * currently selected installation this session (including right after a
 * reset: an installation change, or a completed apply per decision 14). */
export interface CareCleanupStatus {
  scanned: boolean
  itemCount: number
}

/**
 * What `CareSyncSection` reports out via its `onStatusChange` callback prop
 * (story 025 review finding F3) - distinguishes "still loading" and "the
 * fetch failed" from "loaded, here are the rows", so the Care summary can
 * answer something for sync instead of never rendering while the fetch is in
 * flight or silently omitting the section when it fails.
 */
export type CareSyncStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly rows: CareSyncRow[] }
  | { readonly kind: 'error' }

export interface CareSummaryInput {
  validation: ProfileValidation
  tidyUpFindings: TidyUpFinding[]
  /** `CareSyncSection`'s status, lifted up via its `onStatusChange` callback -
   * never computed here from IPC. */
  sync: CareSyncStatus
  cleanup: CareCleanupStatus
}

export interface CareSummary {
  report: SectionStatus
  sync: SectionStatus
  tidyUp: SectionStatus
  cleanup: SectionStatus
  /** True only when every section above is `clean` - an unscanned cleanup
   * (`notChecked`) or any section with items forces this false. */
  allClear: boolean
}

/**
 * The Care tab's top-of-tab summary (AC 7). Each section's own count is left
 * un-deduplicated on purpose - "the report has 2 findings" and "tidy-up has 3
 * items" describe what each section itself would show if opened, which is not
 * the same question the tab badge's deduplicated count answers.
 *
 * The report section only reads its counts when `validation.status === 'ok'`
 * - anything else means there was nothing to validate against at all, and a
 * trivially-zero count in that state must read as `notChecked`, never
 * `clean` (F2: `ValidationPanel` already renders an explicit "nothing to
 * validate against" empty state for this, and the summary must not
 * contradict it). Likewise the sync section only reads its rows when
 * `input.sync.kind === 'loaded'` - still loading or errored both read as
 * `notChecked` rather than guessing (F3).
 */
export function careSummary(input: CareSummaryInput): CareSummary {
  const reportCounts = totalCounts(input.validation)
  const report: SectionStatus =
    input.validation.status === 'ok'
      ? statusFor(reportCounts.errors + reportCounts.warnings)
      : { kind: 'notChecked' }
  const tidyUp = statusFor(input.tidyUpFindings.length)
  const sync: SectionStatus =
    input.sync.kind === 'loaded'
      ? statusFor(input.sync.rows.filter((row) => row.state !== 'inSync').length)
      : { kind: 'notChecked' }
  const cleanup: SectionStatus = input.cleanup.scanned
    ? statusFor(input.cleanup.itemCount)
    : { kind: 'notChecked' }

  const allClear =
    report.kind === 'clean' &&
    tidyUp.kind === 'clean' &&
    sync.kind === 'clean' &&
    cleanup.kind === 'clean'

  return { report, sync, tidyUp, cleanup, allClear }
}
