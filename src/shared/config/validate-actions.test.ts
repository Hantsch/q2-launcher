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
    // Sign-free name (story 045, D8 changed the fixture from '+test'): a lone signed alias with no
    // matching opposite half now also gets its own `pressWithoutRelease`/`releaseWithoutPress`
    // finding, which would be noise in a test about `aliasUnreferenced` specifically.
    const actions = [action({ id: 'a1', kind: 'alias', name: 'test', commands: [{ kind: 'raw', text: 'wait' }] })]

    const findings = validateActions(actions, 'r1q2')

    expect(rulesOf(findings)).toEqual(['aliasUnreferenced'])
    expect(findings[0].subject).toEqual({ kind: 'action', id: 'test' })
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
        keys: [{ key: 'MWHEELUP' }],
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
        keys: [{ key: 'MOUSE3' }],
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
        keys: [{ key: 'MWHEELUP' }],
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
        keys: [{ key: 'w' }],
        commands: [{ kind: 'raw', text: '+forward' }, { kind: 'raw', text: 'centerview' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(findings.some((finding) => finding.messageKey.endsWith('aliasSelfReference'))).toBe(false)
  })

  it('produces no findings for a clean profile: a correctly referenced alias, no duplicates', () => {
    // Sign-free name (story 045, D8): see the comment on 'reports an alias that nothing calls'.
    const actions = [
      action({ id: 'a1', kind: 'alias', name: 'test', commands: [{ kind: 'raw', text: 'wait' }] }),
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Test binding',
        commands: [{ kind: 'raw', text: 'test' }],
      }),
    ]

    expect(validateActions(actions, 'r1q2')).toEqual([])
  })

  it('does not count a message entry whose text happens to contain an alias name as a reference', () => {
    // Sign-free name (story 045, D8): see the comment on 'reports an alias that nothing calls'.
    const actions = [
      action({ id: 'a1', kind: 'alias', name: 'test', commands: [{ kind: 'raw', text: 'wait' }] }),
      action({
        id: 'm1',
        kind: 'message',
        name: 'GG',
        commands: [{ kind: 'message', channel: 'say', text: 'test' }],
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
    // Sign-free name (story 045, D8): see the comment on 'reports an alias that nothing calls'.
    const actions = [action({ id: 'a1', kind: 'alias', name: 'test', commands: [{ kind: 'raw', text: 'wait' }] })]

    const findings = validateActions(actions, 'r1q2', { binds: { r: 'test' } })

    expect(findings).toEqual([])
  })

  it('review fix, Finding 3: an alias only referenced via a layer override is not flagged as unreferenced', () => {
    // Sign-free name (story 045, D8): see the comment on 'reports an alias that nothing calls'.
    const actions = [action({ id: 'a1', kind: 'alias', name: 'test', commands: [{ kind: 'raw', text: 'wait' }] })]

    const findings = validateActions(actions, 'r1q2', {
      layers: [{ id: 'l1', name: 'Alt', mode: 'hold', triggerKey: 'ALT', overrides: { r: 'test' } }],
    })

    expect(findings).toEqual([])
  })

  it('still reports an alias referenced by nothing at all, binds/layers included', () => {
    // Sign-free name (story 045, D8): see the comment on 'reports an alias that nothing calls'.
    const actions = [action({ id: 'a1', kind: 'alias', name: 'test', commands: [{ kind: 'raw', text: 'wait' }] })]

    const findings = validateActions(actions, 'r1q2', {
      binds: { r: 'other' },
      layers: [{ id: 'l1', name: 'Alt', mode: 'hold', triggerKey: 'ALT', overrides: {} }],
    })

    expect(rulesOf(findings)).toEqual(['aliasUnreferenced'])
  })

  it('story 038: an alias referenced only via a bind <key> <alias> segment inside another action is not flagged as unreferenced', () => {
    // Sign-free name (story 045, D8): see the comment on 'reports an alias that nothing calls'.
    const actions = [
      action({ id: 'a1', kind: 'alias', name: 'test', commands: [{ kind: 'raw', text: 'wait' }] }),
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Rebind on the fly',
        commands: [{ kind: 'raw', text: 'bind r test' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(rulesOf(findings)).toEqual([])
  })

  // --- story 041 D4: the reference graph counts raw binds and alias bodies ----
  //
  // The three shapes an *imported* profile produces (`alias-import.ts`), all of
  // which the shared collector (`alias-references.ts#collectAliasReferences`)
  // has to see for the entry not to look dead: a raw bind pointing at an entry
  // by bare name, one entry's body calling another's, and a `;`-list bind value
  // calling two.

  it('story 041 D4: a raw bind pointing at an imported alias by bare name is neither undefined nor unreferenced', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'alias',
        name: 'drop_shotgun',
        aliasName: 'drop_shotgun',
        commands: [
          { kind: 'raw', text: 'drop shotgun' },
          { kind: 'message', channel: 'say_team', text: 'dropped my shotgun' },
        ],
      }),
    ]

    const findings = validateActions(actions, 'r1q2', { binds: { KP_END: 'drop_shotgun' } })

    expect(findings).toEqual([])
  })

  it('story 041 D4: an imported alias referenced only from another imported alias body is not flagged as unreferenced', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'alias',
        name: 'wait5',
        aliasName: 'wait5',
        commands: [
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: 'wait' },
        ],
      }),
      action({
        id: 'a2',
        kind: 'alias',
        name: 'wait20',
        aliasName: 'wait20',
        commands: [
          { kind: 'raw', text: 'wait5' },
          { kind: 'raw', text: 'wait5' },
          { kind: 'raw', text: 'wait5' },
          { kind: 'raw', text: 'wait5' },
        ],
      }),
    ]

    const findings = validateActions(actions, 'r1q2', { binds: { KP_INS: 'wait20' } })

    expect(findings).toEqual([])
  })

  it('story 041 D4: a `;`-list bind value counts as a reference to every alias it lists', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'alias',
        name: 'shotgun',
        aliasName: 'shotgun',
        commands: [{ kind: 'raw', text: 'use shotgun' }],
      }),
      action({
        id: 'a2',
        kind: 'alias',
        name: 'super_shotgun',
        aliasName: 'super_shotgun',
        commands: [{ kind: 'raw', text: 'use super shotgun' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2', { binds: { w: 'shotgun;super_shotgun' } })

    expect(findings).toEqual([])
  })

  // An imported `alias +teamsay "say_team go go go"` becomes a `kind: 'message'`
  // entry (`alias-import.ts#entryKindFor`: exactly one message command and
  // nothing else), and the writer emits an alias line for it exactly as it does
  // for a `kind: 'alias'` entry. So a hand-typed bind calling it is calling a
  // name this profile really defines - the "defined" set the undefined-alias
  // check consults has to know about it too, not only about `kind: 'alias'`.
  it('story 041 D4: a bind calling an imported kind:message entry by name is not an undefined alias', () => {
    const actions = [
      action({
        id: 'm1',
        kind: 'message',
        name: '+teamsay',
        aliasName: '+teamsay',
        commands: [{ kind: 'message', channel: 'say_team', text: 'go go go' }],
      }),
      action({
        id: 'b1',
        kind: 'bind',
        name: 'Team go',
        commands: [{ kind: 'raw', text: '+teamsay' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    // `undefinedAlias` - this test's actual subject - is still absent.
    //
    // `pressWithoutRelease` is new here and deliberate (story-045 review, finding 2): D8's half-
    // missing checks used to look at `kind: 'alias'` entries only, which meant they saw the unbound
    // orphan and missed every `+` half that is actually bound to a key - the normal case, and the
    // one the story's own Test Plan step 6 walks through. They now cover every entry whose body
    // lives in `commands`, and this profile's `+teamsay` with no `-teamsay` next to it is exactly
    // the shape AC7 asks to be reported.
    expect(rulesOf(findings)).toEqual(['pressWithoutRelease'])
  })

  // --- story 041 D4 fix: press/release pairing widens "referenced" ----------
  //
  // A `-x` release alias is never called by name in any config text - the
  // engine invokes it itself on key-up whenever the matching `+x` is bound.
  // `validate-actions.ts` recognises that shape itself (story 045 D10 folded
  // the retired `press-release.ts` pairing helper into it) instead of
  // reporting a permanent, unfixable `aliasUnreferenced` on the release half.

  it('story 041 D4 fix: a +slow/-slow pair where only +slow is bound is not flagged as unreferenced on either half', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'alias',
        name: '+slow',
        aliasName: '+slow',
        commands: [{ kind: 'raw', text: 'cl_run 0' }],
      }),
      action({
        id: 'a2',
        kind: 'alias',
        name: '-slow',
        aliasName: '-slow',
        commands: [{ kind: 'raw', text: 'cl_run 1' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2', { binds: { SHIFT: '+slow' } })

    expect(rulesOf(findings)).toEqual([])
  })

  it('story 041 D4 fix: a +x/-x pair where neither half is referenced by anything still reports aliasUnreferenced for both', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'alias',
        name: '+x',
        aliasName: '+x',
        commands: [{ kind: 'raw', text: 'wait' }],
      }),
      action({
        id: 'a2',
        kind: 'alias',
        name: '-x',
        aliasName: '-x',
        commands: [{ kind: 'raw', text: 'wait' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(rulesOf(findings)).toEqual(['aliasUnreferenced', 'aliasUnreferenced'])
    expect(findings.map((finding) => finding.params?.name)).toEqual(['+x', '-x'])
  })

  it('story 041 D4 fix: an unpaired lone -x with no matching +x action still reports aliasUnreferenced', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'alias',
        name: '-x',
        aliasName: '-x',
        commands: [{ kind: 'raw', text: 'wait' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    // Story 045, D8: a lone `-x` with no matching `+x` alias entry is exactly the
    // `releaseWithoutPress` shape too - both findings are expected now.
    expect(rulesOf(findings)).toEqual(['aliasUnreferenced', 'releaseWithoutPress'])
  })

  it('carries the engine passed in on every finding', () => {
    const actions = [action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] })]

    const findings = validateActions(actions, 'q2pro')

    expect(findings.every((finding) => finding.engine === 'q2pro')).toBe(true)
  })

  // --- story 045, D8: broken toggle/press-release shapes on the fallback alias entries -----------

  it('story 045 D8: a cross-wired toggle trio (both states reassign to the same name) yields exactly one toggleCrossWired finding', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: 'zoom', commands: [{ kind: 'raw', text: 'zoomin' }] }),
      action({
        id: 'a2',
        kind: 'alias',
        name: 'zoomin',
        commands: [{ kind: 'raw', text: 'zoom_fov' }, { kind: 'raw', text: 'alias zoom zoomout' }],
      }),
      // Cross-wired: zoomout should reassign back to zoomin, but reassigns to itself instead.
      action({
        id: 'a3',
        kind: 'alias',
        name: 'zoomout',
        commands: [{ kind: 'raw', text: 'norm_fov' }, { kind: 'raw', text: 'alias zoom zoomout' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const crossWired = findings.filter((finding) => finding.messageKey.endsWith('toggleCrossWired'))

    expect(crossWired).toHaveLength(1)
    expect(crossWired[0]!.level).toBe('warning')
    expect(crossWired[0]!.params).toEqual({ dispatch: 'zoom', first: 'zoomin', second: 'zoomout' })
  })

  // --- story-045 review round 2, finding 1: the shapes the walking check could not see -----------

  it('story 045 D8 (review round 2): both states reassigning to state 1 yields one toggleCrossWired', () => {
    // The story's Test Plan step 6 verbatim - "both toggle states reassign to `zoom_s1`". State 1
    // rewrites the dispatch to *itself*, which is where the old check's walk ended: it found
    // `second === first` and reported nothing at all.
    const actions = [
      action({ id: 'a1', kind: 'alias', name: 'zoom', commands: [{ kind: 'raw', text: 'zoom_s1' }] }),
      action({
        id: 'a2',
        kind: 'alias',
        name: 'zoom_s1',
        commands: [{ kind: 'raw', text: 'fov 30' }, { kind: 'raw', text: 'alias zoom zoom_s1' }],
      }),
      action({
        id: 'a3',
        kind: 'alias',
        name: 'zoom_s2',
        commands: [{ kind: 'raw', text: 'fov 90' }, { kind: 'raw', text: 'alias zoom zoom_s1' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const crossWired = findings.filter((finding) => finding.messageKey.endsWith('toggleCrossWired'))

    expect(crossWired).toHaveLength(1)
    expect(crossWired[0]!.params).toEqual({ dispatch: 'zoom', first: 'zoom_s1', second: 'zoom_s2' })
  })

  it('story 045 D8 (review round 2): a state 1 handing over to a state nothing defines is reported', () => {
    // Only two lines left of a trio. The missing name is what the finding names as the second
    // state, since that is what the file says is supposed to be there.
    const actions = [
      action({ id: 'a1', kind: 'alias', name: 'zoom', commands: [{ kind: 'raw', text: 'zoom_s1' }] }),
      action({
        id: 'a2',
        kind: 'alias',
        name: 'zoom_s1',
        commands: [{ kind: 'raw', text: 'fov 30' }, { kind: 'raw', text: 'alias zoom zoom_s2' }],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const crossWired = findings.filter((finding) => finding.messageKey.endsWith('toggleCrossWired'))

    expect(crossWired).toHaveLength(1)
    expect(crossWired[0]!.params).toEqual({ dispatch: 'zoom', first: 'zoom_s1', second: 'zoom_s2' })
  })

  it('story 045 D8 (review round 2): an alias that merely calls another alias is not a toggle claim', () => {
    // The symmetric check indexes every entry that rewrites *some* dispatch name; an ordinary
    // one-line alias calling another one rewrites nothing, so nothing here looks like a toggle and
    // no finding may appear. The guard against the widened index turning plain aliases into noise.
    const actions = [
      action({ id: 'a1', kind: 'alias', name: 'go', commands: [{ kind: 'raw', text: 'go_now' }] }),
      action({ id: 'a2', kind: 'alias', name: 'go_now', commands: [{ kind: 'raw', text: 'fov 30' }] }),
      action({ id: 'b1', kind: 'bind', name: 'Go key', commands: [{ kind: 'raw', text: 'go' }] }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(findings.some((finding) => finding.messageKey.endsWith('toggleCrossWired'))).toBe(false)
  })

  it('story 045 D8: a healthy hand-written toggle trio does not yield toggleCrossWired', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: 'zoom', commands: [{ kind: 'raw', text: 'zoomin' }] }),
      action({
        id: 'a2',
        kind: 'alias',
        name: 'zoomin',
        commands: [{ kind: 'raw', text: 'zoom_fov' }, { kind: 'raw', text: 'alias zoom zoomout' }],
      }),
      action({
        id: 'a3',
        kind: 'alias',
        name: 'zoomout',
        commands: [{ kind: 'raw', text: 'norm_fov' }, { kind: 'raw', text: 'alias zoom zoomin' }],
      }),
      action({ id: 'b1', kind: 'bind', name: 'Zoom key', commands: [{ kind: 'raw', text: 'zoom' }] }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(findings.some((finding) => finding.messageKey.endsWith('toggleCrossWired'))).toBe(false)
  })

  it('story 045 D8: a lone +x alias with no matching -x yields exactly one pressWithoutRelease finding', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: '+slow', commands: [{ kind: 'raw', text: 'cl_run 0' }] }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const rules = rulesOf(findings)

    expect(rules.filter((rule) => rule === 'pressWithoutRelease')).toHaveLength(1)
    const pressWithoutRelease = findings.find((finding) => finding.messageKey.endsWith('pressWithoutRelease'))
    expect(pressWithoutRelease!.params).toEqual({ entry: '+slow', name: '+slow' })
  })

  it('story 045 D8: a lone -x alias with no matching +x yields exactly one releaseWithoutPress finding', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: '-slow', commands: [{ kind: 'raw', text: 'cl_run 1' }] }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const rules = rulesOf(findings)

    expect(rules.filter((rule) => rule === 'releaseWithoutPress')).toHaveLength(1)
    const releaseWithoutPress = findings.find((finding) => finding.messageKey.endsWith('releaseWithoutPress'))
    expect(releaseWithoutPress!.params).toEqual({ entry: '-slow', name: '-slow' })
  })

  it('story 045 D8: a healthy +x/-x alias pair yields neither pressWithoutRelease nor releaseWithoutPress', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: '+slow', commands: [{ kind: 'raw', text: 'cl_run 0' }] }),
      action({ id: 'a2', kind: 'alias', name: '-slow', commands: [{ kind: 'raw', text: 'cl_run 1' }] }),
      action({ id: 'b1', kind: 'bind', name: 'Slow key', commands: [{ kind: 'raw', text: '+slow' }] }),
    ]

    const findings = validateActions(actions, 'r1q2')
    const rules = rulesOf(findings)

    expect(rules).not.toContain('pressWithoutRelease')
    expect(rules).not.toContain('releaseWithoutPress')
  })

  it('story 045 D8: a first-class kind:toggle entry never yields toggleCrossWired', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'toggle',
        name: 'Zoom',
        commands: [],
        keys: [{ key: 'v' }],
        parts: [
          { label: 'In', commands: [{ kind: 'raw', text: 'zoom_fov' }] },
          { label: 'Out', commands: [{ kind: 'raw', text: 'norm_fov' }] },
        ],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(rulesOf(findings)).toEqual([])
  })

  it('story 045 D8: a first-class kind:press-release entry never yields pressWithoutRelease/releaseWithoutPress', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'press-release',
        name: 'Slow',
        commands: [],
        keys: [{ key: 'SHIFT' }],
        parts: [
          { commands: [{ kind: 'raw', text: 'cl_run 0' }] },
          { commands: [{ kind: 'raw', text: 'cl_run 1' }] },
        ],
      }),
    ]

    const findings = validateActions(actions, 'r1q2')

    expect(rulesOf(findings)).toEqual([])
  })

  it('story 045 D8: a healthy first-class toggle\'s generated names (dispatch, _s1/_s2) never show up as undefinedAlias/aliasUnreferenced', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'toggle',
        name: 'Zoom',
        commands: [],
        keys: [{ key: 'v' }],
        parts: [
          { label: 'In', commands: [{ kind: 'raw', text: 'zoom_fov' }] },
          { label: 'Out', commands: [{ kind: 'raw', text: 'norm_fov' }] },
        ],
      }),
    ]

    const findings = validateActions(actions, 'r1q2', { binds: { v: 'zoom' } })

    expect(findings.some((finding) => finding.messageKey.endsWith('undefinedAlias'))).toBe(false)
    expect(findings.some((finding) => finding.messageKey.endsWith('aliasUnreferenced'))).toBe(false)
  })

  it('story 045 D8: a healthy first-class press-release entry\'s generated names (+base/-base) never show up as undefinedAlias/aliasUnreferenced', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'press-release',
        name: 'Slow',
        commands: [],
        keys: [{ key: 'SHIFT' }],
        parts: [
          { commands: [{ kind: 'raw', text: 'cl_run 0' }] },
          { commands: [{ kind: 'raw', text: 'cl_run 1' }] },
        ],
      }),
    ]

    const findings = validateActions(actions, 'r1q2', { binds: { SHIFT: '+slow' } })

    expect(findings.some((finding) => finding.messageKey.endsWith('undefinedAlias'))).toBe(false)
    expect(findings.some((finding) => finding.messageKey.endsWith('aliasUnreferenced'))).toBe(false)
  })

  // --- story-045 review, finding 3: the generated `_s1`/`_s2` and `-base` names occupy the alias
  // name space like any other definition, so a user alias landing on one of them is a collision the
  // file resolves by keeping exactly one definition - i.e. by losing the other entry's body. Care
  // used to group only the *primary* index row per action and therefore never saw it. ---------------

  it('story-045 review: a user alias colliding with a toggle\'s generated _s1 name is reported as aliasDuplicate', () => {
    const actions = [
      action({
        id: 't1',
        kind: 'toggle',
        name: 'Zoom',
        aliasName: 'zoom',
        commands: [],
        keys: [{ key: 'v' }],
        parts: [
          { label: 'In', commands: [{ kind: 'raw', text: 'fov 30' }] },
          { label: 'Out', commands: [{ kind: 'raw', text: 'fov 90' }] },
        ],
      }),
      // The user's own alias, named exactly what the toggle's first state renders under.
      action({
        id: 'a1',
        kind: 'alias',
        name: 'My zoom step',
        aliasName: 'zoom_s1',
        commands: [{ kind: 'raw', text: 'fov 60' }],
      }),
    ]

    const duplicates = validateActions(actions, 'r1q2').filter((finding) =>
      finding.messageKey.endsWith('aliasDuplicate'),
    )

    // Both sides of the collision, the way `aliasDuplicate` has always reported a collision.
    expect(duplicates).toHaveLength(2)
    expect(duplicates.map((finding) => finding.params?.['name'])).toEqual(['zoom_s1', 'zoom_s1'])
    expect(duplicates.map((finding) => finding.params?.['entry']).sort()).toEqual([
      'My zoom step',
      'Zoom',
    ])
  })

  it('story-045 review: a user alias colliding with a press/release entry\'s generated -base half is reported too', () => {
    const actions = [
      action({
        id: 'p1',
        kind: 'press-release',
        name: 'Slow',
        aliasName: 'slow',
        commands: [],
        keys: [{ key: 'SHIFT' }],
        parts: [
          { commands: [{ kind: 'raw', text: 'cl_run 0' }] },
          { commands: [{ kind: 'raw', text: 'cl_run 1' }] },
        ],
      }),
      action({
        id: 'a1',
        kind: 'alias',
        name: 'My slow off',
        aliasName: '-slow',
        commands: [{ kind: 'raw', text: 'cl_run 1' }],
      }),
    ]

    const duplicates = validateActions(actions, 'r1q2').filter((finding) =>
      finding.messageKey.endsWith('aliasDuplicate'),
    )

    expect(duplicates).toHaveLength(2)
    expect(duplicates.map((finding) => finding.params?.['name'])).toEqual(['-slow', '-slow'])
  })

  it('story-045 review: a healthy toggle and press/release entry side by side still collide with nothing', () => {
    const actions = [
      action({
        id: 't1',
        kind: 'toggle',
        name: 'Zoom',
        aliasName: 'zoom',
        commands: [],
        keys: [{ key: 'v' }],
        parts: [
          { label: 'In', commands: [{ kind: 'raw', text: 'fov 30' }] },
          { label: 'Out', commands: [{ kind: 'raw', text: 'fov 90' }] },
        ],
      }),
      action({
        id: 'p1',
        kind: 'press-release',
        name: 'Slow',
        aliasName: 'slow',
        commands: [],
        keys: [{ key: 'SHIFT' }],
        parts: [
          { commands: [{ kind: 'raw', text: 'cl_run 0' }] },
          { commands: [{ kind: 'raw', text: 'cl_run 1' }] },
        ],
      }),
    ]

    const findings = validateActions(actions, 'r1q2', { binds: { v: 'zoom', SHIFT: '+slow' } })

    expect(findings.some((finding) => finding.messageKey.endsWith('aliasDuplicate'))).toBe(false)
  })
})
