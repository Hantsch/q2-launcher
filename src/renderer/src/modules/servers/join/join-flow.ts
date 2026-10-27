/**
 * Pure decision helper for the join flow (story 125): whether a server needs a password before it
 * can be joined. No React, no IPC - `useJoinFlow.tsx` is the caller, kept separate so the decision
 * is unit testable without mounting anything.
 */
import type { ServerListRow } from '@shared/modules/servers'

/** Whether the server requires a password before it can be joined. */
export function needsJoinPassword(entry: ServerListRow): boolean {
  return entry.needpass === true
}
