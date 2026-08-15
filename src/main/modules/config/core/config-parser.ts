/**
 * Pure Quake II config-file tokenizer + classifier.
 *
 * Takes raw config text (already decoded to a JS string - the caller,
 * `import-reader.ts`, owns the latin-1 file read; see story 005 decision 8)
 * and splits it into the pieces q2-launcher understands (cvars, key
 * bindings, `exec` references) plus everything it doesn't, which is kept
 * byte-for-byte so nothing in a user's hand-written config is silently
 * dropped (story 005 AC 4). No `node:fs`, no Electron - this file only ever
 * sees a string and returns data.
 *
 * ## Tokenizer rules (Quake II's own, not reinvented)
 *
 *  - `"` starts a quoted argument. There is NO in-quote escaping: the next
 *    `"` always ends the span, and a backslash inside one is a literal
 *    character, never an escape. An unterminated quote (no closing `"`
 *    before the line ends) simply runs to the end of the line - config
 *    files are line-based, there is no multi-line string.
 *  - Outside quotes, whitespace separates tokens.
 *  - `//` starts a line comment, but only when it appears outside a quoted
 *    span (`set motd "see http://example.com"` keeps its URL intact).
 *  - `;` separates multiple commands on one physical line, again only
 *    outside quotes.
 *
 * ## Recognized commands (story 005 decision 7)
 *
 * `set` / `seta` / `setu` / `sets` (case-insensitive command name) assign a
 * cvar: `<cmd> <name> <value>`. `bind` assigns a key: `bind <key>
 * <command>`. `unbind <key>` and `unbindall` remove bindings. `exec <file>`
 * names another file to load - this parser only records the target string;
 * resolving/expanding it against the gamedir search path is
 * `import-reader.ts`'s job (decision 5/6), not this one's.
 *
 * Everything else - `alias`, `+`-prefixed commands, comment-only lines,
 * genuinely garbled lines, and a recognized-looking command that is missing
 * the arguments it needs to mean anything (e.g. `set` with no value, `bind`
 * with no key) - is preserved verbatim rather than guessed at. Truly blank
 * lines (nothing at all, not even a comment) carry no content and are
 * simply dropped: there is nothing there to lose.
 *
 * Duplicate cvars/binds within one parse are NOT resolved here - every
 * occurrence is returned in the order it appears. Cross-file last-wins
 * merging is `import-reader.ts`'s job (decision 4), since this file never
 * sees more than one file's text at a time.
 *
 * ## Why `ParsedBind` is a discriminated union
 *
 * `bind KEY COMMAND`, `unbind KEY` and `unbindall` carry different amounts
 * of information (a command, a key, or nothing at all), so instead of one
 * flat shape with fields that are meaningless for some of the three kinds
 * (which is what the story sketch's `command: 'unbind'` convention would
 * have produced), `ParsedBind` is a `kind`-tagged union. Consumers can
 * switch on `kind` and get real type narrowing instead of checking for
 * sentinel string values.
 *
 * ## Preserved-line granularity
 *
 * Most lines are exactly one command. When a whole line turns out to be
 * unrecognized (alias, `+cmd`, comment-only, garbled, or an
 * under-specified recognized command), the ORIGINAL raw line - including
 * its own whitespace and any trailing comment - is preserved unchanged.
 * The rarer case is a `;`-separated line that mixes a recognized command
 * with an unrecognized one (e.g. `set a 1; something else`); there, the
 * line as a whole was already legitimately split and partially understood,
 * so only the unrecognized segment's own (trimmed) text is preserved,
 * tagged with the same line number as its sibling segments.
 */

export interface ParsedCvar {
  name: string
  value: string
  line: number
}

/**
 * `kind: 'bind'` carries a key + command, mirroring `bind <key> <command>`.
 * `kind: 'unbind'` carries only the key that was unbound.
 * `kind: 'unbindall'` carries neither - `unbindall` takes no argument.
 */
export type ParsedBind =
  | { kind: 'bind'; key: string; command: string; line: number }
  | { kind: 'unbind'; key: string; line: number }
  | { kind: 'unbindall'; line: number }

export interface ParsedExec {
  target: string
  line: number
}

export interface PreservedLine {
  text: string
  line: number
}

export interface ParseConfigResult {
  cvars: ParsedCvar[]
  binds: ParsedBind[]
  execs: ParsedExec[]
  preserved: PreservedLine[]
}

/** Command names (case-insensitive) that assign a cvar. */
const CVAR_COMMANDS = new Set(['set', 'seta', 'setu', 'sets'])

/**
 * Splits config text into physical lines. Quake II config files are
 * commonly authored on Windows, so `\r\n` is normal, but `\n`-only and a
 * stray `\r`-only are handled too rather than trusting the source.
 */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

/**
 * Returns the portion of `line` before an unquoted `//`, or the whole line
 * if there is none. Quote state is tracked char-by-char so a `//` inside a
 * quoted value (a URL in a motd, say) is not mistaken for a comment.
 */
function stripLineComment(line: string): string {
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i)
    }
  }
  return line
}

/** Splits `line` on `;` that appear outside a quoted span. */
function splitTopLevelSemicolons(line: string): string[] {
  const parts: string[] = []
  let inQuotes = false
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && ch === ';') {
      parts.push(line.slice(start, i))
      start = i + 1
    }
  }
  parts.push(line.slice(start))
  return parts
}

const WHITESPACE = /\s/

/**
 * Tokenizes one command segment the way Quake II's `COM_Parse` does: skip
 * whitespace, then if the next character is a `"`, the token is everything
 * up to (not including) the next `"` - or the end of the segment if there
 * isn't one, since there is no escaping and no multi-line strings here.
 * Otherwise the token runs to the next whitespace. A `"` that appears mid
 * token (not right after whitespace) is not special - it is only quoting
 * syntax as the first character of a token.
 */
function tokenize(segment: string): string[] {
  const tokens: string[] = []
  const n = segment.length
  let i = 0

  while (i < n) {
    while (i < n && WHITESPACE.test(segment[i])) i++
    if (i >= n) break

    if (segment[i] === '"') {
      i++
      const start = i
      while (i < n && segment[i] !== '"') i++
      tokens.push(segment.slice(start, i))
      if (i < n) i++ // consume the closing quote, if there was one
    } else {
      const start = i
      while (i < n && !WHITESPACE.test(segment[i])) i++
      tokens.push(segment.slice(start, i))
    }
  }

  return tokens
}

type Classified =
  | { kind: 'cvar'; item: ParsedCvar }
  | { kind: 'bind'; item: ParsedBind }
  | { kind: 'exec'; item: ParsedExec }
  | { kind: 'unrecognized' }

/**
 * Classifies one already-comment-stripped, already-semicolon-split command
 * segment. Requires the argument count the command actually needs to mean
 * something (e.g. `set` needs a name AND a value); a recognized command
 * name without enough arguments is a no-op in the real engine, so it is
 * reported as unrecognized rather than guessed at with an empty value.
 */
function classifySegment(segment: string, line: number): Classified {
  const tokens = tokenize(segment)
  if (tokens.length === 0) return { kind: 'unrecognized' }

  const name = tokens[0].toLowerCase()

  if (CVAR_COMMANDS.has(name)) {
    if (tokens.length < 3) return { kind: 'unrecognized' }
    return { kind: 'cvar', item: { name: tokens[1], value: tokens.slice(2).join(' '), line } }
  }

  if (name === 'bind') {
    if (tokens.length < 3) return { kind: 'unrecognized' }
    return {
      kind: 'bind',
      item: { kind: 'bind', key: tokens[1], command: tokens.slice(2).join(' '), line },
    }
  }

  if (name === 'unbind') {
    if (tokens.length < 2) return { kind: 'unrecognized' }
    return { kind: 'bind', item: { kind: 'unbind', key: tokens[1], line } }
  }

  if (name === 'unbindall') {
    return { kind: 'bind', item: { kind: 'unbindall', line } }
  }

  if (name === 'exec') {
    if (tokens.length < 2) return { kind: 'unrecognized' }
    return { kind: 'exec', item: { target: tokens[1], line } }
  }

  return { kind: 'unrecognized' }
}

export function parseConfigText(text: string): ParseConfigResult {
  const cvars: ParsedCvar[] = []
  const binds: ParsedBind[] = []
  const execs: ParsedExec[] = []
  const preserved: PreservedLine[] = []

  const rawLines = splitLines(text)

  rawLines.forEach((rawLine, index) => {
    const line = index + 1
    const active = stripLineComment(rawLine)
    const segments = splitTopLevelSemicolons(active).filter((s) => s.trim().length > 0)

    if (segments.length === 0) {
      // Nothing left after stripping a comment. If the raw line had content
      // (i.e. it WAS a comment), keep it - the comment text is real
      // content a user wrote. A genuinely empty/whitespace-only line has
      // nothing to preserve.
      if (rawLine.trim().length > 0) {
        preserved.push({ text: rawLine, line })
      }
      return
    }

    if (segments.length === 1) {
      // The common case: one command per line. Preserve the ORIGINAL raw
      // line (not the comment-stripped/trimmed segment) so formatting and
      // any trailing comment survive untouched when it turns out to be
      // unrecognized.
      const result = classifySegment(segments[0], line)
      switch (result.kind) {
        case 'cvar':
          cvars.push(result.item)
          return
        case 'bind':
          binds.push(result.item)
          return
        case 'exec':
          execs.push(result.item)
          return
        case 'unrecognized':
          preserved.push({ text: rawLine, line })
          return
      }
    }

    // Multiple `;`-separated commands: classify each independently. A
    // segment that doesn't parse only loses its own piece of the line, not
    // the sibling commands that share it.
    for (const segment of segments) {
      const result = classifySegment(segment, line)
      switch (result.kind) {
        case 'cvar':
          cvars.push(result.item)
          break
        case 'bind':
          binds.push(result.item)
          break
        case 'exec':
          execs.push(result.item)
          break
        case 'unrecognized':
          preserved.push({ text: segment.trim(), line })
          break
      }
    }
  })

  return { cvars, binds, execs, preserved }
}
