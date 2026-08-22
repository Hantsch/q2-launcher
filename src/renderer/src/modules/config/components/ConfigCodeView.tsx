import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
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

export function ConfigCodeView({ text, className, singleLine, searchable }: ConfigCodeViewProps) {
  const { t } = useTranslation()
  const { lines, numberedLines } = useMemo(() => {
    const parsed = tokenizeConfigText(text)
    /*
      Text ending in a newline makes the tokenizer emit a final empty line -
      correct for losslessness, but it is not a line of the file. It gets no
      number: whether or not the browser paints a line box for the `<pre>`'s
      trailing newline, no number can then sit next to content that is not
      there. Every other blank line is a real one and keeps its number.
    */
    const last = parsed[parsed.length - 1]
    const phantomTail =
      parsed.length > 1 && last !== undefined && last.tokens.length === 0 && last.terminator === ''
    return { lines: parsed, numberedLines: phantomTail ? parsed.length - 1 : parsed.length }
  }, [text])

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
      <div className={cn('cfg-code', className)} tabIndex={0}>
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
      <div className="cfg-code" tabIndex={0}>
        {renderGutter(lines, numberedLines)}
        <pre className="cfg-code-content" data-selectable>
          {lines.map((line) => renderSearchableLine(line, matchesByLine, currentMatch, currentMatchRef))}
        </pre>
      </div>
    </div>
  )
}
