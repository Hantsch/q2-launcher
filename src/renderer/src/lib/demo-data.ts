import type { ValidationCheck } from '@shared/types'

/**
 * Truth source for the "Demo" marker (story 074 D7): an installation is demo
 * data exactly when its checks contain the inspector's
 * `validation.pak0NotRetail` warning (`src/main/services/inspector.ts` ~line
 * 196) - derived at read time, no stored flag, no migration. This also labels
 * a demo folder the user added by hand, which is intentional.
 *
 * Takes `checks` directly rather than the whole `Installation`, mirroring
 * `EngineBadge`'s `engineKind` convention, so non-installation call sites can
 * use it too. Matches on `messageKey` with exact equality, never
 * `.includes()` - a substring match would also catch keys that merely start
 * the same way.
 */
export function isDemoData(checks: ValidationCheck[]): boolean {
  return checks.some((check) => check.messageKey === 'validation.pak0NotRetail')
}
