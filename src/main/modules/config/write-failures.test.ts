import { describe, expect, it } from 'vitest'
import { mergeWriteFailureChanges } from './write-failures'

const f = (messageKey: string) => ({ messageKey, at: '2026-01-01T00:00:00.000Z' })

describe('mergeWriteFailureChanges', () => {
  it('a key added by an overlapping run is kept', () => {
    const live = { 'a|1': f('x') }
    const merged = mergeWriteFailureChanges(live, {}, { 'b|2': f('y') })
    expect(merged).toEqual({ 'a|1': f('x'), 'b|2': f('y') })
  })

  it('a key this run cleared is removed from the live failures', () => {
    const merged = mergeWriteFailureChanges({ 'a|1': f('x'), 'b|2': f('y') }, { 'a|1': f('x') }, {})
    expect(merged).toEqual({ 'b|2': f('y') })
  })

  it('a changed value overwrites the live one', () => {
    const merged = mergeWriteFailureChanges({ k: f('old') }, { k: f('old') }, { k: f('new') })
    expect(merged).toEqual({ k: f('new') })
  })

  it('returns the live object itself when nothing changed', () => {
    const live = { k: f('x') }
    expect(mergeWriteFailureChanges(live, { k: f('x') }, { k: f('x') })).toBe(live)
  })
})
