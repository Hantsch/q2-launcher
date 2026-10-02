import { join } from 'node:path'
import { beforeEach, vi } from 'vitest'
import { useTempDir } from '../../../test-support/temp-dir'
import { STANDARD_TEMPLATE, type ConfigProfile } from '@shared/modules/config'
import { fail, type Installation, type LaunchState } from '@shared/types'
import { scopedLogger } from '../../lib/logger'
import type { ModuleHandler, ModuleSetup } from '../types'

export const log = scopedLogger('config-index-test')

/**
 * The fake `handle` every harness in this file uses.
 *
 * Story 036 D5: `ModuleSetup.handle` takes the payload schema and
 * `MainModuleRegistry.invoke()` validates against it before entering the
 * handler. A harness that took the schema and dropped it would leave every test
 * in this file green while validation was off in the tests and on in production,
 * so this collector mirrors the registry instead: `safeParse`, and a rejected
 * payload answers `fail('ipc.error.invalidPayload')` without the handler ever
 * being called. Tests reach the collected handlers directly, so this is the only
 * place that validation can come from here.
 */
export function collectHandlers(handlers: Map<string, ModuleHandler>): ModuleSetup['handle'] {
  return (type, schema, handler) => {
    handlers.set(type, (payload) => {
      const parsed = schema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      return handler(parsed.data)
    })
  }
}

/**
 * Story 022 D7: the mutating handlers resolve the canonical profile directory through
 * `lib/paths`' `userDataDir()`, i.e. `app.getPath('userData')`. Each test file mocks `electron`
 * with this box (a real mock, pointed at a per-test temp folder).
 */
export const userDataBox = { current: '' }

/**
 * Story 023 D2: the `openFile` handler is the module's one privileged path, so `shell` is mocked
 * rather than left out of the `electron` mock - a test must be able to assert that nothing was
 * handed to the OS on a rejected call.
 */
export const shellMock = {
  openPath: vi.fn(async (_path: string): Promise<string> => ''),
  showItemInFolder: vi.fn((_path: string): void => {}),
}

let currentDir = ''

/**
 * Registers the per-test temp folder, points `userDataBox` at its `userData` child and clears the
 * `shell` spies. Returns a getter for the folder; call at file top level.
 */
export function useConfigTestDir(): () => string {
  const tempDir = useTempDir('q2-launcher-config-index-')
  beforeEach(() => {
    currentDir = tempDir()
    userDataBox.current = join(currentDir, 'userData')
    shellMock.openPath.mockClear()
    shellMock.showItemInFolder.mockClear()
  })
  return () => currentDir
}

export function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'i1',
    name: 'Test',
    rootPath: currentDir,
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

/**
 * Story 059 D2: the writer's cvar sections now come from `profile.cvarSections`, not from
 * `CvarDef.group` directly - without one, every catalogue cvar in this file's fixtures would fall
 * into the single reserved `Defaults` bucket, whose name-column alignment spans *every* catalogue
 * cvar (not just one group's) and would pad `set sensitivity`/`set crosshair` differently from what
 * this file's `toContain` assertions below pin. Seeding `cvarSections` with
 * `STANDARD_TEMPLATE.cvarSections` (the same four groups the pre-059 writer grouped by) keeps the
 * alignment - and therefore every literal assertion here - unchanged.
 */
export function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: { sensitivity: '3' },
    binds: {},
    assignments: [{ installationId: 'i1', isDefault: true }],
    cvarSections: STANDARD_TEMPLATE.cvarSections.map((section) => ({ ...section })),
    ...overrides,
  }
}

export function idleState(): LaunchState {
  return { phase: 'idle', installationId: null }
}

export function runningState(installationId: string): LaunchState {
  return { phase: 'running', installationId }
}
