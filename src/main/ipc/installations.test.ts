import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Installation } from '@shared/types'
import type { AppContext } from '../context'

/**
 * Story 103 D6: `installations:listRunners`, registered by the real `registerInstallationsIpc`
 * (not a stub) so the schema/handler wiring is actually exercised, mirroring
 * `installations:validate`'s own not-found handling. `detectRunners()` (`src/main/services/runners.ts`)
 * is mocked - it has its own suite in `runners.test.ts` - so only the IPC-layer mapping (`DetectedRunner`
 * -> `RunnerOption`) and the not-found/invalid-payload paths are asserted here, the same split
 * `app.test.ts`/`dev.test.ts` use for their own services.
 */

const registered = vi.hoisted(
  () => new Map<string, (event: unknown, payload: unknown) => unknown>(),
)

const detectRunnersMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
      registered.set(channel, fn)
    }),
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))

// Only detection is mocked: `steamUnavailableReason` stays real, because the Steam option's
// per-installation judgement (story 104 D3) is exactly what the handler is supposed to delegate.
vi.mock('../services/runners', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/runners')>()),
  detectRunners: detectRunnersMock,
}))

const fakeEvent = {} as unknown as IpcMainInvokeEvent

function fixtureInstallation(id: string): Installation {
  return {
    id,
    name: 'Fixture',
    rootPath: 'C:\\fixture',
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
  }
}

async function setup(
  installations: Installation[],
): Promise<(event: unknown, payload: unknown) => unknown> {
  const { registerInstallationsIpc } = await import('./installations')
  const app = {
    installations: {
      find: (id: string) => installations.find((installation) => installation.id === id),
    },
  } as unknown as AppContext
  registerInstallationsIpc(app)
  return registered.get('installations:listRunners')!
}

beforeEach(() => {
  registered.clear()
  vi.resetModules()
  detectRunnersMock.mockReset()
})

describe('installations:listRunners', () => {
  it('round-trips through the real registrar and maps detected runners to RunnerOptions', async () => {
    detectRunnersMock.mockResolvedValue([
      { kind: 'native', id: 'native', path: '', available: true },
      { kind: 'wine', id: 'wine', path: '', available: false },
      {
        kind: 'proton',
        id: 'proton-experimental',
        label: 'Proton - Experimental',
        path: 'C:\\steam\\Proton - Experimental',
        available: true,
      },
    ])
    const fn = await setup([fixtureInstallation('inst-1')])

    const result = await fn(fakeEvent, 'inst-1')

    expect(result).toEqual({
      ok: true,
      value: [
        { kind: 'native', id: 'native', labelKey: 'runner.kind.native', available: true },
        {
          kind: 'wine',
          id: 'wine',
          labelKey: 'runner.kind.wine',
          available: false,
          reasonKey: 'runner.unavailable.wine',
        },
        {
          kind: 'proton',
          id: 'proton-experimental',
          labelKey: 'runner.kind.proton',
          available: false,
          reasonKey: 'runner.unavailable.protonNotDriven',
        },
      ],
    })
  })

  it('maps a detected Proton build to available: false, never selectable directly', async () => {
    detectRunnersMock.mockResolvedValue([
      { kind: 'native', id: 'native', path: '', available: true },
      {
        kind: 'proton',
        id: 'proton-8-0',
        label: 'Proton 8.0',
        path: 'C:\\steam\\Proton 8.0',
        available: true,
      },
    ])
    const fn = await setup([fixtureInstallation('inst-1')])

    const result = await fn(fakeEvent, 'inst-1')

    expect(result).toEqual({
      ok: true,
      value: [
        { kind: 'native', id: 'native', labelKey: 'runner.kind.native', available: true },
        {
          kind: 'proton',
          id: 'proton-8-0',
          labelKey: 'runner.kind.proton',
          available: false,
          reasonKey: 'runner.unavailable.protonNotDriven',
        },
      ],
    })
  })

  it('listRunners gives the steam option its reason per installation', async () => {
    const NATIVE = { kind: 'native', id: 'native', path: '', available: true }
    const STEAM_FOUND = { kind: 'steam', id: 'steam', path: 'C:\\Steam\\steam.exe', available: true }
    const STEAM_MISSING = { kind: 'steam', id: 'steam', path: '', available: false }
    const steamOption = (result: unknown): unknown =>
      (result as { value: { kind: string }[] }).value.find((option) => option.kind === 'steam')

    const owned = { ...fixtureInstallation('owned'), steamAppId: '2320' }
    const unowned = fixtureInstallation('unowned')
    const unknownApp = { ...fixtureInstallation('unknown'), steamAppId: '9999' }
    const fn = await setup([owned, unowned, unknownApp])

    // 1. No Steam executable at all - reported first, even for a folder Steam owns.
    detectRunnersMock.mockResolvedValue([NATIVE, STEAM_MISSING])
    expect(steamOption(await fn(fakeEvent, 'owned'))).toEqual({
      kind: 'steam',
      id: 'steam',
      labelKey: 'runner.kind.steam',
      available: false,
      reasonKey: 'runner.unavailable.steam',
    })

    detectRunnersMock.mockResolvedValue([NATIVE, STEAM_FOUND])
    // 2. Steam found, but this folder carries no appid.
    expect(steamOption(await fn(fakeEvent, 'unowned'))).toMatchObject({
      available: false,
      reasonKey: 'runner.unavailable.steamNotOwner',
    })
    // 3. An appid with no client table.
    expect(steamOption(await fn(fakeEvent, 'unknown'))).toMatchObject({
      available: false,
      reasonKey: 'runner.unavailable.steamUnknownApp',
    })
    // Fully available: enabled, and no reason at all.
    expect(steamOption(await fn(fakeEvent, 'owned'))).toEqual({
      kind: 'steam',
      id: 'steam',
      labelKey: 'runner.kind.steam',
      available: true,
    })
  })

  it('fails with installations.error.notFound for an unknown id, without calling detectRunners', async () => {
    const fn = await setup([])

    const result = await fn(fakeEvent, 'missing')

    expect(result).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
    expect(detectRunnersMock).not.toHaveBeenCalled()
  })

  it('resolves an invalid payload to a failed Outcome without running the handler', async () => {
    const fn = await setup([fixtureInstallation('inst-1')])

    const result = await fn(fakeEvent, 42)

    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    expect(detectRunnersMock).not.toHaveBeenCalled()
  })
})
