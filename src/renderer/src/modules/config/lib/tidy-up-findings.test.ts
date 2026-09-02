import { describe, expect, it } from 'vitest'
import { aliasNameFor } from '@shared/config/alias-render'
import type { AltLayer } from '@shared/config/alt-layers'
import { ALL_CVARS } from '@shared/config/cvar-catalog'
import { writeValueFor } from '@shared/config/cvar-defaults'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { analyzeTidyUp, type TidyUpFinding } from './tidy-up-findings'

/**
 * Story 025 D4's acceptance. The load-bearing half is the winner
 * determination: for every contested key, the claim that is *currently in
 * effect in the rendered file* must survive and every other claim must get a
 * `removeShadowedBind` op - getting it backwards deletes the working binding
 * and keeps the dead one, which looks correct in the UI and is silently wrong
 * in-game. So the conflict cases here pin the winner down from the stored
 * `binds`/`overrides` (what `render.ts`/`generateLayerAliases` emit), including
 * the two cases where "the last action in the array" and "the entry on the
 * normalized spelling" are both the wrong answer.
 */

const FIXED_AT = '2026-01-01T00:00:00.000Z'

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'a1',
    categoryId: 'movement',
    name: 'Action',
    kind: 'bind',
    commands: [{ kind: 'raw', text: 'weapnext' }],
    ...overrides,
  }
}

function layer(overrides: Partial<AltLayer> = {}): AltLayer {
  return { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: {}, ...overrides }
}

function ofKind(findings: TidyUpFinding[], kind: TidyUpFinding['kind']): TidyUpFinding[] {
  return findings.filter((finding) => finding.kind === kind)
}

describe('analyzeTidyUp - shadowed binds', () => {
  it('offers an op for the losing action only, never for the one the mirror left in effect', () => {
    const first = action({ id: 'a1', name: 'Old forward', key: 'w' })
    const second = action({ id: 'a2', name: 'Forward', key: 'w' })
    // What `applyActionBindMirror` leaves behind: array order, later wins.
    const result = analyzeTidyUp(
      profile({ actions: [first, second], binds: { w: aliasNameFor(second) } }),
    )

    const [finding, ...rest] = ofKind(result, 'shadowedBind')
    expect(rest).toEqual([])
    expect(finding!.mode).toBe('auto')
    expect(finding!.level).toBe('warning')
    expect(finding!.sourceFindingId).toBe('bindConflict:base:w')
    expect(finding!.params['winner']).toBe('Forward')
    expect(finding!.ops).toEqual([
      {
        kind: 'removeShadowedBind',
        scope: 'base',
        key: 'w',
        claim: { source: 'action', actionId: 'a1', slot: 'primary' },
      },
    ])
  })

  /**
   * The same two rows, but `binds` says the *first* one is what gets written.
   * Array order would name `a1` as the winner; the rendered file says `a2`'s
   * claim is the dead one. The file wins - that is the whole point of reading
   * the winner back out of `binds` instead of re-deriving it from `actions`.
   */
  it('follows the rendered binds entry, not the actions array order', () => {
    const first = action({ id: 'a1', name: 'Forward', key: 'w' })
    const second = action({ id: 'a2', name: 'Stale forward', key: 'w' })
    const result = analyzeTidyUp(
      profile({ actions: [first, second], binds: { w: aliasNameFor(first) } }),
    )

    const [finding] = ofKind(result, 'shadowedBind')
    expect(finding!.params['winner']).toBe('Forward')
    expect(finding!.ops).toEqual([
      {
        kind: 'removeShadowedBind',
        scope: 'base',
        key: 'w',
        claim: { source: 'action', actionId: 'a2', slot: 'primary' },
      },
    ])
  })

  /**
   * The import shape: one key, two spellings, both written verbatim
   * (`import-reader.ts` keeps key names as typed). `renderProfileFile` sorts
   * raw keys, so `mouse1` is emitted after `MOUSE1` and `weapnext` is what the
   * player actually gets - the *un*-normalized spelling wins here, which is
   * why the winner is never read off `binds[normalizeBindKey(key)]`.
   */
  it('picks the last-sorted binds entry when one key carries two spellings', () => {
    const result = analyzeTidyUp(profile({ binds: { MOUSE1: '+attack', mouse1: 'weapnext' } }))

    const [finding] = ofKind(result, 'shadowedBind')
    expect(finding!.params['winner']).toBe('weapnext')
    expect(finding!.ops).toEqual([
      {
        kind: 'removeShadowedBind',
        scope: 'base',
        key: 'MOUSE1',
        claim: { source: 'baseBind', command: '+attack' },
      },
    ])
  })

  /**
   * Two catalogue rows materialising the same continuous command both mirror as
   * that command verbatim (`bindValueFor`, story 034), so the stored
   * `+forward` names both claims at once. D3 strips mirror entries by value, so
   * removing "the loser" would take the survivor's own entry with it and leave
   * the key unbound - not inert, so nothing is offered.
   */
  it('reports without ops when the stored value names two action claims at once', () => {
    const first = action({
      id: 'a1',
      name: 'Forward',
      key: 'w',
      catalogId: 'movement.forward',
      commands: [{ kind: 'raw', text: '+forward' }],
    })
    const second = action({ ...first, id: 'a2', name: 'Forward again' })
    const result = analyzeTidyUp(
      profile({ actions: [first, second], binds: { w: '+forward' } }),
    )

    const [finding] = ofKind(result, 'shadowedBind')
    expect(finding!.mode).toBe('report')
    expect(finding!.ops).toEqual([])
    expect(finding!.messageKey).toBe('config.care.tidyUp.shadowedBindUnresolved')
  })

  it('reports without ops when nothing is stored for the contested key at all', () => {
    const first = action({ id: 'a1', name: 'One', key: 'w' })
    const second = action({ id: 'a2', name: 'Two', key: 'w' })
    const result = analyzeTidyUp(profile({ actions: [first, second], binds: {} }))

    const [finding] = ofKind(result, 'shadowedBind')
    expect(finding!.mode).toBe('report')
    expect(finding!.ops).toEqual([])
  })

  it('treats a base bind and a layer override on the same key as no conflict at all', () => {
    const result = analyzeTidyUp(
      profile({
        binds: { r: 'weapnext' },
        layers: [layer({ overrides: { r: 'drop rocket launcher' } })],
      }),
    )

    expect(result).toEqual([])
  })

  it('names the losing modifier slot inside the layer that carries the conflict', () => {
    const first = action({ id: 'a1', name: 'Old drop', key: 'r', keyModifier: 'ALT' })
    const second = action({ id: 'a2', name: 'Drop', key: 'r', keyModifier: 'ALT' })
    const result = analyzeTidyUp(
      profile({
        actions: [first, second],
        layers: [layer({ overrides: { r: aliasNameFor(second) } })],
      }),
    )

    const [finding] = ofKind(result, 'shadowedBind')
    expect(finding!.mode).toBe('auto')
    expect(finding!.sourceFindingId).toBe('bindConflict:l1:r')
    expect(finding!.ops).toEqual([
      {
        kind: 'removeShadowedBind',
        scope: { layerId: 'l1' },
        key: 'r',
        claim: { source: 'action', actionId: 'a1', slot: 'primary' },
      },
    ])
  })

  /**
   * A hand-made override sitting on the key an action's modifier slot also
   * claims: the override is the only thing in the layer's alias body, so the
   * action's alias is not reachable in that layer at all and *its* claim is the
   * dead one. Removing the override - the other way round - would delete the
   * only working binding.
   */
  it('keeps a hand-made override that is what the layer actually renders', () => {
    const claimant = action({ id: 'a1', name: 'Alt drop', key: '1', keyModifier: 'ALT' })
    const result = analyzeTidyUp(
      profile({ actions: [claimant], layers: [layer({ overrides: { '1': 'drop rl' } })] }),
    )

    const [finding] = ofKind(result, 'shadowedBind')
    expect(finding!.params['winner']).toBe('drop rl')
    expect(finding!.ops).toEqual([
      {
        kind: 'removeShadowedBind',
        scope: { layerId: 'l1' },
        key: '1',
        claim: { source: 'action', actionId: 'a1', slot: 'primary' },
      },
    ])
  })
})

describe('analyzeTidyUp - layers, aliases, preserved lines', () => {
  it('offers removeEmptyLayer for a layer whose overrides are all blank', () => {
    const result = analyzeTidyUp(
      profile({ layers: [layer({ id: 'l9', name: 'Spare', overrides: { '1': '   ' } })] }),
    )

    const [finding, ...rest] = ofKind(result, 'emptyLayer')
    expect(rest).toEqual([])
    expect(finding!.mode).toBe('auto')
    expect(finding!.params['name']).toBe('Spare')
    expect(finding!.sourceFindingId).toBe('layerEmpty:l9')
    expect(finding!.ops).toEqual([{ kind: 'removeEmptyLayer', layerId: 'l9' }])
  })

  it('offers removeUnreferencedAlias for an alias nothing calls', () => {
    const alias = action({
      id: 'x1',
      name: 'Sprint',
      kind: 'alias',
      commands: [{ kind: 'raw', text: '+forward' }],
    })
    const result = analyzeTidyUp(profile({ actions: [alias] }))

    const [finding, ...rest] = ofKind(result, 'unreferencedAlias')
    expect(rest).toEqual([])
    expect(finding!.mode).toBe('review')
    expect(finding!.params['name']).toBe(aliasNameFor(alias))
    expect(finding!.ops).toEqual([{ kind: 'removeUnreferencedAlias', actionId: 'x1' }])
  })

  it('offers no op for a bind calling an alias that does not exist', () => {
    const caller = action({ id: 'b1', name: 'Broken', commands: [{ kind: 'raw', text: '+test' }] })
    const result = analyzeTidyUp(profile({ actions: [caller] }))

    const [finding, ...rest] = ofKind(result, 'undefinedAlias')
    expect(rest).toEqual([])
    expect(finding!.mode).toBe('report')
    expect(finding!.level).toBe('warning')
    expect(finding!.ops).toEqual([])
  })

  it('offers drop and promote for a console-form cvar line the catalog knows', () => {
    const result = analyzeTidyUp(
      profile({ unrecognized: [{ file: 'config.cfg', line: 12, text: 'cl_run 1' }] }),
    )

    const [finding] = ofKind(result, 'preservedLine')
    expect(finding!.mode).toBe('review')
    expect(finding!.messageKey).toBe('config.care.tidyUp.preservedLineCvar')
    expect(finding!.sourceFindingId).toBe('preserved:config.cfg:12')
    expect(finding!.ops).toEqual([
      { kind: 'dropPreservedLine', file: 'config.cfg', line: 12, text: 'cl_run 1' },
      {
        kind: 'reclassifyPreservedLine',
        file: 'config.cfg',
        line: 12,
        text: 'cl_run 1',
        target: { field: 'cvars', name: 'cl_run', value: '1' },
      },
    ])
  })

  it('offers drop and promote for a bind line, on the key the profile stores', () => {
    const result = analyzeTidyUp(
      profile({ unrecognized: [{ file: 'config.cfg', line: 3, text: 'bind F5 "menu_options"' }] }),
    )

    const [finding] = ofKind(result, 'preservedLine')
    expect(finding!.messageKey).toBe('config.care.tidyUp.preservedLineBind')
    expect(finding!.ops[1]).toEqual({
      kind: 'reclassifyPreservedLine',
      file: 'config.cfg',
      line: 3,
      text: 'bind F5 "menu_options"',
      target: { field: 'binds', key: 'F5', command: 'menu_options' },
    })
  })

  it('offers only drop for a line it will not classify', () => {
    const result = analyzeTidyUp(
      profile({
        unrecognized: [
          { file: 'config.cfg', line: 1, text: '// my old config' },
          { file: 'config.cfg', line: 2, text: 'alias +test "+attack; wait"' },
          { file: 'config.cfg', line: 4, text: 'say hello' },
        ],
      }),
    )

    const findings = ofKind(result, 'preservedLine')
    expect(findings).toHaveLength(3)
    for (const finding of findings) {
      expect(finding.mode).toBe('review')
      expect(finding.messageKey).toBe('config.care.tidyUp.preservedLine')
      expect(finding.ops.map((op) => op.kind)).toEqual(['dropPreservedLine'])
    }
  })

  it('offers only drop when promoting would overwrite content the profile already has', () => {
    const result = analyzeTidyUp(
      profile({
        cvars: { cl_run: '0' },
        unrecognized: [{ file: 'config.cfg', line: 12, text: 'cl_run 1' }],
      }),
    )

    const [finding] = ofKind(result, 'preservedLine')
    expect(finding!.ops.map((op) => op.kind)).toEqual(['dropPreservedLine'])
  })
})

describe('analyzeTidyUp - the auto set', () => {
  /**
   * Decision 11's whole basis for `'auto'` is that applying the op cannot
   * change what the engine does, and only two kinds can ever prove that. This
   * pins that down across a profile carrying one of everything, so a later
   * source added to this analyzer cannot quietly become automatic.
   */
  it('contains exactly the shadowed-bind and empty-layer findings', () => {
    const first = action({ id: 'a1', name: 'Old forward', key: 'w' })
    const second = action({ id: 'a2', name: 'Forward', key: 'w' })
    const alias = action({
      id: 'x1',
      name: 'Sprint',
      kind: 'alias',
      commands: [{ kind: 'raw', text: '+forward' }],
    })
    const caller = action({ id: 'b1', name: 'Broken', commands: [{ kind: 'raw', text: '+test' }] })

    const result = analyzeTidyUp(
      profile({
        actions: [first, second, alias, caller],
        binds: { w: aliasNameFor(second) },
        layers: [layer({ id: 'l9', name: 'Spare', overrides: {} })],
        unrecognized: [{ file: 'config.cfg', line: 12, text: 'cl_run 1' }],
      }),
    )

    expect(result.filter((finding) => finding.mode === 'auto').map((finding) => finding.kind)).toEqual([
      'shadowedBind',
      'emptyLayer',
    ])
    // Every automatic row carries a fix; an `auto` row with no op would be a
    // button that does nothing.
    for (const finding of result) {
      if (finding.mode === 'auto') expect(finding.ops.length).toBeGreaterThan(0)
    }
    // Ids are unique and deterministic - the UI keys rows on them.
    expect(new Set(result.map((finding) => finding.id)).size).toBe(result.length)
    expect(analyzeTidyUp(profile()).length).toBe(0)
  })
})

describe('story 048 D4 - a default-filled profile offers no new tidy-up clutter', () => {
  it('analyzeTidyUp never reads profile.cvars, so the ~30 always-written default lines are never findings', () => {
    // What D2's writer puts in `cvars` for every catalogue entry when nothing overrides the default
    // (`writeValueFor(def, undefined)` is `def.default`) - the exact shape a default-filled file
    // round-trips as, before D3's `stripCatalogDefaults` even runs.
    const allDefaultsWritten = Object.fromEntries(
      ALL_CVARS.map((def) => [def.name, writeValueFor(def, undefined)]),
    )

    const bare = profile({
      actions: [action()],
      binds: { w: aliasNameFor(action()) },
      layers: [layer()],
      unrecognized: [{ file: 'config.cfg', line: 3, text: 'cl_run 1' }],
    })
    const withDefaults = profile({ ...bare, cvars: allDefaultsWritten })

    // Same findings whether `cvars` is empty or stuffed with every catalogue default: the tidy-up
    // analyzer has no cvar-clutter rule at all (its four sources are shadowed binds, empty layers,
    // alias wiring and preserved lines), so a bigger, default-filled cvar block cannot become a
    // fresh "clean this up" suggestion.
    expect(analyzeTidyUp(withDefaults)).toEqual(analyzeTidyUp(bare))
  })
})
