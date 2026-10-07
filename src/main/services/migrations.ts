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
 * A step list is a boot-time wiring input (each module contributes its own), so a list that
 * cannot take a document to the current schema is a programming error, not a data problem.
 */
function assertStepsReachCurrentVersion(steps: readonly MigrationStep[]): void {
  let previous = 1
  for (const step of steps) {
    if (step.to <= previous) {
      throw new Error(`migration steps must have strictly ascending "to" values (got ${step.to})`)
    }
    previous = step.to
  }
  if (previous !== STATE_SCHEMA_VERSION) {
    throw new Error(
      `migration steps end at version ${previous}, expected STATE_SCHEMA_VERSION ${STATE_SCHEMA_VERSION}`,
    )
  }
}

export interface MigrationOutcome {
  doc: RawDocument
  /** True when at least one step ran, so the caller knows to write the file back. */
  migrated: boolean
}

export function migrateStateDocument(
  raw: unknown,
  steps: readonly MigrationStep[],
): MigrationOutcome {
  assertStepsReachCurrentVersion(steps)
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

  for (const step of steps) {
    if (step.to <= version) continue
    log.info(`migrating state ${version} -> ${step.to}: ${step.describe}`)
    doc = step.apply(doc)
    version = step.to
    migrated = true
  }

  doc['schemaVersion'] = STATE_SCHEMA_VERSION
  return { doc, migrated }
}
