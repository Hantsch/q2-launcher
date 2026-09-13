import { randomUUID } from 'node:crypto'
import { STATE_SCHEMA_VERSION } from '@shared/constants'
import { allCatalogRows, commandsForRow, nameForCatalogRow } from '@shared/config/catalog-rows'
import { findCvar } from '@shared/config/cvar-catalog'
import {
  buildTemplateCvarSections,
  TEMPLATE_ACTION_CATEGORIES,
  TEMPLATE_BOUND_CATALOG_IDS,
} from '@shared/modules/config'
import { scopedLogger } from '../lib/logger'

const log = scopedLogger('migrations')

type RawDocument = Record<string, unknown>

export interface MigrationStep {
  /** Schema version this step produces. */
  to: number
  /** Short description, logged when the step runs. */
  describe: string
  apply: (doc: RawDocument) => RawDocument
}

/**
 * Ordered migrations for `state.json`.
 *
 * Rules that keep this safe as the launcher grows:
 *  - never edit a shipped step; add a new one
 *  - a step must be pure and must not throw (a bad step means data loss)
 *  - bump `STATE_SCHEMA_VERSION` in the same commit as the new step
 *
 * Example of the next one:
 *
 * ```ts
 * {
 *   to: 2,
 *   describe: 'move per-install cvar overrides into moduleData.config',
 *   apply: (doc) => {
 *     const installations = Array.isArray(doc.installations) ? doc.installations : []
 *     return {
 *       ...doc,
 *       installations: installations.map((raw) => {
 *         const install = raw as Record<string, unknown>
 *         const { cvars, ...rest } = install
 *         if (!cvars) return install
 *         const moduleData = (install.moduleData as Record<string, unknown>) ?? {}
 *         return { ...rest, moduleData: { ...moduleData, config: { cvars } } }
 *       }),
 *     }
 *   },
 * }
 * ```
 */
export const MIGRATIONS: readonly MigrationStep[] = [
  {
    to: 2,
    describe:
      'materialise every catalogue row into the three template categories for every profile ' +
      '(story 052 D6: the rows used to be rendered live from the catalogue, never persisted)',
    apply: (doc) => {
      const profiles = Array.isArray(doc.configProfiles) ? doc.configProfiles : []
      return {
        ...doc,
        configProfiles: profiles.map((raw) => materialiseTemplateCategories(raw as Record<string, unknown>)),
      }
    },
  },
  {
    to: 3,
    describe:
      'seed cvarSections (Player/Network/Graphics/Sound + Other) for every profile that predates ' +
      'story 059 (D6: Settings used to render live from the catalogue group, never persisted)',
    apply: (doc) => {
      const profiles = Array.isArray(doc.configProfiles) ? doc.configProfiles : []
      return {
        ...doc,
        configProfiles: profiles.map((raw) => materialiseCvarSections(raw as Record<string, unknown>)),
      }
    },
  },
]

/**
 * Story 052 D6: adds the three `TEMPLATE_ACTION_CATEGORIES` (movement/weapons/drops) to a profile's
 * `categories` if not already present, and one action per `allCatalogRows()` row to `actions` for
 * any `catalogId` the profile does not already have an action for - existing categories/actions are
 * left exactly as they are (untouched, same position), new ones are appended at the end in the
 * catalogue's own order. Before this story these three categories and their rows were rendered live
 * from the hardcoded catalogue and never stored in the profile at all; once the renderer stops doing
 * that lazy materialisation (later deliverables in this story), every still-unbound row a
 * pre-existing profile does not persist would silently disappear from its Controls tab - this is
 * what stops that from happening.
 *
 * Idempotent by construction: a profile that already carries all three categories and every
 * catalogue row's action (e.g. because this step already ran once) matches every "already present"
 * check below and gets nothing appended - only `dirty` is (re)set, which is itself idempotent.
 *
 * Marks the profile dirty rather than touching its canonical file (Decisions taken during refine:
 * "the migration writes the cache and marks the profile dirty, it does not write the user's file
 * unprompted") - `dirty === true` is exactly the flag the save pipeline
 * (`main/modules/config/index.ts`, `profiles.ts#setDirty`) already uses to mean "this profile has
 * pending edits", so the existing unsaved-changes bar picks this up for free.
 */
function materialiseTemplateCategories(raw: Record<string, unknown>): Record<string, unknown> {
  const categories = Array.isArray(raw.categories) ? [...(raw.categories as Record<string, unknown>[])] : []
  const actions = Array.isArray(raw.actions) ? [...(raw.actions as Record<string, unknown>[])] : []

  const existingCategoryIds = new Set(categories.map((category) => category.id))
  for (const category of TEMPLATE_ACTION_CATEGORIES) {
    if (existingCategoryIds.has(category.id)) continue
    categories.push({ id: category.id, name: category.label, nameKey: category.labelKey })
  }

  const existingCatalogIds = new Set(
    actions
      .map((action) => action.catalogId)
      .filter((catalogId): catalogId is string => typeof catalogId === 'string'),
  )
  for (const row of allCatalogRows()) {
    if (existingCatalogIds.has(row.catalogId)) continue
    // F1 fix (story 052 review): a row that is one of the template's own six default-bound
    // catalogIds must get the SAME real command `buildTemplateActions` gives it, not `commands: []`
    // - otherwise `adoptRawBinds`'s signature match can never recognise the profile's own matching
    // raw bind as this row, and the Controls tab shows the row as unbound even though the key still
    // works in-game. Every other row is genuinely unbound, exactly as before.
    const bound = TEMPLATE_BOUND_CATALOG_IDS.has(row.catalogId)
    actions.push({
      id: randomUUID(),
      categoryId: row.categoryId,
      name: nameForCatalogRow(row),
      kind: 'bind',
      catalogId: row.catalogId,
      commands: bound ? commandsForRow(row, false) : [],
    })
  }

  return { ...raw, categories, actions, dirty: true }
}

/** Reserved id/label for the migration's own "Other" section - a REAL, taggable `ConfigCvarSection`
 * (`cvs=other` once rendered), not the writer's untagged reserved bucket of the same display name
 * (`render.ts`'s `OTHER_CVAR_GROUP_LABEL`). The two coexist without collision: the writer's bucket
 * only ever catches non-catalogue cvars that no *real* section claims, and this migration always
 * gives every non-catalogue cvar it finds a real, explicit home in this section, so nothing is left
 * for the writer's untagged bucket to pick up - both would render identically either way, since
 * they use the same label. */
const MIGRATED_OTHER_SECTION_ID = 'other'
const MIGRATED_OTHER_SECTION_LABEL = 'Other'

/**
 * Story 059 D6: seeds `cvarSections` once for a profile that predates the feature - every profile
 * whose `cvarSections` is missing entirely (a NEW profile created after D1 shipped already gets one
 * from `create()`/import, so this only ever fires for an old one). Mirrors
 * `materialiseTemplateCategories` right above: idempotent by construction (a profile that already
 * has `cvarSections` - including one this step already seeded - is returned untouched, so a second
 * run is a byte-identical no-op), and marks the profile dirty rather than touching its canonical
 * file, same precedent and same reason.
 *
 * Seeds all four groups with EVERY `ALL_CVARS` name, exactly like `STANDARD_TEMPLATE.cvarSections`
 * seeds a brand-new template profile - regardless of whether the migrating profile actually has a
 * stored value for a given catalogue cvar. This makes a migrated profile's Settings tab match a
 * template profile's shape (AC7 / Test Plan step 9: "catalogue ones in the four sections"), rather
 * than a sparse subset that leaves most catalogue cvars to fall into the reserved `Defaults` bucket.
 *
 * Any key of `profile.cvars` that is not a catalogue cvar at all (`findCvar` - the same
 * case-insensitive lookup the writer/reader use to tell "claimed" from "unclaimed" cvars) goes into
 * one appended `Other` section, in the order `Object.keys` gives them (insertion order, same as
 * every other raw-document read in this file) - omitted entirely when empty, so a profile with no
 * non-catalogue cvars gets exactly the four groups and nothing else.
 */
function materialiseCvarSections(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.cvarSections !== undefined) return raw

  const cvars = raw.cvars && typeof raw.cvars === 'object' ? (raw.cvars as Record<string, string>) : {}
  const keys = Object.keys(cvars)

  const sections = buildTemplateCvarSections()

  const otherCvars = keys.filter((key) => !findCvar(key))
  if (otherCvars.length > 0) {
    sections.push({ id: MIGRATED_OTHER_SECTION_ID, name: MIGRATED_OTHER_SECTION_LABEL, cvars: otherCvars })
  }

  return { ...raw, cvarSections: sections, writeCatalogDefaults: true, dirty: true }
}

export interface MigrationOutcome {
  doc: RawDocument
  /** True when at least one step ran, so the caller knows to write the file back. */
  migrated: boolean
}

export function migrateStateDocument(raw: unknown): MigrationOutcome {
  if (typeof raw !== 'object' || raw === null) return { doc: {}, migrated: false }

  let doc = raw as RawDocument
  const rawVersion = doc['schemaVersion']
  let version = typeof rawVersion === 'number' ? rawVersion : 0
  let migrated = false

  if (version > STATE_SCHEMA_VERSION) {
    // A newer launcher wrote this file. Leave it alone and let the lenient
    // parsers keep what they understand rather than "downgrading" anything.
    log.warn(`state file is version ${version}, this build understands ${STATE_SCHEMA_VERSION}`)
    return { doc, migrated: false }
  }

  for (const step of MIGRATIONS) {
    if (step.to <= version) continue
    log.info(`migrating state ${version} -> ${step.to}: ${step.describe}`)
    doc = step.apply(doc)
    version = step.to
    migrated = true
  }

  doc['schemaVersion'] = STATE_SCHEMA_VERSION
  return { doc, migrated }
}
