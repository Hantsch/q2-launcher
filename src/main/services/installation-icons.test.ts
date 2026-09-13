import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Installation } from '@shared/types'
import { pathExists } from '../lib/fs-utils'
import { InstallationsService } from './installations'
import { StateStore } from './state'
import { deleteStoredIcon, ICONS_DIR_NAME, InstallationIconsService } from './installation-icons'

/**
 * Story 067 D4: the icon store is the one place that takes a renderer-triggered OS dialog, decodes
 * untrusted bytes and writes into `userData`, so the refusals are covered as thoroughly as the
 * happy path - AC2 (a picked PNG becomes the icon), AC4 (the copy outlives the source file) and
 * AC6 (an unusable pick persists nothing).
 *
 * `electron` is mocked, as in `../modules/config/index.test.ts`: under plain vitest
 * `import('electron')` resolves to a path *string*, so `app.getPath` (which `lib/paths`' `userDataDir()`
 * calls) and `dialog`/`nativeImage` have to be supplied here. `userData` points at a per-test temp
 * folder through a hoisted box, and `showOpenDialog` is a stub - no OS dialog is ever spawned.
 */

const userDataBox = vi.hoisted(() => ({ current: '' }))
const dialogMock = vi.hoisted(() => ({ showOpenDialog: vi.fn() }))

/**
 * What the fake `nativeImage` hands back from `resize(...).toPNG()`: a real, distinct 2x2 PNG, so
 * a stored icon can be told apart from the bytes of the file it was picked from (which is what
 * makes "nothing was written" and "the previous icon is still there" assertable).
 */
const ENCODED_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQI12P4z8AARAwQCgAf7gP9QDZ6TgAAAABJRU5ErkJggg=='

const encodedIcon = vi.hoisted(() => ({ bytes: Buffer.alloc(0) }))
encodedIcon.bytes = Buffer.from(ENCODED_ICON_BASE64, 'base64')

/** Every `createFromPath` / `resize` the service performed, so the *order* of the gates is testable. */
const decodeCalls = vi.hoisted(() => [] as string[])
const resizeCalls = vi.hoisted(() => [] as { width: number; height: number }[])

vi.mock('electron', async () => {
  const { readFileSync } = await import('node:fs')

  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  /**
   * Stands in for Electron's decoder with the one behaviour this service has to survive: a file
   * that is not really an image (a renamed `.txt`, garbage bytes, a path that cannot be read) does
   * not throw - it comes back as an *empty* image. Magic-byte sniffing is enough for that, and it
   * keeps the real code path (stat, extension, write, read-back) exercised against real files.
   */
  const isDecodable = (bytes: Buffer): boolean =>
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)

  return {
    app: { getPath: () => userDataBox.current },
    dialog: dialogMock,
    nativeImage: {
      createFromPath: (path: string) => {
        decodeCalls.push(path)
        let bytes = Buffer.alloc(0)
        try {
          bytes = readFileSync(path)
        } catch {
          // An unreadable path is an empty image in Electron too, not an exception.
        }
        const decodable = isDecodable(bytes)
        const image = {
          isEmpty: (): boolean => !decodable,
          resize: (options: { width: number; height: number }) => {
            resizeCalls.push(options)
            return image
          },
          toPNG: (): Buffer => (decodable ? encodedIcon.bytes : Buffer.alloc(0)),
        }
        return image
      },
    },
  }
})

/** A real, valid 1x1 PNG - the file the user picks in the happy-path tests. */
const SOURCE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

const INSTALLATION_ID = 'fixture-install-icon'

let dir: string
let userData: string
let iconsDir: string
let state: StateStore
let installations: InstallationsService
let icons: InstallationIconsService

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-installation-icons-'))
  userData = join(dir, 'userData')
  userDataBox.current = userData
  iconsDir = join(userData, ICONS_DIR_NAME)
  await mkdir(userData, { recursive: true })

  dialogMock.showOpenDialog.mockReset()
  decodeCalls.length = 0
  resizeCalls.length = 0

  state = new StateStore(join(userData, 'state.json'))
  await state.load()
  state.setInstallations([installation()])

  installations = new InstallationsService({
    state,
    onChange: () => {},
    onSettingsChange: () => {},
    // Wired exactly as `context.ts` wires it, so the removal teardown is covered as it ships.
    onRemoved: (id) => deleteStoredIcon(id),
  })
  icons = new InstallationIconsService(installations)
})

afterEach(async () => {
  // The store writes `state.json` debounced; letting it finish before the temp dir goes away
  // keeps a late flush from failing against a deleted directory.
  await state.settle()
  // maxRetries/retryDelay work around a Windows ENOTEMPTY race where the OS hasn't released a
  // just-closed file handle by the time rmdir runs (same as `../modules/config/index.test.ts`).
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: INSTALLATION_ID,
    name: 'Icon Fixture',
    rootPath: join(dir, 'game'),
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: ['baseq2'],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

/** Stubs the picker to return `path`; `null` stands for the user cancelling the dialog. */
function pickReturns(path: string | null): void {
  dialogMock.showOpenDialog.mockResolvedValue(
    path === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [path] },
  )
}

async function writeSource(name: string, contents: Buffer): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, contents)
  return path
}

function storedIconFile(): string {
  return join(iconsDir, `${INSTALLATION_ID}.png`)
}

/** The stored-icon directory as the test sees it, `[]` when it does not exist at all. */
async function iconFiles(): Promise<string[]> {
  try {
    return (await readdir(iconsDir)).sort()
  } catch {
    return []
  }
}

describe('pickAndStore', () => {
  it('a picked PNG is stored and becomes the installation’s icon', async () => {
    pickReturns(await writeSource('avatar.png', SOURCE_PNG))

    const result = await icons.pickAndStore(INSTALLATION_ID, null)

    expect(result.ok).toBe(true)
    expect(installations.find(INSTALLATION_ID)?.icon).toEqual({ kind: 'custom' })
    // The record carries no path - only the kind (AC7).
    expect(JSON.stringify(installations.find(INSTALLATION_ID)?.icon)).not.toContain('avatar')

    await expect(icons.dataUrl(INSTALLATION_ID)).resolves.toMatch(/^data:image\/png;base64,.+/)
    expect(await iconFiles()).toEqual([`${INSTALLATION_ID}.png`])
    // Re-encoded, not copied: the stored bytes are the encoder's output, at a fixed 128px square.
    expect(await readFile(storedIconFile())).toEqual(encodedIcon.bytes)
    expect(resizeCalls).toEqual([{ width: 128, height: 128 }])
  })

  it('the icon survives deleting the file it was picked from', async () => {
    const source = await writeSource('avatar.png', SOURCE_PNG)
    pickReturns(source)

    expect((await icons.pickAndStore(INSTALLATION_ID, null)).ok).toBe(true)
    const before = await icons.dataUrl(INSTALLATION_ID)

    // AC4: moved, renamed or deleted - the pick stored a copy, so the source is irrelevant now.
    await rm(source)
    expect(await pathExists(source)).toBe(false)

    await expect(icons.dataUrl(INSTALLATION_ID)).resolves.toBe(before)
    expect(installations.find(INSTALLATION_ID)?.icon).toEqual({ kind: 'custom' })
  })

  it('refuses a pick for an installation that is not in the library, without opening a dialog', async () => {
    pickReturns(await writeSource('avatar.png', SOURCE_PNG))

    const result = await icons.pickAndStore('not-a-real-installation', null)

    expect(result).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
    expect(dialogMock.showOpenDialog).not.toHaveBeenCalled()
    expect(await iconFiles()).toEqual([])
  })
})

/**
 * AC6, table-driven. Each case starts from an installation that *already has* a stored custom
 * icon, so a refusal has something to damage: the assertions cover the record, the stored bytes
 * and the directory listing (no new file, no leftover `.tmp`).
 */
describe('an unusable pick is refused and nothing is persisted', () => {
  interface RefusalCase {
    name: string
    expectedKey: string
    /** Returns the path the stubbed dialog reports, or `null` for a cancelled dialog. */
    source: () => Promise<string | null>
    /** Story risk: the size gate has to run *before* anything decodes the file. */
    decodes?: boolean
  }

  const cases: RefusalCase[] = [
    {
      name: 'a file larger than 4 MB',
      expectedKey: 'installations.error.iconTooLarge',
      source: () => writeSource('huge.png', Buffer.alloc(4 * 1024 * 1024 + 1)),
      decodes: false,
    },
    {
      name: 'an extension that is not PNG or JPEG',
      expectedKey: 'installations.error.iconUnsupportedFormat',
      source: () => writeSource('avatar.gif', SOURCE_PNG),
      decodes: false,
    },
    {
      name: 'corrupt bytes behind a .png extension',
      expectedKey: 'installations.error.iconUnreadable',
      source: () => writeSource('renamed.png', Buffer.from('this is a text file, not an image')),
      decodes: true,
    },
    {
      name: 'a cancelled dialog',
      expectedKey: 'installations.error.iconPickCancelled',
      source: async () => null,
      decodes: false,
    },
  ]

  it.each(cases)('$name', async ({ expectedKey, source, decodes }) => {
    // The icon that must survive the refusal.
    await mkdir(iconsDir, { recursive: true })
    await writeFile(storedIconFile(), SOURCE_PNG)
    installations.setIcon(INSTALLATION_ID, { kind: 'custom' })
    const iconBefore = installations.find(INSTALLATION_ID)?.icon

    pickReturns(await source())

    const result = await icons.pickAndStore(INSTALLATION_ID, null)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.key).toBe(expectedKey)
    // Never prose, never the picked path.
    expect(result.ok === false && JSON.stringify(result.error)).not.toMatch(/[/\\]/)

    expect(installations.find(INSTALLATION_ID)?.icon).toEqual(iconBefore)
    expect(await iconFiles()).toEqual([`${INSTALLATION_ID}.png`])
    expect(await readFile(storedIconFile())).toEqual(SOURCE_PNG)
    expect(decodeCalls.length > 0).toBe(decodes === true)
  })
})

describe('setShipped and clear', () => {
  it('setShipped persists the shipped id and drops a stored custom file', async () => {
    pickReturns(await writeSource('avatar.png', SOURCE_PNG))
    expect((await icons.pickAndStore(INSTALLATION_ID, null)).ok).toBe(true)

    const result = await icons.setShipped(INSTALLATION_ID, 'r1q2-logo')

    expect(result.ok).toBe(true)
    expect(installations.find(INSTALLATION_ID)?.icon).toEqual({
      kind: 'shipped',
      id: 'r1q2-logo',
    })
    // A shipped icon never reads the stored file, so keeping it would only be an orphan.
    expect(await iconFiles()).toEqual([])
    await expect(icons.dataUrl(INSTALLATION_ID)).resolves.toBeNull()
  })

  it('clear removes the icon field and the stored file', async () => {
    pickReturns(await writeSource('avatar.png', SOURCE_PNG))
    expect((await icons.pickAndStore(INSTALLATION_ID, null)).ok).toBe(true)

    const result = await icons.clear(INSTALLATION_ID)

    expect(result.ok).toBe(true)
    expect(result.ok === true && 'icon' in result.value).toBe(false)
    expect(installations.find(INSTALLATION_ID)?.icon).toBeUndefined()
    expect(await iconFiles()).toEqual([])
  })

  it('clear on an installation that never had an icon is not an error', async () => {
    const result = await icons.clear(INSTALLATION_ID)

    expect(result.ok).toBe(true)
    expect(await iconFiles()).toEqual([])
  })

  it('reports an unknown installation instead of writing a file for it', async () => {
    expect(await icons.setShipped('nope', 'r1q2-logo')).toEqual({
      ok: false,
      error: { key: 'installations.error.notFound' },
    })
    expect(await iconFiles()).toEqual([])
  })
})

describe('removal', () => {
  it('removing an installation takes its stored icon file with it', async () => {
    pickReturns(await writeSource('avatar.png', SOURCE_PNG))
    expect((await icons.pickAndStore(INSTALLATION_ID, null)).ok).toBe(true)
    expect(await iconFiles()).toEqual([`${INSTALLATION_ID}.png`])

    const removed = await installations.remove({ id: INSTALLATION_ID })

    expect(removed.ok).toBe(true)
    expect(await iconFiles()).toEqual([])
  })

  it('a rejected removal leaves the icon file alone', async () => {
    pickReturns(await writeSource('avatar.png', SOURCE_PNG))
    expect((await icons.pickAndStore(INSTALLATION_ID, null)).ok).toBe(true)

    const removed = await installations.remove({ id: INSTALLATION_ID, deleteFromDisk: true })

    expect(removed.ok).toBe(false)
    expect(await iconFiles()).toEqual([`${INSTALLATION_ID}.png`])
  })
})

describe('dataUrl', () => {
  it('is null when the installation has no stored icon', async () => {
    await expect(icons.dataUrl(INSTALLATION_ID)).resolves.toBeNull()
  })

  it('never lets an id that is not a plain path segment reach the filesystem', async () => {
    await writeFile(join(userData, 'state.json.bak'), 'secret')

    // The id crosses IPC as a bare string; only a safe segment may become a file name.
    for (const id of ['../state.json.bak', '..\\state.json.bak', '..', 'a/b', '']) {
      await expect(icons.dataUrl(id)).resolves.toBeNull()
      await expect(icons.setShipped(id, 'r1q2-logo')).resolves.toMatchObject({ ok: false })
      await expect(deleteStoredIcon(id)).resolves.toBeUndefined()
    }

    expect(await pathExists(join(userData, 'state.json.bak'))).toBe(true)
  })
})
