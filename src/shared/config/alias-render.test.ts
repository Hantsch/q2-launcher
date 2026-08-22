import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import { MAX_ALIAS_NAME, MAX_LINE_BYTES } from '@shared/config/alt-layers'
import {
  aliasNameFor,
  derivedAliasName,
  legacyAliasNameFor,
  renderActionAlias,
  renderActionAliasLines,
} from './alias-render'

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
    kind: 'bind',
    commands: [{ kind: 'raw', text: 'drop rl' }],
    ...overrides,
  }
}

/** Usable alias-name characters - the 32nd is the engine's terminator. */
const USABLE_ALIAS_NAME = MAX_ALIAS_NAME - 1

describe('aliasNameFor', () => {
  it('derives a sign-free slug of the display name, no prefix and no id suffix (story 039, D7)', () => {
    expect(aliasNameFor(action({ name: 'Drop RL', id: 'ab12cd34' }))).toBe('drop_rl')
  })

  it('truncates the slug to the 26-character derived-name budget', () => {
    const name = aliasNameFor(action({ name: 'A Really Very Long Action Name', id: 'ffeeddcc-1111' }))

    expect(name).toBe('a_really_very_long_action')
    expect(name.length).toBeLessThanOrEqual(26)
  })

  // The id suffix and its slugging/fallback rules are `legacyAliasNameFor`-only now (story 039,
  // D7): the derived path never reads `action.id` at all, so these two cases move there rather
  // than disappearing - `legacyAliasNameFor` must keep producing them forever (D6 depends on it).
  it('legacyAliasNameFor still slugs the id suffix rather than slicing it blindly', () => {
    expect(legacyAliasNameFor(action({ name: 'Help', id: 'A-B/C.D-EFG' }))).toBe('q2l_a_help_abcd')
  })

  it('legacyAliasNameFor still falls back to 0000 when nothing alias-safe survives in the id', () => {
    expect(legacyAliasNameFor(action({ name: 'Help', id: '---' }))).toBe('q2l_a_help_0000')
  })

  // Story 039, D7: the derived path has no id suffix at all, so two same-named actions now derive
  // to the *same* name on purpose (reported as a duplicate rather than disambiguated - D8's
  // validation); `legacyAliasNameFor`'s own id suffix is what used to - and still does - keep two
  // such actions apart.
  it('legacyAliasNameFor still gives two same-named actions distinct names', () => {
    const first = legacyAliasNameFor(action({ name: 'Taunt', id: 'aaaa1111' }))
    const second = legacyAliasNameFor(action({ name: 'Taunt', id: 'bbbb2222' }))

    expect(first).not.toBe(second)
  })

  // Regression (story 039 review): `legacyAliasNameFor` must reproduce the pre-039 format
  // byte-for-byte, including `slugAliasName`'s pre-039 fallback ('layer') for a name that slugs to
  // nothing - a name whose id is genuinely stable across a read is what D6's migration keys off,
  // so a fallback drift here would make a legacy `q2l_a_layer_<id4>` value already on disk
  // unmatchable, and D6 would drop it as an orphan instead of migrating it.
  it('legacyAliasNameFor keeps the pre-039 "layer" fallback for a name that slugs to nothing', () => {
    expect(legacyAliasNameFor(action({ name: '!!!', kind: 'bind', id: 'aaaa1111' }))).toBe(
      'q2l_a_layer_aaaa',
    )
    expect(legacyAliasNameFor(action({ name: '!!!', kind: 'alias', id: 'aaaa1111' }))).toBe('layer')
  })

  /**
   * Story 039, D1: `aliasName`, when set, wins verbatim - sign kept, no slugging, no id suffix -
   * over the derived name below it.
   */
  it('returns aliasName verbatim (sign kept) when set', () => {
    expect(aliasNameFor(action({ name: 'Slow', id: 'ab12cd34', aliasName: '+slow' }))).toBe(
      '+slow',
    )
  })

  it('falls back to the derived name when aliasName is unset', () => {
    // Unchanged from before this deliverable - same assertion as the first test in this block.
    expect(aliasNameFor(action({ name: 'Drop RL', id: 'ab12cd34' }))).toBe(
      derivedAliasName(action({ name: 'Drop RL', id: 'ab12cd34' })),
    )
  })

  it('treats an empty-string aliasName the same as unset', () => {
    expect(aliasNameFor(action({ name: 'Drop RL', id: 'ab12cd34', aliasName: '' }))).toBe(
      'drop_rl',
    )
  })
})

describe('derivedAliasName', () => {
  it('produces a sign-free slug of the display name, no prefix, no id suffix - the UI placeholder for an unnamed action (story 039, D7)', () => {
    expect(derivedAliasName(action({ name: 'Drop RL', id: 'ab12cd34' }))).toBe('drop_rl')
  })
})

describe('renderActionAlias', () => {
  it('renders a single-command action unquoted', () => {
    const { aliases } = renderActionAlias(action({ name: 'Drop RL', id: 'ab12cd34' }))

    expect(aliases).toEqual([
      { name: 'drop_rl', body: 'drop rl', line: 'alias drop_rl drop rl' },
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
    expect(aliases[0].line).toBe('alias rocket "use rocket launcher; +attack; -attack"')
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
    expect(aliases[0].line).toBe('alias help "say_team [ HELP ] $$loc_here; wave 1"')
  })

  it('renders a say message on the say channel', () => {
    const { aliases } = renderActionAlias(
      action({
        name: 'GG',
        id: 'ab12cd34',
        commands: [{ kind: 'message', channel: 'say', text: 'good game' }],
      }),
    )

    expect(aliases[0].line).toBe('alias gg say good game')
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

describe('renderActionAlias (story 015: drop-catalogue row)', () => {
  it('renders a drop row with ammo and a team message as one alias, "; "-joined in order', () => {
    // Shaped like a materialised drop-catalogue row (decision 6): the item,
    // its ammo, then the team message last - `catalogId`/`key`/`secondaryKey`
    // are not read by this module (only by `ControlsTab`/`setActions`, which
    // decide what points at the alias), so this proves the render side only.
    const dropRow = action({
      name: 'Rocket Launcher',
      id: 'ab12cd34',
      categoryId: 'drops',
      catalogId: 'dropWeapon:rlauncher',
      key: 'r',
      secondaryKey: 'PGUP',
      commands: [
        { kind: 'raw', text: 'drop rocket launcher' },
        { kind: 'raw', text: 'drop rockets' },
        { kind: 'message', channel: 'say_team', text: 'need ammo' },
      ],
    })

    const { aliases } = renderActionAlias(dropRow)

    expect(aliases).toHaveLength(1)
    expect(aliases[0].body).toBe('drop rocket launcher; drop rockets; say_team need ammo')
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
      'alias one drop rl',
      'alias two wave 2',
    ])
  })

  it('returns nothing for an empty action list', () => {
    expect(renderActionAliasLines([])).toEqual([])
  })

  /**
   * Story 038 deliberately did not move the "does this alias line have any
   * reason to exist" guard in here: this function renders whatever list it is
   * handed, and `render.ts` filters that list through
   * `actionsWithAliasLine` (`./alias-references`) first. Two callers depend on
   * that split - `ActionEditor`'s live preview renders one action's alias
   * regardless of whether the file will carry it, and every case in this file
   * keeps meaning what it says. So a continuous catalogue row, the exact shape
   * `render.ts` now drops, still renders when passed here directly.
   */
  it('renders whatever list it is handed - the reference guard is render.ts`s, not this function`s', () => {
    const catalogueRow = action({
      name: '+attack',
      id: 'aaaa0000',
      catalogId: 'attack:primary',
      key: 'MOUSE1',
      commands: [{ kind: 'raw', text: '+attack' }],
    })

    // A `kind: 'bind'` row's derived name is slugged sign-free even though its own display name
    // starts with `+` (story 039, D7's Decisions): only a `kind: 'alias'` entry carries the sign.
    expect(renderActionAliasLines([catalogueRow])).toEqual(['alias attack +attack'])
  })
})

/**
 * Story 019 D2: an alias entry *is* the alias definition, so it renders under
 * the name the user typed - that name is the contract with the binding that
 * calls it, which is only possible if it is what lands in the file.
 */
describe('kind: alias entries', () => {
  const plusTest = action({
    id: 'plus-test-0000',
    name: '+test',
    kind: 'alias',
    commands: [{ kind: 'raw', text: '+attack' }],
  })

  it('renders under its own name, with no q2l_a_ prefix and no id suffix', () => {
    expect(aliasNameFor(plusTest)).toBe('+test')
    expect(renderActionAlias(plusTest).aliases).toEqual([
      { name: '+test', body: '+attack', line: 'alias +test +attack' },
    ])
  })

  it('keeps a leading + or - (the engine`s press/release idiom) instead of slugging it away', () => {
    expect(aliasNameFor(action({ name: '-test', kind: 'alias' }))).toBe('-test')
    // Only the sign is exempt - the rest goes through `slugAliasName` as usual.
    expect(aliasNameFor(action({ name: '+Rocket Jump!', kind: 'alias' }))).toBe('+rocket_jump')
  })

  it('slugs the rest of the name by the shared alias-name rules', () => {
    expect(aliasNameFor(action({ name: 'Zoom In', kind: 'alias' }))).toBe('zoom_in')
    expect(aliasNameFor(action({ name: '  Größe  ', kind: 'alias' }))).toBe('groesse')
  })

  it('stays inside the engine name budget with room for the chunk suffix', () => {
    const longName = aliasNameFor(
      action({ name: '+a really very long alias name indeed', kind: 'alias' }),
    )

    // sign (1) + slug (<= 26) + `_p<nn>` (4) <= the usable 31.
    expect(longName).toBe('+a_really_very_long_alias_n')
    expect(`${longName}_p12`.length).toBeLessThanOrEqual(USABLE_ALIAS_NAME)
  })

  it('splits a long body under its own name, chunking unchanged', () => {
    const commands = Array.from({ length: 60 }, (_, index) => ({
      kind: 'raw' as const,
      text: `say alias body line number ${index}`,
    }))
    const { aliases } = renderActionAlias(
      action({ id: 'chunky-0000', name: '+spam', kind: 'alias', commands }),
    )

    expect(aliases.length).toBeGreaterThan(1)
    expect(aliases.map((alias) => alias.name).slice(0, 2)).toEqual(['+spam_p1', '+spam_p2'])
    expect(aliases.at(-1)!.name).toBe('+spam')
    expect(aliases.at(-1)!.body).toBe(
      aliases
        .slice(0, -1)
        .map((alias) => alias.name)
        .join('; '),
    )
    for (const alias of aliases) {
      expect(alias.name.length).toBeLessThanOrEqual(USABLE_ALIAS_NAME)
      expect(alias.line.length).toBeLessThan(MAX_LINE_BYTES)
    }
  })

  it('emits the alias definition before the binding that calls it, in array order', () => {
    const binding = action({
      id: 'binding-0000',
      name: 'Test binding',
      kind: 'bind',
      key: 'f',
      commands: [{ kind: 'raw', text: '+test' }],
    })

    const lines = renderActionAliasLines([plusTest, binding])

    expect(lines).toEqual(['alias +test +attack', 'alias test_binding +test'])
    // Neither line carries a `q2l_a_` prefix any more (story 039, D7): the alias entry renders
    // under its own typed name, sign kept, and the binding that calls it derives a plain readable
    // slug - the same "no `q2l_a_` anywhere in the output" invariant this deliverable's acceptance
    // criteria calls for.
    expect(lines.join('\n')).not.toContain('q2l_a_')
  })
})
