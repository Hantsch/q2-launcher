import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Star, X } from 'lucide-react'
import type { DemoRow, SidecarState } from '@shared/modules/replays'
import { buildDemoDetail, type DemoDetailField } from '@shared/replays/demo-detail'
import {
  addTagChange,
  fieldPatchFromText,
  isoToDraftText,
  removeTagChange,
  setFields,
  suggestTags,
  validateTag,
  type SidecarField,
} from '@shared/replays/sidecar-draft'
import { describeGamemode } from '@shared/demos/gamemode'
import { IconButton } from '../../../components/ui/Button'
import { cn } from '../../../lib/cn'
import { sidecarRead } from '../client'
import { formatDemoDate } from '../row-format'
import { DemoFileActions } from './DemoFileActions'
import { SidesField } from './SidesField'
import { StarRating } from './StarRating'
import { InPlaceField, type CommitResult } from './InPlaceField'
import { TagInput } from './TagInput'
import { effectiveQuickValues, useDemoEditorStore, type RowPatcher } from '../demo-editor-store'

export interface DemoDetailPanelProps {
  row: DemoRow
  onClose: () => void
  /** Patches this row's `sidecar` part in the view's list after a save - never a rescan. */
  onRowPatched: RowPatcher
  /** Story 157: a rename swapped this row's id (and file name) out from under the selection -
   * threaded straight through to `DemoFileActions`/`RenameDemoDialog`. */
  onRenamed: (oldId: string, newRow: DemoRow) => void
  /** Every other demo's sidecar tags, threaded down to the notes editor's tag-suggestion input. */
  otherDemosTags?: string[][]
}

const NO_OTHER_TAGS: string[][] = []

/** The fields whose empty input shows the lower-source effective value as its placeholder. */
type PlaceholderFieldId = 'name' | 'map' | 'mod' | 'gamemode' | 'date'

/**
 * An empty input's placeholder. When the value the facts show comes from a lower source (the demo,
 * the file name, the file time), that value itself is the cue - with no source prefix; a value that
 * is the sidecar's own (or none at all) falls back to the generic hint. (story 178)
 */
export function editorPlaceholder(
  row: DemoRow,
  field: PlaceholderFieldId,
  t: (key: string) => string,
): string {
  const { value, source } = row.effective[field]
  if (source !== null && source !== 'sidecar' && value !== null && value !== '') {
    if (field === 'date' && typeof value === 'number' && Number.isFinite(value)) {
      return isoToDraftText(new Date(value).toISOString()).slice(0, 16)
    }
    if (typeof value === 'string') return value
  }
  return t(`replays.editor.placeholder.${field}`)
}

/** Renders one `DemoDetailField`'s value as text - mirrors each field's own natural formatting
 * (a localised date for `date`) rather than a generic `String(value)`. `sides` never reaches here:
 * `DemoPlayersPanel` renders it. */
function fieldValueText(
  field: DemoDetailField,
  t: (key: string, params?: Record<string, unknown>) => string,
  locale: string,
): string {
  switch (field.id) {
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
 * The one detail view of a selected demo: sticky header, the facts, the sidecar's specific issues
 * (when its live state is `'error'`) - the row's own `sidecar.state` only ever says `'error'`, never
 * which problem, so this panel calls `sidecarRead(row.id)` itself to get the itemized `issues`.
 * Every sidecar field is an `InPlaceField` that saves itself per field through the editor store
 * (story 243); an archive entry shows the same view read-only.
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

  const favourite = useDemoEditorStore(
    (state) => effectiveQuickValues(state.quickPending[row.id], row.sidecar.values).favourite,
  )
  const rating = useDemoEditorStore(
    (state) => effectiveQuickValues(state.quickPending[row.id], row.sidecar.values).rating,
  )
  const archived = row.archiveEntry !== null
  const detail = buildDemoDetail(row, row.sidecar.values)
  const title = row.effective.name.value ?? row.fileName
  const values = row.sidecar.values
  const tags = values.tags ?? []
  const [tagText, setTagText] = useState('')
  const factText = (id: DemoDetailField['id']): string | undefined => {
    const field = detail.fields.find((candidate) => candidate.id === id)
    return field === undefined ? undefined : fieldValueText(field, t, i18n.language)
  }

  const textField = (id: SidecarField, multiline = false) => {
    const label = id === 'name' ? t('common.label.name') : t(`replays.detail.field.${id}`)
    const sidecarText =
      id === 'date'
        ? values.date === undefined
          ? ''
          : isoToDraftText(values.date)
        : (values[id] ?? '')
    return (
      <InPlaceField
        value={sidecarText}
        display={id === 'name' || id === 'description' ? undefined : factText(id)}
        placeholder={id === 'description' ? '' : editorPlaceholder(row, id, t)}
        label={label}
        multiline={multiline}
        readOnly={archived}
        size={id === 'name' ? 'title' : 'sm'}
        validate={(text) => {
          const parsed = fieldPatchFromText(id, text)
          return parsed.ok ? null : parsed.error
        }}
        onCommit={async (text): Promise<CommitResult> => {
          const parsed = fieldPatchFromText(id, text)
          if (!parsed.ok) return 'failed'
          return useDemoEditorStore
            .getState()
            .edit(row.id, setFields(parsed.patch), onRowPatched)
        }}
        testId={`replays-detail-input-${id}`}
      />
    )
  }

  const factRow = (id: string, content: ReactNode) => (
    <div
      key={id}
      className="flex items-baseline justify-between gap-3 text-sm"
      data-testid={`replays-detail-field-${id}`}
    >
      <dt className="text-ink-muted">{t(`replays.detail.field.${id}`)}</dt>
      <dd className="min-w-0 w-3/5 text-right text-ink">{content}</dd>
    </div>
  )

  const plainFact = (id: 'fileName' | 'duration' | 'pov') => {
    const text = factText(id)
    return text === undefined ? null : factRow(id, <span className="block truncate">{text}</span>)
  }
  const editableFact = (id: Exclude<SidecarField, 'name' | 'description'>) =>
    factRow(id, textField(id))
  const tagChange = (change: ReturnType<typeof addTagChange>): void => {
    void useDemoEditorStore.getState().edit(row.id, change, onRowPatched)
  }

  return (
    <section aria-labelledby="replays-detail-title" data-testid="replays-detail">
      <div
        className="sticky top-0 z-10 border-b border-line bg-panel px-4 py-2"
        data-testid="replays-detail-header"
      >
        <div className="flex min-h-8 flex-wrap items-center gap-2">
          <h2 id="replays-detail-title" data-testid="replays-detail-title" className="sr-only">
            {title}
          </h2>
          <div className="min-w-0 flex-1">{textField('name')}</div>
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
          <DemoFileActions demo={row} onRenamed={onRenamed} />
          <IconButton
            label={t('common.action.close')}
            size="sm"
            onClick={onClose}
            data-testid="replays-detail-close"
          >
            <X className="size-3.5" aria-hidden="true" />
          </IconButton>
        </div>
        {archived && (
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
        <div className="space-y-5">
          <dl className="space-y-2" data-testid="replays-detail-facts-file">
            {plainFact('fileName')}
            {plainFact('duration')}
            {editableFact('date')}
          </dl>
          <dl className="space-y-2" data-testid="replays-detail-facts-match">
            {editableFact('map')}
            {editableFact('mod')}
            {editableFact('gamemode')}
            {plainFact('pov')}
          </dl>
          {(!archived ||
            detail.playerGroups.groups.length > 0 ||
            detail.playerGroups.spectators.length > 0) && (
            <div data-testid="replays-detail-field-sides">
              <SidesField
                row={row}
                detail={detail}
                readOnly={archived}
                onRowPatched={onRowPatched}
              />
            </div>
          )}
          {(!archived || (values.description ?? '').trim() !== '') && (
            <div className="space-y-1" data-testid="replays-detail-field-description">
              <span className="text-sm text-ink-muted">{t('replays.detail.field.description')}</span>
              {textField('description', true)}
            </div>
          )}
          {archived ? (
            tags.length > 0 && (
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
            )
          ) : (
            <div className="space-y-1" data-testid="replays-detail-tags">
              <span className="text-sm text-ink-muted">{t('replays.detail.field.tags')}</span>
              <TagInput
                tags={tags}
                suggestions={suggestTags(otherDemosTags, tagText, tags)}
                validate={validateTag}
                onAddTag={(tag) => tagChange(addTagChange(tag))}
                onRemoveTag={(tag) => tagChange(removeTagChange(tag))}
                onInputChange={setTagText}
              />
            </div>
          )}
        </div>

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
    </section>
  )
}
