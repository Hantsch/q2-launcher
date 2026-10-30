import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { limitsFor } from '@shared/config/syntax/engine-limits'
import type { DemoPlayEngine } from '@shared/replays/demo-play'
import {
  effectiveWriteDirs,
  type DiscoverableInstallation,
  type DiscoverContext,
} from './discovery'

/**
 * Story 170: a stage play sets `vid_fullscreen`/`vid_geometry` on the command line, and Q2PRO
 * archives both into the user's own `q2config.cfg` when it exits. A line-wise snapshot puts back
 * exactly those lines afterwards - it never rewrites the file from a snapshot:
 *
 * - `snapshot` records, per name, the exact line as it stood before launch (or that it was absent),
 *   and persists that to `pendingPath` so a launcher crash mid-session is repaired on the next start;
 * - `restore` runs after the game exited (the engine writes its config on the way out) and edits the
 *   file the engine just wrote: each named `set`/`seta` line becomes the recorded line again, or goes
 *   away if there was none. Every other byte - line endings, the user's in-session changes - stays;
 * - `applyPending` runs a snapshot a previous launcher run never got to restore. The record carries
 *   the game's pid once it is known: a game left running by a launcher quit (story 163) writes the
 *   stage values on its own exit, which may come after the next launcher start, so the restore waits
 *   until that pid is gone. A record without a pid restores at once. A session started meanwhile
 *   gets its own record beside the waiting one, so each is restored after its own game (story 321).
 *
 * An R1Q2 play can only use `demomap`, which runs the demo's stufftext - any cvar or bind
 * can be stuffed and archived, so no list of names covers it. A `wholeFile` snapshot records the
 * config's exact bytes (or that it was absent) instead, and its restore puts the file back as it was
 * (or removes the one the game created). It goes through the same pending file, queue and atomic write (story 275).
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
  snapshot(configPath: string, options?: { wholeFile?: true }): Promise<void>
  /** The running session's game pid, persisted with its snapshot; a no-op without one or once set. */
  recordPid(pid: number): Promise<void>
  /**
   * One console line that sets every snapshotted name back to its pre-session value (`reset` when
   * the file had none), or null without a line-wise snapshot. Sent before the launcher lets go of a
   * game it keeps running, so the engine's own write-on-exit archives the originals (story 321).
   */
  originalsLine(): string | null
  restore(): Promise<void>
  applyPending(): Promise<void>
  /** Cancels a scheduled pending retry. */
  dispose(): void
}

/** How often a pending restore checks again whether the recorded game has exited. */
export const PENDING_RETRY_MS = 2_000

/** Signal 0 only probes: EPERM means the process exists but belongs to someone else. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === 'EPERM'
  }
}

function scheduleRetryDefault(run: () => void): () => void {
  const timer = setTimeout(run, PENDING_RETRY_MS)
  timer.unref()
  return () => clearTimeout(timer)
}

/**
 * The config the playing engine writes on exit. Q2PRO: `<write dir>/<game>/q2config.cfg` - on Linux
 * under `~/.q2pro/<game>`, everywhere else the game dir itself. R1Q2 has no write dir: always the
 * game dir. Null when the engine's config name is not known.
 */
export function sessionConfigPath(
  installation: DiscoverableInstallation,
  gameDir: string,
  gameDirPath: string,
  context: DiscoverContext,
  engine: DemoPlayEngine,
): string | null {
  const name = limitsFor(engine)?.writtenConfigName
  if (!name) return null
  if (engine === 'r1q2') return join(gameDirPath, name)
  const [writeDir] = effectiveWriteDirs(installation, context)
  return writeDir ? join(writeDir, gameDir, name) : join(gameDirPath, name)
}

interface Snapshot {
  configPath: string
  /** Per name: the line's text without its line ending, or null when the file had no such line. */
  lines: Map<string, string | null>
  /** Whole-file mode only: the file's bytes as base64, or null when it did not exist. */
  file?: string | null
  /** The session's game process, once spawned. */
  pid?: number
}

const lineSchema = z.string().regex(/^[^\r\n]*$/)
const recordSchema = z.object({
  configPath: z.string().refine((p) => isAbsolute(p)),
  lines: z.record(z.string(), lineSchema.nullable()),
  file: z
    .string()
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .nullable()
    .optional(),
  pid: z.number().int().positive().optional(),
})
/** One record per unrestored session, oldest first; a lone record is stored bare. */
const pendingSchema = z.union([recordSchema, z.array(recordSchema)])

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

/** The value a `set`/`seta` line assigns, quoted or bare; null when the line carries none. */
function cvarValueOf(content: string): string | null {
  const match = /^[ \t]*seta?[ \t]+"?[^\s";]+"?[ \t]+(?:"([^"]*)"?|([^\s";]+))/i.exec(content)
  return match?.[1] ?? match?.[2] ?? null
}

/**
 * The value `name` gets when the engine execs `configPath`: the last `set`/`seta` line wins. Null when
 * the file cannot be read or has no such line - a caller falls back to the engine's own default.
 */
export async function readArchivedCvar(
  configPath: string,
  name: string,
  fs: Pick<CvarRestoreFs, 'readFile'> = nodeCvarRestoreFs,
): Promise<string | null> {
  let text: string
  try {
    text = (await fs.readFile(configPath)).toString('latin1')
  } catch {
    // ENOENT: the config file may not exist yet
    return null
  }
  let value: string | null = null
  for (const segment of splitLines(text)) {
    if (cvarNameOf(segment.content) === name) value = cvarValueOf(segment.content)
  }
  return value
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

export function createCvarRestore({
  names,
  fs = nodeCvarRestoreFs,
  pendingPath,
  isAlive = processIsAlive,
  scheduleRetry = scheduleRetryDefault,
  onWaiting,
}: {
  names: readonly string[]
  fs?: CvarRestoreFs
  pendingPath: string
  isAlive?: (pid: number) => boolean
  /** Runs `run` once later; returns its cancel. */
  scheduleRetry?: (run: () => void) => () => void
  /** Told once per instance that a pending restore waits for `pid` to exit. */
  onWaiting?: (pid: number) => void
}): CvarRestore {
  let current: Snapshot | null = null
  /**
   * Records of earlier sessions not restored yet, never the running session's: a retry only ever
   * restores these, so it cannot restore the running session's record before its pid is known.
   */
  let earlier: Snapshot[] | null = null
  let cancelRetry: (() => void) | null = null
  let disposed = false
  let waitingAnnounced = false
  let chain: Promise<unknown> = Promise.resolve()
  const serial = (task: () => Promise<void>): Promise<void> => {
    const run = chain.then(task, task)
    chain = run.catch(() => undefined)
    return run
  }

  async function readBytes(path: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(path)
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async function readText(path: string): Promise<string | null> {
    return (await readBytes(path))?.toString('latin1') ?? null
  }

  // Not fs-utils' writeAtomic: writes through the injected fs and removes the tmp file on failure.
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
    if (snapshot.file !== undefined) return applyWholeFile(snapshot.configPath, snapshot.file)
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

  /** latin1 maps every byte to one char and back, so the recorded bytes are written unchanged. */
  async function applyWholeFile(configPath: string, file: string | null): Promise<void> {
    if (file === null) {
      await fs.rm(configPath, { force: true })
      return
    }
    const original = Buffer.from(file, 'base64').toString('latin1')
    if ((await readText(configPath)) !== original) await writeAtomic(configPath, original, 'latin1')
  }

  const toRecord = (snapshot: Snapshot): z.input<typeof recordSchema> => ({
    configPath: snapshot.configPath,
    lines: Object.fromEntries(snapshot.lines),
    ...(snapshot.file !== undefined ? { file: snapshot.file } : {}),
    ...(snapshot.pid !== undefined ? { pid: snapshot.pid } : {}),
  })

  /**
   * Writes every unrestored record - earlier sessions' first, the running session's last - or removes
   * the file once none is left. A lone record is stored bare: the format earlier launchers read.
   */
  async function save(): Promise<void> {
    const records = [...(earlier ?? []), ...(current ? [current] : [])].map(toRecord)
    if (records.length === 0) return fs.rm(pendingPath, { force: true })
    await fs.mkdir(dirname(pendingPath), { recursive: true })
    const json = JSON.stringify(records.length === 1 ? records[0] : records)
    await writeAtomic(pendingPath, json, 'utf8')
  }

  function parsePending(raw: string): Snapshot[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Unparseable JSON: nothing trustworthy to restore.
      return []
    }
    const result = pendingSchema.safeParse(parsed)
    if (!result.success) return []
    return (Array.isArray(result.data) ? result.data : [result.data]).map(
      ({ configPath, lines, file, pid }) => ({
        configPath,
        // Only the names this launcher owns - a stray key never edits an unrelated line.
        lines: new Map(Object.entries(lines).filter(([name]) => names.includes(name))),
        ...(file !== undefined ? { file } : {}),
        ...(pid !== undefined ? { pid } : {}),
      }),
    )
  }

  /** The earlier sessions' records, read once; an unreadable or invalid file is dropped. */
  async function loadEarlier(): Promise<Snapshot[]> {
    if (earlier) return earlier
    let raw: string | null = null
    try {
      raw = (await fs.readFile(pendingPath)).toString('utf8')
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    const loaded = raw === null ? [] : parsePending(raw)
    if (raw !== null && loaded.length === 0) await fs.rm(pendingPath, { force: true })
    earlier = loaded
    return loaded
  }

  /**
   * Restoring a record while its game runs would be undone by the engine's write-on-exit. Known
   * limit: a crashed game's pid reused by an unrelated process defers the restore until that exits.
   */
  const gameRuns = (record: Snapshot): boolean => record.pid !== undefined && isAlive(record.pid)

  function retryWhileRunning(live: readonly Snapshot[]): void {
    const pid = live[0]?.pid
    if (pid === undefined || disposed) return
    if (!waitingAnnounced) {
      waitingAnnounced = true
      onWaiting?.(pid)
    }
    cancelRetry?.()
    cancelRetry = scheduleRetry(() => {
      cancelRetry = null
      // A failed retry leaves the pending file in place for the next launcher start.
      void restorer.applyPending().catch(() => undefined)
    })
  }

  const restorer: CvarRestore = {
    snapshot(configPath, options) {
      return serial(async () => {
        const pending = await loadEarlier()
        // A record whose game still runs keeps governing until that game is gone: it is neither
        // applied nor dropped here, and this session gets a record of its own beside it.
        const live = pending.filter(gameRuns)
        // A record a failed restore left behind holds the user's ORIGINAL lines; the config still
        // carries the stage values, so snapshotting it would lose them. Repair first, and if that
        // fails again this session takes over the record - without the old pid, its game is gone.
        let adopted: Snapshot | null = null
        for (const record of pending) {
          if (live.includes(record)) continue
          try {
            await apply(record)
          } catch {
            // the config could not be repaired: the oldest such record holds the originals
            adopted ??= record
          }
        }
        earlier = live
        retryWhileRunning(live)
        if (adopted) {
          const { configPath: path, lines, file } = adopted
          current = { configPath: path, lines, ...(file !== undefined ? { file } : {}) }
          await save()
          return
        }
        let next: Snapshot
        if (options?.wholeFile) {
          const bytes = await readBytes(configPath)
          next = { configPath, lines: new Map(), file: bytes?.toString('base64') ?? null }
        } else {
          const text = await readText(configPath)
          const lines = new Map<string, string | null>(names.map((n) => [n, null]))
          for (const segment of text === null ? [] : splitLines(text)) {
            const name = cvarNameOf(segment.content)
            // The last one wins when the engine execs the file, so that is the line that counts.
            if (name !== null && lines.has(name)) lines.set(name, segment.content)
          }
          next = { configPath, lines }
        }
        current = next
        await save()
      })
    },
    recordPid(pid) {
      return serial(async () => {
        const snapshot = current
        if (!snapshot || snapshot.pid !== undefined) return
        snapshot.pid = pid
        await save()
      })
    },
    originalsLine() {
      if (!current || current.file !== undefined || current.lines.size === 0) return null
      const commands = [...current.lines].map(([name, line]) => {
        const value = line === null ? null : cvarValueOf(line)
        return value === null ? `reset ${name}` : `set ${name} "${value}"`
      })
      return commands.join('; ')
    },
    restore() {
      return serial(async () => {
        const snapshot = current
        current = null
        if (!snapshot) return
        try {
          await apply(snapshot)
        } catch (error) {
          // The pending file still holds the record, so the next snapshot or start tries again.
          earlier = [...(earlier ?? []), snapshot]
          throw error
        }
        await save()
      })
    },
    applyPending() {
      return serial(async () => {
        const pending = await loadEarlier()
        const live = pending.filter(gameRuns)
        try {
          for (const record of pending) if (!live.includes(record)) await apply(record)
          if (live.length < pending.length) {
            earlier = live
            await save()
          }
        } finally {
          // A dead game's failed apply must not leave a running game's record without its wait.
          retryWhileRunning(live)
        }
      })
    },
    dispose() {
      disposed = true
      cancelRetry?.()
      cancelRetry = null
    },
  }
  return restorer
}
