import { fail, ok, type Outcome } from '@shared/types'

/**
 * Story 164 D1: the Q2PRO console protocol - pure, no node, no electron. The launcher makes the game
 * poll a control cfg (`q2l_ctl.cfg`) that echoes the demo position and runs one guarded pending command.
 */

export const LOOP_CFG_NAME = 'q2l_loop.cfg'
export const CONTROL_CFG_NAME = 'q2l_ctl.cfg'
export const LOG_FILE_NAME = 'q2l_demo.log'
/** Path of the engine logfile relative to the game dir. */
export const LOG_FILE_RELATIVE = `logs/${LOG_FILE_NAME}`

export const LOG_POLL_MS = 50
export const LINUX_POLL_MS = 100
export const POSITION_PUSH_MS = 250
export const ACK_TIMEOUT_MS = 2000
export const QUEUE_CAP = 8

export type EngineLine =
  | { kind: 'pos'; positionMs: number | null }
  | { kind: 'ack'; seq: number }
  | { kind: 'finished' }
  | { kind: 'other' }

const LOG_PREFIX = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] /

export function parseEngineLine(raw: string): EngineLine {
  const line = raw.replace(LOG_PREFIX, '').replace(/[\r\n]+$/, '')
  if (line === 'POS') return { kind: 'pos', positionMs: null }
  if (line.startsWith('POS ')) return { kind: 'pos', positionMs: parseDemoPos(line.slice(4).trim()) }
  const ack = /^ACK (\d+)$/.exec(line)
  if (ack) return { kind: 'ack', seq: Number(ack[1]) }
  if (line === 'Demo finished') return { kind: 'finished' }
  return { kind: 'other' }
}

/** `m:ss.f` or `h:mm:ss.f` (as `$cl_demopos` prints it) to milliseconds; null when it is neither. */
export function parseDemoPos(text: string): number | null {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?\.(\d)$/.exec(text)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  const tenth = Number(m[4])
  const seconds = m[3] === undefined ? a * 60 + b : a * 3600 + b * 60 + Number(m[3])
  return seconds * 1000 + tenth * 100
}

/**
 * A console line the launcher may hand to the game: non-empty, no control characters. `"`, `;`, `$`
 * and `//` are legal console syntax - the line only ever sits alone in its own cfg (Windows) or on
 * stdin (Linux), never inside a quoted string.
 */
export function checkLine(line: string): Outcome<void> {
  if (line.length === 0) return fail('replays.playback.error.invalidCommand')
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return fail('replays.playback.error.invalidCommand')
  }
  return ok(undefined)
}

export function buildLoopCfg(waitFrames = 5): string[] {
  return [
    'set q2l_seq 0',
    `alias q2l_loop "exec ${CONTROL_CFG_NAME}; wait ${waitFrames}; q2l_loop"`,
    'q2l_loop',
  ]
}

/** Story 166 D3: the per-sequence cfg that holds command `seq`'s console line, beside the control file. */
export function commandCfgName(seq: number): string {
  return `q2l_cmd_${seq}.cfg`
}

/**
 * The control file. Its guard holds only fixed text - it execs command `seq`'s own cfg - so no
 * console line ever sits inside the guard's quoted string, where Q2's tokenizer (no escaping) would
 * let a `"` in it close the string early.
 */
export function buildControlFile(seq: number | null): string[] {
  const lines = ['echo POS $cl_demopos']
  if (seq !== null) {
    lines.push(`if $q2l_seq != ${seq} then "exec ${commandCfgName(seq)}; set q2l_seq ${seq}; echo ACK ${seq}"`)
  }
  return lines
}

export interface EncodedControlCommand {
  /** Full content of the control file for this sequence: fixed text, never the line. */
  controlText: string
  commandFileName: string
  /** Full content of the command file: the line alone, as its only line. */
  commandText: string
}

/**
 * Encodes command `seq` for the Windows file route. The command file must be on disk before the
 * control file that execs it; `;`, `"`, `//` and `$` in the line only ever affect the line itself.
 */
export function encodeControlCommand(seq: number, line: string): EncodedControlCommand {
  return {
    controlText: toCfgText(buildControlFile(seq)),
    commandFileName: commandCfgName(seq),
    commandText: toCfgText([line]),
  }
}

/** The on-disk form of a cfg: its lines, each ending in a newline. */
export function toCfgText(lines: string[]): string {
  return `${lines.join('\n')}\n`
}

export function buildStopFile(): string[] {
  return ['alias q2l_loop ""']
}

interface LaunchArgs {
  argsBeforeDemo: string[]
  argsAfterDemo: string[]
}

export function windowsLaunchArgs(): LaunchArgs {
  return {
    argsBeforeDemo: ['+set', 'logfile', '2', '+set', 'logfile_flush', '1', '+set', 'logfile_name', LOG_FILE_NAME],
    argsAfterDemo: ['+exec', LOOP_CFG_NAME],
  }
}

export function linuxLaunchArgs(): LaunchArgs {
  return { argsBeforeDemo: ['+set', 'sys_console', '1'], argsAfterDemo: [] }
}
