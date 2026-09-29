import { realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DiscoveredDemo } from '@shared/modules/replays'
import { demoPlayEligibility } from '@shared/replays/demo-play'
import { fail, ok, type Installation, type LaunchInput, type LaunchState, type Outcome } from '@shared/types'
import { isFile, listDir, pathKey } from '../../lib/fs-utils'
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
 */

const NOT_FOUND = 'replays.play.error.notFound'
const FILE_MISSING = 'replays.play.error.fileMissing'
const NOT_IN_INSTALLATION = 'replays.play.unavailable.notInInstallation'

/** The slice of `LaunchService` this handler needs - a fake stands in for it in tests. */
export interface DemoPlayLaunch {
  isRunning(): boolean
  start(input: LaunchInput): Promise<Outcome<LaunchState>>
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
}

export interface DemoPlay {
  play: (demoId: string, installationId: string) => Promise<Outcome<void>>
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

  return {
    async play(demoId, installationId) {
      const demo = (await deps.readDemos()).find((row) => row.id === demoId)
      const file = deps.resolveFile(demoId)
      if (!demo || !file) return fail(NOT_FOUND)

      const installations = deps.installations()
      const eligibility = demoPlayEligibility({
        demo,
        installations,
        activeInstallationId: deps.activeInstallationId(),
        platform: deps.platform,
        gameRunning: deps.launch.isRunning(),
      })
      if (!eligibility.ok) return fail(eligibility.reason.key, eligibility.reason.params)
      if (installationId !== eligibility.installationId) return fail(NOT_IN_INSTALLATION)

      const installation = installations.find((i) => i.id === eligibility.installationId)
      if (!installation || demo.source.kind !== 'installation' || file.archiveEntry !== null) {
        return fail(NOT_IN_INSTALLATION)
      }

      const contained = await containment(file.absolutePath, join(installation.rootPath, demo.source.gameDir))
      if (contained === 'missing') return fail(FILE_MISSING)
      if (contained === 'outside') return fail(NOT_IN_INSTALLATION)

      const started = await deps.launch.start({
        installationId: eligibility.installationId,
        gameDir: eligibility.gameDir,
        extraArgs: eligibility.extraArgs,
      })
      if (!started.ok) return started

      trackSession(demoId)
      return ok(undefined)
    },
  }
}
