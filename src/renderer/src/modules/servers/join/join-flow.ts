/**
 * Pure decision helpers for the join flow (story 125 D4): whether a server's mod differs from the
 * active installation's, and whether the server needs a password before it can be joined. No React,
 * no IPC - `JoinServerButton.tsx` is the only caller, kept separate so the decisions are unit
 * testable without mounting anything.
 */
import type { ServerListRow } from '@shared/modules/servers'
import type { Installation } from '@shared/types/installation'

/** A mod name pair to show in the mismatch warning, or `null` when there is nothing to warn about
 * (same mod, or the server's mod is unknown/empty - nothing to name). */
export interface ModMismatch {
  server: string
  installation: string
}

/** The installation's own mod, `baseq2` standing in for an empty `activeGameDir` - same convention
 * CLAUDE.md documents for `activeGameDir` itself. */
function installationMod(installation: Installation): string {
  return installation.activeGameDir.trim().length > 0 ? installation.activeGameDir : 'baseq2'
}

/**
 * Compares `entry.mod` (trimmed, lowercased) against the installation's `activeGameDir` (empty
 * treated as `baseq2`, case-insensitively). Returns the mismatch pair (using the raw mod strings,
 * for display) when they differ, `null` when they match or when the server's mod is unknown/empty.
 */
export function modMismatch(entry: ServerListRow, installation: Installation): ModMismatch | null {
  const serverMod = (entry.mod ?? '').trim()
  if (serverMod.length === 0) return null

  const installMod = installationMod(installation)
  if (serverMod.toLowerCase() === installMod.toLowerCase()) return null

  return { server: serverMod, installation: installMod }
}

/** Whether the server requires a password before it can be joined. */
export function needsJoinPassword(entry: ServerListRow): boolean {
  return entry.needpass === true
}
