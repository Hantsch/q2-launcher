import { describe, expect, it } from 'vitest'
import { allCatalogRows } from '@shared/config/catalog-rows'
import { STANDARD_TEMPLATE, TEMPLATE_ACTION_CATEGORIES, TEMPLATE_BOUND_CATALOG_IDS } from '@shared/modules/config'
// (STANDARD_TEMPLATE is also used by the story 059 D6 tests below, to assert the migration's
// seeded cvarSections match the template's own full-catalogue seeding.)
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
  it('bumps the schema to 2, one past the pre-052 baseline', () => {
    expect(MIGRATIONS.find((step) => step.to === 2)).toBeDefined()
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

/** Grabs the D6 step's own `apply` directly, so tests can call it twice without going through the
 * whole-document version gate `migrateStateDocument` enforces. */
const migrateCvarSections = MIGRATIONS.find((step) => step.to === 3)!.apply

function profileWithCvars(cvars: Record<string, string>): Record<string, unknown> {
  return {
    id: 'p1',
    name: 'Pre-existing profile',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    cvars,
    binds: {},
    assignments: [],
  }
}

describe('migrations (story 059 D6)', () => {
  it('bumps STATE_SCHEMA_VERSION to 3, one past the story 052 baseline', () => {
    expect(STATE_SCHEMA_VERSION).toBe(3)
  })

  it('seeds all four catalogue-group sections with EVERY ALL_CVARS name (not just the ones the profile has), plus an Other section for non-catalogue keys, preserving every cvar value', () => {
    const doc = {
      schemaVersion: 2,
      configProfiles: [
        profileWithCvars({
          // Catalogue cvars, deliberately spread across the four groups. Deliberately a small
          // subset of ALL_CVARS - the point of this test is that the seeded sections carry EVERY
          // catalogue cvar in their group regardless, not only these customized ones.
          sensitivity: '5', // player
          rate: '25000', // network
          gl_dynamic: '1', // graphics
          s_volume: '0.8', // sound
          // A catalogue cvar typed with different casing than the catalogue's own - must still be
          // recognised (case-insensitive) as a catalogue cvar (so it does NOT land in Other).
          SENSITIVITY: '9',
          // Not a catalogue cvar at all.
          my_custom_cvar: 'hello',
        }),
      ],
    }

    const migrated = migrateCvarSections(doc)
    const profile = (migrated.configProfiles as Record<string, unknown>[])[0]!
    const sections = profile.cvarSections as { id: string; name: string; cvars: string[] }[]

    // The four catalogue groups are always present, in `CVAR_GROUP_ORDER` order.
    expect(sections.slice(0, 4).map((s) => s.id)).toEqual(['player', 'network', 'graphics', 'sound'])

    // Every section matches the template's own seeding exactly - the full catalogue's worth of
    // names per group, not narrowed to what the profile happens to customize.
    const template = STANDARD_TEMPLATE.cvarSections!
    for (const groupId of ['player', 'network', 'graphics', 'sound']) {
      const migratedCvars = sections.find((s) => s.id === groupId)!.cvars
      const templateCvars = template.find((s) => s.id === groupId)!.cvars
      expect(migratedCvars).toEqual(templateCvars)
    }

    // The profile's own customized catalogue cvars are still findable inside their group (proving
    // the seeding is the full catalogue, not an empty template unrelated to the profile).
    const playerCvars = sections.find((s) => s.id === 'player')!.cvars
    const networkCvars = sections.find((s) => s.id === 'network')!.cvars
    const graphicsCvars = sections.find((s) => s.id === 'graphics')!.cvars
    const soundCvars = sections.find((s) => s.id === 'sound')!.cvars
    expect(playerCvars).toContain('sensitivity')
    expect(networkCvars).toContain('rate')
    expect(graphicsCvars).toContain('gl_dynamic')
    expect(soundCvars).toContain('s_volume')

    // Non-catalogue cvars land in a real, appended "Other" section.
    const other = sections.find((s) => s.id === 'other')!
    expect(other.name).toBe('Other')
    expect(other.cvars).toEqual(['my_custom_cvar'])

    // No value is lost: the raw `cvars` map itself is untouched.
    expect(profile.cvars).toEqual({
      sensitivity: '5',
      rate: '25000',
      gl_dynamic: '1',
      s_volume: '0.8',
      SENSITIVITY: '9',
      my_custom_cvar: 'hello',
    })

    // `writeCatalogDefaults` and `dirty` are set so the writer/save pipeline pick this up.
    expect(profile.writeCatalogDefaults).toBe(true)
    expect(profile.dirty).toBe(true)
  })

  it('seeds the full catalogue even when the profile customized none of it - matching a fresh template profile\'s shape exactly', () => {
    const doc = { schemaVersion: 2, configProfiles: [profileWithCvars({})] }
    const migrated = migrateCvarSections(doc)
    const profile = (migrated.configProfiles as Record<string, unknown>[])[0]!
    const sections = profile.cvarSections as { id: string; name: string; nameKey?: string; cvars: string[] }[]

    expect(sections).toEqual(STANDARD_TEMPLATE.cvarSections)
  })

  it('omits the Other section entirely when every stored cvar is a catalogue cvar', () => {
    const doc = { schemaVersion: 2, configProfiles: [profileWithCvars({ sensitivity: '3' })] }
    const migrated = migrateCvarSections(doc)
    const profile = (migrated.configProfiles as Record<string, unknown>[])[0]!
    const sections = profile.cvarSections as { id: string }[]

    expect(sections.map((s) => s.id)).toEqual(['player', 'network', 'graphics', 'sound'])
  })

  it('does nothing to a profile that already has cvarSections, including one created after story 059 shipped', () => {
    const alreadyMigrated = { ...profileWithCvars({ sensitivity: '3' }), cvarSections: [] }
    const doc = { schemaVersion: 2, configProfiles: [alreadyMigrated] }
    const migrated = migrateCvarSections(doc)
    const profile = (migrated.configProfiles as Record<string, unknown>[])[0]!

    expect(profile).toEqual(alreadyMigrated)
    expect(profile.writeCatalogDefaults).toBeUndefined()
    expect(profile.dirty).toBeUndefined()
  })

  it('is idempotent: running the migration a second time on already-migrated data changes nothing', () => {
    const doc = { schemaVersion: 2, configProfiles: [profileWithCvars({ sensitivity: '3', my_cvar: 'x' })] }
    const once = migrateCvarSections(doc)
    const twice = migrateCvarSections(once)

    expect(twice).toEqual(once)
  })

  it('migrateStateDocument runs both story 052 and story 059 steps in order for a pre-052 document', () => {
    const doc = { configProfiles: [profileWithCvars({ sensitivity: '3' })] }
    const { doc: migratedDoc, migrated } = migrateStateDocument(doc)
    const profile = (migratedDoc.configProfiles as Record<string, unknown>[])[0]!

    expect(migrated).toBe(true)
    expect(migratedDoc.schemaVersion).toBe(STATE_SCHEMA_VERSION)
    expect(Array.isArray(profile.categories)).toBe(true)
    expect(Array.isArray(profile.cvarSections)).toBe(true)
  })
})
