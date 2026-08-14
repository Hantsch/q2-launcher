import { create } from 'zustand'
import type { WindowChromeState } from '@shared/ipc'
import type {
  AddExistingInstallationInput,
  AppInfo,
  CreateInstallationInput,
  Installation,
  Job,
  LaunchState,
  LauncherSettings,
  ModuleManifest,
  Outcome,
  ToastMessage,
  UpdateInstallationInput,
} from '@shared/types'
import { DEFAULT_SETTINGS, IDLE_LAUNCH_STATE, isJobActive } from '@shared/types'
import { changeLocale } from '../i18n'
import { invoke, onEvent } from '../lib/bridge'
import { newId } from '../lib/id'

export const ROUTE_HOME = '/home'
export const ROUTE_SETTINGS = '/settings'

/** Which modal the shell is showing. One at a time, by design. */
export type DialogState =
  | { kind: 'none' }
  | { kind: 'add-existing' }
  | { kind: 'detect'; autoStart?: boolean }
  | { kind: 'create' }
  | { kind: 'remove'; installationId: string }
  | { kind: 'rename'; installationId: string }

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

  // --- renderer-only UI state ---------------------------------------------
  route: string
  dialog: DialogState
  toasts: ToastMessage[]

  // --- lifecycle -----------------------------------------------------------
  bootstrap: () => Promise<void>

  // --- navigation / UI -----------------------------------------------------
  setRoute: (route: string) => void
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
  removeInstallation: (id: string) => Promise<void>
  validateInstallation: (id: string) => Promise<void>
  validateAll: () => Promise<void>
  reorderInstallations: (orderedIds: string[]) => Promise<void>
  importDetected: (rootPaths: string[]) => Promise<void>

  // --- playing -------------------------------------------------------------
  play: (installationId?: string) => Promise<void>
  cancelJob: (jobId: string) => Promise<void>
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

  route: ROUTE_HOME,
  dialog: { kind: 'none' },
  toasts: [],

  bootstrap: async () => {
    const [appInfo, settings, installations, modules, jobs, launch, chrome] = await Promise.all([
      invoke('app:getInfo'),
      invoke('settings:get'),
      invoke('installations:list'),
      invoke('modules:list'),
      invoke('jobs:list'),
      invoke('launch:getState'),
      invoke('window:getState'),
    ])

    set({
      appInfo,
      settings,
      installations,
      modules,
      jobs,
      launch,
      chrome,
      route: settings.lastRoute || ROUTE_HOME,
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

  setRoute: (route) => {
    set({ route })
    // Remembered across restarts, so the launcher reopens where you left it.
    void invoke('settings:patch', { lastRoute: route })
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

  removeInstallation: async (id) => {
    const installation = get().installations.find((entry) => entry.id === id)
    const result = await invoke('installations:remove', { id })
    if (result.ok) {
      get().pushToast({
        level: 'info',
        messageKey: 'installations.toast.removed',
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

  play: async (installationId) => {
    const id = installationId ?? get().settings.activeInstallationId
    if (!id) return
    const result = await invoke('launch:start', { installationId: id })
    if (!result.ok) toastError(get, result)
  },

  cancelJob: async (jobId) => {
    const result = await invoke('jobs:cancel', jobId)
    if (!result.ok) toastError(get, result)
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
