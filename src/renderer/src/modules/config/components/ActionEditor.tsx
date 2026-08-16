import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import type { ConfigAction, ConfigCommand } from '@shared/modules/config'
import { sanitizeCommand } from '@shared/config/alt-layers'
import {
  commandLineFor,
  renderActionAlias,
  type RenderedActionAliases,
} from '@shared/config/alias-render'
import {
  DROP_ACTIONS,
  MOVEMENT_ACTIONS,
  WEAPON_ACTIONS,
  WEAPON_EXTRA_ACTIONS,
} from '@shared/config/action-catalog'
import { Button, IconButton } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'
import { Badge } from '../../../components/ui/primitives'
import { resolveQuakeKeyName } from '../lib/keyboard-layout'

/**
 * Story 008 D7: the multi-command composer and key-assignment editor for one
 * `ConfigAction` - the bind/alias-kind counterpart to D8's `MessageEditor`
 * (message-kind categories get that editor instead; `AdvancedTab` decides
 * which one to open based on the selected category's `entryKind`, never this
 * file).
 *
 * Mirrors `KeyBindDialog`'s shape (a `Modal`, a local draft, an explicit
 * commit rather than continuous auto-save) and `SwitchBindControl`'s
 * press-to-capture key assignment. Unlike `KeyBindDialog`, this editor does
 * not call the config client itself - it hands the updated `ConfigAction`
 * back to `onSave` and lets `AdvancedTab` own persistence, since
 * `AdvancedTab` already owns `localActions`/`localCategories` and the one
 * save path every other mutation in that file goes through; a second,
 * independent save call from inside this modal could race that state or
 * silently drop a category edit made just before opening this dialog.
 */
export function ActionEditor({
  action,
  onClose,
  onSave,
}: {
  action: ConfigAction
  onClose: () => void
  onSave: (next: ConfigAction) => void
}) {
  const { t } = useTranslation()
  const [commands, setCommands] = useState<ConfigCommand[]>(action.commands)
  const [key, setKey] = useState<string | undefined>(action.key)
  const [capturingKey, setCapturingKey] = useState(false)
  const [filter, setFilter] = useState('')
  const [rawCommandText, setRawCommandText] = useState('')

  useEffect(() => {
    if (!capturingKey) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      const quakeKey = resolveQuakeKeyName(event)
      if (!quakeKey) return
      event.preventDefault()
      // Without this, capturing Escape (a real, mappable Quake key) both sets
      // it as the draft key *and* keeps bubbling to `Modal`'s own document-
      // level Escape handler, which closes this whole editor before the
      // capture ever reaches the Save button - a conflict `SwitchBindControl`
      // never hits because it isn't hosted inside a `Modal`.
      event.stopPropagation()
      if (event.repeat) return
      setKey(quakeKey)
      setCapturingKey(false)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [capturingKey])

  const preview: RenderedActionAliases = useMemo(
    () => renderActionAlias({ ...action, commands }),
    [action, commands],
  )
  const totalBytes = useMemo(
    () => preview.aliases.reduce((sum, alias) => sum + alias.line.length, 0),
    [preview],
  )
  const willSplit = preview.aliases.length > 1

  const catalogEntries = useMemo(
    () => [
      ...MOVEMENT_ACTIONS.map((entry) => ({
        id: `movement:${entry.id}`,
        labelKey: entry.labelKey,
        commands: [entry.command],
      })),
      ...WEAPON_ACTIONS.map((entry) => ({
        id: `weapon:${entry.id}`,
        labelKey: entry.labelKey,
        commands: [entry.command],
      })),
      ...WEAPON_EXTRA_ACTIONS.map((entry) => ({
        id: `weaponExtra:${entry.id}`,
        labelKey: entry.labelKey,
        commands: [entry.command],
      })),
      ...DROP_ACTIONS.map((entry) => ({
        id: `drop:${entry.id}`,
        labelKey: entry.labelKey,
        commands: entry.commands,
      })),
    ],
    [],
  )

  const filteredCatalog = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return catalogEntries
    return catalogEntries.filter((entry) => t(entry.labelKey).toLowerCase().includes(query))
  }, [catalogEntries, filter, t])

  const appendCommands = (texts: string[]): void => {
    setCommands((prev) => [...prev, ...texts.map((text): ConfigCommand => ({ kind: 'raw', text }))])
  }

  const addRawCommand = (): void => {
    // Sanitized on commit (quotes dropped, whitespace collapsed) - the same
    // point `KeyBindDialog` sanitizes a hand-typed command, and the same
    // decision-12 reasoning: a `"` cannot be represented in Quake 2 at all,
    // so it is filtered here rather than let through to look fine in this
    // editor's own preview (which already renders the sanitized form via
    // `commandLineFor`) and then be rejected by the save schema with no
    // visible reason.
    const sanitized = sanitizeCommand(rawCommandText)
    if (!sanitized) return
    appendCommands([sanitized])
    setRawCommandText('')
  }

  const removeCommandAt = (index: number): void => {
    setCommands((prev) => prev.filter((_, i) => i !== index))
  }

  const moveCommand = (index: number, direction: -1 | 1): void => {
    setCommands((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved!)
      return next
    })
  }

  const save = (): void => {
    onSave({ ...action, commands, key: key && key.trim().length > 0 ? key : undefined })
  }

  return (
    <Modal
      open
      size="lg"
      title={t('config.advanced.editor.title', { name: action.name })}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="stencil">{t('config.advanced.editor.commandsLabel')}</span>
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <span className="numeric">
                {t('config.advanced.editor.byteLength', { bytes: totalBytes })}
              </span>
              {willSplit && (
                <Badge tone="warning">
                  {t('config.advanced.editor.willSplit', { count: preview.aliases.length })}
                </Badge>
              )}
            </div>
          </div>

          {commands.length === 0 ? (
            <p className="text-xs text-ink-muted">{t('config.advanced.editor.commandsEmpty')}</p>
          ) : (
            <ul className="space-y-1">
              {commands.map((command, index) => (
                <li
                  key={index}
                  className="flex items-center justify-between gap-2 rounded-sm border border-line px-2.5 py-1.5"
                >
                  <code className="min-w-0 flex-1 truncate text-xs text-ink-dim">
                    {commandLineFor(command)}
                  </code>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      label={t('config.advanced.editor.moveUp')}
                      size="sm"
                      disabled={index === 0}
                      onClick={() => moveCommand(index, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label={t('config.advanced.editor.moveDown')}
                      size="sm"
                      disabled={index === commands.length - 1}
                      onClick={() => moveCommand(index, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label={t('config.advanced.editor.removeCommand')}
                      size="sm"
                      variant="danger"
                      onClick={() => removeCommandAt(index)}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Field label={t('config.advanced.editor.rawCommandLabel')}>
          <div className="flex gap-2">
            <Input
              value={rawCommandText}
              placeholder={t('config.advanced.editor.rawCommandPlaceholder')}
              onChange={(event) => setRawCommandText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addRawCommand()
              }}
            />
            <Button
              variant="neutral"
              onClick={addRawCommand}
              // Disabled on the *sanitized* emptiness, not the raw text's -
              // a quote-only input like `"` sanitizes to `''` and would
              // otherwise leave this enabled for a click that silently does
              // nothing (review follow-up finding).
              disabled={!sanitizeCommand(rawCommandText)}
            >
              {t('config.advanced.editor.addCommand')}
            </Button>
          </div>
        </Field>

        <Field label={t('config.advanced.editor.pickListLabel')}>
          <Input
            value={filter}
            placeholder={t('config.advanced.editor.filterPlaceholder')}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-sm border border-line">
            {filteredCatalog.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-ink-muted">{t('common.none')}</p>
            ) : (
              filteredCatalog.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => appendCommands(entry.commands)}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs text-ink transition-colors duration-[--dur-fast] hover:bg-hover"
                >
                  <span>{t(entry.labelKey)}</span>
                  <code className="text-ink-muted">{entry.commands.join('; ')}</code>
                </button>
              ))
            )}
          </div>
        </Field>

        <div className="space-y-1.5">
          <span className="stencil block">{t('config.advanced.editor.keyLabel')}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {capturingKey ? (
              <Badge tone="warning">{t('config.advanced.editor.capturing')}</Badge>
            ) : key ? (
              <Badge tone="flame">{key}</Badge>
            ) : (
              <span className="text-xs text-ink-muted">{t('config.advanced.editor.keyNotSet')}</span>
            )}
            {!capturingKey && (
              <Button variant="ghost" size="sm" onClick={() => setCapturingKey(true)}>
                {t('config.advanced.editor.captureKey')}
              </Button>
            )}
            {!capturingKey && key && (
              <Button variant="danger" size="sm" onClick={() => setKey(undefined)}>
                {t('config.advanced.editor.clearKey')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
