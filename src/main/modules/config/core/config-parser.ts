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
 * <command>`. `unbind <key>` and `unbindall` remove bindings - both run the
 * key token through `normalizeBindKey` (`@shared/config/key-names`), since
 * hand-written configs mix casing (`ctrl`/`CTRL`) that would otherwise never
 * match the keyboard overview's canonical spelling. `exec <file>`
 * names another file to load - this parser only records the target string;
 * resolving/expanding it against the gamedir search path is
 * `import-reader.ts`'s job (decision 5/6), not this one's.
 *
 * `alias <name> <body>` and `alias <name> "<body>"` are also recognized
 * (story 041 decision 7): `<name>` is kept verbatim (including a leading
 * `+`/`-`) and `<body>` is the tokens after the name re-joined with single
 * spaces, mirroring the real engine's `Cmd_Alias_f` - which is why a quoted
 * body with an embedded `;` (`alias n "a;b"`) comes out as the single string
 * `a;b` rather than being split here; that split is a later stage's job
 * (story 041 D3), not this parser's. `alias n ""` is a valid, recognized
 * alias with an empty body. A bare `alias` with no name at all (fewer than 2
 * tokens) is not recognized.
 *
 * Everything else - `+`-prefixed commands, comment-only lines, genuinely
 * garbled lines, and a recognized-looking command that is missing the
 * arguments it needs to mean anything (e.g. `set` with no value, `bind` with
 * no key) - is preserved verbatim rather than guessed at. Truly blank lines
 * (nothing at all, not even a comment) carry no content and are simply
 * dropped: there is nothing there to lose.
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
 * unrecognized (`+cmd`, comment-only, garbled, or an under-specified
 * recognized command), the ORIGINAL raw line - including
 * its own whitespace and any trailing comment - is preserved unchanged.
 * The rarer case is a `;`-separated line that mixes a recognized command
 * with an unrecognized one (e.g. `set a 1; something else`); there, the
 * line as a whole was already legitimately split and partially understood,
 * so only the unrecognized segment's own (trimmed) text is preserved,
 * tagged with the same line number as its sibling segments.
 *
 * ## Trailing comments (story 042 D3)
 *
 * Every classified cvar/bind/alias also carries `comment`: the raw text
 * after the line's `//` marker (marker stripped, nothing else touched),
 * `''` when the line had none. A `;`-chained line has exactly one trailing
 * comment for the whole line, so every sibling segment gets the same
 * `comment` string, never a per-segment fragment of it. A line that is
 * ONLY a comment (no command at all) keeps being folded into `preserved`
 * exactly as it always was (AC 8: nothing that used to survive there stops
 * surviving there) - it is ADDITIONALLY collected in `comments`, in document
 * order, so a later stage (D4) can find section-header banners without
 * re-scanning `preserved` for lines that merely look unrecognized.
 */

import { normalizeBindKey } from '@shared/config/key-names'
import {
  splitTopLevelSemicolons,
  stripLineComment,
  tokenize,
} from '@shared/config/command-tokenizer'

/**
 * `comment` is the raw text following the line's trailing `//` marker (the
 * marker itself stripped, nothing else touched) - `''` when the source line
 * carried no comment at all. Story 042 D3: the writer (D2) attaches a
 * display name and, later, a `[q2l ...]` tag there, so the parser must hand
 * it back rather than discard it as it did before this story.
 */
export interface ParsedCvar {
  name: string
  value: string
  line: number
  comment: string
}

/**
 * `kind: 'bind'` carries a key + command, mirroring `bind <key> <command>`.
 * `kind: 'unbind'` carries only the key that was unbound.
 * `kind: 'unbindall'` carries neither - `unbindall` takes no argument.
 * Every kind also carries `comment` (see `ParsedCvar`'s doc comment).
 */
export type ParsedBind =
  | { kind: 'bind'; key: string; command: string; line: number; comment: string }
  | { kind: 'unbind'; key: string; line: number; comment: string }
  | { kind: 'unbindall'; line: number; comment: string }

export interface ParsedExec {
  target: string
  line: number
}

/**
 * `body` is the raw, unsplit argument text `alias` received, quotes
 * stripped - a quoted `"a;b"` and an unquoted multi-token body both collapse
 * to a single string here. Splitting that body into individual commands on
 * top-level `;` is a later stage's job (story 041 D3), not this parser's.
 * `comment` is the line's trailing comment - see `ParsedCvar`'s doc comment.
 */
export interface ParsedAlias {
  name: string
  body: string
  line: number
  comment: string
}

export interface PreservedLine {
  text: string
  line: number
}

/**
 * A line that is ONLY a `//` comment - no command at all, recognized or
 * not. Collected ADDITIONALLY to `preserved` (story 042 D3), which still
 * carries the same line unchanged (AC 8), because a later stage (D4) reads
 * this bucket specifically to find section-header banners without
 * re-scanning `preserved` for lines that merely look unrecognized; `text`
 * is the same "marker stripped" comment text as `ParsedCvar.comment`, never
 * the raw `//`-prefixed line.
 */
export interface CommentLine {
  text: string
  line: number
}

export interface ParseConfigResult {
  cvars: ParsedCvar[]
  binds: ParsedBind[]
  execs: ParsedExec[]
  aliases: ParsedAlias[]
  preserved: PreservedLine[]
  comments: CommentLine[]
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

type Classified =
  | { kind: 'cvar'; item: ParsedCvar }
  | { kind: 'bind'; item: ParsedBind }
  | { kind: 'exec'; item: ParsedExec }
  | { kind: 'alias'; item: ParsedAlias }
  | { kind: 'unrecognized' }

/**
 * Classifies one already-comment-stripped, already-semicolon-split command
 * segment. Requires the argument count the command actually needs to mean
 * something (e.g. `set` needs a name AND a value); a recognized command
 * name without enough arguments is a no-op in the real engine, so it is
 * reported as unrecognized rather than guessed at with an empty value.
 */
function classifySegment(segment: string, line: number, comment: string): Classified {
  const tokens = tokenize(segment)
  if (tokens.length === 0) return { kind: 'unrecognized' }

  const name = tokens[0].toLowerCase()

  if (CVAR_COMMANDS.has(name)) {
    if (tokens.length < 3) return { kind: 'unrecognized' }
    return {
      kind: 'cvar',
      item: { name: tokens[1], value: tokens.slice(2).join(' '), line, comment },
    }
  }

  if (name === 'bind') {
    if (tokens.length < 3) return { kind: 'unrecognized' }
    return {
      kind: 'bind',
      item: {
        kind: 'bind',
        key: normalizeBindKey(tokens[1]),
        command: tokens.slice(2).join(' '),
        line,
        comment,
      },
    }
  }

  if (name === 'unbind') {
    if (tokens.length < 2) return { kind: 'unrecognized' }
    return {
      kind: 'bind',
      item: { kind: 'unbind', key: normalizeBindKey(tokens[1]), line, comment },
    }
  }

  if (name === 'unbindall') {
    return { kind: 'bind', item: { kind: 'unbindall', line, comment } }
  }

  if (name === 'exec') {
    if (tokens.length < 2) return { kind: 'unrecognized' }
    return { kind: 'exec', item: { target: tokens[1], line } }
  }

  if (name === 'alias') {
    // A bare `alias` with no name at all is not recognized. `alias n` and
    // `alias n ""` both have a name and no (or an empty) body - the real
    // engine (`Cmd_Alias_f`) accepts both and stores an empty-string value,
    // so both are recognized here too. The alias name itself is kept as
    // written (`tokens[1]`, not `name`), since it may carry a `+`/`-` sign
    // that must not be treated as a command-name lowercase transform.
    if (tokens.length < 2) return { kind: 'unrecognized' }
    return {
      kind: 'alias',
      item: { name: tokens[1], body: tokens.slice(2).join(' '), line, comment },
    }
  }

  return { kind: 'unrecognized' }
}

export function parseConfigText(text: string): ParseConfigResult {
  const cvars: ParsedCvar[] = []
  const binds: ParsedBind[] = []
  const execs: ParsedExec[] = []
  const aliases: ParsedAlias[] = []
  const preserved: PreservedLine[] = []
  const comments: CommentLine[] = []

  const rawLines = splitLines(text)

  rawLines.forEach((rawLine, index) => {
    const line = index + 1
    const active = stripLineComment(rawLine)
    // `active` is a strict prefix of `rawLine` (everything up to the `//`)
    // whenever a marker was found, and `active === rawLine`/same length
    // otherwise - so the length gap alone tells us whether there was a
    // comment at all, without re-scanning the line a second time.
    const hasComment = active.length < rawLine.length
    const comment = hasComment ? rawLine.slice(active.length + 2) : ''
    const segments = splitTopLevelSemicolons(active).filter((s) => s.trim().length > 0)

    if (segments.length === 0) {
      // Nothing left after stripping a comment. A line that WAS a comment
      // (marker found) is a comment-only line, ADDITIONALLY collected into
      // its own bucket (story 042 D3) - it still lands in `preserved` too,
      // unchanged from before this story (AC 8). A line with no marker at
      // all that still lost everything to the semicolon split (e.g. `;;;`)
      // keeps today's behaviour: preserved if it had any content, dropped
      // if it was genuinely blank.
      if (hasComment) {
        comments.push({ text: comment, line })
        preserved.push({ text: rawLine, line })
      } else if (rawLine.trim().length > 0) {
        preserved.push({ text: rawLine, line })
      }
      return
    }

    if (segments.length === 1) {
      // The common case: one command per line. Preserve the ORIGINAL raw
      // line (not the comment-stripped/trimmed segment) so formatting and
      // any trailing comment survive untouched when it turns out to be
      // unrecognized.
      const result = classifySegment(segments[0], line, comment)
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
        case 'alias':
          aliases.push(result.item)
          return
        case 'unrecognized':
          preserved.push({ text: rawLine, line })
          return
      }
    }

    // Multiple `;`-separated commands: classify each independently. A
    // segment that doesn't parse only loses its own piece of the line, not
    // the sibling commands that share it. The line has exactly ONE trailing
    // comment (it sits after every segment, not inside one), so the same
    // `comment` string is attached to every classified sibling rather than
    // split or duplicated as distinct fragments.
    for (const segment of segments) {
      const result = classifySegment(segment, line, comment)
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
        case 'alias':
          aliases.push(result.item)
          break
        case 'unrecognized':
          preserved.push({ text: segment.trim(), line })
          break
      }
    }
  })

  return { cvars, binds, execs, aliases, preserved, comments }
}
