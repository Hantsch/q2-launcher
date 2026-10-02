import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Story 071 D2, AC3/AC4: the gate every downloaded file passes through before anything else in
 * the launcher is allowed to look at it.
 *
 * The rule this file exists to enforce: **a file becomes usable by being renamed, and it is only
 * ever renamed after both the size and the SHA256 matched.** So "verified" is not a flag someone
 * could forget to check - an unverified download is still called `<name>.part`, and the only code
 * that can turn it into `<name>` is `verifyAndPromote()`. There is no override (AC4).
 *
 * The digest is *not* recomputed here. It is handed in by `fetcher.ts`, which computed it while
 * the bytes were being written (hash-while-writing), so nothing is ever read back into memory and
 * there is no window between "hashed" and "written" for the bytes to change. The size, by
 * contrast, is read from the filesystem rather than trusted from the caller's byte counter,
 * because a short write is exactly the failure this check has to catch: `receivedBytes` says what
 * the download handed to the file, `stat()` says what actually landed in it, and the two
 * disagreeing is its own failure (`'short-write'`), separate from the server having sent the
 * wrong number of bytes (`'size'`).
 */

/** What the package declares. Both are compared; neither alone is sufficient. */
export interface VerifyExpectation {
  sizeBytes: number
  sha256: string
}

export interface VerifyAndPromoteInput {
  /** The in-flight file, `<name>.part`. Deleted on any mismatch. */
  partPath: string
  /** Where it lands on a match, `<name>` - normally `partPath` minus `.part`. */
  finalPath: string
  expected: VerifyExpectation
  /** Lowercase hex SHA256 computed while the bytes were written. */
  actualSha256: string
  /** Bytes the writer counted, cross-checked against the file's real size on disk. */
  receivedBytes?: number
}

/**
 * Which comparison failed. `'missing'` is its own case rather than a thrown error: a `.part`
 * file that is not there cannot be verified, and that is a failed verification, not a crash.
 */
export type VerifyMismatch = 'missing' | 'short-write' | 'size' | 'sha256' | 'expectation'

export type VerifyAndPromoteResult =
  | { ok: true; path: string; sizeBytes: number; sha256: string }
  | {
      ok: false
      key: 'downloads.error.verificationFailed'
      mismatch: VerifyMismatch
      reason: string
      /** Whether the `.part` file is gone. `false` means it could not be removed. */
      deleted: boolean
    }
  | { ok: false; key: 'downloads.error.diskWrite'; reason: string }

const HEX_SHA256 = /^[0-9a-f]{64}$/

function normalizeDigest(digest: string): string {
  return digest.trim().toLowerCase()
}

/**
 * Best-effort delete. A mismatch has already been decided by the time this runs, so a failure to
 * unlink must not mask it - it is reported through `deleted: false` instead. The `.part` name is
 * reused by the next mirror anyway (opening it truncates), so a leftover cannot be mistaken for a
 * verified file.
 */
async function deletePart(partPath: string): Promise<boolean> {
  try {
    await rm(partPath, { force: true })
    return true
  } catch {
    return false
  }
}

async function refuse(
  partPath: string,
  mismatch: VerifyMismatch,
  reason: string,
): Promise<VerifyAndPromoteResult> {
  const deleted = await deletePart(partPath)
  return { ok: false, key: 'downloads.error.verificationFailed', mismatch, reason, deleted }
}

/**
 * Compares the downloaded file against the package's declared size and SHA256 and, only if both
 * match, promotes `<name>.part` to `<name>`. On any mismatch the `.part` file is deleted and the
 * caller is told which comparison failed, so it can advance to the next mirror (AC4).
 *
 * Never throws for an expected condition (missing file, mismatch, unwritable target); every one
 * of those is a returned failure with one of the module's fixed error keys.
 */
export async function verifyAndPromote(
  input: VerifyAndPromoteInput,
): Promise<VerifyAndPromoteResult> {
  const { partPath, finalPath, expected, actualSha256, receivedBytes } = input

  // A package whose own expectation is nonsense can never be verified against, so it is refused
  // before anything is compared. Without this, a manifest carrying `sha256: ''` would only be
  // caught by the digest comparison happening to differ - correct today, but resting on the
  // accident that a real digest is never empty.
  const expectedDigest = normalizeDigest(expected.sha256)
  if (!HEX_SHA256.test(expectedDigest)) {
    return refuse(
      partPath,
      'expectation',
      `the package's declared sha256 is not a 64-character hex digest (${JSON.stringify(expected.sha256)})`,
    )
  }
  if (!Number.isSafeInteger(expected.sizeBytes) || expected.sizeBytes < 0) {
    return refuse(
      partPath,
      'expectation',
      `the package's declared sizeBytes is not a byte count (${String(expected.sizeBytes)})`,
    )
  }

  let actualSize: number
  try {
    const stats = await stat(partPath)
    if (!stats.isFile()) {
      return refuse(partPath, 'missing', `${partPath} is not a file`)
    }
    actualSize = stats.size
  } catch {
    return refuse(partPath, 'missing', `${partPath} does not exist`)
  }

  if (receivedBytes !== undefined && receivedBytes !== actualSize) {
    return refuse(
      partPath,
      'short-write',
      `wrote ${receivedBytes} bytes but the file holds ${actualSize}`,
    )
  }
  if (actualSize !== expected.sizeBytes) {
    return refuse(partPath, 'size', `expected ${expected.sizeBytes} bytes, got ${actualSize}`)
  }

  const actualDigest = normalizeDigest(actualSha256)
  if (actualDigest !== expectedDigest) {
    return refuse(partPath, 'sha256', `expected sha256 ${expectedDigest}, got ${actualDigest}`)
  }

  // Both matched: the file is now trustworthy, and dropping `.part` is what says so.
  try {
    await mkdir(dirname(finalPath), { recursive: true })
    await rename(partPath, finalPath)
  } catch (error) {
    // A previously cached file at the target can be locked (Windows) or otherwise refuse to be
    // replaced. Clear it and try once more before giving up - the bytes in hand are known good,
    // so the only thing at stake is the rename.
    try {
      await rm(finalPath, { force: true })
      await rename(partPath, finalPath)
    } catch {
      await deletePart(partPath)
      return {
        ok: false,
        key: 'downloads.error.diskWrite',
        reason: `could not move the verified file into place: ${String(error)}`,
      }
    }
  }

  return { ok: true, path: finalPath, sizeBytes: actualSize, sha256: actualDigest }
}
