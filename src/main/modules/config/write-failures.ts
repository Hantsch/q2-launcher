export type WriteFailures = Record<string, { messageKey: string; at: string }>

/**
 * Applies one sync run's delta (`before` -> `after`) onto the live failures. A run that started
 * before another one finished must not overwrite that run's entries with its stale snapshot, so
 * only keys this run added, changed or removed are touched. Returns `live` itself when nothing
 * changed, which the state store treats as "no write".
 */
export function mergeWriteFailureChanges(
  live: WriteFailures,
  before: WriteFailures,
  after: WriteFailures,
): WriteFailures {
  let merged: WriteFailures | null = null
  for (const [key, value] of Object.entries(after)) {
    const prior = before[key]
    if (prior !== undefined && prior.messageKey === value.messageKey && prior.at === value.at) {
      continue
    }
    const current = live[key]
    if (
      current !== undefined &&
      current.messageKey === value.messageKey &&
      current.at === value.at
    ) {
      continue
    }
    merged ??= { ...live }
    merged[key] = value
  }
  for (const key of Object.keys(before)) {
    if (key in after || !(key in live)) continue
    merged ??= { ...live }
    delete merged[key]
  }
  return merged ?? live
}
