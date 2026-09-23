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

vi.mock('../services/runners', () => ({
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
