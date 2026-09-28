import { describe, expect, it } from 'vitest'
import { sidecarFieldsSchema } from './sidecar'
import {
  addPlayer,
  addSide,
  draftFromSidecar,
  draftToFields,
  isDraftDirty,
  movePlayer,
  removePlayer,
  removeSide,
  suggestTags,
  withQuickEdit,
  type SidecarDraft
} from './sidecar-draft'

const fullFields = {
  name: 'Grand final',
  description: 'A close one.',
  mod: 'ctf',
  gamemode: 'ctf',
  map: 'q2dm1',
  sides: [{ team: 'red', result: 'win', players: ['alice', 'bob'] }],
  tags: ['final', 'ctf'],
  favourite: true,
  rating: 8,
  date: '2026-01-02T03:04:05Z'
}

describe('sidecar-draft', () => {
  it("a draft round-trips every sidecar field", () => {
    const draft = draftFromSidecar(fullFields)
    expect(draft.name).toBe('Grand final')
    expect(draft.description).toBe('A close one.')
    expect(draft.mod).toBe('ctf')
    expect(draft.gamemode).toBe('ctf')
    expect(draft.map).toBe('q2dm1')
    expect(draft.rating).toBe('8')
    expect(draft.favourite).toBe(true)
    expect(draft.tags).toEqual(['final', 'ctf'])
    expect(draft.sides).toEqual([{ team: 'red', result: 'win', players: ['alice', 'bob'] }])
    expect(draft.originalDate).toBe('2026-01-02T03:04:05Z')
    expect(draft.date).not.toBe('')

    const result = draftToFields(draft)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(sidecarFieldsSchema.safeParse(result.fields).success).toBe(true)
      expect(result.fields.name).toBe('Grand final')
      expect(result.fields.description).toBe('A close one.')
      expect(result.fields.mod).toBe('ctf')
      expect(result.fields.gamemode).toBe('ctf')
      expect(result.fields.map).toBe('q2dm1')
      expect(result.fields.rating).toBe(8)
      expect(result.fields.favourite).toBe(true)
      expect(result.fields.tags).toEqual(['final', 'ctf'])
      expect(result.fields.sides).toEqual([{ team: 'red', result: 'win', players: ['alice', 'bob'] }])
      // The date field is untouched, so it must come back byte-for-byte.
      expect(result.fields.date).toBe('2026-01-02T03:04:05Z')
    }
  })

  it('an empty draft round-trips to no fields at all', () => {
    const draft = draftFromSidecar({})
    expect(draft.originalDate).toBeNull()
    const result = draftToFields(draft)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.fields).toEqual({})
    }
  })

  it('sides and players can be added, removed and reordered', () => {
    let draft = draftFromSidecar({})
    draft = addSide(draft)
    expect(draft.sides).toEqual([{ team: '', result: '', players: [] }])

    draft = addPlayer(draft, 0, ' alice ')
    draft = addPlayer(draft, 0, 'bob')
    expect(draft.sides[0]!.players).toEqual(['alice', 'bob'])

    draft = movePlayer(draft, 0, 0, 1)
    expect(draft.sides[0]!.players).toEqual(['bob', 'alice'])

    // Move past either end is a no-op.
    const noMoveLeft = movePlayer(draft, 0, 0, -1)
    expect(noMoveLeft.sides[0]!.players).toEqual(['bob', 'alice'])
    const noMoveRight = movePlayer(draft, 0, 1, 1)
    expect(noMoveRight.sides[0]!.players).toEqual(['bob', 'alice'])

    draft = removePlayer(draft, 0, 0)
    expect(draft.sides[0]!.players).toEqual(['alice'])

    draft = addSide(draft)
    expect(draft.sides).toHaveLength(2)
    draft = removeSide(draft, 0)
    expect(draft.sides).toHaveLength(1)
    expect(draft.sides[0]!.players).toEqual([])
  })

  it("a known player is taken into a side once", () => {
    let draft = addSide(draftFromSidecar({}))
    draft = addPlayer(draft, 0, 'Alice')
    draft = addPlayer(draft, 0, 'alice')
    draft = addPlayer(draft, 0, ' ALICE ')
    expect(draft.sides[0]!.players).toEqual(['Alice'])
  })

  it.each(['0', '11', '5.5', 'abc'])(
    'rating outside 1–10 and an unparsable date are errors that block saving (rating=%s)',
    (rating) => {
    const draft = draftFromSidecar({})
    const result = draftToFields({ ...draft, rating })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.rating).toBe('replays.editor.error.rating')
    }
  })

  it.each(['abc', '2026-02-30 10:00', '2026-13-01'])(
    'rating outside 1–10 and an unparsable date are errors that block saving (date=%s)',
    (date) => {
      const draft = draftFromSidecar({})
      const result = draftToFields({ ...draft, date })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.date).toBe('replays.editor.error.date')
      }
    }
  )

  it('rating outside 1–10 and an unparsable date are errors that block saving (valid values accepted)', () => {
    const draft = draftFromSidecar({})
    const result = draftToFields({ ...draft, rating: '7', date: '2026-03-01 10:00' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(sidecarFieldsSchema.safeParse(result.fields).success).toBe(true)
      expect(result.fields.rating).toBe(7)
      expect(typeof result.fields.date).toBe('string')
    }
  })

  it('an untouched draft is not dirty', () => {
    const draft = draftFromSidecar(fullFields)
    expect(isDraftDirty(draft, draft)).toBe(false)

    // Whitespace-only edits must not count as dirty.
    const whitespaceEdited: SidecarDraft = { ...draft, name: `  ${draft.name}  ` }
    expect(isDraftDirty(whitespaceEdited, draft)).toBe(false)

    // A real edit is dirty.
    const edited: SidecarDraft = { ...draft, name: 'Different name' }
    expect(isDraftDirty(edited, draft)).toBe(true)

    // The date field, untouched, round-trips to the exact original ISO string.
    const result = draftToFields(draft)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.fields.date).toBe(fullFields.date)
    }
  })

  it('a quick favourite or rating keeps every other field', () => {
    const withFavourite = withQuickEdit(fullFields, { favourite: false })
    expect(withFavourite.favourite).toBeUndefined()
    expect(withFavourite.name).toBe(fullFields.name)
    expect(withFavourite.rating).toBe(fullFields.rating)
    expect(withFavourite.date).toBe(fullFields.date)

    const withRating = withQuickEdit(fullFields, { rating: 3 })
    expect(withRating.rating).toBe(3)
    expect(withRating.name).toBe(fullFields.name)
    expect(withRating.favourite).toBe(fullFields.favourite)

    const withRatingCleared = withQuickEdit(fullFields, { rating: null })
    expect(withRatingCleared.rating).toBeUndefined()
    expect(withRatingCleared.name).toBe(fullFields.name)
  })

  it("tag suggestions come from other demos' tags", () => {
    const others = [['Final', 'ctf'], ['final', 'dm'], ['ctf'], ['other']]
    // 'final'/'Final' appear 2x total (most-used spelling 'final' wins by count... actually tie),
    // 'ctf' appears 2x, 'dm' and 'other' appear once each.
    const suggestions = suggestTags(others, '', [])
    expect(suggestions.slice(0, 2)).toEqual(expect.arrayContaining(['final', 'ctf']))
    expect(suggestions).not.toContain('Final')

    // Substring filter is case-insensitive.
    expect(suggestTags(others, 'fin', [])).toEqual(['final'])

    // Already-current tags are excluded.
    expect(suggestTags(others, '', ['ctf'])).not.toContain('ctf')

    // Capped at 8 results.
    const many = [Array.from({ length: 12 }, (_, i) => `tag${i}`)]
    expect(suggestTags(many, '', [])).toHaveLength(8)
  })
})
