import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListChecks, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import {
  BUILT_IN_ACTION_CATEGORIES,
  type ActionCategoryEntryKind,
  type ConfigAction,
  type ConfigActionCategory,
  type ConfigProfile,
} from '@shared/modules/config'
import { Button, IconButton } from '../../components/ui/Button'
import { Field, Input, Select } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { Badge, type BadgeTone, EmptyState, SectionLabel } from '../../components/ui/primitives'
import { ActionEditor } from './components/ActionEditor'
import { MessageEditor } from './components/MessageEditor'
import { updateProfileActions } from './client'

const SAVE_DEBOUNCE_MS = 500

type SaveStatus = 'idle' | 'saving' | 'saved'

const ENTRY_KIND_TONE: Record<ActionCategoryEntryKind, BadgeTone> = {
  bind: 'flame',
  message: 'strogg',
  alias: 'warning',
}

export interface AdvancedTabProps {
  profile: ConfigProfile
  /** Story 009 D6: the shared in-progress draft, owned by `ConfigView`'s `useProfileDraft`. */
  draft: ConfigProfile
  patch: (partial: Partial<ConfigProfile> | ((prev: ConfigProfile) => Partial<ConfigProfile>)) => void
  onChanged: (profiles: ConfigProfile[]) => void
}

/**
 * Story 008 D6: category management plus a bare action list. This is
 * deliberately not a full action editor - `ConfigAction.commands`/`.key`
 * are never touched here, they stay whatever they were (`[]` for a freshly
 * created action). A later deliverable (D7) wires a row click to a
 * command/key editor, and another (D8) adds a message editor; both extend
 * this file rather than replace it, which is why every action row is
 * rendered as a distinct, addressable list item even though nothing reacts
 * to clicking one yet.
 *
 * Category CRUD is a handful of discrete dialog submits, so it saves
 * immediately (`persistCategoriesAndActions`), same reasoning `LayersPanel`
 * uses for its own immediate `persist()`. The action list's add/remove goes
 * through a debounced save instead, mirroring `SettingsTab`'s
 * `scheduleSave`/`clearPendingSave` - not because actions are typed
 * continuously, but so a burst of quick adds/removes does not fire one
 * `updateProfileActions` per click.
 */
export function AdvancedTab({ profile, draft, patch, onChanged }: AdvancedTabProps) {
  const { t } = useTranslation()

  // Story 009 D6: `localCategories`/`localActions` used to live here as their
  // own `useState`; they are now `draft.categories`/`draft.actions`, lifted
  // into `ConfigView` so the Validation tab sees an edit immediately, with no
  // debounce and no IPC round trip in between (AC 4).
  const categories = draft.categories ?? []
  const actions = draft.actions ?? []
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    BUILT_IN_ACTION_CATEGORIES[0].id,
  )
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [saving, setSaving] = useState(false)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [renamingCategory, setRenamingCategory] = useState<ConfigActionCategory | null>(null)
  const [pendingDeleteCategoryId, setPendingDeleteCategoryId] = useState<string | null>(null)
  const [showCreateAction, setShowCreateAction] = useState(false)
  const [renamingAction, setRenamingAction] = useState<ConfigAction | null>(null)
  const [editingActionId, setEditingActionId] = useState<string | null>(null)

  const clearPendingSave = (): void => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current)
      saveTimeout.current = null
    }
  }

  // Re-seed the save/status UI whenever the selected profile changes,
  // dropping any save still pending for the profile being switched away from
  // - same pattern as `SettingsTab`. The draft's own content reseed is
  // `useProfileDraft`'s job now (story 009 D6), keyed on the same
  // `profile.id`.
  useEffect(() => {
    setSelectedCategoryId(BUILT_IN_ACTION_CATEGORIES[0].id)
    setStatus('idle')
    clearPendingSave()
  }, [profile.id])

  useEffect(() => clearPendingSave, [])

  const persistCategoriesAndActions = async (
    nextCategories: ConfigActionCategory[],
    nextActions: ConfigAction[],
  ): Promise<boolean> => {
    // Cancels any debounced action-list save still pending from
    // `scheduleActionsSave` below - that save's own `categories` argument is
    // a closure captured at *schedule* time, so letting it fire after this
    // call would overwrite whatever this call is about to persist with a
    // stale snapshot (review finding: a category create/rename/delete done
    // while an action add/remove's debounce is still pending was silently
    // reverted on disk once the debounce fired). This call's own
    // `nextCategories`/`nextActions` already carry everything the pending
    // debounce would have sent, since `scheduleActionsSave` patches the draft
    // synchronously - only the network round trip was ever delayed - so
    // cancelling it here loses no edit.
    clearPendingSave()
    setSaving(true)
    setStatus('saving')
    const result = await updateProfileActions({
      profileId: profile.id,
      categories: nextCategories,
      actions: nextActions,
    })
    setSaving(false)
    if (result.ok) {
      patch({ categories: nextCategories, actions: nextActions })
      onChanged(result.value)
      setStatus('saved')
    } else {
      setStatus('idle')
    }
    return result.ok
  }

  const scheduleActionsSave = (nextActions: ConfigAction[]): void => {
    patch({ actions: nextActions })
    setStatus('saving')
    clearPendingSave()
    saveTimeout.current = setTimeout(() => {
      saveTimeout.current = null
      void updateProfileActions({
        profileId: profile.id,
        categories,
        actions: nextActions,
      }).then((result) => {
        if (result.ok) {
          onChanged(result.value)
          setStatus('saved')
        } else {
          // Revert the optimistic patch applied above: the shared draft
          // (story 009 D6) survives a tab switch (unlike the removed
          // `useState`, which self-corrected on every remount), so a failed
          // save would otherwise leave a phantom action in the draft - and
          // therefore in the validator - indefinitely (review finding).
          patch({ actions: profile.actions ?? [] })
          setStatus('idle')
        }
      })
    }, SAVE_DEBOUNCE_MS)
  }

  const handleCreateCategory = async (input: {
    name: string
    entryKind: ActionCategoryEntryKind
  }): Promise<boolean> => {
    const category: ConfigActionCategory = {
      id: crypto.randomUUID(),
      name: input.name,
      entryKind: input.entryKind,
    }
    const ok = await persistCategoriesAndActions([...categories, category], actions)
    if (ok) {
      setShowCreateCategory(false)
      setSelectedCategoryId(category.id)
    }
    return ok
  }

  const handleRenameCategory = async (categoryId: string, name: string): Promise<boolean> => {
    const nextCategories = categories.map((category) =>
      category.id === categoryId ? { ...category, name } : category,
    )
    const ok = await persistCategoriesAndActions(nextCategories, actions)
    if (ok) setRenamingCategory(null)
    return ok
  }

  const handleDeleteCategory = async (categoryId: string): Promise<void> => {
    const nextCategories = categories.filter((category) => category.id !== categoryId)
    const nextActions = actions.filter((action) => action.categoryId !== categoryId)
    const ok = await persistCategoriesAndActions(nextCategories, nextActions)
    if (ok) {
      setPendingDeleteCategoryId(null)
      if (categoryId === selectedCategoryId) setSelectedCategoryId(BUILT_IN_ACTION_CATEGORIES[0].id)
    }
  }

  const handleRenameAction = async (actionId: string, name: string): Promise<boolean> => {
    const nextActions = actions.map((action) =>
      action.id === actionId ? { ...action, name } : action,
    )
    const ok = await persistCategoriesAndActions(categories, nextActions)
    if (ok) setRenamingAction(null)
    return ok
  }

  const handleCreateAction = (name: string): void => {
    const action: ConfigAction = {
      id: crypto.randomUUID(),
      categoryId: selectedCategoryId,
      name,
      commands: [],
    }
    scheduleActionsSave([...actions, action])
    setShowCreateAction(false)
  }

  const handleRemoveAction = (actionId: string): void => {
    scheduleActionsSave(actions.filter((action) => action.id !== actionId))
  }

  /**
   * `ActionEditor` (D7) hands back the fully updated action rather than
   * saving itself, so `AdvancedTab` stays the single owner of the draft's
   * actions and the save path - same reasoning `persistCategoriesAndActions`
   * already documents for category CRUD. A discrete "Save" closing a modal is
   * a commit like a rename, not a continuously-typed value, so this saves
   * immediately rather than through the debounced path add/remove use.
   */
  const handleSaveAction = async (next: ConfigAction): Promise<void> => {
    const nextActions = actions.map((action) => (action.id === next.id ? next : action))
    const ok = await persistCategoriesAndActions(categories, nextActions)
    if (ok) setEditingActionId(null)
  }

  const selectedBuiltIn =
    BUILT_IN_ACTION_CATEGORIES.find((category) => category.id === selectedCategoryId) ?? null
  const selectedCustom = categories.find((category) => category.id === selectedCategoryId)
  const selectedCategoryLabel = selectedBuiltIn
    ? t(selectedBuiltIn.labelKey)
    : (selectedCustom?.name ?? '')
  const selectedEntryKind: ActionCategoryEntryKind | undefined =
    selectedBuiltIn?.entryKind ?? selectedCustom?.entryKind
  const actionsForCategory = actions.filter(
    (action) => action.categoryId === selectedCategoryId,
  )
  const editingAction = editingActionId
    ? (actions.find((action) => action.id === editingActionId) ?? null)
    : null

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>{t('config.advanced.label')}</SectionLabel>
          <div className="flex items-center gap-3">
            {status !== 'idle' && (
              <span className="text-xs text-ink-muted">
                {status === 'saving' ? t('config.settings.saving') : t('config.settings.saved')}
              </span>
            )}
            <Button
              variant="neutral"
              size="sm"
              icon={<Plus className="size-3.5" />}
              onClick={() => setShowCreateCategory(true)}
            >
              {t('config.advanced.create')}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {BUILT_IN_ACTION_CATEGORIES.map((category) => (
            <div
              key={category.id}
              className="flex items-center gap-1.5 rounded-sm border border-line px-1.5 py-1"
            >
              <Button
                variant={selectedCategoryId === category.id ? 'primary' : 'neutral'}
                size="sm"
                onClick={() => setSelectedCategoryId(category.id)}
              >
                {t(category.labelKey)}
              </Button>
              <Badge>{t('config.advanced.builtIn')}</Badge>
            </div>
          ))}

          {categories.map((category) => {
            const isPendingDelete = pendingDeleteCategoryId === category.id
            return (
              <div
                key={category.id}
                className="flex items-center gap-1.5 rounded-sm border border-line px-1.5 py-1"
              >
                <Button
                  variant={selectedCategoryId === category.id ? 'primary' : 'neutral'}
                  size="sm"
                  onClick={() => setSelectedCategoryId(category.id)}
                >
                  {category.name}
                </Button>
                <Badge tone={ENTRY_KIND_TONE[category.entryKind]}>
                  {t(`config.advanced.entryKind.${category.entryKind}`)}
                </Badge>
                {isPendingDelete ? (
                  <>
                    <span className="text-xs text-danger">{t('config.advanced.deleteConfirm')}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      onClick={() => setPendingDeleteCategoryId(null)}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={saving}
                      onClick={() => void handleDeleteCategory(category.id)}
                    >
                      {t('config.advanced.deleteConfirmAction')}
                    </Button>
                  </>
                ) : (
                  <>
                    <IconButton
                      label={t('config.advanced.rename')}
                      size="sm"
                      onClick={() => setRenamingCategory(category)}
                    >
                      <Pencil className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label={t('config.advanced.delete')}
                      size="sm"
                      variant="danger"
                      onClick={() => setPendingDeleteCategoryId(category.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>
            {t('config.advanced.actions.label', { category: selectedCategoryLabel })}
          </SectionLabel>
          <Button
            variant="neutral"
            size="sm"
            icon={<Plus className="size-3.5" />}
            onClick={() => setShowCreateAction(true)}
          >
            {t('config.advanced.actions.add')}
          </Button>
        </div>

        {actionsForCategory.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="size-6" />}
            title={t('config.advanced.actions.empty.title')}
            body={t('config.advanced.actions.empty.body')}
          />
        ) : (
          <ul className="space-y-2">
            {actionsForCategory.map((action) => (
              <li
                key={action.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-line px-2.5 py-2"
              >
                <span className="min-w-0 truncate text-sm text-ink">{action.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    label={t('config.advanced.actions.edit')}
                    size="sm"
                    onClick={() => setEditingActionId(action.id)}
                  >
                    <SlidersHorizontal className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.advanced.actions.rename')}
                    size="sm"
                    onClick={() => setRenamingAction(action)}
                  >
                    <Pencil className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.advanced.actions.remove')}
                    size="sm"
                    variant="danger"
                    onClick={() => handleRemoveAction(action.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreateCategory && (
        <CreateCategoryDialog
          onClose={() => setShowCreateCategory(false)}
          onSubmit={handleCreateCategory}
        />
      )}

      {renamingCategory && (
        <RenameCategoryDialog
          category={renamingCategory}
          onClose={() => setRenamingCategory(null)}
          onSubmit={(name) => handleRenameCategory(renamingCategory.id, name)}
        />
      )}

      {showCreateAction && (
        <CreateActionDialog
          onClose={() => setShowCreateAction(false)}
          onSubmit={handleCreateAction}
        />
      )}

      {renamingAction && (
        <RenameActionDialog
          action={renamingAction}
          onClose={() => setRenamingAction(null)}
          onSubmit={(name) => handleRenameAction(renamingAction.id, name)}
        />
      )}

      {editingAction && selectedEntryKind === 'message' && (
        <MessageEditor
          action={editingAction}
          onClose={() => setEditingActionId(null)}
          onSave={(next) => void handleSaveAction(next)}
        />
      )}

      {editingAction && selectedEntryKind !== 'message' && (
        <ActionEditor
          action={editingAction}
          onClose={() => setEditingActionId(null)}
          onSave={(next) => void handleSaveAction(next)}
        />
      )}
    </div>
  )
}

/** Create-category form: name, entry kind. Mirrors `CreateLayerDialog`'s shape. */
function CreateCategoryDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (input: { name: string; entryKind: ActionCategoryEntryKind }) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [entryKind, setEntryKind] = useState<ActionCategoryEntryKind>('bind')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const ok = await onSubmit({ name: name.trim(), entryKind })
    setSubmitting(false)
    if (!ok) return
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.advanced.createDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.advanced.createDialog.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('config.advanced.createDialog.nameLabel')}>
          <Input
            value={name}
            autoFocus
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) void submit()
            }}
          />
        </Field>

        <Field label={t('config.advanced.createDialog.entryKindLabel')}>
          <Select
            value={entryKind}
            onChange={(event) => setEntryKind(event.target.value as ActionCategoryEntryKind)}
            options={[
              { value: 'bind', label: t('config.advanced.entryKind.bind') },
              { value: 'message', label: t('config.advanced.entryKind.message') },
              { value: 'alias', label: t('config.advanced.entryKind.alias') },
            ]}
          />
        </Field>
      </div>
    </Modal>
  )
}

/** Renames one custom category. Mirrors `RenameProfileDialog`'s shape. */
function RenameCategoryDialog({
  category,
  onClose,
  onSubmit,
}: {
  category: ConfigActionCategory
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(category.name)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    await onSubmit(name.trim())
    setSubmitting(false)
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.advanced.renameDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('config.advanced.renameDialog.label')}>
        <Input
          value={name}
          autoFocus
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim().length > 0) void submit()
          }}
        />
      </Field>
    </Modal>
  )
}

/** Create-action form: name only. Debounced-saved by the caller, so this dialog does not wait
 * on a network round trip - it hands the trimmed name back and closes immediately. */
function CreateActionDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (name: string) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')

  const canSubmit = name.trim().length > 0

  const submit = (): void => {
    if (!canSubmit) return
    onSubmit(name.trim())
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.advanced.actions.createDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {t('config.advanced.actions.createDialog.submit')}
          </Button>
        </>
      }
    >
      <Field label={t('config.advanced.actions.createDialog.nameLabel')}>
        <Input
          value={name}
          autoFocus
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSubmit) submit()
          }}
        />
      </Field>
    </Modal>
  )
}

/** Renames one action. Mirrors `RenameProfileDialog`'s shape. */
function RenameActionDialog({
  action,
  onClose,
  onSubmit,
}: {
  action: ConfigAction
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(action.name)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    await onSubmit(name.trim())
    setSubmitting(false)
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.advanced.actions.renameDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('config.advanced.actions.renameDialog.label')}>
        <Input
          value={name}
          autoFocus
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim().length > 0) void submit()
          }}
        />
      </Field>
    </Modal>
  )
}
