import { execFile } from 'node:child_process'
import { scopedLogger } from './logger'

const log = scopedLogger('registry')

export interface RegistryValue {
  /** Full key path, e.g. `HKEY_CURRENT_USER\Software\Valve\Steam`. */
  key: string
  name: string
  type: string
  value: string
}

/**
 * Reads the Windows registry by shelling out to the built-in `reg.exe`.
 *
 * Deliberately dependency-free: every npm option for this is either a native
 * module (prebuild pain, rebuild-per-Electron-version) or wraps `reg.exe`
 * anyway. `reg.exe` is present on every supported Windows version.
 */
export async function regQuery(
  key: string,
  options: { valueName?: string; recursive?: boolean; timeoutMs?: number } = {},
): Promise<RegistryValue[]> {
  if (process.platform !== 'win32') return []

  const args = ['query', key]
  if (options.valueName) args.push('/v', options.valueName)
  if (options.recursive) args.push('/s')

  const stdout = await new Promise<string>((resolve) => {
    execFile(
      'reg.exe',
      args,
      { timeout: options.timeoutMs ?? 5_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, out) => {
        // A missing key is the normal case, not an error worth logging loudly.
        if (error && !/cannot find|unable to find/i.test(String(error.message))) {
          log.debug(`reg query ${key} failed: ${error.message}`)
        }
        resolve(out ?? '')
      },
    )
  })

  return parseRegOutput(stdout)
}

/**
 * `reg.exe` prints a key on its own line, then its values indented:
 *
 *   HKEY_CURRENT_USER\Software\Valve\Steam
 *       SteamPath    REG_SZ    c:/program files (x86)/steam
 */
export function parseRegOutput(stdout: string): RegistryValue[] {
  const values: RegistryValue[] = []
  let currentKey = ''

  for (const rawLine of stdout.split(/\r?\n/)) {
    if (rawLine.trim().length === 0) continue

    if (!/^\s/.test(rawLine)) {
      currentKey = rawLine.trim()
      continue
    }

    // name <spaces> REG_TYPE <spaces> value(may contain spaces)
    const match = /^\s+(.+?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/.exec(rawLine)
    if (match && currentKey) {
      values.push({
        key: currentKey,
        name: match[1].trim(),
        type: match[2],
        value: match[3].trim(),
      })
    }
  }

  return values
}

/** Convenience: first matching value, or null. */
export async function regReadValue(key: string, valueName: string): Promise<string | null> {
  const values = await regQuery(key, { valueName })
  const hit = values.find((v) => v.name.toLowerCase() === valueName.toLowerCase())
  return hit?.value ?? null
}
