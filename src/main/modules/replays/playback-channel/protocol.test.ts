import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACK_TO_WINDOW_COMMAND, guardDemoCommand } from '@shared/replays/demo-guard'
import { createCbufSim } from '../../../../test-support/q2-cbuf-sim'
import {
  buildBackToWindowCfg,
  buildControlFile,
  buildEnterFullscreenLines,
  buildLoopCfg,
  buildStopFile,
  checkLine,
  encodeControlCommand,
  LOOP_WAIT_FRAMES,
  linuxLaunchArgs,
  parseDemoPos,
  parseEngineLine,
  toCfgText,
  windowsLaunchArgs,
} from './protocol'

const FIXTURE = readFileSync(join(__dirname, '__fixtures__', 'q2pro-logfile.log'), 'utf8')
  .split(/\r?\n/)
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
    expect(parseEngineLine('[2026-09-27 18:16] POS')).toEqual({ kind: 'pos', positionMs: null, fullscreen: null, paused: null })
    expect(parseEngineLine('[2026-09-27 18:36] POS 1:11.4')).toEqual({ kind: 'pos', positionMs: 71400, fullscreen: null, paused: null })
    expect(parseEngineLine('POS 1')).toEqual({ kind: 'pos', positionMs: null, fullscreen: null, paused: null })
    expect(parseEngineLine('POS 1:11.4 FS 1')).toEqual({ kind: 'pos', positionMs: 71400, fullscreen: true, paused: null })
    expect(parseEngineLine('[2026-09-27 18:36] POS 0:05.0 FS 0')).toEqual({
      kind: 'pos',
      positionMs: 5000,
      fullscreen: false,
      paused: null,
    })
    expect(parseEngineLine('POS FS 0')).toEqual({ kind: 'pos', positionMs: null, fullscreen: false, paused: null })
    expect(parseEngineLine('POS  FS 1')).toEqual({ kind: 'pos', positionMs: null, fullscreen: true, paused: null })
    expect(parseEngineLine('POS 1:11.4 FS')).toEqual({ kind: 'pos', positionMs: 71400, fullscreen: null, paused: null })
    expect(parseEngineLine('POS 0:08.8 FS 0 P 0')).toEqual({ kind: 'pos', positionMs: 8800, fullscreen: false, paused: false })
    expect(parseEngineLine('[2026-09-30 06:10] POS 0:08.8 FS 0 P 2')).toEqual({
      kind: 'pos',
      positionMs: 8800,
      fullscreen: false,
      paused: true,
    })
    expect(parseEngineLine('POS 0:08.8 FS 1 P')).toEqual({ kind: 'pos', positionMs: 8800, fullscreen: true, paused: null })
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
    expect(buildControlFile([4])).toEqual([
      'echo POS $cl_demopos FS $vid_fullscreen P $cl_paused',
      'if $q2l_seq < 4 then "exec q2l_cmd_4.cfg; set q2l_seq 4; echo ACK 4"',
    ])
    // Several in flight: one monotone guard each, ascending whatever order they are given in.
    expect(buildControlFile([7, 5, 6])).toEqual([
      'echo POS $cl_demopos FS $vid_fullscreen P $cl_paused',
      'if $q2l_seq < 5 then "exec q2l_cmd_5.cfg; set q2l_seq 5; echo ACK 5"',
      'if $q2l_seq < 6 then "exec q2l_cmd_6.cfg; set q2l_seq 6; echo ACK 6"',
      'if $q2l_seq < 7 then "exec q2l_cmd_7.cfg; set q2l_seq 7; echo ACK 7"',
    ])
    expect(buildControlFile([])).toEqual(['echo POS $cl_demopos FS $vid_fullscreen P $cl_paused'])
  })
  it('a console line cannot break out of the control file', () => {
    // The fixed template for seq N, spelled out: only N varies, never anything from the line.
    const template = (n: number): string =>
      `echo POS $cl_demopos FS $vid_fullscreen P $cl_paused\nif $q2l_seq < ${n} then "exec q2l_cmd_${n}.cfg; set q2l_seq ${n}; echo ACK ${n}"\n`
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
      'set q2l_armpos ""',
      'set q2l_seq 0',
      'alias q2l_loop "exec q2l_ctl.cfg; wait 13; q2l_loop"',
      'q2l_loop',
    ])
    expect(buildLoopCfg(3)[2]).toContain('wait 3;')
    expect(buildStopFile()).toEqual(['alias q2l_loop ""'])
  })
  it('Windows launch args carry the approved log flush settings', () => {
    const args = windowsLaunchArgs().argsBeforeDemo
    const at = (name: string): string[] => args.slice(args.indexOf(name) - 1, args.indexOf(name) + 2)
    expect(at('logfile_flush')).toEqual(['+set', 'logfile_flush', '3'])
    expect(at('logfile')).toEqual(['+set', 'logfile', '2'])
  })
  it('never puts +demo in the args and keeps the loop exec after the demo', () => {
    const w = windowsLaunchArgs()
    const l = linuxLaunchArgs()
    for (const a of [...w.argsBeforeDemo, ...w.argsAfterDemo, ...l.argsBeforeDemo, ...l.argsAfterDemo]) {
      expect(a).not.toBe('+demo')
    }
    expect(w.argsAfterDemo).toEqual(['+exec', 'q2l_loop.cfg'])
    expect(w.argsBeforeDemo).not.toContain('q2l_loop.cfg')
    expect(l.argsBeforeDemo).toEqual(expect.arrayContaining(['+set', 'sys_console', '1']))
    expect(l.argsAfterDemo).toEqual([])
  })
})

describe('notify session', () => {
  it('the loop ticks every LOOP_WAIT_FRAMES frames', () => {
    expect(buildLoopCfg()[2]).toContain('wait 13;')
    const ms = LOOP_WAIT_FRAMES * (1000 / 65)
    expect(ms).toBeGreaterThanOrEqual(180)
    expect(ms).toBeLessThanOrEqual(220)
  })
  it("the launcher's console lines stay within story 174's 10 per second", () => {
    // Lines the launcher makes the game print per tick: the POS echo plus one ACK echo per command it runs.
    const printed = buildControlFile([1]).filter((l) => l.startsWith('echo ') || l.includes('echo ACK')).length
    expect(printed).toBe(2)
    expect((printed * 65) / LOOP_WAIT_FRAMES).toBeLessThanOrEqual(10)
  })
  it('both platforms hide notify lines and enable the chat HUD for the session', () => {
    for (const args of [windowsLaunchArgs(), linuxLaunchArgs()]) {
      for (const pair of [['con_notifylines', '0'], ['scr_chathud', '1']]) {
        const at = args.argsBeforeDemo.indexOf(pair[0])
        expect(at).toBeGreaterThan(0)
        expect(args.argsBeforeDemo.slice(at - 1, at + 2)).toEqual(['+set', ...pair])
        expect(args.argsAfterDemo).not.toContain(pair[0])
      }
    }
  })
})

describe('mouse session', () => {
  it('both platforms set in_grab 2 so a playing demo does not grab the mouse', () => {
    for (const args of [windowsLaunchArgs(), linuxLaunchArgs()]) {
      const at = args.argsBeforeDemo.indexOf('in_grab')
      expect(args.argsBeforeDemo.slice(at - 1, at + 2)).toEqual(['+set', 'in_grab', '2'])
      expect(args.argsAfterDemo).not.toContain('in_grab')
    }
  })
})

describe('+set q2l_session 1', () => {
  it('is in both platforms launch args, before the demo', () => {
    for (const args of [windowsLaunchArgs().argsBeforeDemo, linuxLaunchArgs().argsBeforeDemo]) {
      const at = args.indexOf('q2l_session')
      expect(at).toBeGreaterThan(0)
      expect(args.slice(at - 1, at + 2)).toEqual(['+set', 'q2l_session', '1'])
    }
  })
})

describe('fullscreen switch and back to window (cbuf model)', () => {
  const POS_A = '1:00.0'

  /** A launcher playback: the loop cfg is running, parked on `wait`, the control file is the poll only. */
  function playback(platform: NodeJS.Platform = 'win32', session = true) {
    const sim = createCbufSim({
      cvars: { vid_fullscreen: '0', ...(session ? { q2l_session: '1' } : {}) },
      files: {
        'q2l_loop.cfg': toCfgText(buildLoopCfg()),
        'q2l_ctl.cfg': toCfgText(buildControlFile([])),
        'q2l_back.cfg': toCfgText(buildBackToWindowCfg(platform)),
      },
      demoPos: POS_A,
    })
    sim.press('exec q2l_loop.cfg')
    sim.run()
    return sim
  }

  /** The launcher queues the enter-fullscreen command as its own command cfg, behind the control file. */
  function enterFullscreen(sim: ReturnType<typeof createCbufSim>): void {
    const encoded = encodeControlCommand(1, 'unused')
    sim.files.set(encoded.commandFileName, toCfgText(buildEnterFullscreenLines({ switchMode: true })))
    sim.files.set('q2l_ctl.cfg', encoded.controlText)
  }

  it('the switch arms the guard so presses queued during the loop are ignored', () => {
    const sim = playback()
    sim.press(guardDemoCommand('seek +60'))
    enterFullscreen(sim)
    sim.frame()
    sim.frame()
    sim.frame()
    expect(sim.cvars.get('vid_fullscreen')).toBe('1')
    expect(sim.log).not.toContain('seek +60')
    // The loop is over: another frame runs no control file.
    const polls = sim.output.filter((o) => o.startsWith('POS')).length
    sim.frame()
    sim.frame()
    expect(sim.output.filter((o) => o.startsWith('POS')).length).toBe(polls)
    // The position moves on (the user steers in fullscreen): a press now runs.
    sim.setDemoPos('1:10.0')
    sim.press(guardDemoCommand('seek +10'))
    sim.run()
    expect(sim.log).toContain('seek +10')
  })

  it('back to window leaves fullscreen and re-arms the loop', () => {
    const sim = playback()
    enterFullscreen(sim)
    sim.frame()
    sim.frame()
    expect(sim.cvars.get('vid_fullscreen')).toBe('1')
    sim.setDemoPos('1:30.0')
    sim.files.set('q2l_ctl.cfg', toCfgText(['echo BACK-LOOP-RAN']))
    sim.press(BACK_TO_WINDOW_COMMAND)
    sim.run()
    expect(sim.cvars.get('vid_fullscreen')).toBe('0')
    sim.frame()
    sim.frame()
    expect(sim.output).toContain('BACK-LOOP-RAN')
  })

  it('back to window while windowed does not start a second loop', () => {
    const sim = playback()
    sim.setDemoPos('1:30.0')
    const loopText = sim.files.get('q2l_loop.cfg')!
    sim.files.set('q2l_loop.cfg', `echo LOOP-EXEC
${loopText}`)
    sim.press(BACK_TO_WINDOW_COMMAND)
    for (let i = 0; i < 3; i++) sim.frame()
    expect(sim.cvars.get('vid_fullscreen')).toBe('0')
    expect(sim.output.filter((o) => o === 'LOOP-EXEC')).toEqual([])
    expect(sim.cvars.get('q2l_armpos')).toBe('')
    // Demo actions still run with the loop unarmed (armpos empty) while a demo plays.
    const unarmed = createCbufSim({ cvars: { q2l_armpos: '' }, demoPos: '1:30.0' })
    unarmed.press(guardDemoCommand('seek +10'))
    unarmed.run()
    expect(unarmed.log).toContain('seek +10')
  })

  it('back to window outside a launcher playback is harmless', () => {
    const none = createCbufSim({ cvars: { vid_fullscreen: '1' }, demoPos: POS_A })
    none.press(BACK_TO_WINDOW_COMMAND)
    none.run()
    expect(none.output).toEqual(["Couldn't exec q2l_back.cfg"])
    expect(none.cvars.get('vid_fullscreen')).toBe('1')

    const plain = createCbufSim({
      cvars: { vid_fullscreen: '1' },
      files: { 'q2l_back.cfg': toCfgText(buildBackToWindowCfg('win32')), 'q2l_loop.cfg': toCfgText(buildLoopCfg()) },
      demoPos: POS_A,
    })
    plain.press(BACK_TO_WINDOW_COMMAND)
    plain.run()
    expect(plain.cvars.get('vid_fullscreen')).toBe('1')
    expect(plain.aliases.get('q2l_loop')).toBeUndefined()
    expect(plain.output).toEqual([])
  })

  it('a stale back-to-window press does not undo the switch', () => {
    const sim = playback()
    enterFullscreen(sim)
    sim.frame()
    sim.frame()
    sim.press(BACK_TO_WINDOW_COMMAND) // queued during the switch: the position is still the armed one
    sim.run()
    expect(sim.cvars.get('vid_fullscreen')).toBe('1')
  })

  it('on Linux back to window only leaves fullscreen', () => {
    const sim = playback('linux')
    enterFullscreen(sim)
    sim.frame()
    sim.frame()
    sim.setDemoPos('1:30.0')
    sim.press(BACK_TO_WINDOW_COMMAND)
    sim.run()
    expect(sim.cvars.get('vid_fullscreen')).toBe('0')
    expect(sim.aliases.get('q2l_loop')).toBe('set q2l_armpos $cl_demopos')
  })

  it('omits the mode switch when the game is already fullscreen', () => {
    expect(buildEnterFullscreenLines({ switchMode: false })).toEqual([expect.stringContaining('q2l_loop')])
  })
})
