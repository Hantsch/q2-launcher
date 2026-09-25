import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { BrowserWindow } from 'electron'
import { app as electronApp } from 'electron'
import { stateFilePath, userDataDir } from './lib/paths'
import { scopedLogger } from './lib/logger'
import { UI_HARNESS_ENV } from './lib/ui-harness'
import { resolveFeatureGate, type FeatureGate } from './features/gate'
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
import { createUpdateBackend, createUpdateChecker } from './services/update/checker'
import { createUpdateService, type UpdateService } from './services/update/service'
import { resolveLauncherInstallId } from './services/unlock/launcher-install-id'
import { harnessUnlockPublicKeyOverride, UNLOCK_PUBLIC_KEY_PEM } from './services/unlock/public-key'
import { createUnlockService, type UnlockService } from './services/unlock/service'
import { InstallationWriteGuard } from './services/write-guard'

const log = scopedLogger('context')

/**
 * Story 128 D4: which public key `UnlockService` verifies codes against.
 *
 * `UNLOCK_PUBLIC_KEY_PEM` (the real, embedded production key) is the answer for every real user.
 * The one override - reading a different PEM from `Q2L_UNLOCK_PUBLIC_KEY_FILE` - exists only so a
 * test-signing key can be used end-to-end without ever touching the production key pair, and it is
 * gated by **exactly** the same condition `src/main/ipc/index.ts` uses to decide whether
 * `registerDevIpc` runs on a packaged build (`app.isDev || process.env[UI_HARNESS_ENV] === '1'`) -
 * reused, not re-derived, so the override can never be reachable in a real packaged, non-harness
 * build without also making every dev-only IPC channel reachable there too.
 */
async function resolveUnlockPublicKeyPem(isDev: boolean): Promise<string> {
  // Story 129: the UI harness's inline test key, behind its own stricter double gate (harness AND
  // dev) - `null` everywhere else, so it never shadows anything outside a harness run.
  const harnessKey = harnessUnlockPublicKeyOverride({ isDev })
  if (harnessKey !== null) return harnessKey

  const overrideAllowed = isDev || process.env[UI_HARNESS_ENV] === '1'
  const overridePath = process.env['Q2L_UNLOCK_PUBLIC_KEY_FILE']
  if (overrideAllowed && overridePath) {
    try {
      return await readFile(overridePath, 'utf8')
    } catch (error) {
      log.warn(`unlock: could not read Q2L_UNLOCK_PUBLIC_KEY_FILE, using the embedded key (${error})`)
    }
  }
  return UNLOCK_PUBLIC_KEY_PEM
}

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
  /** Story 091: every job's write phase into an installation folder goes through this. */
  writeGuard: InstallationWriteGuard
  modules: MainModuleRegistry
  broadcast: Broadcaster
  /** Story 066 D4: the config-file picker modules reach through `ModuleSetup.app`, never `dialog` directly. */
  dialog: DialogService
  /** Story 097: the update-check service - a shell service, not a module (it has no per-installation
   * data and nothing renderer-writable to validate), constructed here like `launch`/`jobs` above. */
  update: UpdateService
  /** Story 128 D4: the unlock-code service - a shell service, same reasoning as `update` above.
   * `init()` is awaited before `registerModules(context)` runs, so every module sees a settled
   * unlock state (the resolved installation id and the redeemed codes' current verdicts) from the
   * moment it is constructed. */
  unlock: UnlockService
  /** Story 130: which gated features exist in this process. Resolved once at boot from 128's
   * re-verified unlock state and then frozen for the process lifetime - a code redeemed
   * mid-session takes effect only at the next start. `modules` was built with this same gate. */
  features: FeatureGate
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

  // Story 094 D2: `InstallationsService` is constructed before `LaunchService`/`writeGuard` exist
  // (that construction needs `installations` already built - see `writeGuard`'s own comment below),
  // so `isRunning` cannot be a plain closure over the guard yet. Same late-binding shape as
  // `writeGuard`/`getWriteGuard` just below: a mutable binding assigned once the guard exists, read
  // through a wrapper closure handed to `InstallationsService` now.
  let installationIsRunning: ((id: string) => boolean) | null = null

  const installations = new InstallationsService({
    state,
    onChange: (list) => broadcast.emit('installations:changed', list),
    onSettingsChange: (settings) => broadcast.emit('settings:changed', settings),
    // Story 067: a removed installation takes its stored icon file with it, or `userData` keeps
    // one orphan PNG per removal forever.
    onRemoved: (id) => deleteStoredIcon(id),
    isRunning: (id) => installationIsRunning?.(id) ?? false,
    userDataDir: userDataDir(),
    homeDir: homedir(),
  })

  const icons = new InstallationIconsService(installations)

  const detection = new DetectionService({
    emitProgress: (progress) => broadcast.emit('detection:progress', progress),
    isRegistered: (key) => installations.isRegistered(key),
  })

  // Story 091 D2: the guard is built *from* `launch` and asked *by* it, so the two
  // cannot both be constructor arguments. `launch` gets a getter over this
  // binding - the same late-binding shape `getMainWindow` uses above - which is
  // resolved long before any launch can happen.
  let writeGuard: InstallationWriteGuard | null = null

  const launch = new LaunchService({
    installations,
    onStateChange: (launchState) => broadcast.emit('launch:state', launchState),
    getWriteGuard: () => writeGuard,
  })

  const jobs = new JobsService((list) => broadcast.emit('jobs:changed', list))

  writeGuard = new InstallationWriteGuard({ launch, jobs })
  // Resolved now that the guard exists, reusing its own already-tested `isBlockedFor` predicate
  // (091) rather than duplicating its `phase === 'starting' || phase === 'running'` check here.
  installationIsRunning = (id) => writeGuard!.isBlockedFor(id)

  const dialog = new DialogService({
    getMainWindow: options.getMainWindow,
    isDev: options.isDev,
  })

  const update = createUpdateService({
    isPackaged: electronApp.isPackaged,
    currentVersion: electronApp.getVersion(),
    check: createUpdateChecker({ log: scopedLogger('update') }),
    backend: createUpdateBackend({ log: scopedLogger('update') }),
    // Story 098 AC6: the restart guard reads the two things main already tracks and cancels
    // neither. Both are passed as getters over the live services rather than snapshots, or the
    // guard would answer a question from whenever the context was built.
    isGameRunning: () => launch.isRunning(),
    listJobs: () => jobs.list(),
    onStateChange: (updateState) => broadcast.emit('update:state', updateState),
    log: scopedLogger('update'),
  })

  const unlock = createUnlockService({
    state,
    publicKey: await resolveUnlockPublicKeyPem(options.isDev),
    resolveLauncherInstallId,
    log: scopedLogger('unlock'),
  })

  // Story 128 D4: resolved and re-verified before any module is constructed, so every module sees a
  // settled unlock state (the resolved installation id and each stored code's current verdict) from
  // the moment it exists - the same "state ready before registerModules" ordering `state.load()`
  // above already establishes.
  await unlock.init()

  // Story 130: the feature gate is taken from the unlock state `init()` just re-verified - never
  // from stored tokens directly - and has to exist before the registry, which it is handed to.
  const features = resolveFeatureGate(unlock)

  const context: AppContext = {
    isDev: options.isDev,
    state,
    installations,
    icons,
    detection,
    launch,
    jobs,
    writeGuard,
    modules: new MainModuleRegistry(features),
    broadcast,
    dialog,
    update,
    unlock,
    features,
  }

  await registerModules(context)

  if (state.recoveredFrom) {
    // Told once, on the first render, rather than swallowed into the log file.
    log.warn(`state recovered from ${state.recoveredFrom}`)
  }

  return context
}
