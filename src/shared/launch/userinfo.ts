/**
 * Contract for handing a server-join password (and, later, spectator flag) to the game without
 * ever putting it in argv (story 125 D1).
 *
 * The concept problem: a password typed into the launcher must reach the engine's `userinfo`
 * cvars, but `+set password "<value>"` on the command line would put the password in `argv`
 * (visible in process listings, shell history if ever echoed, etc.) and — same class of risk as
 * `src/shared/servers/address.ts` — a value containing quotes or `;` could inject additional
 * tokens into whatever parses the command line. The fix used here is a one-shot exec'd cfg file
 * (`CONNECT_CFG_NAME`) written next to the install for a single launch and removed when the game
 * exits, never a command-line argument.
 *
 * Pure, `src/shared` — no `fs`, no DOM, no electron, no IPC — mirroring `src/shared/servers/
 * address.ts`'s reasoning: writing the cfg text and picking the temp path are main's job; this
 * file only decides what characters are safe and what the file's contents look like.
 *
 * ## Character rule
 *
 * A userinfo value must be 1–63 characters, each a printable ASCII character (0x20–0x7e), and
 * must not contain `"`, `\` or `;` — quotes and backslash because the value is written inside a
 * quoted `set` cfg line, `;` because Quake II cfg files treat it as a command separator. No
 * trimming: the value is used exactly as given, since a password's leading/trailing space might
 * be intentional.
 *
 * ## Result shape
 *
 * Mirrors `parseServerAddress`'s convention: a rejection carries a reason code, never a literal
 * English message. `userinfoRejectionKey()` resolves the code to an i18n key.
 */

export interface LaunchUserinfo {
  password?: string
  spectator?: string
}

/** Written next to the install for one launch only, removed when the game exits. */
export const CONNECT_CFG_NAME = 'q2launcher-connect.cfg'

/** Why `parseUserinfoValue` rejected a candidate value. */
export type UserinfoRejection = 'empty' | 'too-long' | 'forbidden-character'

export type UserinfoValueResult = { ok: true } | { ok: false; reason: UserinfoRejection }

/** Characters outside printable ASCII (0x20-0x7e), plus the shell/cfg metacharacters `"`, `\`, `;`. */
const FORBIDDEN_CHARACTER_PATTERN = /[^\x20-\x7e]|["\\;]/

/**
 * Validates a single userinfo value (a password or the spectator flag) before it is ever written
 * to a cfg. Pure, no trimming — see the file doc comment's "Character rule".
 */
export function parseUserinfoValue(value: string): UserinfoValueResult {
  if (value.length === 0) return { ok: false, reason: 'empty' }
  if (value.length > 63) return { ok: false, reason: 'too-long' }
  if (FORBIDDEN_CHARACTER_PATTERN.test(value)) return { ok: false, reason: 'forbidden-character' }
  return { ok: true }
}

/** Maps a rejection reason to its i18n key, `launch.userinfo.reject.<reason>`. */
export function userinfoRejectionKey(reason: UserinfoRejection): string {
  return `launch.userinfo.reject.${reason}`
}

/**
 * Renders the one-shot connect cfg's full contents: a header comment, then `set <key> "<value>"`
 * lines in fixed order (`password`, then `spectator`), only for the keys actually present.
 *
 * Throws if any present value fails `parseUserinfoValue` — defence in depth, since every caller
 * should already have validated through `launchUserinfoValueSchema` before reaching here.
 */
export function renderConnectCfg(userinfo: LaunchUserinfo): string {
  const lines = ['// written by Q2 Launcher for one launch, removed when the game exits']

  const entries: Array<['password' | 'spectator', string | undefined]> = [
    ['password', userinfo.password],
    ['spectator', userinfo.spectator],
  ]

  for (const [key, value] of entries) {
    if (value === undefined) continue
    const result = parseUserinfoValue(value)
    if (!result.ok) {
      throw new Error(`invalid userinfo value for "${key}": ${result.reason}`)
    }
    lines.push(`set ${key} "${value}"`)
  }

  return lines.map((line) => `${line}\n`).join('')
}
