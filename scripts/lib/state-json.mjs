// Shared `state.json` reader for flows. A UI action updates the DOM optimistically before the IPC
// round trip that writes the file resolves, so an immediate read can race the write.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Long enough for a debounced persist to land; sleep it before asserting "did not change". */
export const STATE_WRITE_GRACE_MS = 750

export function readStateJson(userDataDir) {
  return JSON.parse(readFileSync(join(userDataDir, 'state.json'), 'utf8'))
}

/** Re-reads until `predicate(doc)` holds. A missing or half-written file counts as "not yet". */
export async function waitForStateJson(
  userDataDir,
  predicate,
  label,
  { timeoutMs = 5000, intervalMs = 50 } = {},
) {
  const deadline = Date.now() + timeoutMs
  let last
  for (;;) {
    try {
      last = readStateJson(userDataDir)
      if (predicate(last)) return last
    } catch {
      // not there yet, or caught mid-write
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${label}, last state.json: ${JSON.stringify(last)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
