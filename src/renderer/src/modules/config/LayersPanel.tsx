import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  generateLayerAliases,
  type AltLayer,
  type AltLayerMode,
  type LayerIssue,
} from '@shared/config/alt-layers'
import type { ConfigProfile } from '@shared/modules/config'
import { cn } from '../../lib/cn'
import { Button, IconButton } from '../../components/ui/Button'
import { Field, Input, Select } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { Badge, SectionLabel } from '../../components/ui/primitives'
import { updateProfileLayers } from './client'

/**
 * Issue keys shown in D5's per-layer banner. `layer.plusbind` is now included:
 * D6 gives the key dialog a specific key to attach it to, and this panel
 * repeats it here as a per-layer aggregate banner. `layer.quote` is included
 * for completeness, but per D1 it is never actually pushed by the generator.
 * `layer.noTrigger` (story 011) fires when a layer has overrides but no
 * trigger key assigned yet.
 */
const VISIBLE_ISSUE_KEYS: ReadonlySet<LayerIssue['key']> = new Set([
  'layer.empty',
  'layer.selfbind',
  'layer.plusbind',
  'layer.triggerConflict',
  'layer.quote',
  'layer.noTrigger',
])

/**
 * Layer CRUD (create/rename/delete) plus a per-layer collapsible preview of
 * the exact aliases `generateLayerAliases` (D1) would emit, and the
 * layer-level issues it detects. Self-contained: it does not yet drive the
 * keyboard board's edit state (D6's job) - it only manages the `layers`
 * array and shows what each layer would generate.
 *
 * Every mutation is a full replace-whole-array save through
 * `updateProfileLayers`, per the contract's replace-whole-map semantics.
 */
export function LayersPanel({
  profile,
  activeLayerId,
  onSelectLayer,
  onChanged,
}: {
  profile: ConfigProfile
  activeLayerId: string | null
  onSelectLayer: (layerId: string | null) => void
  onChanged: (profiles: ConfigProfile[]) => void
}) {
  const { t } = useTranslation()
  const layers = profile.layers ?? []

  const [showCreate, setShowCreate] = useState(false)
  const [renamingLayer, setRenamingLayer] = useState<AltLayer | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const persist = async (next: AltLayer[]): Promise<boolean> => {
    setSaving(true)
    const result = await updateProfileLayers({ profileId: profile.id, layers: next })
    setSaving(false)
    if (result.ok) onChanged(result.value)
    return result.ok
  }

  const handleCreate = async (input: {
    name: string
    mode: AltLayerMode
  }): Promise<boolean> => {
    const layer: AltLayer = {
      id: crypto.randomUUID(),
      name: input.name,
      mode: input.mode,
      triggerKey: null,
      overrides: {},
    }
    const ok = await persist([...layers, layer])
    if (ok) setShowCreate(false)
    return ok
  }

  const handleRename = async (layerId: string, name: string): Promise<boolean> => {
    const next = layers.map((layer) => (layer.id === layerId ? { ...layer, name } : layer))
    const ok = await persist(next)
    if (ok) setRenamingLayer(null)
    return ok
  }

  /**
   * Story 016 D5 (AC 7): the mode select next to the layer's row, mirroring
   * `handleRename`'s persist shape - a full replace-whole-array
   * `updateProfileLayers` call with everything but `mode` unchanged. No dialog
   * to close on success (unlike rename/create): the select's own `value` is
   * `layer.mode` from the freshest `profile` prop, so a failed save simply
   * leaves the select showing the last-confirmed mode once `onChanged` is not
   * called - the same "server response is the only source of truth" pattern
   * `AdvancedTab.persistLayers` documents for the dual-bind editor's own
   * modifier-layer writes.
   */
  const handleModeChange = async (layerId: string, mode: AltLayerMode): Promise<void> => {
    const next = layers.map((layer) => (layer.id === layerId ? { ...layer, mode } : layer))
    await persist(next)
  }

  const handleDelete = async (layerId: string): Promise<void> => {
    const next = layers.filter((layer) => layer.id !== layerId)
    const ok = await persist(next)
    if (ok) {
      setPendingDeleteId(null)
      if (layerId === activeLayerId) onSelectLayer(null)
    }
  }

  const toggleExpanded = (layerId: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>{t('config.layersPanel.label')}</SectionLabel>
        <Button
          variant="neutral"
          size="sm"
          icon={<Plus className="size-3.5" />}
          onClick={() => setShowCreate(true)}
        >
          {t('config.layersPanel.create')}
        </Button>
      </div>

      {layers.length > 0 && <p className="text-xs text-ink-muted">{t('config.layersPanel.hint')}</p>}

      {layers.length === 0 ? (
        <p className="text-xs text-ink-muted">{t('config.layersPanel.empty.compact')}</p>
      ) : (
        <ul className="space-y-2">
          {layers.map((layer) => {
            const expanded = expandedIds.has(layer.id)
            const isPendingDelete = pendingDeleteId === layer.id
            const preview = expanded
              ? generateLayerAliases(layer, profile.binds ?? {})
              : null
            const visibleIssues = preview?.issues.filter((issue) =>
              VISIBLE_ISSUE_KEYS.has(issue.key),
            )

            return (
              <li key={layer.id} className="space-y-2 rounded-sm border border-line px-2.5 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-sm text-ink">{layer.name}</span>
                    <div className="w-28 shrink-0">
                      <Select
                        aria-label={t('config.layersPanel.modeLabel')}
                        value={layer.mode}
                        disabled={saving}
                        onChange={(event) =>
                          void handleModeChange(layer.id, event.target.value as AltLayerMode)
                        }
                        options={[
                          { value: 'hold', label: t('config.layersPanel.mode.hold') },
                          { value: 'toggle', label: t('config.layersPanel.mode.toggle') },
                        ]}
                      />
                    </div>
                    {layer.triggerKey ? (
                      <span className="numeric shrink-0 text-xs text-ink-muted">
                        {t('config.layersPanel.trigger', { key: layer.triggerKey })}
                      </span>
                    ) : (
                      <Badge tone="warning" className="shrink-0">
                        {t('config.layersPanel.noTrigger')}
                      </Badge>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => toggleExpanded(layer.id)}>
                      {t(
                        expanded
                          ? 'config.layersPanel.preview.hide'
                          : 'config.layersPanel.preview.show',
                      )}
                    </Button>
                    {isPendingDelete ? (
                      <>
                        <span className="text-xs text-danger">
                          {t('config.layersPanel.deleteConfirm')}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={saving}
                          onClick={() => setPendingDeleteId(null)}
                        >
                          {t('common.cancel')}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={saving}
                          onClick={() => void handleDelete(layer.id)}
                        >
                          {t('config.layersPanel.deleteConfirmAction')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <IconButton
                          label={t('config.layersPanel.rename')}
                          size="sm"
                          onClick={() => setRenamingLayer(layer)}
                        >
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label={t('config.layersPanel.delete')}
                          size="sm"
                          variant="danger"
                          onClick={() => setPendingDeleteId(layer.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>

                {expanded && preview && (
                  <div className="space-y-2">
                    {visibleIssues && visibleIssues.length > 0 && (
                      <ul className="space-y-1">
                        {visibleIssues.map((issue, index) => (
                          <li
                            key={index}
                            className={cn(
                              'rounded-sm border px-2 py-1 text-xs',
                              issue.level === 'error'
                                ? 'border-danger/35 bg-danger/8 text-danger'
                                : 'border-warning/35 bg-warning/8 text-warning',
                            )}
                          >
                            {t(issue.key, issue.params)}
                          </li>
                        ))}
                      </ul>
                    )}

                    <p className="numeric text-xs text-ink-muted">
                      {preview.triggerBind
                        ? t('config.layersPanel.preview.trigger', {
                            line: `bind ${preview.triggerBind.key} ${preview.triggerBind.command}`,
                          })
                        : t('config.layersPanel.preview.notReachable')}
                    </p>

                    {preview.aliases.length === 0 ? (
                      <p className="text-xs text-ink-muted">
                        {t('config.layersPanel.preview.empty')}
                      </p>
                    ) : (
                      <pre className="numeric max-h-64 overflow-auto rounded-sm border border-line bg-void p-3 text-[11px] whitespace-pre text-ink-muted">
                        {preview.aliases.map((alias) => alias.line).join('\n')}
                      </pre>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {showCreate && (
        <CreateLayerDialog onClose={() => setShowCreate(false)} onSubmit={handleCreate} />
      )}

      {renamingLayer && (
        <RenameLayerDialog
          layer={renamingLayer}
          onClose={() => setRenamingLayer(null)}
          onSubmit={(name) => handleRename(renamingLayer.id, name)}
        />
      )}
    </div>
  )
}

/**
 * Create-layer form: name, hold/toggle mode. The trigger key is no longer
 * picked here (story 011 decision 10) - it is assigned from the keyboard
 * overview's key-bind dialog once the layer exists.
 */
function CreateLayerDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (input: { name: string; mode: AltLayerMode }) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<AltLayerMode>('hold')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const ok = await onSubmit({ name: name.trim(), mode })
    setSubmitting(false)
    if (!ok) return
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.layersPanel.createDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.layersPanel.createDialog.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('config.layersPanel.createDialog.nameLabel')}>
          <Input
            value={name}
            autoFocus
            maxLength={120}
            placeholder={t('config.layersPanel.createDialog.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) void submit()
            }}
          />
        </Field>

        <Field label={t('config.layersPanel.createDialog.modeLabel')}>
          <Select
            value={mode}
            onChange={(event) => setMode(event.target.value as AltLayerMode)}
            options={[
              { value: 'hold', label: t('config.layersPanel.mode.hold') },
              { value: 'toggle', label: t('config.layersPanel.mode.toggle') },
            ]}
          />
        </Field>
      </div>
    </Modal>
  )
}

/** Renames one layer. Mirrors `RenameProfileDialog`'s shape. */
function RenameLayerDialog({
  layer,
  onClose,
  onSubmit,
}: {
  layer: AltLayer
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(layer.name)
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
      title={t('config.layersPanel.renameDialog.title')}
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
      <Field label={t('config.layersPanel.renameDialog.label')}>
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
