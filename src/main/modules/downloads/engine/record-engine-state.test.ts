import { describe, expect, it } from 'vitest'
import { ok, type Installation } from '@shared/types'
import type { InstallationPatch } from '../../../services/installations'
import { setEngineState } from './record-engine-state'

function fixture(initial: Partial<Installation> = {}) {
  let current: Installation | undefined = {
    id: 'fixture-install',
    name: 'Fixture',
    rootPath: '/game',
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
    ...initial,
  }
  const patches: InstallationPatch[] = []
  const installations = {
    find: (id: string) => (current?.id === id ? current : undefined),
    patch: (_id: string, patch: InstallationPatch) => {
      patches.push(patch)
      const next = { ...current!, ...patch }
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete (next as Record<string, unknown>)[key]
      }
      current = next
      return ok(next)
    },
  }
  return { installations, patches, get: () => current }
}

describe('setEngineState', () => {
  it('records the engine state and mirrors detectedVersion in one write', () => {
    const f = fixture()

    const result = setEngineState(f.installations, 'fixture-install', {
      version: '2.34',
      packageId: 'q2pro-win64',
    })

    expect(result.ok).toBe(true)
    expect(f.patches).toHaveLength(1)
    expect(f.get()?.moduleData?.downloads).toEqual({ version: '2.34', packageId: 'q2pro-win64' })
    expect(f.get()?.detectedVersion).toBe('2.34')
  })

  it('shallow-merges a second patch over the first', () => {
    const f = fixture()
    setEngineState(f.installations, 'fixture-install', {
      version: '2.34',
      packageId: 'q2pro-win64',
    })

    setEngineState(f.installations, 'fixture-install', { bleedingEdge: true })

    expect(f.get()?.moduleData?.downloads).toEqual({
      version: '2.34',
      packageId: 'q2pro-win64',
      bleedingEdge: true,
    })
    expect(f.get()?.detectedVersion).toBe('2.34')
  })

  it('a patch without a version removes detectedVersion', () => {
    const f = fixture({ detectedVersion: '1.0' })

    setEngineState(f.installations, 'fixture-install', { bleedingEdge: true })

    expect(f.get()?.detectedVersion).toBeUndefined()
    expect('detectedVersion' in (f.get() ?? {})).toBe(false)
  })

  it('parses a garbage moduleData back to "unknown" rather than throwing, and does not set detectedVersion', () => {
    const f = fixture({ moduleData: { downloads: { version: 42, backup: 'nope' } } })

    expect(() =>
      setEngineState(f.installations, 'fixture-install', { bleedingEdge: true }),
    ).not.toThrow()

    expect(f.get()?.moduleData?.downloads).toEqual({ bleedingEdge: true })
    expect(f.get()?.detectedVersion).toBeUndefined()
  })

  it('reports an unknown installation instead of writing anything', () => {
    const f = fixture()

    const result = setEngineState(f.installations, 'nope', { version: '2.34' })

    expect(result).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
    expect(f.patches).toHaveLength(0)
  })
})
