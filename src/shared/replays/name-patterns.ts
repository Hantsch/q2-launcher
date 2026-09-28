/**
 * Shipped file-name patterns for demos (concept §7's shipped-patterns table, engine rules §17.2) and
 * `parseDemoName`, which walks an ordered list of patterns (shipped or user-defined) and reports the
 * first one that matches a file name uniquely.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 */

import { compileNameTemplate, matchNameTemplate, type CompiledNameTemplate, type NameFacts } from './name-template'

/**
 * Shipped patterns, most-specific first: OpenTDM, AQ2-TNG, r1q2, Q2PRO recipe. Order matters — every
 * OpenTDM name also matches the looser Q2PRO `{map}_{date}_{time}` shape, so OpenTDM must be tried
 * first or it would falsely match as Q2PRO.
 */
export const SHIPPED_NAME_PATTERNS: readonly { id: string; template: string }[] = [
  { id: 'opentdm', template: '{pov}-{teamA}-{teamB}-{host}-{map}_{date}_{time}' },
  { id: 'aq2tng-mvd2', template: '{year}{month}{day}-{hour}{min}{sec}-{map}.mvd2' },
  { id: 'r1q2-autorecord', template: '{year}-{month}-{day}-{hour}{min}-{map}.dm2' },
  { id: 'q2pro-beginmapcmd', template: '{map}_{date}_{time}.dm2' },
]

export type ParseDemoNameResult =
  | { status: 'matched'; patternId: string; facts: NameFacts }
  | { status: 'ambiguous'; patternId: string }
  | { status: 'none' }

type CompiledEntry = { id: string; template: CompiledNameTemplate }

const compiledCache = new WeakMap<readonly { id: string; template: string }[], CompiledEntry[]>()

function compileEntries(patterns: readonly { id: string; template: string }[]): CompiledEntry[] {
  const cached = compiledCache.get(patterns)
  if (cached !== undefined) return cached

  const entries: CompiledEntry[] = []
  for (const p of patterns) {
    const result = compileNameTemplate(p.template)
    if (result.ok) entries.push({ id: p.id, template: result.template })
  }
  compiledCache.set(patterns, entries)
  return entries
}

/**
 * Walks `patterns` top to bottom, compiling each (cached per array identity) and matching `fileName`
 * against it. The first pattern that matches uniquely wins. A pattern that matches ambiguously stops
 * the walk immediately — later, looser patterns are never tried, so an ambiguous split is never
 * silently resolved by falling through to a shape that happens to match cleanly.
 */
export function parseDemoName(
  fileName: string,
  patterns: readonly { id: string; template: string }[],
): ParseDemoNameResult {
  const entries = compileEntries(patterns)
  for (const entry of entries) {
    const result = matchNameTemplate(entry.template, fileName)
    if (result.kind === 'match') return { status: 'matched', patternId: entry.id, facts: result.facts }
    if (result.kind === 'ambiguous') return { status: 'ambiguous', patternId: entry.id }
  }
  return { status: 'none' }
}
