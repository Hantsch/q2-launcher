import { stateFilePath } from './lib/paths'
import { scopedLogger } from './lib/logger'
import { MainModuleRegistry } from './modules/registry'
import { registerModules } from './modules'
import { Broadcaster } from './services/broadcast'
import { DetectionService } from './services/detection'
import { InstallationsService } from './services/installations'
import { JobsService } from './services/jobs'
import { LaunchService } from './services/launch'
import { StateStore } from './services/state'

const log = scopedLogger('context')

/**
 * The services the main process is built from, created once and passed
 * explicitly to the IPC layer and to modules.
 *
 * No singletons and no module-level mutable state: every service takes its
 * dependencies in its constructor, which is what makes them testable without
 * booting Electron.
 */
export interface AppContext {
  isDev: boolean
  state: StateStore
  installations: InstallationsService
  detection: DetectionService
  launch: LaunchService
  jobs: JobsService
  modules: MainModuleRegistry
  broadcast: Broadcaster
}

export async function createAppContext(options: { isDev: boolean }): Promise<AppContext> {
  const broadcast = new Broadcaster()

  const state = new StateStore(stateFilePath())
  await state.load()

  const installations = new InstallationsService({
    state,
    onChange: (list) => broadcast.emit('installations:changed', list),
    onSettingsChange: (settings) => broadcast.emit('settings:changed', settings),
  })

  const detection = new DetectionService({
    emitProgress: (progress) => broadcast.emit('detection:progress', progress),
    isRegistered: (key) => installations.isRegistered(key),
  })

  const launch = new LaunchService({
    installations,
    onStateChange: (launchState) => broadcast.emit('launch:state', launchState),
  })

  const jobs = new JobsService((list) => broadcast.emit('jobs:changed', list))

  const context: AppContext = {
    isDev: options.isDev,
    state,
    installations,
    detection,
    launch,
    jobs,
    modules: new MainModuleRegistry(),
    broadcast,
  }

  await registerModules(context)

  if (state.recoveredFrom) {
    // Told once, on the first render, rather than swallowed into the log file.
    log.warn(`state recovered from ${state.recoveredFrom}`)
  }

  return context
}
