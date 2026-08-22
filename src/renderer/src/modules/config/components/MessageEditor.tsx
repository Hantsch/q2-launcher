import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigAction, ConfigCommand } from '@shared/modules/config'
import {
  CHAT_MACROS,
  MESSAGE_SUGGESTIONS,
  findSingleDollarLocMistakes,
  tokenizeMessage,
} from '@shared/config/chat-macros'
import { fromAltCharset, hasAltCharset, toAltCharset, toDisplaySegments } from '@shared/config/q2-charset'
import { colorCvarTokens } from '@shared/config/color-cvars'
import { Button } from '../../../components/ui/Button'
import { Field, Select } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'
import { Badge } from '../../../components/ui/primitives'
import { resolveQuakeKeyName } from '../lib/keyboard-layout'
import { SymbolPicker } from './SymbolPicker'

const FIELD_BASE =
  'h-9 w-full rounded-sm border border-line-strong bg-void/60 px-2.5 text-sm text-ink numeric ' +
  'placeholder:text-ink-faint focus:border-flame-600 focus:outline-none ' +
  'transition-colors duration-[--dur-fast] disabled:opacity-50'

/**
 * Story 041 D8: a single-dollar `$name` reference, the same syntax the `$loc_here`-vs-
 * `$$loc_here` warning above already deals with. `(?<!\$)` skips the second `$` of a `$$token`
 * that `tokenizeMessage` did not recognise (e.g. an unknown `$$foo`) - that pair stays fully
 * literal rather than half-splitting into a bogus `$foo` reference.
 */
const SINGLE_DOLLAR_REF = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g

/**
 * Splits a plain-text run (already carved out of macro/meta tokens by `tokenizeMessage`) into
 * literal text and `$name` references that resolve to a known colour cvar. A `$name` that does
 * NOT resolve - `$loc_here` (not `$$loc_here`), an unknown mod macro, anything else - is left
 * inside the surrounding literal text untouched, so it renders exactly as it did before this
 * deliverable existed.
 */
function splitColorCvarRefs(
  text: string,
  colorCvars: Map<string, string>,
): ({ kind: 'plain'; text: string } | { kind: 'colorCvar'; name: string; value: string })[] {
  const parts: ReturnType<typeof splitColorCvarRefs> = []
  let last = 0
  for (const match of text.matchAll(SINGLE_DOLLAR_REF)) {
    const name = match[1]!
    const value = colorCvars.get(name)
    if (value === undefined) continue
    if (match.index > last) parts.push({ kind: 'plain', text: text.slice(last, match.index) })
    parts.push({ kind: 'colorCvar', name, value })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ kind: 'plain', text: text.slice(last) })
  return parts
}

/**
 * Story 008 D8: the message-kind counterpart to D7's `ActionEditor` -
 * `ControlsTab` opens this one instead when the entry's own `kind` is
 * `'message'` (story 019). A message action's `commands` holds exactly one
 * `{ kind: 'message', channel, text }` entry (decision 7: a message is one
 * alias body, same as a multi-command bind, but this editor only ever
 * produces the single message command a "Team messages"-style category
 * needs - `ActionEditor`'s ordered multi-raw-command list is the other
 * entry kinds' job).
 *
 * Mirrors `ActionEditor`'s save-ownership choice: hands the updated action
 * back to `onSave` rather than calling the config client itself, so
 * `ControlsTab` stays the single owner of `localActions` and its save path.
 *
 * Uses a plain native `<input>` (not the shared `Input` component, which is
 * a bare function component and cannot take a ref) so the macro bar and
 * symbol picker can read/restore the caret position across a button click
 * that would otherwise blur the field.
 */
export function MessageEditor({
  action,
  cvars,
  onClose,
  onSave,
  showKeyCapture = true,
  titleName,
}: {
  action: ConfigAction
  onClose: () => void
  onSave: (draft: { channel: string; text: string; key?: string }) => void
  /** Story 029 D2: drop rows own their key through the grid's `BindSlot`s and don't want a
   * second, collision-blind key editor in this modal - hides the key-capture block entirely when
   * `false`. Defaults to `true` to preserve the "Team messages" editor's existing behaviour. */
  showKeyCapture?: boolean
  /** Story 029 D2: lets a caller show a name other than the action's own in the modal title
   * (e.g. a drop row's own label). Defaults to `action.name`. */
  titleName?: string
  /**
   * Story 041 D8: the profile's own cvars, so the preview can recognise a `$name` reference in
   * the message as a colour cvar (`@shared/config/color-cvars`) and render its actual glyph
   * instead of dead literal text. Defaults to `{}` - a caller that has no cvars on hand (there is
   * none today) just gets the pre-D8 literal-text behaviour back.
   */
  cvars?: Record<string, string>
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  const seed = action.commands.find(
    (command): command is Extract<ConfigCommand, { kind: 'message' }> => command.kind === 'message',
  )
  const [channel, setChannel] = useState<'say' | 'say_team'>(seed?.channel ?? 'say_team')
  const [text, setText] = useState(seed?.text ?? '')
  const [key, setKey] = useState<string | undefined>(action.key)
  const [capturingKey, setCapturingKey] = useState(false)
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 })

  const captureSelection = (): void => {
    const el = inputRef.current
    if (!el) return
    setSelection({ start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 })
  }

  const hasSelection = selection.end > selection.start

  const insertAtCaret = (insertText: string): void => {
    const el = inputRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = text.slice(0, start) + insertText + text.slice(end)
    setText(next)
    const caret = start + insertText.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
      setSelection({ start: caret, end: caret })
    })
  }

  const applyAltCharsetToSelection = (): void => {
    const el = inputRef.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (start === end) return
    const selected = text.slice(start, end)
    const transformed = hasAltCharset(selected) ? fromAltCharset(selected) : toAltCharset(selected)
    const next = text.slice(0, start) + transformed + text.slice(end)
    setText(next)
    const newEnd = start + transformed.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start, newEnd)
      setSelection({ start, end: newEnd })
    })
  }

  // Press-to-capture key assignment - identical pattern to `ActionEditor`/
  // `SwitchBindControl`.
  useEffect(() => {
    if (!capturingKey) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      const quakeKey = resolveQuakeKeyName(event)
      if (!quakeKey) return
      event.preventDefault()
      // Without this, capturing Escape both sets it as the draft key *and*
      // keeps bubbling to `Modal`'s own document-level Escape handler, which
      // closes this editor before the capture ever reaches Save - see the
      // identical fix/comment in `ActionEditor.tsx`.
      event.stopPropagation()
      if (event.repeat) return
      setKey(quakeKey)
      setCapturingKey(false)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [capturingKey])

  // Story 041 D8: colour cvars are a rendering-layer concern layered on top of `tokenizeMessage`'s
  // existing output, not a change to tokenization itself - its contract (macro/meta segments,
  // everything else as literal text) is untouched.
  const colorCvars = useMemo(() => colorCvarTokens(cvars ?? {}), [cvars])

  const previewSegments = useMemo(() => {
    const segments: (
      | { kind: 'plain'; text: string; className: string }
      | { kind: 'colorCvar'; name: string; glyphText: string; glyphAlt: boolean }
    )[] = []
    for (const token of tokenizeMessage(text)) {
      if (token.kind === 'text') {
        for (const part of splitColorCvarRefs(token.value, colorCvars)) {
          if (part.kind === 'colorCvar') {
            // The whole value is high-bit bytes by construction (`isColorCvar`), so this is
            // always exactly one alt-charset run - reusing `toDisplaySegments` rather than
            // re-deriving the glyph text keeps the mapping in one place.
            const [glyphRun] = toDisplaySegments(part.value)
            segments.push({
              kind: 'colorCvar',
              name: part.name,
              glyphText: glyphRun?.text ?? '',
              glyphAlt: glyphRun?.alt ?? true,
            })
            continue
          }
          for (const run of toDisplaySegments(part.text)) {
            segments.push({
              kind: 'plain',
              text: run.text,
              className: run.alt ? 'text-strogg-400' : 'text-ink',
            })
          }
        }
        continue
      }
      segments.push({
        kind: 'plain',
        text: token.value,
        className:
          token.kind === 'meta' ? 'font-semibold text-flame-300' : 'font-semibold text-warning',
      })
    }
    return segments
  }, [text, colorCvars])

  const singleDollarIssues = useMemo(() => findSingleDollarLocMistakes(text), [text])

  const clientMacros = CHAT_MACROS.filter((macro) => macro.scope === 'client')
  const modMacros = CHAT_MACROS.filter((macro) => macro.scope === 'mod')

  const save = (): void => {
    onSave({
      channel,
      text,
      key: showKeyCapture && key && key.trim().length > 0 ? key : undefined,
    })
  }

  return (
    <Modal
      open
      size="lg"
      title={t('config.controls.messageEditor.title', { name: titleName ?? action.name })}
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
        <Field label={t('config.controls.messageEditor.channelLabel')} className="max-w-48">
          <Select
            value={channel}
            onChange={(event) => setChannel(event.target.value as 'say' | 'say_team')}
            options={[
              { value: 'say', label: t('config.controls.messageEditor.channel.say') },
              { value: 'say_team', label: t('config.controls.messageEditor.channel.sayTeam') },
            ]}
          />
        </Field>

        <Field label={t('config.controls.messageEditor.textLabel')}>
          <input
            ref={inputRef}
            className={FIELD_BASE}
            value={text}
            // Quotes are filtered as typed, not just at save time: Quake 2 has
            // no in-quote escaping (decision 12), so a `"` cannot be
            // represented at all, and letting one sit in the field would make
            // this editor's own preview look fine while the save schema
            // rejects it with nothing shown to the user. Unlike
            // `sanitizeCommand`, this does not collapse whitespace - a
            // message's spacing is intentional content, not a console
            // command's tokens, and collapsing it while the user is still
            // typing would fight every keystroke.
            onChange={(event) => setText(event.target.value.replace(/"/g, ''))}
            onSelect={captureSelection}
            onClick={captureSelection}
            onKeyUp={captureSelection}
          />
        </Field>

        <div className="space-y-1.5">
          <span className="stencil">{t('config.controls.messageEditor.previewLabel')}</span>
          <p className="rounded-sm border border-line bg-void px-2.5 py-2 text-sm break-words">
            {previewSegments.length === 0 ? (
              <span className="text-ink-faint">{t('config.controls.messageEditor.previewEmpty')}</span>
            ) : (
              previewSegments.map((segment, index) =>
                segment.kind === 'colorCvar' ? (
                  // Story 041 D8: the glyph run through the same alt-charset styling every other
                  // high-bit run in this preview gets, plus a badge naming the cvar - the badge is
                  // what tells the player which of their own colour cvars this reference resolves
                  // to, since the glyph run alone looks identical for any cvar carrying that same
                  // colour byte.
                  <span
                    key={index}
                    className="inline-flex items-center gap-1"
                    title={t('config.controls.messageEditor.colorCvarChip', {
                      name: segment.name,
                    })}
                  >
                    <span className={segment.glyphAlt ? 'text-strogg-400' : 'text-ink'}>
                      {segment.glyphText}
                    </span>
                    <Badge tone="strogg">{`$${segment.name}`}</Badge>
                  </span>
                ) : (
                  <span key={index} className={segment.className}>
                    {segment.text}
                  </span>
                ),
              )
            )}
          </p>
          {singleDollarIssues.length > 0 && (
            <p className="rounded-sm border border-warning/35 bg-warning/8 px-2.5 py-1.5 text-xs text-warning">
              {t('config.controls.messageEditor.singleDollarWarning', {
                found: singleDollarIssues[0]!.found,
                suggestion: singleDollarIssues[0]!.suggestion,
              })}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <span className="stencil">{t('config.controls.messageEditor.macroBar.clientLabel')}</span>
          <div className="flex flex-wrap gap-1.5">
            {clientMacros.map((macro) => (
              <Button
                key={macro.token}
                variant="neutral"
                size="sm"
                onClick={() => insertAtCaret(macro.token)}
                title={t(macro.descriptionKey)}
              >
                {t(macro.labelKey)}
              </Button>
            ))}
          </div>
          <span className="stencil">{t('config.controls.messageEditor.macroBar.modLabel')}</span>
          <p className="text-xs text-ink-muted">{t('config.controls.messageEditor.macroBar.modCaveat')}</p>
          <div className="flex flex-wrap gap-1.5">
            {modMacros.map((macro) => (
              <Button
                key={macro.token}
                variant="neutral"
                size="sm"
                onClick={() => insertAtCaret(macro.token)}
                title={t(macro.descriptionKey)}
              >
                {macro.token}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <span className="stencil">{t('config.controls.messageEditor.suggestionsLabel')}</span>
          <div className="flex flex-wrap gap-1.5">
            {MESSAGE_SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion.id}
                variant="ghost"
                size="sm"
                onClick={() => setText(suggestion.text)}
              >
                {t(suggestion.labelKey)}
              </Button>
            ))}
          </div>
        </div>

        <SymbolPicker
          onInsertGlyph={insertAtCaret}
          onApplyAltCharset={applyAltCharsetToSelection}
          hasSelection={hasSelection}
        />

        {showKeyCapture && (
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
