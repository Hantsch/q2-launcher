import { describe, expect, it } from 'vitest'
import type { Finding } from '@shared/config/validation'
import type { CareSyncRow } from './care-sync'
import { careSummary, dedupedFindingCounts, type CareSyncStatus } from './care-summary'
import type { TidyUpFinding } from './tidy-up-findings'
import type { ProfileValidation } from './validation-scope'

/**
 * Story 025 D8's acceptance: an unscanned cleanup must never yield "all
 * clear" even when every other section is clean, and a finding id shared by
 * the validation report and the tidy-up list must count once, not twice -
 * both pin the exact reason this module exists (the alias-wiring rules feed
 * both lists, and cleanup is the one section that needs a user action before
 * it can say anything at all).
 *
 * The review-fix cases below pin three more: F1 (an id shared across the
 * report and the tidy-up list must still collide when the tidy-up list's
 * fixed engine differs from the report's assigned engine - alias-wiring ids
 * carry no engine-specific facts, so the engine tag alone must not defeat the
 * dedup); F2 (an unvalidated profile - `validation.status !== 'ok'` - must
 * never read as a clean report just because there is nothing to count); F3
 * (a sync fetch that is still loading or has errored must never read as a
 * clean sync section, and the whole summary must still answer for every
 * other section regardless).
 */

function validation(
  byEngine: ProfileValidation['byEngine'],
  status: ProfileValidation['status'] = 'ok',
): ProfileValidation {
  return { status, byEngine, omitted: [] }
}

function loadedSync(rows: CareSyncRow[]): CareSyncStatus {
  return { kind: 'loaded', rows }
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'r1q2:actions:aliasUnreferenced:0',
    level: 'warning',
    engine: 'r1q2',
    messageKey: 'config.validation.actions.aliasUnreferenced',
    subject: { kind: 'action', id: 'unused' },
    ...overrides,
  }
}

function tidyUpFinding(overrides: Partial<TidyUpFinding> = {}): TidyUpFinding {
  return {
    id: 'unreferencedAlias:r1q2:actions:aliasUnreferenced:0',
    kind: 'unreferencedAlias',
    mode: 'review',
    level: 'warning',
    messageKey: 'config.care.tidyUp.unreferencedAlias',
    params: {},
    ops: [],
    sourceFindingId: 'r1q2:actions:aliasUnreferenced:0',
    ...overrides,
  }
}

function syncRow(overrides: Partial<CareSyncRow> = {}): CareSyncRow {
  return { target: 'canonical', path: 'C:/profile.cfg', state: 'inSync', ...overrides }
}

describe('dedupedFindingCounts', () => {
  it('counts a finding shared by the validator and the tidy-up analyzer once, not twice', () => {
    const shared = finding({ id: 'r1q2:actions:aliasUnreferenced:0', level: 'warning' })
    const sharedTidyUp = tidyUpFinding({ sourceFindingId: shared.id, level: 'warning' })

    const counts = dedupedFindingCounts(validation([{ engine: 'r1q2', findings: [shared], summary: { errors: 0, warnings: 1, infos: 0 } }]), [sharedTidyUp])

    expect(counts).toEqual({ errors: 0, warnings: 1 })
  })

  it('sums two distinct ids normally - a shadowed-bind finding has no validation-report counterpart', () => {
    const reportFinding = finding({ id: 'r1q2:cvars:outOfRange:0', level: 'error' })
    const shadowedBind = tidyUpFinding({
      kind: 'shadowedBind',
      level: 'warning',
      sourceFindingId: 'bindConflict:base:w',
      ops: [],
    })

    const counts = dedupedFindingCounts(
      validation([{ engine: 'r1q2', findings: [reportFinding], summary: { errors: 1, warnings: 0, infos: 0 } }]),
      [shadowedBind],
    )

    expect(counts).toEqual({ errors: 1, warnings: 1 })
  })

  it('F1: counts a finding once even when the tidy-up list ran at a different fixed engine than the report - alias-wiring ids carry no engine-specific facts', () => {
    // The report validated a q2pro-assigned profile; the tidy-up analyzer always runs
    // `validateActions` at its own fixed engine (r1q2, `TIDY_UP_ENGINE`), so the exact same
    // underlying alias problem mints two differently-engine-tagged ids.
    const reportSide = finding({ id: 'q2pro:actions:aliasUnreferenced:0', engine: 'q2pro', level: 'warning' })
    const tidyUpSide = tidyUpFinding({
      sourceFindingId: 'r1q2:actions:aliasUnreferenced:0',
      level: 'warning',
    })

    const counts = dedupedFindingCounts(
      validation([{ engine: 'q2pro', findings: [reportSide], summary: { errors: 0, warnings: 1, infos: 0 } }]),
      [tidyUpSide],
    )

    expect(counts).toEqual({ errors: 0, warnings: 1 })
  })

  it('F1: does not normalize ids that are not shaped like an alias-wiring finding, e.g. a minted shadowed-bind id', () => {
    // A tidy-up-only id like `bindConflict:...` never starts with `<engine>:actions:`, so it
    // must never collide with anything just because it happens to contain a colon.
    const reportFinding = finding({ id: 'r1q2:cvars:outOfRange:0', level: 'error' })
    const shadowedBind = tidyUpFinding({
      kind: 'shadowedBind',
      level: 'warning',
      sourceFindingId: 'bindConflict:base:w',
      ops: [],
    })

    const counts = dedupedFindingCounts(
      validation([{ engine: 'r1q2', findings: [reportFinding], summary: { errors: 1, warnings: 0, infos: 0 } }]),
      [shadowedBind],
    )

    expect(counts).toEqual({ errors: 1, warnings: 1 })
  })

  it('excludes info-level validation findings, same as totalCounts', () => {
    const info = finding({ id: 'r1q2:structure:note:0', level: 'info' })

    const counts = dedupedFindingCounts(
      validation([{ engine: 'r1q2', findings: [info], summary: { errors: 0, warnings: 0, infos: 1 } }]),
      [],
    )

    expect(counts).toEqual({ errors: 0, warnings: 0 })
  })

  it('is zero for an empty validation and an empty tidy-up list', () => {
    expect(dedupedFindingCounts(validation([]), [])).toEqual({ errors: 0, warnings: 0 })
  })
})

describe('careSummary', () => {
  const cleanInput = {
    validation: validation([{ engine: 'r1q2', findings: [], summary: { errors: 0, warnings: 0, infos: 0 } }]),
    tidyUpFindings: [] as TidyUpFinding[],
    sync: loadedSync([syncRow()]),
  }

  it('never reports allClear when the cleanup has not been scanned, even with every other section clean', () => {
    const result = careSummary({ ...cleanInput, cleanup: { scanned: false, itemCount: 0 } })

    expect(result.cleanup).toEqual({ kind: 'notChecked' })
    expect(result.allClear).toBe(false)
  })

  it('reports allClear once every section is clean and the cleanup has been scanned with nothing found', () => {
    const result = careSummary({ ...cleanInput, cleanup: { scanned: true, itemCount: 0 } })

    expect(result).toEqual({
      report: { kind: 'clean' },
      sync: { kind: 'clean' },
      tidyUp: { kind: 'clean' },
      cleanup: { kind: 'clean' },
      allClear: true,
    })
  })

  it('a scanned cleanup that found items keeps the overall rollup not-all-clear', () => {
    const result = careSummary({ ...cleanInput, cleanup: { scanned: true, itemCount: 3 } })

    expect(result.cleanup).toEqual({ kind: 'items', count: 3 })
    expect(result.allClear).toBe(false)
  })

  it('an out-of-sync row keeps the overall rollup not-all-clear even when nothing else has items', () => {
    const result = careSummary({
      ...cleanInput,
      sync: loadedSync([syncRow({ state: 'outOfSync' })]),
      cleanup: { scanned: true, itemCount: 0 },
    })

    expect(result.sync).toEqual({ kind: 'items', count: 1 })
    expect(result.allClear).toBe(false)
  })

  it('a pending sync row (a running installation deferring the write) is not "clean" either', () => {
    const result = careSummary({
      ...cleanInput,
      sync: loadedSync([syncRow({ state: 'pending' })]),
      cleanup: { scanned: true, itemCount: 0 },
    })

    expect(result.sync).toEqual({ kind: 'items', count: 1 })
    expect(result.allClear).toBe(false)
  })

  it('tidy-up findings that carry the same id as a report finding do not affect either section\'s own count - each counts what it would itself show', () => {
    const shared = finding({ id: 'r1q2:actions:aliasUnreferenced:0', level: 'warning' })
    const sharedTidyUp = tidyUpFinding({ sourceFindingId: shared.id })

    const result = careSummary({
      validation: validation([
        { engine: 'r1q2', findings: [shared], summary: { errors: 0, warnings: 1, infos: 0 } },
      ]),
      tidyUpFindings: [sharedTidyUp],
      sync: loadedSync([syncRow()]),
      cleanup: { scanned: true, itemCount: 0 },
    })

    expect(result.report).toEqual({ kind: 'items', count: 1 })
    expect(result.tidyUp).toEqual({ kind: 'items', count: 1 })
    expect(result.allClear).toBe(false)
  })

  it('F2: an unassigned profile (nothing validated against) reads the report as notChecked, never clean, even with tidy-up/sync/cleanup all clean', () => {
    const result = careSummary({
      ...cleanInput,
      validation: validation([], 'unassigned'),
      cleanup: { scanned: true, itemCount: 0 },
    })

    expect(result.report).toEqual({ kind: 'notChecked' })
    expect(result.allClear).toBe(false)
  })

  it('F2: an assigned-but-unresolved profile also reads the report as notChecked', () => {
    const result = careSummary({
      ...cleanInput,
      validation: validation([], 'unresolved'),
      cleanup: { scanned: true, itemCount: 0 },
    })

    expect(result.report).toEqual({ kind: 'notChecked' })
    expect(result.allClear).toBe(false)
  })

  it('F3: a sync fetch that is still loading reads the sync section as notChecked, never clean, and the summary still answers for every other section', () => {
    const result = careSummary({
      ...cleanInput,
      sync: { kind: 'loading' },
      cleanup: { scanned: true, itemCount: 0 },
    })

    expect(result.sync).toEqual({ kind: 'notChecked' })
    expect(result.report).toEqual({ kind: 'clean' })
    expect(result.tidyUp).toEqual({ kind: 'clean' })
    expect(result.cleanup).toEqual({ kind: 'clean' })
    expect(result.allClear).toBe(false)
  })

  it('F3: a sync fetch that errored reads the sync section as notChecked too - an error is not evidence of cleanliness', () => {
    const result = careSummary({
      ...cleanInput,
      sync: { kind: 'error' },
      cleanup: { scanned: true, itemCount: 0 },
    })

    expect(result.sync).toEqual({ kind: 'notChecked' })
    expect(result.allClear).toBe(false)
  })
})
