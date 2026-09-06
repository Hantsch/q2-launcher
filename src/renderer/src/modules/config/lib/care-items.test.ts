import { describe, expect, it } from 'vitest'
import type { Finding } from '@shared/config/validation'
import { buildCareItems, itemsInGroup, type CareItem } from './care-items'
import type { CareSyncRow } from './care-sync'
import type { TidyUpFinding } from './tidy-up-findings'
import type { ProfileValidation } from './validation-scope'

/**
 * Story 058 D1's acceptance. The load-bearing cases are the ones story 025's
 * review already had to fix once and this story rewrites around: a profile with
 * nothing assigned must produce no items at all (its "nothing to validate
 * against" is a third state, neither an item nor all-clear - decision 3), and a
 * finding both the validator and the tidy-up analyzer report must become
 * exactly one row, not one per list.
 */

function validation(
  byEngine: ProfileValidation['byEngine'],
  status: ProfileValidation['status'] = 'ok',
): ProfileValidation {
  return { status, byEngine, omitted: [] }
}

function engineRun(findings: Finding[], engine: ProfileValidation['byEngine'][number]['engine'] = 'r1q2') {
  return {
    engine,
    findings,
    summary: {
      errors: findings.filter((f) => f.level === 'error').length,
      warnings: findings.filter((f) => f.level === 'warning').length,
      infos: findings.filter((f) => f.level === 'info').length,
    },
  }
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'r1q2:cvars:outOfRange:0',
    level: 'warning',
    engine: 'r1q2',
    messageKey: 'config.validation.cvars.outOfRange',
    subject: { kind: 'cvar', id: 'r_maxfps' },
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
    params: { name: 'unused' },
    ops: [],
    sourceFindingId: 'r1q2:actions:aliasUnreferenced:0',
    ...overrides,
  }
}

function syncRow(overrides: Partial<CareSyncRow> = {}): CareSyncRow {
  return { target: 'canonical', path: 'C:/profile.cfg', state: 'inSync', ...overrides }
}

function build(overrides: Partial<Parameters<typeof buildCareItems>[0]> = {}): CareItem[] {
  return buildCareItems({
    validation: validation([engineRun([])]),
    syncRows: [syncRow()],
    tidyUp: [],
    ...overrides,
  })
}

describe('buildCareItems', () => {
  it('yields nothing at all for a healthy profile - no group, no placeholder row', () => {
    expect(build()).toEqual([])
  })

  it('an unassigned profile produces no health item - "nothing to validate against" is not an item', () => {
    // `byEngine` is empty for an unassigned profile, but the status guard is what
    // this pins: a non-`ok` status may never turn into a row, and `careSummary`
    // separately refuses to call it clean.
    const items = build({
      validation: validation([engineRun([finding()])], 'unassigned'),
    })

    expect(items).toEqual([])
  })

  it('an unresolved profile produces no health item either', () => {
    const items = build({ validation: validation([engineRun([finding()])], 'unresolved') })

    expect(items).toEqual([])
  })

  it('turns each validation finding into one health item naming its engine', () => {
    const items = build({
      validation: validation([engineRun([finding({ params: { name: 'r_maxfps' } })])]),
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'health:r1q2:cvars:outOfRange:0',
      group: 'health',
      level: 'warning',
      titleKey: 'config.care.item.health.title.cvar',
      consequenceKey: 'config.validation.cvars.outOfRange',
      actions: [],
    })
    // The row names the engine it was raised against (decision 2), and keeps the
    // validator's own params for the consequence sentence.
    expect(items[0]!.params['subject']).toBe('r_maxfps')
    expect(items[0]!.params['engine']).toBe('R1Q2')
    expect(items[0]!.params['name']).toBe('r_maxfps')
  })

  it('skips info-level validation findings, same as the badge counts', () => {
    const items = build({
      validation: validation([engineRun([finding({ id: 'r1q2:structure:note:0', level: 'info' })])]),
    })

    expect(items).toEqual([])
  })

  it('a finding reported by both the validator and the tidy-up analyzer produces exactly one item - the actionable one', () => {
    const shared = finding({
      id: 'r1q2:actions:aliasUnreferenced:0',
      messageKey: 'config.validation.actions.aliasUnreferenced',
      subject: { kind: 'action', id: 'unused' },
    })

    const items = build({
      validation: validation([engineRun([shared])]),
      tidyUp: [tidyUpFinding({ sourceFindingId: shared.id })],
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.group).toBe('tidy')
  })

  it('dedups across the engine tag too - the tidy-up list always runs at r1q2, the report at whatever is assigned', () => {
    const shared = finding({
      id: 'q2pro:actions:aliasUnreferenced:0',
      engine: 'q2pro',
      messageKey: 'config.validation.actions.aliasUnreferenced',
      subject: { kind: 'action', id: 'unused' },
    })

    const items = build({
      validation: validation([engineRun([shared], 'q2pro')]),
      tidyUp: [tidyUpFinding({ sourceFindingId: 'r1q2:actions:aliasUnreferenced:0' })],
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.group).toBe('tidy')
  })

  it('keeps both rows when the ids are genuinely different findings', () => {
    const items = build({
      validation: validation([engineRun([finding()])]),
      tidyUp: [tidyUpFinding({ sourceFindingId: 'bindConflict:base:w', kind: 'shadowedBind' })],
    })

    expect(items.map((item) => item.group)).toEqual(['health', 'tidy'])
  })

  it('sorts errors before warnings within a group, keeping source order otherwise', () => {
    const items = build({
      validation: validation([
        engineRun([
          finding({ id: 'r1q2:cvars:a:0', level: 'warning' }),
          finding({ id: 'r1q2:cvars:b:1', level: 'error' }),
          finding({ id: 'r1q2:cvars:c:2', level: 'warning' }),
        ]),
      ]),
    })

    expect(items.map((item) => item.id)).toEqual([
      'health:r1q2:cvars:b:1',
      'health:r1q2:cvars:a:0',
      'health:r1q2:cvars:c:2',
    ])
  })

  it('groups health before files before tidy-up, even when a later group has the worse level', () => {
    const items = build({
      validation: validation([engineRun([finding({ level: 'warning' })])]),
      syncRows: [syncRow(), syncRow({ target: 'inst-1', path: 'C:/q2/baseq2/p.cfg', state: 'failed' })],
      tidyUp: [tidyUpFinding({ level: 'error' })],
    })

    expect(items.map((item) => item.group)).toEqual(['health', 'files', 'tidy'])
  })
})

describe('buildCareItems - files group', () => {
  it('lists only rows that need attention; in-sync rows never become items', () => {
    const items = itemsInGroup(
      build({
        syncRows: [
          syncRow(),
          syncRow({ target: 'inst-1', path: 'C:/a/p.cfg', state: 'inSync' }),
          syncRow({ target: 'inst-2', path: 'C:/b/p.cfg', state: 'missing' }),
        ],
      }),
      'files',
    )

    expect(items).toHaveLength(1)
    expect(items[0]!.params['target']).toBe('inst-2')
  })

  it('an unresolved sync fetch contributes no rows at all - the summary, not this list, is what refuses to call that clean', () => {
    expect(build({ syncRows: [] })).toEqual([])
  })

  it('a failed row is an error and keeps its retry, plus open and reveal on an installation row', () => {
    const [item] = itemsInGroup(
      build({ syncRows: [syncRow({ target: 'inst-1', path: 'C:/a/p.cfg', state: 'failed' })] }),
      'files',
    )

    expect(item!.level).toBe('error')
    expect(item!.actions.map((action) => action.kind)).toEqual(['retry', 'open', 'reveal'])
  })

  it('a missing row offers reveal but not open - there is no file to open', () => {
    const [item] = itemsInGroup(
      build({ syncRows: [syncRow({ target: 'inst-1', path: 'C:/a/p.cfg', state: 'missing' })] }),
      'files',
    )

    expect(item!.level).toBe('warning')
    expect(item!.actions.map((action) => action.kind)).toEqual(['reveal'])
  })

  it('a pending row is its own state, never folded into failed or out of sync', () => {
    const [item] = itemsInGroup(
      build({ syncRows: [syncRow({ target: 'inst-1', path: 'C:/a/p.cfg', state: 'pending' })] }),
      'files',
    )

    expect(item!.titleKey).toBe('config.care.sync.state.pending')
    expect(item!.consequenceKey).toBe('config.care.item.files.consequence.pending')
  })

  it('the canonical row changed outside the launcher offers Reload and Compare', () => {
    const [item] = itemsInGroup(
      build({ syncRows: [syncRow({ state: 'outOfSync' })], profileDirty: false }),
      'files',
    )

    expect(item!.titleKey).toBe('config.care.sync.canonical.externalEdit')
    expect(item!.actions.map((action) => action.kind)).toEqual(['reload', 'compare'])
  })

  it('the canonical row with unsaved edits of our own offers no action - Reload would throw them away', () => {
    const [item] = itemsInGroup(
      build({ syncRows: [syncRow({ state: 'outOfSync' })], profileDirty: true }),
      'files',
    )

    expect(item!.titleKey).toBe('config.care.sync.canonical.unsavedChanges')
    expect(item!.actions).toEqual([])
  })
})

describe('buildCareItems - tidy-up group', () => {
  it('a preserved line is one row with Drop and Re-classify, never two rows', () => {
    const [item] = itemsInGroup(
      build({
        tidyUp: [
          tidyUpFinding({
            id: 'preserved:autoexec.cfg:12:0',
            kind: 'preservedLine',
            messageKey: 'config.care.tidyUp.preservedLineCvar',
            params: { file: 'autoexec.cfg', line: 12, text: 'cl_run 1' },
            ops: [
              { kind: 'dropPreservedLine', file: 'autoexec.cfg', line: 12, text: 'cl_run 1' },
              {
                kind: 'reclassifyPreservedLine',
                file: 'autoexec.cfg',
                line: 12,
                text: 'cl_run 1',
                target: { field: 'cvars', name: 'cl_run', value: '1' },
              },
            ],
            sourceFindingId: 'preserved:autoexec.cfg:12',
          }),
        ],
      }),
      'tidy',
    )

    expect(item!.titleKey).toBe('config.care.item.tidy.title.preservedLine')
    expect(item!.consequenceKey).toBe('config.care.tidyUp.preservedLineCvar')
    expect(item!.actions.map((action) => action.kind)).toEqual(['drop', 'reclassify'])
    expect(item!.actions[0]!.ops).toHaveLength(1)
    expect(item!.actions[1]!.ops).toHaveLength(1)
  })

  it('a preserved line that cannot be re-classified offers Drop only', () => {
    const [item] = itemsInGroup(
      build({
        tidyUp: [
          tidyUpFinding({
            kind: 'preservedLine',
            ops: [{ kind: 'dropPreservedLine', file: 'autoexec.cfg', line: 3, text: 'say hi' }],
          }),
        ],
      }),
      'tidy',
    )

    expect(item!.actions.map((action) => action.kind)).toEqual(['drop'])
  })

  it('a fixable finding offers one Apply carrying all of its ops', () => {
    const [item] = itemsInGroup(
      build({
        tidyUp: [
          tidyUpFinding({
            kind: 'emptyLayer',
            mode: 'auto',
            params: { name: 'Alt' },
            ops: [{ kind: 'removeEmptyLayer', layerId: 'layer-1' }],
            sourceFindingId: 'layerEmpty:layer-1',
          }),
        ],
      }),
      'tidy',
    )

    expect(item!.actions.map((action) => action.kind)).toEqual(['apply'])
    expect(item!.actions[0]!.ops).toHaveLength(1)
  })

  it('a report-only finding offers no fix, only its alias deep link', () => {
    const [item] = itemsInGroup(
      build({
        tidyUp: [
          tidyUpFinding({
            kind: 'undefinedAlias',
            mode: 'report',
            messageKey: 'config.care.tidyUp.undefinedAlias',
            params: { action: 'Jump', alias: 'missing' },
            ops: [],
            sourceFindingId: 'r1q2:actions:undefinedAlias:0',
          }),
        ],
      }),
      'tidy',
    )

    expect(item!.actions.map((action) => action.kind)).toEqual(['showInAliases'])
  })

  it('a shadowed bind names a key, not an alias, so it gets no Show in Aliases', () => {
    const [item] = itemsInGroup(
      build({
        tidyUp: [
          tidyUpFinding({
            kind: 'shadowedBind',
            mode: 'auto',
            params: { key: 'w', owners: 'Forward, +forward', count: 2, winner: 'Forward' },
            ops: [],
            sourceFindingId: 'bindConflict:base:w',
          }),
        ],
      }),
      'tidy',
    )

    expect(item!.actions).toEqual([])
    expect(item!.titleKey).toBe('config.care.item.tidy.title.shadowedBind')
  })

  it('a shadowed bind that names a ConfigAction offers Show in Controls, gated independently of the alias link', () => {
    const [item] = itemsInGroup(
      build({
        tidyUp: [
          tidyUpFinding({
            kind: 'shadowedBind',
            mode: 'auto',
            params: { key: 'w', owners: 'Forward, +forward', count: 2, winner: 'Forward' },
            ops: [],
            sourceFindingId: 'bindConflict:base:w',
            actionId: 'a1',
          }),
        ],
      }),
      'tidy',
    )

    expect(item!.actions.map((action) => action.kind)).toEqual(['showInControls'])
    expect(item!.actionId).toBe('a1')
  })

  it('every action key is unique across the whole list - the row keys pending state by it', () => {
    const items = build({
      syncRows: [
        syncRow({ target: 'inst-1', path: 'C:/a/p.cfg', state: 'failed' }),
        syncRow({ target: 'inst-2', path: 'C:/b/p.cfg', state: 'failed' }),
      ],
      tidyUp: [
        tidyUpFinding({ id: 'a', sourceFindingId: 'x:1' }),
        tidyUpFinding({ id: 'b', sourceFindingId: 'x:2' }),
      ],
    })

    const keys = items.flatMap((item) => item.actions.map((action) => action.key))
    expect(new Set(keys).size).toBe(keys.length)
  })
})
