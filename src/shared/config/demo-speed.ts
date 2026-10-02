/**
 * Story 167 D2: bindable "demo speed up / down" commands that step through the timeline's own
 * speed steps (`SPEED_STEPS`, story 165) one step per key press, clamped at both ends.
 *
 * Q2PRO has no "next timescale" verb, so each command is a chain of `if` checks in one body:
 *
 *   speed up:   if $timescale == 2 then timescale 4; if $timescale == 1 then timescale 2; ...
 *   speed down: if $timescale == 0.5 then timescale 0.25; if $timescale == 1 then timescale 0.5; ...
 *
 * At the top (resp. bottom) step no check matches, so the press is a no-op - that is the clamp.
 * A `timescale` that is not one of the steps (hand-set to 3, say) matches nothing either.
 *
 * Engine rules this relies on, checked against Q2PRO `master` (github.com/q2pro/q2pro,
 * `src/common/cmd.c` / `src/shared/shared.c`, read 2026-09-29; the launcher pins nightly r3834,
 * whose exact tree could not be fetched - these functions are long-stable, but that is the gap):
 *
 * 1. **`$timescale` is expanded per command, at execution, not at definition.**
 *    `Cmd_MacroExpandString` toggles `inquote` on every `"` and skips `$` while inside quotes
 *    ("don't expand inside quotes"), so the `bind`/`alias` line that defines the body - whose body
 *    is one quoted argument - stores `$timescale` literally. When an alias runs, `Cmd_ExecuteString`
 *    expands its value with `aliasHack = true`, which only resolves positional macros
 *    (`expand_positional`: `$@`, `$1`, `$1-2`; any other name returns NULL and is left as is). The
 *    body then goes into the command buffer, `Cbuf_Execute` splits it at every `;` outside quotes,
 *    and each piece is run through `Cmd_TokenizeString(text, true)`, which expands `$timescale` with
 *    the cvar's value *at that moment*. A key bound straight to the body behaves the same way (the
 *    bind string is added to the buffer verbatim).
 *
 * 2. **Hence the check order.** `Cmd_If_f` runs its `then` branch through `Cbuf_InsertText`, i.e.
 *    *before* the next `if` in the same press. So a value just set by one check is what the later
 *    checks see: speed up checks the steps DESCENDING (a step just raised is always above every
 *    later check), speed down ASCENDING. The ascending speed-up order would cascade 0.25 -> 4 in a
 *    single press.
 *
 * 3. **`==` compares numerically.** `Cmd_If_f` sets `numeric = COM_IsFloat(a) && COM_IsFloat(b)`
 *    and then compares `Q_atof(a) == Q_atof(b)`; `COM_IsFloat` accepts an optional `-`, digits and
 *    one `.`, so `0.25`/`0.5` qualify. `timescale 0.25` stores the string as typed
 *    (`Cvar_Get("timescale", "1", CVAR_CHEAT)` in `common.c`, set through `Cvar_Command` -> `Cvar_SetByVar(v, Cmd_ArgsFrom(1), ...)` in `cvar.c`), and even a
 *    differently formatted `0.250` would still compare equal as a float. Every step is a dyadic
 *    fraction, so the atof round trip is exact.
 *
 * 4. **`then` joining.** Arguments 1-3 are `a op b`; an optional `then` at argument 4 is skipped,
 *    and the branch is the raw rest of the line up to an `else` (`Cmd_RawArgsFrom`), so
 *    `then timescale 4` inserts exactly `timescale 4`.
 *
 * The body carries no `"`: a Quake II config cannot nest quotes (see `alt-layers.ts`), and the
 * body is itself the one quoted argument of its `bind`/`alias` line. It stays well under the
 * engine's 1024-byte line (`CBUF_LINE_BYTES`, `engine-limits.ts`).
 */

import { SPEED_STEPS } from '@shared/replays/timeline'

type Steps = readonly number[]

function checks(pairs: Array<readonly [number, number]>): string[] {
  return pairs.map(([from, to]) => `if $timescale == ${from} then timescale ${to}`)
}

/**
 * The speed-up chain's individual `if` checks, in execution order (fastest step first).
 *
 * The catalogue row carries these as separate commands - the same shape as a drop row's
 * `[drop <item>, drop <ammo>]` - rather than as one `;`-joined string, because the reader splits a
 * generated alias body at `;` on read-back (`profile-restore.ts`); a one-string row would come back
 * as four commands and no longer equal its own catalogue row. The writer joins them back into one
 * alias body in this order, which is exactly the order the engine runs them in.
 */
export function speedUpCommands(steps: Steps = SPEED_STEPS): string[] {
  return checks(
    steps
      .slice(0, -1)
      .map((from, i) => [from, steps[i + 1]!] as const)
      .reverse(),
  )
}

/** The speed-down chain's `if` checks, in execution order (slowest step first). */
export function speedDownCommands(steps: Steps = SPEED_STEPS): string[] {
  return checks(steps.slice(1).map((from, i) => [from, steps[i]!] as const))
}

/** One step faster per press, clamped at the fastest step - the whole chain as one body. */
export function speedUpCommand(steps: Steps = SPEED_STEPS): string {
  return speedUpCommands(steps).join('; ')
}

/** One step slower per press, clamped at the slowest step - the whole chain as one body. */
export function speedDownCommand(steps: Steps = SPEED_STEPS): string {
  return speedDownCommands(steps).join('; ')
}
