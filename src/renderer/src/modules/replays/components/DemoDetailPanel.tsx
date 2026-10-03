import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Star, X } from 'lucide-react'
import type { DemoRow, SidecarState } from '@shared/modules/replays'
import { buildDemoDetail, type DemoDetailField } from '@shared/replays/demo-detail'
import type { SidecarSide } from '@shared/replays/sidecar'
import { describeGamemode } from '@shared/demos/gamemode'
import { IconButton } from '../../../components/ui/Button'
import { cn } from '../../../lib/cn'
import { sidecarRead } from '../client'
import { sidesText, formatDemoDate } from '../row-format'
import { DemoFileActions } from './DemoFileActions'
import { StarRating } from './StarRating'
import { DemoDetailEditor, DemoDetailNameInput } from './DemoDetailEditor'
import { DiscardDemoNotesDialog } from './DiscardDemoNotesDialog'
import { effectiveQuickValues, useDemoEditorStore, type RowPatcher } from '../demo-editor-store'

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
 * (`sidesText` for `sides`, a localised date for `date`) rather than a
 * generic `String(value)`, which would print `[object Object]` for a `sides` array. */
function fieldValueText(
  field: DemoDetailField,
  t: (key: string, params?: Record<string, unknown>) => string,
  locale: string,
): string {
  switch (field.id) {
    case 'sides':
      return sidesText((field.value as SidecarSide[]).map((side) => ({ ...side })))
    case 'gamemode': {
      const { labelKey, text } = describeGamemode({
        value: field.value as string | null,
        source: field.source,
      } as Parameters<typeof describeGamemode>[0])
      return labelKey ? t(labelKey) : (text ?? '')
    }
    case 'date': {
      const formatted = formatDemoDate(field.value as number, locale)
      return formatted ?? String(field.value)
    }
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
 * Story 155 D1: the read-only facts panel for a selected demo - sticky header
 * (mirrors `ServerDetailView.tsx`'s), two `<dl>`s of `buildDemoDetail`'s fields (file facts, match facts), and the sidecar's specific issues (when its live state is `'error'`) - the
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

  // Edit mode needs both the flag and the draft it binds - the header and body switch together.
  const editing = useDemoEditorStore(
    (state) => state.editingId === row.id && state.drafts[row.id] !== undefined,
  )
  const pendingLeave = useDemoEditorStore((state) => state.pendingLeave)
  const favourite = useDemoEditorStore(
    (state) => effectiveQuickValues(state.quickPending[row.id], row.sidecar.values).favourite,
  )
  const rating = useDemoEditorStore(
    (state) => effectiveQuickValues(state.quickPending[row.id], row.sidecar.values).rating,
  )
  const { keepEditing, discardAndLeave } = useDemoEditorStore.getState()
  const archived = row.archiveEntry !== null
  const detail = buildDemoDetail(row, row.sidecar.values)
  const title = row.effective.name.value ?? row.fileName
  const description = row.sidecar.values.description?.trim()
  const tags = row.sidecar.values.tags
  const factText = (id: DemoDetailField['id']): string | undefined => {
    const field = detail.fields.find((candidate) => candidate.id === id)
    return field === undefined ? undefined : fieldValueText(field, t, i18n.language)
  }

  return (
    <section
      aria-labelledby={editing ? undefined : 'replays-detail-title'}
      aria-label={editing ? title : undefined}
      data-testid="replays-detail"
    >
      <div
        className="sticky top-0 z-10 border-b border-line bg-panel px-4 py-2"
        data-testid="replays-detail-header"
      >
        <div className="flex min-h-8 flex-wrap items-center gap-2">
          {editing ? (
            <>
              <h2 className="sr-only">{title}</h2>
              <DemoDetailNameInput row={row} />
            </>
          ) : (
            <h2
              id="replays-detail-title"
              data-testid="replays-detail-title"
              className="min-w-0 flex-1 truncate text-lg font-semibold text-ink"
            >
              {title}
            </h2>
          )}
          <IconButton
            label={t('replays.detail.favourite.ariaLabel', { name: title })}
            size="sm"
            aria-pressed={favourite}
            disabled={archived}
            aria-describedby={archived ? 'replays-archive-readonly-edit' : undefined}
            onClick={() => {
              void useDemoEditorStore
                .getState()
                .quickEdit(row.id, { favourite: !favourite }, onRowPatched)
            }}
            data-testid="replays-detail-favourite"
          >
            <Star
              className={cn(
                'size-3.5',
                favourite ? 'fill-flame-500 text-flame-500' : 'text-ink-muted',
              )}
              aria-hidden="true"
            />
          </IconButton>
          {!editing && <DemoFileActions demo={row} onRenamed={onRenamed} />}
          {!editing && (
            <IconButton
              label={t('common.action.edit')}
              size="sm"
              disabled={archived}
              aria-describedby={archived ? 'replays-archive-readonly-edit' : undefined}
              onClick={() => useDemoEditorStore.getState().startEdit(row.id, row.sidecar.values)}
              data-testid="replays-detail-edit"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </IconButton>
          )}
          <IconButton
            label={t('common.action.close')}
            size="sm"
            onClick={onClose}
            data-testid="replays-detail-close"
          >
            <X className="size-3.5" aria-hidden="true" />
          </IconButton>
        </div>
        {archived && !editing && (
          <div
            className="mt-2 space-y-1 text-xs text-ink-dim"
            data-testid="replays-archive-readonly"
          >
            <p id="replays-archive-readonly-edit" data-testid="replays-archive-readonly-edit">
              {t('replays.archive.readOnly.edit')}
            </p>
            <p id="replays-archive-readonly-rename" data-testid="replays-archive-readonly-rename">
              {t('replays.archive.readOnly.rename')}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <StarRating
            label={t('replays.detail.rating.label')}
            value={rating}
            disabled={archived}
            describedBy={archived ? 'replays-archive-readonly-edit' : undefined}
            onChange={(value) => {
              void useDemoEditorStore.getState().quickEdit(row.id, { rating: value }, onRowPatched)
            }}
          />
          <span className="numeric text-sm text-ink-dim" data-testid="replays-detail-rating-value">
            {rating === null
              ? t('replays.detail.rating.none')
              : t('replays.row.ratingValue', { rating })}
          </span>
        </div>
        {editing ? (
          <DemoDetailEditor
            row={row}
            onRowPatched={onRowPatched}
            readOnlyText={{ duration: factText('duration'), pov: factText('pov') }}
            knownPlayers={detail.knownPlayers}
            otherDemosTags={otherDemosTags}
          />
        ) : (
          <div className="space-y-5">
            {(['file', 'match'] as const).map((group) => {
              const fields = detail.fields.filter((field) => field.group === group)
              if (fields.length === 0) return null
              return (
                <dl key={group} className="space-y-2" data-testid={`replays-detail-facts-${group}`}>
                  {fields.map((field) => (
                    <div
                      key={field.id}
                      className="flex items-baseline justify-between gap-3 text-sm"
                      data-testid={`replays-detail-field-${field.id}`}
                    >
                      <dt className="text-ink-muted">{t(`replays.detail.field.${field.id}`)}</dt>
                      <dd className="min-w-0 truncate text-right text-ink">
                        {fieldValueText(field, t, i18n.language)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )
            })}
            {description !== undefined && description !== '' && (
              <p
                className="whitespace-pre-wrap wrap-break-word text-sm text-ink"
                data-testid="replays-detail-description"
              >
                {description}
              </p>
            )}
            {tags !== undefined && tags.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" data-testid="replays-detail-tags">
                {tags.map((tag) => (
                  <li
                    key={tag}
                    className="inline-flex items-center rounded-full border border-line-strong px-2 py-0.5 text-xs text-ink"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {row.format === 'mvd2' && (
          <p className="text-xs text-ink-muted" data-testid="demo-detail-mvd2-note">
            {t('replays.detail.mvd2Note')}
          </p>
        )}

        {liveSidecar !== null && liveSidecar.state === 'error' && (
          <ul className="space-y-1 text-xs text-danger" data-testid="replays-detail-sidecar-issues">
            {liveSidecar.issues.map((issue, index) => (
              <li key={`${issue.kind}-${index}`}>{t(issue.key, issue.params)}</li>
            ))}
          </ul>
        )}
      </div>

      {pendingLeave !== null && (
        <DiscardDemoNotesDialog onKeepEditing={keepEditing} onDiscard={discardAndLeave} />
      )}
    </section>
  )
}
