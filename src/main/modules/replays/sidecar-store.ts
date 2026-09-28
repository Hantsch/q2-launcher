/**
 * Demo sidecar store — reads, writes and deletes the small JSON file living next to a demo
 * (e.g. `final.dm2.json`). Schema, normalisation and serialisation live in
 * `@shared/replays/sidecar`; this module owns the filesystem side: atomic writes, error mapping
 * and the "unchanged" fast path that leaves an identical file's mtime untouched.
 */

import { readFile, rm as nodeRm } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  isEmptySidecar,
  normalizeSidecarFields,
  serializeSidecar,
  SIDECAR_SCHEMA_VERSION,
  sidecarFileSchema,
  type SidecarFields,
  type SidecarFile,
} from '@shared/replays/sidecar'
import { fail, ok, type Outcome } from '@shared/types/common'
import { isFile, writeFileAtomic } from '../../lib/fs-utils'

export type ResolvedDemo = { kind: 'file'; absolutePath: string } | { kind: 'archive-entry' }

export interface SidecarStoreFs {
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  rm: (path: string, opts?: { force?: boolean }) => Promise<void>
  writeAtomic: (path: string, content: string, encoding: BufferEncoding) => Promise<void>
}

export interface CreateSidecarStoreOptions {
  resolveDemo: (id: string) => ResolvedDemo | undefined
  fs?: SidecarStoreFs
}

export interface SidecarStore {
  read(
    id: string,
  ): Promise<Outcome<{ state: 'none' } | { state: 'ok'; sidecar: SidecarFile } | { state: 'invalid' }>>
  write(
    id: string,
    fields: SidecarFields,
  ): Promise<Outcome<{ state: 'written' | 'deleted' | 'unchanged'; sidecar: SidecarFile | null }>>
}

const defaultFs: SidecarStoreFs = {
  readFile: (path, encoding) => readFile(path, encoding),
  rm: (path, opts) => nodeRm(path, opts),
  writeAtomic: (path, content, encoding) => writeFileAtomic(path, content, encoding),
}

type ReadState = { state: 'none' } | { state: 'ok'; sidecar: SidecarFile; raw: string } | { state: 'invalid' }

async function readSidecar(fs: SidecarStoreFs, sidecarPath: string): Promise<ReadState> {
  let raw: string
  try {
    raw = await fs.readFile(sidecarPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { state: 'none' }
    return { state: 'invalid' }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return { state: 'invalid' }
  }

  const result = sidecarFileSchema.safeParse(parsedJson)
  if (!result.success) return { state: 'invalid' }

  return { state: 'ok', sidecar: result.data, raw }
}

export function createSidecarStore(options: CreateSidecarStoreOptions): SidecarStore {
  const { resolveDemo } = options
  const fs = options.fs ?? defaultFs

  async function read(
    id: string,
  ): Promise<Outcome<{ state: 'none' } | { state: 'ok'; sidecar: SidecarFile } | { state: 'invalid' }>> {
    const resolved = resolveDemo(id)
    if (resolved === undefined || resolved.kind === 'archive-entry') {
      return ok({ state: 'none' })
    }

    const sidecarPath = `${resolved.absolutePath}.json`
    const state = await readSidecar(fs, sidecarPath)
    if (state.state === 'none') return ok({ state: 'none' })
    if (state.state === 'invalid') return ok({ state: 'invalid' })
    return ok({ state: 'ok', sidecar: state.sidecar })
  }

  async function write(
    id: string,
    fields: SidecarFields,
  ): Promise<Outcome<{ state: 'written' | 'deleted' | 'unchanged'; sidecar: SidecarFile | null }>> {
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
    const existing = await readSidecar(fs, sidecarPath)
    if (existing.state === 'invalid') {
      return fail('replays.sidecar.error.existingInvalid')
    }

    const normalized = normalizeSidecarFields(fields)

    try {
      if (isEmptySidecar(normalized)) {
        if (existing.state === 'ok') {
          await fs.rm(sidecarPath)
          return ok({ state: 'deleted', sidecar: null })
        }
        return ok({ state: 'unchanged', sidecar: null })
      }

      const text = serializeSidecar(normalized)
      const sidecar: SidecarFile = { schemaVersion: SIDECAR_SCHEMA_VERSION, ...normalized }

      if (existing.state === 'ok' && existing.raw === text) {
        return ok({ state: 'unchanged', sidecar })
      }

      await fs.writeAtomic(sidecarPath, text, 'utf8')
      return ok({ state: 'written', sidecar })
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
