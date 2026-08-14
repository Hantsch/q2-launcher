import { spawn, type ChildProcess } from 'node:child_process'
import {
  IDLE_LAUNCH_STATE,
  fail,
  ok,
  type LaunchInput,
  type LaunchPlan,
  type LaunchState,
  type Outcome,
} from '@shared/types'
import { isFile } from '../lib/fs-utils'
import { scopedLogger } from '../lib/logger'
import { buildLaunchArgs, previewCommand } from './launch-plan'
import type { InstallationsService } from './installations'

const log = scopedLogger('launch')

export interface LaunchDeps {
  installations: InstallationsService
  onStateChange: (state: LaunchState) => void
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
  private readonly onStateChange: (state: LaunchState) => void
  private current: LaunchState = IDLE_LAUNCH_STATE
  private startedAtMs = 0

  constructor(deps: LaunchDeps) {
    this.installations = deps.installations
    this.onStateChange = deps.onStateChange
  }

  getState(): LaunchState {
    return this.current
  }

  isRunning(): boolean {
    return this.current.phase === 'starting' || this.current.phase === 'running'
  }

  /** Builds the exact command line without running it. Also used by the UI preview. */
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

    return ok({
      executablePath: installation.executablePath,
      args,
      workingDirectory: installation.rootPath,
      preview: previewCommand(installation.executablePath, args),
    })
  }

  async start(input: LaunchInput): Promise<Outcome<LaunchState>> {
    if (this.isRunning()) {
      return fail('launch.error.alreadyRunning')
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

  private setState(next: LaunchState): void {
    this.current = next
    this.onStateChange(next)
  }
}
