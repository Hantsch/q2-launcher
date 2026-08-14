import { STATE_SCHEMA_VERSION } from '@shared/constants'
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
export const MIGRATIONS: readonly MigrationStep[] = []

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
