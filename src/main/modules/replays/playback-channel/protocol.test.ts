import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildControlFile,
  buildLoopCfg,
  buildStopFile,
  checkLine,
  encodeControlCommand,
  linuxLaunchArgs,
  parseDemoPos,
  parseEngineLine,
  windowsLaunchArgs,
} from './protocol'

const FIXTURE = readFileSync(join(__dirname, '__fixtures__', 'q2pro-logfile.log'), 'utf8')
  .split('\n')
  .filter((l) => l.length > 0)

describe('parseEngineLine', () => {
  it('classifies every line of the recorded Q2PRO logfile', () => {
    expect(FIXTURE.length).toBeGreaterThan(50)
    const counts = { pos: 0, ack: 0, finished: 0, other: 0 }
    for (const line of FIXTURE) {
      const text = line.replace(/^\[[^\]]+\] /, '')
      const parsed = parseEngineLine(line)
      counts[parsed.kind]++
      if (text.startsWith('POS')) expect(parsed.kind).toBe('pos')
      else if (text.startsWith('ACK ')) expect(parsed).toEqual({ kind: 'ack', seq: Number(text.slice(4)) })
      else if (text === 'Demo finished') expect(parsed.kind).toBe('finished')
      else expect(parsed.kind).toBe('other')
    }
    expect(counts.finished).toBe(1)
    expect(counts.ack).toBeGreaterThan(0)
    expect(counts.other).toBeGreaterThan(0)
  })

  it('reads an empty POS as null and a full one as milliseconds', () => {
    expect(parseEngineLine('[2026-09-27 18:16] POS')).toEqual({ kind: 'pos', positionMs: null })
    expect(parseEngineLine('[2026-09-27 18:36] POS 1:11.4')).toEqual({ kind: 'pos', positionMs: 71400 })
    expect(parseEngineLine('POS 1')).toEqual({ kind: 'pos', positionMs: null })
    expect(parseEngineLine('[2026-09-27 18:22] ACK 3')).toEqual({ kind: 'ack', seq: 3 })
  })
})

describe('parseDemoPos', () => {
  it('parses m:ss.f and h:mm:ss.f', () => {
    expect(parseDemoPos('0:02.4')).toBe(2400)
    expect(parseDemoPos('5:02.8')).toBe(302800)
    expect(parseDemoPos('1:02:03.4')).toBe(3723400)
  })
  it('rejects garbage', () => {
    for (const bad of ['', 'abc', '1', '1:2.4', '1:02', '1:02.', '::']) expect(parseDemoPos(bad)).toBeNull()
  })
})

describe('checkLine', () => {
  it('accepts console commands', () => {
    for (const l of ['seek +10', 'seek 50%', 'cmd chase 3', 'pause; timescale 2']) expect(checkLine(l).ok).toBe(true)
  })
  it('accepts quotes, semicolons and dollar signs as legal console syntax', () => {
    for (const l of ['say "x"', 'bind x "+attack"', 'echo a; echo b', 'echo $cl_demopos // c']) {
      expect(checkLine(l)).toEqual({ ok: true, value: undefined })
    }
  })

  it('rejects empty, newlines and control characters', () => {
    for (const l of ['', 'a\nb', 'a\rb', '\u0007', 'a\u007fb']) {
      expect(checkLine(l)).toEqual({ ok: false, error: { key: 'replays.playback.error.invalidCommand' } })
    }
  })
})

describe('files and launch args', () => {
  it('builds the guarded control file', () => {
    expect(buildControlFile(4)).toEqual([
      'echo POS $cl_demopos',
      'if $q2l_seq != 4 then "exec q2l_cmd_4.cfg; set q2l_seq 4; echo ACK 4"',
    ])
    expect(buildControlFile(null)).toEqual(['echo POS $cl_demopos'])
  })
  it('a console line cannot break out of the control file', () => {
    // The fixed template for seq N, spelled out: only N varies, never anything from the line.
    const template = (n: number): string =>
      `echo POS $cl_demopos\nif $q2l_seq != ${n} then "exec q2l_cmd_${n}.cfg; set q2l_seq ${n}; echo ACK ${n}"\n`
    const hostile = ['say "x"; alias loop ""', 'a" ; set seq 99 ; "', 'echo //x', '$seq', '}']
    for (const [i, line] of hostile.entries()) {
      for (const seq of [1, i + 7, 1234]) {
        const encoded = encodeControlCommand(seq, line)
        expect(encoded.controlText).toBe(template(seq))
        expect(encoded.controlText).not.toContain(line)
        expect(encoded.commandFileName).toBe(`q2l_cmd_${seq}.cfg`)
        expect(encoded.commandText).toBe(`${line}\n`)
      }
    }
  })
  it('builds the loop and stop files', () => {
    expect(buildLoopCfg()).toEqual([
      'set q2l_seq 0',
      'alias q2l_loop "exec q2l_ctl.cfg; wait 5; q2l_loop"',
      'q2l_loop',
    ])
    expect(buildLoopCfg(3)[1]).toContain('wait 3;')
    expect(buildStopFile()).toEqual(['alias q2l_loop ""'])
  })
  it('never puts +demo in the args and keeps the loop exec after the demo', () => {
    const w = windowsLaunchArgs()
    const l = linuxLaunchArgs()
    for (const a of [...w.argsBeforeDemo, ...w.argsAfterDemo, ...l.argsBeforeDemo, ...l.argsAfterDemo]) {
      expect(a).not.toBe('+demo')
    }
    expect(w.argsAfterDemo).toEqual(['+exec', 'q2l_loop.cfg'])
    expect(w.argsBeforeDemo).not.toContain('q2l_loop.cfg')
    expect(l.argsBeforeDemo).toEqual(['+set', 'sys_console', '1'])
    expect(l.argsAfterDemo).toEqual([])
  })
})
