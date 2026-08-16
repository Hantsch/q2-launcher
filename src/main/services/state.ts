import { STATE_SCHEMA_VERSION } from '@shared/constants'
import type { ConfigProfile } from '@shared/modules/config'
import { DEFAULT_SETTINGS, type Installation, type LauncherSettings } from '@shared/types'
import { JsonStore } from '../lib/json-store'
import {
  parseConfigPendingWrites,
  parseConfigPlayedMods,
  parseConfigProfiles,
  parseConfigSwitchBinds,
  parseInstallations,
  parseSettings,
} from '../lib/schemas'
import { migrateStateDocument } from './migrations'

/** Everything the launcher persists about itself, except window geometry. */
export interface LauncherStateDocument {
  schemaVersion: number
  settings: LauncherSettings
  installations: Installation[]
  /**
   * Config profiles are central, not owned by an installation, so they live
   * next to the installation list rather than inside `moduleData`. Files
   * written before this key existed simply lack it and load as an empty list -
   * no schema bump, no migration.
   */
  configProfiles: ConfigProfile[]
  /**
   * installationId -> mod folder names the user has marked "played" for it.
   * Central per-installation data the config module owns, next to but not
   * part of `Installation` - same reasoning as `configProfiles` above. Files
   * written before this key existed simply lack it and load as `{}`.
   */
  configPlayedMods: Record<string, string[]>
  /**
   * installationId -> id of the profile whose last write attempt found it
   * running. An installation absent from this map has nothing pending. Same
   * reasoning as `configPlayedMods` above.
   */
  configPendingWrites: Record<string, string>
  /**
   * installationId -> engine key name bound to story 007's in-session
   * profile-switch chain. Central per-installation data the config module
   * owns, next to but not part of `Installation` - same reasoning as
   * `configPlayedMods` above. Files written before this key existed simply
   * lack it and load as `{}`.
   */
  configSwitchBinds: Record<string, string>
}

function defaults(): LauncherStateDocument {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    installations: [],
    configProfiles: [],
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
  }
}

/**
 * Owns `state.json`. Migration runs first, then each section is parsed
 * defensively: a broken settings value falls back to its default and a broken
 * installation row is dropped on its own, so one bad entry never costs the user
 * their whole library.
 */
export class StateStore {
  private readonly store: JsonStore<LauncherStateDocument>

  constructor(filePath: string) {
    this.store = new JsonStore<LauncherStateDocument>({
      filePath,
      defaults,
      parse: (raw) => {
        const { doc } = migrateStateDocument(raw)
        return {
          schemaVersion: STATE_SCHEMA_VERSION,
          settings: parseSettings(doc['settings']),
          installations: parseInstallations(doc['installations']),
          configProfiles: parseConfigProfiles(doc['configProfiles']),
          configPlayedMods: parseConfigPlayedMods(doc['configPlayedMods']),
          configPendingWrites: parseConfigPendingWrites(doc['configPendingWrites']),
          configSwitchBinds: parseConfigSwitchBinds(doc['configSwitchBinds']),
        }
      },
    })
  }

  async load(): Promise<LauncherStateDocument> {
    return this.store.load()
  }

  /** Non-null when the file on disk was damaged and we fell back. */
  get recoveredFrom(): 'backup' | 'defaults' | null {
    return this.store.recoveredFrom
  }

  settings(): LauncherSettings {
    return this.store.get().settings
  }

  installations(): Installation[] {
    return this.store.get().installations
  }

  configProfiles(): ConfigProfile[] {
    return this.store.get().configProfiles
  }

  configPlayedMods(): Record<string, string[]> {
    return this.store.get().configPlayedMods
  }

  configPendingWrites(): Record<string, string> {
    return this.store.get().configPendingWrites
  }

  configSwitchBinds(): Record<string, string> {
    return this.store.get().configSwitchBinds
  }

  patchSettings(patch: Partial<LauncherSettings>): LauncherSettings {
    return this.store.update((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    })).settings
  }

  setInstallations(installations: Installation[]): Installation[] {
    return this.store.update((current) => ({ ...current, installations })).installations
  }

  setConfigProfiles(configProfiles: ConfigProfile[]): ConfigProfile[] {
    return this.store.update((current) => ({ ...current, configProfiles })).configProfiles
  }

  setConfigPlayedMods(configPlayedMods: Record<string, string[]>): Record<string, string[]> {
    return this.store.update((current) => ({ ...current, configPlayedMods })).configPlayedMods
  }

  setConfigPendingWrites(configPendingWrites: Record<string, string>): Record<string, string> {
    return this.store.update((current) => ({ ...current, configPendingWrites }))
      .configPendingWrites
  }

  setConfigSwitchBinds(configSwitchBinds: Record<string, string>): Record<string, string> {
    return this.store.update((current) => ({ ...current, configSwitchBinds })).configSwitchBinds
  }

  /** Waits for pending writes; called on quit. */
  settle(): Promise<void> {
    return this.store.settle()
  }
}
