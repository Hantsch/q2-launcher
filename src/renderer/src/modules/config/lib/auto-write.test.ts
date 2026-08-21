import { describe, expect, it } from 'vitest'
import { shouldTriggerAutoWrite } from './auto-write'

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-01-01T00:05:00.000Z'

describe('shouldTriggerAutoWrite', () => {
  it('does not write on the first sighting of a profile id (a selection, not a save)', () => {
    expect(shouldTriggerAutoWrite(undefined, T1)).toBe(false)
  })

  it('does not write when `updatedAt` is unchanged since the last sighting', () => {
    expect(shouldTriggerAutoWrite(T1, T1)).toBe(false)
  })

  it('writes when `updatedAt` has been bumped since the last sighting (a real save)', () => {
    expect(shouldTriggerAutoWrite(T1, T2)).toBe(true)
  })

  it('does not write on switching away to another profile and back without an edit', () => {
    // The `Map` the hook holds, simulated: an entry is written on every sighting
    // and NEVER reset per id, which is precisely what makes the return trip
    // silent. A map that were cleared on a profile switch would see profile A
    // as a first sighting again - harmless - but one that were cleared only of
    // the *outgoing* id would make A's return look like a save and write into
    // every assigned installation for nothing.
    const seen = new Map<string, string>()
    const visit = (id: string, updatedAt: string): boolean => {
      const previous = seen.get(id)
      seen.set(id, updatedAt)
      return shouldTriggerAutoWrite(previous, updatedAt)
    }

    expect(visit('a', T1)).toBe(false) // open A
    expect(visit('b', T1)).toBe(false) // switch to B - its own first sighting
    expect(visit('a', T1)).toBe(false) // back to A, untouched in the meantime
  })

  it('writes exactly once per save across a sequence of sightings', () => {
    // Guards the other half of the story-023 regression: tab-independent must
    // not mean "writes twice". Re-renders re-run the rule with an unchanged
    // `updatedAt`; only the render in which it actually moved is a write.
    const seen = new Map<string, string>()
    const visit = (id: string, updatedAt: string): boolean => {
      const previous = seen.get(id)
      seen.set(id, updatedAt)
      return shouldTriggerAutoWrite(previous, updatedAt)
    }

    const verdicts = [
      visit('a', T1), // open
      visit('a', T1), // incidental re-render
      visit('a', T2), // the save
      visit('a', T2), // the re-render the save caused
    ]

    expect(verdicts).toEqual([false, false, true, false])
  })
})
