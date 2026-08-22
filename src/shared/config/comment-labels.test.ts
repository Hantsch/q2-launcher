import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigActionCategory, ConfigProfile } from '@shared/modules/config'
import { BUILT_IN_ACTION_CATEGORIES } from '@shared/modules/config'
import {
  DROP_ACTIONS,
  DROPPABLES,
  MOVEMENT_ACTIONS,
  WEAPON_ACTIONS,
  WEAPON_EXTRA_ACTIONS,
} from '@shared/config/action-catalog'
import { CVAR_GROUP_LABELS, CVAR_GROUP_ORDER } from '@shared/config/cvar-facts'
import { buildMovementRows } from '@shared/config/catalog-rows'
// A static import, not a runtime `fs.readFile`: `src/shared` may never import `node:*`
// (docs/ARCHITECTURE.md), even in a test, since this file type-checks under `tsconfig.web.json`
// too (which carries no node types at all). `tsconfig.node.json` lists this one file explicitly
// so `tsc` accepts the import on that side as well - see the comment there.
import en from '../../renderer/src/i18n/locales/en.json'
import { categoryLabelFor, commentLabelFor } from './comment-labels'

/**
 * Story 040 D1: `action-catalog.ts`/`modules/config.ts`/`cvar-facts.ts` add a plain ASCII `label`
 * next to every existing `labelKey`. This file is the pin the Decisions (Sprint) section asks
 * for - every one of those literals must equal the string the matching `labelKey` resolves to in
 * `en.json`, so the shared, i18n-free copy the config-file writer reads cannot drift from what the
 * UI actually shows without a failing test catching it.
 */

/** Reads a dotted i18n key (e.g. `config.actionCatalog.forward.label`) out of the real `en.json`,
 * the same key format every `labelKey` field already carries. Untyped walk because `labelKey` is
 * a runtime string, not a literal path `en.json`'s generated type could check structurally. */
function stringAt(path: string): string {
  const value: unknown = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' && key in acc ? (acc as Record<string, unknown>)[key] : undefined), en)
  if (typeof value !== 'string') throw new Error(`en.json has no string at "${path}"`)
  return value
}

/** Plain ASCII printable text only (space through `~`) - the rule every banner/comment literal in
 * the shared layer must follow (story's Decisions: "plain ASCII English literals ... never from
 * renderer i18n", same latin-1 safety `sentinelLine` already documents). */
const ASCII_PRINTABLE = /^[\x20-\x7E]+$/

function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'ab12cd34-0000-0000-0000-000000000000',
    categoryId: 'weapons',
    name: 'Drop RL',
    kind: 'bind',
    commands: [{ kind: 'raw', text: 'drop rl' }],
    ...overrides,
  }
}

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'profile-1',
    name: 'Test profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

describe('commentLabelFor', () => {
  it('returns the catalogue label for a materialised catalogue row (catalogId matches a real row)', () => {
    // `buildMovementRows()` maps `MOVEMENT_ACTIONS` 1:1 in order (see `catalog-rows.ts`), so index 0
    // is guaranteed to be the same entry on both sides without hardcoding the `movement:forward`
    // id format here.
    const catalogId = buildMovementRows()[0]!.catalogId
    const materialized = action({ catalogId, name: MOVEMENT_ACTIONS[0]!.label })

    expect(commentLabelFor(materialized, profile())).toBe(MOVEMENT_ACTIONS[0]!.label)
  })

  it('falls back to action.name when catalogId matches no known catalogue row', () => {
    const stale = action({ catalogId: 'movement:retired-row', name: 'Whatever the user last saw' })

    expect(commentLabelFor(stale, profile())).toBe('Whatever the user last saw')
  })

  it('returns action.name verbatim for a user-created entry (no catalogId at all)', () => {
    const userMade = action({ catalogId: undefined, name: 'My SSG+SG combo' })

    expect(commentLabelFor(userMade, profile())).toBe('My SSG+SG combo')
  })
})

describe('categoryLabelFor', () => {
  it('resolves a built-in category id to its plain label', () => {
    expect(categoryLabelFor('weapons', profile())).toBe('Weapons')
  })

  it("resolves a user-created category id to that category's stored name, verbatim", () => {
    const category: ConfigActionCategory = { id: 'cat-1', name: 'Comms' }

    expect(categoryLabelFor('cat-1', profile({ categories: [category] }))).toBe('Comms')
  })

  it('falls back to the id itself when neither a built-in nor a stored category matches', () => {
    expect(categoryLabelFor('ghost-category', profile())).toBe('ghost-category')
  })

  it('treats a profile with no categories field the same as an empty list (pre-story-008 profiles)', () => {
    expect(categoryLabelFor('ghost-category', profile({ categories: undefined }))).toBe('ghost-category')
  })
})

describe('MOVEMENT_ACTIONS labels', () => {
  it.each(MOVEMENT_ACTIONS.map((row) => [row.id, row.labelKey, row.label] as const))(
    '%s: label is non-empty ASCII and matches en.json',
    (_id, labelKey, label) => {
      expect(label).toMatch(ASCII_PRINTABLE)
      expect(label).toBe(stringAt(labelKey))
    },
  )
})

describe('WEAPON_ACTIONS labels', () => {
  it.each(WEAPON_ACTIONS.map((row) => [row.id, row.labelKey, row.label] as const))(
    '%s: label is non-empty ASCII and matches en.json',
    (_id, labelKey, label) => {
      expect(label).toMatch(ASCII_PRINTABLE)
      expect(label).toBe(stringAt(labelKey))
    },
  )
})

describe('WEAPON_EXTRA_ACTIONS labels', () => {
  it.each(WEAPON_EXTRA_ACTIONS.map((row) => [row.id, row.labelKey, row.label] as const))(
    '%s: label is non-empty ASCII and matches en.json',
    (_id, labelKey, label) => {
      expect(label).toMatch(ASCII_PRINTABLE)
      expect(label).toBe(stringAt(labelKey))
    },
  )
})

describe('DROPPABLES labels', () => {
  it.each(DROPPABLES.map((row) => [row.id, row.labelKey, row.label] as const))(
    '%s: label is non-empty ASCII and matches en.json',
    (_id, labelKey, label) => {
      expect(label).toMatch(ASCII_PRINTABLE)
      expect(label).toBe(stringAt(labelKey))
    },
  )
})

describe('DROP_ACTIONS labels', () => {
  it.each(DROP_ACTIONS.map((row) => [row.id, row.labelKey, row.label] as const))(
    '%s: label is non-empty ASCII and matches en.json',
    (_id, labelKey, label) => {
      expect(label).toMatch(ASCII_PRINTABLE)
      expect(label).toBe(stringAt(labelKey))
    },
  )
})

describe('BUILT_IN_ACTION_CATEGORIES labels', () => {
  it.each(BUILT_IN_ACTION_CATEGORIES.map((category) => [category.id, category.labelKey, category.label] as const))(
    '%s: label is non-empty ASCII and matches en.json',
    (_id, labelKey, label) => {
      expect(label).toMatch(ASCII_PRINTABLE)
      expect(label).toBe(stringAt(labelKey))
    },
  )
})

describe('CVAR_GROUP_LABELS', () => {
  it.each(CVAR_GROUP_ORDER.map((group) => [group, CVAR_GROUP_LABELS[group]] as const))(
    '%s: label is non-empty ASCII and matches en.json',
    (group, label) => {
      expect(label).toMatch(ASCII_PRINTABLE)
      expect(label).toBe(stringAt(`config.settings.groups.${group}`))
    },
  )
})
