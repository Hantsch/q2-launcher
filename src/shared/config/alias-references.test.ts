import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '../modules/config'
import { aliasNameFor } from './alias-render'
import { actionsWithAliasLine, collectAliasReferences } from './alias-references'

function action(overrides: Partial<ConfigAction> & Pick<ConfigAction, 'id' | 'kind' | 'name'>): ConfigAction {
  return { categoryId: 'c1', commands: [], ...overrides }
}

/** A continuous catalogue row (story 034): mirrors as its own bare command, not an alias. */
function catalogueRow(overrides: Partial<ConfigAction> & Pick<ConfigAction, 'id' | 'name'>): ConfigAction {
  return action({
    kind: 'bind',
    catalogId: 'movement:forward',
    commands: [{ kind: 'raw', text: '+forward' }],
    ...overrides,
  })
}

describe('collectAliasReferences', () => {
  it('collects a bare token from an action raw command', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] }),
      action({ id: 'b1', kind: 'bind', name: 'Test bind', commands: [{ kind: 'raw', text: '+test' }] }),
    ]

    expect(collectAliasReferences({ actions })).toContain('+test')
  })

  it('collects a bare token from a binds value', () => {
    const actions: ConfigAction[] = []

    expect(collectAliasReferences({ actions, binds: { r: '+test' } })).toContain('+test')
  })

  it('collects a bare token from every layer overrides value', () => {
    const actions: ConfigAction[] = []
    const layers = [{ id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { r: '+test' } }]

    expect(collectAliasReferences({ actions, layers })).toContain('+test')
  })

  it('widens by the target token of a bind <key> <token> segment', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'alias',
        name: 'cali',
        commands: [{ kind: 'raw', text: 'bind KP_END drop_shotgun' }],
      }),
    ]

    expect(collectAliasReferences({ actions })).toContain('drop_shotgun')
  })

  it('lower-cases every collected token', () => {
    const actions = [action({ id: 'b1', kind: 'bind', name: 'Test bind', commands: [{ kind: 'raw', text: '+TEST' }] })]

    expect(collectAliasReferences({ actions })).toContain('+test')
  })

  it('does not treat a multi-word, non-bind segment as a reference', () => {
    const actions = [
      action({ id: 'b1', kind: 'bind', name: 'Drop weapon', commands: [{ kind: 'raw', text: '-drop rocket launcher' }] }),
    ]

    const tokens = collectAliasReferences({ actions })

    expect(tokens.has('rocket')).toBe(false)
    expect(tokens.has('launcher')).toBe(false)
    expect(tokens.has('-drop rocket launcher')).toBe(false)
  })

  it('collects a quote-wrapped binds value as its unquoted token (sanitized before scan, matching render)', () => {
    const actions: ConfigAction[] = []

    expect(collectAliasReferences({ actions, binds: { r: '"q2l_a_x_1234"' } })).toContain('q2l_a_x_1234')
  })

  it('collects a quote-wrapped layer overrides value as its unquoted token (sanitized before scan, matching render)', () => {
    const actions: ConfigAction[] = []
    const layers = [
      { id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { r: '"q2l_a_x_1234"' } },
    ]

    expect(collectAliasReferences({ actions, layers })).toContain('q2l_a_x_1234')
  })

  it('does not widen a bind segment whose target itself carries an argument', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'alias',
        name: 'weird',
        commands: [{ kind: 'raw', text: 'bind KP_END drop shotgun' }],
      }),
    ]

    expect(collectAliasReferences({ actions }).has('shotgun')).toBe(false)
  })
})

describe('actionsWithAliasLine', () => {
  it('drops a catalogue row whose mirror bypasses the alias and whose alias name is referenced by nothing', () => {
    const actions = [catalogueRow({ id: 'b1', name: '+forward' })]

    const kept = actionsWithAliasLine(actions, { actions })

    expect(kept).toEqual([])
  })

  it('keeps a catalogue row whose alias name is referenced elsewhere in the profile', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const caller = action({
      id: 'c1',
      kind: 'bind',
      name: 'Caller',
      commands: [{ kind: 'raw', text: aliasName }],
    })
    const actions = [row, caller]

    const kept = actionsWithAliasLine(actions, { actions })

    expect(kept).toContainEqual(row)
  })

  it('keeps a catalogue row referenced via a base bind value', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const actions = [row]

    const kept = actionsWithAliasLine(actions, { actions, binds: { z: aliasName } })

    expect(kept).toContainEqual(row)
  })

  it('keeps a catalogue row referenced via a layer override', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const actions = [row]
    const layers = [{ id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { z: aliasName } }]

    const kept = actionsWithAliasLine(actions, { actions, layers })

    expect(kept).toContainEqual(row)
  })

  it('keeps a catalogue row referenced via a quote-wrapped base bind value (schema allows it; render would strip the quotes)', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const actions = [row]

    const kept = actionsWithAliasLine(actions, { actions, binds: { z: `"${aliasName}"` } })

    expect(kept).toContainEqual(row)
  })

  it('keeps a catalogue row referenced via a quote-wrapped layer override value (schema allows it; render would strip the quotes)', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const actions = [row]
    const layers = [
      { id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { z: `"${aliasName}"` } },
    ]

    const kept = actionsWithAliasLine(actions, { actions, layers })

    expect(kept).toContainEqual(row)
  })

  it('keeps a catalogue row referenced only via a bind <key> <alias> segment', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const caller = action({
      id: 'c1',
      kind: 'bind',
      name: 'Caller',
      commands: [{ kind: 'raw', text: `bind KP_END ${aliasName}` }],
    })
    const actions = [row, caller]

    const kept = actionsWithAliasLine(actions, { actions })

    expect(kept).toContainEqual(row)
  })

  it('keeps a kind: alias entry even when nothing references it', () => {
    const aliasEntry = action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] })
    const actions = [aliasEntry]

    const kept = actionsWithAliasLine(actions, { actions })

    expect(kept).toEqual([aliasEntry])
  })

  it('keeps a keyless, unreferenced free-form bind action (User decision: user-authored content)', () => {
    const freeform = action({
      id: 'f1',
      kind: 'bind',
      name: 'My combo',
      commands: [{ kind: 'raw', text: 'wait; +attack' }],
    })
    const actions = [freeform]

    const kept = actionsWithAliasLine(actions, { actions })

    expect(kept).toEqual([freeform])
  })

})

describe('self-reference (no self-exclusion)', () => {
  it('counts a recursive body - an action whose own command text is its own alias name - as a reference', () => {
    const recursive = action({
      id: 'a1',
      kind: 'alias',
      name: '+test',
      commands: [{ kind: 'raw', text: '+test' }],
    })

    const tokens = collectAliasReferences({ actions: [recursive] })

    expect(tokens.has(aliasNameFor(recursive).toLowerCase())).toBe(true)
  })
})
