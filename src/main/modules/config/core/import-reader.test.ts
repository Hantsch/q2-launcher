import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ALIAS_LOOP_COUNT, MAX_EXEC_EXPANSIONS, readImportableConfig } from './import-reader'

/**
 * Every fixture below lives under `root`, a throwaway temp tree created per
 * test - this suite reads real files, so it must never be able to reach a real
 * installation.
 */
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'q2-launcher-import-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/**
 * Writes a fixture file. Strings go out as latin-1 (not UTF-8), so a
 * high-ASCII character in a fixture is exactly one byte on disk - the same
 * assumption the reader makes.
 */
async function write(relativePath: string, content: string | Buffer): Promise<void> {
  const target = join(root, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, typeof content === 'string' ? Buffer.from(content, 'latin1') : content)
}

function lines(...parts: string[]): string {
  return `${parts.join('\n')}\n`
}

describe('readImportableConfig', () => {
  it('reads config.cfg then autoexec.cfg, last assignment winning', async () => {
    await write('baseq2/config.cfg', lines('set sensitivity "3"', 'set name "from-config"'))
    await write('baseq2/autoexec.cfg', lines('set name "from-autoexec"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.cvars).toEqual({ sensitivity: '3', name: 'from-autoexec' })
    expect(result.filesRead).toEqual(['config.cfg', 'autoexec.cfg'])
    expect(result.warnings).toEqual([])
  })

  it('reads only the files that exist, without erroring on the missing one', async () => {
    await write('baseq2/config.cfg', lines('set cl_run "1"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.filesRead).toEqual(['config.cfg'])
    expect(result.cvars).toEqual({ cl_run: '1' })
    expect(result.warnings).toEqual([])
  })

  it('returns an empty result when the gamedir has no config files at all', async () => {
    await mkdir(join(root, 'baseq2'), { recursive: true })

    const result = await readImportableConfig(root, 'baseq2')

    expect(result).toEqual({
      cvars: {},
      cvarComments: {},
      cvarLines: {},
      binds: {},
      bindComments: {},
      bindLines: {},
      aliases: [],
      comments: [],
      unrecognized: [],
      filesRead: [],
      warnings: [],
      duplicateBinds: [],
      duplicateAliases: [],
    })
  })

  it('finds files case-insensitively and labels them with their on-disk name', async () => {
    await write('BASEQ2/Config.CFG', lines('set cl_run "1"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.filesRead).toEqual(['Config.CFG'])
    expect(result.cvars).toEqual({ cl_run: '1' })
  })

  it('expands exec inline at its position, so later parent lines still win', async () => {
    await write(
      'baseq2/config.cfg',
      lines('set name "before"', 'exec extra.cfg', 'set sensitivity "9"'),
    )
    await write('baseq2/extra.cfg', lines('set name "from-extra"', 'bind x "+attack"'))

    const result = await readImportableConfig(root, 'baseq2')

    // extra.cfg overrides the line above it ...
    expect(result.cvars.name).toBe('from-extra')
    // ... and is overridden by the line below it.
    expect(result.cvars.sensitivity).toBe('9')
    expect(result.binds).toEqual({ x: '+attack' })
    expect(result.filesRead).toEqual(['config.cfg', 'extra.cfg'])
    expect(result.warnings).toEqual([])
  })

  it('lets a line after the exec override what the exec’d file set', async () => {
    await write('baseq2/config.cfg', lines('exec extra.cfg', 'set name "wins"'))
    await write('baseq2/extra.cfg', lines('set name "loses"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.cvars.name).toBe('wins')
  })

  it('resolves an exec target in the chosen gamedir before baseq2', async () => {
    await write('xatrix/config.cfg', lines('exec shared.cfg'))
    await write('xatrix/shared.cfg', lines('set origin "xatrix"'))
    await write('baseq2/shared.cfg', lines('set origin "baseq2"'))

    const result = await readImportableConfig(root, 'xatrix')

    expect(result.cvars.origin).toBe('xatrix')
  })

  it('falls back to baseq2 when the chosen gamedir does not have the exec target', async () => {
    await write('xatrix/config.cfg', lines('exec shared.cfg'))
    await write('baseq2/shared.cfg', lines('bind mouse2 "+attack"'))

    const result = await readImportableConfig(root, 'xatrix')

    expect(result.binds).toEqual({ MOUSE2: '+attack' })
    expect(result.filesRead).toEqual(['config.cfg', 'shared.cfg'])
    expect(result.warnings).toEqual([])
  })

  it('preserves a missing exec as an unrecognized line and keeps importing', async () => {
    await write('baseq2/config.cfg', lines('set a "1"', 'exec nope.cfg', 'set b "2"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.cvars).toEqual({ a: '1', b: '2' })
    expect(result.warnings).toEqual([
      { file: 'config.cfg', line: 2, reason: 'exec-missing', target: 'nope.cfg' },
    ])
    expect(result.unrecognized).toEqual([{ file: 'config.cfg', line: 2, text: 'exec nope.cfg' }])
  })

  it('breaks a cyclic exec chain without hanging, keeping everything else', async () => {
    await write('baseq2/config.cfg', lines('exec a.cfg', 'set last "config"'))
    await write('baseq2/a.cfg', lines('set from_a "1"', 'exec b.cfg'))
    await write('baseq2/b.cfg', lines('set from_b "1"', 'exec a.cfg'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.cvars).toEqual({ from_a: '1', from_b: '1', last: 'config' })
    expect(result.warnings).toEqual([
      { file: 'b.cfg', line: 2, reason: 'exec-cyclic', target: 'a.cfg' },
    ])
    expect(result.unrecognized).toEqual([{ file: 'b.cfg', line: 2, text: 'exec a.cfg' }])
    expect(result.filesRead).toEqual(['config.cfg', 'a.cfg', 'b.cfg'])
  })

  it('allows the same file to be exec’d twice when that is not a cycle', async () => {
    await write(
      'baseq2/config.cfg',
      lines('exec shared.cfg', 'set name "middle"', 'exec shared.cfg'),
    )
    await write('baseq2/autoexec.cfg', lines('exec shared.cfg'))
    await write('baseq2/shared.cfg', lines('set name "shared"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.warnings).toEqual([])
    expect(result.cvars.name).toBe('shared')
    expect(result.filesRead).toEqual([
      'config.cfg',
      'shared.cfg',
      'shared.cfg',
      'autoexec.cfg',
      'shared.cfg',
    ])
  })

  it(`refuses an exec deeper than ${ALIAS_LOOP_COUNT} levels instead of recursing forever`, async () => {
    // config.cfg is depth 0, depth1.cfg is depth 1, ... depth16.cfg is depth
    // 16 - the last level allowed. Its exec of depth17.cfg (which exists, so
    // this can only be the depth guard) must be refused.
    await write('baseq2/config.cfg', lines('exec depth1.cfg'))
    const last = ALIAS_LOOP_COUNT + 1
    for (let level = 1; level <= last; level++) {
      const body = [`set d${level} "${level}"`]
      if (level < last) body.push(`exec depth${level + 1}.cfg`)
      await write(`baseq2/depth${level}.cfg`, lines(...body))
    }

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.cvars[`d${ALIAS_LOOP_COUNT}`]).toBe(String(ALIAS_LOOP_COUNT))
    expect(result.cvars[`d${last}`]).toBeUndefined()
    expect(result.warnings).toEqual([
      {
        file: `depth${ALIAS_LOOP_COUNT}.cfg`,
        line: 2,
        reason: 'exec-too-deep',
        target: `depth${last}.cfg`,
      },
    ])
    expect(result.unrecognized).toEqual([
      { file: `depth${ALIAS_LOOP_COUNT}.cfg`, line: 2, text: `exec depth${last}.cfg` },
    ])
  })

  it(
    `refuses further exec once ${MAX_EXEC_EXPANSIONS} files have been opened, so a wide ` +
      'fan-out cannot blow up combinatorially through the depth guard alone',
    async () => {
      // The depth guard alone would still allow this: none of these files are
      // cyclic (each is distinct, exec'd exactly once each), and none of them
      // nest more than one level deep. A branching config that repeats this
      // shape at every level of a 16-deep chain would open up to
      // branchFactor^16 files - the total-work budget is what actually stops
      // that, not depth or the cycle guard. A flat fan-out (this test) proves
      // the counter fires without needing to spin up an exponential fixture
      // tree, which the fix specifically exists to make impractical anyway.
      const fanCount = MAX_EXEC_EXPANSIONS + 5
      const execLines = Array.from({ length: fanCount }, (_, i) => `exec fan${i}.cfg`)
      await write('baseq2/config.cfg', lines(...execLines))
      await Promise.all(
        Array.from({ length: fanCount }, (_, i) =>
          write(`baseq2/fan${i}.cfg`, lines(`set f${i} "1"`)),
        ),
      )

      const result = await readImportableConfig(root, 'baseq2')

      // config.cfg itself counts toward the budget too, so strictly fewer
      // than `fanCount` of the fan-out targets can have been opened.
      const budgetWarnings = result.warnings.filter((w) => w.reason === 'exec-budget-exceeded')
      expect(budgetWarnings.length).toBeGreaterThan(0)
      expect(result.filesRead.length).toBeLessThanOrEqual(MAX_EXEC_EXPANSIONS)
      // Some fan-out targets were opened (proves the budget isn't overly
      // strict) and some were refused (proves it actually caps total work).
      expect(result.filesRead.length).toBeGreaterThan(1)
      expect(budgetWarnings.length + result.filesRead.length - 1).toBe(fanCount)
    },
  )

  it('folds bind, unbind and unbindall in stream order', async () => {
    await write(
      'baseq2/config.cfg',
      lines(
        'bind w "+forward"',
        'bind s "+back"',
        'bind t "say hi"',
        'unbind s',
        'unbindall',
        'bind space "+moveup"',
      ),
    )

    const result = await readImportableConfig(root, 'baseq2')

    // Everything before the unbindall is gone; only what follows it survives.
    expect(result.binds).toEqual({ SPACE: '+moveup' })
  })

  it('lets a bind after an unbind re-add the key', async () => {
    await write('baseq2/config.cfg', lines('bind w "+forward"', 'unbind w', 'bind w "+back"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.binds).toEqual({ w: '+back' })
    expect(result.duplicateBinds).toEqual([])
  })

  it('reports a key bound twice with no unbind in between as a duplicate', async () => {
    await write('baseq2/config.cfg', lines('bind w "+forward"', 'bind w "+back"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.binds).toEqual({ w: '+back' })
    expect(result.duplicateBinds).toEqual([{ key: 'w', file: 'config.cfg', line: 2 }])
  })

  it('finds a duplicate bind across an exec’d file too', async () => {
    await write('baseq2/config.cfg', lines('bind w "+forward"', 'exec extra.cfg'))
    await write('baseq2/extra.cfg', lines('bind w "+back"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.duplicateBinds).toEqual([{ key: 'w', file: 'extra.cfg', line: 1 }])
  })

  it('lets an unbindall inside an exec’d file clear binds from the parent', async () => {
    await write('baseq2/config.cfg', lines('bind w "+forward"', 'exec reset.cfg', 'bind s "+back"'))
    await write('baseq2/reset.cfg', lines('unbindall', 'bind x "+attack"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.binds).toEqual({ x: '+attack', s: '+back' })
  })

  it('folds alias definitions, last definition winning, without merging bodies', async () => {
    await write(
      'baseq2/config.cfg',
      lines('alias qq "quit"', 'alias +slow "cl_run 0"', 'alias qq "disconnect"'),
    )

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.aliases).toEqual([
      { name: 'qq', body: 'disconnect', file: 'config.cfg', line: 3, comment: '' },
      { name: '+slow', body: 'cl_run 0', file: 'config.cfg', line: 2, comment: '' },
    ])
    expect(result.duplicateAliases).toEqual([{ name: 'qq', file: 'config.cfg', line: 3 }])
  })

  it('finds a duplicate alias across two different files, last definition winning', async () => {
    await write('baseq2/config.cfg', lines('alias qq "quit"', 'exec extra.cfg'))
    await write('baseq2/extra.cfg', lines('alias qq "disconnect"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.aliases).toEqual([
      { name: 'qq', body: 'disconnect', file: 'extra.cfg', line: 1, comment: '' },
    ])
    expect(result.duplicateAliases).toEqual([{ name: 'qq', file: 'extra.cfg', line: 1 }])
  })

  it('lets an alias defined in an exec’d file resolve for a bind in the parent file', async () => {
    await write(
      'baseq2/config.cfg',
      lines('exec aliases.cfg', 'bind mouse2 "quickquit"'),
    )
    await write('baseq2/aliases.cfg', lines('alias quickquit "quit"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.aliases).toEqual([
      { name: 'quickquit', body: 'quit', file: 'aliases.cfg', line: 1, comment: '' },
    ])
    expect(result.binds).toEqual({ MOUSE2: 'quickquit' })
  })

  it('captures aliases both before and after an unbindall, unaffected by it', async () => {
    await write(
      'baseq2/config.cfg',
      lines('alias before "say hi"', 'bind w "+forward"', 'unbindall', 'alias after "say bye"'),
    )

    const result = await readImportableConfig(root, 'baseq2')

    // `unbindall` clears the bind accumulator only - aliases are a separate
    // stream and both survive regardless of which side of it they are on.
    expect(result.binds).toEqual({})
    expect(result.aliases).toEqual([
      { name: 'before', body: 'say hi', file: 'config.cfg', line: 1, comment: '' },
      { name: 'after', body: 'say bye', file: 'config.cfg', line: 4, comment: '' },
    ])
  })

  it('keeps unrecognized lines in document order across files, tagged with file and line', async () => {
    await write(
      'baseq2/config.cfg',
      lines('alias qq "quit"', 'exec extra.cfg', '// a trailing note', 'set a "1"'),
    )
    await write('baseq2/extra.cfg', lines('set b "2"', '+mlook'))
    await write('baseq2/autoexec.cfg', lines('some garbage line'))

    const result = await readImportableConfig(root, 'baseq2')

    // `alias qq "quit"` is now a real alias (story 041), not an unrecognized line.
    // `// a trailing note` is a whole-line comment (story 042 D3): it still
    // lands in `unrecognized` unchanged (AC 8), and is ADDITIONALLY folded
    // into `comments`.
    expect(result.unrecognized).toEqual([
      { file: 'extra.cfg', line: 2, text: '+mlook' },
      { file: 'config.cfg', line: 3, text: '// a trailing note' },
      { file: 'autoexec.cfg', line: 1, text: 'some garbage line' },
    ])
    expect(result.comments).toEqual([{ file: 'config.cfg', line: 3, text: ' a trailing note' }])
    expect(result.aliases).toEqual([
      { name: 'qq', body: 'quit', file: 'config.cfg', line: 1, comment: '' },
    ])
  })

  it('reads high-ASCII bytes as latin-1 and round-trips them byte for byte', async () => {
    // 0xE9 and 0xFF are written as raw single bytes; decoded as UTF-8 they
    // would collapse into replacement characters and the round trip would be
    // lost.
    const bytes = Buffer.concat([
      Buffer.from('set name "Pl', 'latin1'),
      Buffer.from([0xe9]),
      Buffer.from('yer"\nalias hi "say h', 'latin1'),
      Buffer.from([0xff]),
      Buffer.from('!"\n', 'latin1'),
    ])
    await write('baseq2/config.cfg', bytes)

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.cvars.name).toBe('Pléyer')
    // `alias hi "..."` is now a real alias (story 041), not an unrecognized line.
    expect(result.unrecognized).toEqual([])
    expect(result.aliases).toEqual([
      { name: 'hi', body: 'say hÿ!', file: 'config.cfg', line: 2, comment: '' },
    ])
    // The bytes, not just the characters: what came off disk re-encodes to
    // exactly what was written.
    expect(Buffer.from(result.cvars.name, 'latin1')).toEqual(
      Buffer.concat([
        Buffer.from('Pl', 'latin1'),
        Buffer.from([0xe9]),
        Buffer.from('yer', 'latin1'),
      ]),
    )
    expect(Buffer.from(result.aliases[0].body, 'latin1').subarray(-4)).toEqual(
      Buffer.concat([Buffer.from(' h', 'latin1'), Buffer.from([0xff]), Buffer.from('!', 'latin1')]),
    )
  })

  it('does not let an exec target escape the installation root', async () => {
    await write('outside.cfg', lines('set escaped "1"'))
    await write('baseq2/config.cfg', lines('exec ../outside.cfg'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.cvars).toEqual({})
    expect(result.warnings).toEqual([
      { file: 'config.cfg', line: 1, reason: 'exec-missing', target: '../outside.cfg' },
    ])
  })

  it('treats a directory that matches the exec target as missing', async () => {
    await mkdir(join(root, 'baseq2', 'folder.cfg'), { recursive: true })
    await write('baseq2/config.cfg', lines('exec folder.cfg'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.warnings.map((w) => w.reason)).toEqual(['exec-missing'])
    expect(result.filesRead).toEqual(['config.cfg'])
  })

  it('expands an exec that shares its line with other commands (documented tie-break)', async () => {
    await write('baseq2/config.cfg', lines('set name "before"; exec extra.cfg'))
    await write('baseq2/extra.cfg', lines('set name "from-extra"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.cvars.name).toBe('from-extra')
    expect(result.filesRead).toEqual(['config.cfg', 'extra.cfg'])
  })

  it('cannot be poisoned by a cvar or key literally called __proto__', async () => {
    await write('baseq2/config.cfg', lines('set __proto__ "polluted"', 'bind __proto__ "quit"'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(Object.getPrototypeOf(result.cvars)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(result.cvars, '__proto__')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(result.binds, '__proto__')).toBe(true)
  })

  it('keeps the winning cvar/bind comment across a last-assignment-wins fold', async () => {
    await write(
      'baseq2/config.cfg',
      lines('set name "first" // old note', 'set name "second" // new note'),
    )

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.cvars).toEqual({ name: 'second' })
    expect(result.cvarComments).toEqual({ name: ' new note' })
  })

  it('carries a cvar/bind comment through exec folding, the exec’d definition winning', async () => {
    await write(
      'baseq2/config.cfg',
      lines('set name "before" // parent note', 'exec extra.cfg', 'bind w "+forward" // parent bind'),
    )
    await write('baseq2/extra.cfg', lines('set name "from-extra" // extra note'))

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.cvarComments).toEqual({ name: ' extra note' })
    expect(result.bindComments).toEqual({ w: ' parent bind' })
  })

  it('clears a bind’s comment along with the bind itself on unbind/unbindall', async () => {
    await write(
      'baseq2/config.cfg',
      lines('bind w "+forward" // note', 'unbind w', 'bind s "+back" // kept', 'unbindall'),
    )

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.binds).toEqual({})
    expect(result.bindComments).toEqual({})
  })

  it('keeps the winning alias definition’s own comment, not an earlier one', async () => {
    await write(
      'baseq2/config.cfg',
      lines('alias qq "quit" // first', 'alias qq "disconnect" // second'),
    )

    const result = await readImportableConfig(root, 'baseq2')

    expect(result.aliases).toEqual([
      { name: 'qq', body: 'disconnect', file: 'config.cfg', line: 2, comment: ' second' },
    ])
  })
})
