import type {
  AddExistingInstallationInput,
  AppInfo,
  CreateInstallationInput,
  DetectionProgress,
  DetectionResult,
  Installation,
  Job,
  LaunchInput,
  LaunchPlan,
  LaunchState,
  LauncherSettings,
  ModuleEvent,
  ModuleInvokeRequest,
  ModuleManifest,
  Outcome,
  RemoveInstallationInput,
  ScanOptions,
  ToastMessage,
  UpdateInstallationInput,
  ValidationResult,
} from './types'

/** Chrome state the custom title bar needs to render the right buttons. */
export interface WindowChromeState {
  maximized: boolean
  fullScreen: boolean
  focused: boolean
}

/** A drive root offered to the optional deep scan. */
export interface DriveInfo {
  /** e.g. `C:\` */
  path: string
  /** Volume label if the OS reports one. */
  label?: string
}

/**
 * Native dialogs are opened by main, but all user-visible text belongs to the
 * renderer's i18n bundle - so the renderer passes already-translated strings.
 */
export interface PickPathInput {
  title: string
  buttonLabel?: string
  defaultPath?: string
}

/**
 * Every request/response channel, in one place.
 *
 * This map is the single source of truth: `src/main/ipc` registers handlers
 * against it, the preload bridge derives its allowlist from it, and the renderer
 * gets end-to-end types from it. Adding a channel here and nowhere else produces
 * a compile error in main (unhandled channel), which is the point.
 */
export interface IpcInvokeMap {
  // ---- app ------------------------------------------------------------------
  'app:getInfo': { req: void; res: AppInfo }
  'app:openExternal': { req: string; res: Outcome<null> }
  'app:revealPath': { req: string; res: Outcome<null> }

  // ---- window chrome --------------------------------------------------------
  'window:minimize': { req: void; res: void }
  'window:toggleMaximize': { req: void; res: void }
  'window:close': { req: void; res: void }
  'window:getState': { req: void; res: WindowChromeState }

  // ---- settings -------------------------------------------------------------
  'settings:get': { req: void; res: LauncherSettings }
  'settings:patch': { req: Partial<LauncherSettings>; res: LauncherSettings }

  // ---- installations --------------------------------------------------------
  'installations:list': { req: void; res: Installation[] }
  'installations:addExisting': { req: AddExistingInstallationInput; res: Outcome<Installation> }
  'installations:create': { req: CreateInstallationInput; res: Outcome<Installation> }
  'installations:update': { req: UpdateInstallationInput; res: Outcome<Installation> }
  'installations:remove': { req: RemoveInstallationInput; res: Outcome<null> }
  /** Full ordering, by id, as shown in the rail. */
  'installations:reorder': { req: string[]; res: Installation[] }
  'installations:setActive': { req: string | null; res: LauncherSettings }
  'installations:validate': { req: string; res: Outcome<Installation> }
  /** Validate a folder the user is *considering*, without registering anything. */
  'installations:inspectPath': { req: string; res: Outcome<ValidationResult> }
  'installations:pickFolder': { req: PickPathInput; res: string | null }
  'installations:pickExecutable': { req: PickPathInput; res: string | null }
  'installations:import': { req: string[]; res: Outcome<Installation[]> }

  // ---- detection ------------------------------------------------------------
  'detection:scan': { req: ScanOptions; res: DetectionResult }
  'detection:cancel': { req: string; res: void }
  'detection:listDrives': { req: void; res: DriveInfo[] }

  // ---- launching ------------------------------------------------------------
  'launch:plan': { req: LaunchInput; res: Outcome<LaunchPlan> }
  'launch:start': { req: LaunchInput; res: Outcome<LaunchState> }
  'launch:getState': { req: void; res: LaunchState }

  // ---- jobs (owned by modules; no module produces them yet) ------------------
  'jobs:list': { req: void; res: Job[] }
  'jobs:cancel': { req: string; res: Outcome<null> }

  // ---- modules --------------------------------------------------------------
  'modules:list': { req: void; res: ModuleManifest[] }
  /** Single entry point for all module traffic; see `ModuleInvokeRequest`. */
  'module:invoke': { req: ModuleInvokeRequest; res: Outcome<unknown> }

  // ---- development only (registered only when `is.dev`) ----------------------
  /** Emits a fake download job so the action bar's progress UI can be worked on. */
  'dev:simulateJob': { req: void; res: Outcome<null> }
}

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeRequest<C extends InvokeChannel> = IpcInvokeMap[C]['req']
export type InvokeResponse<C extends InvokeChannel> = IpcInvokeMap[C]['res']

/** Push channels: main -> renderer. */
export interface IpcEventMap {
  'settings:changed': LauncherSettings
  'installations:changed': Installation[]
  'detection:progress': DetectionProgress
  'launch:state': LaunchState
  'jobs:changed': Job[]
  'window:state': WindowChromeState
  'app:toast': ToastMessage
  /** Namespaced module traffic, so modules need no new channels. */
  'module:event': ModuleEvent
}

export type EventChannel = keyof IpcEventMap
export type EventPayload<E extends EventChannel> = IpcEventMap[E]

/**
 * Runtime allowlists. The preload bridge refuses anything not listed, so a
 * compromised renderer cannot reach arbitrary `ipcRenderer` channels.
 */
export const INVOKE_CHANNELS = [
  'app:getInfo',
  'app:openExternal',
  'app:revealPath',
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:getState',
  'settings:get',
  'settings:patch',
  'installations:list',
  'installations:addExisting',
  'installations:create',
  'installations:update',
  'installations:remove',
  'installations:reorder',
  'installations:setActive',
  'installations:validate',
  'installations:inspectPath',
  'installations:pickFolder',
  'installations:pickExecutable',
  'installations:import',
  'detection:scan',
  'detection:cancel',
  'detection:listDrives',
  'launch:plan',
  'launch:start',
  'launch:getState',
  'jobs:list',
  'jobs:cancel',
  'modules:list',
  'module:invoke',
  'dev:simulateJob',
] as const satisfies readonly InvokeChannel[]

export const EVENT_CHANNELS = [
  'settings:changed',
  'installations:changed',
  'detection:progress',
  'launch:state',
  'jobs:changed',
  'window:state',
  'app:toast',
  'module:event',
] as const satisfies readonly EventChannel[]

/**
 * Compile-time guards: if a channel is added to a map but not to the runtime
 * array above, `true` stops being assignable and the build fails here.
 */
type MissingInvoke = Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>
type MissingEvent = Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]>

export const ALL_INVOKE_CHANNELS_LISTED: MissingInvoke extends never ? true : MissingInvoke = true
export const ALL_EVENT_CHANNELS_LISTED: MissingEvent extends never ? true : MissingEvent = true

/** Channels only registered in development builds. */
export const DEV_ONLY_CHANNELS: readonly InvokeChannel[] = ['dev:simulateJob']

/** The shape `preload` puts on `window.q2`. */
export interface LauncherBridge {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeRequest<C> extends void ? [] : [InvokeRequest<C>]
  ): Promise<InvokeResponse<C>>

  /** Subscribes to a push channel; returns an unsubscribe function. */
  on<E extends EventChannel>(channel: E, listener: (payload: EventPayload<E>) => void): () => void
}
