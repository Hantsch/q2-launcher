import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { limitsFor } from '@shared/config/engine-limits'
import {
  effectiveWriteDirs,
  type DiscoverableInstallation,
  type DiscoverContext,
} from './discovery'

/**
 * Story 170 D3: a stage play sets `vid_fullscreen`/`vid_geometry` on the command line, and Q2PRO
 * archives both into the user's own `q2config.cfg` when it exits. This puts back exactly those lines
 * afterwards - it never rewrites the file from a snapshot:
 *
 * - `snapshot` records, per name, the exact line as it stood before launch (or that it was absent),
 *   and persists that to `pendingPath` so a launcher crash mid-session is repaired on the next start;
 * - `restore` runs after the game exited (the engine writes its config on the way out) and edits the
 *   file the engine just wrote: each named `set`/`seta` line becomes the recorded line again, or goes
 *   away if there was none. Every other byte - line endings, the user's in-session changes - stays;
 * - `applyPending` runs a snapshot a previous launcher run never got to restore.
 *
 * The file is handled as latin1 so every byte round-trips unchanged whatever its encoding. All three
 * operations run strictly one after another, so a play started right after an exit can never take its
 * snapshot from the file before the previous session's restore has been written.
 */

/** What story 170's stage launch sets and Q2PRO archives; later stories may append. */
export const STAGE_CVAR_NAMES = ['vid_fullscreen', 'vid_geometry'] as const

/** The pending snapshot's file name, under the launcher's userData next to the replays index cache. */
export const SESSION_CVARS_PENDING_FILE = 'replays-session-cvars.pending.json'

export interface CvarRestoreFs {
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, data: string, encoding: 'latin1' | 'utf8'): Promise<void>
  rename(from: string, to: string): Promise<void>
  rm(path: string, options: { force: true }): Promise<void>
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
}

export const nodeCvarRestoreFs: CvarRestoreFs = { readFile, writeFile, rename, rm, mkdir }

export interface CvarRestore {
  snapshot(configPath: string): Promise<void>
  restore(): Promise<void>
  applyPending(): Promise<void>
}

/**
 * `<write dir>/<game>/q2config.cfg`: Q2PRO on Linux writes under `~/.q2pro/<game>`, everywhere else
 * into the game dir itself. Null when the engine's config name is not known.
 */
export function sessionConfigPath(
  installation: DiscoverableInstallation,
  gameDir: string,
  gameDirPath: string,
  context: DiscoverContext,
): string | null {
  const name = limitsFor('q2pro')?.writtenConfigName
  if (!name) return null
  const [writeDir] = effectiveWriteDirs(installation, context)
  return writeDir ? join(writeDir, gameDir, name) : join(gameDirPath, name)
}

interface Snapshot {
  configPath: string
  /** Per name: the line's text without its line ending, or null when the file had no such line. */
  lines: Map<string, string | null>
}

const lineSchema = z.string().regex(/^[^\r\n]*$/)
const pendingSchema = z.object({
  configPath: z.string().refine((p) => isAbsolute(p)),
  lines: z.record(z.string(), lineSchema.nullable()),
})

interface Segment {
  content: string
  eol: '' | '\n' | '\r\n'
}

/** Lines with their own terminators - joining `content + eol` gives back the exact text. */
function splitLines(text: string): Segment[] {
  const out: Segment[] = []
  let start = 0
  while (start < text.length) {
    const nl = text.indexOf('\n', start)
    if (nl < 0) {
      out.push({ content: text.slice(start), eol: '' })
      break
    }
    const crlf = nl > start && text[nl - 1] === '\r'
    out.push({ content: text.slice(start, crlf ? nl - 1 : nl), eol: crlf ? '\r\n' : '\n' })
    start = nl + 1
  }
  return out
}

const joinLines = (segments: readonly Segment[]): string =>
  segments.map((s) => s.content + s.eol).join('')

/** The cvar a `set`/`seta` line assigns, or null for any other line. */
function cvarNameOf(content: string): string | null {
  const match = /^[ \t]*seta?[ \t]+"?([^\s";]+)"?(?:[ \t]|$)/i.exec(content)
  return match?.[1] ?? null
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

export function createCvarRestore({
  names,
  fs = nodeCvarRestoreFs,
  pendingPath,
}: {
  names: readonly string[]
  fs?: CvarRestoreFs
  pendingPath: string
}): CvarRestore {
  let current: Snapshot | null = null
  let chain: Promise<unknown> = Promise.resolve()
  const serial = (task: () => Promise<void>): Promise<void> => {
    const run = chain.then(task, task)
    chain = run.catch(() => undefined)
    return run
  }

  async function readText(path: string): Promise<string | null> {
    try {
      return (await fs.readFile(path)).toString('latin1')
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  /** Temp file then rename: a crash mid-write never leaves a half-written file behind. */
  async function writeAtomic(
    path: string,
    data: string,
    encoding: 'latin1' | 'utf8',
  ): Promise<void> {
    const tmp = `${path}.q2l-tmp`
    try {
      await fs.writeFile(tmp, data, encoding)
      await fs.rename(tmp, path)
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async function apply(snapshot: Snapshot): Promise<void> {
    const text = await readText(snapshot.configPath)
    if (text === null) return
    const segments = splitLines(text)
    const seen = new Set<string>()
    const out: Segment[] = []
    for (const segment of segments) {
      const name = cvarNameOf(segment.content)
      if (name === null || !snapshot.lines.has(name)) {
        out.push(segment)
        continue
      }
      seen.add(name)
      const original = snapshot.lines.get(name) ?? null
      if (original !== null) out.push({ content: original, eol: segment.eol })
    }
    // The line was there before but the engine dropped it: put it back at the end.
    const dropped = [...snapshot.lines].filter(([name, line]) => line !== null && !seen.has(name))
    if (dropped.length > 0) {
      const eol = segments.find((s) => s.eol !== '')?.eol ?? '\n'
      const last = out.at(-1)
      if (last && last.eol === '') out[out.length - 1] = { ...last, eol }
      for (const [, line] of dropped) out.push({ content: line ?? '', eol })
    }
    const next = joinLines(out)
    if (next !== text) await writeAtomic(snapshot.configPath, next, 'latin1')
  }

  /** The pending snapshot on disk: null when absent, unparseable or invalid (raw kept for the caller). */
  async function loadPending(): Promise<{ exists: boolean; snapshot: Snapshot | null }> {
    let raw: string
    try {
      raw = (await fs.readFile(pendingPath)).toString('utf8')
    } catch (error) {
      if (isMissing(error)) return { exists: false, snapshot: null }
      throw error
    }
    try {
      const result = pendingSchema.safeParse(JSON.parse(raw))
      if (result.success) {
        // Only the names this launcher owns - a stray key never edits an unrelated line.
        const lines = new Map(
          Object.entries(result.data.lines).filter(([name]) => names.includes(name)),
        )
        return { exists: true, snapshot: { configPath: result.data.configPath, lines } }
      }
    } catch {
      // Unparseable JSON: nothing trustworthy to restore.
    }
    return { exists: true, snapshot: null }
  }

  return {
    snapshot(configPath) {
      return serial(async () => {
        // A pending snapshot a failed restore left behind holds the user's ORIGINAL lines; the config
        // now still carries the stage values, so snapshotting it would lose them. Repair first, and if
        // that fails again keep the original snapshot as the one to restore later.
        const { snapshot: pending } = await loadPending()
        if (pending) {
          try {
            await apply(pending)
            await fs.rm(pendingPath, { force: true })
          } catch {
            current = pending
            return
          }
        }
        const text = await readText(configPath)
        const lines = new Map<string, string | null>(names.map((n) => [n, null]))
        for (const segment of text === null ? [] : splitLines(text)) {
          const name = cvarNameOf(segment.content)
          // The last one wins when the engine execs the file, so that is the line that counts.
          if (name !== null && lines.has(name)) lines.set(name, segment.content)
        }
        current = { configPath, lines }
        await fs.mkdir(dirname(pendingPath), { recursive: true })
        await writeAtomic(
          pendingPath,
          JSON.stringify({ configPath, lines: Object.fromEntries(lines) }),
          'utf8',
        )
      })
    },
    restore() {
      return serial(async () => {
        const snapshot = current
        current = null
        if (!snapshot) return
        // A failed edit leaves the pending file in place, so the next start tries again.
        await apply(snapshot)
        await fs.rm(pendingPath, { force: true })
      })
    },
    applyPending() {
      return serial(async () => {
        const { exists, snapshot } = await loadPending()
        if (!exists) return
        if (snapshot) await apply(snapshot)
        await fs.rm(pendingPath, { force: true })
      })
    },
  }
}
