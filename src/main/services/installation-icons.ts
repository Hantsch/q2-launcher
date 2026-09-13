import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { dialog, nativeImage, type BrowserWindow } from 'electron'
import { fail, type Installation, type Outcome } from '@shared/types'
import { fileSize } from '../lib/fs-utils'
import { scopedLogger } from '../lib/logger'
import { userDataDir } from '../lib/paths'
import type { InstallationsService } from './installations'

const log = scopedLogger('installation-icons')

/**
 * Story 067: where a custom installation icon lives after the pick.
 *
 * The bytes are copied into `userData/installation-icons/<installationId>.png` and the record only
 * ever says `{ kind: 'custom' }` - no renderer-supplied path is trusted, persisted or re-read, and
 * moving, renaming or deleting the file the user picked from cannot affect the stored icon (AC4).
 * Every failure leaves both the record and the stored file exactly as they were (AC6).
 */

/** Subdirectory of `userData` that holds one `<installationId>.png` per custom icon. */
export const ICONS_DIR_NAME = 'installation-icons'

/**
 * A source file bigger than this is refused *before* anything decodes it: `nativeImage` decodes
 * into memory, so the cheap `stat` has to be the first gate, not a sanity check afterwards.
 */
const MAX_SOURCE_BYTES = 4 * 1024 * 1024
/** The same limit as a number for the translated message - main sends keys plus params, not prose. */
const MAX_SOURCE_MB = 4

/** Everything is re-encoded to this square, so the renderer never sizes a stranger's bitmap. */
const STORED_ICON_SIZE = 128

/**
 * `nativeImage` decodes PNG and JPEG only - there is no image library in this repo, so a `.webp`
 * or `.avif` pick is a refusal rather than a silent empty image (see the story's Decisions).
 */
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg']

/**
 * An installation id has to be a single, harmless path segment before it may become a file name.
 * Real ids are `randomUUID()`s (and the e2e fixture's `fixture-install-*` slugs), but the id
 * arrives from the renderer over IPC where the schema only demands a non-empty string - so the
 * shape is checked here, not assumed. Dots are excluded outright, which rules out `.`/`..` and
 * anything that could grow an extension of its own.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Absolute path of an installation's stored icon, derived purely from its id. `null` for an id
 * that must never reach the filesystem - callers then behave as if no icon existed.
 */
export function storedIconPath(installationId: string): string | null {
  if (!SAFE_ID.test(installationId)) return null
  return join(userDataDir(), ICONS_DIR_NAME, `${installationId}.png`)
}

/**
 * Deletes an installation's stored icon, if it has one. Wired into `InstallationsService.remove()`
 * via its `onRemoved` hook: without that, every removed installation would leave its icon behind
 * in `userData` forever, keyed by an id nothing refers to any more.
 *
 * Never throws - a locked or already-deleted file must not fail the removal it belongs to.
 */
export async function deleteStoredIcon(installationId: string): Promise<void> {
  const path = storedIconPath(installationId)
  if (path === null) return
  try {
    await rm(path, { force: true })
  } catch (error) {
    log.warn(`could not delete the stored icon for ${installationId}`, error)
  }
}

/**
 * The icon store: reads and writes the one file per installation, and persists the `icon` field
 * through `InstallationsService` so there is a single persistence path for an installation record.
 */
export class InstallationIconsService {
  private readonly installations: InstallationsService

  constructor(installations: InstallationsService) {
    this.installations = installations
  }

  /**
   * Points an installation at one of the shipped icons. Any previously stored custom file is
   * dropped: a shipped icon never reads it, so keeping it would be an orphan that only grows.
   */
  async setShipped(installationId: string, iconId: string): Promise<Outcome<Installation>> {
    const result = this.installations.setIcon(installationId, { kind: 'shipped', id: iconId })
    if (result.ok) await deleteStoredIcon(installationId)
    return result
  }

  /** Removes the icon entirely - the tile falls back to the engine/initials code (AC5). */
  async clear(installationId: string): Promise<Outcome<Installation>> {
    const result = this.installations.setIcon(installationId, null)
    if (result.ok) await deleteStoredIcon(installationId)
    return result
  }

  /**
   * The one privileged path in this service: main owns the OS dialog, validates the file it
   * returns, re-encodes it and copies the result into `userData`.
   *
   * Order matters and is load-bearing: extension, then size (a cheap `stat`), then the decode.
   * `nativeImage.createFromPath` does not throw for a file that merely looks like an image - a
   * renamed `.txt` comes back as an *empty* image - so `isEmpty()` is the check that catches
   * garbage bytes, and nothing is written until it has passed.
   */
  async pickAndStore(
    installationId: string,
    window: BrowserWindow | null,
  ): Promise<Outcome<Installation>> {
    const current = this.installations.find(installationId)
    if (!current) return fail('installations.error.notFound')

    const target = storedIconPath(installationId)
    // A registered installation with an id of that shape is a bug, not user input - refuse
    // rather than build a path out of it.
    if (target === null) return fail('installations.error.iconStoreFailed')

    const sourcePath = await showIconOpenDialog(window)
    if (sourcePath === null) return fail('installations.error.iconPickCancelled')

    if (!ALLOWED_EXTENSIONS.includes(extname(sourcePath).toLowerCase())) {
      return fail('installations.error.iconUnsupportedFormat')
    }

    const size = await fileSize(sourcePath)
    if (size === null) return fail('installations.error.iconUnreadable')
    if (size > MAX_SOURCE_BYTES) {
      return fail('installations.error.iconTooLarge', { limit: MAX_SOURCE_MB })
    }

    let png: Buffer
    try {
      const image = nativeImage.createFromPath(sourcePath)
      if (image.isEmpty()) return fail('installations.error.iconUnreadable')
      png = image.resize({ width: STORED_ICON_SIZE, height: STORED_ICON_SIZE }).toPNG()
    } catch (error) {
      log.warn('picked file could not be decoded as an image', error)
      return fail('installations.error.iconUnreadable')
    }
    // A resize/encode that produced nothing would otherwise be stored as a zero-byte icon that
    // renders as a broken image for good.
    if (png.length === 0) return fail('installations.error.iconUnreadable')

    try {
      await writeIconAtomic(target, png)
    } catch (error) {
      log.error('could not store the icon in userData', error)
      return fail('installations.error.iconStoreFailed')
    }

    const result = this.installations.setIcon(installationId, { kind: 'custom' })
    if (!result.ok) {
      // The installation disappeared between the dialog opening and the write finishing. Take the
      // file back out rather than leaving an icon behind that no record points at.
      await deleteStoredIcon(installationId)
      return result
    }

    log.info(`stored a custom icon for ${installationId} (${png.length} bytes)`)
    return result
  }

  /**
   * The stored icon as a `data:` URL, or `null` when there is none - the common case for the
   * majority of installations, hence not an error. `data:` images are already allowed by
   * `PRODUCTION_CSP`'s `img-src`, so delivering icons this way needs no CSP change (AC7).
   */
  async dataUrl(installationId: string): Promise<string | null> {
    const path = storedIconPath(installationId)
    if (path === null) return null

    try {
      const bytes = await readFile(path)
      if (bytes.length === 0) return null
      return `data:image/png;base64,${bytes.toString('base64')}`
    } catch {
      return null
    }
  }
}

/** Modal-to-the-window dialog, so it cannot be lost behind the launcher. Mirrors `ipc/installations.ts`'s helper. */
async function showIconOpenDialog(window: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    // No title or button label: `installations:pickIconFile` carries only an installation id, and
    // main has no translated prose to put here - the OS defaults are correct in the user's locale.
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
  }

  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/**
 * Same tmp-then-rename shape as `writeFileAtomic` (`lib/fs-utils.ts`), which takes text plus an
 * encoding and would have to be widened for bytes. A crash mid-write cannot leave a truncated PNG
 * that would render broken until the user picks again.
 */
async function writeIconAtomic(path: string, bytes: Buffer): Promise<void> {
  const tmpPath = `${path}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tmpPath, bytes)
  await rename(tmpPath, path)
}
