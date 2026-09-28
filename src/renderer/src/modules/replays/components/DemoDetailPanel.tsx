import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { DemoRow, SidecarState } from '@shared/modules/replays'
import { buildDemoDetail, type DemoDetailField } from '@shared/replays/demo-detail'
import type { SidecarSide } from '@shared/replays/sidecar'
import { IconButton } from '../../../components/ui/Button'
import { sidecarRead } from '../client'
import { sidesText, formatDemoDate } from '../row-format'
import { ValueSourceLabel } from './ValueSourceLabel'
import { DemoFileActions } from './DemoFileActions'
import { DemoNotesEditor } from './DemoNotesEditor'
import type { RowPatcher } from '../demo-editor-store'

export interface DemoDetailPanelProps {
  row: DemoRow
  onClose: () => void
  /** Patches this row's `sidecar` part in the view's list after a save - never a rescan. */
  onRowPatched: RowPatcher
  /** Story 157 D4: a rename swapped this row's id (and file name) out from under the selection -
   * threaded straight through to `DemoFileActions`/`RenameDemoDialog`. */
  onRenamed: (oldId: string, newRow: DemoRow) => void
  /** Every other demo's sidecar tags, threaded down to the notes editor's tag-suggestion input. */
  otherDemosTags?: string[][]
}

const NO_OTHER_TAGS: string[][] = []

/** Renders one `DemoDetailField`'s value as text - mirrors each field's own natural formatting
 * (`sidesText` for `sides`, a localised date for `date`, a joined list for `tags`) rather than a
 * generic `String(value)`, which would print `[object Object]` for a `sides` array. */
function fieldValueText(
  field: DemoDetailField,
  t: (key: string, params?: Record<string, unknown>) => string,
  locale: string,
): string {
  switch (field.id) {
    case 'sides':
      return sidesText((field.value as SidecarSide[]).map((side) => ({ ...side })))
    case 'tags':
      return (field.value as string[]).join(', ')
    case 'date': {
      const formatted = formatDemoDate(field.value as number, locale)
      return formatted ?? String(field.value)
    }
    case 'favourite':
      return t('replays.row.favourite')
    case 'duration': {
      const ms = field.value as number
      const totalSeconds = Math.floor(ms / 1000)
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      return `${minutes}:${String(seconds).padStart(2, '0')}`
    }
    default:
      return String(field.value)
  }
}

/**
 * Story 155 D1: the read-only "what the browser knows" panel for a selected demo - sticky header
 * (mirrors `ServerDetailView.tsx`'s), a `<dl>` of `buildDemoDetail`'s fields each paired with its
 * `ValueSourceLabel`, and the sidecar's specific issues (when its live state is `'error'`) - the
 * row's own `sidecar.state` only ever says `'error'`, never which problem, so this panel calls
 * `sidecarRead(row.id)` itself to get the itemized `issues` (story 147's `replays.sidecar.issue.*`
 * keys) rather than trusting the row.
 */
export function DemoDetailPanel({
  row,
  onClose,
  onRowPatched,
  onRenamed,
  otherDemosTags = NO_OTHER_TAGS,
}: DemoDetailPanelProps) {
  const { t, i18n } = useTranslation()
  const [liveSidecar, setLiveSidecar] = useState<SidecarState | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLiveSidecar(null)
    void sidecarRead(row.id).then((result) => {
      if (requestIdRef.current !== requestId) return
      setLiveSidecar(result.ok ? result.value.state : null)
    })
  }, [row.id])

  const detail = buildDemoDetail(row, row.sidecar.values)
  const title = row.effective.name.value ?? row.fileName

  return (
    <section aria-labelledby="replays-detail-title" data-testid="replays-detail">
      <div className="sticky top-0 z-10 flex h-9 items-center justify-between gap-2 border-b border-line bg-panel px-4">
        <h2
          id="replays-detail-title"
          data-testid="replays-detail-title"
          className="min-w-0 truncate text-sm font-medium text-ink"
        >
          {title}
        </h2>
        <IconButton
          label={t('replays.detail.close')}
          size="sm"
          onClick={onClose}
          data-testid="replays-detail-close"
        >
          <X className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            {t('replays.detail.knownSection')}
          </h3>
          <dl className="mt-2 space-y-2">
            {detail.fields.map((field) => (
              <div
                key={field.id}
                className="flex items-baseline justify-between gap-3 text-sm"
                data-testid={`replays-detail-field-${field.id}`}
              >
                <dt className="text-ink-muted">{t(`replays.detail.field.${field.id}`)}</dt>
                <dd className="flex min-w-0 items-baseline gap-2 text-right">
                  <span className="truncate text-ink">{fieldValueText(field, t, i18n.language)}</span>
                  <ValueSourceLabel source={field.source} />
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div data-testid="replays-detail-file-actions">
          <DemoFileActions demo={row} onRenamed={onRenamed} />
        </div>

        {liveSidecar !== null && liveSidecar.state === 'error' && (
          <ul className="space-y-1 text-xs text-danger" data-testid="replays-detail-sidecar-issues">
            {liveSidecar.issues.map((issue, index) => (
              <li key={`${issue.kind}-${index}`}>{t(issue.key, issue.params)}</li>
            ))}
          </ul>
        )}

        <div data-testid="replays-notes-slot">
          <DemoNotesEditor
            demoId={row.id}
            values={row.sidecar.values}
            onRowPatched={onRowPatched}
            disabledReason={row.archiveEntry !== null ? 'replays.sidecar.error.archiveEntry' : null}
            mapField={detail.fields.find((field) => field.id === 'map')}
            knownPlayers={detail.knownPlayers}
            otherDemosTags={otherDemosTags}
          />
        </div>
      </div>
    </section>
  )
}
