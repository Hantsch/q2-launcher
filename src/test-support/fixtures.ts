import type { ConfigProfile } from '../shared/modules/config'
import type { Installation, Job } from '../shared/types'

/**
 * Pure fixtures: imports only `src/shared` types, so renderer and main tests can both use it.
 * The default root is Windows-style; a test that needs a POSIX root passes it as an override.
 */
export function makeInstallation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'inst-1',
    name: 'Test Install',
    rootPath: 'C:\\Games\\Q2',
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

/** A running, cancellable download job; tests override the status, kind or progress they care about. */
export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    moduleId: 'downloads',
    kind: 'download-game',
    labelKey: 'downloads.job.bootstrap',
    labelParams: { name: 'Base game' },
    status: 'running',
    progress: { ratio: 0.42, bytesDone: 420_000, bytesTotal: 1_000_000, bytesPerSecond: 50_000 },
    cancellable: true,
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

/** The smallest valid profile: no cvars, binds or assignments. */
export function makeConfigProfile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile One',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}
