import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { keySlotAt, withKeySlot } from '@shared/config/action-slots'
import type { ActionEntryPart, ConfigAction, ConfigCommand } from '@shared/modules/config'
import { sanitizeCommand } from '@shared/config/alt-layers'
import {
  commandLineFor,
  renderActionAlias,
  type RenderedActionAliases,
} from '@shared/config/alias-render'
import { MAX_WAIT_FRAMES } from '@shared/config/engine-limits'
import {
  DROP_ACTIONS,
  MOVEMENT_ACTIONS,
  WEAPON_ACTIONS,
  WEAPON_EXTRA_ACTIONS,
} from '@shared/config/action-catalog'
import { Button, IconButton } from '../../../components/ui/Button'
import { Field, Input, Select } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'
import { Badge } from '../../../components/ui/primitives'
import { getAliasSuggestions } from '../lib/alias-suggestions'
import { editorKeySlot } from '../lib/catalog-binds'
import { resolveQuakeKeyName } from '../lib/keyboard-layout'

/** One catalogue entry the "pick from catalogue" list offers - shared shape across every command
 * list section, since the catalogue itself does not vary by which section is picking from it. */
interface CatalogEntry {
  id: string
  labelKey: string
  commands: string[]
}

/**
 * One command list's worth of UI: the row list (with move/remove), the raw-command adder, the
 * wait-frame adder, and the pick-from-catalogue list.
 *
 * Story 045, D9: factored out of `ActionEditor`'s body so the same UI can be rendered once for a
 * `bind`/`alias` entry's single command list, or twice for a `toggle`/`press-release` entry's two
 * parts, without three separate editor bodies ("one editor, not three" - the story's own Decisions).
 * Each instance owns its own raw-command text and catalogue filter - two independent drafts, not one
 * shared between both halves of a two-part entry.
 */
function CommandListSection({
  title,
  labelField,
  commands,
  setCommands,
  aliasSuggestions,
  catalogEntries,
  datalistId,
}: {
  title: string
  /** Only present for a toggle's state sections (story 045: labels are toggle-only, a press/release
   * half never shows this field even though `ActionEntryPart.label` could technically hold one). */
  labelField?: { value: string; onChange: (value: string) => void; label: string; placeholder: string }
  commands: ConfigCommand[]
  setCommands: Dispatch<SetStateAction<ConfigCommand[]>>
  aliasSuggestions: string[]
  catalogEntries: CatalogEntry[]
  datalistId: string
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [rawCommandText, setRawCommandText] = useState('')
  const [waitFrames, setWaitFrames] = useState(5)

  const filteredCatalog = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return catalogEntries
    return catalogEntries.filter((entry) => t(entry.labelKey).toLowerCase().includes(query))
  }, [catalogEntries, filter, t])

  const appendCommands = (texts: string[]): void => {
    setCommands((prev) => [...prev, ...texts.map((text): ConfigCommand => ({ kind: 'raw', text }))])
  }

  const addRawCommand = (): void => {
    // Sanitized on commit (quotes dropped, whitespace collapsed) - see `ActionEditor`'s own file
    // doc comment for why this happens at commit time rather than on every keystroke.
    const sanitized = sanitizeCommand(rawCommandText)
    if (!sanitized) return
    appendCommands([sanitized])
    setRawCommandText('')
  }

  const addWait = (): void => {
    const frames = Math.min(MAX_WAIT_FRAMES, Math.max(1, Math.round(waitFrames) || 1))
    setCommands((prev) => [...prev, { kind: 'wait', frames }])
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

  return (
    <div className="space-y-3">
      {labelField && (
        <Field label={labelField.label}>
          <Input
            value={labelField.value}
            placeholder={labelField.placeholder}
            onChange={(event) => labelField.onChange(event.target.value)}
          />
        </Field>
      )}

      <div className="space-y-2">
        <span className="stencil block">{title}</span>

        {commands.length === 0 ? (
          <p className="text-xs text-ink-muted">{t('config.controls.editor.commandsEmpty')}</p>
        ) : (
          <ul className="space-y-1">
            {commands.map((command, index) => (
              <li
                key={index}
                className="flex items-center justify-between gap-2 rounded-sm border border-line px-2.5 py-1.5"
              >
                <code className="min-w-0 flex-1 truncate text-xs text-ink-dim">
                  {command.kind === 'wait'
                    ? t('config.controls.editor.wait.rowLabel', { frames: command.frames })
                    : commandLineFor(command)}
                </code>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    label={t('config.controls.editor.moveUp')}
                    size="sm"
                    disabled={index === 0}
                    onClick={() => moveCommand(index, -1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.controls.editor.moveDown')}
                    size="sm"
                    disabled={index === commands.length - 1}
                    onClick={() => moveCommand(index, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.controls.editor.removeCommand')}
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

      <Field label={t('config.controls.editor.rawCommandLabel')}>
        <div className="flex gap-2">
          <Input
            value={rawCommandText}
            placeholder={t('config.controls.editor.rawCommandPlaceholder')}
            aria-label={t('config.controls.editor.rawCommandLabel')}
            list={datalistId}
            onChange={(event) => setRawCommandText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addRawCommand()
            }}
          />
          {/* Story 019 D6: native datalist, no new dependency - typing `+` in the field above
              offers the profile's own aliases, and picking one just writes that exact string
              (native `<input list>` behavior, no extra wiring needed). */}
          <datalist id={datalistId}>
            {aliasSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Button
            variant="neutral"
            onClick={addRawCommand}
            // Disabled on the *sanitized* emptiness, not the raw text's - a quote-only input like
            // `"` sanitizes to `''` and would otherwise leave this enabled for a click that
            // silently does nothing (review follow-up finding).
            disabled={!sanitizeCommand(rawCommandText)}
          >
            {t('config.controls.editor.addCommand')}
          </Button>
        </div>
      </Field>

      {/* Story 045 D9: a `wait` row helper - appends `{ kind: 'wait', frames }` without the user
          typing the literal word `wait` themselves. */}
      <Field label={t('config.controls.editor.wait.frameCountLabel')}>
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            max={MAX_WAIT_FRAMES}
            value={waitFrames}
            aria-label={t('config.controls.editor.wait.frameCountLabel')}
            onChange={(event) => setWaitFrames(Number(event.target.value))}
            className="max-w-24"
          />
          <Button variant="neutral" onClick={addWait}>
            {t('config.controls.editor.wait.addButton')}
          </Button>
        </div>
      </Field>

      <Field label={t('config.controls.editor.pickListLabel')}>
        <Input
          value={filter}
          placeholder={t('config.controls.editor.filterPlaceholder')}
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
    </div>
  )
}

/**
 * Story 008 D7 / 019 D5: the multi-command composer and key-assignment
 * editor for one `ConfigAction` of `kind: 'bind'` or `kind: 'alias'` -
 * `kind: 'message'` gets `MessageEditor` instead (`ControlsTab` dispatches on
 * `action.kind`, never this file).
 *
 * Story 019 D5 split the two remaining kinds further:
 * - `bind`: the payload is either a command list (this editor's original
 *   shape) or a single message, switchable in place via `payloadType` - the
 *   engine sees both as "what the generated alias's body is", so toggling
 *   never touches `key`.
 * - `alias`: always a command list, and - the load-bearing part of D5 - the
 *   key section below is not rendered at all for this kind. An alias is
 *   never bound (story 019 decision, mirrored engine-side in D2's
 *   `binds`/`overrides` exclusion); rendering a disabled or hidden key
 *   control here would still be a path back to a control whose effect is
 *   silently discarded, which is exactly what the story rules out.
 *
 * Story 045 D9 adds the other two kinds:
 * - `toggle`/`press-release`: two independent command lists (`ConfigAction.parts`, always exactly
 *   two), rendered via two `CommandListSection`s instead of the single-list branch above. Both
 *   kinds ARE bindable (`@shared/config/action-mirror.ts#bindValueFor` handles both), so the key
 *   section still shows for them - only `alias` has none.
 *
 * Mirrors `KeyBindDialog`'s shape (a `Modal`, a local draft, an explicit
 * commit rather than continuous auto-save) and `SwitchBindControl`'s
 * press-to-capture key assignment. Unlike `KeyBindDialog`, this editor does
 * not call the config client itself - it hands the updated `ConfigAction`
 * back to `onSave` and lets `ControlsTab` own persistence, since
 * `ControlsTab` already owns `localActions`/`localCategories` and the one
 * save path every other mutation in that file goes through; a second,
 * independent save call from inside this modal could race that state or
 * silently drop a category edit made just before opening this dialog.
 */
export function ActionEditor({
  action,
  actions,
  onClose,
  onSave,
}: {
  action: ConfigAction
  /**
   * Story 019 D6: the profile's full action list, so the raw-command input's
   * suggestions can be computed from the profile's own alias entries. Passed
   * down rather than looked up here - `ControlsTab` already owns the one
   * `actions` array this editor is opened from, and a second, independent
   * read (store or IPC) would risk drifting from the very list `onSave` is
   * about to be merged back into.
   */
  actions: ConfigAction[]
  onClose: () => void
  onSave: (next: ConfigAction) => void
}) {
  const { t } = useTranslation()
  const isAlias = action.kind === 'alias'
  const isTwoPart = action.kind === 'toggle' || action.kind === 'press-release'

  // Story 019 D5 (comment corrected, Finding 6): whether a `bind` action's
  // payload is currently "message" or "command" is decided by whether ANY of
  // its `commands` is `kind: 'message'` - `.find` matches the first one it
  // meets, not "there is exactly one". In practice a message-payload row's
  // `commands` only ever holds that single entry (this editor never writes
  // more than one alongside it), so the distinction is moot today, but the
  // check itself does not enforce that. An `alias` action is always the
  // command shape (aliases have no message payload concept), so this stays
  // 'command' for it regardless of what `commands` happens to hold.
  const initialMessage = action.commands.find(
    (command): command is Extract<ConfigCommand, { kind: 'message' }> => command.kind === 'message',
  )
  const [payloadType, setPayloadType] = useState<'command' | 'message'>(
    !isAlias && !isTwoPart && initialMessage ? 'message' : 'command',
  )
  const [commands, setCommands] = useState<ConfigCommand[]>(
    payloadType === 'command' ? action.commands : [],
  )
  const [messageChannel, setMessageChannel] = useState<'say' | 'say_team'>(
    initialMessage?.channel ?? 'say_team',
  )
  const [messageText, setMessageText] = useState(initialMessage?.text ?? '')

  // Story 045 D9: a two-part entry's halves live in `action.parts`, not `action.commands` (which
  // stays `[]` for these two kinds) - see `ConfigAction.parts`'s doc comment.
  const [part1Commands, setPart1Commands] = useState<ConfigCommand[]>(action.parts?.[0]?.commands ?? [])
  const [part2Commands, setPart2Commands] = useState<ConfigCommand[]>(action.parts?.[1]?.commands ?? [])
  // Only actually shown/editable for `kind: 'toggle'` - a press/release half's `label` is left
  // unset by this editor even though the type technically allows one (story's UI scope).
  const [part1Label, setPart1Label] = useState(action.parts?.[0]?.label ?? '')
  const [part2Label, setPart2Label] = useState(action.parts?.[1]?.label ?? '')

  // Story 050: this editor only ever edits slot 0 of `action.keys` (there is no secondary-slot
  // capture here, unlike the Controls grid's `BindSlot`s) - `@shared/config/action-slots`'s
  // accessor is the sole place `keys` is read/written.
  const [key, setKey] = useState<string | undefined>(keySlotAt(action, 0)?.key || undefined)
  const [capturingKey, setCapturingKey] = useState(false)

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

  // Story 019 D5: whichever payload is actually selected is what gets
  // previewed and saved - not `commands`, which only ever holds the
  // command-payload draft (kept around, untouched, while the message
  // payload is active, so toggling back to "command" does not lose it).
  const effectiveCommands: ConfigCommand[] =
    payloadType === 'message'
      ? [{ kind: 'message', channel: messageChannel, text: messageText }]
      : commands

  // Story 045 D9: a two-part entry's preview has to go through `renderActionAlias`'s two-part
  // branch (`action.commands` is always `[]` for these kinds, so the single-list draft below would
  // render nothing) - built from both parts' current draft commands/labels, `parts[i].aliasName`
  // carried through untouched (this editor has no UI to change a part's own alias name).
  const twoPartDraftParts = useMemo(
    (): [ActionEntryPart, ActionEntryPart] => [
      {
        commands: part1Commands,
        label: part1Label.trim() || undefined,
        aliasName: action.parts?.[0]?.aliasName,
      },
      {
        commands: part2Commands,
        label: part2Label.trim() || undefined,
        aliasName: action.parts?.[1]?.aliasName,
      },
    ],
    [part1Commands, part1Label, part2Commands, part2Label, action.parts],
  )

  const preview: RenderedActionAliases = useMemo(
    () =>
      isTwoPart
        ? renderActionAlias({ ...action, commands: [], parts: twoPartDraftParts })
        : renderActionAlias({ ...action, commands: effectiveCommands }),
    [action, effectiveCommands, isTwoPart, twoPartDraftParts],
  )
  const totalBytes = useMemo(
    () => preview.aliases.reduce((sum, alias) => sum + alias.line.length, 0),
    [preview],
  )
  // A two-part entry always renders as more than one alias by construction (its two halves, plus a
  // dispatch alias for a toggle) - that is not the same event a single-body entry's overflow split
  // is, so the "splits into N parts" warning is scoped to the single-body case it was written for.
  const willSplit = !isTwoPart && preview.aliases.length > 1

  const catalogEntries: CatalogEntry[] = useMemo(
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

  // Story 019 D6: the profile's own alias entries, offered as a native
  // datalist while typing a raw command - excludes non-alias entries (an
  // alias is the only thing a binding can call by name) and is derived from
  // `actions`, not `commands`/`action`, since a binding suggests *other*
  // entries, never itself.
  const aliasSuggestions = useMemo(() => getAliasSuggestions(actions), [actions])

  const save = (): void => {
    if (isTwoPart) {
      const withParts: ConfigAction = { ...action, commands: [], parts: twoPartDraftParts }
      // Toggle/press-release ARE bindable (same slot-0-only behaviour as everything else this
      // editor writes) - see the file doc comment.
      onSave(withKeySlot(withParts, 0, editorKeySlot(action, key)))
      return
    }

    const withCommands: ConfigAction = { ...action, commands: effectiveCommands }

    if (isAlias) {
      // An alias entry has no key slot at all (D5) - every slot is dropped here (review fix,
      // Finding 5: the `...action` spread above would otherwise still carry through key slots the
      // row happened to hold before it became an alias) rather than trusting whatever the row/local
      // state happen to hold, so this editor can never be the path that leaves stale key data on an
      // alias even if some arrived pre-set.
      const { keys: _keys, ...rest } = withCommands
      onSave(rest)
      return
    }

    // Only slot 0 is ever written by this editor (there is no secondary-slot capture here) - its
    // existing modifier, if any, is preserved untouched, matching this editor's pre-050 behaviour
    // of never itself setting/clearing a modifier. Any further slot (1+) the action already carries
    // is passed straight through by `withKeySlot`, untouched.
    //
    // Story-050 review, finding 2: that preservation lives in `editorKeySlot` now rather than
    // inline here, because `MessageEditor`'s save path needs the identical rule and had been
    // written without it - one helper, one behaviour, one place it is tested.
    onSave(withKeySlot(withCommands, 0, editorKeySlot(action, key)))
  }

  return (
    <Modal
      open
      size="lg"
      title={t('config.controls.editor.title', { name: action.name })}
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
        {/* Story 019 D5: only a `bind` entry's payload can be a message - an alias, toggle or
            press/release entry is always a command list (or two), so none of them see this toggle. */}
        {!isAlias && !isTwoPart && (
          <Field label={t('config.controls.editor.payloadType.label')}>
            <Select
              value={payloadType}
              onChange={(event) => setPayloadType(event.target.value as 'command' | 'message')}
              options={[
                { value: 'command', label: t('config.controls.editor.payloadType.command') },
                { value: 'message', label: t('config.controls.editor.payloadType.message') },
              ]}
            />
          </Field>
        )}

        {isTwoPart ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="stencil">{t('config.controls.editor.commandsLabel')}</span>
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <span className="numeric">
                  {t('config.controls.editor.byteLength', { bytes: totalBytes })}
                </span>
                {willSplit && (
                  <Badge tone="warning">
                    {t('config.controls.editor.willSplit', { count: preview.aliases.length })}
                  </Badge>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <CommandListSection
                title={
                  action.kind === 'toggle'
                    ? t('config.controls.editor.toggle.state1Label')
                    : t('config.controls.editor.pressRelease.pressLabel')
                }
                labelField={
                  action.kind === 'toggle'
                    ? {
                        value: part1Label,
                        onChange: setPart1Label,
                        label: t('config.controls.editor.toggle.labelFieldLabel'),
                        placeholder: t('config.controls.editor.toggle.state1LabelPlaceholder'),
                      }
                    : undefined
                }
                commands={part1Commands}
                setCommands={setPart1Commands}
                aliasSuggestions={aliasSuggestions}
                catalogEntries={catalogEntries}
                datalistId="action-editor-alias-suggestions-1"
              />
              <CommandListSection
                title={
                  action.kind === 'toggle'
                    ? t('config.controls.editor.toggle.state2Label')
                    : t('config.controls.editor.pressRelease.releaseLabel')
                }
                labelField={
                  action.kind === 'toggle'
                    ? {
                        value: part2Label,
                        onChange: setPart2Label,
                        label: t('config.controls.editor.toggle.labelFieldLabel'),
                        placeholder: t('config.controls.editor.toggle.state2LabelPlaceholder'),
                      }
                    : undefined
                }
                commands={part2Commands}
                setCommands={setPart2Commands}
                aliasSuggestions={aliasSuggestions}
                catalogEntries={catalogEntries}
                datalistId="action-editor-alias-suggestions-2"
              />
            </div>
          </div>
        ) : payloadType === 'message' ? (
          <div className="space-y-5">
            <Field label={t('config.controls.messageEditor.channelLabel')} className="max-w-48">
              <Select
                value={messageChannel}
                onChange={(event) => setMessageChannel(event.target.value as 'say' | 'say_team')}
                options={[
                  { value: 'say', label: t('config.controls.messageEditor.channel.say') },
                  { value: 'say_team', label: t('config.controls.messageEditor.channel.sayTeam') },
                ]}
              />
            </Field>
            <Field label={t('config.controls.messageEditor.textLabel')}>
              <Input
                value={messageText}
                placeholder={t('config.controls.editor.payloadMessage.textPlaceholder')}
                onChange={(event) => setMessageText(event.target.value.replace(/"/g, ''))}
              />
            </Field>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="sr-only">{t('config.controls.editor.commandsLabel')}</span>
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <span className="numeric">
                  {t('config.controls.editor.byteLength', { bytes: totalBytes })}
                </span>
                {willSplit && (
                  <Badge tone="warning">
                    {t('config.controls.editor.willSplit', { count: preview.aliases.length })}
                  </Badge>
                )}
              </div>
            </div>
            <CommandListSection
              title={t('config.controls.editor.commandsLabel')}
              commands={commands}
              setCommands={setCommands}
              aliasSuggestions={aliasSuggestions}
              catalogEntries={catalogEntries}
              datalistId="action-editor-alias-suggestions"
            />
          </>
        )}

        {/* Story 019 D5 / 045 D9: the load-bearing bit - only an alias entry has no key slot at
            all. This branch is skipped entirely for `isAlias`, not hidden/disabled, so there is no
            control here whose effect binding a key to an alias would silently discard. `toggle` and
            `press-release` ARE bindable (`action-mirror.ts#bindValueFor`), so they keep this
            section - `!isAlias` alone already gets that right. */}
        {!isAlias && (
          <div className="space-y-1.5">
            <span className="stencil block">{t('config.controls.editor.keyLabel')}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {capturingKey ? (
                <Badge tone="warning">{t('config.controls.editor.capturing')}</Badge>
              ) : key ? (
                <Badge tone="flame">{key}</Badge>
              ) : (
                <span className="text-xs text-ink-muted">{t('config.controls.editor.keyNotSet')}</span>
              )}
              {!capturingKey && (
                <Button variant="ghost" size="sm" onClick={() => setCapturingKey(true)}>
                  {t('config.controls.editor.captureKey')}
                </Button>
              )}
              {!capturingKey && key && (
                <Button variant="danger" size="sm" onClick={() => setKey(undefined)}>
                  {t('config.controls.editor.clearKey')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
