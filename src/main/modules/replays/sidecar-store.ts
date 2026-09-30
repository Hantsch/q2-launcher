/**
 * Demo sidecar store — reads, writes and deletes the small JSON file living next to a demo
 * (e.g. `final.dm2.json`). Schema, normalisation and serialisation live in
 * `@shared/replays/sidecar`; this module owns the filesystem side: atomic writes, error mapping
 * and the "unchanged" fast path that leaves an identical file's mtime untouched.
 */

import { createHash } from 'node:crypto'
import { readFile, rm as nodeRm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { isEmptySidecar, normalizeSidecarFields, serializeSidecar, type SidecarFields } from '@shared/replays/sidecar'
import type { SidecarIssue, SidecarSaveResult, SidecarState } from '@shared/modules/replays'
import { fail, ok, type Outcome } from '@shared/types/common'
import { isFile, writeFileAtomic } from '../../lib/fs-utils'
import { readSidecarDefensively } from './sidecar-read'

export type ResolvedDemo = { kind: 'file'; absolutePath: string } | { kind: 'archive-entry' }

export interface SidecarStoreFs {
  /** Returns the file's raw bytes: the replace guard fingerprints exactly what is on disk, before
   * any decoding (a lossy UTF-8 decode could make two different files look identical). */
  readFile: (path: string) => Promise<Buffer>
  rm: (path: string, opts?: { force?: boolean }) => Promise<void>
  writeAtomic: (path: string, content: string, encoding: BufferEncoding) => Promise<void>
}

/** SHA-256 hex digest of a sidecar's raw bytes - the fingerprint a replace confirmation names. */
export function sha256Hex(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface CreateSidecarStoreOptions {
  resolveDemo: (id: string) => ResolvedDemo | undefined
  fs?: SidecarStoreFs
}

export interface SidecarStore {
  read(id: string): Promise<Outcome<{ state: SidecarState; values: Partial<SidecarFields> }>>
  write(id: string, fields: SidecarFields, confirmReplace?: string): Promise<Outcome<SidecarSaveResult>>
}

const defaultFs: SidecarStoreFs = {
  readFile: (path) => readFile(path),
  rm: (path, opts) => nodeRm(path, opts),
  writeAtomic: (path, content, encoding) => writeFileAtomic(path, content, encoding),
}

interface ReadResult {
  state: SidecarState
  values: Partial<SidecarFields>
  /** The file's text (UTF-8 decoded), or `null` when there was no file (or it couldn't be read at
   * all). Only ever consulted by `write()`'s unchanged fast path. */
  raw: string | null
  /** The file's undecoded bytes, or `null` exactly when `raw` is - what `write()`'s replace guard
   * fingerprints. */
  bytes: Buffer | null
}

async function readSidecar(fs: SidecarStoreFs, sidecarPath: string): Promise<ReadResult> {
  let bytes: Buffer
  try {
    bytes = await fs.readFile(sidecarPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { state: { state: 'none' }, values: {}, raw: null, bytes: null }
    }
    const code = (err as NodeJS.ErrnoException)?.code
    const issue: SidecarIssue = {
      kind: 'unreadable',
      key: 'replays.sidecar.issue.unreadable',
      params: { code: code ?? 'unknown' },
    }
    return { state: { state: 'error', issues: [issue] }, values: {}, raw: null, bytes: null }
  }

  const raw = bytes.toString('utf8')
  const { values, state } = readSidecarDefensively(raw)
  return { state, values, raw, bytes }
}

export function createSidecarStore(options: CreateSidecarStoreOptions): SidecarStore {
  const { resolveDemo } = options
  const fs = options.fs ?? defaultFs

  async function read(id: string): Promise<Outcome<{ state: SidecarState; values: Partial<SidecarFields> }>> {
    const resolved = resolveDemo(id)
    if (resolved === undefined || resolved.kind === 'archive-entry') {
      return ok({ state: { state: 'none' }, values: {} })
    }

    const sidecarPath = `${resolved.absolutePath}.json`
    const { state, values } = await readSidecar(fs, sidecarPath)
    return ok({ state, values })
  }

  async function write(
    id: string,
    fields: SidecarFields,
    confirmReplace?: string,
  ): Promise<Outcome<SidecarSaveResult>> {
    const resolved = resolveDemo(id)
    if (resolved === undefined) {
      return fail('replays.sidecar.error.unknownDemo')
    }
    if (resolved.kind === 'archive-entry') {
      return fail('replays.sidecar.error.archiveEntry')
    }

    const { absolutePath } = resolved
    if (!(await isFile(absolutePath))) {
      return fail('replays.sidecar.error.demoMissing')
    }

    const sidecarPath = `${absolutePath}.json`
    // Always a fresh read in this call, never a cached one: that is what makes a confirmation
    // fingerprinted against an older version of the file stale (story 147).
    const existing = await readSidecar(fs, sidecarPath)
    if (existing.state.state === 'error') {
      // A file that could not be read at all has no bytes to fingerprint, so no confirmation can
      // ever vouch for it - refuse rather than replace something nobody has seen.
      if (existing.bytes === null) {
        return fail('replays.sidecar.error.existingInvalid')
      }
      const fingerprint = sha256Hex(existing.bytes)
      if (confirmReplace !== fingerprint) {
        return ok({
          status: 'needsConfirmation',
          fileName: basename(sidecarPath),
          issues: existing.state.issues,
          fingerprint,
        })
      }
    }

    const normalized = normalizeSidecarFields(fields)

    try {
      if (isEmptySidecar(normalized)) {
        // 'ok', or 'error' confirmed above: either way there is a file to remove.
        if (existing.state.state !== 'none') {
          await fs.rm(sidecarPath)
          return ok({ status: 'saved', state: 'deleted' })
        }
        return ok({ status: 'saved', state: 'unchanged' })
      }

      const text = serializeSidecar(normalized)

      if (existing.state.state === 'ok' && existing.raw === text) {
        return ok({ status: 'saved', state: 'unchanged' })
      }

      await fs.writeAtomic(sidecarPath, text, 'utf8')
      return ok({ status: 'saved', state: 'written' })
    } catch (err) {
      try {
        await fs.rm(`${sidecarPath}.tmp`, { force: true })
      } catch {
        // best-effort cleanup only
      }

      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
        return fail('replays.sidecar.error.notWritable', { folder: dirname(absolutePath) })
      }
      return fail('replays.sidecar.error.writeFailed', { code: code ?? 'unknown' })
    }
  }

  return { read, write }
}
