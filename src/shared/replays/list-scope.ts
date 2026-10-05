import type { DemoRow, ReplaysSourceError } from '@shared/modules/replays'

/** Which demos the list shows: one installation's, everything, or nothing (no active installation). */
export type DemoListScope =
  { kind: 'installation'; installationId: string } | { kind: 'all' } | { kind: 'none' }

/** A pure view filter over the globally scanned rows - the returned rows are the input objects. */
export function scopeDemoRows(rows: DemoRow[], scope: DemoListScope): DemoRow[] {
  if (scope.kind === 'all') return rows
  if (scope.kind === 'none') return []
  const { installationId } = scope
  return rows.filter(
    (row) =>
      row.source.kind === 'extraFolder' ||
      (row.reachedBy ?? [row.source.installationId]).includes(installationId),
  )
}

/** The source errors that concern what the scope shows: the installation's own sources and extra
 * folders. Every error stays visible with every installation shown. */
export function scopeSourceErrors(
  errors: ReplaysSourceError[],
  scope: DemoListScope,
): ReplaysSourceError[] {
  if (scope.kind === 'all') return errors
  if (scope.kind === 'none') return []
  return errors.filter(
    (error) =>
      error.source.kind === 'extraFolder' || error.source.installationId === scope.installationId,
  )
}
