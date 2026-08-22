import { describe, expect, it } from 'vitest'
import type { Finding } from './validation'
import {
  STRUCTURE_MESSAGE_PREFIX,
  validateStructure,
  type StructureFile,
} from './validate-structure'

function file(lines: string[], name = 'q2l-profile-test.cfg'): StructureFile {
  // Rendered files always end in a single trailing newline (see render.ts), so
  // the fixtures do too - the empty last line that produces must never trip a
  // rule.
  return { name, content: `${lines.join('\n')}\n` }
}

function rules(findings: Finding[]): string[] {
  return findings.map((finding) => finding.messageKey.slice(STRUCTURE_MESSAGE_PREFIX.length))
}

function only(findings: Finding[], rule: string): Finding[] {
  return findings.filter((finding) => finding.messageKey === `${STRUCTURE_MESSAGE_PREFIX}${rule}`)
}

/**
 * Short `set` lines until the rendered file just clears `bytes`, and no
 * further: the size rules have three bands (ok / warn / over) whose boundaries
 * sit close together on vanilla's 8190-byte budget, so a helper that
 * overshoots by a few hundred bytes would quietly test the wrong band. Lines
 * are added one at a time and their real lengths accumulated, so nothing here
 * depends on guessing the per-line byte count.
 *
 * Every line stays far below 1024 bytes and carries exactly one quoted value,
 * so the only rule such a file can trip is the total-size one.
 */
function fileOfAtLeast(bytes: number, name = 'q2l-profile-big.cfg'): StructureFile {
  const lines: string[] = []
  // Each line costs its own bytes plus one newline: the separators between
  // lines plus the single trailing one add up to exactly one per line.
  let size = 0
  while (size < bytes) {
    const line = `set cl_pad${String(lines.length).padStart(4, '0')} "${'v'.repeat(40)}"`
    lines.push(line)
    size += line.length + 1
  }

  const built = file(lines, name)
  expect(built.content.length).toBe(size)
  expect(built.content.length).toBeGreaterThanOrEqual(bytes)
  return built
}

describe('validateStructure - alias names', () => {
  it('flags a 40-character alias name (MAX_ALIAS_NAME is 32, so 31 is the usable maximum)', () => {
    const name = 'a'.repeat(40)
    const findings = validateStructure([file([`alias ${name} weapnext`])], 'r1q2')

    expect(only(findings, 'aliasTooLong')).toHaveLength(1)
    const [found] = only(findings, 'aliasTooLong')
    expect(found.level).toBe('error')
    expect(found.subject).toEqual({ kind: 'alias', id: name })
    expect(found.params).toMatchObject({ name, length: 40, max: 31 })
    expect(found.engine).toBe('r1q2')
  })

  it('leaves a 31-character alias name alone', () => {
    const findings = validateStructure([file([`alias ${'a'.repeat(31)} weapnext`])], 'r1q2')

    expect(rules(findings)).toEqual([])
  })

  it('flags an alias name containing a space, quoted name and all', () => {
    // The name has to be read the way COM_Parse reads it: `alias "drop rl" x`
    // defines an alias literally called `drop rl`, which no key can ever
    // invoke, because when it is typed the engine stops reading the name at
    // the space.
    const findings = validateStructure([file(['alias "drop rl" weapnext'])], 'r1q2')

    expect(only(findings, 'aliasSpace')).toHaveLength(1)
    expect(only(findings, 'aliasSpace')[0].subject).toEqual({ kind: 'alias', id: 'drop rl' })
  })

  it('flags the second definition of a name, case-insensitively, and only the second', () => {
    const findings = validateStructure(
      [file(['alias Zoom "set fov 30"']), file(['alias zoom "set fov 90"'], 'autoexec.cfg')],
      'r1q2',
    )

    // Duplicates are found across the combined set of files, not per file.
    expect(only(findings, 'aliasDuplicate')).toHaveLength(1)
    const [found] = only(findings, 'aliasDuplicate')
    expect(found.level).toBe('error')
    expect(found.subject).toEqual({ kind: 'alias', id: 'zoom' })
    expect(found.params).toMatchObject({ file: 'autoexec.cfg', line: 1 })
  })
})

describe('validateStructure - alias depth and cycles', () => {
  it('says nothing about a 3-deep, non-cyclic chain', () => {
    const findings = validateStructure(
      [file(['alias a b', 'alias b c', 'alias c "some command"'])],
      'r1q2',
    )

    expect(rules(findings)).toEqual([])
  })

  it('flags a two-alias cycle once, on the alphabetically first member', () => {
    const findings = validateStructure([file(['alias b a', 'alias a b'])], 'r1q2')

    expect(only(findings, 'aliasCycle')).toHaveLength(1)
    const [found] = only(findings, 'aliasCycle')
    expect(found.level).toBe('error')
    expect(found.subject).toEqual({ kind: 'alias', id: 'a' })
    expect(found.params).toMatchObject({ chain: 'a -> b -> a' })
    // A cycle is not additionally reported as excess depth.
    expect(only(findings, 'aliasDepth')).toEqual([])
  })

  it('flags a self-referencing alias', () => {
    const findings = validateStructure([file(['alias loop "wait; loop"'])], 'r1q2')

    expect(only(findings, 'aliasCycle')).toHaveLength(1)
    expect(only(findings, 'aliasCycle')[0].params).toMatchObject({ chain: 'loop -> loop' })
  })

  it('finds a ring even when it sits beside an unrelated chain, with nothing leading into it', () => {
    const findings = validateStructure(
      [file(['alias r1 r2', 'alias r2 r3', 'alias r3 r1', 'alias top mid', 'alias mid "wait"'])],
      'r1q2',
    )

    expect(only(findings, 'aliasCycle')).toHaveLength(1)
    expect(only(findings, 'aliasCycle')[0].subject).toEqual({ kind: 'alias', id: 'r1' })
  })

  it('flags a chain nested deeper than ALIAS_LOOP_COUNT once, at its root', () => {
    const lines: string[] = []
    for (let i = 0; i < 20; i++) lines.push(`alias a${i} ${i === 19 ? 'weapnext' : `a${i + 1}`}`)
    const findings = validateStructure([file(lines)], 'r1q2')

    expect(only(findings, 'aliasDepth')).toHaveLength(1)
    const [found] = only(findings, 'aliasDepth')
    expect(found.subject).toEqual({ kind: 'alias', id: 'a0' })
    expect(found.params).toMatchObject({ depth: 20, max: 16 })
  })

  it('leaves a chain of exactly 16 alone', () => {
    const lines: string[] = []
    for (let i = 0; i < 16; i++) lines.push(`alias a${i} ${i === 15 ? 'weapnext' : `a${i + 1}`}`)
    const findings = validateStructure([file(lines)], 'r1q2')

    expect(rules(findings)).toEqual([])
  })

  it('follows a +name/-name reference to the alias family it belongs to', () => {
    // `zoom`'s body calls `-zoom`, which is not defined on its own and is no
    // engine command either; the sign is stripped and the edge lands back on
    // `zoom`, closing a cycle.
    const findings = validateStructure([file(['alias zoom "set fov 30; -zoom"'])], 'r1q2')

    expect(only(findings, 'aliasCycle')).toHaveLength(1)
  })

  /**
   * Story 039 review fix - the readable-name flip makes an alias named after
   * its own continuous command an everyday shape, and the sign-stripped
   * fallback above used to read it as a self-cycle.
   */
  it('does not read an alias whose body is its own +command as a cycle', () => {
    const findings = validateStructure([file(['alias forward +forward', 'bind w forward'])], 'r1q2')

    expect(only(findings, 'aliasCycle')).toEqual([])
    expect(rules(findings)).toEqual([])
  })

  it('does not read the -command half as a cycle either', () => {
    const findings = validateStructure([file(['alias attack -attack'])], 'r1q2')

    expect(only(findings, 'aliasCycle')).toEqual([])
  })

  it('still flags a self-edge through a sign the engine does not register as a command', () => {
    const findings = validateStructure([file(['alias mycombo "+mycombo"'])], 'r1q2')

    expect(only(findings, 'aliasCycle')).toHaveLength(1)
  })

  it('still follows a non-self sign-stripped edge into another alias family', () => {
    const findings = validateStructure([file(['alias a "-drops"', 'alias drops "a"'])], 'r1q2')

    expect(only(findings, 'aliasCycle')).toHaveLength(1)
  })

  /**
   * Story 039, fourth pass - defect 1. The carve-out above used to be scoped to
   * the *visited node's own key*, so it only ever recognised the shape when the
   * signed body token sat in the alias that carries the name it strips down to.
   * `alias-render.ts#renderActionAlias` splits a long action into a `_p<n>`
   * chunk family, and there the `+forward` token sits in `forward_p1` while the
   * name it strips to (`forward`) is the *family's root* - so the sign-stripped
   * fallback drew `forward_p1 -> forward`, the root's own body drew
   * `forward -> forward_p1`, and a perfectly legal split action was reported as
   * an error-level cycle.
   */
  it('does not read a chunked family whose part body is its own +command as a cycle', () => {
    const findings = validateStructure(
      [
        file([
          'alias forward_p1 "+forward; say_team going in"',
          'alias forward_p2 "wait; centerview"',
          'alias forward "forward_p1; forward_p2"',
          'bind w forward',
        ]),
      ],
      'r1q2',
    )

    expect(only(findings, 'aliasCycle')).toEqual([])
    expect(rules(findings)).toEqual([])
  })
})

describe('validateStructure - line length', () => {
  it('flags a line of 1024 bytes or more and names the cvar it belongs to', () => {
    const findings = validateStructure([file([`set filler "${'x'.repeat(1100)}"`])], 'r1q2')

    expect(only(findings, 'lineTooLong')).toHaveLength(1)
    const [found] = only(findings, 'lineTooLong')
    expect(found.level).toBe('error')
    expect(found.subject).toEqual({ kind: 'cvar', id: 'filler' })
    expect(found.params).toMatchObject({ line: 1, bytes: 1113, limit: 1024 })
  })

  it('flags a line of exactly 1024 bytes but not one of 1023', () => {
    const head = 'bind F1 "'.length + 1 // the line is `bind F1 "<value>"`
    const at1024 = `bind F1 "${'x'.repeat(1024 - head)}"`
    const at1023 = `bind F1 "${'x'.repeat(1023 - head)}"`
    expect(at1024).toHaveLength(1024)
    expect(at1023).toHaveLength(1023)

    expect(only(validateStructure([file([at1024])], 'r1q2'), 'lineTooLong')).toHaveLength(1)
    expect(only(validateStructure([file([at1023])], 'r1q2'), 'lineTooLong')).toEqual([])
    // The subject of a bind line is the key, not the file.
    expect(only(validateStructure([file([at1024])], 'r1q2'), 'lineTooLong')[0].subject).toEqual({
      kind: 'bind',
      id: 'F1',
    })
  })
})

describe('validateStructure - quoting', () => {
  it('flags a cvar value that carries a quote of its own', () => {
    // The realistic vector: a text-kind cvar typed in the Settings tab is not
    // sanitized against quotes before render.ts wraps it in a pair of them.
    const findings = validateStructure([file(['set greeting "hello "world""'])], 'r1q2')

    expect(only(findings, 'quoteBroken')).toHaveLength(1)
    const [found] = only(findings, 'quoteBroken')
    expect(found.level).toBe('error')
    expect(found.subject).toEqual({ kind: 'cvar', id: 'greeting' })
    expect(found.params).toMatchObject({ line: 1, quotes: 4 })
  })

  it('flags a message alias body whose text carries a quote', () => {
    const findings = validateStructure(
      [file(['alias q2l_greet "say I said "hi" to them""'])],
      'r1q2',
    )

    expect(only(findings, 'quoteBroken')).toHaveLength(1)
    expect(only(findings, 'quoteBroken')[0].subject).toEqual({ kind: 'alias', id: 'q2l_greet' })
  })

  it('flags a value whose closing quote went missing', () => {
    const findings = validateStructure([file(['bind F1 "say hello'])], 'r1q2')

    expect(only(findings, 'quoteBroken')).toHaveLength(1)
    expect(only(findings, 'quoteBroken')[0].params).toMatchObject({ quotes: 1 })
  })

  it('accepts every shape render.ts actually produces', () => {
    const findings = validateStructure(
      [
        file([
          '// q2-launcher profile p1 - generated, do not edit',
          'set name "Bjørn"',
          'set cl_maxfps "125"',
          'alias +drops "bind 1 drop rl; bind 2 drop rg"',
          'alias -drops "bind 1 weapnext; bind 2 weapprev"',
          'alias greet "say Hello there"',
          'bind 1 "weapnext"',
          'bind MOUSE1 "+attack"',
          'bind ALT +drops',
        ]),
        file(
          [
            '// q2-launcher profile p1 - generated, do not edit',
            'exec q2l-profile-p1.cfg',
            'bind F5 "exec q2l-profile-p2.cfg"',
          ],
          'autoexec.cfg',
        ),
      ],
      'r1q2',
    )

    expect(rules(findings)).toEqual([])
  })

  it('does not mistake a URL in a value for a comment, nor a quoted semicolon for a separator', () => {
    const findings = validateStructure(
      [file(['set cl_motd "see http://example.com"', 'alias combo "wait; weapnext"'])],
      'r1q2',
    )

    expect(rules(findings)).toEqual([])
  })
})

describe('validateStructure - total size, per engine', () => {
  const NINE_KB = 9 * 1024

  it('reports a 9 KB file as discarded whole on vanilla (8190-byte buffer)', () => {
    const findings = validateStructure([fileOfAtLeast(NINE_KB)], 'vanilla')

    expect(rules(findings)).toEqual(['sizeOverDiscarded'])
    const [found] = findings
    expect(found.level).toBe('error')
    expect(found.subject).toEqual({ kind: 'file', id: 'q2l-profile-big.cfg' })
    expect(found.params).toMatchObject({ limit: 8190 })
    expect(found.params?.bytes).toBeGreaterThanOrEqual(NINE_KB)
  })

  it('says nothing about the same 9 KB file on r1q2 (65534-byte buffer)', () => {
    expect(rules(validateStructure([fileOfAtLeast(NINE_KB)], 'r1q2'))).toEqual([])
  })

  it('says nothing about the same 9 KB file on q2pro (65535-byte compressed buffer)', () => {
    expect(rules(validateStructure([fileOfAtLeast(NINE_KB)], 'q2pro'))).toEqual([])
  })

  it('warns rather than errors while a vanilla file is merely approaching the limit', () => {
    const findings = validateStructure([fileOfAtLeast(7000)], 'vanilla')

    expect(rules(findings)).toEqual(['sizeWarn'])
    expect(findings[0].level).toBe('warning')
    expect(findings[0].params?.percent).toBeGreaterThan(80)
  })

  it('measures q2pro after comment stripping, so a file r1q2 truncates still fits', () => {
    // ~55 KB of comments and nothing else, plus enough real content to clear
    // r1q2's raw 65534-byte budget: COM_Compress removes the comments entirely
    // before q2pro compares, so the same file is fatal on one engine and fine
    // on the other.
    const lines: string[] = []
    for (let i = 0; i < 1400; i++) lines.push(`// filler comment line ${i} - not a command at all`)
    const commented = file(lines, 'q2l-profile-commented.cfg')
    expect(commented.content.length).toBeGreaterThan(65534)

    const onR1q2 = validateStructure([commented], 'r1q2')
    expect(rules(onR1q2)).toEqual(['sizeOverTruncated'])
    expect(onR1q2[0].level).toBe('error')
    expect(onR1q2[0].params).toMatchObject({ limit: 65534 })

    expect(rules(validateStructure([commented], 'q2pro'))).toEqual([])
  })

  it('reports each file separately', () => {
    const findings = validateStructure(
      [fileOfAtLeast(NINE_KB, 'big-a.cfg'), fileOfAtLeast(NINE_KB, 'big-b.cfg')],
      'vanilla',
    )

    expect(findings.map((f) => f.subject.id)).toEqual(['big-a.cfg', 'big-b.cfg'])
    expect(new Set(findings.map((f) => f.id)).size).toBe(2)
  })
})

describe('validateStructure - an engine with no source-cited limits', () => {
  it('reports no size or line finding, but still checks the aliases', () => {
    const big = fileOfAtLeast(9 * 1024)
    const findings = validateStructure(
      [
        {
          name: 'q2l-profile-big.cfg',
          content: `${big.content}set filler "${'x'.repeat(1100)}"\nalias ${'a'.repeat(40)} weapnext\n`,
        },
      ],
      'yquake2',
    )

    // Neither r1q2's buffer nor its line limit may be attributed to yquake2.
    expect(rules(findings)).toEqual(['aliasTooLong'])
    expect(findings[0].engine).toBe('yquake2')
  })
})
