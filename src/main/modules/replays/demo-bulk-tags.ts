import type { SidecarFields } from '@shared/replays/sidecar'
import type { BulkItemOutcome, BulkOutcome } from '@shared/replays/bulk'
import { mergeTags } from '@shared/replays/sidecar-draft'
import { fail, ok, type Outcome } from '@shared/types/common'
import type { ReplaysScanService } from './scan-service'
import type { SidecarStore } from './sidecar-store'

/**
 * Adds and removes tags on several demos at once, addressed by id. Each demo is read fresh and
 * written on its own, so one broken sidecar never stops the rest. A sidecar that does not parse is
 * never overwritten: the user's file may hold more than the launcher understands (story 244)
 *
 * Tags do not move files, so the index is untouched; the renderer re-reads the rows.
 */

export interface CreateDemoBulkTagsOptions {
  scan: Pick<ReplaysScanService, 'resolveFile' | 'isScanning'>
  sidecars: Pick<SidecarStore, 'read' | 'write'>
}

export interface DemoBulkTagsService {
  tag(ids: string[], add: string[], remove: string[]): Promise<Outcome<BulkOutcome>>
}

const reason = (key: string): string => `replays.bulk.reason.${key}`

function item(
  demoId: string,
  status: BulkItemOutcome['status'],
  key: string | null,
  params?: Record<string, string | number>,
): BulkItemOutcome {
  const reasonKey = key === null ? null : reason(key)
  return {
    demoId,
    status,
    reasonKey,
    ...(params ? { params } : {}),
  }
}

export function createDemoBulkTags(options: CreateDemoBulkTagsOptions): DemoBulkTagsService {
  const { scan, sidecars } = options

  async function tagOne(id: string, add: string[], remove: string[]): Promise<BulkItemOutcome> {
    const resolved = scan.resolveFile(id)
    if (resolved === undefined) return item(id, 'failed', 'unknownDemo')
    if (resolved.archiveEntry !== null) return item(id, 'skipped', 'archiveEntry')

    const read = await sidecars.read(id)
    if (!read.ok) return item(id, 'failed', 'sidecarBroken')
    if (read.value.state.state === 'error') return item(id, 'failed', 'sidecarBroken')

    const { values } = read.value
    const before = values.tags ?? []
    const merged = mergeTags(before, add, remove)
    if (merged.overflow) return item(id, 'failed', 'tagLimit')
    if (merged.tags.length === before.length && merged.tags.every((t, i) => t === before[i])) {
      return item(id, 'done', null)
    }

    const { tags: _old, ...rest } = values
    const fields: SidecarFields = merged.tags.length === 0 ? rest : { ...rest, tags: merged.tags }
    const written = await sidecars.write(id, fields)
    if (!written.ok || written.value.status !== 'saved') {
      return item(id, 'failed', 'sidecarWriteFailed')
    }
    return item(id, 'done', null)
  }

  return {
    async tag(ids, add, remove) {
      if (scan.isScanning()) return fail('replays.bulk.error.scanning')
      const items: BulkItemOutcome[] = []
      for (const id of new Set(ids)) items.push(await tagOne(id, add, remove))
      return ok({ items })
    },
  }
}
