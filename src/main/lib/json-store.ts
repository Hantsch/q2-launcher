import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { scopedLogger } from './logger'

const log = scopedLogger('json-store')

export interface JsonStoreOptions<T> {
  filePath: string
  /** Used when the file is absent, empty or unrecoverable. */
  defaults: () => T
  /**
   * Turns unknown JSON into a valid `T`. Must never throw: it is the last line
   * of defence against a hand-edited or truncated file.
   */
  parse: (raw: unknown) => T
  /** Coalesce bursts of writes (window resizing) into one disk write. */
  debounceMs?: number
}

/**
 * A small atomic JSON store.
 *
 * Writes go to `<file>.tmp` and are then renamed over the target, so a crash
 * mid-write can never leave a half-written file. The previous good version is
 * kept as `<file>.bak`; an unparseable file is set aside as `<file>.corrupt-<n>`
 * so the user does not silently lose their installation list.
 */
export class JsonStore<T> {
  private readonly options: JsonStoreOptions<T>
  private cache: T | null = null
  private writeTimer: NodeJS.Timeout | null = null
  private pending: Promise<void> = Promise.resolve()
  /** Set when the loaded file was damaged, so the UI can tell the user. */
  public recoveredFrom: 'backup' | 'defaults' | null = null

  constructor(options: JsonStoreOptions<T>) {
    this.options = options
  }

  private get tmpPath(): string {
    return `${this.options.filePath}.tmp`
  }

  private get bakPath(): string {
    return `${this.options.filePath}.bak`
  }

  async load(): Promise<T> {
    const primary = await this.tryRead(this.options.filePath)
    if (primary.status === 'ok') {
      this.cache = this.options.parse(primary.value)
      return this.cache
    }

    if (primary.status === 'damaged') {
      const quarantine = `${this.options.filePath}.corrupt-${Date.now()}`
      await rename(this.options.filePath, quarantine).catch(() => undefined)
      log.error(`unparseable state file, moved to ${quarantine}`)

      const backup = await this.tryRead(this.bakPath)
      if (backup.status === 'ok') {
        this.cache = this.options.parse(backup.value)
        this.recoveredFrom = 'backup'
        log.warn('recovered state from backup')
        await this.flush(this.cache)
        return this.cache
      }
      this.recoveredFrom = 'defaults'
    }

    this.cache = this.options.defaults()
    return this.cache
  }

  /** Current value; `load()` must have run first. */
  get(): T {
    if (this.cache === null) {
      throw new Error(`JsonStore(${this.options.filePath}) read before load()`)
    }
    return this.cache
  }

  /** Replaces the value and schedules a write. */
  set(next: T): T {
    this.cache = next
    this.schedule(next)
    return next
  }

  /** Applies a change to the current value and schedules a write. */
  update(mutate: (current: T) => T): T {
    return this.set(mutate(this.get()))
  }

  /** Resolves once every scheduled write has hit the disk. */
  async settle(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
      this.enqueue(this.get())
    }
    await this.pending
  }

  private schedule(value: T): void {
    const debounce = this.options.debounceMs ?? 0
    if (debounce <= 0) {
      this.enqueue(value)
      return
    }
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.enqueue(value)
    }, debounce)
  }

  /** Serialises writes so two updates can never interleave on the same file. */
  private enqueue(value: T): void {
    this.pending = this.pending
      .then(() => this.flush(value))
      .catch((error: unknown) => {
        log.error(`failed to persist ${this.options.filePath}`, error)
      })
  }

  private async flush(value: T): Promise<void> {
    const serialized = `${JSON.stringify(value, null, 2)}\n`
    await mkdir(dirname(this.options.filePath), { recursive: true })
    await writeFile(this.tmpPath, serialized, 'utf8')
    // Keep the last known-good version before replacing it.
    await copyFile(this.options.filePath, this.bakPath).catch(() => undefined)
    await rename(this.tmpPath, this.options.filePath)
  }

  private async tryRead(
    path: string,
  ): Promise<{ status: 'ok'; value: unknown } | { status: 'absent' } | { status: 'damaged' }> {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      return { status: 'absent' }
    }
    if (text.trim().length === 0) return { status: 'damaged' }
    try {
      return { status: 'ok', value: JSON.parse(text) as unknown }
    } catch {
      return { status: 'damaged' }
    }
  }

  /** Test helper: removes the store and its siblings. */
  async destroy(): Promise<void> {
    await Promise.all([
      rm(this.options.filePath, { force: true }),
      rm(this.bakPath, { force: true }),
      rm(this.tmpPath, { force: true }),
    ])
    this.cache = null
  }
}
