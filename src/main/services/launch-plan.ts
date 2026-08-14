import { BASE_GAME_DIR } from '@shared/constants'
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

export interface BuildLaunchArgsResult {
  args: string[]
  /** Values that had to be dropped because they cannot be passed safely. */
  dropped: Array<{ reason: 'unsafe-token'; value: string }>
}

export function buildLaunchArgs(
  installation: Installation,
  input: Pick<LaunchInput, 'gameDir' | 'connect' | 'extraArgs'> = {},
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
  // applied, and its argument may safely contain a colon and a port.
  if (input.connect) args.push('+connect', input.connect)

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
