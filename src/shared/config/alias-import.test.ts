import { describe, expect, it } from 'vitest'
import {
  buildImportedActions,
  splitAliasBody,
  type ImportedAliasDefinition,
} from '@shared/config/alias-import'

/** Deterministic ids, so the entries and categories a case produces are pinnable. */
function idFactory(): () => string {
  let n = 0
  return () => `id${(n += 1)}`
}

/** One folded definition, as `import-reader.ts` would hand it over. */
function def(name: string, body: string, line = 1): ImportedAliasDefinition {
  return { name, body, file: 'dmalias.cfg', line }
}

function build(
  aliases: ImportedAliasDefinition[],
  extra: { binds?: Record<string, string>; layerAliases?: string[] } = {},
): ReturnType<typeof buildImportedActions> {
  return buildImportedActions({ aliases, ...extra, newId: idFactory() })
}

describe('splitAliasBody', () => {
  it('splits on top-level semicolons only, leaving a quoted one alone', () => {
    // The shared splitter's own quote rule (`command-tokenizer.ts`), not a second one.
    expect(splitAliasBody('say "a;b";wave 1')).toEqual(['say "a;b"', 'wave 1'])
  })

  it('drops a // comment from the segment it sits in, not from the ones after it', () => {
    // Cbuf cuts on `;` first, then COM_Parse drops the comment inside that one command.
    expect(splitAliasBody('use rl // switch;+attack')).toEqual(['use rl', '+attack'])
  })

  it('keeps a mid-token // (a URL) - the engine does not read it as a comment', () => {
    expect(splitAliasBody('say join http://example.com;wave 2')).toEqual([
      'say join http://example.com',
      'wave 2',
    ])
  })

  it('drops empty segments and trims, but a fully empty body yields nothing', () => {
    expect(splitAliasBody('a;;  ; b ')).toEqual(['a', 'b'])
    expect(splitAliasBody('')).toEqual([])
    expect(splitAliasBody('   ')).toEqual([])
    expect(splitAliasBody('// nothing but a comment')).toEqual([])
  })
})

describe('buildImportedActions - entry kind', () => {
  it('makes a one-message body a message entry, macros byte-identical', () => {
    // The fixture's own `s_ok`, chat macros and all.
    const { actions } = build([def('s_ok', 'say_team $g [ OK / COMING ] ... $loc_here $g')])

    expect(actions).toEqual([
      {
        id: 'id1',
        categoryId: 'id2',
        name: 's_ok',
        kind: 'message',
        commands: [
          { kind: 'message', channel: 'say_team', text: '$g [ OK / COMING ] ... $loc_here $g' },
        ],
        aliasName: 's_ok',
      },
    ])
  })

  it('passes unknown mod-side macros and high-bit bytes through untouched', () => {
    const text = '\xad\xad\xad Dropped [ Shotgun ] %l %N %T %h %a \xad\xad\xad'
    const { actions } = build([def('hi', `say ${text}`)])

    expect(actions[0]!.kind).toBe('message')
    expect(actions[0]!.commands).toEqual([{ kind: 'message', channel: 'say', text }])
  })

  it('strips exactly the one pair of quotes CL_Say_f strips', () => {
    const { actions } = build([def('gg', 'say "good game %l"')])

    expect(actions[0]!.commands).toEqual([
      { kind: 'message', channel: 'say', text: 'good game %l' },
    ])
  })

  it('leaves an argument-less say as a raw command', () => {
    // A recognized command without the arguments it needs is not that command -
    // `config-parser.ts`'s own rule.
    const { actions } = build([def('nothing', 'say')])

    expect(actions[0]!.kind).toBe('alias')
    expect(actions[0]!.commands).toEqual([{ kind: 'raw', text: 'say' }])
  })

  it('makes a mixed body an alias entry, message part modelled', () => {
    // `dmalias.cfg`'s `drop_shotgun`: drops, a say_team with a macro, a wave.
    const { actions } = build([
      def('drop_shotgun', 'drop Shotgun; drop shells; say_team Dropped [ Shotgun ] %l; wave 1'),
    ])

    expect(actions[0]!.kind).toBe('alias')
    expect(actions[0]!.categoryId).toBe('drops')
    expect(actions[0]!.commands).toEqual([
      { kind: 'raw', text: 'drop Shotgun' },
      { kind: 'raw', text: 'drop shells' },
      { kind: 'message', channel: 'say_team', text: 'Dropped [ Shotgun ] %l' },
      { kind: 'raw', text: 'wave 1' },
    ])
  })

  it('makes two message commands an alias entry, not a message entry', () => {
    const { actions } = build([def('lol1', 'say o.o;say  [ [ [')])

    expect(actions[0]!.kind).toBe('alias')
    expect(actions[0]!.commands).toHaveLength(2)
  })

  it('keeps an empty-body alias as an entry with no commands', () => {
    const { actions } = build([def('blaster_settings', '')])

    expect(actions).toHaveLength(1)
    expect(actions[0]!.kind).toBe('alias')
    expect(actions[0]!.commands).toEqual([])
    expect(actions[0]!.name).toBe('blaster_settings')
  })

  // Story 041, D3 ("Decided in refine"): the writer's "no usable commands -> no alias line" rule
  // is scoped to generated action aliases, so an imported empty-body hook must carry a marker the
  // writer can tell it apart by - see `alias-render.ts#renderActionAlias`.
  it('marks an empty-body imported alias to keep, so the writer still emits its line', () => {
    const { actions } = build([def('blaster_settings', '')])

    expect(actions[0]!.keepEmptyAlias).toBe(true)
  })

  it('does not mark a non-empty-body imported alias', () => {
    const { actions } = build([def('drop_rail', 'drop railgun')])

    expect(actions[0]!.keepEmptyAlias).toBeUndefined()
  })
})

describe('buildImportedActions - names', () => {
  it('keeps a signed name verbatim in both name and aliasName', () => {
    const { actions } = build([
      def('+slow', 'cl_forwardspeed 110; cl_sidespeed 110'),
      def('-slow', 'cl_forwardspeed 200; cl_sidespeed 200'),
      def('drop_rail', 'drop railgun'),
    ])

    expect(actions.map((a) => [a.name, a.aliasName])).toEqual([
      ['+slow', '+slow'],
      ['-slow', '-slow'],
      ['drop_rail', 'drop_rail'],
    ])
  })

  it('folds a re-defined name to one entry, last definition winning in first-seen place', () => {
    const { actions } = build([
      def('lol', 'lol1', 10),
      def('other', 'say hi', 11),
      def('lol', 'lol1;lol2;lol3', 12),
    ])

    expect(actions.map((a) => a.name)).toEqual(['lol', 'other'])
    expect(actions[0]!.commands).toEqual([
      { kind: 'raw', text: 'lol1' },
      { kind: 'raw', text: 'lol2' },
      { kind: 'raw', text: 'lol3' },
    ])
  })
})

describe('buildImportedActions - nested alias in a body', () => {
  it('keeps a nested alias as a raw command and registers no second name', () => {
    // `dmalias.cfg`'s self-rewriting zoom toggle.
    const { actions } = build([
      def('zoomin', 'zoom_fov;zoom_sens;alias zoom zoomout'),
      def('zoom', 'zoomin'),
    ])

    expect(actions.map((a) => a.name)).toEqual(['zoomin', 'zoom'])
    expect(actions[0]!.commands).toEqual([
      { kind: 'raw', text: 'zoom_fov' },
      { kind: 'raw', text: 'zoom_sens' },
      { kind: 'raw', text: 'alias zoom zoomout' },
    ])
  })
})

describe('buildImportedActions - category guess', () => {
  const categoryOf = (body: string): string => {
    const { actions, categories } = build([def('x', body)])
    const id = actions[0]!.categoryId
    return categories.find((c) => c.id === id)?.name ?? id
  }

  it('files a drop body under drops - before use, first match wins', () => {
    expect(categoryOf('drop Shotgun; use blaster')).toBe('drops')
  })

  it('files a use body under weapons', () => {
    expect(categoryOf('use rocket launcher;+attack')).toBe('weapons')
  })

  it('files a say/say_team-only body under a new messages category', () => {
    expect(categoryOf('say_team $g ok')).toBe('Messages')
    expect(categoryOf('say hi;say_team ho')).toBe('Messages')
  })

  it('allows play next to messages and still calls it messages', () => {
    expect(categoryOf('say_team ok;play world/klaxon2.wav')).toBe('Messages')
  })

  it('files a play-only body under a new sounds category', () => {
    expect(categoryOf('play world/klaxon2.wav')).toBe('Sounds')
  })

  it('files movement commands and cvars under movement', () => {
    expect(categoryOf('cl_forwardspeed 110; cl_sidespeed 110')).toBe('movement')
    expect(categoryOf('+forward')).toBe('movement')
    expect(categoryOf('+back;wait')).toBe('movement')
    expect(categoryOf('+moveup')).toBe('movement')
  })

  it('falls back to a new imported category, empty bodies included', () => {
    expect(categoryOf('wait;wait;echo hi')).toBe('Imported')
    expect(categoryOf('')).toBe('Imported')
  })

  it('never lets chat prose pick the category', () => {
    // "drop"/"use" inside a message is talk about dropping, not a drop command,
    // and "mouse " contains "use ".
    expect(categoryOf('say drop the flag')).toBe('Messages')
    expect(categoryOf('say mouse settings')).toBe('Messages')
  })

  it('creates each new category once and returns only the created ones', () => {
    const { actions, categories } = build([
      def('a', 'say one'),
      def('b', 'say two;say three'),
      def('c', 'wait'),
      def('d', 'drop rail'),
    ])

    expect(categories.map((c) => c.name)).toEqual(['Messages', 'Imported'])
    expect(actions[0]!.categoryId).toBe(actions[1]!.categoryId)
    expect(actions[3]!.categoryId).toBe('drops')
  })
})

describe('buildImportedActions - order independence', () => {
  it('converts a chain the same way whichever order it is defined in', () => {
    const forward = [
      def('lol', 'lol1;lol2;lol3'),
      def('lol1', 'say o.o'),
      def('lol2', 'say -.-'),
      def('lol3', 'say +.+'),
    ]
    const reversed = [...forward].reverse()

    const strip = (r: ReturnType<typeof buildImportedActions>): unknown =>
      r.actions
        .map((a) => ({ name: a.name, kind: a.kind, commands: a.commands }))
        .sort((x, y) => x.name.localeCompare(y.name))

    expect(strip(build(forward))).toEqual(strip(build(reversed)))
    // `lol` references `lol1` before it is defined; the reference is plain text either way.
    expect(build(forward).actions[0]!.commands).toEqual([
      { kind: 'raw', text: 'lol1' },
      { kind: 'raw', text: 'lol2' },
      { kind: 'raw', text: 'lol3' },
    ])
  })
})

describe('buildImportedActions - aliases that rebind keys', () => {
  const cali = def(
    'cali',
    'bind KP_END fuck;bind KP_DOWNARROW hure;bind * lags;bind KP_ENTER na_warum',
    147,
  )

  it('reports an alias with a top-level bind as ambiguous and imports it as a plain alias', () => {
    const { actions, layers, ambiguous } = build([cali])

    expect(ambiguous).toEqual([
      { name: 'cali', body: cali.body, file: 'dmalias.cfg', line: 147 },
    ])
    expect(layers).toEqual([])
    expect(actions).toHaveLength(1)
    expect(actions[0]!.kind).toBe('alias')
    expect(actions[0]!.commands[0]).toEqual({ kind: 'raw', text: 'bind KP_END fuck' })
  })

  it('turns it into a toggle layer when the user answered attempt-as-layer', () => {
    const { actions, layers, ambiguous } = build([cali], { layerAliases: ['cali'] })

    expect(ambiguous).toHaveLength(1)
    expect(actions).toEqual([])
    expect(layers).toEqual([
      {
        id: 'id1',
        name: 'cali',
        mode: 'toggle',
        triggerKey: null,
        overrides: {
          KP_END: 'fuck',
          KP_DOWNARROW: 'hure',
          '*': 'lags',
          KP_ENTER: 'na_warum',
        },
      },
    ])
  })

  it('wires triggerKey from a bind that calls the alias, deterministically', () => {
    const { layers } = build([cali], {
      layerAliases: ['cali'],
      binds: { z: 'cali', F5: '"cali"', a: 'cali; say hi' },
    })

    // Sorted key order, so two keys calling the alias cannot make the trigger
    // depend on insertion order. `a`'s multi-command value is not a plain call.
    expect(layers[0]!.triggerKey).toBe('F5')
  })

  it('keeps a bind with no command out of the overrides', () => {
    const { layers } = build([def('probe', 'bind KP_END;bind x weapnext')], {
      layerAliases: ['probe'],
    })

    expect(layers[0]!.overrides).toEqual({ x: 'weapnext' })
  })

  it('joins a multi-token bind command with single spaces, like Cmd_Bind_f', () => {
    const { layers } = build([def('t', 'bind 1 use rocket launcher')], { layerAliases: ['t'] })

    expect(layers[0]!.overrides).toEqual({ '1': 'use rocket launcher' })
  })

  it('does not treat a nested alias or an unbind as a rebind', () => {
    const { ambiguous } = build([
      def('zoomin', 'zoom_fov;alias zoom zoomout'),
      def('clean', 'unbind x;unbindall'),
    ])

    expect(ambiguous).toEqual([])
  })
})

describe('buildImportedActions - binds are never a source of entries', () => {
  it('invents no entry for a raw +command bind', () => {
    const result = build([], { binds: { e: '+forward', ALT: '+x2', KP_END: 'drop_shotgun' } })

    expect(result.actions).toEqual([])
    expect(result.categories).toEqual([])
    expect(result.layers).toEqual([])
    expect(result.ambiguous).toEqual([])
  })

  it('imports only the aliases when binds sit next to them', () => {
    const { actions } = build([def('drop_shotgun', 'drop Shotgun')], {
      binds: { e: '+forward', KP_END: 'drop_shotgun' },
    })

    expect(actions.map((a) => a.name)).toEqual(['drop_shotgun'])
  })
})

/**
 * Bodies no fixture and no story example covers - the constructs a wrong split
 * would corrupt silently.
 */
describe('buildImportedActions - adversarial bodies', () => {
  it('handles a four-deep chain plus a self-rewriting toggle in one import', () => {
    const { actions, categories, ambiguous } = build([
      def('a1', 'a2;wait'),
      def('a2', 'a3;wait'),
      def('a3', 'a4'),
      def('a4', 'say end of chain %l'),
      def('t_on', 'cl_gun 0;alias t t_off'),
      def('t_off', 'cl_gun 1;alias t t_on'),
      def('t', 't_on'),
    ])

    expect(actions.map((a) => a.name)).toEqual(['a1', 'a2', 'a3', 'a4', 't_on', 't_off', 't'])
    expect(actions.map((a) => a.kind)).toEqual([
      'alias',
      'alias',
      'alias',
      'message',
      'alias',
      'alias',
      'alias',
    ])
    // Only `a4` is a message; the toggle's rewrites stayed raw and defined nothing.
    expect(categories.map((c) => c.name)).toEqual(['Imported', 'Messages'])
    expect(actions[4]!.commands).toEqual([
      { kind: 'raw', text: 'cl_gun 0' },
      { kind: 'raw', text: 'alias t t_off' },
    ])
    expect(ambiguous).toEqual([])
  })

  it('keeps a wait chain around a use command intact', () => {
    const { actions } = build([def('rl_swap', 'wait;wait;wait;use rocket launcher;wait;+attack')])

    expect(actions[0]!.categoryId).toBe('weapons')
    expect(actions[0]!.commands.map((c) => c.text)).toEqual([
      'wait',
      'wait',
      'wait',
      'use rocket launcher',
      'wait',
      '+attack',
    ])
  })

  it('survives a body that is only separators, comments and whitespace', () => {
    const { actions, categories } = build([def('hook', ' ; ;// nothing here ; ')])

    // The `//` swallows the rest of the segment it sits in, and nothing is left.
    expect(actions).toHaveLength(1)
    expect(actions[0]!.commands).toEqual([])
    expect(actions[0]!.kind).toBe('alias')
    expect(categories.map((c) => c.name)).toEqual(['Imported'])
  })

  it('does not let an unbalanced quote in a body swallow the next command', () => {
    // One `"` opens a span that runs to the end of the body, so the `;` inside it
    // is not a split point - the tokenizer's own rule, faithfully reproduced.
    const { actions } = build([def('odd', 'say he said "hi;wave 1')])

    expect(actions[0]!.commands).toEqual([
      { kind: 'message', channel: 'say', text: 'he said "hi;wave 1' },
    ])
  })

  it('reads a rebind hidden at the end of a long body', () => {
    const body = 'echo arming;wait;play world/klaxon2.wav;bind MOUSE3 kill'
    const { ambiguous, actions } = build([def('armed', body)])

    expect(ambiguous.map((a) => a.name)).toEqual(['armed'])
    expect(actions[0]!.commands).toHaveLength(4)
  })
})
