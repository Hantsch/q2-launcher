import type { BrowserWindow } from 'electron'
import { stateFilePath } from './lib/paths'
import { scopedLogger } from './lib/logger'
import { MainModuleRegistry } from './modules/registry'
import { registerModules } from './modules'
import { Broadcaster } from './services/broadcast'
import { DetectionService } from './services/detection'
import { DialogService } from './services/dialog'
import { deleteStoredIcon, InstallationIconsService } from './services/installation-icons'
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
  /** Story 067: the per-installation icon store (`userData/installation-icons/`). */
  icons: InstallationIconsService
  detection: DetectionService
  launch: LaunchService
  jobs: JobsService
  modules: MainModuleRegistry
  broadcast: Broadcaster
  /** Story 066 D4: the config-file picker modules reach through `ModuleSetup.app`, never `dialog` directly. */
  dialog: DialogService
}

export async function createAppContext(options: {
  isDev: boolean
  /**
   * Resolves the tracked main `BrowserWindow`. `index.ts` creates the window *after* the context
   * (`createMainWindow(context)` takes `context` as an argument), so this cannot be a `BrowserWindow`
   * reference yet at this point - only a getter that will resolve to one by the time anything actually
   * calls `DialogService.pickConfigFiles()`.
   */
  getMainWindow: () => BrowserWindow | null
}): Promise<AppContext> {
  const broadcast = new Broadcaster()

  const state = new StateStore(stateFilePath())
  await state.load()

  const installations = new InstallationsService({
    state,
    onChange: (list) => broadcast.emit('installations:changed', list),
    onSettingsChange: (settings) => broadcast.emit('settings:changed', settings),
    // Story 067: a removed installation takes its stored icon file with it, or `userData` keeps
    // one orphan PNG per removal forever.
    onRemoved: (id) => deleteStoredIcon(id),
  })

  const icons = new InstallationIconsService(installations)

  const detection = new DetectionService({
    emitProgress: (progress) => broadcast.emit('detection:progress', progress),
    isRegistered: (key) => installations.isRegistered(key),
  })

  const launch = new LaunchService({
    installations,
    onStateChange: (launchState) => broadcast.emit('launch:state', launchState),
  })

  const jobs = new JobsService((list) => broadcast.emit('jobs:changed', list))

  const dialog = new DialogService({
    getMainWindow: options.getMainWindow,
    isDev: options.isDev,
  })

  const context: AppContext = {
    isDev: options.isDev,
    state,
    installations,
    icons,
    detection,
    launch,
    jobs,
    modules: new MainModuleRegistry(),
    broadcast,
    dialog,
  }

  await registerModules(context)

  if (state.recoveredFrom) {
    // Told once, on the first render, rather than swallowed into the log file.
    log.warn(`state recovered from ${state.recoveredFrom}`)
  }

  return context
}
