import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import { buildMoveTargets, swapEntries } from './entry-order'
import { groupControlsRowEntries } from './controls-row-groups'
import type { ControlsRowEntry } from './controls-row-entries'

function action(id: string, categoryId: string, catalogId?: string): ConfigAction {
  return { id, categoryId, name: id, kind: 'bind', commands: [], ...(catalogId ? { catalogId } : {}) }
}

/** A plain (non-catalogue) row entry - grouping reads `action.catalogId` for these, so a
 * `catalogId` given here still lands the row in that catalogue group. */
function entry(action: ConfigAction): ControlsRowEntry {
  return { kind: 'action', action }
}

describe('swapEntries', () => {
  it('swaps the two named entries, wherever they sit in the array', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1'), action('a3', 'c1')]

    expect(swapEntries(actions, 'a2', 'a1').map((a) => a.id)).toEqual(['a2', 'a1', 'a3'])
    expect(swapEntries(actions, 'a2', 'a3').map((a) => a.id)).toEqual(['a1', 'a3', 'a2'])
  })

  it('leaves every entry between the two exactly where it was', () => {
    // Story 052 review (finding 4): the two swapped rows share a catalogue group, the entries
    // between them do not - they must not shift, in the array or on screen.
    const actions = [action('a1', 'c1'), action('b1', 'c2'), action('a2', 'c1')]

    const result = swapEntries(actions, 'a2', 'a1')

    expect(result.map((a) => a.id)).toEqual(['a2', 'b1', 'a1'])
    expect(result[1]).toBe(actions[1])
  })

  it('is a no-op when either id is missing, or both name the same entry', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1')]

    expect(swapEntries(actions, 'missing', 'a1')).toBe(actions)
    expect(swapEntries(actions, 'a1', 'missing')).toBe(actions)
    expect(swapEntries(actions, 'a1', 'a1')).toBe(actions)
  })

  it('returns a new array instance without mutating the input', () => {
    const actions = [action('a1', 'c1'), action('a2', 'c1')]
    const original = [...actions]

    const result = swapEntries(actions, 'a1', 'a2')

    expect(actions).toEqual(original)
    expect(result).not.toBe(actions)
  })
})

describe('buildMoveTargets', () => {
  it('names the previous/next row of the same group, and nothing at either end', () => {
    const groups = groupControlsRowEntries([
      entry(action('a1', 'weapons', 'weaponUse:blaster')),
      entry(action('a2', 'weapons', 'weaponUse:shotgun')),
      entry(action('a3', 'weapons', 'weaponUse:railgun')),
    ])

    const targets = buildMoveTargets(groups)

    expect(targets.get('a1')).toEqual({ up: undefined, down: 'a2' })
    expect(targets.get('a2')).toEqual({ up: 'a1', down: 'a3' })
    expect(targets.get('a3')).toEqual({ up: 'a2', down: undefined })
  })

  it('never names a row of another catalogue group across a group boundary', () => {
    // The bug this exists to prevent: "Use weapon" ends and "Cycling" begins, so the last
    // `weaponUse` row's move-down used to swap with the first `weaponExtra` row - a real mutation
    // with no visible effect, because each row stayed inside its own group's contiguous run.
    const groups = groupControlsRowEntries([
      entry(action('a1', 'weapons', 'weaponUse:blaster')),
      entry(action('a2', 'weapons', 'weaponUse:shotgun')),
      entry(action('b1', 'weapons', 'weaponExtra:next')),
      entry(action('b2', 'weapons', 'weaponExtra:prev')),
    ])

    const targets = buildMoveTargets(groups)

    expect(targets.get('a2')?.down).toBeUndefined()
    expect(targets.get('b1')?.up).toBeUndefined()
    expect(targets.get('b1')?.down).toBe('b2')
  })

  it('pairs rows of one group across an interleaved row of another', () => {
    // Grouping keeps each group's entries in array order but not contiguous in the array itself,
    // so a group's neighbour can sit two array positions away - the swap is still visible, because
    // both rows render inside the same group.
    const groups = groupControlsRowEntries([
      entry(action('a1', 'weapons', 'weaponUse:blaster')),
      entry(action('b1', 'weapons', 'weaponExtra:next')),
      entry(action('a2', 'weapons', 'weaponUse:shotgun')),
    ])

    const targets = buildMoveTargets(groups)

    expect(targets.get('a2')?.up).toBe('a1')
    expect(targets.get('b1')).toEqual({ up: undefined, down: undefined })
  })

  it('treats every ungrouped row as one run', () => {
    // Free-form entries (no `catalogId`) and movement rows (a catalogue prefix with no subgroup)
    // all collapse into the single `labelKey: null` bucket, so they move against each other.
    const groups = groupControlsRowEntries([
      entry(action('m1', 'movement', 'movement:forward')),
      entry(action('f1', 'movement')),
    ])

    const targets = buildMoveTargets(groups)

    expect(targets.get('m1')?.down).toBe('f1')
    expect(targets.get('f1')?.up).toBe('m1')
  })

  it('gives a row that is alone in its group no target on either side', () => {
    const groups = groupControlsRowEntries([entry(action('a1', 'weapons', 'weaponUse:blaster'))])

    expect(buildMoveTargets(groups).get('a1')).toEqual({ up: undefined, down: undefined })
  })
})
