/**
 * Derives the reported r1q2/q2pro/vanilla engine off a `status`/`info` reply's `protocol` key.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { readIntKey } from './infostring'

export type ServerEngine = 'vanilla' | 'r1q2' | 'q2pro'

/**
 * Reads the `protocol` key out of a serverinfo record as an integer, per `readIntKey`'s own
 * tolerant rules (absent or non-integer value -> `undefined`). `null`/`undefined` input -> also
 * `undefined` — a reply that never carried a serverinfo record at all.
 */
export function deriveProtocol(serverinfo: Record<string, string> | null | undefined): number | undefined {
  if (serverinfo == null) return undefined
  return readIntKey(serverinfo, 'protocol')
}

/**
 * Maps a reported protocol number to the engine that uses it: `34` is vanilla/3.20, `35` is r1q2,
 * `36` is q2pro. Anything else — including `undefined` — is an engine this launcher does not
 * recognize, reported as `undefined` rather than guessed at.
 */
export function deriveEngine(protocol: number | undefined): ServerEngine | undefined {
  switch (protocol) {
    case 34:
      return 'vanilla'
    case 35:
      return 'r1q2'
    case 36:
      return 'q2pro'
    default:
      return undefined
  }
}
