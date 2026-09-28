import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { compileNameTemplate } from '@shared/replays/name-template'
import type { NameTemplateEntry, NameTemplatesView } from '@shared/replays/name-templates'
import type { LocalizedMessage, Outcome } from '@shared/types'
import { SortableList, DragHandle, type SortableItemRenderState } from '../../components/dnd'
import { Button, IconButton } from '../../components/ui/Button'
import { Badge, SectionLabel } from '../../components/ui/primitives'
import {
  addNameTemplate,
  listNameTemplates,
  removeNameTemplate,
  reorderNameTemplates,
  resetNameTemplate,
  restoreNameTemplates,
  updateNameTemplate,
} from './client'

/**
 * Story 140 D3: the naming-pattern list a user actually edits - replaces the settings section's
 * placeholder paragraph. Every mutating handler resolves to the whole, reconciled
 * `NameTemplatesView`, so - same discipline as `servers/ServersSettingsSection.tsx`'s `mutate` - this
 * component always re-renders from what main just persisted, never an optimistic local patch, with
 * one exception: the pending add/edit text field itself, which is naturally local until submitted.
 *
 * Both the add field and an in-place row edit run story 139's pure `compileNameTemplate` on every
 * keystroke so an invalid pattern is refused before it ever reaches an IPC call; a refusal that does
 * come back from main (e.g. a duplicate concurrent removal) lands in the exact same error slot the
 * client-side validator would have used.
 */

type ValidationResult = { ok: true } | { ok: false; error: LocalizedMessage }

function validateText(text: string): ValidationResult {
  if (text.length === 0) return { ok: false, error: { key: 'replays.nameTemplate.error.empty' } }
  const compiled = compileNameTemplate(text)
  if (compiled.ok) return { ok: true }
  return { ok: false, error: { key: compiled.error.key, params: compiled.error.params } }
}

export function NameTemplatesList() {
  const { t } = useTranslation()

  const [view, setView] = useState<NameTemplatesView | null>(null)
  const [listError, setListError] = useState<LocalizedMessage | null>(null)
  const [saving, setSaving] = useState(false)

  const [addText, setAddText] = useState('')
  const [addError, setAddError] = useState<LocalizedMessage | null>(null)
  const [addTouched, setAddTouched] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editError, setEditError] = useState<LocalizedMessage | null>(null)

  useEffect(() => {
    let cancelled = false
    void listNameTemplates().then((result) => {
      if (cancelled) return
      if (result.ok) setView(result.value)
      else setListError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /** Every `nameTemplates.*` mutation goes through here: runs the action, and either applies main's
   * returned full view (success) or hands the refusal to whichever error slot the caller names -
   * the add field's, the edit field's, or the list's own, depending which action failed. */
  const mutate = async (
    action: () => Promise<Outcome<NameTemplatesView>>,
    onError: (error: LocalizedMessage) => void,
  ): Promise<boolean> => {
    setSaving(true)
    const result = await action()
    setSaving(false)
    if (!result.ok) {
      onError(result.error)
      return false
    }
    setView(result.value)
    return true
  }

  const handleAddTextChange = (value: string): void => {
    setAddText(value)
    setAddTouched(true)
    const validation = validateText(value)
    setAddError(validation.ok ? null : validation.error)
  }

  const canAdd = addTouched && addText.trim().length > 0 && addError === null && !saving

  const handleAdd = (): void => {
    const validation = validateText(addText)
    if (!validation.ok) {
      setAddError(validation.error)
      return
    }
    void mutate(
      () => addNameTemplate(addText),
      (error) => setAddError(error),
    ).then((succeeded) => {
      if (succeeded) {
        setAddText('')
        setAddTouched(false)
        setAddError(null)
      }
    })
  }

  const startEdit = (entry: NameTemplateEntry): void => {
    setEditingId(entry.id)
    setEditText(entry.template)
    setEditError(null)
  }

  const cancelEdit = (): void => {
    setEditingId(null)
    setEditError(null)
  }

  const handleEditTextChange = (value: string): void => {
    setEditText(value)
    const validation = validateText(value)
    setEditError(validation.ok ? null : validation.error)
  }

  const saveEdit = (): void => {
    if (editingId === null) return
    const validation = validateText(editText)
    if (!validation.ok) {
      setEditError(validation.error)
      return
    }
    const id = editingId
    void mutate(
      () => updateNameTemplate(id, editText),
      (error) => setEditError(error),
    ).then((succeeded) => {
      if (succeeded) {
        setEditingId(null)
        setEditError(null)
      }
    })
  }

  const handleRemove = (id: string): void => {
    void mutate(
      () => removeNameTemplate(id),
      (error) => setListError(error),
    )
  }

  const handleReset = (id: string): void => {
    void mutate(
      () => resetNameTemplate(id),
      (error) => setListError(error),
    )
  }

  const handleRestore = (): void => {
    void mutate(
      () => restoreNameTemplates(),
      (error) => setListError(error),
    )
  }

  const handleReorder = (nextEntries: NameTemplateEntry[]): void => {
    void mutate(
      () => reorderNameTemplates(nextEntries.map((entry) => entry.id)),
      (error) => setListError(error),
    )
  }

  const canEdit = editError === null && editText.trim().length > 0 && !saving

  return (
    <div className="space-y-3">
      <SectionLabel>{t('replays.nameTemplates.heading')}</SectionLabel>
      <p className="text-xs text-ink-muted">{t('replays.nameTemplates.hint')}</p>

      {listError && (
        <p className="text-xs text-danger" data-testid="replays-name-templates-list-error">
          {t(listError.key, listError.params)}
        </p>
      )}

      {view && (
        <div data-testid="replays-name-templates">
          <SortableList
            items={view.entries}
            getItemId={(entry) => entry.id}
            onReorder={handleReorder}
            disabled={saving}
            className="space-y-1.5"
            aria-label={t('replays.nameTemplates.heading')}
            renderItem={(entry, dragState) => {
              const index = view.entries.indexOf(entry)
              const isEditing = editingId === entry.id
              return (
                <NameTemplateRow
                  key={entry.id}
                  entry={entry}
                  index={index}
                  dragState={dragState}
                  saving={saving}
                  isEditing={isEditing}
                  editText={editText}
                  editError={editError}
                  canSaveEdit={canEdit}
                  onStartEdit={() => startEdit(entry)}
                  onCancelEdit={cancelEdit}
                  onEditTextChange={handleEditTextChange}
                  onSaveEdit={saveEdit}
                  onRemove={() => handleRemove(entry.id)}
                  onReset={() => handleReset(entry.id)}
                />
              )
            }}
          />
        </div>
      )}

      {view?.canRestore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRestore}
          disabled={saving}
          data-testid="replays-name-templates-restore"
        >
          {t('replays.nameTemplates.restore')}
        </Button>
      )}

      <div className="flex items-end gap-2 border-t border-line pt-3">
        <input
          value={addText}
          onChange={(event) => handleAddTextChange(event.target.value)}
          placeholder={t('replays.nameTemplates.placeholder')}
          aria-label={t('replays.nameTemplates.heading')}
          aria-describedby="replays-name-template-error"
          className="h-9 min-w-0 flex-1 rounded-sm border border-line-strong bg-void/60 px-2.5 font-mono text-sm text-ink"
          data-testid="replays-name-template-input"
        />
        <Button
          variant="neutral"
          onClick={handleAdd}
          disabled={!canAdd}
          data-testid="replays-name-template-add"
        >
          {t('replays.nameTemplates.add')}
        </Button>
      </div>
      {addError && (
        <p className="text-xs text-danger" id="replays-name-template-error" data-testid="replays-name-template-error">
          {t(addError.key, addError.params)}
        </p>
      )}
    </div>
  )
}

interface NameTemplateRowProps {
  entry: NameTemplateEntry
  index: number
  dragState: SortableItemRenderState
  saving: boolean
  isEditing: boolean
  editText: string
  editError: LocalizedMessage | null
  canSaveEdit: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onEditTextChange: (value: string) => void
  onSaveEdit: () => void
  onRemove: () => void
  onReset: () => void
}

/** One row of the naming-pattern list. Split out of `NameTemplatesList` to keep the list's own
 * mutation/validation plumbing legible - mirrors `servers/MasterSourceRow.tsx`'s split. */
function NameTemplateRow({
  entry,
  index,
  dragState,
  saving,
  isEditing,
  editText,
  editError,
  canSaveEdit,
  onStartEdit,
  onCancelEdit,
  onEditTextChange,
  onSaveEdit,
  onRemove,
  onReset,
}: NameTemplateRowProps) {
  const { t } = useTranslation()
  const { setNodeRef, style, attributes, listeners, isDragging } = dragState
  const editErrorId = `replays-name-template-edit-error-${entry.id}`

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`replays-name-template-${index}`}
      className="flex items-center gap-2 rounded-sm border border-line-strong bg-raised px-2 py-1.5"
      data-dragging={isDragging || undefined}
    >
      <DragHandle attributes={attributes} listeners={listeners} disabled={saving} />

      {isEditing ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            value={editText}
            onChange={(event) => onEditTextChange(event.target.value)}
            aria-describedby={editErrorId}
            className="h-7 min-w-0 flex-1 rounded-sm border border-line-strong bg-void/60 px-2 font-mono text-xs text-ink"
            data-testid={`replays-name-template-edit-input-${index}`}
          />
          {editError && (
            <p className="text-xs text-danger" id={editErrorId} data-testid={`replays-name-template-edit-error-${index}`}>
              {t(editError.key, editError.params)}
            </p>
          )}
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm text-ink">{entry.template}</p>
        </div>
      )}

      {!isEditing && (
        <Badge tone={entry.origin === 'shipped' ? 'neutral' : 'flame'}>
          {t(entry.origin === 'shipped' ? 'replays.nameTemplates.badge.builtIn' : 'replays.nameTemplates.badge.custom')}
        </Badge>
      )}
      {!isEditing && entry.edited && (
        <Badge tone="warning">{t('replays.nameTemplates.badge.edited')}</Badge>
      )}

      {isEditing ? (
        <>
          <Button size="sm" variant="neutral" onClick={onSaveEdit} disabled={!canSaveEdit}>
            {t('replays.nameTemplates.save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelEdit} disabled={saving}>
            {t('replays.nameTemplates.cancel')}
          </Button>
        </>
      ) : (
        <>
          <IconButton
            label={t('replays.nameTemplates.edit')}
            size="sm"
            variant="ghost"
            onClick={onStartEdit}
            disabled={saving}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </IconButton>
          {entry.edited && (
            <IconButton
              label={t('replays.nameTemplates.reset')}
              size="sm"
              variant="ghost"
              onClick={onReset}
              disabled={saving}
              data-testid={`replays-name-template-reset-${index}`}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
            </IconButton>
          )}
          <IconButton
            label={t('replays.nameTemplates.remove')}
            size="sm"
            variant="ghost"
            onClick={onRemove}
            disabled={saving}
            data-testid={`replays-name-template-remove-${index}`}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </IconButton>
        </>
      )}
    </div>
  )
}
