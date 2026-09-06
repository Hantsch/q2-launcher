import { describe, expect, it } from 'vitest'
import { configProfileSchema, parseConfigProfiles } from './schemas'
import { setProfileActionsInputSchema } from '../modules/config/schemas'
import { legacyAliasNameFor } from '@shared/config/alias-render'
import { bindValueFor } from '@shared/config/action-mirror'
import { captureBaseline } from '@shared/config/profile-baseline'
import { validateActions } from '@shared/config/validate-actions'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'

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

  /**
   * Story 053 D1: a category defaults `subcategories` to `[]` when the persisted row predates the
   * field, and round-trips a real sub-category list; an action's `subcategoryId` survives
   * persist/load even when it names a sub-category the category no longer has (schema-level, no
   * cross-reference check - the ungrouped fallback is a later deliverable's rendering concern).
   */
  it('defaults a category with no subcategories field to subcategories: []', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [{ id: 'c1', name: 'Movement' }],
    })
    expect(result.categories[0]).toMatchObject({ id: 'c1', name: 'Movement', subcategories: [] })
  })

  it('round-trips a category with subcategories and an action with a subcategoryId, including an unknown one', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [
        { id: 'c1', name: 'Movement', subcategories: [{ id: 'sub1', name: 'Strafing' }] },
      ],
      actions: [
        {
          id: 'a1',
          categoryId: 'c1',
          subcategoryId: 'sub1',
          name: 'Strafe left',
          commands: [{ kind: 'raw', text: '+moveleft' }],
        },
        {
          id: 'a2',
          categoryId: 'c1',
          subcategoryId: 'unknown-sub',
          name: 'Unknown sub',
          commands: [{ kind: 'raw', text: '+moveright' }],
        },
      ],
    })
    expect(result.categories[0]).toMatchObject({
      id: 'c1',
      subcategories: [{ id: 'sub1', name: 'Strafing' }],
    })
    expect(result.actions).toHaveLength(2)
    expect(result.actions[0]).toMatchObject({ id: 'a1', subcategoryId: 'sub1' })
    expect(result.actions[1]).toMatchObject({ id: 'a2', subcategoryId: 'unknown-sub' })
  })

  /**
   * Story 045 D1: `toggle`/`press-release` need exactly two `parts`; a `wait` command needs
   * `frames` in `[1, MAX_WAIT_FRAMES]`. Persisted schemas are forgiving - a row failing either rule
   * is dropped, never thrown, and never takes the rest of the profile with it.
   */
  it('drops a toggle row whose parts is not exactly two, keeping a well-formed row', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      actions: [
        {
          id: 'a1',
          categoryId: 'c1',
          name: 'Bad toggle',
          kind: 'toggle',
          commands: [],
          parts: [{ commands: [{ kind: 'raw', text: 'zoom 1' }] }],
        },
        {
          id: 'a2',
          categoryId: 'c1',
          name: 'Good toggle',
          kind: 'toggle',
          commands: [],
          parts: [
            { commands: [{ kind: 'raw', text: 'zoom 1' }] },
            { commands: [{ kind: 'raw', text: 'zoom 0' }] },
          ],
        },
      ],
    })
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({ id: 'a2' })
  })

  it('drops a row whose wait command frames is out of range, keeping a well-formed row', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      actions: [
        {
          id: 'a1',
          categoryId: 'c1',
          name: 'Bad wait',
          kind: 'bind',
          commands: [{ kind: 'wait', frames: 0 }],
        },
        {
          id: 'a2',
          categoryId: 'c1',
          name: 'Good wait',
          kind: 'bind',
          commands: [{ kind: 'wait', frames: 10 }],
        },
      ],
    })
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({ id: 'a2' })
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

    // Story 053 D1: the persisted schema fills in `subcategories: []` for a category row that
    // carries none (the strict IPC schema leaves the field absent when the caller omits it).
    expect(persisted.categories).toEqual(
      strict.categories.map((c) => ({ ...c, subcategories: [] })),
    )
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
 * Story 059 D1: the persisted-schema mirror of `ConfigProfile.cvarSections`/`writeCatalogDefaults` -
 * the Settings-tab counterpart of `categories`/`actions` above. Same conventions: `cvarSections`
 * defaults to `[]` when absent, a malformed row is dropped on its own (not the whole profile), cvar
 * names are never cross-validated against the catalogue, and `writeCatalogDefaults` defaults to
 * `true` (today's own unconditional-write behaviour) like `writeUnbindall`.
 */
describe('configProfileSchema - cvarSections/writeCatalogDefaults (story 059)', () => {
  const baseProfile = {
    id: 'p1',
    name: 'My profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignments: [],
  }

  it('parses to cvarSections: [] when the key is absent', () => {
    const result = configProfileSchema.parse(baseProfile)
    expect(result.cvarSections).toEqual([])
  })

  it('defaults writeCatalogDefaults to true when absent or malformed', () => {
    expect(configProfileSchema.parse(baseProfile).writeCatalogDefaults).toBe(true)
    expect(
      configProfileSchema.parse({ ...baseProfile, writeCatalogDefaults: 'nope' }).writeCatalogDefaults,
    ).toBe(true)
  })

  it('round-trips a well-formed cvarSections list, including a section with subsections', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      cvarSections: [
        {
          id: 'player',
          name: 'Player',
          nameKey: 'config.settings.groups.player',
          cvars: ['sensitivity', 'name'],
          subsections: [{ id: 'sub1', name: 'Aim', cvars: ['sensitivity'] }],
        },
      ],
    })
    expect(result.cvarSections).toEqual([
      {
        id: 'player',
        name: 'Player',
        nameKey: 'config.settings.groups.player',
        cvars: ['sensitivity', 'name'],
        subsections: [{ id: 'sub1', name: 'Aim', cvars: ['sensitivity'] }],
      },
    ])
  })

  // Story 059 D1: "an unknown cvar name in a section list does not fail validation" - the schema
  // guards shape only, never cross-references `ALL_CVARS`.
  it('keeps a section listing a cvar name the catalogue does not recognize', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      cvarSections: [{ id: 's1', name: 'Custom', cvars: ['not_a_real_cvar'] }],
    })
    expect(result.cvarSections).toHaveLength(1)
    expect(result.cvarSections[0]).toMatchObject({ cvars: ['not_a_real_cvar'] })
  })

  it('drops only the malformed section among two, keeping the well-formed one', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      cvarSections: [
        // Missing `name` - malformed.
        { id: 's1', cvars: [] },
        // Well-formed.
        { id: 's2', name: 'Good section', cvars: ['sensitivity'] },
      ],
    })
    expect(result.cvarSections).toHaveLength(1)
    expect(result.cvarSections[0]).toMatchObject({ id: 's2', name: 'Good section' })
  })

  it('defaults a section with no subsections field to subsections: []', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      cvarSections: [{ id: 's1', name: 'Custom', cvars: [] }],
    })
    expect(result.cvarSections[0]).toMatchObject({ subsections: [] })
  })
})

/**
 * Story 050: `keys` replaces the old fixed `key`/`secondaryKey`/`keyModifier`/
 * `secondaryKeyModifier` fields. `configActionPersistedSchema` (this file) still accepts the
 * legacy shape and normalises it into `keys` on read - the decision that keeps every profile
 * already on a dev machine from silently losing its binds on the next load.
 */
describe('configProfileSchema - keys (story 050)', () => {
  const baseProfile = {
    id: 'p1',
    name: 'My profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignments: [],
  }

  it('loads a legacy-shaped stored action with its two slots intact', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      actions: [
        {
          id: 'a1',
          categoryId: 'c1',
          name: 'Jump forward',
          kind: 'bind',
          commands: [],
          key: 'W',
          secondaryKey: 'X',
          secondaryKeyModifier: 'ALT',
        },
      ],
    })

    expect(result.actions[0]!.keys).toEqual([{ key: 'W' }, { key: 'X', modifier: 'ALT' }])
  })

  it('round-trips an action with five key slots through the strict and persisted schemas', () => {
    const payload = {
      profileId: 'p1',
      categories: [],
      actions: [
        {
          id: 'a1',
          categoryId: 'c1',
          name: 'Jump forward',
          kind: 'bind' as const,
          commands: [],
          keys: [
            { key: 'W' },
            { key: 'X', modifier: 'ALT' as const },
            { key: 'Y' },
            { key: 'Z', modifier: 'CTRL' as const },
            { key: 'Q', modifier: 'SHIFT' as const },
          ],
        },
      ],
    }

    const strict = setProfileActionsInputSchema.parse(payload)
    const persisted = configProfileSchema.parse({ ...baseProfile, actions: strict.actions })

    expect(persisted.actions[0]!.keys).toHaveLength(5)
    expect(persisted.actions[0]!.keys).toEqual(strict.actions[0]!.keys)
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
      { id: 'c-msg', name: 'Chat', subcategories: [] },
      { id: 'c-alias', name: 'Aliases', subcategories: [] },
      { id: 'c-bind', name: 'My binds', subcategories: [] },
      { id: 'c-odd', name: 'Odd', subcategories: [] },
      { id: 'c-plain', name: 'No kind at all', subcategories: [] },
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
      // Story 050: the legacy `key`/`keyModifier` pair is normalised into one `keys` slot on read.
      keys: [{ key: 'F5', modifier: 'ALT' }],
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
   * `legacyAliasNameFor` would have produced for this action while it was still a plain bind -
   * never by key/slot. The fixture below uses that real computed value (via `legacyAliasNameFor`)
   * rather than a hand-picked string, so this test actually exercises the value match instead of
   * accidentally passing under either a key-based or a value-based implementation.
   *
   * `legacyAliasNameFor`, not `aliasNameFor` (story 039, D7): this row's stale entry was written by
   * a mirror pass that ran *before* the readable-name flip, so it is necessarily in the legacy
   * format - the same reasoning `staleAliasSyntheticName` (`@shared/config/modifier-layers.ts`)
   * documents for its own, otherwise-identical helper.
   */
  it('strips a stale binds entry and layer override for a legacy alias-turned entry that carried a key', () => {
    // Legacy on-disk shape (pre-050 `key`/`secondaryKey`/`secondaryKeyModifier` fields) rather than
    // `ConfigAction`, deliberately untyped: this fixture stands in for an old `state.json` row, the
    // shape `configProfileSchema`'s forgiving read path (not the strict `ConfigAction` type) still
    // has to accept and normalise.
    const staleAliasAction = {
      id: 'a-alias',
      categoryId: 'c-alias',
      name: '+test',
      commands: [{ kind: 'raw' as const, text: '+attack' }],
      key: 'r',
      secondaryKey: 'f',
      secondaryKeyModifier: 'ALT',
    }
    // The exact value a mirror pass would have written for this action's `r`/Alt+`f` slots while
    // it was still `kind: 'bind'` - computed, not hand-picked, so the fixture is genuinely this
    // action's own stale name rather than a string that merely looks like one.
    const staleName = legacyAliasNameFor({ ...staleAliasAction, kind: 'bind' })

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
      commands: [{ kind: 'raw' as const, text: '+attack' }],
      key: 'r',
      secondaryKey: 'f',
      secondaryKeyModifier: 'ALT',
    }

    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [{ id: 'c-alias', name: 'Aliases', entryKind: 'alias' }],
      actions: [staleAliasAction],
      // Neither value is this alias's own stale synthetic name - two hand-made entries that merely
      // happen to reuse the same key slots. Story 039 D6: both are deliberately prefix-free, since
      // a `q2l_a_*` value with no owning action is now dropped one pass earlier as legacy debris
      // (see the D6 block below) and would no longer prove anything about *this* strip pass.
      binds: { r: 'kill' },
      layers: [
        {
          id: 'l1',
          name: 'Alt',
          mode: 'hold',
          triggerKey: 'ALT',
          overrides: { f: 'some_alias' },
        },
      ],
    })

    expect(result.actions[0]!.kind).toBe('alias')
    expect(result.binds).toEqual({ r: 'kill' })
    expect(result.layers[0]!.overrides).toEqual({ f: 'some_alias' })
  })
})

/**
 * Story 039 D6: the read-path migration of legacy `q2l_a_<slug>_<id4>` references.
 *
 * Every profile a real user already has on disk carries these values, so this runs on every read of
 * every existing profile. The fixtures use `legacyAliasNameFor`/`bindValueFor` rather than
 * hand-written strings on purpose: the expected value is whatever the mirrors write *today*, which
 * is what keeps these tests meaningful across the D7 name flip instead of freezing today's format.
 */
describe('configProfileSchema - legacy alias references migrated on read (story 039)', () => {
  const baseProfile = {
    id: 'p1',
    name: 'My profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignments: [],
  }

  /** "SSG + SG" - a plain bind entry whose id4 is `9a2f`, i.e. legacy name `q2l_a_ssg_sg_9a2f`. */
  const ssgAction: ConfigAction = {
    id: '9a2f-1111-2222',
    categoryId: 'c1',
    name: 'SSG + SG',
    kind: 'bind',
    commands: [
      { kind: 'raw', text: 'use super shotgun' },
      { kind: 'raw', text: 'use shotgun' },
    ],
    keys: [{ key: 'q' }, { key: 'x', modifier: 'ALT' }],
  }

  const legacyName = legacyAliasNameFor(ssgAction)
  const currentValue = bindValueFor(ssgAction)

  const layerWith = (overrides: Record<string, string>): unknown => ({
    id: 'l1',
    name: 'Alt',
    mode: 'hold',
    triggerKey: 'ALT',
    overrides,
  })

  it('is the legacy format the fixtures claim it is', () => {
    // Guards the fixture itself: if `legacyAliasNameFor` ever stopped reproducing the pre-039
    // format, every assertion below would still "pass" while migrating nothing real.
    expect(legacyName).toBe('q2l_a_ssg_sg_9a2f')
  })

  it('rewrites a legacy bind and layer override to the action’s current mirrored value', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [{ id: 'c1', name: 'Weapons' }],
      actions: [ssgAction],
      binds: { q: legacyName },
      layers: [layerWith({ x: legacyName })],
    })

    expect(result.binds).toEqual({ q: currentValue })
    expect(result.layers[0]!.overrides).toEqual({ x: currentValue })
    // Still exactly the one action it was read with - the migration rewrites references, it never
    // adopts or invents a row.
    expect(result.actions).toHaveLength(1)
  })

  it('drops a legacy value whose action is gone, in binds and in a layer alike', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [{ id: 'c1', name: 'Weapons' }],
      actions: [ssgAction],
      binds: { q: legacyName, z: 'q2l_a_gone_1234' },
      layers: [layerWith({ x: legacyName, y: 'q2l_a_gone_1234' })],
    })

    expect(result.binds).toEqual({ q: currentValue })
    expect(result.layers[0]!.overrides).toEqual({ x: currentValue })
  })

  it('leaves hand-typed binds untouched, including a reference to an alias entry’s own name', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [{ id: 'c1', name: 'Weapons' }],
      // The alias entry renders as `drop_shotgun`; the hand-typed `bind KP_END "drop_shotgun"`
      // referencing it must survive both this migration and the story 019 alias strip (story 041
      // depends on exactly this line).
      actions: [
        ssgAction,
        {
          id: 'a-alias',
          categoryId: 'c1',
          name: 'drop shotgun',
          kind: 'alias',
          commands: [{ kind: 'raw', text: 'drop shotgun' }],
        },
      ],
      binds: { r: '+attack', x: 'some_alias', KP_END: 'drop_shotgun' },
      layers: [layerWith({ g: 'say_team taking rl' })],
    })

    expect(result.binds).toEqual({ r: '+attack', x: 'some_alias', KP_END: 'drop_shotgun' })
    expect(result.layers[0]!.overrides).toEqual({ g: 'say_team taking rl' })
  })

  it('produces no findings for a migrated profile and reads identically a second time', () => {
    const persisted = {
      ...baseProfile,
      categories: [{ id: 'c1', name: 'Weapons' }],
      actions: [ssgAction],
      binds: { q: legacyName, r: '+attack', z: 'q2l_a_gone_1234' },
      layers: [layerWith({ x: legacyName, g: 'say_team taking rl' })],
    }

    const once = configProfileSchema.parse(persisted)
    // Idempotent: feeding the migrated profile back through the read changes nothing further, which
    // is what makes "runs on every read" safe rather than a slow rewrite of the user's binds.
    const twice = configProfileSchema.parse({ ...persisted, ...once })

    expect(twice.binds).toEqual(once.binds)
    expect(twice.layers).toEqual(once.layers)
    expect(twice.actions).toEqual(once.actions)
    expect(validateActions(once.actions, 'r1q2', { binds: once.binds, layers: once.layers })).toEqual(
      [],
    )
  })
})

/**
 * Story 049 D1: the last-saved `baseline` snapshot. The field is `.optional().catch(undefined)`, so
 * a schema that did not match what `captureBaseline` produces would drop every baseline *silently* -
 * the launcher would just quietly forget what "unsaved" means across a restart. Hence the round-trip
 * assertion below, next to the two forgiving cases the `.catch()` exists for.
 */
describe('configProfileSchema - baseline (story 049)', () => {
  const baseProfile = {
    id: 'p1',
    name: 'My profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignments: [],
  }

  const profileWithContent: ConfigProfile = {
    ...baseProfile,
    cvars: { sensitivity: '4.5' },
    binds: { w: '+forward' },
    layers: [{ id: 'l1', name: 'Alt', mode: 'hold', triggerKey: 'ALT', overrides: { r: '+attack' } }],
    categories: [{ id: 'c1', name: 'Chat', subcategories: [] }],
    actions: [
      {
        id: 'a1',
        categoryId: 'c1',
        name: 'gg',
        kind: 'message',
        commands: [{ kind: 'message', channel: 'say', text: 'gg' }],
        keys: [{ key: 'F1' }],
      },
    ],
    writeUnbindall: false,
    sectionHeaderStyle: 'brackets',
    unrecognized: [{ file: 'config.cfg', line: 12, text: 'somethingodd 1' }],
  }

  it('round-trips a captured baseline unchanged', () => {
    const baseline = captureBaseline(profileWithContent)
    const result = configProfileSchema.parse({ ...profileWithContent, baseline })
    expect(result.baseline).toEqual(baseline)
  })

  it('leaves a profile with no baseline key undefined rather than failing (every pre-049 record)', () => {
    expect(configProfileSchema.parse(baseProfile).baseline).toBeUndefined()
  })

  it('degrades a malformed baseline to undefined instead of dropping the profile', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      cvars: { sensitivity: '4.5' },
      baseline: { cvars: 'not a map' },
    })
    expect(result.baseline).toBeUndefined()
    expect(result.cvars).toEqual({ sensitivity: '4.5' })
  })
})
