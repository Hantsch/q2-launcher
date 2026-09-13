import { describe, expect, it } from 'vitest'
import { readEngineState, writeEngineState } from './installation-state'

/**
 * Story 092 D2: `readEngineState`/`writeEngineState` - the defensive parser/merger
 * `InstallationsService.setEngineState` (`main/services/installations.ts`) is built on. Pure
 * functions over `Installation.moduleData`, no `StateStore` needed.
 */

describe('readEngineState', () => {
  it('answers "unknown" (an empty object) for an absent moduleData', () => {
    expect(readEngineState(undefined)).toEqual({})
  })

  it('answers "unknown" for a moduleData with no downloads key', () => {
    expect(readEngineState({ someOtherModule: { foo: 'bar' } })).toEqual({})
  })

  it('round-trips a previously written state', () => {
    const moduleData = writeEngineState(undefined, {
      version: '2.34',
      packageId: 'q2pro-win64',
      bleedingEdge: true,
      backup: { version: '2.33', packageId: 'q2pro-win64', createdAt: 1000 },
    })

    expect(readEngineState(moduleData)).toEqual({
      version: '2.34',
      packageId: 'q2pro-win64',
      bleedingEdge: true,
      backup: { version: '2.33', packageId: 'q2pro-win64', createdAt: 1000 },
    })
  })

  it('parses garbage moduleData back to "unknown" rather than throwing', () => {
    expect(() =>
      readEngineState({ downloads: { version: 42, bleedingEdge: 'yes', backup: 'nope' } }),
    ).not.toThrow()

    // Every field individually degrades to absent - a wrong-typed value costs only that field.
    expect(readEngineState({ downloads: { version: 42, bleedingEdge: 'yes', backup: 'nope' } })).toEqual(
      {},
    )
  })

  it('parses a non-object downloads value back to "unknown" rather than throwing', () => {
    expect(() => readEngineState({ downloads: 'not an object' })).not.toThrow()
    expect(readEngineState({ downloads: 'not an object' })).toEqual({})
  })

  it('drops a backup missing its required fields, keeping the rest of the state', () => {
    const state = readEngineState({
      downloads: { version: '2.34', backup: { packageId: 'q2pro-win64' } },
    })
    expect(state).toEqual({ version: '2.34' })
  })
})

describe('writeEngineState', () => {
  it('preserves other moduleData keys untouched', () => {
    const moduleData = writeEngineState({ otherModule: { keep: true } }, { version: '2.34' })
    expect(moduleData).toEqual({
      otherModule: { keep: true },
      downloads: { version: '2.34' },
    })
  })

  it('shallow-merges a patch over the existing recorded state', () => {
    const first = writeEngineState(undefined, { version: '2.34', packageId: 'q2pro-win64' })
    const second = writeEngineState(first, { bleedingEdge: true })

    expect(readEngineState(second)).toEqual({
      version: '2.34',
      packageId: 'q2pro-win64',
      bleedingEdge: true,
    })
  })
})
