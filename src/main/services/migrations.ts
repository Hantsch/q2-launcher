import { randomUUID } from 'node:crypto'
import { STATE_SCHEMA_VERSION } from '@shared/constants'
import { allCatalogRows, commandsForRow, nameForCatalogRow } from '@shared/config/catalog-rows'
import { TEMPLATE_ACTION_CATEGORIES, TEMPLATE_BOUND_CATALOG_IDS } from '@shared/modules/config'
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
