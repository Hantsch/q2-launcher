import { isWindows } from './platform'

type BootEnv = Readonly<Record<string, string | undefined>>

/**
 * The process environment as modules may see it: a frozen shallow copy without any `Q2L_*` key.
 * Launcher control variables (harness fixtures, key overrides) reach code only through the
 * resolved gates (`UiHarness`), never by reading the env directly. (story 209)
 *
 * `process.env` is case-insensitive on Windows (`ProgramFiles` finds `PROGRAMFILES`), a plain copy
 * is not, so lookups of a name that is not stored verbatim fall back to a case-folded match there.
 * Linux stays exact. The platform is read per lookup so tests can switch it.
 */
export function bootEnv(env: NodeJS.ProcessEnv): BootEnv {
  const copy: Record<string, string | undefined> = {}
  const folded = new Map<string, string>()
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('Q2L_')) continue
    copy[key] = value
    const lower = key.toLowerCase()
    if (!folded.has(lower)) folded.set(lower, key)
  }
  Object.freeze(copy)

  const resolve = (prop: string | symbol): string | symbol => {
    if (typeof prop !== 'string' || prop in copy || !isWindows()) return prop
    return folded.get(prop.toLowerCase()) ?? prop
  }
  return new Proxy(copy, {
    get: (target, prop) => Reflect.get(target, resolve(prop)),
    has: (target, prop) => Reflect.has(target, resolve(prop)),
    getOwnPropertyDescriptor: (target, prop) => Reflect.getOwnPropertyDescriptor(target, prop),
  })
}
