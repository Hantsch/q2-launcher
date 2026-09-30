import { describe, expect, it } from 'vitest'
import {
  addTemplate,
  effectiveNameTemplates,
  mergeWithShipped,
  nameTemplatesFingerprint,
  needsNameFactsRederive,
  reorderTemplates,
  removeTemplate,
  resetTemplate,
  restoreShipped,
  toView,
  updateTemplate,
  type NameTemplatesState,
} from './name-templates'

const SHIPPED = [
  { id: 'a', template: '{map}_{date}' },
  { id: 'b', template: '{pov}-{map}' },
]

let nextId = 0
function newId(): string {
  nextId += 1
  return `user-${nextId}`
}

describe('name-templates (story 140 D1)', () => {
  it("an unedited shipped entry follows a release's changed text", () => {
    const state: NameTemplatesState = {
      entries: [{ id: 'a', kind: 'shipped', shippedId: 'a', template: null }],
      removedShippedIds: [],
    }
    const changedShipped = [{ id: 'a', template: '{map}_{time}' }]
    const view = toView(state, changedShipped)
    expect(view.entries[0].template).toBe('{map}_{time}')
    expect(view.entries[0].edited).toBe(false)
  })

  it('a shipped pattern new in a release is appended at the end', () => {
    const state: NameTemplatesState = {
      entries: [{ id: 'a', kind: 'shipped', shippedId: 'a', template: null }],
      removedShippedIds: [],
    }
    const merged = mergeWithShipped(state, SHIPPED)
    expect(merged.entries.map((e) => e.id)).toEqual(['a', 'b'])
    expect(merged.entries[1]).toEqual({ id: 'b', kind: 'shipped', shippedId: 'b', template: null })
  })

  it('a vanished shipped entry is dropped if unedited and kept as custom if edited', () => {
    const state: NameTemplatesState = {
      entries: [
        { id: 'a', kind: 'shipped', shippedId: 'a', template: null },
        { id: 'b', kind: 'shipped', shippedId: 'b', template: '{pov}_{map}_custom' },
      ],
      removedShippedIds: [],
    }
    const shippedWithoutAB = [{ id: 'c', template: '{map}' }]
    const merged = mergeWithShipped(state, shippedWithoutAB)
    expect(merged.entries.find((e) => e.id === 'a')).toBeUndefined()
    expect(merged.entries.find((e) => e.id === 'b')).toEqual({
      id: 'b',
      kind: 'user',
      template: '{pov}_{map}_custom',
    })
  })

  it('a removed shipped entry stays removed until restored', () => {
    const state: NameTemplatesState = {
      entries: [{ id: 'a', kind: 'shipped', shippedId: 'a', template: null }],
      removedShippedIds: [],
    }
    const removed = removeTemplate(state, 'a', SHIPPED)
    expect(removed.removedShippedIds).toEqual(['a'])
    const merged = mergeWithShipped(removed, SHIPPED)
    expect(merged.entries.find((e) => e.id === 'a')).toBeUndefined()
    expect(toView(merged, SHIPPED).canRestore).toBe(true)

    const restored = restoreShipped(merged)
    expect(restored.removedShippedIds).toEqual([])
    const mergedAgain = mergeWithShipped(restored, SHIPPED)
    expect(mergedAgain.entries.some((e) => e.id === 'a')).toBe(true)
  })

  it('editing a shipped entry back to its built-in text stores no override', () => {
    const state: NameTemplatesState = {
      entries: [{ id: 'a', kind: 'shipped', shippedId: 'a', template: null }],
      removedShippedIds: [],
    }
    const edited = updateTemplate(state, 'a', '{map}_custom', SHIPPED)
    expect(edited.entries[0]).toEqual({ id: 'a', kind: 'shipped', shippedId: 'a', template: '{map}_custom' })

    const revertedBack = updateTemplate(edited, 'a', '{map}_{date}', SHIPPED)
    expect(revertedBack.entries[0]).toEqual({ id: 'a', kind: 'shipped', shippedId: 'a', template: null })
  })

  it('reorder rejects a non-permutation', () => {
    const state: NameTemplatesState = {
      entries: [
        { id: 'a', kind: 'shipped', shippedId: 'a', template: null },
        { id: 'b', kind: 'shipped', shippedId: 'b', template: null },
      ],
      removedShippedIds: [],
    }
    expect(() => reorderTemplates(state, ['a'])).toThrow()
    expect(() => reorderTemplates(state, ['a', 'b', 'c'])).toThrow()
    expect(() => reorderTemplates(state, ['a', 'a'])).toThrow()

    const reordered = reorderTemplates(state, ['b', 'a'])
    expect(reordered.entries.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('effective templates follow list order top to bottom', () => {
    let state: NameTemplatesState = { entries: [], removedShippedIds: [] }
    state = mergeWithShipped(state, SHIPPED)
    state = addTemplate(state, '{host}_{map}', newId)
    expect(effectiveNameTemplates(state, SHIPPED)).toEqual(['{map}_{date}', '{pov}-{map}', '{host}_{map}'])
  })

  it('the fingerprint changes on add, edit, remove, reorder and reset, and not otherwise', () => {
    let state: NameTemplatesState = mergeWithShipped({ entries: [], removedShippedIds: [] }, SHIPPED)
    const fp0 = nameTemplatesFingerprint(effectiveNameTemplates(state, SHIPPED))

    // Not otherwise: recomputing without any change yields the same fingerprint.
    expect(nameTemplatesFingerprint(effectiveNameTemplates(state, SHIPPED))).toBe(fp0)

    state = addTemplate(state, '{host}_{map}', newId)
    const fp1 = nameTemplatesFingerprint(effectiveNameTemplates(state, SHIPPED))
    expect(fp1).not.toBe(fp0)

    const addedId = state.entries[state.entries.length - 1].id
    state = updateTemplate(state, addedId, '{host}-{map}', SHIPPED)
    const fp2 = nameTemplatesFingerprint(effectiveNameTemplates(state, SHIPPED))
    expect(fp2).not.toBe(fp1)

    state = updateTemplate(state, 'a', '{map}_custom', SHIPPED)
    const fp3 = nameTemplatesFingerprint(effectiveNameTemplates(state, SHIPPED))
    expect(fp3).not.toBe(fp2)

    state = resetTemplate(state, 'a')
    const fp4 = nameTemplatesFingerprint(effectiveNameTemplates(state, SHIPPED))
    expect(fp4).not.toBe(fp3)

    state = reorderTemplates(state, [...state.entries.map((e) => e.id)].reverse())
    const fp5 = nameTemplatesFingerprint(effectiveNameTemplates(state, SHIPPED))
    expect(fp5).not.toBe(fp4)

    state = removeTemplate(state, addedId, SHIPPED)
    const fp6 = nameTemplatesFingerprint(effectiveNameTemplates(state, SHIPPED))
    expect(fp6).not.toBe(fp5)
  })

  it('needsNameFactsRederive is true for a missing or different fingerprint', () => {
    expect(needsNameFactsRederive(undefined, 'abc')).toBe(true)
    expect(needsNameFactsRederive('abc', 'def')).toBe(true)
    expect(needsNameFactsRederive('abc', 'abc')).toBe(false)
  })
})
