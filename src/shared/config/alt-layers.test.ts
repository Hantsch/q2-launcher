import { describe, expect, it } from 'vitest'
import {
  MAX_ALIAS_NAME,
  MAX_LINE_BYTES,
  generateLayerAliases,
  slugAliasName,
  type AltLayer,
  type GeneratedAlias,
} from './alt-layers'

function layer(overrides: Partial<AltLayer> = {}): AltLayer {
  return {
    id: 'layer-1',
    name: 'Drops',
    mode: 'hold',
    triggerKey: 'ALT',
    overrides: {},
    ...overrides,
  }
}

function byName(aliases: GeneratedAlias[], name: string): GeneratedAlias {
  const found = aliases.find((alias) => alias.name === name)
  if (!found)
    throw new Error(`no alias named ${name} in [${aliases.map((a) => a.name).join(', ')}]`)
  return found
}

describe('slugAliasName', () => {
  it('lower-cases, collapses runs of junk and trims underscores', () => {
    expect(slugAliasName('Drop Weapons!', 31)).toBe('drop_weapons')
    expect(slugAliasName('  --Zoom--  ', 31)).toBe('zoom')
    expect(slugAliasName('rl_2', 31)).toBe('rl_2')
  })

  it('transliterates umlauts instead of eating them', () => {
    expect(slugAliasName('Größe', 31)).toBe('groesse')
    expect(slugAliasName('Übergänge', 31)).toBe('uebergaenge')
  })

  it('falls back to "layer" when nothing survives', () => {
    expect(slugAliasName('   ', 31)).toBe('layer')
    expect(slugAliasName('!!!', 31)).toBe('layer')
  })

  it('truncates to the budget and leaves no trailing underscore behind', () => {
    expect(
      slugAliasName('A rather long layer label with umlauts äöü', 27).length,
    ).toBeLessThanOrEqual(27)
    expect(slugAliasName('foo bar', 4)).toBe('foo')
  })
})

describe('generateLayerAliases — hold layers', () => {
  it('emits the +name/-name pair and binds the trigger to the plus half', () => {
    const result = generateLayerAliases(layer({ overrides: { '1': 'drop rl', '2': 'drop rg' } }), {
      '1': 'weapnext',
    })

    // Exactly the shape the story's test plan spells out: outer quotes because
    // Cbuf_Execute would otherwise end the alias at the first `;`, and no
    // quotes at all inside the body.
    expect(byName(result.aliases, '+drops').line).toBe(
      'alias +drops "bind 1 drop rl; bind 2 drop rg"',
    )
    expect(result.triggerBind).toEqual({ key: 'ALT', command: '+drops' })
    expect(result.issues).toEqual([])
  })

  it('restores a previously bound key and unbinds one that was free', () => {
    const result = generateLayerAliases(layer({ overrides: { '1': 'drop rl', '2': 'drop rg' } }), {
      '1': 'weapnext',
    })

    // `2` had no base bind, so the honest restore is to clear it again —
    // without the unbind the key would stay bound after the layer is released.
    expect(byName(result.aliases, '-drops').body).toBe('bind 1 weapnext; unbind 2')
  })

  it('leaves a single-command body unquoted, which is what Cmd_Alias_f expects', () => {
    const result = generateLayerAliases(layer({ overrides: { '1': 'drop rl' } }), {})
    expect(byName(result.aliases, '+drops').line).toBe('alias +drops bind 1 drop rl')
    expect(byName(result.aliases, '-drops').line).toBe('alias -drops unbind 1')
  })
})

describe('generateLayerAliases — toggle layers', () => {
  const result = generateLayerAliases(
    layer({ name: 'Zoom', mode: 'toggle', triggerKey: 'v', overrides: { '1': 'use railgun' } }),
    { '1': 'use blaster' },
  )

  it('makes each half rewrite the dispatch alias to the other half', () => {
    expect(byName(result.aliases, 'zoom_on').body).toBe('bind 1 use railgun; alias zoom zoom_off')
    expect(byName(result.aliases, 'zoom_off').body).toBe('bind 1 use blaster; alias zoom zoom_on')
  })

  it('starts the dispatch alias on the "on" half and binds the trigger to it', () => {
    expect(byName(result.aliases, 'zoom').line).toBe('alias zoom zoom_on')
    expect(result.triggerBind).toEqual({ key: 'v', command: 'zoom' })
  })

  it('emits exactly the three aliases of the family', () => {
    expect(result.aliases.map((alias) => alias.name)).toEqual(['zoom_on', 'zoom_off', 'zoom'])
  })
})

describe('generateLayerAliases — quoting', () => {
  const cases = [
    generateLayerAliases(layer({ overrides: { '1': 'drop rl', '2': 'drop rg' } }), {
      '1': 'weapnext',
    }),
    generateLayerAliases(
      layer({ name: 'Zoom', mode: 'toggle', triggerKey: 'v', overrides: { '1': 'use railgun' } }),
      { '1': 'say "on my way"' },
    ),
    generateLayerAliases(
      layer({ overrides: { '1': 'say_team "taking rl"; drop rl', '2': 'wave 1' } }),
      { '2': 'say "hi there"' },
    ),
    generateLayerAliases(
      layer({
        name: 'Chunky',
        mode: 'toggle',
        triggerKey: 'x',
        overrides: Object.fromEntries(
          Array.from({ length: 60 }, (_, i) => [`k${i}`, `some_rather_long_alias_name_${i}`]),
        ),
      }),
      {},
    ),
  ]
  const allAliases = cases.flatMap((result) => result.aliases)

  it('never puts a quote character inside an alias body', () => {
    // Quake 2 has no in-quote escaping: a nested quote shifts every following
    // `;` split, so it corrupts the rest of the file, not just this line.
    for (const alias of allAliases) expect(alias.body).not.toContain('"')
  })

  it('quotes a body exactly once, and only when it carries a `;`', () => {
    for (const alias of allAliases) {
      const quotes = (alias.line.match(/"/g) ?? []).length
      if (alias.body.includes(';')) {
        // Unquoted, the engine would define the alias as the first command and
        // execute the rest immediately.
        expect(quotes).toBe(2)
        expect(alias.line).toBe(`alias ${alias.name} "${alias.body}"`)
      } else {
        expect(quotes).toBe(0)
        expect(alias.line).toBe(`alias ${alias.name} ${alias.body}`)
      }
    }
  })

  it('drops quotes a user wrote into a command instead of nesting them', () => {
    const result = generateLayerAliases(layer({ overrides: { '1': 'drop rl' } }), {
      '1': 'say "hi there"',
    })
    const helper = byName(result.aliases, 'drops_c1')
    expect(helper.line).toBe('alias drops_c1 say hi there')
    expect(byName(result.aliases, '-drops').body).toBe('bind 1 drops_c1')
  })
})

describe('generateLayerAliases — helper aliases', () => {
  it('hoists a command containing `;` and calls the helper from the body', () => {
    const result = generateLayerAliases(
      layer({ overrides: { '1': 'drop rl; say_team dropped rl', '2': 'drop rg' } }),
      {},
    )

    // Inline, the `;` would end the `bind` early and run the rest at write time.
    expect(byName(result.aliases, 'drops_c1').line).toBe(
      'alias drops_c1 "drop rl; say_team dropped rl"',
    )
    expect(byName(result.aliases, '+drops').body).toBe('bind 1 drops_c1; bind 2 drop rg')
    expect(byName(result.aliases, '+drops').body).not.toContain('say_team')
  })

  it('numbers helpers densely in override order, apply half before restore half', () => {
    const result = generateLayerAliases(
      layer({
        overrides: { '1': 'wave 1', '2': 'drop rl; drop rockets', '3': 'wave 2' },
      }),
      { '3': 'use bfg10k; +attack' },
    )

    expect(result.aliases.filter((alias) => /_c\d+$/.test(alias.name)).map((a) => a.name)).toEqual([
      'drops_c1',
      'drops_c2',
    ])
    expect(byName(result.aliases, 'drops_c1').body).toBe('drop rl; drop rockets')
    expect(byName(result.aliases, 'drops_c2').body).toBe('use bfg10k; +attack')
  })

  it('shares one helper between identical commands', () => {
    const result = generateLayerAliases(layer({ overrides: { '1': 'drop rl; drop rockets' } }), {
      '1': 'drop rl; drop rockets',
    })
    expect(result.aliases.filter((alias) => /_c\d+$/.test(alias.name))).toHaveLength(1)
    expect(byName(result.aliases, '+drops').body).toBe('bind 1 drops_c1')
    expect(byName(result.aliases, '-drops').body).toBe('bind 1 drops_c1')
  })

  it('flattens a newline or tab a command was pasted with', () => {
    const result = generateLayerAliases(
      layer({ overrides: { '1': 'drop rl\n\tdrop rockets' } }),
      {},
    )
    expect(byName(result.aliases, '+drops').line).toBe('alias +drops bind 1 drop rl drop rockets')
    for (const alias of result.aliases) expect(alias.line).not.toMatch(/[\n\t]/)
  })
})

describe('generateLayerAliases — line length', () => {
  const overrides = Object.fromEntries(
    Array.from({ length: 60 }, (_, i) => [`k${i}`, `some_rather_long_alias_name_${i}`]),
  )
  // Long base commands, so the restore half is long enough to chunk as well.
  const baseBinds = Object.fromEntries(
    Array.from({ length: 60 }, (_, i) => [`k${i}`, `another_rather_long_command_${i}`]),
  )

  it('splits a 60 key layer into chunk aliases that each stay under the line limit', () => {
    const result = generateLayerAliases(layer({ name: 'Huge', overrides }), {})
    const chunks = result.aliases.filter((alias) => /_p\d+$/.test(alias.name))

    expect(chunks.length).toBeGreaterThan(1)
    for (const alias of result.aliases) {
      // `.length` is the latin1 byte count (one byte per UTF-16 code unit),
      // which is what Cbuf_Execute's `char line[1024]` counts.
      expect(alias.line.length).toBeLessThan(MAX_LINE_BYTES)
    }
    // The parent must delegate to the chunks rather than inline everything.
    expect(byName(result.aliases, '+huge').body).toMatch(/^huge_p1(; huge_p\d+)+$/)
  })

  it('keeps one `_pN` sequence across both halves so the names cannot collide', () => {
    const result = generateLayerAliases(layer({ name: 'Huge', overrides }), baseBinds)
    const names = result.aliases.map((alias) => alias.name)
    expect(new Set(names).size).toBe(names.length)

    const applyChunks = byName(result.aliases, '+huge').body.split('; ')
    const restoreChunks = byName(result.aliases, '-huge').body.split('; ')
    expect(applyChunks.length).toBeGreaterThan(1)
    expect(restoreChunks.length).toBeGreaterThan(1)
    expect(applyChunks.some((name) => restoreChunks.includes(name))).toBe(false)
    for (const alias of result.aliases) expect(alias.line.length).toBeLessThan(MAX_LINE_BYTES)
  })

  it('keeps the toggle dispatch rewrite in the last chunk of each half', () => {
    const result = generateLayerAliases(
      layer({ name: 'Huge', mode: 'toggle', triggerKey: 'x', overrides }),
      baseBinds,
    )
    const onChunks = byName(result.aliases, 'huge_on').body.split('; ')
    const offChunks = byName(result.aliases, 'huge_off').body.split('; ')

    expect(byName(result.aliases, onChunks[onChunks.length - 1]!).body).toMatch(
      /alias huge huge_off$/,
    )
    expect(byName(result.aliases, offChunks[offChunks.length - 1]!).body).toMatch(
      /alias huge huge_on$/,
    )
  })
})

describe('generateLayerAliases — alias name budget', () => {
  const longName = 'A rather long layer label that nobody should type'
  const overrides = {
    ...Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`k${i}`, `some_rather_long_alias_name_${i}`]),
    ),
    z: 'drop rl; drop rockets',
  }

  for (const mode of ['hold', 'toggle'] as const) {
    it(`keeps every ${mode} alias name inside MAX_ALIAS_NAME`, () => {
      expect(longName.length).toBeGreaterThan(MAX_ALIAS_NAME)
      const result = generateLayerAliases(
        layer({ name: longName, mode, triggerKey: 'x', overrides }),
        { k3: 'say "hello"; wave 1' },
      )

      // Chunks and helpers are both present, so this covers the worst-case
      // member of the family, not just the parents.
      expect(result.aliases.some((alias) => /_p\d+$/.test(alias.name))).toBe(true)
      expect(result.aliases.some((alias) => /_c\d+$/.test(alias.name))).toBe(true)

      for (const alias of result.aliases) {
        // 32 minus the implicit terminator.
        expect(alias.name.length).toBeLessThanOrEqual(MAX_ALIAS_NAME - 1)
        expect(alias.name).toMatch(/^[+-]?[a-z0-9_]+$/)
      }
      expect(result.triggerBind.command.length).toBeLessThanOrEqual(MAX_ALIAS_NAME - 1)
    })
  }
})

describe('generateLayerAliases — issues', () => {
  it('warns about a key that carries a +command on the base layer', () => {
    const result = generateLayerAliases(layer({ overrides: { w: 'drop rl', '1': 'drop rg' } }), {
      w: '+forward',
      '1': 'weapnext',
    })

    // The matching `-forward` is looked up on release; once the layer remapped
    // the key it never fires and the player keeps walking.
    expect(result.issues).toContainEqual({
      key: 'layer.plusbind',
      level: 'warning',
      params: { key: 'w', command: '+forward' },
    })
    expect(result.issues.filter((issue) => issue.key === 'layer.plusbind')).toHaveLength(1)
  })

  it('errors when the layer remaps its own trigger key', () => {
    const result = generateLayerAliases(
      layer({ triggerKey: 'ALT', overrides: { ALT: 'drop rl' } }),
      {},
    )
    expect(result.issues).toContainEqual({
      key: 'layer.selfbind',
      level: 'error',
      params: { key: 'ALT' },
    })
    // Still generated: the UI blocks the save, the preview stays honest.
    expect(result.aliases.length).toBeGreaterThan(0)
  })

  it('warns about an empty layer and generates nothing for it', () => {
    const result = generateLayerAliases(layer({ overrides: { '1': '  ' } }), {})
    expect(result.issues).toEqual([{ key: 'layer.empty', level: 'warning' }])
    expect(result.aliases).toEqual([])
  })

  it('warns that the trigger bind overwrites an existing base bind', () => {
    const result = generateLayerAliases(
      layer({ name: 'Zoom', mode: 'toggle', triggerKey: 'v', overrides: { '1': 'use railgun' } }),
      { v: 'use blaster' },
    )
    expect(result.issues).toContainEqual({
      key: 'layer.triggerConflict',
      level: 'warning',
      params: { key: 'v', command: 'use blaster' },
    })
  })
})

describe('generateLayerAliases — determinism', () => {
  it('returns byte-identical output for the same input', () => {
    const input = layer({
      name: 'Drops',
      overrides: { '1': 'drop rl; drop rockets', '2': 'drop rg' },
    })
    const base = { '1': 'weapnext', '2': '+attack' }
    expect(generateLayerAliases(input, base)).toEqual(generateLayerAliases(input, base))
  })
})
