import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigCommand } from '@shared/modules/config'
import { renderActionAlias, twoPartAliasNames } from '@shared/config/alias-render'
import { MAX_WAIT_FRAMES } from '@shared/config/engine-limits'
import {
  MAX_WAIT_RESOLVE_DEPTH,
  recognizeEntryIdioms,
  type AliasLike,
} from '@shared/config/entry-idioms'

/**
 * Story 045, D5. Every case is a hand-built list of alias definitions, because
 * that is exactly what the recogniser sees: a foreign config's folded `alias`
 * lines (story 041) or the launcher's own file read back (story 042), with no
 * tag left to lean on after story 050.
 *
 * The rejection cases matter more than the happy ones - a missed recognition
 * costs a nicer UI row, a loose one silently retypes a user's aliases - so each
 * one asserts both "nothing was recognised" *and* "every name came back in the
 * fallback list".
 */

function defs(...pairs: [name: string, body: string][]): AliasLike[] {
  return pairs.map(([name, body]) => ({ name, body }))
}

/** The story's own toggle example, verbatim. */
const ZOOM_TRIO = defs(
  ['zoomin', 'zoom_fov;zoom_sens;alias zoom zoomout'],
  ['zoomout', 'norm_fov;norm_sens;alias zoom zoomin'],
  ['zoom', 'zoomin'],
)

/** The story's own press/release example, verbatim. */
const SLOW_PAIR = defs(
  ['+slow', 'cl_forwardspeed 110; cl_sidespeed 110'],
  ['-slow', 'cl_forwardspeed 200; cl_sidespeed 200'],
)

function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'ab12cd34-0000-0000-0000-000000000000',
    categoryId: 'weapons',
    name: 'Zoom',
    kind: 'bind',
    commands: [],
    ...overrides,
  }
}

function raw(...texts: string[]): ConfigCommand[] {
  return texts.map((text) => ({ kind: 'raw', text }))
}

/** `renderActionAlias`'s generated family as the recogniser's input. */
function renderedDefinitions(subject: ConfigAction): AliasLike[] {
  return renderActionAlias(subject).aliases.map(({ name, body }) => ({ name, body }))
}

const CHUNK_SUFFIX = /^(.*)_p(\d+)$/

/**
 * `profile-restore.ts#commandsFromAliases`'s `_p<n>` fold, restated: a chunk
 * family collapses onto the parent that calls it, the chunk bodies concatenated
 * in `_p<n>` order and the parent's own (chunk-name) body dropped. The
 * recogniser's documented precondition - see its file comment.
 */
function foldChunks(aliases: readonly AliasLike[]): AliasLike[] {
  const names = new Set(aliases.map((alias) => alias.name))
  const chunks = new Map<string, { index: number; body: string }[]>()
  const parents: AliasLike[] = []

  for (const alias of aliases) {
    const match = CHUNK_SUFFIX.exec(alias.name)
    if (match && names.has(match[1]!)) {
      const family = chunks.get(match[1]!) ?? []
      family.push({ index: Number(match[2]), body: alias.body })
      chunks.set(match[1]!, family)
    } else parents.push(alias)
  }

  return parents.map((parent) => {
    const family = chunks.get(parent.name)
    if (!family) return parent
    const body = family
      .sort((a, b) => a.index - b.index)
      .map((chunk) => chunk.body)
      .join('; ')
    return { name: parent.name, body }
  })
}

describe('recognizeEntryIdioms - toggle trio', () => {
  it("recognises the story's zoom/zoomin/zoomout trio", () => {
    const result = recognizeEntryIdioms(ZOOM_TRIO)

    expect(result.toggles).toHaveLength(1)
    const [toggle] = result.toggles
    expect(toggle).toEqual({
      kind: 'toggle',
      dispatchName: 'zoom',
      states: [
        { name: 'zoomin', segments: ['zoom_fov', 'zoom_sens'] },
        { name: 'zoomout', segments: ['norm_fov', 'norm_sens'] },
      ],
      consumedNames: ['zoom', 'zoomin', 'zoomout'],
    })
    expect(result.unmatchedNames).toEqual([])
    expect(result.pressReleases).toEqual([])
    expect(result.waitAliases).toEqual([])
  })

  it('state 1 is the state the dispatch names, whatever the definition order', () => {
    const reordered = [ZOOM_TRIO[2]!, ZOOM_TRIO[1]!, ZOOM_TRIO[0]!]
    const swapped = [...defs(['zoom', 'zoomout']), ...ZOOM_TRIO.slice(0, 2)]

    expect(recognizeEntryIdioms(reordered).toggles[0]?.states.map((s) => s.name)).toEqual([
      'zoomin',
      'zoomout',
    ])
    expect(recognizeEntryIdioms(swapped).toggles[0]?.states.map((s) => s.name)).toEqual([
      'zoomout',
      'zoomin',
    ])
  })

  it('matches names case-insensitively and returns them verbatim', () => {
    const result = recognizeEntryIdioms(
      defs(
        ['ZoomIn', 'zoom_fov;alias ZOOM zoomout'],
        ['zoomout', 'norm_fov;alias Zoom zoomin'],
        ['zoom', 'ZOOMIN'],
      ),
    )

    expect(result.toggles[0]?.dispatchName).toBe('zoom')
    expect(result.toggles[0]?.states.map((state) => state.name)).toEqual(['ZoomIn', 'zoomout'])
  })

  it('keeps unrelated definitions in the fallback list, in input order', () => {
    const result = recognizeEntryIdioms([
      ...defs(['drop_rl', 'drop rl'], ['hi', 'say hello']),
      ...ZOOM_TRIO,
    ])

    expect(result.toggles).toHaveLength(1)
    expect(result.unmatchedNames).toEqual(['drop_rl', 'hi'])
  })

  it('accepts a state whose only content is the dispatch rewrite', () => {
    const result = recognizeEntryIdioms(
      defs(['on', 'cl_x 1;alias t off'], ['off', 'alias t on'], ['t', 'on']),
    )

    expect(result.toggles[0]?.states).toEqual([
      { name: 'on', segments: ['cl_x 1'] },
      { name: 'off', segments: [] },
    ])
  })

  it('leaves plain alias-calls-alias forwarding alone', () => {
    const result = recognizeEntryIdioms(defs(['lol', 'lol1'], ['lol1', 'say ha']))

    expect(result.toggles).toEqual([])
    expect(result.unmatchedNames).toEqual(['lol', 'lol1'])
  })
})

describe('recognizeEntryIdioms - toggle rejections (all-or-nothing)', () => {
  it('rejects a cross-wired trio where both states reassign to the same state', () => {
    const result = recognizeEntryIdioms(
      defs(
        ['zoomin', 'zoom_fov;alias zoom zoomout'],
        ['zoomout', 'norm_fov;alias zoom zoomout'],
        ['zoom', 'zoomin'],
      ),
    )

    expect(result.toggles).toEqual([])
    expect(result.unmatchedNames).toEqual(['zoomin', 'zoomout', 'zoom'])
  })

  it('rejects a dispatch body with an extra segment', () => {
    const result = recognizeEntryIdioms([
      ...ZOOM_TRIO.slice(0, 2),
      ...defs(['zoom', 'zoomin; something_else']),
    ])

    expect(result.toggles).toEqual([])
    expect(result.unmatchedNames).toEqual(['zoomin', 'zoomout', 'zoom'])
  })

  it('rejects a dispatch body that carries an argument', () => {
    const result = recognizeEntryIdioms([...ZOOM_TRIO.slice(0, 2), ...defs(['zoom', 'zoomin 1'])])

    expect(result.toggles).toEqual([])
    expect(result.unmatchedNames).toContain('zoom')
  })

  it('rejects a third-state chain', () => {
    const result = recognizeEntryIdioms(
      defs(
        ['zoomin', 'zoom_fov;alias zoom zoomout'],
        ['zoomout', 'norm_fov;alias zoom zoomsuper'],
        ['zoomsuper', 'super_fov;alias zoom zoomin'],
        ['zoom', 'zoomin'],
      ),
    )

    expect(result.toggles).toEqual([])
    expect(result.unmatchedNames).toEqual(['zoomin', 'zoomout', 'zoomsuper', 'zoom'])
  })

  it('rejects a state whose rewrite is not the last segment', () => {
    const result = recognizeEntryIdioms(
      defs(
        ['zoomin', 'zoom_fov;alias zoom zoomout;zoom_sens'],
        ['zoomout', 'norm_fov;alias zoom zoomin'],
        ['zoom', 'zoomin'],
      ),
    )

    expect(result.toggles).toEqual([])
    expect(result.unmatchedNames).toEqual(['zoomin', 'zoomout', 'zoom'])
  })

  it('rejects a rewrite with junk after the state name', () => {
    const result = recognizeEntryIdioms(
      defs(
        ['zoomin', 'zoom_fov;alias zoom zoomout extra'],
        ['zoomout', 'norm_fov;alias zoom zoomin'],
        ['zoom', 'zoomin'],
      ),
    )

    expect(result.toggles).toEqual([])
  })

  it('rejects a trio with a bind segment hiding in a state body (AC8 stays out of scope)', () => {
    const result = recognizeEntryIdioms(
      defs(
        ['zoomin', 'zoom_fov;bind KP_END fuck;alias zoom zoomout'],
        ['zoomout', 'norm_fov;alias zoom zoomin'],
        ['zoom', 'zoomin'],
      ),
    )

    expect(result.toggles).toEqual([])
    expect(result.unmatchedNames).toEqual(['zoomin', 'zoomout', 'zoom'])
  })

  it('rejects a trio whose dispatch names a definition that does not exist', () => {
    const result = recognizeEntryIdioms([...ZOOM_TRIO.slice(1)])

    expect(result.toggles).toEqual([])
    expect(result.unmatchedNames).toEqual(['zoomout', 'zoom'])
  })

  it('rejects a trio when a state name is carried by two definitions at once', () => {
    const result = recognizeEntryIdioms([...ZOOM_TRIO, ...defs(['ZOOMIN', 'say hijacked'])])

    expect(result.toggles).toEqual([])
    expect(result.unmatchedNames).toEqual(['zoomin', 'zoomout', 'zoom', 'ZOOMIN'])
  })
})

describe('recognizeEntryIdioms - press/release pair', () => {
  it("recognises the story's +slow/-slow pair", () => {
    const result = recognizeEntryIdioms(SLOW_PAIR)

    expect(result.pressReleases).toEqual([
      {
        kind: 'press-release',
        baseName: 'slow',
        press: { name: '+slow', segments: ['cl_forwardspeed 110', 'cl_sidespeed 110'] },
        release: { name: '-slow', segments: ['cl_forwardspeed 200', 'cl_sidespeed 200'] },
        consumedNames: ['+slow', '-slow'],
      },
    ])
    expect(result.unmatchedNames).toEqual([])
  })

  it('pairs the halves case-insensitively and keeps the + half casing for the base name', () => {
    const result = recognizeEntryIdioms(
      defs(['+Slow', 'cl_forwardspeed 110'], ['-SLOW', 'cl_forwardspeed 200']),
    )

    expect(result.pressReleases[0]?.baseName).toBe('Slow')
    expect(result.pressReleases[0]?.consumedNames).toEqual(['+Slow', '-SLOW'])
  })

  it('does not recognise a lone +x', () => {
    const result = recognizeEntryIdioms(defs(['+slow', 'cl_forwardspeed 110'], ['-fast', 'x']))

    expect(result.pressReleases).toEqual([])
    expect(result.unmatchedNames).toEqual(['+slow', '-fast'])
  })

  it('does not recognise a lone -x', () => {
    const result = recognizeEntryIdioms(defs(['-slow', 'cl_forwardspeed 200']))

    expect(result.pressReleases).toEqual([])
    expect(result.unmatchedNames).toEqual(['-slow'])
  })

  it('rejects a pair with a bind segment in either half', () => {
    const press = recognizeEntryIdioms(
      defs(['+slow', 'bind SHIFT +slow;cl_forwardspeed 110'], ['-slow', 'cl_forwardspeed 200']),
    )
    const release = recognizeEntryIdioms(
      defs(['+slow', 'cl_forwardspeed 110'], ['-slow', 'cl_forwardspeed 200;bind SHIFT +slow']),
    )

    expect(press.pressReleases).toEqual([])
    expect(press.unmatchedNames).toEqual(['+slow', '-slow'])
    expect(release.pressReleases).toEqual([])
    expect(release.unmatchedNames).toEqual(['+slow', '-slow'])
  })
})

describe('recognizeEntryIdioms - one idiom per definition', () => {
  it('claims nothing when a pair is also wired as a toggle (ambiguous, so no guess)', () => {
    const result = recognizeEntryIdioms(
      defs(
        ['+x', 'cl_x 1;alias hold -x'],
        ['-x', 'cl_x 0;alias hold +x'],
        ['hold', '+x'],
      ),
    )

    expect(result.toggles).toEqual([])
    expect(result.pressReleases).toEqual([])
    expect(result.consumedNames).toEqual([])
    expect(result.unmatchedNames).toEqual(['+x', '-x', 'hold'])
  })

  it('a wait-shaped half yields to the pair rather than cancelling it', () => {
    const result = recognizeEntryIdioms(
      defs(['+nuke', 'wait;wait;wait'], ['-nuke', 'wait;wait']),
    )

    expect(result.pressReleases).toHaveLength(1)
    expect(result.waitAliases).toEqual([])
    expect(result.unmatchedNames).toEqual([])
  })

  it('a toggle state is not also reported as a wait alias', () => {
    const result = recognizeEntryIdioms(
      defs(['on', 'wait;alias t off'], ['off', 'wait;alias t on'], ['t', 'on']),
    )

    expect(result.toggles).toHaveLength(1)
    expect(result.waitAliases).toEqual([])
  })
})

describe('recognizeEntryIdioms - waitN family', () => {
  it('resolves a literal wait5', () => {
    const result = recognizeEntryIdioms(defs(['wait5', 'wait; wait; wait; wait; wait']))

    expect(result.waitAliases).toEqual([
      { kind: 'wait', name: 'wait5', frames: 5, consumedNames: ['wait5'] },
    ])
    expect(result.unmatchedNames).toEqual([])
  })

  it('resolves wait20 through wait5 and keeps wait5 recognised on its own', () => {
    const result = recognizeEntryIdioms(
      defs(['wait5', 'wait;wait;wait;wait;wait'], ['wait20', 'wait5;wait5;wait5;wait5']),
    )

    expect(result.waitAliases).toEqual([
      { kind: 'wait', name: 'wait5', frames: 5, consumedNames: ['wait5'] },
      { kind: 'wait', name: 'wait20', frames: 20, consumedNames: ['wait20'] },
    ])
  })

  it('mixes literal waits and references', () => {
    const result = recognizeEntryIdioms(
      defs(['wait5', 'wait;wait;wait;wait;wait'], ['wait7', 'wait;wait5;wait']),
    )

    expect(result.waitAliases.map((entry) => entry.frames)).toEqual([5, 7])
  })

  it('is not a wait alias when any other segment is present', () => {
    const result = recognizeEntryIdioms(
      defs(['jump', 'wait;+moveup;wait'], ['nearly', 'wait;wait extra'], ['empty', '']),
    )

    expect(result.waitAliases).toEqual([])
    expect(result.unmatchedNames).toEqual(['jump', 'nearly', 'empty'])
  })

  it('does not resolve Wait or wait5 as literal frames', () => {
    const result = recognizeEntryIdioms(defs(['upper', 'Wait;Wait']))

    expect(result.waitAliases).toEqual([])
  })

  it('does not hang on a cycle and resolves nothing in it', () => {
    const result = recognizeEntryIdioms(
      defs(['loopA', 'loopB'], ['loopB', 'loopA'], ['selfish', 'selfish'], ['wait2', 'wait;wait']),
    )

    expect(result.waitAliases.map((entry) => entry.name)).toEqual(['wait2'])
    expect(result.unmatchedNames).toEqual(['loopA', 'loopB', 'selfish'])
  })

  it('does not resolve past MAX_WAIT_FRAMES, while its members still do', () => {
    const result = recognizeEntryIdioms(
      defs(
        ['wait5', 'wait;wait;wait;wait;wait'],
        ['wait50', 'wait5;wait5;wait5;wait5;wait5;wait5;wait5;wait5;wait5;wait5'],
        ['wait55', 'wait50;wait5'],
      ),
    )

    expect(MAX_WAIT_FRAMES).toBe(50)
    expect(result.waitAliases.map((entry) => [entry.name, entry.frames])).toEqual([
      ['wait5', 5],
      ['wait50', 50],
    ])
    expect(result.unmatchedNames).toEqual(['wait55'])
  })

  it('stops at the depth cap without poisoning the shallower chain members', () => {
    // Deepest root FIRST, so a depth bail is guaranteed to happen before the
    // shorter chains are resolved: a depth failure is the one verdict that
    // depends on where the walk started, so it must never be memoized.
    const chain: [string, string][] = [['w10', 'w9']]
    for (let level = 9; level >= 2; level--) chain.push([`w${level}`, `w${level - 1}`])
    chain.push(['w1', 'wait'])

    const result = recognizeEntryIdioms(defs(...chain))

    expect(MAX_WAIT_RESOLVE_DEPTH).toBe(8)
    expect(result.unmatchedNames).toEqual(['w10'])
    expect(result.waitAliases.map((entry) => entry.name)).toEqual([
      'w9',
      'w8',
      'w7',
      'w6',
      'w5',
      'w4',
      'w3',
      'w2',
      'w1',
    ])
    expect(result.waitAliases.every((entry) => entry.frames === 1)).toBe(true)
  })
})

describe("recognizeEntryIdioms - the launcher's own D3 output", () => {
  const toggle = action({
    kind: 'toggle',
    aliasName: 'zoom',
    parts: [
      { commands: raw('zoom_fov', 'zoom_sens'), label: 'In' },
      { commands: raw('norm_fov', 'norm_sens'), label: 'Out' },
    ],
  })

  it('round-trips a rendered toggle back into the same shape', () => {
    const names = twoPartAliasNames(toggle)
    const result = recognizeEntryIdioms(renderedDefinitions(toggle))

    expect(names).toEqual({ first: 'zoom_s1', second: 'zoom_s2' })
    expect(result.toggles).toEqual([
      {
        kind: 'toggle',
        dispatchName: 'zoom',
        states: [
          { name: 'zoom_s1', segments: ['zoom_fov', 'zoom_sens'] },
          { name: 'zoom_s2', segments: ['norm_fov', 'norm_sens'] },
        ],
        consumedNames: ['zoom', 'zoom_s1', 'zoom_s2'],
      },
    ])
    expect(result.unmatchedNames).toEqual([])
  })

  it('round-trips a rendered toggle whose states keep imported names', () => {
    const imported = action({
      kind: 'toggle',
      aliasName: 'zoom',
      parts: [
        { commands: raw('zoom_fov'), aliasName: 'zoomin' },
        { commands: raw('norm_fov'), aliasName: 'zoomout' },
      ],
    })

    const result = recognizeEntryIdioms(renderedDefinitions(imported))

    expect(result.toggles[0]?.states.map((state) => state.name)).toEqual(['zoomin', 'zoomout'])
  })

  it('round-trips a rendered press/release pair', () => {
    const pair = action({
      kind: 'press-release',
      aliasName: 'slow',
      parts: [
        { commands: raw('cl_forwardspeed 110', 'cl_sidespeed 110') },
        { commands: raw('cl_forwardspeed 200', 'cl_sidespeed 200') },
      ],
    })

    const result = recognizeEntryIdioms(renderedDefinitions(pair))

    expect(result.pressReleases).toEqual([
      {
        kind: 'press-release',
        baseName: 'slow',
        press: { name: '+slow', segments: ['cl_forwardspeed 110', 'cl_sidespeed 110'] },
        release: { name: '-slow', segments: ['cl_forwardspeed 200', 'cl_sidespeed 200'] },
        consumedNames: ['+slow', '-slow'],
      },
    ])
  })

  it('round-trips a rendered wait command back to the same frame count', () => {
    const chain = action({
      kind: 'alias',
      aliasName: 'rj',
      commands: [{ kind: 'wait', frames: 5 }],
    })

    const rendered = renderedDefinitions(chain)

    expect(rendered).toEqual([{ name: 'rj', body: 'wait; wait; wait; wait; wait' }])
    expect(recognizeEntryIdioms(rendered).waitAliases).toEqual([
      { kind: 'wait', name: 'rj', frames: 5, consumedNames: ['rj'] },
    ])
  })

  it('needs the _p<n> chunks folded first - a chunk-calling state body is not a state', () => {
    const long = action({
      kind: 'toggle',
      aliasName: 'zoom',
      parts: [
        { commands: raw(...Array.from({ length: 40 }, (_, i) => `set zoom_cvar_${i} 1234567890`)) },
        { commands: raw('norm_fov') },
      ],
    })

    const rendered = renderedDefinitions(long)
    expect(rendered.filter((alias) => CHUNK_SUFFIX.test(alias.name)).length).toBeGreaterThan(1)

    // Unfolded, the state's own body is `zoom_s1_p1; zoom_s1_p2` and the
    // dispatch rewrite sits inside the last chunk - not the idiom, so nothing
    // is claimed and nothing is mis-typed.
    const unfolded = recognizeEntryIdioms(rendered)
    expect(unfolded.toggles).toEqual([])
    expect(unfolded.unmatchedNames).toEqual(rendered.map((alias) => alias.name))

    // Folded the way `profile-restore.ts` folds it, the same family is the
    // toggle it was rendered from, commands and order intact.
    const folded = recognizeEntryIdioms(foldChunks(rendered))
    expect(folded.toggles).toHaveLength(1)
    expect(folded.toggles[0]?.dispatchName).toBe('zoom')
    expect(folded.toggles[0]?.states[0]?.segments).toEqual(
      Array.from({ length: 40 }, (_, i) => `set zoom_cvar_${i} 1234567890`),
    )
    expect(folded.toggles[0]?.states[1]?.segments).toEqual(['norm_fov'])
    expect(folded.unmatchedNames).toEqual([])
  })
})
