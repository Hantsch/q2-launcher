import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { regReadValue } from '../../lib/win-registry'

/**
 * Derives this machine's launcher installation id (story 128 D2).
 *
 * The id is a one-way, salted hash of a platform machine identifier
 * (`MachineGuid` on Windows, `/etc/machine-id` on Linux), never the raw value
 * itself. `resolveLauncherInstallId` must never let that raw value escape -
 * not in the return value, not in a thrown/caught error message, not logged -
 * only the derived 12-character base32 id may ever leave this module.
 */

const SALT = 'q2-launcher/unlock/v1'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** First 60 bits (7.5 bytes) of the digest, as 12 RFC 4648 base32 characters (no padding). */
function base32Encode60Bits(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''

  for (let i = 0; i < 8 && output.length < 12; i++) {
    // Only the first 60 bits (7 full bytes + 4 bits of the 8th) are used.
    const byte = i < 7 ? bytes[i] : bytes[7] & 0xf0
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5 && output.length < 12) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }

  return output
}

/** Pure: `sha256(SALT + normalized raw value)`, truncated to 60 bits and base32-encoded. */
export function deriveLauncherInstallId(raw: string): string {
  const normalized = raw.trim().toLowerCase()
  const digest = createHash('sha256').update(SALT + normalized).digest()
  return base32Encode60Bits(digest)
}

export interface ResolveLauncherInstallIdDeps {
  platform: NodeJS.Platform
  readRegistry: (key: string, valueName: string) => Promise<string | null>
  readFile: (path: string) => Promise<string>
}

function defaultDeps(): ResolveLauncherInstallIdDeps {
  return {
    platform: process.platform,
    readRegistry: regReadValue,
    readFile: (path: string) => fs.readFile(path, 'utf8'),
  }
}

async function readLinuxMachineId(readFile: ResolveLauncherInstallIdDeps['readFile']): Promise<string | null> {
  for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const contents = await readFile(path)
      if (contents.trim().length > 0) return contents
    } catch {
      // Try the next candidate; any failure here is generic, never detailed.
    }
  }
  return null
}

/**
 * Resolves this machine's launcher installation id, or `null` when it cannot
 * be determined (unsupported platform, missing/empty value, or any error
 * reading it). Never throws, and never lets the raw machine value leave this
 * function in any form.
 */
export async function resolveLauncherInstallId(
  deps: Partial<ResolveLauncherInstallIdDeps> = {},
): Promise<string | null> {
  const { platform, readRegistry, readFile } = { ...defaultDeps(), ...deps }

  try {
    let raw: string | null = null

    if (platform === 'win32') {
      raw = await readRegistry('HKLM\\SOFTWARE\\Microsoft\\Cryptography', 'MachineGuid')
    } else if (platform === 'linux') {
      raw = await readLinuxMachineId(readFile)
    }

    if (raw === null || raw.trim().length === 0) return null
    return deriveLauncherInstallId(raw)
  } catch {
    // Deliberately generic: the raw value or any failure detail must never
    // surface here, in a log or in an error message.
    return null
  }
}
