import { spawn, type ChildProcess } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { BASE_GAME_DIR } from '@shared/constants'
import { CONNECT_CFG_NAME, renderConnectCfg } from '@shared/launch/userinfo'
import { parseServerAddress } from '@shared/servers/address'
import {
  IDLE_LAUNCH_STATE,
  STEAM_APP_CLIENTS,
  STEAM_RUNNER_CHOICE,
  fail,
  ok,
  steamLaunchUrl,
  type DetectedRunner,
  type Installation,
  type LaunchInput,
  type LaunchPlan,
  type LaunchState,
  type Outcome,
} from '@shared/types'
import { isFile } from '../lib/fs-utils'
import { scopedLogger } from '../lib/logger'
import { buildLaunchArgs, execsConnectCfg, hasUserinfo, previewCommand } from './launch-plan'
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
 * Story 125: best-effort, idempotent removal of the one-shot connect cfg. A missing file is not an
 * error (`force`); anything else is logged by path only - the file's contents are never read.
 */
async function removeConnectCfg(path: string): Promise<void> {
  try {
    await rm(path, { force: true })
  } catch (error) {
    log.warn(`could not remove the connect cfg ${path}`, error)
  }
}

/**
 * Story 104 D4: the plan that hands this installation's launch to Steam, or `undefined` when the
 * resolved runner is not Steam (or the stored client index is not one Steam lists for the appid) -
 * in which case the caller plans the normal way. The command is only `<steam> <steam://launch URL>`:
 * none of `buildLaunchArgs`' `+set` arguments apply, because Steam starts the game itself.
 */
function steamHandoffPlan(
  installation: Installation,
  runner: DetectedRunner | undefined,
): LaunchPlan | undefined {
  if (runner?.kind !== 'steam' || !installation.steamAppId) return undefined
  const table = STEAM_APP_CLIENTS[installation.steamAppId]
  if (!table) return undefined
  const url = steamLaunchUrl(installation.steamAppId, installation.steamClient ?? table.defaultIndex)
  if (!url) {
    log.warn(
      `not handing ${installation.id} to Steam: client ${String(installation.steamClient)} is not listed for app ${installation.steamAppId}`,
    )
    return undefined
  }
  log.info(`handing ${installation.id} off to Steam: ${url}`)
  const args = [url]
  return {
    executablePath: runner.path,
    args,
    workingDirectory: installation.rootPath,
    preview: previewCommand(runner.path, args),
    handoff: true,
  }
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
  /** Story 125: incremented by every `start()`; see `removeOwnedCfg` there. */
  private launchSeq = 0
  /** Story 125 review fix: a `start()` is between its guards and its first state change. */
  private startInFlight = false

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

  /** Story 104 D4: `'handed-off'` is deliberately absent - Steam, not us, runs that game. */
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

    // Story 104 D4: a stored Steam choice is checked *before* `needsCompatRunner` below, because
    // Steam is not a compatibility wrapper - it applies on every platform and to every executable
    // kind, so that guard (false on win32 and for ELF) would never let it through. Runner detection
    // is still only paid for when the user actually chose Steam, so an installation without that
    // choice plans exactly as before (no detection at all on Windows). If Steam cannot serve the
    // choice right now, this falls through to the normal plan below.
    let detected: DetectedRunner[] | undefined
    if (installation.runner === STEAM_RUNNER_CHOICE) {
      detected = await this.detectRunners()
      const handoff = steamHandoffPlan(installation, resolveRunner(installation, detected))
      if (handoff) {
        // Story 125: a steam:// URL has no way to carry `+connect` (or the connect cfg's
        // `+exec`), so a join through Steam would silently land in the menu instead.
        if (input.connect) {
          log.warn(`refused to join a server through Steam for ${installation.id}: needs a direct launch`)
          return fail('launch.error.connectNeedsDirectLaunch')
        }
        return ok(handoff)
      }
      // Review fix: an unusable Steam choice degrades to "as if not chosen", never to
      // "half-executed". `resolveRunner` can still pick Steam here (it is available and knows the
      // appid) even though `steamHandoffPlan` refused - e.g. a stored `steamClient` the table does
      // not list - and the compat branch below would then wrap `steam` around the executable like
      // wine. Without Steam in the list the cascade below cannot reach it at all (it is not one of
      // the `WRAPPING_KINDS`), so it resolves exactly as it would with no stored choice.
      detected = detected.filter((runner) => runner.kind !== 'steam')
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
      const runner = resolveRunner(installation, detected ?? (await this.detectRunners()))
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
    // Story 125 review fix: `phase` only becomes `'starting'` after the sweep, `plan()` and the
    // connect-cfg write have all been awaited, so on its own `isRunning()` would let a second,
    // overlapping `start()` (a double-clicked Join) through - and its sweep would delete this
    // launch's freshly written password cfg before the game read it, while its `launchSeq` bump
    // would turn this launch's own cleanup into a no-op. `startInFlight` covers exactly that gap.
    // It is private rather than a broadcast phase so a start that is refused before anything runs
    // (plan failure, Steam refusing a join) still changes no visible state at all.
    if (this.isRunning() || this.startInFlight) {
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

    // Set synchronously, with no `await` between the checks above and here, and cleared on every
    // way out - by then either `phase` is `'starting'` (so `isRunning()` takes over) or the start
    // failed and a later one must not be blocked.
    this.startInFlight = true
    try {
      return await this.startReserved(input)
    } finally {
      this.startInFlight = false
    }
  }

  /** `start()` past its guards, with the in-flight reservation held - see `startInFlight`. */
  private async startReserved(input: LaunchInput): Promise<Outcome<LaunchState>> {
    // Story 125: every launch counts, so an event arriving late from an earlier, already
    // finished launch can never remove the connect cfg this one is about to write.
    const launchSeq = ++this.launchSeq

    // Story 125: a connect cfg left behind by a run that never reached its own cleanup (the
    // launcher was killed, the machine went down) still holds a password - it goes before
    // anything else happens to this installation, whether or not this launch is a join.
    const installation = this.installations.find(input.installationId)
    const cfgPath = installation
      ? join(installation.rootPath, BASE_GAME_DIR, CONNECT_CFG_NAME)
      : undefined
    if (cfgPath) await removeConnectCfg(cfgPath)

    const planned = await this.plan(input)
    if (!planned.ok) return planned

    if (planned.value.handoff) return this.handOff(input.installationId, planned.value)

    const { executablePath, args, workingDirectory } = planned.value

    // Story 125: the join password reaches the game through this file and never through argv
    // or a log line. Written only when the planned command line actually execs it, and
    // before `spawn`, so it is there when the game starts reading its late commands.
    const userinfo = input.userinfo
    let ownedCfg: string | undefined
    if (cfgPath && hasUserinfo(userinfo) && execsConnectCfg(args)) {
      try {
        await writeFile(cfgPath, renderConnectCfg(userinfo), { mode: 0o600 })
        ownedCfg = cfgPath
      } catch (error) {
        // `error` carries the path and an errno or a rejection reason - never a value.
        log.error(`could not write the connect cfg for ${input.installationId}`, error)
        await removeConnectCfg(cfgPath)
        return fail('launch.error.spawnFailed', { path: executablePath })
      }
    }

    /**
     * Story 125: the cfg has to outlive `spawn()` - the game reads it only once it is up and
     * running its late commands, which can be long after `spawn()` returns - so it is removed
     * only when this launch is over: the process exited, errored, or never started. Never right
     * after `spawn()` returns. Idempotent, and a no-op once a newer launch has begun.
     */
    const removeOwnedCfg = async (): Promise<void> => {
      if (ownedCfg && launchSeq === this.launchSeq) await removeConnectCfg(ownedCfg)
    }

    const address = input.connect ? parseServerAddress(input.connect) : undefined
    const connect = address?.ok ? { connect: address.normalized } : {}

    this.setState({
      phase: 'starting',
      installationId: input.installationId,
      startedAt: new Date().toISOString(),
      ...connect,
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
      await removeOwnedCfg()
      this.setState({
        phase: 'failed',
        installationId: input.installationId,
        error: { key: 'launch.error.spawnFailed', params: { path: executablePath } },
      })
      return fail('launch.error.spawnFailed', { path: executablePath })
    }

    this.startedAtMs = Date.now()
    // Only the argv array is ever logged: `buildLaunchArgs` never reads a userinfo value, so a
    // join password cannot appear here (story 125).
    log.info(`launching ${executablePath} ${args.join(' ')}`)

    child.once('spawn', () => {
      this.setState({
        phase: 'running',
        installationId: input.installationId,
        startedAt: new Date().toISOString(),
        ...(child.pid !== undefined ? { pid: child.pid } : {}),
        ...connect,
      })
    })

    child.once('error', (error: Error) => {
      void removeOwnedCfg()
      log.error('game process error', error)
      this.setState({
        phase: 'failed',
        installationId: input.installationId,
        error: { key: 'launch.error.processError', params: { message: error.message } },
      })
    })

    child.once('exit', (code) => {
      void removeOwnedCfg()
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
   * Story 104 D4: the process-less launch path. The spawned `steam` only forwards the URL to the
   * Steam client (or *becomes* the client if none was running), so it is started `detached` and
   * `unref`'d - otherwise quitting the launcher would take Steam down with it, and a still-open
   * Steam would keep the launcher's event loop alive. Its exit says nothing about the game, so no
   * `'exit'` listener, no playtime and no pid: `'spawn'` ends in `'handed-off'`, which neither
   * `isRunning()` nor the write guard count as running.
   */
  private handOff(installationId: string, plan: LaunchPlan): Outcome<LaunchState> {
    const { executablePath, args, workingDirectory } = plan
    this.setState({ phase: 'starting', installationId, startedAt: new Date().toISOString() })

    let child: ChildProcess
    try {
      child = spawn(executablePath, args, {
        cwd: workingDirectory,
        stdio: 'ignore',
        detached: true,
      })
    } catch (error) {
      log.error(`spawn failed for ${executablePath}`, error)
      this.setState({
        phase: 'failed',
        installationId,
        error: { key: 'launch.error.spawnFailed', params: { path: executablePath } },
      })
      return fail('launch.error.spawnFailed', { path: executablePath })
    }
    child.unref()
    log.info(`handing off: ${executablePath} ${args.join(' ')}`)

    child.once('spawn', () => {
      this.setState({ phase: 'handed-off', installationId, startedAt: new Date().toISOString() })
    })

    child.once('error', (error: Error) => {
      log.error('steam handoff process error', error)
      this.setState({
        phase: 'failed',
        installationId,
        error: { key: 'launch.error.processError', params: { message: error.message } },
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
