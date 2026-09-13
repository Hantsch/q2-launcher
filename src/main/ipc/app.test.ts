import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../context'

/**
 * Story 075 D4: `app:copyText` (a length-capped clipboard write) and
 * `app:getInfo` gaining `osVersion`. `electron` and `node:os` are mocked the
 * same minimal way as `index.test.ts` / `dev.test.ts`, just enough for
 * `registerAppIpc` to import and run without a real Electron/Node runtime.
 */

const registered = vi.hoisted(
  () => new Map<string, (event: unknown, payload: unknown) => unknown>(),
)

const clipboardWriteText = vi.hoisted(() => vi.fn())
const shellOpenExternal = vi.hoisted(() => vi.fn())
const recordHarnessExternalUrl = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
      registered.set(channel, fn)
    }),
  },
  app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => 'C:\\fake\\userData' },
  BrowserWindow: { fromWebContents: () => null },
  shell: { openExternal: shellOpenExternal, openPath: vi.fn(), showItemInFolder: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  clipboard: { writeText: clipboardWriteText },
}))

vi.mock('node:os', () => ({
  release: () => '10.0.26200',
}))

// Story 099 D6: `isUiHarnessEnabled` is left real (it's a pure gate, already covered by its own
// tests) - only the file-writing half is stubbed, so this suite never touches disk.
vi.mock('../lib/ui-harness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/ui-harness')>()
  return { ...actual, recordHarnessExternalUrl }
})

const fakeEvent = {} as unknown as IpcMainInvokeEvent

async function setup(options: { isDev?: boolean } = {}): Promise<{
  getInfo: (event: unknown, payload: unknown) => unknown
  copyText: (event: unknown, payload: unknown) => unknown
  revealPath: (event: unknown, payload: unknown) => unknown
  openExternal: (event: unknown, payload: unknown) => unknown
}> {
  const { registerAppIpc } = await import('./app')
  const app = {
    isDev: options.isDev ?? false,
    installations: { list: () => [] },
  } as unknown as AppContext
  registerAppIpc(app)
  return {
    getInfo: registered.get('app:getInfo')!,
    copyText: registered.get('app:copyText')!,
    revealPath: registered.get('app:revealPath')!,
    openExternal: registered.get('app:openExternal')!,
  }
}

const ORIGINAL_HARNESS_ENV = process.env.Q2L_UI_HARNESS

beforeEach(() => {
  registered.clear()
  vi.resetModules()
  clipboardWriteText.mockClear()
  shellOpenExternal.mockClear()
  recordHarnessExternalUrl.mockClear()
  delete process.env.Q2L_UI_HARNESS
})

afterEach(() => {
  if (ORIGINAL_HARNESS_ENV === undefined) {
    delete process.env.Q2L_UI_HARNESS
  } else {
    process.env.Q2L_UI_HARNESS = ORIGINAL_HARNESS_ENV
  }
})

describe('app:getInfo', () => {
  it('includes osVersion from os.release(), alongside the existing fields', async () => {
    const { getInfo } = await setup()
    const info = (await getInfo(fakeEvent, undefined)) as Record<string, unknown>

    expect(info.osVersion).toBe('10.0.26200')
    expect(info.appVersion).toBe('0.0.0')
    expect(info.isPackaged).toBe(false)
  })
})

describe('app:revealPath', () => {
  // Story 075 AC5: the failure card reveals the log file through the *existing* allowlist - no new
  // privileged channel. `isAllowedRevealTarget` is module-private, so this asserts through the
  // registered handler, with an installation list that is empty on purpose: the log path has to be
  // allowed by one of the launcher's own roots, not by an installation that happens to contain it.
  // It is the `logFilePath()` root specifically that carries this: `electron-log` resolves its own
  // file path and ignores the mocked `app.getPath`, so `logPath` lands outside the mocked
  // `userDataDir()` and that other root cannot silently cover for it.
  it('the log file path is an allowed reveal target', async () => {
    const { getInfo, revealPath } = await setup()
    const info = (await getInfo(fakeEvent, undefined)) as { logPath: string }

    expect(typeof info.logPath).toBe('string')
    expect(info.logPath.length).toBeGreaterThan(0)

    const result = await revealPath(fakeEvent, info.logPath)

    expect(result).toEqual({ ok: true, value: null })
  })

  it('rejects a path outside every allowed root', async () => {
    // The counterpart the test above needs to mean anything: the allowlist still says no to a
    // path the launcher knows nothing about.
    const { revealPath } = await setup()

    const result = await revealPath(fakeEvent, 'C:\\Windows\\System32\\drivers\\etc\\hosts')

    expect(result).toEqual({ ok: false, error: { key: 'app.error.pathNotAllowed' } })
  })
})

describe('app:copyText', () => {
  it('writes valid text to the clipboard and resolves ok', async () => {
    const { copyText } = await setup()
    const result = await copyText(fakeEvent, 'a diagnostics report')

    expect(clipboardWriteText).toHaveBeenCalledWith('a diagnostics report')
    expect(result).toEqual({ ok: true, value: null })
  })

  it('rejects a non-string payload to a failed Outcome without touching the clipboard', async () => {
    const { copyText } = await setup()
    const result = await copyText(fakeEvent, { not: 'a string' })

    expect(clipboardWriteText).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
  })

  it('rejects an over-length string to a failed Outcome without touching the clipboard', async () => {
    const { copyText } = await setup()
    const result = await copyText(fakeEvent, 'x'.repeat(20_001))

    expect(clipboardWriteText).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
  })
})

describe('app:openExternal', () => {
  // Story 099 D6: the harness-gated recorder must not be reachable unless BOTH `isDev` and
  // `Q2L_UI_HARNESS === '1'` hold - mirroring the four-case gate table used throughout
  // `src/main/lib/ui-harness.test.ts` and `downloads/harness.test.ts`.
  it('both flags off: calls shell.openExternal, never the recorder', async () => {
    const { openExternal } = await setup({ isDev: false })

    const result = await openExternal(fakeEvent, 'https://example.test/')

    expect(shellOpenExternal).toHaveBeenCalledWith('https://example.test/')
    expect(recordHarnessExternalUrl).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, value: null })
  })

  it('only Q2L_UI_HARNESS=1 (isDev false): still calls shell.openExternal', async () => {
    process.env.Q2L_UI_HARNESS = '1'
    const { openExternal } = await setup({ isDev: false })

    await openExternal(fakeEvent, 'https://example.test/')

    expect(shellOpenExternal).toHaveBeenCalledWith('https://example.test/')
    expect(recordHarnessExternalUrl).not.toHaveBeenCalled()
  })

  it('only isDev=true (Q2L_UI_HARNESS unset): still calls shell.openExternal', async () => {
    const { openExternal } = await setup({ isDev: true })

    await openExternal(fakeEvent, 'https://example.test/')

    expect(shellOpenExternal).toHaveBeenCalledWith('https://example.test/')
    expect(recordHarnessExternalUrl).not.toHaveBeenCalled()
  })

  it('isDev=true and Q2L_UI_HARNESS set to something other than "1": still shell.openExternal', async () => {
    process.env.Q2L_UI_HARNESS = 'true'
    const { openExternal } = await setup({ isDev: true })

    await openExternal(fakeEvent, 'https://example.test/')

    expect(shellOpenExternal).toHaveBeenCalledWith('https://example.test/')
    expect(recordHarnessExternalUrl).not.toHaveBeenCalled()
  })

  it('both flags on: records the url instead of calling shell.openExternal', async () => {
    process.env.Q2L_UI_HARNESS = '1'
    const { openExternal } = await setup({ isDev: true })

    const result = await openExternal(fakeEvent, 'https://example.test/')

    expect(recordHarnessExternalUrl).toHaveBeenCalledWith('https://example.test/')
    expect(shellOpenExternal).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, value: null })
  })

  it('rejects an invalid url without touching either shell.openExternal or the recorder', async () => {
    process.env.Q2L_UI_HARNESS = '1'
    const { openExternal } = await setup({ isDev: true })

    const result = await openExternal(fakeEvent, 'not-a-url')

    expect(shellOpenExternal).not.toHaveBeenCalled()
    expect(recordHarnessExternalUrl).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: { key: 'app.error.invalidUrl' } })
  })
})
