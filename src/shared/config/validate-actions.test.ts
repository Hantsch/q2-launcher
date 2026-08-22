import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '../modules/config'
import { ACTIONS_MESSAGE_PREFIX, validateActions } from './validate-actions'

function action(overrides: Partial<ConfigAction> & Pick<ConfigAction, 'id' | 'kind' | 'name'>): ConfigAction {
  return { categoryId: 'c1', commands: [], ...overrides }
}

function rulesOf(findings: ReturnType<typeof validateActions>): string[] {
  return findings.map((finding) => finding.messageKey.slice(ACTIONS_MESSAGE_PREFIX.length))
}

describe('validateActions', () => {
  it('reports a binding that calls an alias which no longer exists', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Test binding',
        commands: [{ kind: 'raw', text: '+test' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(rulesOf(findings)).toEqual(['undefinedAlias'])
    expect(findings[0].subject).toEqual({ kind: 'action', id: 'Test binding' })
    expect(findings[0].params).toEqual({ action: 'Test binding', alias: '+test' })
  })

  it('reports an alias that nothing calls', () => {
    const actions = [action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] })]

    const findings = validateActions(actions, 'r1q2')

    expect(rulesOf(findings)).toEqual(['aliasUnreferenced'])
    expect(findings[0].subject).toEqual({ kind: 'action', id: '+test' })
  })

  it('reports two alias entries whose emitted names collide, as warnings naming both entries', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: 'Test', commands: [{ kind: 'raw', text: 'wait' }] }),
      action({ id: 'a2', kind: 'alias', name: 'test', commands: [{ kind: 'raw', text: 'wait' }] }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const duplicates = findings.filter((finding) => finding.messageKey.endsWith('aliasDuplicate'))

    expect(duplicates).toHaveLength(2)
    expect(duplicates.every((finding) => finding.level === 'warning')).toBe(true)
    expect(duplicates.find((finding) => finding.params?.entry === 'Test')?.params).toEqual({
      name: 'test',
      entry: 'Test',
      other: 'test',
    })
    expect(duplicates.find((finding) => finding.params?.entry === 'test')?.params).toEqual({
      name: 'test',
      entry: 'test',
      other: 'Test',
    })
    expect(findings.some((finding) => finding.level === 'error')).toBe(false)
  })

  it('story 039 D8: a catalogue row and a user alias entry resolving to the same name both get a warning naming each other', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Railgun',
        catalogId: 'weapons:railgun',
        commands: [{ kind: 'raw', text: 'use railgun' }],
      }),
      action({ id: 'a1', kind: 'alias', name: 'railgun', commands: [{ kind: 'raw', text: 'wait' }] }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const duplicates = findings.filter((finding) => finding.messageKey.endsWith('aliasDuplicate'))

    expect(duplicates).toHaveLength(2)
    expect(duplicates.every((finding) => finding.level === 'warning')).toBe(true)
    expect(duplicates.find((finding) => finding.params?.entry === 'Railgun')?.params).toEqual({
      name: 'railgun',
      entry: 'Railgun',
      other: 'railgun',
    })
    expect(duplicates.find((finding) => finding.params?.entry === 'railgun')?.params).toEqual({
      name: 'railgun',
      entry: 'railgun',
      other: 'Railgun',
    })
    expect(findings.some((finding) => finding.level === 'error')).toBe(false)
  })

  it('story 039 D8: an entry whose derived name shadows a known engine command gets aliasShadowsCommand', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Weapnext',
        commands: [{ kind: 'raw', text: 'weapnext' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const shadow = findings.find((finding) => finding.messageKey.endsWith('aliasShadowsCommand'))

    expect(shadow).toBeDefined()
    expect(shadow?.level).toBe('warning')
    expect(shadow?.params).toEqual({ entry: 'Weapnext', name: 'weapnext' })
    expect(findings.some((finding) => finding.level === 'error')).toBe(false)
  })

  // Regression (story 039 review): a *catalogue-adopted* discrete row (weapnext/weapprev/weaplast,
  // adopted from a hand-typed `bind <key> "weapnext"` the way `bind-adoption.ts` really produces it
  // - `catalogId` set, name equal to the bare command) must still get `aliasShadowsCommand`. Unlike
  // a continuous movement/weapon row (`+forward`), its own bind mirror goes *through* the alias
  // (`bindValueFor` has no `+`/`-` fast path for it), so the writer really does emit the dead,
  // self-referential `alias weapnext weapnext` the story's Decisions section warns about - a
  // blanket "every catalogue-materialised bind is exempt" exclusion would have silenced exactly
  // this case.
  it('story 039 D8: a catalogue-adopted discrete row (weapnext) still gets aliasShadowsCommand', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'weapnext',
        catalogId: 'weapons:weapnext',
        commands: [{ kind: 'raw', text: 'weapnext' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const shadow = findings.find((finding) => finding.messageKey.endsWith('aliasShadowsCommand'))

    expect(shadow).toBeDefined()
    expect(shadow?.level).toBe('warning')
    expect(shadow?.params).toEqual({ entry: 'weapnext', name: 'weapnext' })
    expect(findings.some((finding) => finding.level === 'error')).toBe(false)
  })

  /**
   * Story 039, fourth pass - the User's decision on the multi-command
   * self-reference case: the writer keeps the alias line as authored (dropping
   * it would discard `centerview` and every other real command in the body),
   * and Care says out loud which command self-references, so the user can
   * decide (remove the command, rename the entry, accept the loop).
   */
  it('reports aliasSelfReference for a multi-command body whose first segment calls its own name', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'weapnext',
        key: 'MWHEELUP',
        commands: [{ kind: 'raw', text: 'weapnext' }, { kind: 'raw', text: 'centerview' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const self = findings.find((finding) => finding.messageKey.endsWith('aliasSelfReference'))

    expect(self).toBeDefined()
    expect(self?.level).toBe('warning')
    expect(self?.subject).toEqual({ kind: 'action', id: 'weapnext' })
    expect(self?.params).toEqual({ entry: 'weapnext', name: 'weapnext', command: 'weapnext' })
  })

  it('reports aliasSelfReference when only a *later* segment calls its own name', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'centerview',
        key: 'MOUSE3',
        commands: [{ kind: 'raw', text: '+attack' }, { kind: 'raw', text: 'centerview' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const self = findings.find((finding) => finding.messageKey.endsWith('aliasSelfReference'))

    expect(self?.params).toEqual({ entry: 'centerview', name: 'centerview', command: 'centerview' })
  })

  /**
   * The single-command case is untouched by that decision: the whole body *is*
   * the colliding token, so the writer drops the line and mirrors the bind
   * straight to the command - nothing is lost, there is nothing to decide, and
   * `aliasShadowsCommand` already covers the unusable name.
   */
  it('does not report aliasSelfReference for a single-command body that is only its own name', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'weapnext',
        key: 'MWHEELUP',
        commands: [{ kind: 'raw', text: 'weapnext' }],
      }),
    ]

    expect(rulesOf(validateActions(actions, 'r1q2'))).toEqual(['aliasShadowsCommand'])
  })

  it('does not report aliasSelfReference for a sign-differing body segment (alias forward "+forward; centerview")', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Forward',
        key: 'w',
        commands: [{ kind: 'raw', text: '+forward' }, { kind: 'raw', text: 'centerview' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(findings.some((finding) => finding.messageKey.endsWith('aliasSelfReference'))).toBe(false)
  })

  it('produces no findings for a clean profile: a correctly referenced alias, no duplicates', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] }),
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Test binding',
        commands: [{ kind: 'raw', text: '+test' }],
      }),
    ]

    expect(validateActions(actions, 'r1q2')).toEqual([])
  })

  it('does not count a message entry whose text happens to contain an alias name as a reference', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] }),
      action({
        id: 'm1',
        kind: 'message',
        name: 'GG',
        commands: [{ kind: 'message', channel: 'say', text: '+test' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(rulesOf(findings)).toEqual(['aliasUnreferenced'])
  })

  it('excludes a catalogue-materialised bind from the undefined-alias check', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: '+forward',
        catalogId: 'movement:forward',
        commands: [{ kind: 'raw', text: '+forward' }],
      }),
    ]

    expect(validateActions(actions, 'r1q2')).toEqual([])
  })

  it('excludes a bare command with no sign from the undefined-alias check', () => {
    const actions = [
      action({ id: 'b1', kind: 'bind', name: 'Wait a bit', commands: [{ kind: 'raw', text: 'wait' }] }),
    ]

    expect(validateActions(actions, 'r1q2')).toEqual([])
  })

  it('ignores an argument-carrying command entirely, even if it starts with a sign', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Drop weapon',
        commands: [{ kind: 'raw', text: '-drop rocket launcher' }],
      }),
    ]

    expect(validateActions(actions, 'r1q2')).toEqual([])
  })

  it('review fix, Finding 2: does not flag an ordinary hand-typed +forward as an undefined alias', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Forward (hand-typed)',
        commands: [{ kind: 'raw', text: '+forward' }],
      }),
      action({
        id: 'b2',
        kind: 'bind',
        name: 'Release forward',
        commands: [{ kind: 'raw', text: '-forward' }],
      }),
    ]

    expect(validateActions(actions, 'r1q2')).toEqual([])
  })

  it('second review fix: does not flag a bind calling this profile\'s own hold-layer alias (+drops)', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Drop layer (hand-typed)',
        commands: [{ kind: 'raw', text: '+drops' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2', {
      layers: [{ id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'CTRL', overrides: { g: 'drop grenades' } }],
    })

    expect(findings).toEqual([])
  })

  it('second review fix: an undefined alias reference is reported as a warning, not an error', () => {
    const actions = [
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Test binding',
        commands: [{ kind: 'raw', text: '+test' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(findings).toHaveLength(1)
    expect(findings[0]!.level).toBe('warning')
  })

  it('review fix, Finding 3: an alias only referenced via profile.binds is not flagged as unreferenced', () => {
    const actions = [action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] })]

    const findings = validateActions(actions, 'r1q2', { binds: { r: '+test' } })

    expect(findings).toEqual([])
  })

  it('review fix, Finding 3: an alias only referenced via a layer override is not flagged as unreferenced', () => {
    const actions = [action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] })]

    const findings = validateActions(actions, 'r1q2', {
      layers: [{ id: 'l1', name: 'Alt', mode: 'hold', triggerKey: 'ALT', overrides: { r: '+test' } }],
    })

    expect(findings).toEqual([])
  })

  it('still reports an alias referenced by nothing at all, binds/layers included', () => {
    const actions = [action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] })]

    const findings = validateActions(actions, 'r1q2', {
      binds: { r: '+other' },
      layers: [{ id: 'l1', name: 'Alt', mode: 'hold', triggerKey: 'ALT', overrides: {} }],
    })

    expect(rulesOf(findings)).toEqual(['aliasUnreferenced'])
  })

  it('story 038: an alias referenced only via a bind <key> <alias> segment inside another action is not flagged as unreferenced', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] }),
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Rebind on the fly',
        commands: [{ kind: 'raw', text: 'bind r +test' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(rulesOf(findings)).toEqual([])
  })

  it('carries the engine passed in on every finding', () => {
    const actions = [action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] })]

    const findings = validateActions(actions, 'q2pro')

    expect(findings.every((finding) => finding.engine === 'q2pro')).toBe(true)
  })
})
