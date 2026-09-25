import { BASE_GAME_DIR } from '@shared/constants'
import { CONNECT_CFG_NAME, type LaunchUserinfo } from '@shared/launch/userinfo'
import { parseServerAddress } from '@shared/servers/address'
import { getEngineDefinition, type Installation, type LaunchInput } from '@shared/types'

/**
 * Builds the Quake II command line.
 *
 * Pure on purpose: the argument rules below come from r1q2's own tokenizer and
 * are subtle enough that they need unit tests, which is impossible if the logic
 * is entangled with spawning a process. See `launch-plan.test.ts`.
 *
 * The rules that matter, from r1q2's `qcommon/cmd.c` and `common/common.c`:
 *
 *  - Early commands (`+set`) are emitted as `set <a> <b>` from exactly two
 *    tokens, so a `+set` value can never contain a space.
 *  - Quotes are ordinary characters to the early parser: they neither group nor
 *    get stripped. Passing `+set game "my mod"` produces garbage.
 *  - Any byte above 126 is treated as a separator, so non-ASCII values are split
 *    mid-token and cannot be passed as arguments at all.
 *  - Late commands (`+exec`, `+connect`) are re-joined and re-tokenised by the
 *    normal command tokenizer, which *does* honour quotes.
 *
 * The practical consequence: the game directory has to be a single ASCII token.
 * It is validated at the IPC boundary and again here - a value that cannot be
 * expressed safely is dropped rather than emitted broken.
 *
 * Paths are never passed as arguments at all. The install root is handed to the
 * process as its working directory instead, which sidesteps the whole problem
 * for the one value most likely to contain spaces or non-ASCII characters.
 *
 * Story 125: a server address (`connect`) is re-validated here with
 * `parseServerAddress` - an address that fails is dropped (`invalid-address`)
 * and nothing about the join is emitted. A join password or spectator flag
 * (`userinfo`) is *never* an argument: when a valid address comes with
 * userinfo, the only thing emitted is `+exec <CONNECT_CFG_NAME>` right before
 * `+connect`, and `LaunchService.start()` writes the values into that one-shot
 * cfg file. Userinfo without a valid address emits nothing at all.
 */

/**
 * Characters that stop a value from reaching r1q2 intact as a `+set` argument:
 *
 *  - anything outside printable ASCII, or a space: r1q2's early parser splits on
 *    those, so the value would arrive truncated;
 *  - a double quote or backslash: Node has to quote and escape these when it
 *    builds the Windows command line, and r1q2 parses that line by hand without
 *    undoing the escaping, so what arrives is not what we sent.
 */
const UNSAFE_EARLY_CHARS = /[^\x21-\x7e]|["\\]/

export function isSafeEarlyToken(value: string): boolean {
  return value.length > 0 && !UNSAFE_EARLY_CHARS.test(value)
}

/** Whether a launch carries any userinfo value that has to go through the connect cfg. */
export function hasUserinfo(userinfo: LaunchUserinfo | undefined): userinfo is LaunchUserinfo {
  return userinfo !== undefined && Object.values(userinfo).some((value) => value !== undefined)
}

/**
 * Story 126: resolves what actually goes through the connect cfg carrier. `spectate` composes
 * with `userinfo.password` - reused as the *spectator* password, no second secret field - to put
 * the client into spectator mode: `spectator` becomes the password if one was given, else `'1'`,
 * and no `password` cvar is emitted at all in this case, still only ever through the cfg file,
 * never argv. Without `spectate`, `input.userinfo` passes through unchanged (byte-for-byte
 * identical to story 125's behaviour).
 */
export function resolveEffectiveUserinfo(
  input: Pick<LaunchInput, 'userinfo' | 'spectate'>,
): LaunchUserinfo | undefined {
  if (input.spectate) {
    return { spectator: input.userinfo?.password ?? '1' }
  }
  return input.userinfo
}

/**
 * Whether a planned command line tells the game to exec the connect cfg - the one condition under
 * which `LaunchService.start()` writes that file, so a password is never put on disk for a launch
 * that would not read it.
 */
export function execsConnectCfg(args: readonly string[]): boolean {
  return args.some((arg, index) => arg === '+exec' && args[index + 1] === CONNECT_CFG_NAME)
}

export interface BuildLaunchArgsResult {
  args: string[]
  /** Values that had to be dropped because they cannot be passed safely. */
  dropped: Array<{ reason: 'unsafe-token' | 'invalid-address'; value: string }>
}

export function buildLaunchArgs(
  installation: Installation,
  input: Pick<LaunchInput, 'gameDir' | 'connect' | 'extraArgs' | 'userinfo' | 'spectate'> = {},
): BuildLaunchArgsResult {
  const args: string[] = []
  const dropped: BuildLaunchArgsResult['dropped'] = []

  // Engine switches first, by convention.
  const engine = getEngineDefinition(installation.engineKind)
  args.push(...(engine?.defaultArgs ?? []))

  // Mod / mission pack. `baseq2` is the default and must never be set.
  const gameDir = (input.gameDir ?? installation.activeGameDir).trim()
  if (gameDir && gameDir.toLowerCase() !== BASE_GAME_DIR) {
    if (isSafeEarlyToken(gameDir)) {
      args.push('+set', 'game', gameDir)
    } else {
      dropped.push({ reason: 'unsafe-token', value: gameDir })
    }
  }

  args.push(...installation.launchArgs)
  if (input.extraArgs) args.push(...input.extraArgs)

  // `+connect` last: it is a late command, so it runs after the config has been
  // applied, and its argument may safely contain a colon and a port. Story 125: the
  // connect cfg is exec'd immediately before it, so the userinfo it sets is in place
  // when the connect handshake sends it.
  if (input.connect) {
    const address = parseServerAddress(input.connect)
    if (address.ok) {
      if (hasUserinfo(resolveEffectiveUserinfo(input))) args.push('+exec', CONNECT_CFG_NAME)
      args.push('+connect', address.normalized)
    } else {
      dropped.push({ reason: 'invalid-address', value: input.connect })
    }
  }

  return { args, dropped }
}

/**
 * Display-only rendering of the command line. Never fed back into `spawn` - it
 * exists so the UI can show exactly what an installation will run.
 */
export function previewCommand(executablePath: string, args: string[]): string {
  const quote = (value: string): string => (/[\s"]/.test(value) ? `"${value}"` : value)
  return [executablePath, ...args].map(quote).join(' ')
}
