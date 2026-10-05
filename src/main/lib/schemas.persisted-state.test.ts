import { describe, expect, it } from 'vitest'
import { parseInstallation } from './schemas'

/**
 * Story 077 D1: `installationSchema`'s `lastFailure` field - additive and forgiving in exactly the
 * shape `icon` already gets right above it in `./schemas.ts`.
 */
describe('installationSchema - lastFailure (story 077 D1)', () => {
  const baseRow = {
    id: 'install-1',
    rootPath: 'C:\\Games\\Quake2',
    name: 'Quake II',
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'invalid',
    checks: [],
    gameDirs: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
  }

  const lastFailure = { errorKey: 'downloads.error.network', at: 1234567890, jobId: 'job-1' }

  it('AC1 (partial): an installation with a lastFailure round-trips through state.json', () => {
    const raw = { ...baseRow, lastFailure }
    // "Through state.json" for this schema is parse -> serialize -> parse again, since
    // `parseInstallation` is exactly what reads a row back out of the file.
    const parsedOnce = parseInstallation(raw)
    const parsedTwice = parseInstallation(JSON.parse(JSON.stringify(parsedOnce)))

    expect(parsedOnce?.lastFailure).toEqual(lastFailure)
    expect(parsedTwice).toEqual(parsedOnce)
  })

  it('AC8: an installation written before this story parses unchanged', () => {
    // No `lastFailure` key at all - the pre-077 shape.
    const parsed = parseInstallation(baseRow)

    expect(parsed).not.toBeNull()
    expect(parsed?.lastFailure).toBeUndefined()
    expect(parsed?.id).toBe('install-1')
    expect(parsed?.rootPath).toBe('C:\\Games\\Quake2')
  })

  it('AC8: a garbage lastFailure drops the field, not the row', () => {
    const parsed = parseInstallation({ ...baseRow, lastFailure: 'not an object' })

    expect(parsed).not.toBeNull()
    expect(parsed?.id).toBe('install-1')
    expect(parsed?.lastFailure).toBeUndefined()
  })

  it('a lastFailure missing a required member drops the field, not the row', () => {
    const { jobId: _jobId, ...malformed } = lastFailure
    const parsed = parseInstallation({ ...baseRow, lastFailure: malformed })

    expect(parsed).not.toBeNull()
    expect(parsed?.id).toBe('install-1')
    expect(parsed?.lastFailure).toBeUndefined()
  })

  it('a templated lastFailure carries its params through unchanged', () => {
    const withParams = { ...lastFailure, params: { packageId: 'q2-314-demo-x86.exe' } }
    const parsed = parseInstallation({ ...baseRow, lastFailure: withParams })

    expect(parsed?.lastFailure).toEqual(withParams)
  })

  it('a garbage params drops only params, not the rest of lastFailure (one level more forgiving)', () => {
    const parsed = parseInstallation({
      ...baseRow,
      lastFailure: { ...lastFailure, params: 'nope' },
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.lastFailure).toEqual(lastFailure)
    expect(parsed?.lastFailure?.params).toBeUndefined()
  })
})

/**
 * Regression for a one-line fix to `checkSchema`'s `severity` enum: it was missing `'info'` (the
 * real `CheckSeverity` union, `@shared/types/installation`, is
 * `'ok' | 'info' | 'warn' | 'error'`), which meant an installation whose only `checks` entry was
 * info-severity - exactly `validation.pak0NotRetail`, the demo-data marker
 * `src/main/modules/installations/inspector.ts` emits - had its entire `checks` array silently
 * wiped to `[]` by `checks: z.array(checkSchema).catch([])` on load.
 */
describe('installationSchema - checks severity: info (regression)', () => {
  const baseRow = {
    id: 'install-1',
    rootPath: 'C:\\Games\\Quake2',
    name: 'Quake II',
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    gameDirs: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
  }

  it('keeps an info-severity check rather than dropping the whole checks array', () => {
    const infoCheck = { id: 'base-paks', severity: 'info', messageKey: 'validation.pak0NotRetail' }
    const parsed = parseInstallation({ ...baseRow, checks: [infoCheck] })

    expect(parsed).not.toBeNull()
    expect(parsed?.checks).toEqual([infoCheck])
  })
})

describe('installationSchema - detectedEngines', () => {
  const baseRow = {
    id: 'install-1',
    rootPath: 'C:\\Games\\Quake2',
    name: 'Quake II',
    engineKind: 'r1q2',
    executablePath: 'C:\\Games\\Quake2\\r1q2.exe',
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
  }

  it('a record without detectedEngines still loads', () => {
    const parsed = parseInstallation(baseRow)

    expect(parsed).not.toBeNull()
    expect(parsed && 'detectedEngines' in parsed).toBe(false)
    expect(parsed?.engineKind).toBe('r1q2')
    expect(parsed?.executablePath).toBe('C:\\Games\\Quake2\\r1q2.exe')
  })

  it('detected engines round-trip and a mangled list drops only the field', () => {
    const detectedEngines = [
      { kind: 'r1q2', executablePath: 'C:\\Games\\Quake2\\r1q2.exe', supported: true },
      { kind: 'q2pro', executablePath: 'C:\\Games\\Quake2\\q2pro.exe', supported: true },
    ]

    expect(parseInstallation({ ...baseRow, detectedEngines })?.detectedEngines).toEqual(
      detectedEngines,
    )
    const mangled = parseInstallation({ ...baseRow, detectedEngines: 'nope' })
    expect(mangled?.id).toBe('install-1')
    expect(mangled?.detectedEngines).toBeUndefined()
  })

  it('keeps a choose-engine check rather than dropping the whole checks array', () => {
    const check = {
      id: 'executable',
      severity: 'warn',
      messageKey: 'validation.executableMissing',
      fix: 'choose-engine',
    }

    expect(parseInstallation({ ...baseRow, checks: [check] })?.checks).toEqual([check])
  })
})
