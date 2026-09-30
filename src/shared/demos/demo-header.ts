/**
 * Chooses which demo-format header parser to run, purely from the bytes themselves: `.dm2` and
 * `.mvd2` share no reliable filename convention across every client/server that produces them, so
 * the dispatch is content-based — the `"MVD2"` magic present or absent — never filename-based.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { parseDm2Header } from './dm2-header'
import type { Dm2Header, Dm2Unparsable } from './dm2-header'
import { parseMvd2Header } from './mvd2-header'
import type { Mvd2Header, Mvd2Unparsable } from './mvd2-header'

export type DemoHeaderResult = (Dm2Header & { format: 'dm2' }) | Mvd2Header | Dm2Unparsable | Mvd2Unparsable

/**
 * Parses a demo file's header, dispatching on the `"MVD2"` magic: present → `parseMvd2Header`
 * (already reports `format: 'mvd2'`); absent → `parseDm2Header`, with `format: 'dm2'` added to a
 * successful result.
 */
export function parseDemoHeader(bytes: Uint8Array): DemoHeaderResult {
  const isMvd2 = bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x56 && bytes[2] === 0x44 && bytes[3] === 0x32

  if (isMvd2) return parseMvd2Header(bytes)

  const result = parseDm2Header(bytes)
  if (result.ok) return { ...result, format: 'dm2' as const }
  return result
}
