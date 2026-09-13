import type { TFunction } from 'i18next'
import type { EngineKind } from '@shared/types/engine'
import { engineLabel, isEngineSupported } from '@shared/types/engine'

/**
 * The single place that composes the "unsupported" marker onto an engine's
 * display label. Every call site that shows an installation's engine to the
 * user (badge, hero stat, ...) must go through this instead of building the
 * "(unsupported)" string itself - see story 068 D4.
 */
export function engineDisplayLabel(kind: EngineKind, t: TFunction): string {
  const label = engineLabel(kind)
  if (isEngineSupported(kind)) return label
  return t('engine.unsupportedLabel', { engine: label })
}
