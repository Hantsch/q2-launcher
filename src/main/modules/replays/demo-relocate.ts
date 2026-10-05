import { pathKey } from '../../lib/fs-utils'

/**
 * The demo-plus-sidecar move shared by rename (same folder, new name) and move (new folder, same
 * name): the demo goes first, then the `${path}.json` sidecar beside it - built the way the sidecar
 * store builds it - and the demo goes back when the sidecar cannot follow.
 */

export interface RelocateFs {
  /** Only needs to reject when the path does not exist; the result is unused. */
  stat: (path: string) => Promise<{ size: number }>
  rename: (oldPath: string, newPath: string) => Promise<void>
}

export type RelocateResult =
  | { ok: true }
  /** The destination demo name is taken; nothing was touched. */
  | { ok: false; kind: 'exists' }
  | { ok: false; kind: 'sidecarExists' }
  /** A move failed and everything is back where it was. */
  | { ok: false; kind: 'failed'; error: unknown }
  /** The sidecar move failed and so did putting the demo back: the demo is at `to`. */
  | { ok: false; kind: 'stuck' }

async function exists(fs: RelocateFs, path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

export async function relocateDemo(
  fs: RelocateFs,
  from: string,
  to: string,
): Promise<RelocateResult> {
  const fromSidecar = `${from}.json`
  const toSidecar = `${to}.json`

  // A case-only rename on a case-insensitive filesystem names the very same file and sidecar -
  // not a collision.
  if (pathKey(to) !== pathKey(from)) {
    if (await exists(fs, to)) return { ok: false, kind: 'exists' }
    if (await exists(fs, toSidecar)) return { ok: false, kind: 'sidecarExists' }
  }

  const hasSidecar = await exists(fs, fromSidecar)

  try {
    await fs.rename(from, to)
  } catch (error) {
    return { ok: false, kind: 'failed', error }
  }

  if (hasSidecar) {
    try {
      await fs.rename(fromSidecar, toSidecar)
    } catch (error) {
      try {
        await fs.rename(to, from)
      } catch {
        return { ok: false, kind: 'stuck' }
      }
      return { ok: false, kind: 'failed', error }
    }
  }
  return { ok: true }
}
