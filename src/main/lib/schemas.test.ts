import { describe, expect, it } from 'vitest'
import { configProfileSchema, parseConfigProfiles } from './schemas'
import { setProfileActionsInputSchema } from '../modules/config/schemas'
import { aliasNameFor } from '@shared/config/alias-render'
import type { ConfigAction } from '@shared/modules/config'

/**
 * Story 008's persisted-state shape for `ConfigProfile.categories`/`.actions`. Unlike `layers`
 * (a whole-array `.catch(() => [])`), this story's acceptance criterion requires row-level
 * dropping: one malformed row must not wipe the rest of the array. See `parseForgivingRows` in
 * `./schemas.ts` for the mechanism.
 */
describe('configProfileSchema - categories/actions (story 008)', () => {
  const baseProfile = {
    id: 'p1',
    name: 'My profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignments: [],
  }

  it('parses to categories: [] and actions: [] when both keys are absent', () => {
    const result = configProfileSchema.parse(baseProfile)
    expect(result.categories).toEqual([])
    expect(result.actions).toEqual([])
  })

  it('drops only the malformed row among two action rows, keeping the valid one', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      actions: [
        // Missing `id` - malformed.
        { categoryId: 'c1', name: 'Bad row', commands: [] },
        // Well-formed.
        { id: 'a1', categoryId: 'c1', name: 'Good row', commands: [{ kind: 'raw', text: '+forward' }] },
      ],
    })
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({ id: 'a1', name: 'Good row' })
  })

  it('drops only the malformed row among two category rows, keeping the valid one', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [
        // Missing `name` - malformed.
        { id: 'c1' },
        // Well-formed.
        { id: 'c2', name: 'Good category' },
      ],
    })
    expect(result.categories).toHaveLength(1)
    expect(result.categories[0]).toMatchObject({ id: 'c2', name: 'Good category' })
  })

  it('drops a row whose command text is not latin-1, keeping unrelated well-formed rows', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      actions: [
        {
          id: 'a1',
          categoryId: 'c1',
          name: 'Bad text',
          commands: [{ kind: 'raw', text: 'em dash — here' }],
        },
        {
          id: 'a2',
          categoryId: 'c1',
          name: 'Good text',
          commands: [{ kind: 'raw', text: '+forward' }],
        },
      ],
    })
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({ id: 'a2' })
  })

  it('round-trips a well-formed categories/actions payload through the strict and persisted schemas', () => {
    const payload = {
      profileId: 'p1',
      categories: [{ id: 'c1', name: 'Custom' }],
      actions: [
        {
          id: 'a1',
          categoryId: 'c1',
          name: 'Jump forward',
          kind: 'bind' as const,
          commands: [{ kind: 'raw' as const, text: '+forward' }],
          key: 'W',
        },
      ],
    }

    const strict = setProfileActionsInputSchema.parse(payload)

    const persisted = configProfileSchema.parse({
      ...baseProfile,
      categories: strict.categories,
      actions: strict.actions,
    })

    expect(persisted.categories).toEqual(strict.categories)
    expect(persisted.actions).toEqual(strict.actions)
  })

  it('story 019 D3: a persisted actions array keeps its order through parse - no accidental re-sort', () => {
    const orderedActions = [
      { id: 'a3', categoryId: 'weapons', name: 'Third', kind: 'bind' as const, commands: [] },
      { id: 'a1', categoryId: 'c1', name: 'First', kind: 'bind' as const, commands: [] },
      { id: 'a2', categoryId: 'c1', name: '+test', kind: 'alias' as const, commands: [] },
    ]

    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [
        { id: 'c1', name: 'Custom' },
        { id: 'weapons', name: 'Weapons' },
      ],
      actions: orderedActions,
    })

    expect(result.actions.map((action) => action.id)).toEqual(['a3', 'a1', 'a2'])
    expect(result.actions).toEqual(orderedActions)
  })
})

/**
 * Story 011: `AltLayer.triggerKey` becomes nullable (`null` = "no trigger
 * assigned yet"). `configProfileSchema`'s `layers` field degrades the whole
 * array to `[]` on a structural failure (see `altLayerPersistedSchema` in
 * `./schemas.ts`), but `triggerKey` itself has its own `.catch(null)` so a
 * missing/malformed value there defaults just that field to `null` instead of
 * dropping the whole layer row.
 */
describe('configProfileSchema - layers.triggerKey (story 011)', () => {
  const baseProfile = {
    id: 'p1',
    name: 'My profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignments: [],
  }

  it('loads a layer row with triggerKey absent as triggerKey: null', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      layers: [{ id: 'l1', name: 'Drops', mode: 'hold', overrides: {} }],
    })
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0]!.triggerKey).toBeNull()
  })

  it('loads a layer row with triggerKey: null explicitly as null', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      layers: [{ id: 'l1', name: 'Drops', mode: 'hold', triggerKey: null, overrides: {} }],
    })
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0]!.triggerKey).toBeNull()
  })

  it('keeps a pre-011 string triggerKey unchanged', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      layers: [{ id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: {} }],
    })
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0]!.triggerKey).toBe('ALT')
  })
})

/**
 * Story 019: the entry kind moved from the category onto the entry, and a `state.json` written
 * before that (there is no `STATE_SCHEMA_VERSION` bump - this is a forgiving derive done on every
 * read, not a migration step) has to keep working: every row survives, and each entry's `kind` is
 * derived from its category's legacy `entryKind`. The derive runs at profile level because it needs
 * the sibling `categories` a row-level schema cannot see - see `normalizeConfigProfile`.
 */
describe('configProfileSchema - entry kind derived on read (story 019)', () => {
  const baseProfile = {
    id: 'p1',
    name: 'My profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignments: [],
  }

  /**
   * A pre-019 file: the kind sits on the category, no action row carries one. The last two
   * categories are the hand-mangled cases (`entryKind` unreadable, `entryKind` absent) that must
   * still keep their row rather than take a user's drawer - and its entries - with them.
   */
  const legacyProfile = {
    ...baseProfile,
    categories: [
      { id: 'c-msg', name: 'Chat', entryKind: 'message' },
      { id: 'c-alias', name: 'Aliases', entryKind: 'alias' },
      { id: 'c-bind', name: 'My binds', entryKind: 'bind' },
      { id: 'c-odd', name: 'Odd', entryKind: 42 },
      { id: 'c-plain', name: 'No kind at all' },
    ],
    actions: [
      {
        id: 'a-msg',
        categoryId: 'c-msg',
        name: 'Taunt',
        commands: [{ kind: 'message', channel: 'say', text: 'nice shot' }],
      },
      { id: 'a-alias', categoryId: 'c-alias', name: '+test', commands: [{ kind: 'raw', text: '+attack' }] },
      { id: 'a-bind', categoryId: 'c-bind', name: 'Jump', commands: [{ kind: 'raw', text: '+moveup' }] },
      { id: 'a-odd', categoryId: 'c-odd', name: 'Odd entry', commands: [] },
      { id: 'a-plain', categoryId: 'c-plain', name: 'Plain entry', commands: [] },
      // A built-in category: never a persisted row, so there is nothing to derive from.
      { id: 'a-builtin', categoryId: 'movement', name: 'Forward', commands: [{ kind: 'raw', text: '+forward' }] },
      // A category that is not in `categories` at all (deleted by hand).
      { id: 'a-orphan', categoryId: 'deleted-category', name: 'Orphan', commands: [] },
    ],
  }

  it('keeps the profile and every one of its category and action rows', () => {
    const profiles = parseConfigProfiles([legacyProfile])

    expect(profiles).toHaveLength(1)
    expect(profiles[0]!.categories).toHaveLength(5)
    expect(profiles[0]!.actions).toHaveLength(7)
  })

  it('derives every entry kind from its category, falling back to bind', () => {
    const result = configProfileSchema.parse(legacyProfile)
    const kinds = Object.fromEntries(result.actions.map((action) => [action.id, action.kind]))

    expect(kinds).toEqual({
      'a-msg': 'message',
      'a-alias': 'alias',
      'a-bind': 'bind',
      // Unreadable `entryKind`, no `entryKind`, a built-in category, a category that no longer
      // exists: all four fall back to `bind`, the only kind an entry of unknown type can safely be.
      'a-odd': 'bind',
      'a-plain': 'bind',
      'a-builtin': 'bind',
      'a-orphan': 'bind',
    })
  })

  it('accepts the legacy entryKind but leaves it out of the parsed categories', () => {
    const result = configProfileSchema.parse(legacyProfile)

    expect(result.categories).toEqual([
      { id: 'c-msg', name: 'Chat' },
      { id: 'c-alias', name: 'Aliases' },
      { id: 'c-bind', name: 'My binds' },
      { id: 'c-odd', name: 'Odd' },
      { id: 'c-plain', name: 'No kind at all' },
    ])
    expect(result.categories.every((category) => !('entryKind' in category))).toBe(true)
  })

  it('keeps the rest of a legacy entry untouched while adding its kind', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [{ id: 'c-msg', name: 'Chat', entryKind: 'message' }],
      actions: [
        {
          id: 'a-msg',
          categoryId: 'c-msg',
          name: 'Taunt',
          commands: [{ kind: 'message', channel: 'say_team', text: 'nice shot' }],
          key: 'F5',
          keyModifier: 'ALT',
          catalogId: 'movement:forward',
        },
      ],
    })

    expect(result.actions[0]).toEqual({
      id: 'a-msg',
      categoryId: 'c-msg',
      name: 'Taunt',
      kind: 'message',
      commands: [{ kind: 'message', channel: 'say_team', text: 'nice shot' }],
      key: 'F5',
      keyModifier: 'ALT',
      catalogId: 'movement:forward',
    })
  })

  it('keeps a post-019 entry kind, whatever its category once said', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [{ id: 'c1', name: 'Mixed', entryKind: 'message' }],
      actions: [
        { id: 'a1', categoryId: 'c1', name: '+test', kind: 'alias', commands: [] },
        { id: 'a2', categoryId: 'c1', name: 'Taunt', kind: 'message', commands: [] },
        { id: 'a3', categoryId: 'c1', name: 'Jump', kind: 'bind', commands: [] },
      ],
    })

    expect(result.actions.map((action) => action.kind)).toEqual(['alias', 'message', 'bind'])
  })

  it('degrades an unreadable kind on the row to the category derive rather than dropping the row', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [{ id: 'c1', name: 'Aliases', entryKind: 'alias' }],
      actions: [{ id: 'a1', categoryId: 'c1', name: '+test', kind: 'binding', commands: [] }],
    })

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.kind).toBe('alias')
  })

  /**
   * Review fix, Finding 1: a legacy `entryKind: 'alias'` category's entry that still carries a
   * key/layer override from before it became `kind: 'alias'` must have both cleaned up on this
   * same read, not just its own `kind` derived - `binds`/layer `overrides` are derived mirrors
   * (story 019 decision), so a stale entry left behind by a plain read is exactly the class of
   * bug the mirror concept exists to make impossible.
   *
   * Respin (second review fix): the strip must match by *value* - the exact synthetic name
   * `aliasNameFor` would have produced for this action while it was still a plain bind - never by
   * key/slot. The fixture below uses that real computed value (via `aliasNameFor`) rather than a
   * hand-picked string, so this test actually exercises the value match instead of accidentally
   * passing under either a key-based or a value-based implementation.
   */
  it('strips a stale binds entry and layer override for a legacy alias-turned entry that carried a key', () => {
    const staleAliasAction: Omit<ConfigAction, 'kind'> = {
      id: 'a-alias',
      categoryId: 'c-alias',
      name: '+test',
      commands: [{ kind: 'raw', text: '+attack' }],
      key: 'r',
      secondaryKey: 'f',
      secondaryKeyModifier: 'ALT',
    }
    // The exact value a mirror pass would have written for this action's `r`/Alt+`f` slots while
    // it was still `kind: 'bind'` - computed, not hand-picked, so the fixture is genuinely this
    // action's own stale name rather than a string that merely looks like one.
    const staleName = aliasNameFor({ ...staleAliasAction, kind: 'bind' })

    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [{ id: 'c-alias', name: 'Aliases', entryKind: 'alias' }],
      actions: [staleAliasAction],
      binds: { r: staleName },
      layers: [
        {
          id: 'l1',
          name: 'Alt',
          mode: 'hold',
          triggerKey: 'ALT',
          overrides: { f: staleName },
        },
      ],
    })

    expect(result.actions[0]!.kind).toBe('alias')
    expect(result.binds).toEqual({})
    expect(result.layers[0]!.overrides).toEqual({})
  })

  /**
   * Respin (second review fix, data-loss regression): the previous key-based strip deleted
   * *whatever* bind/override sat on the same key slot the stale alias used to occupy, even if that
   * entry's value belonged to a completely different, still-live bind. A hand-typed bind (or a
   * different action's legitimate bind) that happens to reuse the exact same key the alias used to
   * hold must survive this read untouched, since only the alias's own former value identifies its
   * own stale entry.
   */
  it('leaves an unrelated bind/override on the same key slot untouched', () => {
    const staleAliasAction = {
      id: 'a-alias',
      categoryId: 'c-alias',
      name: '+test',
      commands: [{ kind: 'raw', text: '+attack' }],
      key: 'r',
      secondaryKey: 'f',
      secondaryKeyModifier: 'ALT',
    }

    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [{ id: 'c-alias', name: 'Aliases', entryKind: 'alias' }],
      actions: [staleAliasAction],
      // Neither value is this alias's own stale synthetic name - a hand-typed base bind and a
      // different action's own mirrored bind, both of which happen to reuse the same key slots.
      binds: { r: 'kill' },
      layers: [
        {
          id: 'l1',
          name: 'Alt',
          mode: 'hold',
          triggerKey: 'ALT',
          overrides: { f: 'q2l_a_other_bbbb' },
        },
      ],
    })

    expect(result.actions[0]!.kind).toBe('alias')
    expect(result.binds).toEqual({ r: 'kill' })
    expect(result.layers[0]!.overrides).toEqual({ f: 'q2l_a_other_bbbb' })
  })
})
