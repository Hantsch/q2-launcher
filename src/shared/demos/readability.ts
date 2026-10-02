/**
 * Projects a `DemoHeaderResult` (the real `.dm2`/`.mvd2` header parsers' output) down to the one
 * question the demos index and its UI actually need: is this row readable, and if not, why — a
 * stable code, never prose, so the renderer can look the reason up in i18n.
 *
 * `DEMO_UNREADABLE_REASONS` is the full set of unreadable codes an index row can carry. It is a
 * superset of what `parseDemoHeader` itself produces: the zip-entry layer (`src/main/lib/zip-
 * entries.ts`, `src/main/modules/replays/zip-demos.ts`) adds `'entry-too-large'`/`'encrypted'`/
 * `'unreadable'` for reasons that never reach the header parser at all (a member too large to
 * extract, or password-protected, is never even handed to `parseDemoHeader`). That superset
 * already exists as `demoUnparsableReasonSchema` in `src/shared/modules/replays.ts`; the list here
 * is kept in sync with it by hand.
 *
 * Because of that superset relationship, a true two-way equality between `DemoUnreadableReason`
 * and the real parsers' own reason union would never hold - the parsers can never emit the
 * zip-layer-only codes. What must hold, and is asserted below at compile time, is the direction
 * that actually protects us: every reason the real parsers can produce is one of
 * `DEMO_UNREADABLE_REASONS`. A new parser reason code that isn't added there fails `npm run
 * typecheck`.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { z } from 'zod'
import type { DemoHeaderResult } from './demo-header'

/** Every reason a demo index row can be unreadable for. Kept in sync by hand with
 * `demoUnparsableReasonSchema` in `src/shared/modules/replays.ts`. */
export const DEMO_UNREADABLE_REASONS = [
  'empty',
  'truncated',
  'not-a-demo',
  'unknown-protocol',
  'header-too-large',
  'unreadable',
  'unknown-version',
  'entry-too-large',
  'encrypted',
] as const

export type DemoUnreadableReason = (typeof DEMO_UNREADABLE_REASONS)[number]

/** Every reason the real header parsers (`parseDm2Header`/`parseMvd2Header`, dispatched by
 * `parseDemoHeader`) can themselves produce. */
type ParserUnreadableReason = Extract<DemoHeaderResult, { ok: false }>['reason']

/**
 * Compile-time assertion: every reason the real parsers can produce must be a member of
 * `DEMO_UNREADABLE_REASONS`. If a parser gains a new reason code that isn't added to the list
 * above, `ParserUnreadableReason extends DemoUnreadableReason` stops being `true` and this
 * assignment fails to compile.
 */
type AssertParserReasonsCovered = ParserUnreadableReason extends DemoUnreadableReason ? true : false
const _assertParserReasonsCovered: AssertParserReasonsCovered = true
void _assertParserReasonsCovered

export const demoUnreadableSchema = z.object({
  reason: z.enum(DEMO_UNREADABLE_REASONS),
  protocol: z.number().int().optional(),
  version: z.number().int().optional(),
})

export type DemoUnreadable = z.infer<typeof demoUnreadableSchema>

export type DemoReadability =
  { readable: true; unreadable: null } | { readable: false; unreadable: DemoUnreadable }

/**
 * Projects a `DemoHeaderResult` down to readability: `ok: true` becomes `{ readable: true,
 * unreadable: null }`; `ok: false` copies `reason` and, only when present on the result,
 * `protocol`/`version` — never adding those keys when the parser didn't set them.
 */
export function demoReadability(result: DemoHeaderResult): DemoReadability {
  if (result.ok) return { readable: true, unreadable: null }

  const unreadable: DemoUnreadable = { reason: result.reason }
  if ('protocol' in result && result.protocol !== undefined) unreadable.protocol = result.protocol
  if ('version' in result && result.version !== undefined) unreadable.version = result.version

  return { readable: false, unreadable }
}
