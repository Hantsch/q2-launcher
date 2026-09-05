import { describe, expect, it } from 'vitest'
import { allCatalogRows } from '@shared/config/catalog-rows'
import { STANDARD_TEMPLATE, TEMPLATE_ACTION_CATEGORIES, TEMPLATE_BOUND_CATALOG_IDS } from '@shared/modules/config'
import { STATE_SCHEMA_VERSION } from '@shared/constants'
import { parseConfigProfiles } from '../lib/schemas'
import { MIGRATIONS, migrateStateDocument } from './migrations'

/** Grabs the D6 step's own `apply` directly, so tests can call it twice without going through the
 * whole-document version gate `migrateStateDocument` enforces. */
const migrateCategories = MIGRATIONS.find((step) => step.to === 2)!.apply

function profileWithActions(actions: Record<string, unknown>[]): Record<string, unknown> {
  return {
    id: 'p1',
    name: 'Pre-existing profile',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    actions,
  }
}

describe('migrations (story 052 D6)', () => {
  it('bumps STATE_SCHEMA_VERSION to 2, one past the pre-052 baseline', () => {
    expect(STATE_SCHEMA_VERSION).toBe(2)
  })

  it('adds the three template categories and every missing catalogue row, keeping existing actions in place', () => {
    const rows = allCatalogRows()
    const firstRow = rows[0]!
    const existingAction = {
      id: 'existing-action',
      categoryId: firstRow.categoryId,
      name: 'My forward bind',
      kind: 'bind',
      catalogId: firstRow.catalogId,
      commands: [{ kind: 'raw', text: '+forward' }],
    }
    const freeformAction = {
      id: 'freeform-action',
      categoryId: 'custom',
      name: 'Quicksave',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'save quick' }],
    }

    const doc = { schemaVersion: 1, configProfiles: [profileWithActions([existingAction, freeformAction])] }
    const migrated = migrateCategories(doc)
    const profiles = migrated.configProfiles as Record<string, unknown>[]
    const profile = profiles[0]!
    const actions = profile.actions as Record<string, unknown>[]
    const categories = profile.categories as Record<string, unknown>[]

    // Existing actions stay exactly where they were, untouched.
    expect(actions[0]).toEqual(existingAction)
    expect(actions[1]).toEqual(freeformAction)

    // The three template categories are present, in catalogue order, appended after nothing else
    // existed before.
    expect(categories.map((c) => c.id)).toEqual(TEMPLATE_ACTION_CATEGORIES.map((c) => c.id))
    for (const category of categories) {
      const template = TEMPLATE_ACTION_CATEGORIES.find((c) => c.id === category.id)!
      expect(category.name).toBe(template.label)
      expect(category.nameKey).toBe(template.labelKey)
    }

    // Every catalogue row now has an action: the existing one for `firstRow.catalogId`, plus one
    // freshly materialised (unbound) action per remaining row.
    const catalogIdsPresent = new Set(
      actions.map((a) => a.catalogId).filter((id): id is string => typeof id === 'string'),
    )
    for (const row of rows) {
      expect(catalogIdsPresent.has(row.catalogId)).toBe(true)
    }
    expect(actions.length).toBe(2 + rows.length - 1) // existingAction already covers firstRow

    // New catalogue rows are appended after existing actions, in catalogue order. Unbound, except
    // for the template's own six default-bound catalogIds (story 052 review, F1), which must carry
    // the same real command `buildTemplateActions` gives them so `adoptRawBinds` can still recognise
    // a matching raw bind as this row.
    const appended = actions.slice(2)
    expect(appended.map((a) => a.catalogId)).toEqual(rows.filter((r) => r.catalogId !== firstRow.catalogId).map((r) => r.catalogId))
    for (const action of appended) {
      const catalogId = action.catalogId as string
      if (TEMPLATE_BOUND_CATALOG_IDS.has(catalogId)) {
        expect(action.commands).not.toEqual([])
      } else {
        expect(action.commands).toEqual([])
      }
    }

    // The profile is marked dirty so the unsaved-changes bar shows what Save would add.
    expect(profile.dirty).toBe(true)
  })

  it('is idempotent: running the migration a second time on already-migrated data changes nothing', () => {
    const doc = { schemaVersion: 1, configProfiles: [profileWithActions([])] }
    const once = migrateCategories(doc)
    const twice = migrateCategories(once)

    expect(twice).toEqual(once)
  })

  it('a profile with no existing actions gets a fully materialised template matching a fresh `from: template` profile', () => {
    const doc = { schemaVersion: 1, configProfiles: [profileWithActions([])] }
    const migrated = migrateCategories(doc)
    const profile = (migrated.configProfiles as Record<string, unknown>[])[0]!
    const actions = profile.actions as Record<string, unknown>[]
    const categories = profile.categories as Record<string, unknown>[]

    expect(categories.map((c) => ({ id: c.id, name: c.name, nameKey: c.nameKey }))).toEqual(
      STANDARD_TEMPLATE.categories.map((c) => ({ id: c.id, name: c.name, nameKey: c.nameKey })),
    )

    // Same catalogId/categoryId/name/kind shape and order as the standard template - only `id`
    // legitimately differs (fresh random ids). Story 052 review, F1: the six catalogIds the
    // template's own `binds` names (`TEMPLATE_BOUND_CATALOG_IDS`) must carry the SAME real command
    // `buildTemplateActions` gives them, not `commands: []` - otherwise `adoptRawBinds` can never
    // recognise a pre-existing profile's matching raw bind as this row (see the end-to-end test
    // below). Every other row is genuinely unbound.
    expect(actions.map((a) => a.catalogId)).toEqual(STANDARD_TEMPLATE.actions.map((a) => a.catalogId))
    expect(actions.map((a) => a.categoryId)).toEqual(STANDARD_TEMPLATE.actions.map((a) => a.categoryId))
    expect(actions.map((a) => a.name)).toEqual(STANDARD_TEMPLATE.actions.map((a) => a.name))
    expect(actions.map((a) => a.kind)).toEqual(STANDARD_TEMPLATE.actions.map((a) => a.kind))
    expect(actions.map((a) => a.commands)).toEqual(STANDARD_TEMPLATE.actions.map((a) => a.commands))
    for (const action of actions) {
      expect(typeof action.id).toBe('string')
      if (typeof action.catalogId === 'string' && TEMPLATE_BOUND_CATALOG_IDS.has(action.catalogId)) {
        expect(action.commands).not.toEqual([])
      }
    }
  })

  it('F1 (story 052 review): a migrated action for one of the six default-bound catalogIds ' +
    'carries the real command, so a pre-existing profile whose raw binds match the template default ' +
    'still gets its keys adopted after migration - not commands: [] and an unadopted raw bind', () => {
    // A pre-existing profile that has never stored `actions`/`categories` at all (pre-story-008 or
    // pre-052 shape), whose raw `binds` happen to match two of the template's own six default-bound
    // catalogIds (forward/moveup), exactly the scenario the bug report describes.
    const rawProfile = {
      id: 'p1',
      name: 'Pre-existing profile',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      cvars: {},
      binds: { UPARROW: '+forward', SPACE: '+moveup' },
      assignments: [],
      actions: [],
    }

    const doc = { schemaVersion: 1, configProfiles: [rawProfile] }
    const { doc: migratedDoc } = migrateStateDocument(doc)

    // Run the exact pipeline `StateStore`/`state.ts` runs on load: parse + normalise, which chains
    // `adoptRawBinds` after whatever the migration produced.
    const profiles = parseConfigProfiles(migratedDoc['configProfiles'])
    const profile = profiles[0]!

    const forwardAction = profile.actions?.find((a) => a.catalogId === 'movement:forward')
    const moveupAction = profile.actions?.find((a) => a.catalogId === 'movement:moveup')
    expect(forwardAction).toBeDefined()
    expect(moveupAction).toBeDefined()

    // The bug: before the fix, the migration wrote `commands: []` for these rows, so
    // `adoptRawBinds`'s signature check bailed and the raw bind was never adopted - the action came
    // back with no keys at all despite the raw bind existing and working in-game.
    expect(forwardAction?.commands).not.toEqual([])
    expect(moveupAction?.commands).not.toEqual([])
    expect(forwardAction?.keys?.some((slot) => slot.key === 'UPARROW')).toBe(true)
    expect(moveupAction?.keys?.some((slot) => slot.key === 'SPACE')).toBe(true)
  })

  it('migrateStateDocument runs the step once for a v1 (or unversioned) document and is a no-op for an already-current one', () => {
    const doc = { configProfiles: [profileWithActions([])] }
    const first = migrateStateDocument(doc)
    expect(first.migrated).toBe(true)
    expect(first.doc.schemaVersion).toBe(STATE_SCHEMA_VERSION)

    const second = migrateStateDocument(first.doc)
    expect(second.migrated).toBe(false)
    expect(second.doc).toEqual(first.doc)
  })
})
