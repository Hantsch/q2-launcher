/**
 * Demo control commands — story 162: the console command the launcher sends to a running Q2PRO to
 * seek inside a demo. Q2PRO's plain `seek` works for both `.dm2` and `.mvd2` (verified on MVD by
 * spike 133, `spikes/133-q2pro-control/RESULT.md`); `mvdseek` is NOT used. Story 165's timeline
 * sends seeks only through `demoSeekCommand`, so a future per-format divergence is a one-line
 * change in the switch below.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * electron.
 */

import type { DemoFormat } from '../modules/replays'

export type SeekTarget =
  | { kind: 'relative'; seconds: number }
  | { kind: 'absolute'; seconds: number }
  | { kind: 'percent'; percent: number }

function seekArgument(target: SeekTarget): string {
  switch (target.kind) {
    case 'relative': {
      const s = Math.round(target.seconds)
      return s < 0 ? `-${-s}` : `+${s}`
    }
    case 'absolute':
      return String(Math.max(0, Math.round(target.seconds)))
    case 'percent':
      return `${Math.min(100, Math.max(0, Math.round(target.percent)))}%`
  }
}

export function demoSeekCommand(format: DemoFormat, target: SeekTarget): string {
  switch (format) {
    case 'dm2':
      return `seek ${seekArgument(target)}`
    case 'mvd2':
      return `seek ${seekArgument(target)}`
  }
}
