import type { EngineKind } from '@shared/types/engine'
import { engineLabel } from '@shared/types/engine'
import { Badge } from './primitives'

/**
 * The engine-kind badge shown wherever an installation's engine is surfaced
 * (rail card, hero panel, and future call sites - inspection, candidates).
 * Takes `engineKind` directly rather than an `Installation` so non-installation
 * call sites can use it too.
 *
 * Tone/label rule is intentionally the single place it lives: `r1q2` gets the
 * `flame` tone, every other engine (including `unknown`) gets `neutral`. Do not
 * add per-engine tones here - story 065 D1 keeps this identical to the rail/hero
 * badges it replaces.
 */
export function EngineBadge({ engineKind }: { engineKind: EngineKind }) {
  return (
    <Badge tone={engineKind === 'r1q2' ? 'flame' : 'neutral'} testId="engine-badge">
      {engineLabel(engineKind)}
    </Badge>
  )
}
