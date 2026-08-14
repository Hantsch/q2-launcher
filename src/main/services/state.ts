import { STATE_SCHEMA_VERSION } from '@shared/constants'
import { DEFAULT_SETTINGS, type Installation, type LauncherSettings } from '@shared/types'
import { JsonStore } from '../lib/json-store'
import { parseInstallations, parseSettings } from '../lib/schemas'
import { migrateStateDocument } from './migrations'

/** Everything the launcher persists about itself, except window geometry. */
export interface LauncherStateDocument {
  schemaVersion: number
  settings: LauncherSettings
  installations: Installation[]
}

function defaults(): LauncherStateDocument {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    installations: [],
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

  patchSettings(patch: Partial<LauncherSettings>): LauncherSettings {
    return this.store.update((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    })).settings
  }

  setInstallations(installations: Installation[]): Installation[] {
    return this.store.update((current) => ({ ...current, installations })).installations
  }

  /** Waits for pending writes; called on quit. */
  settle(): Promise<void> {
    return this.store.settle()
  }
}
