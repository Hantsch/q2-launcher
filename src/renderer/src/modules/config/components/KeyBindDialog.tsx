import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import { generateLayerAliases, sanitizeCommand, type AltLayer } from '@shared/config/alt-layers'
import { Button } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'
import { COMMAND_CATALOG } from '../lib/command-catalog'
import { updateProfileBinds, updateProfileLayers } from '../client'

/**
 * SHIFT/CTRL/ALT are a single `profile.binds` key shared by two physical
 * keycaps (see `keyboard-layout.ts`'s doc comment) - editing one of them
 * edits both, which this dialog calls out rather than leaves implicit.
 */
const DOUBLY_PLACED_KEYS = new Set(['SHIFT', 'CTRL', 'ALT'])

/**
 * Edits one key's bind (story 006 D4): the current command, a filterable
 * pick list drawn from `COMMAND_CATALOG`, and the raw-command field that
 * actually gets saved - picking a catalog entry only populates that field,
 * since not every real bind (`use blaster`, `weapon 3`, chained commands) has
 * a catalog entry. Mirrors `RenameProfileDialog`'s shape; saves through the
 * same `updateProfileBinds` replace-whole-map client D2 added, same as
 * `SettingsTab`'s `updateProfileCvars` flow but committed on a click
 * (Assign/Clear) rather than debounced.
 */
export function KeyBindDialog({
  profile,
  keyName,
  keyLabel,
  layer = null,
  onClose,
  onSaved,
}: {
  profile: ConfigProfile
  keyName: string
  keyLabel: string
  /** Set when editing a layer's own override instead of the base bind (story 006 D6). `null`/omitted = base layer, D4's original behavior. */
  layer?: AltLayer | null
  onClose: () => void
  /** The full, updated profile list, per this module's save-through-client contract. */
  onSaved: (profiles: ConfigProfile[]) => void
}) {
  const { t } = useTranslation()
  const baseCommand = profile.binds[keyName] ?? ''
  const baseBound = baseCommand.trim().length > 0
  const currentCommand = layer ? (layer.overrides[keyName] ?? '') : baseCommand
  const bound = currentCommand.trim().length > 0
  const isTriggerKey = Boolean(layer && layer.triggerKey.trim() === keyName)

  const [command, setCommand] = useState(currentCommand)
  const [filter, setFilter] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const plusbindIssue = useMemo(() => {
    if (!layer) return null
    const preview = generateLayerAliases(
      { ...layer, overrides: { ...layer.overrides, [keyName]: command } },
      profile.binds,
    )
    return (
      preview.issues.find(
        (issue) => issue.key === 'layer.plusbind' && issue.params?.key === keyName,
      ) ?? null
    )
  }, [layer, profile.binds, keyName, command])

  const filteredCatalog = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return COMMAND_CATALOG
    return COMMAND_CATALOG.filter(
      (entry) =>
        entry.label.toLowerCase().includes(query) || entry.command.toLowerCase().includes(query),
    )
  }, [filter])

  /**
   * Whether Assign is currently allowed to fire at all - shared by the
   * button's `disabled` and the raw-command field's Enter handler, so the
   * keyboard path can never bypass a check the pointer path enforces
   * (review finding, story 006: Enter used to call `save` unconditionally,
   * which let a layer's own trigger key be remapped through the text field
   * even though decision 12 makes that a *blocking* error, not a warning).
   */
  const canAssign = !submitting && !isTriggerKey && command.trim() !== currentCommand.trim()

  const save = async (next: string): Promise<void> => {
    // Never store a raw `"` in a bind: `render.ts` writes base binds as
    // `bind <key> "<value>"` unquoted-content-wise, so a user-typed quote
    // would nest and break on load - the exact class of bug this module's
    // alias generator exists to avoid, just on the base-bind path instead of
    // a layer body (review finding, story 006). Sanitizing here keeps both
    // paths honouring the same "no in-quote escaping" rule (AC5).
    const sanitized = sanitizeCommand(next)
    setSubmitting(true)
    const result = layer
      ? await updateProfileLayers({
          profileId: profile.id,
          layers: (profile.layers ?? []).map((entry) =>
            entry.id === layer.id
              ? { ...entry, overrides: { ...entry.overrides, [keyName]: sanitized } }
              : entry,
          ),
        })
      : await updateProfileBinds({
          profileId: profile.id,
          binds: { ...profile.binds, [keyName]: sanitized },
        })
    setSubmitting(false)
    if (result.ok) onSaved(result.value)
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.keyBindDialog.title', { key: keyLabel })}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={submitting || !bound} onClick={() => void save('')}>
            {t('config.keyBindDialog.clear')}
          </Button>
          <Button variant="primary" disabled={!canAssign} onClick={() => void save(command)}>
            {t('config.keyBindDialog.assign')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {layer && (
          <p className="text-xs text-ink-muted">
            {t('config.keyBindDialog.layerContext', { name: layer.name })}
          </p>
        )}

        <p className="text-xs text-ink-muted">
          {bound
            ? t('config.keyBindDialog.currentLabel', { command: currentCommand })
            : t('config.overview.testMode.noBind')}
        </p>

        {layer && (
          <p className="text-xs text-ink-muted">
            {t('config.keyBindDialog.baseBindLabel', {
              command: baseBound ? baseCommand : t('config.overview.testMode.noBind'),
            })}
          </p>
        )}

        {isTriggerKey && (
          <p className="rounded-sm border border-danger/35 bg-danger/8 px-2.5 py-1.5 text-xs text-danger">
            {t('layer.selfbind', { key: keyName })}
          </p>
        )}

        {!isTriggerKey && plusbindIssue && (
          <p className="rounded-sm border border-warning/35 bg-warning/8 px-2.5 py-1.5 text-xs text-warning">
            {t('layer.plusbind', plusbindIssue.params)}
          </p>
        )}

        {DOUBLY_PLACED_KEYS.has(keyName) && (
          <p className="rounded-sm border border-line bg-panel px-2.5 py-1.5 text-xs text-ink-muted">
            {t('config.keyBindDialog.doubleKeyNote')}
          </p>
        )}

        <Field label={t('config.keyBindDialog.pickListLabel')}>
          <Input
            value={filter}
            placeholder={t('config.keyBindDialog.filterPlaceholder')}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-sm border border-line">
            {filteredCatalog.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-ink-muted">{t('common.none')}</p>
            ) : (
              filteredCatalog.map((entry) => (
                <button
                  key={entry.command}
                  type="button"
                  onClick={() => setCommand(entry.command)}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs text-ink transition-colors duration-[--dur-fast] hover:bg-hover"
                >
                  <span>{entry.label}</span>
                  <code className="text-ink-muted">{entry.command}</code>
                </button>
              ))
            )}
          </div>
        </Field>

        <Field label={t('config.keyBindDialog.rawCommandLabel')}>
          <Input
            value={command}
            autoFocus
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canAssign) void save(command)
            }}
          />
        </Field>
      </div>
    </Modal>
  )
}
