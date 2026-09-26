import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MasterSource, MasterSourceType } from '@shared/modules/servers'
import { DragHandle, type SortableItemRenderState } from '../../components/dnd'
import { Button, IconButton } from '../../components/ui/Button'
import { Select, Switch } from '../../components/ui/controls'
import { Pencil, Trash2 } from 'lucide-react'

const TYPE_OPTIONS: { value: MasterSourceType; labelKey: string }[] = [
  { value: 'udp-master', labelKey: 'module.servers.settings.type.udp-master' },
  { value: 'http-list', labelKey: 'module.servers.settings.type.http-list' },
]

export interface MasterSourceRowProps {
  source: MasterSource
  dragState: SortableItemRenderState
  saving: boolean
  onToggle: (id: string, enabled: boolean) => void
  onRemove: (id: string) => void
  onSaveAddress: (id: string, type: MasterSourceType, address: string) => void
}

/**
 * Story 111 D4: one row of the master-source list - split out of `ServersSettingsSection.tsx` once
 * the section (list + add form + inline edit) pushed past the ~150-line guideline in
 * `docs/ARCHITECTURE.md#adding-a-module`.
 *
 * Edit-in-place reuses the same type-select + address-input shape as the section's add form
 * (story's instruction), but keeps its own local `editing` state - the section only ever learns
 * about a save once it is submitted, so an abandoned edit never touches the list it renders from.
 */
export function MasterSourceRow({
  source,
  dragState,
  saving,
  onToggle,
  onRemove,
  onSaveAddress,
}: MasterSourceRowProps) {
  const { t } = useTranslation()
  const typeOptions = TYPE_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))
  const [editing, setEditing] = useState(false)
  const [editType, setEditType] = useState<MasterSourceType>(source.type)
  const [editAddress, setEditAddress] = useState(source.address)

  const { setNodeRef, style, attributes, listeners, isDragging } = dragState

  const startEdit = (): void => {
    setEditType(source.type)
    setEditAddress(source.address)
    setEditing(true)
  }

  const cancelEdit = (): void => setEditing(false)

  const saveEdit = (): void => {
    onSaveAddress(source.id, editType, editAddress)
    setEditing(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`servers-source-row-${source.id}`}
      className="flex items-center gap-2 rounded-sm border border-line-strong bg-raised px-2 py-1.5"
      data-dragging={isDragging || undefined}
    >
      <DragHandle attributes={attributes} listeners={listeners} />

      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Select
            value={editType}
            onChange={(event) => setEditType(event.target.value as MasterSourceType)}
            options={typeOptions}
            className="h-7 w-28 text-xs"
          />
          <input
            value={editAddress}
            onChange={(event) => setEditAddress(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-sm border border-line-strong bg-void/60 px-2 text-xs text-ink"
          />
          <Button size="sm" variant="neutral" onClick={saveEdit} disabled={saving}>
            {t('module.servers.settings.edit.save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
            {t('module.servers.settings.edit.cancel')}
          </Button>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink">{source.address}</p>
          <p className="text-xs text-ink-muted">
            {t(`module.servers.settings.type.${source.type}`)}
          </p>
        </div>
      )}

      {!editing && (
        <>
          <div data-testid="servers-source-toggle">
            <Switch
              checked={source.enabled}
              onChange={(next) => onToggle(source.id, next)}
              label={t('module.servers.settings.toggle.label')}
            />
          </div>
          <IconButton
            label={t('module.servers.settings.edit.start')}
            size="sm"
            variant="ghost"
            onClick={startEdit}
            disabled={saving}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </IconButton>
          <IconButton
            label={t('module.servers.settings.remove.label')}
            size="sm"
            variant="ghost"
            onClick={() => onRemove(source.id)}
            disabled={saving}
            data-testid="servers-source-remove"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </IconButton>
        </>
      )}
    </div>
  )
}
