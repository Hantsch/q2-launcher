import { sanitizeCommand } from '@shared/config/alt-layers'
import { profileFileName } from './render'

/**
 * In-session profile switch — the pure alias-chain generator.
 *
 * One bindable key that cycles through an installation's assigned profiles
 * while the game is running, without touching the installation's on-disk
 * default (story 007). Quake 2 cannot express that directly: a `bind` runs one
 * command, and there is no variable to hold "which profile am I on". So the
 * cycle is built the same way story 006's toggle layers are, generalised from
 * a 2-way pair to an n-way ring — N *step* aliases plus one *indirection*
 * alias that every step rewrites to point at its successor:
 *
 *   alias q2l_sw1 "exec q2l-profile-<id1>.cfg; echo Profile: <name1>; bind F9 q2l_switch; alias q2l_switch q2l_sw2"
 *   alias q2l_sw2 "exec q2l-profile-<id2>.cfg; echo Profile: <name2>; bind F9 q2l_switch; alias q2l_switch q2l_sw1"
 *   alias q2l_switch q2l_sw2
 *   bind F9 q2l_switch
 *
 * Rewriting the dispatch alias on every press is the only way to hold state in
 * the console language (see `alt-layers.ts`, which documents the engine rules
 * all of this follows: 1024-byte `Cbuf_Execute` lines, a dumb quote counter and
 * therefore no nested quotes, `MAX_ALIAS_NAME`).
 *
 * Three details are load-bearing and each one produces a chain that looks fine
 * on disk but dies in-game if it is wrong:
 *
 * - **Every step re-applies `bind <key> q2l_switch`.** The profile file a step
 *   execs carries its own binds and may well bind this very key (story 006), in
 *   which case the cycle would end after a single press.
 * - **The indirection alias starts at the *successor* of the default**, not at
 *   the default itself: the loader already execed the default at launch, so the
 *   first press has to move on rather than re-exec what is already loaded.
 * - **The last step wraps to the first** (`(i + 1) % N`), which is what closes
 *   the ring.
 *
 * Pure, like `render.ts` next to it: plain data in, text out, no `fs` and no
 * encoding choice. The caller writes the result as latin1, and this module only
 * emits characters that survive that round trip.
 *
 * Session-only by construction: the chain never writes launcher state, so the
 * installation's default assignment is untouched no matter how often the key is
 * pressed (story 007 decision 13).
 */

/** The profile fields the chain needs. A `ConfigProfile` satisfies this. */
export interface SwitchBindProfile {
  id: string
  name: string
}

export interface SwitchBindChainInput {
  /** Engine key name the chain is bound to, e.g. `F9`. */
  key: string
  /**
   * The installation's assigned profiles, in the module's list order and
   * already filtered to that installation — this module knows nothing about
   * installations or assignments (story 007 decision 8). That order *is* the
   * cycle order.
   */
  profiles: readonly SwitchBindProfile[]
  /** Id of the installation's current default, expected to be among `profiles`. */
  defaultProfileId: string
}

/**
 * Fixed alias tokens (story 007 decision 10). Deliberately *not* derived from
 * the profile or installation name: user text would have to go through
 * `slugAliasName` and could then collide between two installations writing into
 * the same `baseq2`. `q2l_sw` plus a decimal index stays inside
 * `MAX_ALIAS_NAME`'s 31 usable characters up to 10^25 profiles, so no budget
 * arithmetic is needed here — unlike in `alt-layers.ts`, where the name is the
 * user's.
 */
export const SWITCH_ALIAS = 'q2l_switch'
export const STEP_ALIAS_PREFIX = 'q2l_sw'

/** Cap for the echoed profile name (story 007 decision 9). */
export const MAX_ECHO_NAME = 40

/** Name of the step alias for the 1-based position `step` in the cycle. */
function stepAliasName(step: number): string {
  return `${STEP_ALIAS_PREFIX}${step}`
}

/**
 * Same rule as `alt-layers.ts`'s private `renderAliasLine`: wrap the body in one
 * pair of quotes exactly when it contains a `;`, so `Cbuf_Execute` keeps the
 * whole list as one command instead of executing the tail immediately. Bodies
 * here never contain a quote character (the echoed name is stripped of them),
 * so these can never nest.
 */
function aliasLine(name: string, body: string): string {
  return body.includes(';') ? `alias ${name} "${body}"` : `alias ${name} ${body}`
}

/**
 * An engine key name is a single token. `sanitizeCommand` does the quote and
 * whitespace half (the identical rule story 006 applies before embedding any
 * user-supplied command); `;` and `$` go too, because a key name that carried
 * either would end the step's command list early or trigger macro expansion.
 */
function sanitizeKeyName(key: string): string {
  return sanitizeCommand(key).replace(/[;$\s]/g, '')
}

/** Strip everything that is unsafe as echoed text, then cap the length. */
function cleanEchoText(text: string): string {
  return (
    text
      // C0 controls and DEL: a newline or tab inside the body would cut the
      // generated line in half. High-ASCII is kept — it round-trips latin1 and
      // the engine renders it, so "Bjørn" stays "Bjørn".
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      // `"` cannot be escaped in Quake 2 and would break the line split; `;`
      // would end the step's command list; `$` triggers macro expansion; `//`
      // comments out the rest of the line. A run of three or more slashes has
      // to go as a whole, otherwise the leftovers re-form a comment.
      .replace(/["$;]/g, '')
      .replace(/\/{2,}/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_ECHO_NAME)
      .trim()
  )
}

/**
 * The text a step echoes for a profile: the sanitized, truncated name, falling
 * back to the (equally sanitized) profile id when nothing survives — a profile
 * named `$$$` would otherwise echo `Profile:` and tell the player nothing.
 * `'profile'` is the last resort for the case where the id is empty too, which
 * cannot happen for a `randomUUID` id but is cheaper to cover than to reason
 * about at every call site.
 */
export function sanitizeEchoName(name: string, fallbackId: string): string {
  return cleanEchoText(name) || cleanEchoText(fallbackId) || 'profile'
}

/**
 * The chain's lines, in write order: N step aliases, the indirection alias,
 * then the bind. Empty when nothing should be emitted:
 *
 * - fewer than 2 profiles — there is nothing to cycle, and emitting no chain is
 *   the on-disk half of AC 5: unassigning a profile removes the bind from the
 *   game, not just the control from the UI (story 007 decision 11);
 * - no usable key — a `bind` with no key name would print the current binding
 *   instead of setting one, so "no key configured" means "no chain".
 *
 * Line length is not checked: every part is bounded (a `q2l-profile-<uuid>.cfg`
 * name, a 40-character echo name, one key name, the fixed alias tokens), which
 * puts a step alias at roughly 200 bytes — a fifth of `MAX_LINE_BYTES`. Nothing
 * here scales with the number of profiles the way `alt-layers.ts`'s bodies
 * scale with the number of overrides, so no chunking is needed. A test pins the
 * actual byte length so a future addition to a step body cannot quietly change
 * that.
 */
export function renderSwitchBindChainLines(input: SwitchBindChainInput): string[] {
  const key = sanitizeKeyName(input.key)
  const profiles = input.profiles
  if (profiles.length < 2 || key.length === 0) return []

  // Should not happen — an installation's default is always among its assigned
  // profiles (the assignment invariant in `assignments.ts`). If it ever is not,
  // treat the first profile as the default and start the cycle at the second:
  // the worst case is that the first press re-execs the profile that is already
  // loaded, which is a harmless no-op, whereas throwing would take the whole
  // loader file down over a cosmetic detail.
  const defaultIndex = Math.max(
    0,
    profiles.findIndex((profile) => profile.id === input.defaultProfileId),
  )

  const lines = profiles.map((profile, index) => {
    // `(index + 1) % length` wraps the last step back to the first — this is
    // what closes the ring.
    const successor = stepAliasName(((index + 1) % profiles.length) + 1)
    const body = [
      `exec ${profileFileName(profile.id)}`,
      `echo Profile: ${sanitizeEchoName(profile.name, profile.id)}`,
      // Re-applied every step: the file just execed may have rebound this key.
      `bind ${key} ${SWITCH_ALIAS}`,
      `alias ${SWITCH_ALIAS} ${successor}`,
    ].join('; ')
    return aliasLine(stepAliasName(index + 1), body)
  })

  lines.push(aliasLine(SWITCH_ALIAS, stepAliasName(((defaultIndex + 1) % profiles.length) + 1)))
  lines.push(`bind ${key} ${SWITCH_ALIAS}`)

  return lines
}

/**
 * The chain as one block of text, `\n`-joined and **without** a trailing
 * newline, or `''` when no chain is emitted (see
 * `renderSwitchBindChainLines`). Deterministic: the output depends on nothing
 * but the input, so the same installation renders byte-identical text on every
 * save — which is what lets the writer's diff-skip do its job.
 */
export function renderSwitchBindChain(input: SwitchBindChainInput): string {
  return renderSwitchBindChainLines(input).join('\n')
}
