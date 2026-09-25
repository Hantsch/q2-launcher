import { create } from 'zustand'
import type { WindowChromeState } from '@shared/ipc'
import type { LaunchUserinfo } from '@shared/launch/userinfo'
import type {
  AddExistingInstallationInput,
  AppInfo,
  CreateInstallationInput,
  Installation,
  InstallationIcon,
  Job,
  LaunchState,
  LauncherSettings,
  ModuleId,
  ModuleManifest,
  Outcome,
  ToastMessage,
  UpdateInstallationInput,
  UpdateState,
} from '@shared/types'
import {
  countActiveJobs,
  DEFAULT_SETTINGS,
  IDLE_LAUNCH_STATE,
  isJobActive,
  MODULE_MANIFESTS,
} from '@shared/types'
import { changeLocale } from '../i18n'
import { invoke, onEvent } from '../lib/bridge'
import { newId } from '../lib/id'

export const ROUTE_HOME = '/home'
export const ROUTE_SETTINGS = '/settings'

/** Shell routes plus every module's own route - the full set a persisted `lastRoute` may name. */
function isKnownRoute(route: string | undefined): route is string {
  if (!route) return false
  if (route === ROUTE_HOME || route === ROUTE_SETTINGS) return true
  return MODULE_MANIFESTS.some((manifest) => manifest.route === route)
}

/**
 * `iconDataUrls` without `installationId`'s entry, if it had one - a plain no-op copy otherwise
 * (`state` unchanged) so a `set()` call built from this never triggers a re-render for nothing.
 *
 * Story 067 review finding F1: `fetchIconDataUrl` caches by installation id and never expired that
 * entry on its own. A custom icon's `{ kind: 'custom' }` shape does not change when the user
 * re-picks a different image or clears-then-repicks, so without this, every mounted tile kept
 * showing the *previous* `data:` URL from cache until the app was restarted - `setInstallationIcon`
 * and `pickInstallationIconFile` both call this on a successful `Outcome` so the next render's
 * `useInstallationIcon` sees a missing cache entry and fetches the fresh bytes.
 */
function withoutIconDataUrl(
  iconDataUrls: Record<string, string | null>,
  installationId: string,
): Record<string, string | null> {
  if (!(installationId in iconDataUrls)) return iconDataUrls
  const next = { ...iconDataUrls }
  delete next[installationId]
  return next
}

/**
 * Nothing known, nothing attempted - the same shape `createUpdateService`'s `idleState(false)`
 * reports before `bootstrap`'s `update:getState` call resolves (story 097 D3). `supported: false`
 * is the honest default for an instant that has not yet heard from main, matching an unpackaged
 * build's permanent state.
 */
const IDLE_UPDATE_STATE: UpdateState = {
  status: 'idle',
  phase: 'idle',
  update: null,
  error: null,
  progress: null,
  dismissed: false,
  lastCheckedAt: null,
  lastSuccessAt: null,
  supported: false,
}

/** Which modal the shell is showing. One at a time, by design. */
export type DialogState =
  | { kind: 'none' }
  | { kind: 'add-existing' }
  | { kind: 'detect'; autoStart?: boolean }
  | { kind: 'create' }
  | { kind: 'remove'; installationId: string }
  | { kind: 'rename'; installationId: string }
  /** Story 058 D6: the redundant-config-copies cleanup, scoped to one installation - the row it
   * was opened from *is* the scope, so the panel no longer picks an installation of its own. */
  | { kind: 'cleanup'; installationId: string }
  /** Story 067 D6: the icon picker, scoped to one installation the same way `rename`/`cleanup` are. */
  | { kind: 'installationIcon'; installationId: string }
  /**
   * Story 074 D5: the generic escape hatch that lets a module own a modal without the shell
   * importing anything module-specific. `view` is a free string the owning module defines for
   * itself (e.g. `'bootstrap-wizard'`) - the shell never interprets it, only ferries it through to
   * that module's own `Dialogs` component (see `RendererModule.Dialogs` in `modules/index.ts`).
   *
   * Story 090 D3: `installationId` is an optional companion field, same "the shell never
   * interprets it" rule as `view` - it exists only because the retail-upgrade dialog
   * (`'retail-upgrade'` view) is scoped to one installation the same way the shell's own
   * `remove`/`rename`/`cleanup`/`installationIcon` kinds already are, and a module dialog has no
   * other channel to receive that id through. Absent for a module dialog that needs no scope
   * (e.g. `'bootstrap-wizard'`).
   */
  | { kind: 'module'; moduleId: ModuleId; view: string; installationId?: string }

interface LauncherStore {
  // --- mirrored main-process state ----------------------------------------
  ready: boolean
  appInfo: AppInfo | null
  settings: LauncherSettings
  installations: Installation[]
  modules: ModuleManifest[]
  jobs: Job[]
  launch: LaunchState
  chrome: WindowChromeState
  /** Story 097 D6: mirrors the update-check service's state, pushed by main - the renderer never
   * decides whether/when to check, only reflects what `update:getState`/`update:state` report. */
  update: UpdateState

  // --- renderer-only UI state ---------------------------------------------
  route: string
  /**
   * Story 087 D5: a one-shot "open this thing" hint handed along with a route switch, for a
   * destination view to pick up on mount (the dashboard's config-profiles tile opening one
   * profile's editor). Deliberately opaque at the shell level - the shell must not learn what a
   * config profile id is, so `focus` is `unknown` and only the view that reads it interprets it.
   *
   * Stored together with the `route` it was set for, so a focus meant for `/config` can never be
   * handed to whichever view happens to mount next, and renderer-only: unlike `route` (mirrored
   * into `settings.lastRoute`), this is never persisted - a restart replaying a stale
   * "open this profile" would be wrong.
   */
  routeFocus: { route: string; focus: unknown } | null
  dialog: DialogState
  toasts: ToastMessage[]
  /**
   * Custom-icon data URLs (story 067 D5), keyed by installation id. A key is
   * present (even as `null`, meaning "no file found" or "fetch in flight")
   * the moment a fetch has been started, so `useInstallationIcon` never
   * issues a second `installations:iconDataUrl` call for the same
   * installation - `rail`/`card`/`actionBar` all mounting the same
   * installation at once must still add up to exactly one request.
   */
  iconDataUrls: Record<string, string | null>

  // --- lifecycle -----------------------------------------------------------
  bootstrap: () => Promise<void>

  // --- navigation / UI -----------------------------------------------------
  /**
   * `focus` is optional and every existing caller passes none - which also *clears* any focus a
   * previous navigation left behind, so a hint can never outlive the one navigation it was for.
   */
  setRoute: (route: string, focus?: unknown) => void
  /**
   * Reads the pending `routeFocus` and clears it in the same call, so a second read (a remount of
   * the destination view, a second consumer) gets nothing. Returns `undefined` unless the pending
   * focus belongs to the *current* route.
   */
  consumeRouteFocus: () => unknown
  openDialog: (dialog: DialogState) => void
  closeDialog: () => void
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void
  dismissToast: (id: string) => void

  // --- settings ------------------------------------------------------------
  patchSettings: (patch: Partial<LauncherSettings>) => Promise<void>

  // --- installations -------------------------------------------------------
  setActiveInstallation: (id: string | null) => Promise<void>
  addExisting: (input: AddExistingInstallationInput) => Promise<Outcome<Installation>>
  createInstallation: (input: CreateInstallationInput) => Promise<Outcome<Installation>>
  updateInstallation: (input: UpdateInstallationInput) => Promise<Outcome<Installation>>
  /**
   * Story 067 D6: sets a shipped icon, or clears the current one with `icon: null`. Deliberately
   * does not toast on failure the way `updateInstallation` does - the picker dialog shows the
   * failed `Outcome`'s key inline itself (AC6), so a second, top-level toast would be redundant.
   */
  setInstallationIcon: (
    installationId: string,
    icon: InstallationIcon | null,
  ) => Promise<Outcome<Installation>>
  /** Story 067 D6: opens the native file-picker dialog in main, validates/stores the chosen image. */
  pickInstallationIconFile: (installationId: string) => Promise<Outcome<Installation>>
  /**
   * Story 094 D3: `deleteFromDisk` is passed through unset unless explicitly true, matching
   * `RemoveInstallationInput`'s optional field - the entry-only path (the default, and the only
   * option for a store-managed installation) stays byte-for-byte the pre-094 request.
   */
  removeInstallation: (id: string, deleteFromDisk?: boolean) => Promise<void>
  validateInstallation: (id: string) => Promise<void>
  validateAll: () => Promise<void>
  reorderInstallations: (orderedIds: string[]) => Promise<void>
  importDetected: (rootPaths: string[]) => Promise<void>
  /** Fetches a custom icon's data URL once and caches it. No-op if already fetched/in flight. */
  fetchIconDataUrl: (installationId: string) => Promise<void>

  // --- playing -------------------------------------------------------------
  /** `options` (story 125 D4): `connect`/`userinfo` for the join flow's `+connect`/password path -
   * both spread straight into the `launch:start` payload, alongside every existing call site that
   * omits `options` entirely and keeps launching the installation's own default. */
  play: (
    installationId?: string,
    options?: { connect?: string; userinfo?: LaunchUserinfo },
  ) => Promise<void>
  cancelJob: (jobId: string) => Promise<void>

  // --- app update (story 098) ----------------------------------------------
  /**
   * Story 099 D5: runs a check now (097's `update:check` channel). Mirrors `bootstrap`'s
   * `update:getState` handling exactly - the response is a bare `UpdateState`, not an `Outcome`, so
   * there is nothing to toast on failure here; a failed check lands as `status: 'error'` (with
   * `error` set) inside the returned state itself.
   */
  checkForUpdates: () => Promise<void>
  /** Starts the staged download (AC3). Refuses with `appUpdate.error.notAvailable` when nothing
   * is known to download - toasted like any other refusal, since there is no dedicated inline
   * surface for it (unlike `installAndRestart`'s guard, which the popover shows itself). */
  startDownload: () => Promise<Outcome<UpdateState>>
  /** Asks main to stop an in-flight download (Decisions: "cancel during download is offered"). */
  cancelDownload: () => Promise<Outcome<UpdateState>>
  /**
   * The second, deliberate confirmation (AC4). Deliberately does not toast on failure - mirrors
   * `setInstallationIcon`: the popover shows the refused `Outcome`'s key inline itself (AC6), so a
   * second, top-level toast would be redundant.
   */
  installAndRestart: () => Promise<Outcome<null>>
  /** AC5: drops the attention marker for this session; the control itself stays reachable. */
  dismissUpdate: () => Promise<Outcome<UpdateState>>
}

let subscribed = false

export const useLauncher = create<LauncherStore>()((set, get) => ({
  ready: false,
  appInfo: null,
  settings: { ...DEFAULT_SETTINGS },
  installations: [],
  modules: [],
  jobs: [],
  launch: IDLE_LAUNCH_STATE,
  chrome: { maximized: false, fullScreen: false, focused: true },
  update: IDLE_UPDATE_STATE,

  route: ROUTE_HOME,
  routeFocus: null,
  dialog: { kind: 'none' },
  toasts: [],
  iconDataUrls: {},

  bootstrap: async () => {
    const [appInfo, settings, installations, modules, jobs, launch, chrome, update] =
      await Promise.all([
        invoke('app:getInfo'),
        invoke('settings:get'),
        invoke('installations:list'),
        invoke('modules:list'),
        invoke('jobs:list'),
        invoke('launch:getState'),
        invoke('window:getState'),
        invoke('update:getState'),
      ])

    set({
      appInfo,
      settings,
      installations,
      modules,
      jobs,
      launch,
      chrome,
      update,
      // A route only survives a restart if it still resolves to something -
      // either a shell route or a module's own route. Otherwise an upgrading
      // user whose settings remember a since-renamed/removed module route
      // (e.g. the old '/install') would land on a dead page.
      route: isKnownRoute(settings.lastRoute) ? settings.lastRoute : ROUTE_HOME,
      ready: true,
    })

    // Main is the owner of this state; we only ever mirror what it pushes.
    if (!subscribed) {
      subscribed = true
      onEvent('installations:changed', (list) => set({ installations: list }))
      onEvent('settings:changed', (next) => {
        set({ settings: next })
        void changeLocale(next.locale)
      })
      onEvent('jobs:changed', (list) => set({ jobs: list }))
      onEvent('launch:state', (next) => set({ launch: next }))
      onEvent('window:state', (next) => set({ chrome: next }))
      onEvent('update:state', (next) => set({ update: next }))
      onEvent('app:toast', (toast) => {
        set((state) => ({ toasts: [...state.toasts, toast] }))
      })
    }

    // First run with an empty library: offer the search straight away instead of
    // leaving the user to find it.
    if (installations.length === 0 && settings.scanOnFirstRun) {
      set({ dialog: { kind: 'detect', autoStart: true } })
      void invoke('settings:patch', { scanOnFirstRun: false })
    }
  },

  setRoute: (route, focus) => {
    // `routeFocus` is always written, not only when a `focus` is given: a navigation without one
    // has to drop a previous, never-consumed hint rather than let it fire on some later mount.
    set({ route, routeFocus: focus === undefined ? null : { route, focus } })
    // Remembered across restarts, so the launcher reopens where you left it. Only the route -
    // `routeFocus` stays in memory on purpose (see its own doc comment).
    void invoke('settings:patch', { lastRoute: route })
  },

  consumeRouteFocus: () => {
    const { route, routeFocus } = get()
    if (!routeFocus || routeFocus.route !== route) return undefined
    set({ routeFocus: null })
    return routeFocus.focus
  },

  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: { kind: 'none' } }),

  pushToast: (toast) => {
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id: newId() }],
    }))
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },

  patchSettings: async (patch) => {
    const next = await invoke('settings:patch', patch)
    set({ settings: next })
    if (patch.locale) await changeLocale(next.locale)
  },

  setActiveInstallation: async (id) => {
    const next = await invoke('installations:setActive', id)
    set({ settings: next })
  },

  addExisting: async (input) => {
    const result = await invoke('installations:addExisting', input)
    if (result.ok) {
      get().pushToast({
        level: 'success',
        messageKey: 'installations.toast.added',
        params: { name: result.value.name },
        timeoutMs: 4000,
      })
      await get().setActiveInstallation(result.value.id)
    } else {
      toastError(get, result)
    }
    return result
  },

  createInstallation: async (input) => {
    const result = await invoke('installations:create', input)
    if (result.ok) {
      get().pushToast({
        level: 'success',
        messageKey: 'installations.toast.added',
        params: { name: result.value.name },
        timeoutMs: 4000,
      })
      await get().setActiveInstallation(result.value.id)
    } else {
      toastError(get, result)
    }
    return result
  },

  updateInstallation: async (input) => {
    const result = await invoke('installations:update', input)
    if (!result.ok) toastError(get, result)
    return result
  },

  setInstallationIcon: async (installationId, icon) => {
    const result = await invoke('installations:setIcon', { installationId, icon })
    if (result.ok) {
      set((state) => ({ iconDataUrls: withoutIconDataUrl(state.iconDataUrls, installationId) }))
    }
    return result
  },

  pickInstallationIconFile: async (installationId) => {
    const result = await invoke('installations:pickIconFile', { installationId })
    if (result.ok) {
      set((state) => ({ iconDataUrls: withoutIconDataUrl(state.iconDataUrls, installationId) }))
    }
    return result
  },

  removeInstallation: async (id, deleteFromDisk) => {
    const installation = get().installations.find((entry) => entry.id === id)
    const result = await invoke('installations:remove', {
      id,
      ...(deleteFromDisk ? { deleteFromDisk } : {}),
    })
    if (result.ok) {
      get().pushToast({
        level: 'info',
        messageKey: deleteFromDisk
          ? 'installations.toast.removedFromDisk'
          : 'installations.toast.removed',
        params: { name: installation?.name ?? '' },
        timeoutMs: 6000,
      })
    } else {
      toastError(get, result)
    }
  },

  validateInstallation: async (id) => {
    const result = await invoke('installations:validate', id)
    if (!result.ok) toastError(get, result)
  },

  validateAll: async () => {
    for (const installation of get().installations) {
      await invoke('installations:validate', installation.id)
    }
  },

  reorderInstallations: async (orderedIds) => {
    const installations = await invoke('installations:reorder', orderedIds)
    set({ installations })
  },

  importDetected: async (rootPaths) => {
    const result = await invoke('installations:import', rootPaths)
    if (result.ok) {
      get().pushToast({
        level: 'success',
        messageKey: 'installations.toast.imported',
        params: { count: result.value.length },
        timeoutMs: 4000,
      })
    } else {
      toastError(get, result)
    }
  },

  fetchIconDataUrl: async (installationId) => {
    // Reserved synchronously (before the `await`) so the rail/card/action-bar
    // tiles for the same installation, all mounting in the same tick, only
    // ever cause one real request (AC9-adjacent: "once per installation").
    if (installationId in get().iconDataUrls) return
    set((state) => ({ iconDataUrls: { ...state.iconDataUrls, [installationId]: null } }))
    const url = await invoke('installations:iconDataUrl', installationId)
    set((state) => ({ iconDataUrls: { ...state.iconDataUrls, [installationId]: url } }))
  },

  play: async (installationId, options) => {
    const id = installationId ?? get().settings.activeInstallationId
    if (!id) return
    const result = await invoke('launch:start', { installationId: id, ...options })
    if (!result.ok) toastError(get, result)
  },

  cancelJob: async (jobId) => {
    const result = await invoke('jobs:cancel', jobId)
    if (!result.ok) toastError(get, result)
  },

  checkForUpdates: async () => {
    const result = await invoke('update:check')
    set({ update: result })
  },

  startDownload: async () => {
    const result = await invoke('update:download')
    if (result.ok) set({ update: result.value })
    else toastError(get, result)
    return result
  },

  cancelDownload: async () => {
    const result = await invoke('update:cancelDownload')
    if (result.ok) set({ update: result.value })
    else toastError(get, result)
    return result
  },

  installAndRestart: async () => {
    // No `set()`/toast on success: a successful call quits the launcher, so there is no state left
    // here to update. A refusal is reported back to the caller (`UpdatePopover` shows it inline).
    return invoke('update:installAndRestart')
  },

  dismissUpdate: async () => {
    const result = await invoke('update:dismiss')
    if (result.ok) set({ update: result.value })
    return result
  },
}))

function toastError(
  get: () => LauncherStore,
  outcome: Extract<Outcome<unknown>, { ok: false }>,
): void {
  get().pushToast({
    level: 'error',
    messageKey: outcome.error.key,
    timeoutMs: 0,
    ...(outcome.error.params ? { params: outcome.error.params } : {}),
  })
}

// ---------------------------------------------------------------------------
// Selectors. Kept as plain functions so components subscribe to the narrowest
// slice they need and do not re-render on unrelated state changes.
// ---------------------------------------------------------------------------

export function useActiveInstallation(): Installation | null {
  return useLauncher((state) => {
    const id = state.settings.activeInstallationId
    if (!id) return null
    return state.installations.find((installation) => installation.id === id) ?? null
  })
}

export function useInstallationById(id: string | null): Installation | null {
  return useLauncher((state) =>
    id ? (state.installations.find((installation) => installation.id === id) ?? null) : null,
  )
}

/**
 * Whether the OS window currently has focus - mirrors `chrome.focused`, pushed by main through the
 * existing `window:state` event (subscribed once in `bootstrap` above). Story 043 D7: the signal
 * the config module's file re-read hook (`useFileSourceRefresh`) watches for a false -> true
 * transition, instead of a DOM `focus` listener (which the story explicitly rules out).
 */
export function useWindowFocused(): boolean {
  return useLauncher((state) => state.chrome.focused)
}

/** The job the action bar shows: the first still-active one. */
export function useActiveJob(installationId?: string | null): Job | null {
  return useLauncher((state) => {
    const active = state.jobs.filter(isJobActive)
    if (!installationId) return active[0] ?? null
    return (
      active.find((job) => job.installationId === installationId) ??
      active.find((job) => !job.installationId) ??
      null
    )
  })
}

/** Number of active (queued/running/paused) jobs owned by the given module - story 032 D3. */
export function useActiveJobCount(moduleId: ModuleId): number {
  return useLauncher((state) => countActiveJobs(state.jobs, moduleId))
}
