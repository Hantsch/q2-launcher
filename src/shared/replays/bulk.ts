/**
 * The answer to a bulk action over several demos: one item per requested id, in request order, so
 * a partial result names exactly which demos were acted on and why the others were not (story 244)
 */

export type BulkItemStatus = 'done' | 'failed' | 'skipped'

export interface BulkItemOutcome {
  demoId: string
  status: BulkItemStatus
  /** An i18n key under `replays.bulk.reason`; `null` for a `done` item. */
  reasonKey: string | null
  params?: Record<string, string | number>
}

export interface BulkOutcome {
  items: BulkItemOutcome[]
}
