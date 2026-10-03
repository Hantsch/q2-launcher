import { ARMPOS_CVAR, BACK_TO_WINDOW_CFG, SESSION_CVAR } from '@shared/replays/demo-guard'
import { fail, ok, type Outcome } from '@shared/types'

/**
 * Story 164: the Q2PRO console protocol - pure, no node, no electron. The launcher makes the game
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
  | { kind: 'pos'; positionMs: number | null; fullscreen: boolean | null; paused: boolean | null }
  | { kind: 'ack'; seq: number }
  | { kind: 'finished' }
  | { kind: 'other' }

const LOG_PREFIX = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] /

export function parseEngineLine(raw: string): EngineLine {
  const line = raw.replace(LOG_PREFIX, '').replace(/[\r\n]+$/, '')
  if (line === 'POS') return { kind: 'pos', positionMs: null, fullscreen: null, paused: null }
  if (line.startsWith('POS ')) {
    // `POS <pos> FS <0|1> P <cl_paused>`; the FS and P parts are absent in older lines, `<pos>` is
    // empty outside a demo. `cl_paused` is 0 while playing and non-zero (2 for a demo) when paused.
    const m = /^(.*?)\s*FS\s*(\S*)(?:\s+P\s*(\S*))?\s*$/.exec(line.slice(4))
    const posText = (m ? m[1]! : line.slice(4)).trim()
    const fullscreen = m ? (m[2] === '1' ? true : m[2] === '0' ? false : null) : null
    const pausedText = m?.[3]
    const paused = pausedText && /^\d+$/.test(pausedText) ? pausedText !== '0' : null
    return { kind: 'pos', positionMs: parseDemoPos(posText), fullscreen, paused }
  }
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

/**
 * The position + fullscreen + pause poll: the game answers `POS <pos> FS <0|1> P <cl_paused>`. The
 * pause state is read, not inferred from a still position: the pause state stays explicit so a still
 * position is never mistaken for a pause. Story 185: the Windows logfile is unbuffered
 * (`logfile_flush 3`, _IONBF; `1` was line-buffered through the MSVC CRT, which delivered POS lines in
 * ~1.3 s bursts). Spike 183 measured control->ACK p95 254.4 ms at a 10 ms poll and 290.6 ms at the 50 ms
 * production poll; the combo-4 run (flush 3 + multiseq at wait 13) held 10.0 console lines/s against
 * 10.5 for the baseline; story 185's shipped-settings probe measured 9.2 / 7.0 idle plumbing lines/s
 * (11.8 raw sum in run A incl. command/ACK/marker lines), see spikes/185-control-latency/RESULT.md.
 */
export const POLL_LINE = 'echo POS $cl_demopos FS $vid_fullscreen P $cl_paused'

/**
 * Frames the control loop waits between ticks. Spike 169 P7 measured ~65 command frames/s, so 13 is
 * ~200 ms and caps the launcher's plumbing at ~10 lines/s.
 */
export const LOOP_WAIT_FRAMES = 13

export function buildLoopCfg(waitFrames = LOOP_WAIT_FRAMES): string[] {
  return [
    // A (re)started loop is unarmed: back to window then cannot start a second loop while windowed.
    `set ${ARMPOS_CVAR} ""`,
    'set q2l_seq 0',
    `alias q2l_loop "exec ${CONTROL_CFG_NAME}; wait ${waitFrames}; q2l_loop"`,
    'q2l_loop',
  ]
}

/** Story 166: the per-sequence cfg that holds command `seq`'s console line, beside the control file. */
export function commandCfgName(seq: number): string {
  return `q2l_cmd_${seq}.cfg`
}

/**
 * The control file: the poll, then one guard per in-flight seq, ascending. Each guard holds only
 * fixed text - it execs command N's own cfg - so no console line ever sits inside the guard's quoted
 * string, where Q2's tokenizer (no escaping) would let a `"` in it close the string early.
 *
 * Story 185: the guard is monotone (`if $q2l_seq < N`), so several commands share one file and
 * run in seq order in one pass. A re-read after a later seq ran never re-runs an earlier one, and a
 * seq dropped from the file (timed out) never blocks the ones after it. Spike 183 verified this form.
 */
export function buildControlFile(seqs: readonly number[]): string[] {
  const lines = [POLL_LINE]
  for (const seq of [...seqs].sort((a, b) => a - b)) {
    lines.push(
      `if $q2l_seq < ${seq} then "exec ${commandCfgName(seq)}; set q2l_seq ${seq}; echo ACK ${seq}"`,
    )
  }
  return lines
}

export interface EncodedControlCommand {
  /** Full content of the control file with only this sequence in flight: fixed text, never the line. */
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
    controlText: toCfgText(buildControlFile([seq])),
    commandFileName: commandCfgName(seq),
    commandText: toCfgText([line]),
  }
}

/** The on-disk form of a cfg: its lines, each ending in a newline. */
export function toCfgText(lines: string[]): string {
  return `${lines.join('\n')}\n`
}

/**
 * Story 172: the command-cfg lines of the internal "enter fullscreen" command (they bypass
 * `checkLine`, which rejects `"`). The alias replaces the control loop by a body that only arms the
 * guard with the current position, so presses queued behind the loop find the position unchanged.
 */
export function buildEnterFullscreenLines({ switchMode }: { switchMode: boolean }): string[] {
  return [
    ...(switchMode ? ['vid_fullscreen 1'] : []),
    `alias q2l_loop "set ${ARMPOS_CVAR} $cl_demopos"`,
  ]
}

/**
 * The cfg behind the "Back to window" bind (`q2l_back.cfg`). It acts only inside a launcher playback
 * (`q2l_session`) and only when the position moved since the loop was armed, so a stale press cannot
 * undo the switch. Linux has no loop cfg to re-arm: it only leaves fullscreen.
 */
export function buildBackToWindowCfg(platform: NodeJS.Platform): string[] {
  const moved = `if x$cl_demopos ne x$${ARMPOS_CVAR} then q2l_back_go`
  if (platform === 'linux') {
    return [
      'alias q2l_back_go "vid_fullscreen 0"',
      `alias q2l_back_live "${moved}"`,
      `if x$${SESSION_CVAR} eq x1 then q2l_back_live`,
    ]
  }
  // Windows: the loop cfg clears armpos on (re)start, so an empty armpos means the loop is already
  // running (game windowed) and the press must not exec the loop cfg a second time.
  return [
    `alias q2l_back_go "vid_fullscreen 0; exec ${LOOP_CFG_NAME}"`,
    `alias q2l_back_armed "${moved}"`,
    `alias q2l_back_live "if x$${ARMPOS_CVAR} ne x then q2l_back_armed"`,
    `if x$${SESSION_CVAR} eq x1 then q2l_back_live`,
  ]
}

export { BACK_TO_WINDOW_CFG }

export function buildStopFile(): string[] {
  return ['alias q2l_loop ""']
}

/** Cvars the session sets so the launcher's plumbing does not scroll over the demo. */
export const NOTIFY_SESSION_CVARS = ['con_notifylines', 'scr_chathud'] as const

/** Hide notify lines and show chat in the chat HUD, for this session only. */
export function notifySessionArgs(): string[] {
  return ['+set', 'con_notifylines', '0', '+set', 'scr_chathud', '1']
}

/** Cvars the session sets so the mouse stays free for the launcher while a demo plays windowed. */
export const MOUSE_SESSION_CVARS = ['in_grab'] as const

/**
 * `in_grab 2`: Q2PRO only hides the cursor over its window during demo playback instead of grabbing
 * it, so the timeline beneath the stage is reachable without Escape. Fullscreen still grabs.
 */
export function mouseSessionArgs(): string[] {
  return ['+set', 'in_grab', '2']
}

interface LaunchArgs {
  argsBeforeDemo: string[]
  argsAfterDemo: string[]
}

export function windowsLaunchArgs(): LaunchArgs {
  return {
    argsBeforeDemo: [
      '+set',
      'logfile',
      '2',
      '+set',
      'logfile_flush',
      '3',
      '+set',
      'logfile_name',
      LOG_FILE_NAME,
      '+set',
      SESSION_CVAR,
      '1',
      ...notifySessionArgs(),
      ...mouseSessionArgs(),
    ],
    argsAfterDemo: ['+exec', LOOP_CFG_NAME],
  }
}

export function linuxLaunchArgs(): LaunchArgs {
  return {
    argsBeforeDemo: [
      '+set',
      'sys_console',
      '1',
      '+set',
      SESSION_CVAR,
      '1',
      ...notifySessionArgs(),
      ...mouseSessionArgs(),
    ],
    argsAfterDemo: [],
  }
}
