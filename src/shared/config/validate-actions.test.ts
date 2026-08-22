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

  it('reports two alias entries whose emitted names collide', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: 'Test', commands: [{ kind: 'raw', text: 'wait' }] }),
      action({ id: 'a2', kind: 'alias', name: 'test', commands: [{ kind: 'raw', text: 'wait' }] }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(rulesOf(findings).filter((rule) => rule === 'aliasDuplicate')).toHaveLength(2)
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
