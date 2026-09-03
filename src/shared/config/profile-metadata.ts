/**
 * Grammar for the `[q2l …]` metadata tag (story 042) — a versioned, machine-readable tail riding
 * inside the trailing `//` comment the config writer already attaches to a rendered line (story
 * 040). Pure string primitives only, same shape as `cfg-layout.ts`: no `ConfigProfile`, no cvar,
 * bind or alias knowledge, no imports outside this file. `render.ts` decides *which* fields a line
 * gets; `profile-restore.ts` decides what a parsed tag *means*; this file only knows the grammar
 * itself — how a tag is written and how one is read back, byte for byte, without ever throwing.
 *
 * ## Why one sigil, at the tail
 *
 * A `//` comment already carries a human-readable display name (story 040). Bolting metadata onto
 * the *same* comment — rather than a second comment, a header block or a side-channel file — is
 * what keeps a hand-edited file legible: a player who deletes everything from `[q2l` onward still
 * sees a normal, readable comment, and a player who never touches the tag still sees their own
 * display name first. Putting the tag at the very end (never the start, never interleaved with
 * prose) gives the parser one unambiguous anchor — it does not have to guess where prose stops,
 * it just looks for the last `[q2l` in the string.
 *
 * ## Grammar
 *
 * ```
 * // <prose> [q2l key1=value1 key2=value2 ...]
 * ```
 *
 * - `<prose>` is free text (the display name, or nothing).
 * - The tag is `[q2l`, then zero or more space-separated `key=value` pairs, then `]`, and nothing
 *   else may follow it on the line.
 * - A comment with no `[q2l` tail at all is just prose — every plain 040-era comment, and every
 *   foreign config's comment, parses that way.
 *
 * ## Key registry
 *
 * | key       | meaning                                                              |
 * | --------- | --------------------------------------------------------------------- |
 * | `v`       | format version (header block only) — see `META_FORMAT_VERSION`        |
 * | `cid`     | catalogue id (`catalogId`)                                             |
 * | `an`      | entry's own `aliasName` - anchor lines only (an alias line spells it)  |
 * | `key`     | that slot's key - anchor lines only (a bind line spells its own key)  |
 * | `mod`     | that slot's own `modifier` (`ActionKeySlot`)                            |
 * | `cat`     | category id (section header only)                                      |
 * | `layer`   | layer ref (section header only)                                        |
 * | `mode`    | layer mode (section header only)                                       |
 * | `trigger` | layer trigger key, omitted entirely when null (section header only)   |
 *
 * Story 050 dropped `e` (entry ref hash), `k` (entry kind) and `slot` (key slot index) from this
 * registry: all three duplicated information the config text or the profile model already carries
 * elsewhere, so a hand-written `e=...`/`k=...`/`slot=...` field is now just an unknown key — it
 * still round-trips (see below), it is simply no longer meaningful.
 *
 * `KNOWN_META_KEYS` lists these in the fixed order `formatMetaTag` always emits them in — that
 * order, not the registry table, is the contract a byte-level renderer test pins against. A key
 * outside this registry is never dropped: it round-trips into `fields` and is reported in
 * `unknownKeys`, because that is what lets a *newer* launcher version add a key without breaking an
 * *older* one — the older parser simply doesn't recognise it, and says so, instead of discarding it
 * or refusing the whole file.
 *
 * ## Version rule
 *
 * `v` lives once, in the header block's tag, never on a per-line tag. An unknown `v` (larger than
 * `META_FORMAT_VERSION`, i.e. the file was written by a newer launcher) is not fatal: every tag is
 * still parsed tag-by-tag, key-by-key, exactly as if `v` matched. Unknown keys within those tags are
 * ignored for reconstruction but reported, so the caller can tell the user "this file was written by
 * a newer version of the launcher" instead of failing the import outright.
 *
 * ## Escaping
 *
 * A tag *value* percent-escapes exactly four characters — space, `%`, `]`, `/` — as `%20`, `%25`,
 * `%5D`, `%2F`. Escaping `/` is what guarantees the tag text can never contain a literal `//`
 * substring (these lines already live inside a `//` comment; a second `//` inside a comment is used
 * elsewhere in this codebase as a command separator and must never appear here). Escaping `%` itself
 * is what makes the whole scheme reversible: because every literal `%` in a value is always escaped
 * to `%25`, a decoder only ever needs to recognise the four fixed two-hex escapes it produced —
 * anything else starting with `%` in a well-formed tag simply cannot occur, and if it does (a
 * hand-edited or foreign file), it is left alone rather than guessed at.
 *
 * A character above the latin-1 range (code point > `0xFF`) is dropped from a tag value outright,
 * matching `cfg-layout.ts`'s `sanitizeComment` policy: the writer encodes every rendered file as
 * latin-1, so a character that cannot survive that trip must never reach this module's output
 * either. CR/LF/tab are folded to a space before escaping, for the same reason `sanitizeComment`
 * folds them: any one of them left alone would cut the line early or reopen it as two.
 *
 * Prose is not tag content, so it is not percent-escaped — but a display name is user-typed, and a
 * player could type a literal `[q2l ...]` hoping to forge a tag (fake a category, claim a catalogue
 * id, etc). `neutralizeProse` closes that hole by rewriting every literal `[q2l` substring in prose
 * to `(q2l` before it is ever written to a file: the exact substring `parseMetaTag` looks for can no
 * longer occur in prose, so forged "tags" typed by a user always read back as inert text.
 */

/** Current metadata format version. Written once, into the header block's `v` field. Bump this
 * when the key registry gains a field whose *absence* must be distinguishable from "not present in
 * this version" — a key addition alone does not require a bump, since unknown keys already
 * round-trip and report themselves regardless of `v`. */
export const META_FORMAT_VERSION = 1

/** The tag's literal sigil. `parseMetaTag` anchors on the last occurrence of this exact substring;
 * `neutralizeProse` rewrites every occurrence of it in free text so prose can never be mistaken for
 * one. */
const SIGIL = '[q2l'

/** Every registered key, in the fixed order `formatMetaTag` always emits them — this order is part
 * of the format's determinism guarantee (two renders of the same fields always produce the same
 * string), not just documentation. A key not in this list is "unknown": still round-tripped, never
 * dropped, always reported. */
export const KNOWN_META_KEYS = [
  'v',
  'cid',
  // The entry's own `aliasName`, and - like `key` below - only ever emitted on an *anchor* line,
  // where no alias line exists to spell it out as code. An entry that keeps its alias line gets no
  // `an`: that line's own name IS the value (story 039), and a tag repeating it would be a second
  // source able to drift from the line the engine reads.
  'an',
  // `key` sits next to `mod` because it belongs to the same subject - one key slot of one entry -
  // and is only ever emitted where the config text itself cannot say it: an *anchor* line (a
  // comment-only line for a slot that has no `bind` line of its own, because its modifier lives in
  // a layer instead). A real `bind` line never carries it; the line already spells the key.
  'key',
  'mod',
  'cat',
  'layer',
  'mode',
  'trigger',
] as const

export type KnownMetaKey = (typeof KNOWN_META_KEYS)[number]

/** Fields a `[q2l …]` tag can carry. Every registered key is optional (a bind-line tag and a
 * section-header tag each populate a different subset), and any other string key is preserved too —
 * that is what makes an unrecognised key from a newer format version survive a round trip instead of
 * being silently dropped. */
export interface MetaTagFields {
  v?: string
  cid?: string
  an?: string
  key?: string
  mod?: string
  cat?: string
  layer?: string
  mode?: string
  trigger?: string
  [key: string]: string | undefined
}

export interface ParsedMetaTag {
  /** Everything before the tag (or the whole comment, when there is no tag). Never includes the
   * `[q2l …]` tail itself, and never throws-worthy: even a malformed tag still yields a best-effort
   * `prose` rather than an exception. */
  prose: string
  /** Every `key=value` pair the tag carried, decoded. Empty object when the comment carried no tag
   * at all, or when a malformed tag yielded nothing parseable. */
  fields: Record<string, string>
  /** Keys present in `fields` that are not in `KNOWN_META_KEYS` — reported, never dropped, so a
   * caller can tell a user "this file uses fields this version doesn't recognise" instead of the
   * fields simply vanishing. */
  unknownKeys: string[]
  /** `true` when a `[q2l` sigil was found but the tail could not be parsed as a well-formed tag
   * (missing closing `]`, trailing garbage after `]`, or a token that isn't `key=value`) — never
   * thrown, always reported. `false` — including when there is no tag at all. */
  malformed: boolean
}

const ESCAPE_CHARS: Record<string, string> = {
  ' ': '%20',
  '%': '%25',
  ']': '%5D',
  '/': '%2F',
}

/**
 * Percent-escapes the four characters that would otherwise be ambiguous inside a tag value — space
 * (a token separator), `%` (the escape marker itself), `]` (the tag's closing delimiter) and `/`
 * (which is what keeps the tag text free of a literal `//`). Escaping `%` first-class is what makes
 * this reversible: every literal `%` in the input becomes `%25`, so `unescapeMetaValue` never has to
 * guess whether a `%` it sees was already an escape or a literal character.
 *
 * CR/LF/tab are folded to a space before escaping (so they become `%20`, same as any other space) —
 * left alone, any one of them could cut the rendered line early or reopen it as two. A character
 * above the latin-1 range is dropped outright rather than mangled, matching `sanitizeComment`'s
 * policy in `cfg-layout.ts`: the writer emits latin-1 only, so a character that cannot survive that
 * trip must never reach this function's output.
 */
export function escapeMetaValue(value: string): string {
  let out = ''
  for (const ch of value) {
    if (ch === '\r' || ch === '\n' || ch === '\t') {
      out += '%20'
      continue
    }
    if (ch.charCodeAt(0) > 0xff) continue
    out += ESCAPE_CHARS[ch] ?? ch
  }
  return out
}

const RECOGNISED_ESCAPE_CODES = new Set([0x20, 0x25, 0x5d, 0x2f])

/**
 * Reverses `escapeMetaValue`, byte-identically for anything that function produced. Only the four
 * two-hex escapes `escapeMetaValue` can emit (`%20`, `%25`, `%5D`, `%2F`, case-insensitively) are
 * decoded; any other `%xx` sequence is left exactly as written, because a well-formed tag this
 * module wrote can never contain one — seeing one means the tag is hand-edited or foreign, and
 * guessing at it would risk mangling the very degradation path story 042 promises never to lose a
 * line over.
 */
export function unescapeMetaValue(value: string): string {
  return value.replace(/%([0-9A-Fa-f]{2})/g, (full, hex: string) => {
    const code = parseInt(hex, 16)
    return RECOGNISED_ESCAPE_CODES.has(code) ? String.fromCharCode(code) : full
  })
}

/**
 * Rewrites every literal occurrence of the tag sigil (`[q2l`) in free text to `(q2l`, so prose can
 * never be mistaken for a tag on a later read. This is the whole defence against a user typing
 * `SSG [q2l cat=weapons]` as a display name to forge a category — after this function runs, the
 * exact substring `parseMetaTag` anchors on no longer appears anywhere in the prose, so the forged
 * text reads back as inert decoration, not a tag.
 *
 * Deliberately not reversible: a user who genuinely wanted the literal text `[q2l` in a display name
 * loses that exact spelling once. That is the accepted cost of a single, unambiguous sigil — the
 * alternative (an escape sequence inside free prose) would make every hand-written comment in every
 * *foreign* config a candidate for accidental unescaping.
 */
export function neutralizeProse(prose: string): string {
  return prose.split(SIGIL).join('(q2l')
}

/**
 * Renders `fields` as a `[q2l key=value ...]` tag. Registered keys (`KNOWN_META_KEYS`) always come
 * first, in that fixed order; any other key present in `fields` is treated as forward-compatible
 * data from a caller that knows something this module's registry does not, and is appended after
 * them sorted alphabetically — sorted, not insertion order, because a plain object's insertion order
 * is not something a caller should have to manage just to get a deterministic render. Two calls with
 * the same fields (in any object-literal order) always produce the same string; that determinism is
 * what a byte-equality renderer test pins against.
 *
 * A field whose value is `undefined` is treated as absent. An empty `fields` still renders `[q2l]`
 * — the bare sigil with no pairs — never an empty string; a caller that wants no tag at all should
 * not call this function, not pass it emptiness.
 */
export function formatMetaTag(fields: Record<string, string | undefined>): string {
  const parts: string[] = []

  for (const key of KNOWN_META_KEYS) {
    const value = fields[key]
    if (value !== undefined) parts.push(`${key}=${escapeMetaValue(value)}`)
  }

  const unknownKeys = Object.keys(fields)
    .filter((key) => fields[key] !== undefined && !(KNOWN_META_KEYS as readonly string[]).includes(key))
    .sort()
  for (const key of unknownKeys) {
    parts.push(`${key}=${escapeMetaValue(fields[key]!)}`)
  }

  return parts.length > 0 ? `${SIGIL} ${parts.join(' ')}]` : `${SIGIL}]`
}

/**
 * Composes a full trailing comment from prose and fields: neutralises the prose (see
 * `neutralizeProse`), then appends `formatMetaTag(fields)` when `fields` carries at least one
 * defined value. With no fields at all, this returns the neutralised prose alone — no bare `[q2l]`
 * tag is ever emitted for a line that has nothing to say, so a plain 040-era comment with no
 * metadata renders exactly as it did before this story.
 *
 * A caller that *does* need the bare marker on a fieldless line - the launcher-owned entry lines,
 * where the tag's mere presence is the ownership signal - composes it the other way round, from
 * `formatMetaTag({})`: `render.ts#entryTag` returns that `[q2l]` and `cfg-layout.ts#fitProseAndTag`
 * joins it to the prose under the line's own byte budget, which this function knows nothing about.
 * D1 originally gave this function a `{ marker: true }` mode for that job; it never acquired a
 * caller (the writer needs the two halves separately, precisely so prose can give way to the tag
 * under budget pressure), and an option no production path exercises is a second, untested way to
 * spell the format - so the story-050 review took it back out.
 */
export function formatMetaComment(
  prose: string,
  fields: Record<string, string | undefined>,
): string {
  const safeProse = neutralizeProse(prose).replace(/\s+$/, '')
  const hasFields = Object.values(fields).some((value) => value !== undefined)
  if (!hasFields) return safeProse

  const tag = formatMetaTag(fields)
  return safeProse.length > 0 ? `${safeProse} ${tag}` : tag
}

/** Matches a well-formed tag tail: `[q2l`, then zero or more space-separated tokens containing
 * neither whitespace nor `]` (a value's own `]` is always escaped to `%5D`, so a raw `]` inside a
 * token never occurs in a well-formed tag), then `]`, then only trailing whitespace to end of
 * string. Anything that does not fit this shape — a missing `]`, trailing garbage after it, or a
 * token that later fails the `key=value` check — is a malformed tag, never a thrown exception. */
const TAG_TAIL_PATTERN = /^\[q2l((?:\s+[^\s\]]+)*)\s*\]\s*$/
const TOKEN_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/

/**
 * Splits a `//` comment's text (sigil and marker already stripped by the caller — this function
 * only ever sees the comment's *content*) into `prose` and a decoded `fields` map, defensively: it
 * never throws, no matter how badly a tag has been hand-edited or truncated.
 *
 * - No `[q2l` substring anywhere: the whole input is `prose`, `fields` is `{}`, `malformed` is
 *   `false`. This is the path every foreign config and every pre-042 comment takes.
 * - A `[q2l` is found (the *last* one, so a neutralised prose occurrence earlier in the string can
 *   never be mistaken for it) and the tail from there to the end of the string matches
 *   `TAG_TAIL_PATTERN`: `prose` is everything before it (trailing whitespace trimmed), and each
 *   `key=value` token is decoded into `fields`. A key outside `KNOWN_META_KEYS` still lands in
 *   `fields` and is additionally listed in `unknownKeys`.
 * - A `[q2l` is found but the tail does not match (no closing `]`, trailing text after it): the
 *   whole input is returned as `prose` (the best-effort choice — the caller's config line is not
 *   lost, only the tag's structure), `fields` is `{}`, `malformed` is `true`.
 * - A `[q2l` is found, the tail matches, but one or more tokens are not `key=value` (or the key
 *   contains characters outside `[A-Za-z][A-Za-z0-9]*`): those tokens are skipped, every other token
 *   still parses into `fields`, and `malformed` is `true` — a garbled token degrades that token
 *   alone, not the whole tag.
 */
export function parseMetaTag(commentText: string): ParsedMetaTag {
  const sigilIndex = commentText.lastIndexOf(SIGIL)
  if (sigilIndex === -1) {
    return { prose: commentText, fields: {}, unknownKeys: [], malformed: false }
  }

  const tail = commentText.slice(sigilIndex)
  const match = TAG_TAIL_PATTERN.exec(tail)
  if (!match) {
    return { prose: commentText, fields: {}, unknownKeys: [], malformed: true }
  }

  const prose = commentText.slice(0, sigilIndex).replace(/\s+$/, '')
  const body = (match[1] ?? '').trim()
  const tokens = body.length > 0 ? body.split(/\s+/) : []

  const fields: Record<string, string> = {}
  const unknownKeys: string[] = []
  let malformed = false

  for (const token of tokens) {
    const eq = token.indexOf('=')
    if (eq <= 0) {
      malformed = true
      continue
    }
    const key = token.slice(0, eq)
    if (!TOKEN_KEY_PATTERN.test(key)) {
      malformed = true
      continue
    }
    fields[key] = unescapeMetaValue(token.slice(eq + 1))
    if (!(KNOWN_META_KEYS as readonly string[]).includes(key)) unknownKeys.push(key)
  }

  return { prose, fields, unknownKeys, malformed }
}
