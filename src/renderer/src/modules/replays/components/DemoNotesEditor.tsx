import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DemoDetailField } from '@shared/replays/demo-detail'
import type { SidecarFields } from '@shared/replays/sidecar'
import {
  addTag,
  draftToFields,
  isDraftDirty,
  removeTag,
  suggestTags,
  type SidecarDraft,
} from '@shared/replays/sidecar-draft'
import { Button } from '../../../components/ui/Button'
import { Checkbox, Field, Input } from '../../../components/ui/controls'
import { useDemoEditorStore, type RowPatcher } from '../demo-editor-store'
import { DiscardDemoNotesDialog } from './DiscardDemoNotesDialog'
import { ReplaceSidecarDialog } from './ReplaceSidecarDialog'
import { SidesEditor } from './SidesEditor'
import { TagInput } from './TagInput'

export interface DemoNotesEditorProps {
  demoId: string
  /** The row's current sidecar values - the draft's starting point when none is open yet. */
  values: Partial<SidecarFields>
  onRowPatched: RowPatcher
  /** An i18n key naming why this demo cannot carry notes (e.g. an archive entry), or null. */
  disabledReason: string | null
  /** The detail panel's `map` field (`buildDemoDetail`'s), when a value is known from any source —
   * lets an empty map input show the lower-source effective value as a placeholder cue instead of a
   * generic hint, per story 155. `undefined` when nothing is known (e.g. an archive entry). */
  mapField?: DemoDetailField
  /** Players the demo/file name itself know about, for the sides editor's known-player chips. */
  knownPlayers?: { demo: string[]; name: string[] }
  /** Every other demo's sidecar tags, for the tag input's suggestions (`suggestTags` already
   * excludes the current draft's own tags). */
  otherDemosTags?: string[][]
}

type TextFieldId = 'name' | 'mod' | 'gamemode' | 'map' | 'date' | 'rating'

/** Each text field's `maxLength` mirrors `sidecarFieldsSchema`'s own limit. */
const TEXT_FIELDS: ReadonlyArray<{ id: TextFieldId; maxLength: number; placeholder?: boolean }> = [
  { id: 'name', maxLength: 200 },
  { id: 'mod', maxLength: 64 },
  { id: 'gamemode', maxLength: 64 },
  { id: 'map', maxLength: 64, placeholder: true },
  { id: 'date', maxLength: 19, placeholder: true },
  { id: 'rating', maxLength: 3 },
]

const TEXTAREA_CLASS =
  'min-h-20 w-full rounded-sm border border-line-strong bg-void/60 px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-ink-faint focus:border-flame-600 focus:outline-none ' +
  'transition-colors duration-[--dur-fast] disabled:opacity-50'

/**
 * Story 155: the "your notes" form for one demo. Its draft lives in `demo-editor-store.ts` (so it
 * survives a module switch); this component only binds it. Save is enabled only for a dirty draft
 * whose rating/date convert cleanly; the post-save row patch goes through `onRowPatched`.
 */
const NO_KNOWN_PLAYERS = { demo: [], name: [] }
const NO_OTHER_TAGS: string[][] = []

export function DemoNotesEditor({
  demoId,
  values,
  onRowPatched,
  disabledReason,
  mapField,
  knownPlayers = NO_KNOWN_PLAYERS,
  otherDemosTags = NO_OTHER_TAGS,
}: DemoNotesEditorProps) {
  const { t } = useTranslation()
  const descriptionId = useId()
  const [tagInputText, setTagInputText] = useState('')
  const entry = useDemoEditorStore((state) => state.drafts[demoId])
  const pendingLeave = useDemoEditorStore((state) => state.pendingLeave)
  const { openDraft, updateDraft, cancelDraft, save, cancelReplace, keepEditing, discardAndLeave } =
    useDemoEditorStore.getState()

  useEffect(() => {
    openDraft(demoId, values)
  }, [demoId, values, openDraft])

  if (entry === undefined) return null

  const { draft, baseline } = entry
  const disabled = disabledReason !== null || entry.saving === true
  const converted = draftToFields(draft)
  const errors = converted.ok ? {} : converted.errors
  const canSave = !disabled && converted.ok && isDraftDirty(draft, baseline)

  const set = (patch: Partial<SidecarDraft>): void => updateDraft(demoId, patch)
  const submit = (): void => void save(demoId, onRowPatched)
  const tagSuggestions = suggestTags(otherDemosTags, tagInputText, draft.tags)

  return (
    <div className="space-y-3" data-testid="replays-editor">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {t('replays.editor.section')}
      </h3>

      {disabledReason !== null && (
        <p className="text-sm text-ink-dim" data-testid="replays-editor-disabled-reason">
          {t(disabledReason)}
        </p>
      )}

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSave) submit()
        }}
      >
        {TEXT_FIELDS.slice(0, 1).map((field) => renderText(field))}

        <Field label={t('replays.editor.field.description')} htmlFor={descriptionId}>
          <textarea
            id={descriptionId}
            className={TEXTAREA_CLASS}
            value={draft.description}
            maxLength={4000}
            disabled={disabled}
            onChange={(event) => set({ description: event.target.value })}
            data-testid="replays-editor-description"
          />
        </Field>

        {TEXT_FIELDS.slice(1).map((field) => renderText(field))}

        <SidesEditor
          draft={draft}
          knownPlayers={knownPlayers}
          disabled={disabled}
          onChange={(next) => updateDraft(demoId, next)}
        />

        <Field label={t('replays.editor.field.tags')}>
          <TagInput
            tags={draft.tags}
            suggestions={tagSuggestions}
            disabled={disabled}
            onAddTag={(tag) => updateDraft(demoId, (d) => addTag(d, tag))}
            onRemoveTag={(tag) => updateDraft(demoId, (d) => removeTag(d, tag))}
            onInputChange={setTagInputText}
          />
        </Field>

        <Checkbox
          checked={draft.favourite}
          disabled={disabled}
          onChange={(favourite) => set({ favourite })}
          label={t('replays.editor.field.favourite')}
          data-testid="replays-editor-favourite"
        />

        {entry.saveError !== undefined && (
          <p role="alert" className="text-sm text-danger" data-testid="replays-editor-save-error">
            {t('replays.editor.saveFailed', { reason: t(entry.saveError.key, entry.saveError.params) })}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => cancelDraft(demoId)}
            data-testid="replays-editor-cancel"
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!canSave} data-testid="replays-editor-save">
            {entry.saving === true ? t('replays.editor.saving') : t('common.save')}
          </Button>
        </div>
      </form>

      {entry.replace !== undefined && (
        <ReplaceSidecarDialog
          fileName={entry.replace.fileName}
          issues={entry.replace.issues}
          onConfirm={submit}
          onCancel={() => cancelReplace(demoId)}
        />
      )}

      {pendingLeave !== null && (
        <DiscardDemoNotesDialog onKeepEditing={keepEditing} onDiscard={discardAndLeave} />
      )}
    </div>
  )

  function mapPlaceholder(): string {
    if (
      mapField !== undefined &&
      mapField.source !== null &&
      mapField.source !== 'sidecar' &&
      typeof mapField.value === 'string' &&
      mapField.value !== ''
    ) {
      return t('replays.editor.placeholder.mapFromSource', {
        value: mapField.value,
        source: t(`replays.source.${mapField.source}`),
      })
    }
    return t('replays.editor.placeholder.map')
  }

  function renderText(field: (typeof TEXT_FIELDS)[number]) {
    const error = field.id === 'rating' || field.id === 'date' ? errors[field.id] : undefined
    const errorId = `replays-editor-error-${demoId}-${field.id}`
    const placeholder = field.id === 'map' ? mapPlaceholder() : t(`replays.editor.placeholder.${field.id}`)
    return (
      <Field key={field.id} label={t(`replays.editor.field.${field.id}`)}>
        <Input
          value={draft[field.id]}
          maxLength={field.maxLength}
          inputMode={field.id === 'rating' ? 'numeric' : undefined}
          placeholder={field.placeholder ? placeholder : undefined}
          disabled={disabled}
          aria-invalid={error !== undefined}
          aria-describedby={error !== undefined ? errorId : undefined}
          onChange={(event) => set({ [field.id]: event.target.value } as Partial<SidecarDraft>)}
          data-testid={`replays-editor-${field.id}`}
        />
        {error !== undefined && (
          <p id={errorId} className="text-xs text-danger" data-testid={`replays-editor-error-${field.id}`}>
            {t(error)}
          </p>
        )}
      </Field>
    )
  }
}
