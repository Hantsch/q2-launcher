import { describe, expect, it } from 'vitest'
import type { Finding } from '@shared/config/validation'
import { buildCareItems, type CareItem } from './care-items'
import type { CareSyncRow } from './care-sync'
import { careSummary, dedupedFindingCounts, type CareSyncStatus } from './care-summary'
import type { TidyUpFinding } from './tidy-up-findings'
import type { ProfileValidation } from './validation-scope'

/**
 * Story 025 D8's acceptance for `dedupedFindingCounts` (the tab badge) is
 * unchanged by story 058 - AC 8 keeps the badge and its dedup rules exactly as
 * they are - so those cases are carried over verbatim, including review finding
 * F1 (an id shared across the report and the tidy-up list must still collide
 * when the two ran at different engines).
 *
 * `careSummary` is rewritten (058 D1): the cleanup branch is gone with the
 * cleanup itself (decision 4), and `allClear` is now "zero items AND every
 * source answered". F2 (an unvalidated profile is never a clean report) and F3
 * (a loading or errored sync fetch is never a clean files group, and the
 * summary still answers for everything else) are re-pinned against the new
 * shape, because those are precisely the two regressions this rewrite could
 * bring back.
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
  const healthyValidation = validation([
    { engine: 'r1q2', findings: [], summary: { errors: 0, warnings: 0, infos: 0 } },
  ])
  const healthySync = loadedSync([syncRow(), syncRow({ target: 'inst-1', path: 'C:/a/p.cfg' })])

  /** The whole model at once, the way `CareTab` calls it - the summary is a
   * rollup over the very list the tab renders, so a test that built the items
   * differently from the tab would be pinning nothing. */
  function summaryFor(
    overrides: {
      validation?: ProfileValidation
      sync?: CareSyncStatus
      tidyUp?: TidyUpFinding[]
      items?: CareItem[]
    } = {},
  ) {
    const validationInput = overrides.validation ?? healthyValidation
    const sync = overrides.sync ?? healthySync
    const items =
      overrides.items ??
      buildCareItems({
        validation: validationInput,
        syncRows: sync.kind === 'loaded' ? sync.rows : [],
        tidyUp: overrides.tidyUp ?? [],
      })
    return careSummary({ items, validation: validationInput, sync })
  }

  it('a healthy profile is all clear, with one summary line per checked thing', () => {
    const result = summaryFor()

    expect(result).toMatchObject({
      health: { kind: 'clean' },
      files: { kind: 'clean' },
      tidy: { kind: 'clean' },
      allClear: true,
    })
    expect(result.lines).toEqual([
      {
        group: 'health',
        messageKey: 'config.care.allClear.health',
        params: { engines: 'R1Q2', count: 1 },
      },
      { group: 'files', messageKey: 'config.care.allClear.files', params: { count: 2 } },
      { group: 'tidy', messageKey: 'config.care.allClear.tidy', params: {} },
    ])
  })

  it('F2: an unassigned profile (nothing validated against) reads health as notChecked, never clean, and is never all clear', () => {
    const result = summaryFor({ validation: validation([], 'unassigned') })

    expect(result.health).toEqual({ kind: 'notChecked' })
    expect(result.files).toEqual({ kind: 'clean' })
    expect(result.tidy).toEqual({ kind: 'clean' })
    expect(result.allClear).toBe(false)
    expect(result.lines[0]).toEqual({
      group: 'health',
      messageKey: 'config.care.allClear.healthNotChecked',
      params: {},
    })
  })

  it('F2: an assigned-but-unresolved profile also reads health as notChecked', () => {
    const result = summaryFor({ validation: validation([], 'unresolved') })

    expect(result.health).toEqual({ kind: 'notChecked' })
    expect(result.allClear).toBe(false)
  })

  it('F3: a sync fetch that is still loading is never clean, never all clear, and the summary still answers for every other group', () => {
    const result = summaryFor({ sync: { kind: 'loading' } })

    expect(result.files).toEqual({ kind: 'notChecked' })
    expect(result.health).toEqual({ kind: 'clean' })
    expect(result.tidy).toEqual({ kind: 'clean' })
    expect(result.allClear).toBe(false)
    expect(result.lines[1]).toEqual({
      group: 'files',
      messageKey: 'config.care.allClear.filesNotChecked',
      params: {},
    })
  })

  it('F3: a sync fetch that errored is not evidence of cleanliness either', () => {
    const result = summaryFor({ sync: { kind: 'error' } })

    expect(result.files).toEqual({ kind: 'notChecked' })
    expect(result.allClear).toBe(false)
  })

  it('an out-of-sync row keeps the rollup not-all-clear and counts in the files group', () => {
    const result = summaryFor({
      sync: loadedSync([syncRow(), syncRow({ target: 'inst-1', path: 'C:/a/p.cfg', state: 'outOfSync' })]),
    })

    expect(result.files).toEqual({ kind: 'items', count: 1 })
    expect(result.allClear).toBe(false)
    // The in-sync rows are still counted for the line the All clear block prints.
    expect(result.lines[1]!.params).toEqual({ count: 1 })
  })

  it('a pending sync row (a running installation deferring the write) is not clean either', () => {
    const result = summaryFor({
      sync: loadedSync([syncRow({ target: 'inst-1', path: 'C:/a/p.cfg', state: 'pending' })]),
    })

    expect(result.files).toEqual({ kind: 'items', count: 1 })
    expect(result.allClear).toBe(false)
  })

  it('a tidy-up finding keeps the rollup not-all-clear', () => {
    const result = summaryFor({ tidyUp: [tidyUpFinding()] })

    expect(result.tidy).toEqual({ kind: 'items', count: 1 })
    expect(result.health).toEqual({ kind: 'clean' })
    expect(result.allClear).toBe(false)
  })

  it('a finding both lists report is one item, so it inflates neither group twice', () => {
    const shared = finding()
    const result = summaryFor({
      validation: validation([
        { engine: 'r1q2', findings: [shared], summary: { errors: 0, warnings: 1, infos: 0 } },
      ]),
      tidyUp: [tidyUpFinding({ sourceFindingId: shared.id })],
    })

    expect(result.health).toEqual({ kind: 'clean' })
    expect(result.tidy).toEqual({ kind: 'items', count: 1 })
    expect(result.allClear).toBe(false)
  })

  it('names every validated engine in the health line', () => {
    const result = summaryFor({
      validation: validation([
        { engine: 'r1q2', findings: [], summary: { errors: 0, warnings: 0, infos: 0 } },
        { engine: 'q2pro', findings: [], summary: { errors: 0, warnings: 0, infos: 0 } },
      ]),
    })

    expect(result.lines[0]!.params).toEqual({ engines: 'R1Q2, Q2PRO', count: 2 })
    expect(result.allClear).toBe(true)
  })
})
