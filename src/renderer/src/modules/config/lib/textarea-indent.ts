/**
 * Pure Tab / Shift+Tab indent-dedent helpers for the Raw File editor overlay (story 057 D1).
 *
 * Both functions take a text buffer and a selection range and return the new buffer plus a
 * recomputed selection range that keeps the same logical lines selected - the caller
 * (`ConfigCodeView`) is responsible for applying the result via `document.execCommand('insertText',
 * ...)` so the browser's native undo/redo stack keeps working; nothing here touches the DOM.
 *
 * `indentUnit` is caller-supplied (no convention could be found in the repo's own `.cfg` fixtures
 * - they use tabs only as a value separator, never for structural indentation) and defaults to a
 * two-space unit at the call site in `ConfigCodeView`.
 *
 * Both operations always act on whole lines - every line touched by the selection, even a
 * collapsed cursor or a single-line selection - never on a bare cursor position. A selection that
 * ends exactly at the start of a line (e.g. dragging from column 0 of line 1 to column 0 of line
 * 2) does not pull line 2 into the operation, matching the usual editor convention that nothing of
 * line 2 is actually selected.
 */

export interface IndentResult {
  text: string
  selectionStart: number
  selectionEnd: number
}

/** The line(s) a selection touches, as an offset range within `text` that starts at the
 * beginning of the first touched line and ends at the end of the last touched line (never
 * including that line's trailing newline).
 *
 * Exported so a caller that must replay the same operation through
 * `document.execCommand('insertText', ...)` (to keep native undo/redo working - see
 * `ConfigCodeView`) can select exactly this range before replacing it, rather than guessing at
 * line boundaries a second, possibly inconsistent, way. */
export function getIndentLineRange(text: string, start: number, end: number): { lineStart: number; lineEnd: number } {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1

  // A selection landing exactly on a line boundary (its last character is the newline that
  // starts the next line) does not pull that next, untouched line into the operation.
  const boundaryEnd = end > start && text[end - 1] === '\n' ? end - 1 : end

  const nextNewline = text.indexOf('\n', boundaryEnd)
  const lineEnd = nextNewline === -1 ? text.length : nextNewline
  return { lineStart, lineEnd }
}

/** Prefixes every line touched by the selection with `indentUnit`, and shifts the selection
 * bounds so the same visible lines stay selected afterwards. */
export function indentSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  indentUnit: string,
): IndentResult {
  const { lineStart, lineEnd } = getIndentLineRange(text, selectionStart, selectionEnd)
  const before = text.slice(0, lineStart)
  const segment = text.slice(lineStart, lineEnd)
  const after = text.slice(lineEnd)

  const lines = segment.split('\n')
  const newText = before + lines.map((line) => indentUnit + line).join('\n') + after

  const shiftFor = (position: number): number => {
    if (position < lineStart) return 0
    let cursor = lineStart
    for (let i = 0; i < lines.length; i++) {
      const lineAbsEnd = cursor + lines[i].length
      if (position <= lineAbsEnd) return indentUnit.length * (i + 1)
      cursor = lineAbsEnd + 1 // skip the newline
    }
    return indentUnit.length * lines.length
  }

  return {
    text: newText,
    selectionStart: selectionStart + shiftFor(selectionStart),
    selectionEnd: selectionEnd + shiftFor(selectionEnd),
  }
}

/** How many leading characters of `line` count as one removable indent step: an exact
 * `indentUnit` prefix if present, otherwise up to `indentUnit.length` leading whitespace
 * characters (so a line indented with fewer spaces/tabs than a full unit still dedents instead of
 * being a no-op). A line with no leading whitespace at all removes nothing. */
function leadingRemovable(line: string, indentUnit: string): number {
  if (indentUnit.length > 0 && line.startsWith(indentUnit)) return indentUnit.length

  let count = 0
  while (count < indentUnit.length && count < line.length && (line[count] === ' ' || line[count] === '\t')) {
    count++
  }
  return count
}

/** Removes one indent step from the start of every line touched by the selection, and shifts the
 * selection bounds to match. A line with nothing removable (no leading indent) is left as-is. */
export function dedentSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  indentUnit: string,
): IndentResult {
  const { lineStart, lineEnd } = getIndentLineRange(text, selectionStart, selectionEnd)
  const before = text.slice(0, lineStart)
  const segment = text.slice(lineStart, lineEnd)
  const after = text.slice(lineEnd)

  const lines = segment.split('\n')
  const removals = lines.map((line) => leadingRemovable(line, indentUnit))
  const dedented = lines.map((line, i) => line.slice(removals[i]))
  const newText = before + dedented.join('\n') + after

  const shiftFor = (position: number): number => {
    if (position < lineStart) return 0
    let cursor = lineStart
    let cumulative = 0
    for (let i = 0; i < lines.length; i++) {
      const lineAbsEnd = cursor + lines[i].length
      if (position <= lineAbsEnd) {
        const withinLine = position - cursor
        return cumulative + Math.min(removals[i], withinLine)
      }
      cumulative += removals[i]
      cursor = lineAbsEnd + 1 // skip the newline
    }
    return cumulative
  }

  return {
    text: newText,
    selectionStart: selectionStart - shiftFor(selectionStart),
    selectionEnd: selectionEnd - shiftFor(selectionEnd),
  }
}
