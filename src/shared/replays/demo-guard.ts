/**
 * Story 172 D1: the guard every bindable demo action runs behind, and the "Back to window" action.
 *
 * While the launcher's control loop drives a demo, key presses can pile up in the engine's command
 * buffer. When the loop stops for fullscreen those queued presses would still run. Each demo action
 * therefore only runs when the demo position differs from the position the loop last armed
 * (`q2l_armpos`): a queued press sees the armed position unchanged and is ignored. With `q2l_armpos`
 * unset (a plain demo, no loop) `x$q2l_armpos` is `x`, never equal to `x<pos>`, so the action runs.
 *
 * `eq`/`ne` compare as strings in Q2PRO, and the `x` prefix keeps an empty macro from leaving the
 * `if` short of an argument. Pure: no node, no DOM.
 */

/** Cvar the launcher's control loop sets to the demo position it last armed. */
export const ARMPOS_CVAR = 'q2l_armpos'

/** Cvar naming the current launcher-driven playback session. */
export const SESSION_CVAR = 'q2l_session'

/** The cfg the "Back to window" bind executes; it guards itself. */
export const BACK_TO_WINDOW_CFG = 'q2l_back.cfg'

/** The console command "Back to window" is bound to (unguarded - the cfg guards itself). */
export const BACK_TO_WINDOW_COMMAND = `exec ${BACK_TO_WINDOW_CFG}`

/** One demo console command, run only while the demo position differs from the armed position. */
export function guardDemoCommand(command: string): string {
  return `if x$cl_demopos ne x$${ARMPOS_CVAR} then ${command}`
}
