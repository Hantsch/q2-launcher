import type { DemoFileActionResult } from '@shared/modules/replays'
import { refuse } from '@shared/types'

/**
 * Story 156: `demos.reveal`/`demos.copyPath`'s shared logic - resolve a demo id to its real
 * absolute path (never trusting a renderer-supplied path, CLAUDE.md), confirm the file is still
 * there, then hand the path to whichever OS action was asked for. The path itself never appears in
 * either action's return value - only whether it ran, and on refusal, why.
 */

export interface ResolvedDemoFile {
  absolutePath: string
  archiveEntry: unknown
}

export interface DemoFileActionsDeps {
  /** Resolves a demo id to its real file - `undefined` for an id the index no longer knows about.
   * Mirrors `ReplaysScanService.resolveFile`. For an archive entry, `absolutePath` is already the
   * archive file's own path. */
  resolveFile: (id: string) => ResolvedDemoFile | undefined
  /** Confirms the file is still on disk. Rejects with an error carrying `.code` (Node's `fs.stat`
   * convention) when it is not. */
  stat: (path: string) => Promise<unknown>
  /** Reveals a path in the OS file manager (or the UI-harness stub standing in for it). */
  reveal: (path: string) => void | Promise<void>
  /** Writes a path to the system clipboard. */
  writeClipboard: (path: string) => void
}

export interface DemoFileActions {
  reveal: (demoId: string) => Promise<DemoFileActionResult>
  copyPath: (demoId: string) => Promise<DemoFileActionResult>
}

function hasErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

/** Resolves `demoId` and confirms the file is still there. `undefined` means one of the two
 * refusal reasons applies (already returned by this helper); otherwise the resolved file. */
async function resolveAndCheck(
  demoId: string,
  deps: Pick<DemoFileActionsDeps, 'resolveFile' | 'stat'>,
): Promise<{ file: ResolvedDemoFile } | { refusal: DemoFileActionResult }> {
  const file = deps.resolveFile(demoId)
  if (!file) return { refusal: refuse('replays.fileActions.unknownDemo') }

  try {
    await deps.stat(file.absolutePath)
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT') || hasErrnoCode(error, 'ENOTDIR')) {
      return { refusal: refuse('replays.fileActions.fileMissing') }
    }
    // Any other stat error (e.g. a transient permission hiccup) never blocks the action - proceed
    // as if stat succeeded.
  }

  return { file }
}

export function createDemoFileActions(deps: DemoFileActionsDeps): DemoFileActions {
  return {
    async reveal(demoId) {
      const resolved = await resolveAndCheck(demoId, deps)
      if ('refusal' in resolved) return resolved.refusal
      await deps.reveal(resolved.file.absolutePath)
      return { ok: true }
    },
    async copyPath(demoId) {
      const resolved = await resolveAndCheck(demoId, deps)
      if ('refusal' in resolved) return resolved.refusal
      deps.writeClipboard(resolved.file.absolutePath)
      return { ok: true }
    },
  }
}
