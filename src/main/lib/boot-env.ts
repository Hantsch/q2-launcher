/**
 * The process environment as modules may see it: a frozen shallow copy without any `Q2L_*` key.
 * Launcher control variables (harness fixtures, key overrides) reach code only through the
 * resolved gates (`UiHarness`), never by reading the env directly. (story 209)
 */
export function bootEnv(env: NodeJS.ProcessEnv): Readonly<Record<string, string | undefined>> {
  const copy: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('Q2L_')) copy[key] = value
  }
  return Object.freeze(copy)
}
