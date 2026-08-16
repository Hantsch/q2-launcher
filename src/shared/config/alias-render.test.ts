import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import { MAX_ALIAS_NAME, MAX_LINE_BYTES } from '@shared/config/alt-layers'
import { aliasNameFor, renderActionAlias, renderActionAliasLines } from './alias-render'

/**
 * `renderProfileFile` integration coverage (the action-alias block's position
 * relative to layers/binds, and the latin1 round-trip through an actual
 * rendered file) lives in `src/main/modules/config/render.test.ts` instead of
 * here - `render.ts` is a main-only module (this file must stay importable
 * from the renderer's own `tsconfig.web.json`, which has no `@main` alias and
 * no Node types), and `render.test.ts` already owns every other
 * `renderProfileFile` scenario.
 */

function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'ab12cd34-0000-0000-0000-000000000000',
    categoryId: 'weapons',
    name: 'Drop RL',
    commands: [{ kind: 'raw', text: 'drop rl' }],
    ...overrides,
  }
}

/** Usable alias-name characters - the 32nd is the engine's terminator. */
const USABLE_ALIAS_NAME = MAX_ALIAS_NAME - 1

describe('aliasNameFor', () => {
  it('produces q2l_a_<slug(name,14)>_<id[0:4]>', () => {
    expect(aliasNameFor(action({ name: 'Drop RL', id: 'ab12cd34' }))).toBe('q2l_a_drop_rl_ab12')
  })

  it('truncates the slug to 14 characters and stays inside the name budget', () => {
    const name = aliasNameFor(action({ name: 'A Really Very Long Action Name', id: 'ffeeddcc-1111' }))

    expect(name).toBe('q2l_a_a_really_very_ffee')
    expect(name.length).toBeLessThanOrEqual(25)
  })

  it('slugs the id suffix rather than slicing it blindly', () => {
    expect(aliasNameFor(action({ name: 'Help', id: 'A-B/C.D-EFG' }))).toBe('q2l_a_help_abcd')
  })

  it('falls back to 0000 when nothing alias-safe survives in the id', () => {
    expect(aliasNameFor(action({ name: 'Help', id: '---' }))).toBe('q2l_a_help_0000')
  })

  it('gives two same-named actions distinct names', () => {
    const first = aliasNameFor(action({ name: 'Taunt', id: 'aaaa1111' }))
    const second = aliasNameFor(action({ name: 'Taunt', id: 'bbbb2222' }))

    expect(first).not.toBe(second)
  })
})

describe('renderActionAlias', () => {
  it('renders a single-command action unquoted', () => {
    const { aliases } = renderActionAlias(action({ name: 'Drop RL', id: 'ab12cd34' }))

    expect(aliases).toEqual([
      { name: 'q2l_a_drop_rl_ab12', body: 'drop rl', line: 'alias q2l_a_drop_rl_ab12 drop rl' },
    ])
  })

  it('renders a short multi-command action as exactly one quoted line', () => {
    const { aliases } = renderActionAlias(
      action({
        name: 'Rocket',
        id: 'ab12cd34',
        commands: [
          { kind: 'raw', text: 'use rocket launcher' },
          { kind: 'raw', text: '+attack' },
          { kind: 'raw', text: '-attack' },
        ],
      }),
    )

    expect(aliases).toHaveLength(1)
    expect(aliases[0].line).toBe('alias q2l_a_rocket_ab12 "use rocket launcher; +attack; -attack"')
  })

  it('renders a message command as "<channel> <text>"', () => {
    const { aliases } = renderActionAlias(
      action({
        name: 'Help',
        id: 'ab12cd34',
        commands: [
          { kind: 'message', channel: 'say_team', text: '[ HELP ] $$loc_here' },
          { kind: 'raw', text: 'wave 1' },
        ],
      }),
    )

    expect(aliases[0].body).toBe('say_team [ HELP ] $$loc_here; wave 1')
    expect(aliases[0].line).toBe('alias q2l_a_help_ab12 "say_team [ HELP ] $$loc_here; wave 1"')
  })

  it('renders a say message on the say channel', () => {
    const { aliases } = renderActionAlias(
      action({
        name: 'GG',
        id: 'ab12cd34',
        commands: [{ kind: 'message', channel: 'say', text: 'good game' }],
      }),
    )

    expect(aliases[0].line).toBe('alias q2l_a_gg_ab12 say good game')
  })

  it('sanitizes quotes and collapsed whitespace out of every command', () => {
    const { aliases } = renderActionAlias(
      action({
        name: 'Quoted',
        id: 'ab12cd34',
        commands: [
          { kind: 'raw', text: 'bind 1 "use blaster"' },
          { kind: 'message', channel: 'say', text: 'lots\tof   space' },
        ],
      }),
    )

    expect(aliases[0].body).toBe('bind 1 use blaster; say lots of space')
    expect(aliases[0].line).not.toContain('""')
  })

  it('emits nothing for an action with no commands', () => {
    expect(renderActionAlias(action({ commands: [] })).aliases).toEqual([])
  })

  it('emits nothing for an action whose commands are all blank', () => {
    const { aliases } = renderActionAlias(
      action({
        commands: [
          { kind: 'raw', text: '   ' },
          { kind: 'raw', text: '"' },
        ],
      }),
    )

    expect(aliases).toEqual([])
  })
})

describe('renderActionAlias auto-split', () => {
  // 25 commands of 96 characters each. A chunk fits nine of them under the
  // 1024 - 16 byte budget, so this lands on exactly three parts.
  const longCommands = Array.from({ length: 25 }, (_, index) => ({
    kind: 'raw' as const,
    text: `echo ${String(index).padStart(2, '0')}${'x'.repeat(89)}`,
  }))
  const longAction = action({ name: 'Long Action', id: 'ab12cd34', commands: longCommands })
  const parentName = aliasNameFor(longAction)

  it('splits into exactly three parts named <parent>_p1.._p3, parent last', () => {
    const { aliases } = renderActionAlias(longAction)

    expect(aliases.map((alias) => alias.name)).toEqual([
      `${parentName}_p1`,
      `${parentName}_p2`,
      `${parentName}_p3`,
      parentName,
    ])
  })

  it('gives the parent a body that calls every part in order', () => {
    const { aliases } = renderActionAlias(longAction)
    const parent = aliases[aliases.length - 1]

    expect(parent.name).toBe(parentName)
    expect(parent.body).toBe(`${parentName}_p1; ${parentName}_p2; ${parentName}_p3`)
    expect(parent.line).toBe(
      `alias ${parentName} "${parentName}_p1; ${parentName}_p2; ${parentName}_p3"`,
    )
  })

  it('keeps every emitted line inside the engine line limit', () => {
    const { aliases } = renderActionAlias(longAction)

    // Latin1 is one byte per UTF-16 code unit for the code points this module
    // ever emits, so `.length` already is the byte count - same reasoning
    // `alt-layers.ts`/`alias-render.ts` themselves rely on, no `Buffer` needed
    // (and this file must stay importable from the renderer's `tsconfig.web.json`).
    for (const alias of aliases) {
      expect(alias.line.length).toBeLessThan(MAX_LINE_BYTES)
    }
  })

  it('keeps every emitted alias name inside the usable name length', () => {
    const { aliases } = renderActionAlias(longAction)

    for (const alias of aliases) {
      expect(alias.name.length).toBeLessThanOrEqual(USABLE_ALIAS_NAME)
    }
  })

  it('drops, duplicates and reorders nothing: the parts rebuild the exact command list', () => {
    const { aliases } = renderActionAlias(longAction)
    const chunks = aliases.slice(0, -1)

    const rebuilt = chunks
      .map((chunk) => chunk.body)
      .join('; ')
      .split('; ')

    expect(rebuilt).toEqual(longCommands.map((command) => command.text))
  })

  it('splits only at command boundaries - no chunk holds a partial command', () => {
    const { aliases } = renderActionAlias(longAction)
    const chunks = aliases.slice(0, -1)
    const originals = new Set(longCommands.map((command) => command.text))

    for (const chunk of chunks) {
      for (const command of chunk.body.split('; ')) {
        expect(originals.has(command)).toBe(true)
      }
    }
  })

  it('emits an over-long single command rather than dropping it', () => {
    const huge = `echo ${'y'.repeat(2000)}`
    const hugeAction = action({ name: 'Huge', id: 'ab12cd34', commands: [{ kind: 'raw', text: huge }] })
    const { aliases } = renderActionAlias(hugeAction)

    expect(aliases).toHaveLength(2)
    expect(aliases[0].body).toBe(huge)
    expect(aliases[1].body).toBe(`${aliasNameFor(hugeAction)}_p1`)
  })
})

describe('renderActionAliasLines', () => {
  it('flattens every action in array order, chunks before their parent', () => {
    const first = action({ name: 'One', id: 'aaaa0000' })
    const second = action({
      name: 'Two',
      id: 'bbbb1111',
      commands: [{ kind: 'raw', text: 'wave 2' }],
    })

    expect(renderActionAliasLines([first, second])).toEqual([
      'alias q2l_a_one_aaaa drop rl',
      'alias q2l_a_two_bbbb wave 2',
    ])
  })

  it('returns nothing for an empty action list', () => {
    expect(renderActionAliasLines([])).toEqual([])
  })
})
