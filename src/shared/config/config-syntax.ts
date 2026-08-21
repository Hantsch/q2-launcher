/**
 * Pure, lossless, presentation-oriented tokenizer for Quake II config text.
 *
 * This is NOT a replacement for `config-parser.ts`
 * (`src/main/modules/config/core/config-parser.ts`), which stays untouched
 * and is the semantic import-path parser (it extracts cvars/binds/execs and
 * drops nothing it doesn't recognize into a lossy-by-design result shape).
 * This file exists for a different consumer: a syntax-highlighted config
 * viewer that needs every character of the input accounted for, in order, so
 * it can paint spans over the raw text without ever silently eating or
 * reordering a byte. Nothing here is imported from `config-parser.ts`, and
 * nothing from it is imported here - the two files independently implement
 * the same underlying engine behaviour for two different jobs.
 *
 * ## Provenance / licence note
 *
 * There is a VS Code extension covering similar ground,
 * https://github.com/amokmen/quake2-config-syntax, which is GPL-3.0
 * licensed. Nothing in this file is derived from or copied from that
 * project's grammar, TextMate rules or code - none of it was read beyond
 * confirming its licence. The scanning rules implemented below come from
 * this repo's own existing documentation of the engine's actual behaviour:
 * `config-parser.ts`'s tokenizer header (quoting has no escaping, `//` and
 * `;` are only special outside quotes, lines split on `\r\n|\r|\n`) and
 * `alt-layers.ts`'s quoting section (same facts, cited again as the
 * precedent for treating them as a shared, engine-derived layer rather than
 * one file's private assumption). Because this file's rules trace to
 * `config-parser.ts` and `alt-layers.ts` and not to the GPL-3.0 project, it
 * is free to ship under this repo's own (MIT) licence.
 *
 * ## Classification model
 *
 * Classification is positional, not catalogue-driven - this file
 * deliberately does NOT import `cvar-catalog` or `key-names`. A word is a
 * `cvar` or `key` token purely because of where it sits relative to a
 * recognized command word on the same `;`-segment, not because it matches a
 * known cvar/key name. This keeps the tokenizer honest about text it cannot
 * actually verify (an unknown cvar name still highlights as a cvar slot) and
 * keeps this file free of the two catalogues' own import weight.
 *
 * Per physical line, left to right, respecting quote state exactly like
 * `config-parser.ts`'s `stripLineComment` / `splitTopLevelSemicolons` /
 * `tokenize`:
 *
 *  - `//` outside quotes starts a `comment` token running to end of line
 *    (the `//` itself is part of the token text).
 *  - `;` outside quotes is its own `separator` token.
 *  - a run of whitespace outside quotes is a `space` token.
 *  - `"..."` (opening quote to closing quote, or to end of line if
 *    unterminated) is a `string` token, quotes included verbatim.
 *  - otherwise, a whitespace-delimited word is classified by its position
 *    within its `;`-delimited segment:
 *      - first word, case-insensitively one of `bind`, `unbind`,
 *        `unbindall`, `alias`, `set`, `seta`, `setu`, `sets`, `exec`,
 *        `echo`, `wait` -> `command`.
 *      - second word of a segment whose first word was `bind`/`unbind` ->
 *        `key`.
 *      - second word of a segment whose first word was
 *        `set`/`seta`/`setu`/`sets` -> `cvar`.
 *      - a bare word matching `/^[+-][A-Za-z]/` (a `+`/`-` followed by a
 *        letter) -> `plusCommand`, WHEREVER it appears in the segment - this
 *        is what makes `bind s +back`'s `+back` (second word) and
 *        `alias +drops "..."`'s `+drops` (second word) both highlight as
 *        `plusCommand`, not just a leading `+attack`/`-attack` on its own
 *        line. This only applies if the word wasn't already classified
 *        `command`/`key`/`cvar` by a more specific rule above (so the first
 *        word of a `bind`/`set` segment stays `command`), and the letter
 *        requirement is what distinguishes `+attack` from a negative numeric
 *        value like `set foo -5` (`number`).
 *      - a bare word matching `/^-?\d+(\.\d+)?$/` -> `number`.
 *      - anything else outside quotes -> `text`.
 *
 * A quoted key/cvar argument (`bind "MOUSE1" +attack`, rare in the wild) is
 * deliberately left as a `string` token rather than relabeled `key`/`cvar` -
 * `string` already exists as a kind and a quoted key still visibly reads as
 * "the argument in that slot" without this file inventing a second way to
 * spell the same kind. Only a *bare* second word gets promoted to `key` /
 * `cvar`.
 *
 * There is no cross-line state beyond physical line splitting: each line is
 * classified independently, so a garbled line can never change how its
 * neighbours are read. A line with no recognized command still gets
 * whichever `text` / `number` / `space` / `comment` / `string` tokens its
 * words individually earn - there is no "whole line is text" fallback mode.
 *
 * Purity: no imports beyond this file's own types - no `node:*`, no
 * Electron, no DOM, and (per the note above) no `config-parser.ts`, no
 * `cvar-catalog`, no `key-names`.
 */

/** One classified span of a config line. Concatenating a line's token texts, in order, reproduces the line's raw text exactly. */
export interface ConfigSyntaxToken {
  kind:
    | 'comment'
    | 'command'
    | 'key'
    | 'cvar'
    | 'number'
    | 'string'
    | 'plusCommand'
    | 'separator'
    | 'space'
    | 'text'
  text: string
}

/** One physical line's tokens plus the line-ending that followed it in the source text. */
export interface ConfigSyntaxLine {
  /** 1-based physical line number. */
  number: number
  tokens: ConfigSyntaxToken[]
  /** This line's own terminator; `''` for a final line with no trailing newline. */
  terminator: '' | '\n' | '\r\n' | '\r'
}

/** Command names (case-insensitive) recognized as the first word of a `;`-segment. */
const COMMAND_WORDS = new Set([
  'bind',
  'unbind',
  'unbindall',
  'alias',
  'set',
  'seta',
  'setu',
  'sets',
  'exec',
  'echo',
  'wait',
])

const CVAR_COMMANDS = new Set(['set', 'seta', 'setu', 'sets'])
const KEY_COMMANDS = new Set(['bind', 'unbind'])

const WHITESPACE = /\s/
const NUMBER_RE = /^-?\d+(\.\d+)?$/
/**
 * A `+`/`-` prefixed word is a `plusCommand` reference wherever it appears in
 * a segment (e.g. the second word of `bind s +back`, or the word right after
 * `alias` in `alias +drops "..."`) - not only when it opens the segment. The
 * `[A-Za-z]` after the sign is what excludes negative numbers like `-5`
 * (which must stay `number`) while still matching real command names.
 */
const PLUS_COMMAND_RE = /^[+-][A-Za-z]/

/**
 * Splits `text` into physical lines together with each line's own
 * terminator, mirroring `config-parser.ts`'s `splitLines` (`\r\n|\r|\n`) but
 * keeping the terminator instead of discarding it, since this tokenizer has
 * to be lossless.
 */
function splitLinesWithTerminators(
  text: string,
): Array<{ raw: string; terminator: '' | '\n' | '\r\n' | '\r' }> {
  const result: Array<{ raw: string; terminator: '' | '\n' | '\r\n' | '\r' }> = []
  let start = 0
  let i = 0
  const n = text.length

  while (i < n) {
    const ch = text[i]
    if (ch === '\r' || ch === '\n') {
      const raw = text.slice(start, i)
      let terminator: '\n' | '\r\n' | '\r'
      if (ch === '\r' && text[i + 1] === '\n') {
        terminator = '\r\n'
        i += 2
      } else if (ch === '\r') {
        terminator = '\r'
        i += 1
      } else {
        terminator = '\n'
        i += 1
      }
      result.push({ raw, terminator })
      start = i
      continue
    }
    i++
  }

  result.push({ raw: text.slice(start), terminator: '' })
  return result
}

/**
 * Finds the index of an unquoted `//` in `raw`, or -1 if there is none.
 * Quote state is a plain toggle over the whole line, exactly like
 * `config-parser.ts`'s `stripLineComment` - so a `//` that appears while an
 * (even unterminated) quote is open is not a comment start.
 */
function findCommentStart(raw: string): number {
  let inQuotes = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && ch === '/' && raw[i + 1] === '/') return i
  }
  return -1
}

/**
 * Splits one physical line into a trailing comment token (if any) plus
 * top-level (unquoted) segments on `;` within what remains, mirroring the
 * real pipeline `config-parser.ts` uses: `stripLineComment` runs BEFORE
 * `splitTopLevelSemicolons`, so a `;` that appears inside a `//` comment's
 * text is never mistaken for a segment separator - the comment is peeled off
 * first, and only the code portion in front of it is split on `;`.
 */
function tokenizeLine(raw: string): ConfigSyntaxToken[] {
  const commentStart = findCommentStart(raw)
  const codePart = commentStart === -1 ? raw : raw.slice(0, commentStart)
  const commentPart = commentStart === -1 ? '' : raw.slice(commentStart)

  const tokens: ConfigSyntaxToken[] = []
  let inQuotes = false
  let segmentStart = 0
  const n = codePart.length

  const flushSegment = (end: number): void => {
    if (end > segmentStart) {
      tokenizeSegment(codePart.slice(segmentStart, end), tokens)
    }
  }

  let i = 0
  while (i < n) {
    const ch = codePart[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      i++
      continue
    }
    if (!inQuotes && ch === ';') {
      flushSegment(i)
      tokens.push({ kind: 'separator', text: ';' })
      i++
      segmentStart = i
      continue
    }
    i++
  }
  flushSegment(n)

  if (commentPart) {
    tokens.push({ kind: 'comment', text: commentPart })
  }

  return tokens
}

/**
 * Scans one `;`-delimited, comment-free segment into tokens, appending them
 * to `out`. Tracks whether the first (and second) unquoted word has already
 * been seen, so `command`/`key`/`cvar`/`plusCommand` promotion only ever
 * applies to the right position within THIS segment.
 */
function tokenizeSegment(segment: string, out: ConfigSyntaxToken[]): void {
  const n = segment.length
  let i = 0
  let wordIndex = 0
  let firstWord: string | null = null

  while (i < n) {
    const ch = segment[i]

    if (ch === '"') {
      const start = i
      i++
      while (i < n && segment[i] !== '"') i++
      if (i < n) {
        i++ // consume closing quote
      }
      out.push({ kind: 'string', text: segment.slice(start, i) })
      wordIndex++
      continue
    }

    if (WHITESPACE.test(ch)) {
      const start = i
      while (i < n && WHITESPACE.test(segment[i])) i++
      out.push({ kind: 'space', text: segment.slice(start, i) })
      continue
    }

    // Bare (unquoted) word - runs until whitespace or a quote.
    const start = i
    while (i < n && !WHITESPACE.test(segment[i]) && segment[i] !== '"') i++
    const word = segment.slice(start, i)
    out.push(classifyWord(word, wordIndex, firstWord))
    if (wordIndex === 0) firstWord = word.toLowerCase()
    wordIndex++
  }
}

/** Classifies one bare (unquoted) word given its position within its `;`-segment. */
function classifyWord(
  word: string,
  wordIndex: number,
  firstWord: string | null,
): ConfigSyntaxToken {
  if (wordIndex === 0) {
    if (COMMAND_WORDS.has(word.toLowerCase())) {
      return { kind: 'command', text: word }
    }
  } else if (wordIndex === 1 && firstWord !== null) {
    if (KEY_COMMANDS.has(firstWord)) {
      return { kind: 'key', text: word }
    }
    if (CVAR_COMMANDS.has(firstWord)) {
      return { kind: 'cvar', text: word }
    }
  }

  if (PLUS_COMMAND_RE.test(word)) {
    return { kind: 'plusCommand', text: word }
  }

  if (NUMBER_RE.test(word)) {
    return { kind: 'number', text: word }
  }

  return { kind: 'text', text: word }
}

/**
 * Tokenizes raw Quake II config text into per-line, lossless spans. See the
 * file header for the full rule set. `text` is assumed already decoded to a
 * JS string, the same contract `config-parser.ts` uses.
 */
export function tokenizeConfigText(text: string): ConfigSyntaxLine[] {
  return splitLinesWithTerminators(text).map(({ raw, terminator }, index) => ({
    number: index + 1,
    tokens: tokenizeLine(raw),
    terminator,
  }))
}
