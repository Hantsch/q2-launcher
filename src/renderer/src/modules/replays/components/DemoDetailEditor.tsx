import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DemoRow } from '@shared/modules/replays'
import {
  addTag,
  draftToFields,
  isDraftDirty,
  isoToDraftText,
  removeTag,
  suggestTags,
  type SidecarDraft,
} from '@shared/replays/sidecar-draft'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/controls'
import { useDemoEditorStore, type RowPatcher } from '../demo-editor-store'
import { ReplaceSidecarDialog } from './ReplaceSidecarDialog'
import { SidesEditor } from './SidesEditor'
import { TagInput } from './TagInput'

/** The fields whose empty input shows the lower-source effective value as its placeholder. */
type PlaceholderFieldId = 'name' | 'map' | 'mod' | 'gamemode' | 'date'

/** The editor's `<form>` id - the header's name input (outside the form, in the title slot) joins it
 * through its `form` attribute, so Enter there submits like in every other text input. */
export function editorFormId(demoId: string): string {
  return `replays-editor-form-${demoId}`
}

/**
 * Story 178: an empty input's placeholder. When the value the reading mode shows comes from a lower
 * source (the demo, the file name, the file time), that value itself is the cue - with no source
 * prefix; a value that is the sidecar's own (or none at all) falls back to the generic hint.
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

/** The header's title slot while a demo is in edit mode: the name input, bound to the same draft. */
export function DemoDetailNameInput({ row }: { row: DemoRow }) {
  const { t } = useTranslation()
  const entry = useDemoEditorStore((state) => state.drafts[row.id])
  if (entry === undefined) return null
  return (
    <Input
      form={editorFormId(row.id)}
      className="min-w-0 flex-1 text-lg font-semibold"
      aria-label={t('replays.editor.field.name')}
      value={entry.draft.name}
      maxLength={200}
      placeholder={editorPlaceholder(row, 'name', t)}
      disabled={entry.saving === true}
      onChange={(event) =>
        useDemoEditorStore.getState().updateDraft(row.id, { name: event.target.value })
      }
      data-testid="replays-editor-name"
    />
  )
}

export interface DemoDetailEditorProps {
  row: DemoRow
  onRowPatched: RowPatcher
  /** The read-only facts, already formatted the way the reading mode shows them (`undefined` when
   * that fact is unknown and the reading mode omits it too). */
  readOnlyText: { duration?: string; pov?: string }
  /** Players the demo/file name itself know about, for the sides editor's known-player chips. */
  knownPlayers?: { demo: string[]; name: string[] }
  /** Every other demo's sidecar tags, for the tag input's suggestions (`suggestTags` already
   * excludes the current draft's own tags). */
  otherDemosTags?: string[][]
}

const TEXTAREA_CLASS =
  'min-h-20 w-full rounded-sm border border-line-strong bg-void/60 px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-ink-faint focus:border-flame-600 focus:outline-none ' +
  'transition-colors duration-[--dur-fast] disabled:opacity-50'

const NO_KNOWN_PLAYERS = { demo: [], name: [] }
const NO_OTHER_TAGS: string[][] = []

/**
 * Story 178 (was story 155's always-mounted "your notes" form): the detail facts themselves as a
 * form, rendered by `DemoDetailPanel` in place of the facts list while `editingId` names this demo.
 * Its draft lives in `demo-editor-store.ts` (so it survives a module switch); this component only
 * binds it. Save is enabled only for a dirty draft whose rating/date convert cleanly; the post-save
 * row patch goes through `onRowPatched`. The discard dialog is the panel's, not this form's.
 */
export function DemoDetailEditor({
  row,
  onRowPatched,
  readOnlyText,
  knownPlayers = NO_KNOWN_PLAYERS,
  otherDemosTags = NO_OTHER_TAGS,
}: DemoDetailEditorProps) {
  const { t } = useTranslation()
  const idPrefix = useId()
  const [tagInputText, setTagInputText] = useState('')
  const demoId = row.id
  const entry = useDemoEditorStore((state) => state.drafts[demoId])
  const { updateDraft, cancelEdit, save, cancelReplace } = useDemoEditorStore.getState()

  if (entry === undefined) return null

  const { draft, baseline } = entry
  const saving = entry.saving === true
  const converted = draftToFields(draft)
  const errors = converted.ok ? {} : converted.errors
  const canSave = converted.ok && isDraftDirty(draft, baseline) && !saving

  const set = (patch: Partial<SidecarDraft>): void => updateDraft(demoId, patch)
  const submit = (): void => void save(demoId, onRowPatched)
  const tagSuggestions = suggestTags(otherDemosTags, tagInputText, draft.tags)
  const controlId = (field: string): string => `${idPrefix}-${field}`

  return (
    <div data-testid="replays-editor">
      <form
        id={editorFormId(demoId)}
        onSubmit={(event) => {
          event.preventDefault()
          if (canSave) submit()
        }}
      >
        <fieldset className="m-0 space-y-5 border-0 p-0" disabled={saving}>
          <div className="space-y-2" data-testid="replays-editor-facts-file">
            {readOnlyRow('fileName', row.fileName)}
            {readOnlyText.duration !== undefined && readOnlyRow('duration', readOnlyText.duration)}
            {textRow('date', 19)}
          </div>

          <div className="space-y-2" data-testid="replays-editor-facts-match">
            {textRow('map', 64)}
            {textRow('mod', 64)}
            {textRow('gamemode', 64)}
            <SidesEditor
              draft={draft}
              knownPlayers={knownPlayers}
              disabled={saving}
              onChange={(next) => updateDraft(demoId, next)}
            />
            {readOnlyText.pov !== undefined && readOnlyRow('pov', readOnlyText.pov)}
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor={controlId('description')} className="text-sm text-ink-muted">
                {t('replays.detail.field.description')}
              </label>
              <textarea
                id={controlId('description')}
                className={TEXTAREA_CLASS}
                value={draft.description}
                maxLength={4000}
                disabled={saving}
                onChange={(event) => set({ description: event.target.value })}
                data-testid="replays-editor-description"
              />
            </div>

            <div className="space-y-1">
              <span className="text-sm text-ink-muted">{t('replays.detail.field.tags')}</span>
              <TagInput
                tags={draft.tags}
                suggestions={tagSuggestions}
                disabled={saving}
                onAddTag={(tag) => updateDraft(demoId, (d) => addTag(d, tag))}
                onRemoveTag={(tag) => updateDraft(demoId, (d) => removeTag(d, tag))}
                onInputChange={setTagInputText}
              />
            </div>
          </div>

          {entry.saveError !== undefined && (
            <p role="alert" className="text-sm text-danger" data-testid="replays-editor-save-error">
              {t('replays.editor.saveFailed', {
                reason: t(entry.saveError.key, entry.saveError.params),
              })}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => cancelEdit(demoId)}
              data-testid="replays-editor-cancel"
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSave} data-testid="replays-editor-save">
              {saving ? t('replays.editor.saving') : t('common.save')}
            </Button>
          </div>
        </fieldset>
      </form>

      {entry.replace !== undefined && (
        <ReplaceSidecarDialog
          fileName={entry.replace.fileName}
          issues={entry.replace.issues}
          onConfirm={submit}
          onCancel={() => cancelReplace(demoId)}
        />
      )}
    </div>
  )

  /** One facts-list row: label left, content right - the reading mode's own shape. */
  function factRow(id: string, label: ReactNode, content: ReactNode, below?: ReactNode) {
    return (
      <div key={id} data-testid={`replays-editor-field-${id}`}>
        <div className="flex items-center justify-between gap-3 text-sm">
          {label}
          <div className="min-w-0 w-3/5 text-right">{content}</div>
        </div>
        {below}
      </div>
    )
  }

  function readOnlyRow(id: 'fileName' | 'duration' | 'pov', text: string) {
    return factRow(
      id,
      <span className="text-ink-muted">{t(`replays.detail.field.${id}`)}</span>,
      <span className="block truncate text-ink">{text}</span>,
    )
  }

  function textRow(id: Exclude<PlaceholderFieldId, 'name'>, maxLength: number) {
    const error = id === 'date' ? errors[id] : undefined
    const errorId = `replays-editor-error-${demoId}-${id}`
    const label = t(`replays.detail.field.${id}`)
    return factRow(
      id,
      <label htmlFor={controlId(id)} className="text-ink-muted">
        {label}
      </label>,
      <Input
        id={controlId(id)}
        value={draft[id]}
        maxLength={maxLength}
        placeholder={editorPlaceholder(row, id, t)}
        disabled={saving}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        onChange={(event) => set({ [id]: event.target.value } as Partial<SidecarDraft>)}
        data-testid={`replays-editor-${id}`}
      />,
      error !== undefined && (
        <p
          id={errorId}
          className="mt-1 text-right text-xs text-danger"
          data-testid={`replays-editor-error-${id}`}
        >
          {t(error)}
        </p>
      ),
    )
  }
}
