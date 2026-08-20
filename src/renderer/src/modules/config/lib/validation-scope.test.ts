import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import type { Installation } from '@shared/types/installation'
import type { EngineKind } from '@shared/types/engine'
import { totalCounts, validateProfileForEngines } from './validation-scope'

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

function installation(id: string, engineKind: EngineKind): Installation {
  return {
    id,
    name: id,
    rootPath: `C:/games/${id}`,
    engineKind,
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
}

describe('validateProfileForEngines - scope states', () => {
  it('reports "unassigned" and no per-engine runs for a profile with no assignments', () => {
    const result = validateProfileForEngines(profile(), [])

    expect(result.status).toBe('unassigned')
    expect(result.byEngine).toEqual([])
    expect(result.omitted).toEqual([])
  })

  it('reports "unresolved" when every assignment points at a no-longer-registered installation', () => {
    const p = profile({ assignments: [{ installationId: 'gone', isDefault: true }] })

    const result = validateProfileForEngines(p, [])

    expect(result.status).toBe('unresolved')
    expect(result.byEngine).toEqual([])
  })

  it('reports "noFacts" and names the omitted engine for an installation outside r1q2/q2pro/vanilla', () => {
    const p = profile({ assignments: [{ installationId: 'y1', isDefault: true }] })
    const installations = [installation('y1', 'yquake2')]

    const result = validateProfileForEngines(p, installations)

    expect(result.status).toBe('noFacts')
    expect(result.byEngine).toEqual([])
    expect(result.omitted).toEqual(['yquake2'])
  })

  it('never substitutes r1q2 numbers when the only assigned engine is out of scope', () => {
    const p = profile({
      assignments: [{ installationId: 'y1', isDefault: true }],
      cvars: { r_maxfps: '0' },
    })
    const installations = [installation('y1', 'yquake2')]

    const result = validateProfileForEngines(p, installations)

    expect(result.byEngine).toEqual([])
  })
})

describe('validateProfileForEngines - equally-weighted multi-engine runs', () => {
  it('runs one independent section per distinct assigned engine, r_maxfps 0 only under r1q2', () => {
    const p = profile({
      cvars: { r_maxfps: '0' },
      assignments: [
        { installationId: 'a', isDefault: true },
        { installationId: 'b', isDefault: false },
      ],
    })
    const installations = [installation('a', 'r1q2'), installation('b', 'q2pro')]

    const result = validateProfileForEngines(p, installations)

    expect(result.status).toBe('ok')
    expect(result.byEngine.map((e) => e.engine)).toEqual(['r1q2', 'q2pro'])

    const r1q2Findings = result.byEngine.find((e) => e.engine === 'r1q2')!.findings
    const q2proFindings = result.byEngine.find((e) => e.engine === 'q2pro')!.findings

    expect(r1q2Findings.some((f) => f.subject.id === 'r_maxfps' && f.level === 'error')).toBe(true)
    expect(q2proFindings.some((f) => f.subject.id === 'r_maxfps')).toBe(false)
  })

  it('does not merge or rank engines: one engine erroring does not affect the other engine\'s own findings', () => {
    const p = profile({
      cvars: { ch_scale: '1' }, // absent on r1q2/vanilla, present on q2pro
      assignments: [
        { installationId: 'a', isDefault: true },
        { installationId: 'b', isDefault: false },
      ],
    })
    const installations = [installation('a', 'r1q2'), installation('b', 'q2pro')]

    const result = validateProfileForEngines(p, installations)

    const r1q2 = result.byEngine.find((e) => e.engine === 'r1q2')!
    const q2pro = result.byEngine.find((e) => e.engine === 'q2pro')!

    expect(r1q2.summary.errors).toBeGreaterThan(0)
    expect(q2pro.findings.some((f) => f.subject.id === 'ch_scale')).toBe(false)
  })

  it('two installations of the same engine still produce exactly one section for it', () => {
    const p = profile({
      assignments: [
        { installationId: 'a', isDefault: true },
        { installationId: 'b', isDefault: false },
      ],
    })
    const installations = [installation('a', 'r1q2'), installation('b', 'r1q2')]

    const result = validateProfileForEngines(p, installations)

    expect(result.byEngine).toHaveLength(1)
    expect(result.byEngine[0].engine).toBe('r1q2')
  })

  it('runs structural checks against the exact rendered profile file, catching a quote render.ts never sanitizes out of a cvar value', () => {
    // A text-kind cvar value is never sanitized against quotes before render.ts
    // wraps it in a pair of them (see validate-structure.ts's own doc comment) -
    // this only becomes a finding once actually rendered as `set name "..."`,
    // which is exactly what proves this runs against rendered text, not
    // `profile.cvars` interpreted some other way.
    const p = profile({
      cvars: { name: 'hello "world"' },
      assignments: [{ installationId: 'a', isDefault: true }],
    })
    const installations = [installation('a', 'r1q2')]

    const result = validateProfileForEngines(p, installations)
    const findings = result.byEngine[0]!.findings

    expect(findings.some((f) => f.messageKey.endsWith('quoteBroken') && f.subject.id === 'name')).toBe(
      true,
    )
  })
})

describe('validateProfileForEngines - story 019 D8 alias-wiring findings', () => {
  it('reports a binding calling an undefined alias and an unreferenced alias through the orchestrated scope', () => {
    const p = profile({
      assignments: [{ installationId: 'a', isDefault: true }],
      categories: [{ id: 'cat1', name: 'Custom' }],
      actions: [
        { id: 'a1', categoryId: 'cat1', name: '-test', kind: 'alias', commands: [{ kind: 'raw', text: 'wait' }] },
        {
          id: 'b1',
          categoryId: 'cat1',
          name: 'Test binding',
          kind: 'bind',
          commands: [{ kind: 'raw', text: '+test' }],
        },
      ],
    })
    const installations = [installation('a', 'r1q2')]

    const result = validateProfileForEngines(p, installations)
    const findings = result.byEngine[0]!.findings

    expect(findings.some((f) => f.messageKey.endsWith('undefinedAlias') && f.subject.id === 'Test binding')).toBe(
      true,
    )
    expect(findings.some((f) => f.messageKey.endsWith('aliasUnreferenced') && f.subject.id === '-test')).toBe(true)
  })

  it('produces no alias-wiring findings for a profile whose alias is defined and referenced', () => {
    const p = profile({
      assignments: [{ installationId: 'a', isDefault: true }],
      categories: [{ id: 'cat1', name: 'Custom' }],
      actions: [
        { id: 'a1', categoryId: 'cat1', name: '+test', kind: 'alias', commands: [{ kind: 'raw', text: 'wait' }] },
        {
          id: 'b1',
          categoryId: 'cat1',
          name: 'Test binding',
          kind: 'bind',
          commands: [{ kind: 'raw', text: '+test' }],
        },
      ],
    })
    const installations = [installation('a', 'r1q2')]

    const result = validateProfileForEngines(p, installations)
    const findings = result.byEngine[0]!.findings

    expect(findings.some((f) => f.messageKey.includes('.actions.'))).toBe(false)
  })
})

describe('totalCounts', () => {
  it('sums errors and warnings across every engine section', () => {
    const p = profile({
      cvars: { ch_scale: '1' },
      assignments: [
        { installationId: 'a', isDefault: true },
        { installationId: 'b', isDefault: false },
      ],
    })
    const installations = [installation('a', 'r1q2'), installation('b', 'vanilla')]

    const result = validateProfileForEngines(p, installations)
    const counts = totalCounts(result)

    // ch_scale is absent on both r1q2 and vanilla - one error-level finding each.
    expect(counts.errors).toBeGreaterThanOrEqual(2)
  })

  it('is zero for the empty scope states', () => {
    expect(totalCounts(validateProfileForEngines(profile(), []))).toEqual({ errors: 0, warnings: 0 })
  })
})
