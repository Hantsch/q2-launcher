import fixtureConstants from '../fixture-constants.json'

/** Locale ids the launcher ships. `system` follows the OS language. */
export type LocaleSetting = 'system' | 'en'

export type MotionSetting = 'system' | 'reduced' | 'full'

export interface LauncherSettings {
  locale: LocaleSetting
  motion: MotionSetting
  /** Which installation the shell shows on start. */
  activeInstallationId: string | null
  /** Route the shell restores on start, e.g. `/home`. */
  lastRoute: string
  minimizeOnLaunch: boolean
  closeAfterLaunch: boolean
  confirmBeforeRemoving: boolean
  /** Run the store/common-path scan automatically on first start. */
  scanOnFirstRun: boolean
  /** Drive roots offered for the optional deep scan. Empty = ask at scan time. */
  deepScanDrives: string[]
}

// Data lives in JSON so the plain-Node fixture writer reads the same values. The JSON types widen
// `locale`/`motion` to `string`, hence the narrowing cast.
export const DEFAULT_SETTINGS: LauncherSettings = {
  ...fixtureConstants.defaultSettings,
  locale: fixtureConstants.defaultSettings.locale as LocaleSetting,
  motion: fixtureConstants.defaultSettings.motion as MotionSetting,
  deepScanDrives: fixtureConstants.defaultSettings.deepScanDrives as string[],
}

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
  fullScreen: boolean
}
