import { describe, expect, it } from 'vitest'
import { ALL_CVARS } from '@shared/config/catalog/cvar-catalog'
import { resolveCvar } from '@shared/config/catalog/cvar-facts'
import { makeConfigProfile, makeInstallation } from '../../../../../test-support/fixtures'
import { assignedEngineKinds, defaultScopeEngine, engineScope } from './engine-scope'

describe('engine scope', () => {
  it("a profile follows its installation's chosen engine", () => {
    const profile = makeConfigProfile({
      assignments: [{ installationId: 'one', isDefault: true }],
    })
    const detectedEngines = [
      { kind: 'r1q2' as const, executablePath: '/g/r1q2', supported: true },
      { kind: 'q2pro' as const, executablePath: '/g/q2pro', supported: true },
    ]
    const withR1q2 = [makeInstallation({ id: 'one', engineKind: 'r1q2', detectedEngines })]
    const withQ2pro = [makeInstallation({ id: 'one', engineKind: 'q2pro', detectedEngines })]

    expect(assignedEngineKinds(profile, withR1q2)).toEqual(['r1q2'])
    expect(assignedEngineKinds(profile, withQ2pro)).toEqual(['q2pro'])

    // The Settings tab resolves facts for the default scope engine; the same profile and the same
    // cvar must therefore resolve differently once the installation's chosen engine changes.
    const factsFor = (installations: typeof withR1q2) => {
      const engine = defaultScopeEngine(engineScope(profile, installations).selectable)
      if (!engine) throw new Error('expected an engine in scope')
      return { engine, resolved: ALL_CVARS.map((def) => resolveCvar(def, engine)) }
    }
    const r1q2 = factsFor(withR1q2)
    const q2pro = factsFor(withQ2pro)

    expect([r1q2.engine, q2pro.engine]).toEqual(['r1q2', 'q2pro'])
    const differing = r1q2.resolved.filter((entry, index) => {
      const other = q2pro.resolved[index]!
      const facts = (r: typeof entry) => ({ ...r, engine: undefined, def: undefined })
      return JSON.stringify(facts(entry)) !== JSON.stringify(facts(other))
    })
    expect(differing.length).toBeGreaterThan(0)
  })
})
