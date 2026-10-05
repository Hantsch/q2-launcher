import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { parseDemoHeader } from '@shared/demos/demo-header'
import { createDm2FrameCounter } from '@shared/demos/dm2-frames'
import { createDm2RosterCollector, type DemoRoster } from '@shared/demos/dm2-roster'
import { createMvd2FrameCounter } from '@shared/demos/mvd2-frames'
import { demoReadability } from '@shared/demos/readability'
import type { DemoUnreadable } from '@shared/demos/readability'
import type {
  DemoFormat,
  DemoSource,
  DemoUnparsableReason,
  DiscoveredDemo,
} from '@shared/modules/replays'
import {
  listZipEntries,
  readZipEntry,
  ZIP_ENTRY_MAX_BYTES,
  type ZipDeps,
} from '../../lib/zip-entries'
import { recogniseDemoFile } from './discovery'

/**
 * Story 143: expands one zip archive into the `DiscoveredDemo` rows it contains, on top of the
 * bounded zip reader (`zip-entries.ts`). Never recurses into a nested archive - an entry whose
 * own name doesn't look like a demo file is skipped outright, so a `.zip` entry's contents are never
 * even listed, let alone read.
 */
export type ExpandZipResult =
  | { rows: DiscoveredDemo[]; error: null }
  | {
      rows: []
      error: {
        archivePath: string
        code: 'extractor-missing' | 'archive-unreadable' | 'archive-too-large'
      }
    }

const GZIP_MAGIC_0 = 0x1f
const GZIP_MAGIC_1 = 0x8b

function idFor(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

/** The id `expandZip` gives an entry of the archive at `archivePath` - exposed so a folder rename
 * can re-key an archive's entries without re-opening it (story 242) */
export function zipEntryIdFor(archivePath: string, entryPath: string): string {
  return idFor(`${archivePath}\u0000${entryPath}`)
}

function baseName(entryPath: string): string {
  return entryPath.split('/').pop()!
}

/**
 * Gunzips an in-memory buffer, capped at `maxBytes`: the moment the running total exceeds the cap,
 * collection stops and the caller is told to treat this as `entry-too-large`. A decode error on the
 * gzip stream keeps whatever partial output was already collected (same "keep partial output"
 * behaviour as `demo-bytes.ts`'s `readGzipPrefix`) rather than becoming a hard failure - parsing
 * continues on that partial buffer. Never rejects.
 */
function gunzipBounded(
  bytes: Uint8Array,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; overCap: boolean }> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = []
    let total = 0
    let settled = false

    const gunzip = createGunzip()
    const source = Readable.from([Buffer.from(bytes)])

    const finish = (overCap: boolean): void => {
      if (settled) return
      settled = true
      source.destroy()
      gunzip.destroy()
      const all = Buffer.concat(chunks.map((c) => Buffer.from(c)))
      resolve({ bytes: new Uint8Array(all.subarray(0, maxBytes)), overCap })
    }

    gunzip.on('data', (chunk: Buffer) => {
      if (settled) return
      chunks.push(new Uint8Array(chunk))
      total += chunk.length
      if (total > maxBytes) finish(true)
    })
    gunzip.on('end', () => finish(false))
    gunzip.on('error', () => finish(false))
    source.on('error', () => finish(false))

    source.pipe(gunzip)
  })
}

/**
 * Story 150: a zip entry's duration, from the same in-memory (already gunzipped) bytes its
 * header was parsed from - the entry is never read a second time. `null` when the frame count
 * fails, same as a loose file's `readDemoFullPass` failure.
 */
function durationOf(
  bytes: Uint8Array,
  format: DemoFormat,
): { durationMs: number | null; roster: DemoRoster | null } {
  const collector = format === 'mvd2' ? null : createDm2RosterCollector()
  const counter =
    format === 'mvd2' ? createMvd2FrameCounter() : createDm2FrameCounter(collector ?? undefined)
  counter.push(bytes)
  const result = counter.finish()
  return {
    durationMs: result.ok ? result.durationMs : null,
    roster: collector?.finish() ?? null,
  }
}

/**
 * Expands one zip archive's demo-like entries into `DiscoveredDemo` rows. `archiveMtimeMs` is
 * accepted for forward-compatibility with the call site but unused here - not surfaced yet, no
 * UI/schema field for it in this story. `zipFolder` is the directory the archive sits in, relative
 * to its source's root: every row's `folder` nests under it, then the archive's own name.
 */
export async function expandZip(
  archivePath: string,
  source: DemoSource,
  archiveMtimeMs: number,
  deps: ZipDeps,
  zipFolder: string[] = [],
): Promise<ExpandZipResult> {
  const listing = await listZipEntries(archivePath, deps)
  if (!listing.ok) return { rows: [], error: { archivePath, code: listing.code } }

  const rows: DiscoveredDemo[] = []

  for (const entry of listing.entries) {
    if (entry.isFolder) continue
    const recognised = recogniseDemoFile(entry.path)
    if (!recognised) continue

    const id = zipEntryIdFor(archivePath, entry.path)
    const fileName = baseName(entry.path)
    const folder = [
      ...zipFolder,
      basename(archivePath),
      ...entry.path.split('/').slice(0, -1).filter(Boolean),
    ]
    const archiveEntry = { archivePath, entryPath: entry.path }
    // Story 145: a zip entry has no creation time of its own; `mtimeMs` is the entry's own
    // modified stamp, falling back to the archive's when 7-Zip didn't report one.
    const fileTime = { birthtimeMs: 0, mtimeMs: entry.modified?.getTime() ?? archiveMtimeMs }

    const unparsableRow = (unreadable: DemoUnreadable): DiscoveredDemo => ({
      id,
      fileName,
      format: recognised.format,
      gzip: recognised.gzip,
      source,
      archiveEntry,
      map: null,
      unparsableReason: unreadable.reason,
      readable: false,
      unreadable,
      gameDir: null,
      pov: null,
      players: [],
      durationMs: null,
      roster: null,
      fileTime,
      folder,
      nameFacts: null,
    })

    if (entry.encrypted) {
      rows.push(unparsableRow({ reason: 'encrypted' }))
      continue
    }
    if (entry.size === null || entry.size > ZIP_ENTRY_MAX_BYTES) {
      rows.push(unparsableRow({ reason: 'entry-too-large' }))
      continue
    }

    const read = await readZipEntry(archivePath, entry.path, entry.size, deps)
    if (!read.ok) {
      rows.push(
        unparsableRow({
          reason: read.code === 'entry-too-large' ? 'entry-too-large' : 'unreadable',
        }),
      )
      continue
    }

    let finalBytes = read.bytes
    if (
      finalBytes.length >= 2 &&
      finalBytes[0] === GZIP_MAGIC_0 &&
      finalBytes[1] === GZIP_MAGIC_1
    ) {
      const gunzipped = await gunzipBounded(finalBytes, ZIP_ENTRY_MAX_BYTES)
      if (gunzipped.overCap) {
        rows.push(unparsableRow({ reason: 'entry-too-large' }))
        continue
      }
      finalBytes = gunzipped.bytes
    }

    const header = parseDemoHeader(finalBytes)
    const readability = demoReadability(header)
    if (!header.ok) {
      rows.push(
        unparsableRow(readability.unreadable ?? { reason: header.reason as DemoUnparsableReason }),
      )
      continue
    }

    rows.push({
      id,
      fileName,
      format: header.format,
      gzip: recognised.gzip,
      source,
      archiveEntry,
      map: header.map,
      unparsableReason: null,
      readable: true,
      unreadable: null,
      gameDir: header.gameDir,
      pov: header.pov,
      players: header.players,
      ...durationOf(finalBytes, header.format),
      fileTime,
      folder,
      nameFacts: null,
    })
  }

  return { rows, error: null }
}
