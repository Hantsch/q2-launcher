import { STATE_SCHEMA_VERSION } from '@shared/constants'
import type { ConfigProfile } from '@shared/modules/config'
import {
  DEFAULT_DOWNLOADS_SETTINGS,
  type DownloadFailure,
  type DownloadsSettings,
} from '@shared/modules/downloads'
import { DEFAULT_SETTINGS, type Installation, type LauncherSettings } from '@shared/types'
import { DEFAULT_HOME_LAYOUT, type HomeLayout } from '@shared/modules/home'
import { JsonStore } from '../lib/json-store'
import { pruneFailures } from '../modules/downloads/failure-log'
import {
  parseConfigFileSourceMigratedAt,
  parseConfigPlayedMods,
  parseConfigProfiles,
  parseConfigSwitchBinds,
  parseConfigWriteFailures,
  parseDownloadFailures,
  parseDownloadsSettings,
  parseHomeLayout,
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
   * installationId -> engine key name bound to story 007's in-session
   * profile-switch chain. Central per-installation data the config module
   * owns, next to but not part of `Installation` - same reasoning as
   * `configPlayedMods` above. Files written before this key existed simply
   * lack it and load as `{}`.
   *
   * Story 079 D4 (review note, not a field of this interface): retired the sibling
   * `configPendingWrites` key (installationId -> id of the profile whose last write attempt found
   * it running) - a running game defers nothing now, so nothing is ever pending. Not migrated away:
   * a `state.json` still carrying the old key from before this story simply has it ignored on parse
   * (nothing in `StateStore`'s `parse` reads it any more).
   */
  configSwitchBinds: Record<string, string>
  /**
   * `<profileId>|<installationId|'own'>` -> the last failed/deferred write attempt for that
   * target (story 022, D5 - persisted only; the sync engine, a later deliverable, is what
   * constructs and interprets the key). Central per-profile data the config module owns, next to
   * but not part of `ConfigProfile` - same reasoning as `configPlayedMods` above. Files written
   * before this key existed simply lack it and load as `{}`.
   */
  configWriteFailures: Record<string, { messageKey: string; at: string }>
  /**
   * ISO timestamp of when story 043's one-time canonical-file format migration completed, or
   * `null` while it has not run (AC8). Files written before this key existed simply lack it and
   * load as `null` - i.e. "not migrated yet" - which is the whole point: the very first start
   * after the update is the one that finds it absent. Same "new top-level key, no schema bump, no
   * migration entry" reasoning as `configPlayedMods` above; see
   * `main/lib/schemas.ts#configFileSourceMigratedAtSchema` for why an unreadable value degrades
   * to `null` rather than to "already done".
   */
  configFileSourceMigratedAt: string | null
  /**
   * Story 071 D1: the `downloads` module's own settings (`concurrentJobs`, [[072]]'s UI section
   * lives over this same shape). A new top-level key, not a `STATE_SCHEMA_VERSION` bump - same
   * "new key, no schema bump" precedent as `configPlayedMods`. Files written before this key
   * existed simply lack it and load as `DEFAULT_DOWNLOADS_SETTINGS`.
   */
  downloads: DownloadsSettings
  /**
   * Story 073 D1: the Downloads tab's global failure log (AC2) - one entry per `downloads` job
   * that reached `failed`, kept until the user dismisses it and then for 7 more days. A new
   * top-level key, same "no `STATE_SCHEMA_VERSION` bump, no migration" precedent as `configProfiles`
   * above: it is purely additive, and a file written before this story simply lacks it and loads as
   * `[]`. Retention (the 7-day prune, the 50-entry cap) is `main/modules/downloads/failure-log.ts`'s
   * job, not this store's - `getDownloadFailures()` below just applies it on read.
   */
  downloadFailures: DownloadFailure[]
  /**
   * Story 086 D1: the dashboard's tile arrangement (`home` module). A new top-level key, same
   * "no `STATE_SCHEMA_VERSION` bump, no migration" precedent as `configProfiles` above: it is
   * purely additive, and a file written before this story simply lacks it and loads as
   * `DEFAULT_HOME_LAYOUT`.
   */
  homeLayout: HomeLayout
}

function defaults(): LauncherStateDocument {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    installations: [],
    configProfiles: [],
    configPlayedMods: {},
    configSwitchBinds: {},
    configWriteFailures: {},
    configFileSourceMigratedAt: null,
    downloads: { ...DEFAULT_DOWNLOADS_SETTINGS },
    downloadFailures: [],
    // Story 086 D1 review fix: a shallow spread of `DEFAULT_HOME_LAYOUT` would leave `tiles`
    // pointing at the same array (and the same tile objects) as the shared, module-level
    // `DEFAULT_HOME_LAYOUT` constant. Nothing mutates a `HomeLayout.tiles` array in place today,
    // but cloning here means nothing ever could corrupt the shipped default for the rest of the
    // process's lifetime.
    homeLayout: { tiles: DEFAULT_HOME_LAYOUT.tiles.map((tile) => ({ ...tile })) },
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
          configSwitchBinds: parseConfigSwitchBinds(doc['configSwitchBinds']),
          configWriteFailures: parseConfigWriteFailures(doc['configWriteFailures']),
          configFileSourceMigratedAt: parseConfigFileSourceMigratedAt(
            doc['configFileSourceMigratedAt'],
          ),
          downloads: parseDownloadsSettings(doc['downloads']),
          downloadFailures: parseDownloadFailures(doc['downloadFailures']),
          homeLayout: parseHomeLayout(doc['homeLayout']),
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

  configSwitchBinds(): Record<string, string> {
    return this.store.get().configSwitchBinds
  }

  configWriteFailures(): Record<string, { messageKey: string; at: string }> {
    return this.store.get().configWriteFailures
  }

  configFileSourceMigratedAt(): string | null {
    return this.store.get().configFileSourceMigratedAt
  }

  getDownloadsSettings(): DownloadsSettings {
    return this.store.get().downloads
  }

  /**
   * Story 073 D1: the failure log, pruned (retention is applied "on read and on write" per the
   * story's Decisions) - a dismissed entry older than 7 days never reaches a caller even if it is
   * still sitting in a `state.json` written before this access ran.
   */
  getDownloadFailures(): DownloadFailure[] {
    return pruneFailures(this.store.get().downloadFailures, Date.now())
  }

  /**
   * Records that story 043's one-time canonical-file migration has completed (AC8).
   *
   * **Write-once, on purpose.** An already-set value is returned unchanged and nothing is
   * persisted, so no caller - including a future one - can reset the guard and make the migration
   * run a second time over files that are, by then, the source of truth and may carry hand-edits
   * the cache never saw. The one legitimate way to re-run it is a `state.json` that genuinely has
   * no value yet (a fresh install, or a hand-cleared key), which is exactly what
   * `parseConfigFileSourceMigratedAt` produces for an absent/garbled key.
   */
  setConfigFileSourceMigratedAt(at: string): string | null {
    const current = this.store.get().configFileSourceMigratedAt
    if (current !== null) return current
    return this.store.update((state) => ({ ...state, configFileSourceMigratedAt: at }))
      .configFileSourceMigratedAt
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

  setConfigSwitchBinds(configSwitchBinds: Record<string, string>): Record<string, string> {
    return this.store.update((current) => ({ ...current, configSwitchBinds })).configSwitchBinds
  }

  setConfigWriteFailures(
    configWriteFailures: Record<string, { messageKey: string; at: string }>,
  ): Record<string, { messageKey: string; at: string }> {
    return this.store.update((current) => ({ ...current, configWriteFailures }))
      .configWriteFailures
  }

  setDownloadsSettings(downloads: DownloadsSettings): DownloadsSettings {
    return this.store.update((current) => ({ ...current, downloads })).downloads
  }

  /**
   * Persists the failure log, pruning again on the way in - the caller (a later deliverable's
   * `append`/`dismiss`/`restore` handlers) already prunes via `failure-log.ts`'s own functions, but
   * pruning here too means nothing can ever write an unpruned list to disk, whichever call site it
   * comes from.
   */
  setDownloadFailures(downloadFailures: DownloadFailure[]): DownloadFailure[] {
    return this.store.update((current) => ({
      ...current,
      downloadFailures: pruneFailures(downloadFailures, Date.now()),
    })).downloadFailures
  }

  /** Story 086 D1: the dashboard's persisted tile arrangement. */
  homeLayout(): HomeLayout {
    return this.store.get().homeLayout
  }

  setHomeLayout(homeLayout: HomeLayout): HomeLayout {
    return this.store.update((current) => ({ ...current, homeLayout })).homeLayout
  }

  /** Waits for pending writes; called on quit. */
  settle(): Promise<void> {
    return this.store.settle()
  }
}
