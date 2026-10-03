import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderProfileFile } from '@shared/config/render/render'
import { restoreProfileParts } from '@shared/config/profile/profile-restore'
import {
  restoredToProfileFields,
  type RestoredProfileFields,
} from '@shared/config/profile/profile-restore-input'
import { ROUND_TRIP_FIXTURES } from '@shared/config/fixtures/profiles'
import { toRestoreInput } from '../import'
import { readFileState } from '../file-source'
import { getRoundTripRoot, installRoundTripRoot, reimport } from './helpers'

installRoundTripRoot()

/** Fixtures whose two paths legitimately differ, each with the reason. Empty: none does today. */
const EXCLUDED: Record<string, string> = {}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** Both paths mint category/layer ids locally, so ids are compared by first appearance. */
function normalised(fields: RestoredProfileFields): string {
  const seen = new Map<string, string>()
  return JSON.stringify({
    cvars: fields.cvars,
    binds: fields.binds,
    // The two readers fold lines in their own scan order, so entries of one section can come back
    // in a different array order; the rendered file does not depend on it.
    actions: [...fields.actions].sort((a, b) => a.name.localeCompare(b.name)),
    categories: fields.categories,
    cvarSections: fields.cvarSections,
    layers: fields.layers,
  }).replace(UUID, (id) => {
    if (!seen.has(id)) seen.set(id, `ID${seen.size}`)
    return seen.get(id)!
  })
}

describe('import and refresh', () => {
  for (const profile of ROUND_TRIP_FIXTURES) {
    const excluded = EXCLUDED[profile.name]
    const run = excluded === undefined ? it : it.skip
    run(
      `import and refresh restore the same profile fields from a launcher-written file: ${profile.name}`,
      async () => {
        const text = renderProfileFile(profile)
        const result = await reimport(text)
        const imported = restoredToProfileFields(
          result.cvars,
          result.binds,
          restoreProfileParts(toRestoreInput(result, [], randomUUID)),
        )

        const read = await readFileState(join(getRoundTripRoot(), 'baseq2'), 'config.cfg', null)
        expect(read.state).toBe('changedOnDisk')
        if (read.state !== 'changedOnDisk') return

        expect(normalised(read.profile)).toBe(normalised(imported))
      },
    )
  }
})
