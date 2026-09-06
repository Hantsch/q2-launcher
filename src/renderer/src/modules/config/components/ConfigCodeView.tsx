import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ConfigSyntaxLine } from '@shared/config/config-syntax'
import { tokenizeConfigText } from '@shared/config/config-syntax'
import { IconButton } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/controls'
import { cn } from '../../../lib/cn'
import { findMatches, splitTokenByMatches, type ConfigSearchMatch } from '../lib/config-search'
import { dedentSelection, getIndentLineRange, indentSelection } from '../lib/textarea-indent'

/** Tab / Shift+Tab insert or remove this many spaces at a time (story 057 D1). No convention for
 * structural indentation could be found in the repo's own `.cfg` fixtures - they use tabs only as
 * a value separator between a cvar and its value - so this is the documented default from the
 * story's decisions. */
const INDENT_UNIT = '  '

/**
 * Read-only, syntax-highlighted view of raw Quake II config text (story 024
 * D2), with an optional in-view find-in-file (story 024 D3). Replaces the
 * plain `CodeBlock` primitive wherever config text is shown; the styling
 * lives in `styles/config-syntax.css`.
 *
 * Three properties are load-bearing and none of them can be unit-tested in
 * this repo (Vitest runs `environment: 'node'`), so they are pinned by the
 * structure itself:
 *
 *  - **Copying the block yields the original bytes.** The `<pre>` contains
 *    nothing but the tokenizer's own token texts plus one `\n` per terminated
 *    line, in order. `tokenizeConfigText` is lossless, so the concatenation of
 *    what is rendered is the input text with line endings normalized to `\n`
 *    (a `\r\n` cannot survive a DOM text node anyway, so the terminator's
 *    exact bytes are deliberately not reproduced). The line numbers are a
 *    sibling element, never a text node inside the `<pre>` and never a
 *    pseudo-element, so no gutter digit can reach the clipboard. The search
 *    highlight spans (D3) only ever wrap a sub-range of a token's own text in
 *    an extra inline `<span>` - `splitTokenByMatches` never adds, removes or
 *    reorders a character, so this guarantee survives an active search too.
 *  - **The gutter stays aligned.** Both columns share one scroll container and
 *    one line height (see the CSS header for why the code column must not be
 *    its own `overflow-x` scroller), and nothing soft-wraps.
 *  - **A ~2000-line file paints without a stall.** Tokenization is memoized on
 *    `text`, and rendering is one flat pass over the memoized lines - no
 *    post-processing of the token stream, and deliberately no virtualization
 *    (story decision).
 */
export interface ConfigCodeViewProps {
  /** Raw config text, already decoded to a JS string. */
  text: string
  className?: string
  /** Renders the text as a bare highlighted snippet: no gutter, no line numbers, no panel chrome.
   * Search (D3) never applies in this mode - there is nowhere to put the search header, and this
   * mode exists for small inline previews rather than a file worth searching. */
  singleLine?: boolean
  /**
   * Renders an always-visible search header above the gutter+pre block (never a `Ctrl+F`
   * overlay) with a text input, a live match-count region and previous/next controls. Ignored
   * when `singleLine` is set - see that prop's doc comment.
   */
  searchable?: boolean
  /**
   * Renders a transparent, editable `<textarea>` overlaid on the tokenised `<pre>` (story 057
   * D1) instead of the read-only D2/D3 rendering. Mutually exclusive with `singleLine` and
   * `searchable` - callers that want editing get this mode's own Ctrl+F find bar instead, mirrored
   * from the `searchable` branch but reused against the textarea's own selection.
   */
  editable?: boolean
  /**
   * Drops the `max-height: 16rem` cap (see `.cfg-code--fill` in `config-syntax.css`) so the
   * element sizes to fill its container instead. Purely a sizing switch on this component; giving
   * the surrounding page the height for it to fill is a different deliverable's job.
   */
  fill?: boolean
  /** Fires with the textarea's current value on every keystroke, when `editable` is set. */
  onChange?: (text: string) => void
}

/** Tokenizes `text` for display and works out how many of the resulting lines get a gutter
 * number - shared by the read-only path (over the `text` prop) and the editable path (over the
 * live draft), so the "trailing phantom line from a final newline gets no number" rule lives in
 * exactly one place. */
function tokenizeForDisplay(text: string): { lines: ConfigSyntaxLine[]; numberedLines: number } {
  const parsed = tokenizeConfigText(text)
  /*
    Text ending in a newline makes the tokenizer emit a final empty line - correct for
    losslessness, but it is not a line of the file. It gets no number: whether or not the browser
    paints a line box for the `<pre>`'s trailing newline, no number can then sit next to content
    that is not there. Every other blank line is a real one and keeps its number.
  */
  const last = parsed[parsed.length - 1]
  const phantomTail =
    parsed.length > 1 && last !== undefined && last.tokens.length === 0 && last.terminator === ''
  return { lines: parsed, numberedLines: phantomTail ? parsed.length - 1 : parsed.length }
}

/** Shared by every line with no active match on it, so `splitTokenByMatches` is never called with
 * a throwaway array allocated on every render. */
const NO_LINE_MATCHES: ConfigSearchMatch[] = []

/** The sticky line-number column, shared by the search and no-search rendering paths so the
 * gutter markup exists in exactly one place. */
function renderGutter(lines: ConfigSyntaxLine[], numberedLines: number) {
  return (
    <div className="cfg-code-gutter select-none" aria-hidden="true">
      {lines.map((line) =>
        line.number > numberedLines ? null : (
          <div key={line.number} className="cfg-code-lineno">
            {line.number}
          </div>
        ),
      )}
    </div>
  )
}

/**
 * One line as inline spans plus its own line break. The break is always `\n`,
 * whatever the source terminator was: the DOM normalizes CR in a text node, so
 * emitting `\r\n` would gain nothing and risk a stray character. A final line
 * with no terminator emits no break, so a file that does not end in a newline
 * does not grow one on copy.
 *
 * This is the D2 rendering path, unchanged: one `<span className="cfg-tok-<kind>">` per token,
 * nothing else. It is used verbatim whenever search is off, and per-token when a line has no
 * active match even while search is on, so the "no search" output is never structurally
 * different from D2's.
 */
function renderLine(line: ConfigSyntaxLine) {
  return (
    <Fragment key={line.number}>
      {line.tokens.map((token, index) => (
        <span key={index} className={`cfg-tok-${token.kind}`}>
          {token.text}
        </span>
      ))}
      {line.terminator === '' ? null : '\n'}
    </Fragment>
  )
}

/**
 * Same per-line rendering as `renderLine`, but each token is additionally sliced through
 * `splitTokenByMatches` so a matched sub-range can be wrapped in its own `cfg-match`/
 * `cfg-match-current` span. Lines with no match on them fall through to the exact same single-
 * span-per-token output as `renderLine` (the `lineMatches.length === 0` branch below), so an
 * unsearched or non-matching line is byte- and structure-identical to the D2 path.
 */
function renderSearchableLine(
  line: ConfigSyntaxLine,
  matchesByLine: Map<number, ConfigSearchMatch[]>,
  currentMatch: ConfigSearchMatch | undefined,
  currentMatchRef: RefObject<HTMLSpanElement | null>,
) {
  const lineMatches = matchesByLine.get(line.number) ?? NO_LINE_MATCHES
  let offset = 0

  return (
    <Fragment key={line.number}>
      {line.tokens.map((token, index) => {
        const tokenStart = offset
        offset += token.text.length

        if (lineMatches.length === 0) {
          return (
            <span key={index} className={`cfg-tok-${token.kind}`}>
              {token.text}
            </span>
          )
        }

        const pieces = splitTokenByMatches(token.text, tokenStart, lineMatches, currentMatch)
        return (
          <span key={index} className={`cfg-tok-${token.kind}`}>
            {pieces.map((piece, pieceIndex) =>
              piece.matched ? (
                <span
                  key={pieceIndex}
                  ref={piece.current ? currentMatchRef : undefined}
                  className={cn('cfg-match', piece.current && 'cfg-match-current')}
                >
                  {piece.text}
                </span>
              ) : (
                piece.text
              ),
            )}
          </span>
        )
      })}
      {line.terminator === '' ? null : '\n'}
    </Fragment>
  )
}

export function ConfigCodeView({
  text,
  className,
  singleLine,
  searchable,
  editable,
  fill,
  onChange,
}: ConfigCodeViewProps) {
  const { t } = useTranslation()
  const { lines, numberedLines } = useMemo(() => tokenizeForDisplay(text), [text])

  // Every hook this component calls - editable-mode and read-only/search-mode alike - is declared
  // here, unconditionally, before any of the early returns further down that branch on
  // `editable`/`singleLine`/`isSearchActive`. Only the render OUTPUT branches on those props; the
  // hook CALLS themselves must run in the same order on every render, or a future caller that
  // flips `editable` on an already-mounted instance would crash React with a hook-count mismatch.

  // --- editable mode (story 057 D1) --------------------------------------------------------
  // A self-contained branch: the draft lives in local state (seeded from `text` once, like an
  // uncontrolled `<textarea defaultValue>`) rather than being fed back through the `text` prop on
  // every keystroke, so typing never depends on - or fights with - whatever the caller does with
  // `onChange`. Reload-while-editing is out of scope here; a caller that needs to force a reset
  // can remount with a `key`.
  const [draftText, setDraftText] = useState(text)
  const { lines: editLines, numberedLines: editNumberedLines } = useMemo(
    () => tokenizeForDisplay(draftText),
    [draftText],
  )

  const [isFindOpen, setIsFindOpen] = useState(false)
  const [editQuery, setEditQuery] = useState('')
  const [editMatchIndex, setEditMatchIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editSearchBarRef = useRef<HTMLDivElement | null>(null)
  const editCurrentMatchRef = useRef<HTMLSpanElement | null>(null)

  const editMatches = useMemo(
    () => (editable === true && isFindOpen ? findMatches(editLines, editQuery) : []),
    [editable, isFindOpen, editLines, editQuery],
  )

  const editMatchesByLine = useMemo(() => {
    const map = new Map<number, ConfigSearchMatch[]>()
    for (const match of editMatches) {
      const forLine = map.get(match.line)
      if (forLine) forLine.push(match)
      else map.set(match.line, [match])
    }
    return map
  }, [editMatches])

  useEffect(() => {
    setEditMatchIndex(0)
  }, [editQuery])

  const clampedEditMatchIndex =
    editMatches.length > 0 ? Math.min(editMatchIndex, editMatches.length - 1) : 0
  const currentEditMatch = editMatches.length > 0 ? editMatches[clampedEditMatchIndex] : undefined
  const currentEditMatchKey = currentEditMatch
    ? `${currentEditMatch.line}:${currentEditMatch.start}:${currentEditMatch.end}`
    : ''

  // Absolute offset (into `draftText`) of each line's first character, so a match - reported by
  // `findMatches` in per-line plain-text coordinates - can be turned into a real
  // `textarea.setSelectionRange` call. Derived from `draftText` directly (a plain `\n` split)
  // rather than from `editLines`/the tokenizer, so it never depends on tokenizer internals beyond
  // the one guarantee this whole view already leans on: the tokenizer is lossless and its line
  // count lines up with a plain split on `\n`.
  const editLineStartOffsets = useMemo(() => {
    const rawLines = draftText.split('\n')
    const offsets: number[] = []
    let cursor = 0
    for (const raw of rawLines) {
      offsets.push(cursor)
      cursor += raw.length + 1
    }
    return offsets
  }, [draftText])

  // Moves the textarea's real selection onto the current match whenever it changes - guarded on
  // the match's own identity, not the index, for the same reason as the read-only search branch
  // below (a keystroke that leaves the same match highlighted must not re-select/re-scroll).
  useEffect(() => {
    if (editable !== true || currentEditMatchKey === '' || currentEditMatch === undefined) return
    const el = textareaRef.current
    if (!el) return
    const lineOffset = editLineStartOffsets[currentEditMatch.line - 1] ?? 0
    el.setSelectionRange(lineOffset + currentEditMatch.start, lineOffset + currentEditMatch.end)
    editCurrentMatchRef.current?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `currentEditMatch` is intentionally
    // not a dependency: only its identity (`currentEditMatchKey`) should retrigger this effect.
  }, [editable, currentEditMatchKey, editLineStartOffsets])

  const goToNextEditMatch = (): void => {
    setEditMatchIndex((index) => (editMatches.length === 0 ? 0 : (index + 1) % editMatches.length))
  }

  const goToPreviousEditMatch = (): void => {
    setEditMatchIndex((index) =>
      editMatches.length === 0 ? 0 : (index - 1 + editMatches.length) % editMatches.length,
    )
  }

  const handleTextareaChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value
    setDraftText(value)
    onChange?.(value)
  }

  // Tab/Shift+Tab indent or dedent the current selection by replaying `textarea-indent.ts`'s
  // pure result through `document.execCommand('insertText', ...)` rather than assigning
  // `el.value` directly - only `execCommand` leaves the browser's native undo/redo stack intact,
  // which a manual value assignment would silently clear.
  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Tab') {
      event.preventDefault()
      const el = event.currentTarget
      const { selectionStart, selectionEnd, value } = el
      const { lineStart, lineEnd } = getIndentLineRange(value, selectionStart, selectionEnd)
      const after = value.slice(lineEnd)
      const result = event.shiftKey
        ? dedentSelection(value, selectionStart, selectionEnd, INDENT_UNIT)
        : indentSelection(value, selectionStart, selectionEnd, INDENT_UNIT)
      const newSegment = result.text.slice(lineStart, result.text.length - after.length)

      el.setSelectionRange(lineStart, lineEnd)
      document.execCommand('insertText', false, newSegment)
      el.setSelectionRange(result.selectionStart, result.selectionEnd)
    }
  }

  const handleEditSearchInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) goToPreviousEditMatch()
      else goToNextEditMatch()
    }
  }

  // Container-scoped, exactly like `handleContainerKeyDown` below: Ctrl+F only opens this view's
  // own find bar while focus is already somewhere inside it (the textarea or the find input,
  // both of which bubble a keydown up to this container), never a `window`-level listener.
  const handleEditContainerKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      if (!isFindOpen) return
      event.preventDefault()
      event.stopPropagation()
      setIsFindOpen(false)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      event.stopPropagation()
      setIsFindOpen(true)
      requestAnimationFrame(() => editSearchBarRef.current?.querySelector('input')?.focus())
    }
  }

  // --- read-only search-bar mode (story 024 D3) ---------------------------------------------
  // All of this branch's own hooks are declared here, unconditionally, alongside the editable
  // branch's hooks above and before any of this component's early returns below - see the
  // Rules-of-Hooks note on the `editable` prop in this file's doc comment.
  const isSearchActive = searchable === true && singleLine !== true

  const [query, setQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  // `Input` (`components/ui/controls.tsx`) types its props as plain `InputHTMLAttributes`, with
  // no `ref` slot to hand a focus target through - rather than widen that shared primitive just
  // for this one caller, the search bar wrapper carries the ref and Ctrl+F queries down to the
  // one `<input>` it contains.
  const searchBarRef = useRef<HTMLDivElement | null>(null)
  const currentMatchRef = useRef<HTMLSpanElement | null>(null)

  const matches = useMemo(
    () => (isSearchActive ? findMatches(lines, query) : []),
    [isSearchActive, lines, query],
  )

  const matchesByLine = useMemo(() => {
    const map = new Map<number, ConfigSearchMatch[]>()
    for (const match of matches) {
      const forLine = map.get(match.line)
      if (forLine) forLine.push(match)
      else map.set(match.line, [match])
    }
    return map
  }, [matches])

  // A new search (a changed query) always starts back at its first match. Matches shrinking or
  // moving underneath an unchanged query (e.g. the underlying text prop changed) is an edge case
  // this intentionally does not chase - `currentMatch` below still clamps defensively so it never
  // reads past the end of a shorter array.
  useEffect(() => {
    setCurrentMatchIndex(0)
  }, [query])

  // Clamped once, here, and reused for both the highlighted match and the "X of Y" label below -
  // a second independent clamp on the raw `currentMatchIndex` could drift from this one (e.g.
  // showing "6 of 2" after the match set shrinks while the highlight correctly clamps to match 2).
  const clampedMatchIndex = matches.length > 0 ? Math.min(currentMatchIndex, matches.length - 1) : 0
  const currentMatch = matches.length > 0 ? matches[clampedMatchIndex] : undefined

  const currentMatchKey = currentMatch
    ? `${currentMatch.line}:${currentMatch.start}:${currentMatch.end}`
    : ''

  // Guarded on the current match's own identity (line/start/end), not on the index or on
  // `matches` itself, so this fires exactly when the highlighted match actually moves - not on
  // every keystroke that leaves the same match highlighted (e.g. typing that only extends a
  // query while the first match's position is unchanged never re-triggers the scroll).
  useEffect(() => {
    if (currentMatchKey) {
      currentMatchRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [currentMatchKey])

  const goToNext = (): void => {
    setCurrentMatchIndex((index) => (matches.length === 0 ? 0 : (index + 1) % matches.length))
  }

  const goToPrevious = (): void => {
    setCurrentMatchIndex((index) =>
      matches.length === 0 ? 0 : (index - 1 + matches.length) % matches.length,
    )
  }

  // Escape clears the query wherever focus is within this component - the search input or the
  // container itself, both of which bubble a keydown up to this container - and never bubbles
  // further, so a dialog this view happens to sit inside does not also treat the same keypress
  // as "close the dialog". A container-scoped Ctrl+F (never `window.addEventListener`)
  // intercepts the browser's native find-in-page and redirects it at this view's own search box
  // instead.
  const handleContainerKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      // Only swallow Escape when there is actually something for it to do here (a non-empty
      // query to clear). An empty query has nothing for this handler to act on, so the event is
      // left to propagate untouched - otherwise an ancestor's own Escape-to-close (e.g. a dialog
      // listening on `document`, see `components/ui/Modal.tsx`) could never fire while focus
      // happens to be inside this view, even with no active search.
      if (query.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      setQuery('')
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      event.stopPropagation()
      searchBarRef.current?.querySelector('input')?.focus()
    }
  }

  const handleSearchInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) goToPrevious()
      else goToNext()
    }
  }

  if (editable) {
    const editCountLabel =
      editQuery.length === 0
        ? ''
        : editMatches.length === 0
          ? t('config.codeView.search.noMatches')
          : t('config.codeView.search.count', {
              current: clampedEditMatchIndex + 1,
              total: editMatches.length,
            })

    return (
      <div className={cn('cfg-code-panel', className)} onKeyDown={handleEditContainerKeyDown}>
        {isFindOpen && (
          <div className="cfg-code-search" ref={editSearchBarRef}>
            <Input
              value={editQuery}
              onChange={(event) => setEditQuery(event.target.value)}
              onKeyDown={handleEditSearchInputKeyDown}
              placeholder={t('config.codeView.search.placeholder')}
              aria-label={t('config.codeView.search.label')}
              className="w-56"
            />
            <span className="cfg-code-search-count" aria-live="polite">
              {editCountLabel}
            </span>
            <IconButton
              label={t('config.codeView.search.previous')}
              size="sm"
              onClick={goToPreviousEditMatch}
              disabled={editMatches.length === 0}
            >
              <ChevronUp className="size-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={t('config.codeView.search.next')}
              size="sm"
              onClick={goToNextEditMatch}
              disabled={editMatches.length === 0}
            >
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>
        )}
        <div className={cn('cfg-code', fill && 'cfg-code--fill')}>
          {renderGutter(editLines, editNumberedLines)}
          <div className="cfg-code-content-wrap">
            <pre className="cfg-code-content" aria-hidden="true">
              {editLines.map((line) =>
                renderSearchableLine(line, editMatchesByLine, currentEditMatch, editCurrentMatchRef),
              )}
            </pre>
            <textarea
              ref={textareaRef}
              className="cfg-code-textarea"
              value={draftText}
              onChange={handleTextareaChange}
              onKeyDown={handleTextareaKeyDown}
              spellCheck={false}
              wrap="off"
              aria-label={t('config.codeView.editorLabel')}
            />
          </div>
        </div>
      </div>
    )
  }

  if (singleLine) {
    return (
      <pre className={cn('cfg-code-single', className)} data-selectable>
        {lines.map(renderLine)}
      </pre>
    )
  }

  if (!isSearchActive) {
    return (
      // tabIndex so a keyboard-only user can reach and scroll this fixed-height (`max-height:
      // 16rem`) overflow container - axe's scrollable-region-focusable rule, otherwise nothing
      // in the tab order can scroll it. Distinct from `.cfg-code-panel` below's `tabIndex={-1}`,
      // which is a deliberate click/script-only focus target for Escape/Ctrl+F, not this.
      <div className={cn('cfg-code', fill && 'cfg-code--fill', className)} tabIndex={0}>
        {renderGutter(lines, numberedLines)}
        <pre className="cfg-code-content" data-selectable>
          {lines.map(renderLine)}
        </pre>
      </div>
    )
  }

  const countLabel =
    query.length === 0
      ? ''
      : matches.length === 0
        ? t('config.codeView.search.noMatches')
        : t('config.codeView.search.count', { current: clampedMatchIndex + 1, total: matches.length })

  return (
    <div
      className={cn('cfg-code-panel', className)}
      onKeyDown={handleContainerKeyDown}
      // Focusable via click/script (not via Tab) so that clicking anywhere in the highlighted
      // code below - not just the search input - moves focus onto this container. A keydown
      // event only ever bubbles from whatever currently has focus, so without this, clicking into
      // the code area left focus on `document.body` and neither Escape nor Ctrl+F above ever saw
      // the keystroke. The app-wide `:focus-visible` / `:focus:not(:focus-visible)` rule in
      // `styles/index.css` already suppresses the ring for this click-driven focus without any
      // extra CSS here, while leaving the search `Input`'s own focus-visible ring untouched.
      tabIndex={-1}
    >
      <div className="cfg-code-search" ref={searchBarRef}>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleSearchInputKeyDown}
          placeholder={t('config.codeView.search.placeholder')}
          aria-label={t('config.codeView.search.label')}
          className="w-56"
        />
        <span className="cfg-code-search-count" aria-live="polite">
          {countLabel}
        </span>
        <IconButton
          label={t('config.codeView.search.previous')}
          size="sm"
          onClick={goToPrevious}
          disabled={matches.length === 0}
        >
          <ChevronUp className="size-3.5" aria-hidden="true" />
        </IconButton>
        <IconButton
          label={t('config.codeView.search.next')}
          size="sm"
          onClick={goToNext}
          disabled={matches.length === 0}
        >
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>
      {/* Same tabIndex reasoning as the non-searchable branch above: this is the actual
          scrollable overflow container, and it otherwise sits outside the tab order. */}
      <div className={cn('cfg-code', fill && 'cfg-code--fill')} tabIndex={0}>
        {renderGutter(lines, numberedLines)}
        <pre className="cfg-code-content" data-selectable>
          {lines.map((line) => renderSearchableLine(line, matchesByLine, currentMatch, currentMatchRef))}
        </pre>
      </div>
    </div>
  )
}
