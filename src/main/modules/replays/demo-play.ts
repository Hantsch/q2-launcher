import { realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DemoFormat, DiscoveredDemo } from '@shared/modules/replays'
import { DEMO_BASE_GAME_DIR, demoPlayEligibility } from '@shared/replays/demo-play'
import {
  fail,
  ok,
  type Installation,
  type LaunchInput,
  type LaunchPhase,
  type LaunchState,
  type Outcome,
} from '@shared/types'
import { isFile, listDir, pathKey } from '../../lib/fs-utils'
import { removeStagedCopy, stageDemo, stagedFileName } from './demo-staging'
import { effectiveWriteDirs, type DiscoverableInstallation, type DiscoverContext } from './discovery'
import type { PlaybackSession } from '../../services/playback-session'
import type { PlaybackControl } from './playback-control'
import type { EngineIo } from './playback-channel/types'
import type { PlaybackSessions } from './playback-sessions'

/**
 * Story 159 D2: `demo.play` - the one path where a renderer-sent demo id becomes a spawned process.
 * Same resolve-then-act shape as `file-actions.ts`, with every decision re-made on main's own data:
 *
 * 1. the id is looked up in main's index (row + resolved file) - never a renderer-supplied path;
 * 2. eligibility (`demoPlayEligibility`, shared with the renderer) runs again on main's installations,
 *    active installation and launch state, and the payload's installation id must be the eligible one;
 * 3. containment: the file's realpath's parent must BE the realpath of that installation's
 *    `<rootPath>/<gameDir>/demos` folder (found case-insensitively, as discovery does) - an equality
 *    check, never a string prefix, so a sibling root such as `Quake2-other` is refused;
 * 4. only then is the launch started, and a playback session tracked until the game exits.
 *
 * Story 160 D2: a demo that is NOT in place (another installation's, an extra folder's, a zip entry,
 * or a file whose realpath is outside the demos folder) is no longer refused. It gets a temporary
 * copy in `<gamedir>/demos/_launcher/` (`demo-staging.ts`), the game plays that copy, and the copy
 * is removed when exactly that installation's game exits or fails, or when the launch never starts.
 * An in-place play never gets a copy, so nothing on that path ever deletes a file.
 */

const NOT_FOUND = 'replays.play.error.notFound'
const FILE_MISSING = 'replays.play.error.fileMissing'
/** The payload named an installation other than the active Q2PRO one: the same "not the Q2PRO to play in" reason. */
const WRONG_INSTALLATION = 'replays.play.unavailable.notQ2pro'
const UNSAFE_NAME = 'replays.play.unavailable.unsafeName'

/** Same rule as the eligibility check's file-name guard: what the game console can take. */
const SAFE_FILE_NAME = /^[A-Za-z0-9_.-]+$/

/** Where a copy of a demo for `gameDir` may go, in priority order: the installation, then its write dirs. */
export function stagingDemosDirs(
  installation: DiscoverableInstallation,
  gameDir: string,
  context: DiscoverContext,
): string[] {
  return [installation.rootPath, ...effectiveWriteDirs(installation, context)].map((root) =>
    join(root, gameDir, 'demos'),
  )
}

/** Every `demos` dir a copy could have been staged in, over all installations - the startup sweep's input. */
export function launcherSweepDirs(
  installations: readonly DiscoverableInstallation[],
  context: DiscoverContext,
): string[] {
  const dirs = new Map<string, string>()
  for (const installation of installations) {
    for (const gameDir of new Set([DEMO_BASE_GAME_DIR, ...installation.gameDirs])) {
      for (const dir of stagingDemosDirs(installation, gameDir, context)) dirs.set(pathKey(dir), dir)
    }
  }
  return [...dirs.values()]
}

/** The slice of `LaunchService` this handler needs - a fake stands in for it in tests. */
export interface DemoPlayLaunch {
  isRunning(): boolean
  start(input: LaunchInput, options?: { playback?: true }): Promise<Outcome<LaunchState>>
  /** Story 164 D4: the piped session of a `{ playback: true }` launch (Linux). */
  getPlaybackSession?(): PlaybackSession | undefined
  onStateChange(listener: (state: LaunchState) => void): () => void
}

export interface DemoPlayDeps {
  /** Main's current index rows (`ReplaysScanService.read`). */
  readDemos: () => Promise<readonly DiscoveredDemo[]>
  /** Mirrors `ReplaysScanService.resolveFile`. */
  resolveFile: (id: string) => { absolutePath: string; archiveEntry: DiscoveredDemo['archiveEntry'] } | undefined
  installations: () => readonly Installation[]
  activeInstallationId: () => string | null
  platform: string
  launch: DemoPlayLaunch
  sessions: Pick<PlaybackSessions, 'begin' | 'end'>
  /** Story 160: platform, home dir (Q2PRO's Linux write dir) and zip extractor, as discovery uses them. */
  discoveryContext: () => DiscoverContext
  /**
   * Story 160: settles once the startup sweep of `_launcher` folders is done (it never rejects), so a
   * play right after start can never have its fresh copy swept away under it.
   */
  stagingReady?: () => Promise<void>
  /** Story 164 D4: the running demo's control channel; absent, a demo plays without one. */
  playback?: PlaybackControl
}

/**
 * Story 164 D4: the Linux `EngineIo` over a playback session's pipes - lines out with a newline, stdout
 * chunks split into lines (an unterminated tail is held until its newline arrives).
 */
export function engineIoFromSession(session: PlaybackSession): EngineIo {
  return {
    writeLine: (line) => {
      session.write(`${line}\n`)
    },
    onLine: (cb) => {
      let tail = ''
      return session.onStdout((chunk) => {
        const parts = (tail + chunk.toString('utf8')).split(/\r?\n/)
        tail = parts.pop() ?? ''
        for (const line of parts) cb(line)
      })
    },
  }
}

export interface DemoPlay {
  play: (
    demoId: string,
    installationId: string,
    options?: { acknowledgeModMissing?: boolean },
  ) => Promise<Outcome<void>>
}

type Containment = 'contained' | 'outside' | 'missing'

/** Case-insensitive lookup of a `demos` child folder - same rule as discovery's `findDemosDir`. */
async function findDemosDir(gameDirPath: string): Promise<string | null> {
  const actual = (await listDir(gameDirPath)).byLowerName.get('demos')
  return actual ? join(gameDirPath, actual) : null
}

async function containment(filePath: string, gameDirPath: string): Promise<Containment> {
  let realFile: string
  try {
    realFile = await realpath(filePath)
  } catch {
    return 'missing'
  }
  const demosDir = await findDemosDir(gameDirPath)
  if (demosDir === null) return 'outside'
  let realDemosDir: string
  try {
    realDemosDir = await realpath(demosDir)
  } catch {
    return 'outside'
  }
  // Parent equality, never a prefix check: `pathKey` only normalises trailing separators and (off
  // Linux) case, both sides already being realpaths.
  if (pathKey(dirname(realFile)) !== pathKey(realDemosDir)) return 'outside'
  return (await isFile(realFile)) ? 'contained' : 'missing'
}

export function createDemoPlay(deps: DemoPlayDeps): DemoPlay {
  /** Begins a session and ends it exactly once, as soon as the game is no longer starting/running. */
  function trackSession(demoId: string): void {
    deps.sessions.begin(demoId)
    let ended = false
    let unsubscribe: (() => void) | null = null
    const finish = (): void => {
      if (ended) return
      ended = true
      deps.sessions.end(demoId)
      const unsub = unsubscribe
      unsubscribe = null
      unsub?.()
    }
    const subscription = deps.launch.onStateChange((state) => {
      if (state.phase !== 'starting' && state.phase !== 'running') finish()
    })
    if (ended) {
      // The listener fired during subscription itself, before `unsubscribe` was assigned.
      subscription()
      return
    }
    unsubscribe = subscription
    // The game may already have exited between `start()` resolving and the subscription.
    if (!deps.launch.isRunning()) finish()
  }

  /**
   * Story 160: removes the staged copy exactly once, when the game of `installationId` - and no other
   * installation's - reaches `exited` or `failed`. A hand-off leaves no process to follow (and never
   * happens for a demo play: eligibility refuses a Steam runner); the startup sweep covers it.
   */
  function trackCopy(installationId: string, copyPath: string, startedPhase: LaunchPhase): void {
    if (startedPhase === 'handed-off') return
    if (startedPhase === 'exited' || startedPhase === 'failed') {
      void removeStagedCopy(copyPath)
      return
    }
    let done = false
    let unsubscribe: (() => void) | null = null
    const stop = (remove: boolean): void => {
      if (done) return
      done = true
      const unsub = unsubscribe
      unsubscribe = null
      unsub?.()
      if (remove) void removeStagedCopy(copyPath)
    }
    const subscription = deps.launch.onStateChange((state) => {
      if (state.installationId !== installationId) return
      if (state.phase === 'exited' || state.phase === 'failed') stop(true)
      else if (state.phase === 'handed-off') stop(false)
    })
    if (done) {
      // The listener fired during subscription itself, before `unsubscribe` was assigned.
      subscription()
      return
    }
    unsubscribe = subscription
    // Gone between `start()` resolving and the subscription - it ran, so it exited or failed.
    if (!deps.launch.isRunning()) stop(true)
  }

  /** Starts the launch; `copyPath` (a staged copy, or null for an in-place play) is cleaned up on every end path. */
  async function launch(
    demoId: string,
    launchInput: LaunchInput,
    copyPath: string | null,
    playbackInfo: { gameDirPath: string; durationMs: number | null; format: DemoFormat },
  ): Promise<Outcome<void>> {
    const pipes = deps.platform !== 'win32'
    let input = launchInput
    if (deps.playback) {
      let prepared: Awaited<ReturnType<PlaybackControl['prepare']>>
      try {
        prepared = await deps.playback.prepare(playbackInfo)
      } catch (error) {
        await deps.playback.cancel()
        if (copyPath !== null) await removeStagedCopy(copyPath)
        throw error
      }
      const { argsBeforeDemo, argsAfterDemo } = prepared
      // `+demo` must precede the channel's `+exec` polling loop.
      input = { ...launchInput, extraArgs: [...argsBeforeDemo, ...(launchInput.extraArgs ?? []), ...argsAfterDemo] }
    }
    let started: Outcome<LaunchState>
    try {
      started = await (pipes && deps.playback
        ? deps.launch.start(input, { playback: true })
        : deps.launch.start(input))
    } catch (error) {
      await deps.playback?.cancel()
      if (copyPath !== null) await removeStagedCopy(copyPath)
      throw error
    }
    if (!started.ok) {
      await deps.playback?.cancel()
      if (copyPath !== null) await removeStagedCopy(copyPath)
      return started
    }
    if (deps.playback) {
      const session = pipes ? deps.launch.getPlaybackSession?.() : undefined
      void deps.playback.attach(session ? engineIoFromSession(session) : undefined)
    }
    if (copyPath !== null) trackCopy(input.installationId, copyPath, started.value.phase)
    trackSession(demoId)
    return ok(undefined)
  }

  /**
   * One play at a time: a second (double-clicked) play of the same demo would stage over the first
   * one's copy, fail to start because the first game is running, and then remove the copy that game
   * is about to open. It is refused the way a running game is.
   */
  let inFlight = false

  return {
    async play(demoId, installationId, options) {
      if (inFlight) return fail('replays.play.unavailable.gameRunning')
      inFlight = true
      try {
        return await playOnce(demoId, installationId, options?.acknowledgeModMissing === true)
      } finally {
        inFlight = false
      }
    },
  }

  async function playOnce(
    demoId: string,
    installationId: string,
    acknowledgeModMissing: boolean,
  ): Promise<Outcome<void>> {
    {
      const demo = (await deps.readDemos()).find((row) => row.id === demoId)
      const file = deps.resolveFile(demoId)
      if (!demo || !file) return fail(NOT_FOUND)

      const installations = deps.installations()
      const activeInstallationId = deps.activeInstallationId()
      const eligibility = demoPlayEligibility({
        demo,
        installations,
        activeInstallationId,
        platform: deps.platform,
        gameRunning: deps.launch.isRunning(),
        acknowledgeModMissing,
      })

      // Eligibility no longer cares where the demo is; whether it is a candidate for in-place play is
      // `inPlace`, and main still verifies containment below. Everything else is played from a copy.
      if (!eligibility.ok) return fail(eligibility.reason.key, eligibility.reason.params)
      const target = {
        installationId: eligibility.installationId,
        gameDir: eligibility.gameDir,
        inPlaceArgs: eligibility.inPlace ? eligibility.extraArgs : null,
      }
      // The payload's installation must be the active, eligible one.
      if (installationId !== target.installationId) return fail(WRONG_INSTALLATION)

      const installation = installations.find((i) => i.id === target.installationId)
      if (!installation) return fail(WRONG_INSTALLATION)
      const playbackInfo = {
        gameDirPath: join(installation.rootPath, target.gameDir),
        durationMs: demo.durationMs,
        format: demo.format,
      }

      if (target.inPlaceArgs !== null && demo.source.kind === 'installation' && file.archiveEntry === null) {
        const contained = await containment(file.absolutePath, join(installation.rootPath, demo.source.gameDir))
        if (contained === 'missing') return fail(FILE_MISSING)
        if (contained === 'contained') {
          return launch(
            demoId,
            { installationId: target.installationId, gameDir: target.gameDir, extraArgs: target.inPlaceArgs },
            null,
            playbackInfo,
          )
        }
      }

      // Not in place: stage a copy. Main's own resolved record decides whether it is a zip entry.
      if (!(await isFile(file.absolutePath))) return fail(FILE_MISSING)
      const stagingDemo: DiscoveredDemo = { ...demo, archiveEntry: file.archiveEntry }
      if (!SAFE_FILE_NAME.test(stagedFileName(stagingDemo))) return fail(UNSAFE_NAME)
      await deps.stagingReady?.()
      const context = deps.discoveryContext()
      const staged = await stageDemo({
        demo: stagingDemo,
        absolutePath: file.absolutePath,
        targetDemosDirs: stagingDemosDirs(installation, target.gameDir, context),
        zipDeps: context.zipDeps,
      })
      if (!staged.ok) return staged

      return launch(
        demoId,
        {
          installationId: target.installationId,
          gameDir: target.gameDir,
          extraArgs: ['+demo', staged.value.relativePath],
        },
        staged.value.copyPath,
        playbackInfo,
      )
    }
  }
}
