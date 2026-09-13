/**
 * Story 066 D5: the session-scoped registry that stands between the file picker and the reader -
 * and with it, the whole path-trust boundary of the file-import flow.
 *
 * The rule it exists to enforce (CLAUDE.md: "paths from the renderer are never trusted"): main
 * owns every absolute path from picker to commit, and the renderer only ever holds an opaque
 * `PickedConfigFile` handle. Concretely:
 *
 * - The map is filled by `register()` ONLY, and its only caller is the `import.pickFiles` handler,
 *   with the paths `DialogService.pickConfigFiles()` returned - i.e. paths a real OS dialog (or, in
 *   development under the doubly-gated harness stub, a fixture env var) produced. There is no other
 *   way to get a path into this map, so there is no path in it the user did not point at.
 * - Nothing derived from a path leaves this file except `basename()` of the file and `basename()`
 *   of its containing folder. Never `dirname()` itself, never the absolute path: the renderer must
 *   not be able to observe a path any more than it can compose one.
 * - Ids are `randomUUID()`, so a renderer cannot guess one, and are the ONLY thing `resolve()`
 *   accepts. An id that is not in the map - stale after eviction, from an earlier app run, or
 *   simply invented - takes the exact same code path: `UnknownPickedFileError`, no filesystem
 *   access at all.
 *
 * Session scope, deliberately: the instance is created in `configModule.setup()` (one per app run,
 * not module-level mutable state) and never written to disk - "no source paths are persisted"
 * (story 022, restated as a story 066 decision). Nothing survives a restart, so an id from a
 * previous run is refused by construction rather than by an expiry check.
 */

import { randomUUID } from 'node:crypto'
import { basename, dirname } from 'node:path'
import type { PickedConfigFile } from '@shared/modules/config'

/**
 * How many picked files one session may keep resolvable at a time. A pick is a handful of files and
 * the dialog is a short-lived flow, so this is a memory bound rather than a real limit: reaching it
 * takes hundreds of files across repeated picks in a single app run. Oldest-first eviction (a `Map`
 * iterates in insertion order) means the ids at risk are the ones the dialog is least likely to
 * still be holding, and an evicted id degrades to the ordinary "unknown id" rejection - never to a
 * wrong path.
 *
 * Note this is a *different* bound from `MAX_IMPORT_FILE_IDS` (`schemas.ts`), which caps how many
 * ids ONE request may carry.
 */
export const MAX_REGISTERED_PICKED_FILES = 512

/**
 * Thrown by `resolve()` for an id the registry does not know - the single rejection path for a
 * stale id and a renderer-invented one alike (there is deliberately nothing to tell them apart
 * with: a "that id expired" answer would confirm to a caller that the id was once real).
 *
 * Carries the id for the handler's own use, but note that the id is renderer-supplied text: the
 * `import.ts` handlers log the *fact* of the rejection, never this value.
 */
export class UnknownPickedFileError extends Error {
  readonly id: string

  constructor(id: string) {
    super('no picked file is registered for that id')
    this.name = 'UnknownPickedFileError'
    this.id = id
  }
}

/** What `import.pickFiles` needs: turning picker output into renderer-safe handles. */
export interface PickedFileRegistrar {
  register: (paths: readonly string[]) => PickedConfigFile[]
}

/** What `import.previewFiles`/`import.commitFiles` need: ids back to paths, in order. */
export interface PickedFileResolver {
  resolve: (ids: readonly string[]) => string[]
}

export class PickedFilesRegistry implements PickedFileRegistrar, PickedFileResolver {
  /** id -> absolute path. Insertion-ordered, which is what makes the eviction below oldest-first. */
  private readonly paths = new Map<string, string>()

  /**
   * Registers absolute paths from a picker result and returns one opaque handle per path, in the
   * same order. Additive: an earlier pick's handles stay valid, so a dialog that lets the user add
   * files in more than one go never silently invalidates the rows it already shows.
   *
   * The same path picked twice yields two ids rather than one shared id - two independent handles
   * are what an ordered, duplicate-tolerant file list needs, and a shared id would let removing one
   * row invalidate the other.
   */
  register(paths: readonly string[]): PickedConfigFile[] {
    const handles = paths.map((path) => {
      const id = randomUUID()
      this.paths.set(id, path)
      return {
        id,
        fileName: basename(path),
        // The containing folder's NAME, never `dirname(path)` itself - the renderer gets enough to
        // tell two same-named files apart and nothing it could rebuild a path from. A file sitting
        // directly at a drive root has no folder name to show (`basename('C:\\')` is `''`), which
        // the display side renders as "no folder" rather than being handed the root's spelling.
        dirName: basename(dirname(path)),
      }
    })

    while (this.paths.size > MAX_REGISTERED_PICKED_FILES) {
      const oldest = this.paths.keys().next()
      if (oldest.done) break
      this.paths.delete(oldest.value)
    }

    return handles
  }

  /**
   * Resolves `ids` to absolute paths **in the order given** - the load order the fold depends on
   * (AC5), so this must never reorder or deduplicate.
   *
   * All or nothing: the first unknown id throws, before this returns anything and therefore before
   * the caller can read a single one of the *known* paths in the same request. That is what makes
   * one invented id refuse the whole request rather than quietly importing the rest of it.
   */
  resolve(ids: readonly string[]): string[] {
    const resolved: string[] = []
    for (const id of ids) {
      const path = this.paths.get(id)
      if (path === undefined) throw new UnknownPickedFileError(id)
      resolved.push(path)
    }
    return resolved
  }

  /** How many handles are currently resolvable - for logging and tests, never for the renderer. */
  get size(): number {
    return this.paths.size
  }
}
