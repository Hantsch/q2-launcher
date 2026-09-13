import { join } from 'node:path'
import { z } from 'zod'
import type { UpdateState } from '@shared/types/update'
import { JsonStore } from '../../lib/json-store'
import { userDataDir } from '../../lib/paths'

/**
 * Story 097 D2: the update-check service's own file under `userData`.
 *
 * `update-check.json`, its own file via `JsonStore` and deliberately **not** part of `state.json`
 * (Decisions (Sprint)): a regenerable record derived from foreign content (a GitHub release) has
 * no business next to the installation list, and keeping it separate leaves `state.ts` and its
 * schema untouched.
 *
 * It holds three things:
 *
 *  - `update` - the last *known* available release (version, notes, releasedAt), or `null` when
 *    none is known. Mirrors `UpdateState['update']` (`src/shared/types/update.ts`) exactly, so the
 *    service can hand a loaded record straight to the renderer without reshaping it.
 *  - `lastCheckedAt` - when the last check attempt (success or failure) completed.
 *  - `lastSuccessAt` - when the last *successful* check completed; this is what the service's 24h
 *    window (AC4) is measured from, so a failed attempt never burns it.
 *
 * ## A damaged file degrades to "nothing known", never to an exception
 *
 * `load()` answers `{ update: null, lastCheckedAt: null, lastSuccessAt: null }` - the same shape a
 * store that has never been written to reads as - when the file is missing, empty, unparseable
 * JSON, from another cache version, or does not satisfy the schema below. This is a file on disk:
 * it can be hand-edited, truncated by a full disk, or left over from an older launcher. "Nothing
 * known" costs one wasted check; a throw on a cache read would break app start, which is precisely
 * what AC8 says must stay quiet. `JsonStore` already sets an unparseable file aside as
 * `<file>.corrupt-<n>` and falls back to `<file>.bak`, so the degradation is not silent to a
 * developer reading the log either.
 */

/** Bumping this discards existing files instead of reading an older layout - a cache nobody would
 * miss is not worth a migration. */
export const UPDATE_CACHE_VERSION = 1

export const UPDATE_CHECK_STORE_FILE = 'update-check.json'

/** `userData/update-check.json`. */
export function updateCheckStoreFilePath(): string {
  return join(userDataDir(), UPDATE_CHECK_STORE_FILE)
}

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`). */
export interface UpdateCheckStoreLog {
  warn(message: string): void
}

/** What the service persists between checks. Same shape as `UpdateState`'s own three fields. */
export interface UpdateCheckStoreData {
  update: UpdateState['update']
  lastCheckedAt: UpdateState['lastCheckedAt']
  lastSuccessAt: UpdateState['lastSuccessAt']
}

/** "Nothing known" - the same default a store that has never been written to reads as. */
const NOTHING_KNOWN: UpdateCheckStoreData = {
  update: null,
  lastCheckedAt: null,
  lastSuccessAt: null,
}

/** The persisted document: the data plus the envelope version. `null` is "nothing known". */
type UpdateCheckDocument = (UpdateCheckStoreData & { cacheVersion: number }) | null

const updateSchema = z
  .object({
    version: z.string().min(1),
    notes: z.string(),
    releasedAt: z.string().nullable(),
  })
  .nullable()

const storeDocumentSchema = z.object({
  cacheVersion: z.literal(UPDATE_CACHE_VERSION),
  update: updateSchema,
  lastCheckedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
})

/**
 * `JsonStore`'s `parse`, which may never throw. Anything it cannot fully vouch for becomes `null`,
 * i.e. "nothing known" - one wasted check instead of a state built from junk.
 */
function parseStoreDocument(raw: unknown, log?: UpdateCheckStoreLog): UpdateCheckDocument {
  const parsed = storeDocumentSchema.safeParse(raw)
  if (!parsed.success) {
    log?.warn(
      `update-check store discarded: ${parsed.error.issues[0]?.message ?? 'malformed store file'}`,
    )
    return null
  }

  return {
    cacheVersion: UPDATE_CACHE_VERSION,
    update: parsed.data.update,
    lastCheckedAt: parsed.data.lastCheckedAt,
    lastSuccessAt: parsed.data.lastSuccessAt,
  }
}

export interface UpdateCheckStoreOptions {
  /** Defaults to `updateCheckStoreFilePath()`; a parameter so the tests write to a temp directory. */
  filePath?: string
  log?: UpdateCheckStoreLog
}

/**
 * The update-check store. One instance per process (the service owns it): `JsonStore` serialises
 * its own writes, so a startup check and a manual check cannot interleave on the file.
 */
export class UpdateCheckStore {
  private readonly store: JsonStore<UpdateCheckDocument>

  constructor(options: UpdateCheckStoreOptions = {}) {
    const log = options.log
    this.store = new JsonStore<UpdateCheckDocument>({
      filePath: options.filePath ?? updateCheckStoreFilePath(),
      defaults: () => null,
      parse: (raw) => parseStoreDocument(raw, log),
    })
  }

  /** The persisted record, defaulting to "nothing known". Never rejects on a bad file. */
  async load(): Promise<UpdateCheckStoreData> {
    const document = await this.store.load()
    if (document === null) return { ...NOTHING_KNOWN }
    const { cacheVersion: _cacheVersion, ...data } = document
    return data
  }

  /** Persists `data` and resolves once it has reached the disk. */
  async save(data: UpdateCheckStoreData): Promise<void> {
    this.store.set({ cacheVersion: UPDATE_CACHE_VERSION, ...data })
    await this.store.settle()
  }
}
