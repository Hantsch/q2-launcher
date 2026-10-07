import { STATE_SCHEMA_VERSION } from '@shared/constants'
import { DEFAULT_SETTINGS, type Installation, type LauncherSettings } from '@shared/types'
import { JsonStore } from '../lib/json-store'
import { parseInstallations, parseSettings } from '../lib/schemas'
import { migrateStateDocument, type MigrationStep } from './migrations'

/** Slices with no write invariant of their own; the others keep a dedicated setter. */
export type MutableSliceKey = 'installations'

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
 * Keys the store parses itself at `load()` and exposes through its own accessors. Exactly one
 * owner per key: none of these can be registered as a section, and none is kept raw.
 */
const STORE_OWNED_KEYS: ReadonlySet<string> = new Set(Object.keys(defaults()))

/**
 * The cached document: the store-owned keys typed, every other top-level key exactly as it was
 * read - raw until a section parses it, its parsed value from then on. Stays flat, so it is
 * written to disk as it is.
 */
type StoredDocument = LauncherStateDocument & Record<string, unknown>

function unownedKeys(doc: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(doc).filter(([key]) => !STORE_OWNED_KEYS.has(key)))
}

/** How a module's top-level `state.json` key is read. */
export interface StateSectionSpec<T> {
  key: string
  /** Turns the raw JSON under `key` into a valid `T`. Must never throw. */
  parse: (raw: unknown) => T
  /** The value when the key is absent from the file. */
  defaults: () => T
}

export interface StateSection<T> {
  get(): T
  /**
   * Changes the value through a synchronous callback that receives the live value. Returning the
   * same reference means "no change": nothing is scheduled for writing.
   */
  update(fn: (live: T) => T): T
}

/**
 * Owns `state.json`. Migration runs first, then each section is parsed
 * defensively: a broken settings value falls back to its default and a broken
 * installation row is dropped on its own, so one bad entry never costs the user
 * their whole library.
 */
export class StateStore {
  private readonly store: JsonStore<StoredDocument>
  private readonly sections = new Map<
    string,
    { spec: StateSectionSpec<unknown>; handle: StateSection<unknown> }
  >()
  /**
   * Section keys whose value in the cached document is already the parsed one. Parsing waits for
   * the first access, so a section can register before or after `load()`; every load starts over
   * from the raw values it read.
   */
  private readonly parsedSections = new Set<string>()

  constructor(
    filePath: string,
    options: {
      onPersistError?: () => void
      /**
       * The modules' migration steps, validated against `STATE_SCHEMA_VERSION` on every load.
       * `'none'` is for tests that never read an older file: the document is then taken as
       * current and no step runs. Production code always states real steps.
       */
      migrations: readonly MigrationStep[] | 'none'
    },
  ) {
    // One notice per session: a disk that fails once usually keeps failing, and the user needs
    // to hear it once, not on every debounced retry.
    let reported = false
    this.store = new JsonStore<StoredDocument>({
      filePath,
      debounceMs: 250,
      onPersistError: () => {
        if (reported) return
        reported = true
        options.onPersistError?.()
      },
      defaults: () => ({ ...defaults() }),
      parse: (raw) => {
        const doc =
          options.migrations !== 'none'
            ? migrateStateDocument(raw, options.migrations).doc
            : typeof raw === 'object' && raw !== null
              ? (raw as Record<string, unknown>)
              : {}
        const owned: LauncherStateDocument = {
          schemaVersion: STATE_SCHEMA_VERSION,
          settings: parseSettings(doc['settings']),
          installations: parseInstallations(doc['installations']),
        }
        // Keys this build does not own (a disabled module's, a newer launcher's) are carried
        // verbatim, so every save - the backup-recovery rewrite included - writes them back.
        return { ...owned, ...unownedKeys(doc) }
      },
    })
  }

  async load(): Promise<LauncherStateDocument> {
    const doc = await this.store.load()
    this.parsedSections.clear()
    return doc
  }

  /**
   * Registers a module's own top-level key. Its raw value is parsed on first access (absent ->
   * `spec.defaults()`), and from then on the parsed value is what every save writes under the same
   * key. Registering the same spec object again returns the same handle.
   */
  section<T>(spec: StateSectionSpec<T>): StateSection<T> {
    if (STORE_OWNED_KEYS.has(spec.key)) {
      throw new Error(`state key "${spec.key}" is owned by the state store`)
    }
    const existing = this.sections.get(spec.key)
    if (existing) {
      if (existing.spec !== spec) {
        throw new Error(`state section "${spec.key}" is already registered with another spec`)
      }
      return existing.handle as StateSection<T>
    }
    const handle: StateSection<T> = {
      get: () => {
        this.parseSection(spec)
        return this.store.get()[spec.key] as T
      },
      update: (fn) => {
        this.parseSection(spec)
        return this.updateKey(spec.key, fn)
      },
    }
    this.sections.set(spec.key, { spec, handle })
    return handle
  }

  /** Swaps the raw value for the parsed one without a write: the data on disk is unchanged. */
  private parseSection<T>(spec: StateSectionSpec<T>): void {
    if (this.parsedSections.has(spec.key)) return
    const doc = this.store.get()
    const value = Object.hasOwn(doc, spec.key) ? spec.parse(doc[spec.key]) : spec.defaults()
    this.store.adopt({ ...doc, [spec.key]: value })
    this.parsedSections.add(spec.key)
  }

  private updateKey<V>(key: string, fn: (live: V) => V): V {
    const live = this.store.get()[key] as V
    const next = fn(live)
    if (next === live) return live
    this.store.update((doc) => ({ ...doc, [key]: next }))
    return next
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

  /**
   * Changes one slice through a synchronous callback that receives the live stored value. Returning
   * the same reference means "no change": nothing is scheduled for writing.
   */
  updateSlice<K extends MutableSliceKey>(
    key: K,
    fn: (live: LauncherStateDocument[K]) => LauncherStateDocument[K],
  ): LauncherStateDocument[K] {
    return this.updateKey(key, fn)
  }

  setInstallations(installations: Installation[]): Installation[] {
    return this.store.update((current) => ({ ...current, installations })).installations
  }

  /** Waits for pending writes; called on quit. */
  settle(): Promise<{ ok: boolean }> {
    return this.store.settle()
  }
}
