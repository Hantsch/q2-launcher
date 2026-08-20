import type { ConfigAction } from '@shared/modules/config'
import { aliasNameFor } from '@shared/config/alias-render'

/**
 * Story 019 D6: the names a binding's raw-command field can offer while the
 * user types, so `+test` (an alias entry) is suggested rather than left for
 * the user to remember and retype exactly.
 *
 * Only `kind: 'alias'` entries qualify - a bind or message entry is never
 * callable by name, so it is excluded even if its own name happens to look
 * alias-like (e.g. starts with `+`).
 *
 * The name itself comes from `aliasNameFor` (`alias-render.ts`), the same
 * function the config writer uses to decide what an alias entry is called in
 * the rendered file - reusing it here means a suggestion can never drift from
 * what actually lands on disk (sign carried over verbatim, remainder slugged,
 * S04 watch-out against re-deriving engine-name rules).
 */
export function getAliasSuggestions(actions: ConfigAction[]): string[] {
  return actions.filter((action) => action.kind === 'alias').map((action) => aliasNameFor(action))
}
