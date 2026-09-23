import { spawn, type ChildProcess } from 'node:child_process'
import { basename } from 'node:path'
import {
  IDLE_LAUNCH_STATE,
  fail,
  ok,
  type DetectedRunner,
  type LaunchInput,
  type LaunchPlan,
  type LaunchState,
  type Outcome,
} from '@shared/types'
import { isFile } from '../lib/fs-utils'
import { scopedLogger } from '../lib/logger'
import { buildLaunchArgs, previewCommand } from './launch-plan'
import { detectRunners, needsCompatRunner, resolveRunner } from './runners'
import type { InstallationsService } from './installations'
import type { WriteLockReader } from './write-guard'

const log = scopedLogger('launch')

/**
 * Notified with the current launch state every time it changes. Both the shell's
 * own broadcast callback and every `onStateChange` observer use this one shape.
 */
export type LaunchStateListener = (state: LaunchState) => void

export interface LaunchDeps {
  installations: InstallationsService
  onStateChange: LaunchStateListener
  /**
   * Story 091 D2: the installation write guard, as a getter for the same reason
   * `AppContext.getMainWindow` is one - the guard is built *from* this service,
   * so it does not exist yet when this service is constructed.
   */
  getWriteGuard?: () => WriteLockReader | null
  /**
   * Story 103 D5: how `plan()` learns which compatibility runners this machine has. Injectable
   * only so a test can hand in a list instead of a real `PATH`/Steam scan; production wiring uses
   * the default, and it is never called at all on the native path (see `plan()`).
   */
  detectRunners?: () => Promise<DetectedRunner[]>
}

/**
 * Starts the game and follows its lifecycle.
 *
 * Arguments are passed to `spawn` as an array and never through a shell, so
 * paths with spaces, ampersands or quotes cannot break the command line - a real
 * hazard here, since Quake II installs live in places like
 * `C:\Program Files (x86)\Steam\steamapps\common\Quake 2`.
 */
export class LaunchService {
  private readonly installations: InstallationsService
  /**
   * The shell's own consumer, handed in at construction: `context.ts` wires it to
   * the `launch:state` broadcast the whole UI reads. Deliberately separate from
   * `listeners` below - not optional, not removable, and called first.
   */
  private readonly broadcast: LaunchStateListener
  /** Story 091 D2's additive observers - see `onStateChange()`. */
  private readonly listeners = new Set<LaunchStateListener>()
  private readonly getWriteGuard: (() => WriteLockReader | null) | undefined
  private readonly detectRunners: () => Promise<DetectedRunner[]>
  private current: LaunchState = IDLE_LAUNCH_STATE
  private startedAtMs = 0

  constructor(deps: LaunchDeps) {
    this.installations = deps.installations
    this.broadcast = deps.onStateChange
    this.getWriteGuard = deps.getWriteGuard
    this.detectRunners = deps.detectRunners ?? detectRunners
  }

  getState(): LaunchState {
    return this.current
  }

  /**
   * Story 091 D2: registers an additional observer of launch state, and returns
   * its unsubscribe function. `InstallationWriteGuard` uses it to learn that a
   * game has exited so a deferred write can resume on its own (AC3).
   *
   * Additive by construction, exactly as `JobsService.onChange` is: the
   * constructor's `broadcast` is still called exactly once per change and
   * *before* any listener, so nothing here can delay, suppress or double the
   * `launch:state` traffic the action bar depends on; a listener that throws is
   * logged and skipped.
   */
  onStateChange(listener: LaunchStateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  isRunning(): boolean {
    return this.current.phase === 'starting' || this.current.phase === 'running'
  }

  /**
   * Builds the exact command line without running it. Also used by the UI preview.
   *
   * Story 103 D5: and it is the *only* place a compatibility runner is applied. Everything
   * downstream - the preview string, `start()`'s `spawn`, and with it the `launch:state` sequence,
   * the playtime recorded on exit and the write guard's view of a running game - reads the pair
   * this function returns, so wrapping here means none of them needed a change (AC5), and a plan
   * that cannot be run at all is refused here rather than spawned and reported as a clean exit
   * four seconds later (AC7).
   */
  async plan(input: LaunchInput): Promise<Outcome<LaunchPlan>> {
    const installation = this.installations.find(input.installationId)
    if (!installation) return fail('launch.error.notFound')

    if (!installation.executablePath) {
      return fail('launch.error.noExecutable', { name: installation.name })
    }
    if (!(await isFile(installation.executablePath))) {
      return fail('launch.error.executableMissing', { path: installation.executablePath })
    }

    const { args, dropped } = buildLaunchArgs(installation, input)
    for (const entry of dropped) {
      log.warn(`dropped unsafe launch value "${entry.value}" (${entry.reason})`)
    }

    // Story 103 D5: on Windows - and for any executable the OS can run itself - `needsCompatRunner`
    // is false, so no runner is detected, nothing is rewritten, and the four values below are the
    // ones this function has always returned (AC8). Off Windows, a Windows PE is wrapped:
    // `<runner> <exe> <the same generated args>`, still an argv array, never a shell string, and
    // with no `env` of our own - Q2's machine-default wine prefix.
    let executablePath = installation.executablePath
    let commandArgs = args
    if (needsCompatRunner(installation)) {
      const runner = resolveRunner(installation, await this.detectRunners())
      if (!runner) {
        log.warn(`refused to plan ${installation.id}: no runner can run ${executablePath}`)
        return fail('launch.error.noRunner', { executable: basename(executablePath) })
      }
      log.info(`wrapping ${basename(executablePath)} in runner ${runner.id}`)
      commandArgs = [executablePath, ...args]
      executablePath = runner.path
    }

    return ok({
      executablePath,
      args: commandArgs,
      // The game's own folder, not the runner's: wine/umu-run pass their working directory through
      // to the process they start, which is what `+set game` and every relative path in the engine
      // depend on.
      workingDirectory: installation.rootPath,
      preview: previewCommand(executablePath, commandArgs),
    })
  }

  async start(input: LaunchInput): Promise<Outcome<LaunchState>> {
    if (this.isRunning()) {
      return fail('launch.error.alreadyRunning')
    }

    // Story 091 AC5, the inverse direction of the write guard: a job copying into
    // this installation's folder must not have the files pulled out from under it
    // by the game starting. Asked of the guard itself, never derived from the
    // renderer-visible `Job.writeLock`, so the authoritative answer is main's.
    if (this.getWriteGuard?.()?.isWriting(input.installationId) === true) {
      log.warn(`refused to launch ${input.installationId}: a job is writing into it`)
      return fail('launch.error.installationBusy')
    }

    const planned = await this.plan(input)
    if (!planned.ok) return planned

    const { executablePath, args, workingDirectory } = planned.value
    this.setState({
      phase: 'starting',
      installationId: input.installationId,
      startedAt: new Date().toISOString(),
    })

    let child: ChildProcess
    try {
      child = spawn(executablePath, args, {
        cwd: workingDirectory,
        // The game owns its window; we want no pipes and no shell in between.
        stdio: 'ignore',
        windowsHide: false,
        detached: false,
      })
    } catch (error) {
      log.error(`spawn failed for ${executablePath}`, error)
      this.setState({
        phase: 'failed',
        installationId: input.installationId,
        error: { key: 'launch.error.spawnFailed', params: { path: executablePath } },
      })
      return fail('launch.error.spawnFailed', { path: executablePath })
    }

    this.startedAtMs = Date.now()
    log.info(`launching ${executablePath} ${args.join(' ')}`)

    child.once('spawn', () => {
      this.setState({
        phase: 'running',
        installationId: input.installationId,
        startedAt: new Date().toISOString(),
        ...(child.pid !== undefined ? { pid: child.pid } : {}),
      })
    })

    child.once('error', (error: Error) => {
      log.error('game process error', error)
      this.setState({
        phase: 'failed',
        installationId: input.installationId,
        error: { key: 'launch.error.processError', params: { message: error.message } },
      })
    })

    child.once('exit', (code) => {
      const seconds = (Date.now() - this.startedAtMs) / 1000
      this.installations.recordPlaySession(input.installationId, seconds)
      log.info(`game exited with code ${String(code)} after ${Math.round(seconds)}s`)
      this.setState({
        phase: 'exited',
        installationId: input.installationId,
        exitedAt: new Date().toISOString(),
        exitCode: code,
      })
    })

    return ok(this.current)
  }

  /**
   * Story 090 D5: drives `launch:state` for `dev:simulateLaunch`, since fixture
   * engine binaries used in e2e tests are filler bytes and cannot actually be
   * spawned. Goes through the same `current`/`onStateChange` path `start()`
   * uses, so it is indistinguishable from a real launch/exit to any consumer -
   * there is no second, parallel notion of launch state.
   */
  simulate(phase: 'running' | 'idle', installationId: string): void {
    if (phase === 'idle') {
      this.setState(IDLE_LAUNCH_STATE)
      return
    }
    this.setState({
      phase: 'running',
      installationId,
      startedAt: new Date().toISOString(),
    })
  }

  /**
   * One snapshot per change, delivered to the shell's broadcast first and to the
   * `onStateChange` listeners afterwards - the same order, and for the same
   * reason, as `JobsService.emit()`. The listener set is copied before iterating,
   * so an observer that unsubscribes during delivery (the write guard does
   * exactly that the moment it resumes) cannot change the set mid-iteration.
   */
  private setState(next: LaunchState): void {
    this.current = next
    this.broadcast(next)
    for (const listener of [...this.listeners]) {
      try {
        listener(next)
      } catch (error) {
        log.error('a launch onStateChange listener threw', error)
      }
    }
  }
}
