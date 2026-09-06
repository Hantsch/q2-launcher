/**
 * Layout primitives for the config-file writer (story 040 D2, extended by story 042 D2) — banners,
 * per-section column alignment, budget-aware comment attachment (plain and, since 042, with a
 * machine-readable tail that outranks the prose) and comment sanitization. Pure, profile-agnostic:
 * this file knows nothing about `ConfigProfile`, cvars, binds or aliases — `render.ts` is the only
 * caller that gives these functions meaning, the same separation `alt-layers.ts` keeps between
 * "generate the alias pair" and "know it belongs to a profile".
 *
 * Every function here only ever emits or accepts latin1-range text; none of them look at encoding
 * themselves (same contract `render.ts`'s own file doc comment states) — the caller is responsible
 * for handing in text that already fits, and `sanitizeComment` is the one function in this file
 * whose entire job is enforcing that for user-typed text.
 */

/** Fill character a banner's rule/border is drawn with. `'-'` is the section-banner form (the
 * title sits inline in the fill, one line); `'='` is the header-block form (a full rule above and
 * below one or more plain content lines). Both are the only two ASCII decoration characters this
 * module ever emits — no em dashes, no box-drawing glyphs, same rule `sentinelLine` documents. */
export type BannerFill = '-' | '='

/**
 * Per-profile decorative style for a *section* banner (story 042 D7) - meaningless for
 * `fill: '='` (the file's one header block, which stays byte-identical to what D2 wrote
 * regardless of this setting; only category/cvar/layer section banners honour it).
 *
 * - `'dashes'` - today's only format, and the implicit default (`.catch('dashes')` in
 *   `main/lib/schemas.ts`): `// --- <line> ---...` padded with `-` out to `width`. Renders
 *   byte-identical to every banner this file emitted before this style existed.
 * - `'brackets'` - the User's literal sketch, `// ----- [ <line> ] -----`: a fixed five-dash
 *   rule on each side of a bracketed title, independent of `width`.
 * - `'plain'` - no decoration at all: a bare `// <line>`.
 *
 * All three carry the exact same `line` content - title and `[q2l ...]` tag alike, since that
 * text is composed by the caller (`render.ts`'s `titledSection`) before it ever reaches `banner()`
 * - only the ASCII dressing around it differs.
 */
export type SectionHeaderStyle = 'dashes' | 'brackets' | 'plain'

export interface BannerOptions {
  /** Defaults to `'-'`. */
  fill?: BannerFill
  /** Total banner width, comment marker included. Defaults to `BANNER_WIDTH`. Only consulted for
   * `style: 'dashes'` (or `fill: '='`) - `'brackets'` and `'plain'` have no notion of width. */
  width?: number
  /** Only consulted when `fill` is `'-'` (a section banner). Defaults to `'dashes'`. */
  style?: SectionHeaderStyle
}

/** Default banner width in characters (the `//` marker included), matching the story's own sketch. */
export const BANNER_WIDTH = 80

/**
 * Renders a banner block, ASCII decoration only — the text of `lines` itself is the caller's
 * responsibility (see `sanitizeComment` for anything user-typed that ends up here, e.g. a profile
 * name).
 *
 * - `fill: '='` — a full-width rule (`// ====...`) above and below every entry in `lines`, each
 *   emitted as its own `//  <line>` comment (`trimEnd()`ed, so a blank/whitespace-only entry never
 *   leaves a trailing-whitespace-only line). This is the file's header block: since story 051's D2
 *   removed the hand-edit sentence from the render path, `lines` is just the profile name sitting
 *   between two rules, exactly like the story's own sketch. `style` is not consulted here - the
 *   header block is not a section banner.
 * - `fill: '-'` (default) — one line per entry in `lines`, decorated per `options.style` (story
 *   042 D7, defaulting to `'dashes'`, today's only format). This is a section banner.
 *
 * Never truncates or drops anything: a `line` longer than `width` still prints in full, just past
 * the nominal width — this function has no budget concept, unlike `attachComment`.
 */
export function banner(lines: string | string[], options: BannerOptions = {}): string[] {
  const width = options.width ?? BANNER_WIDTH
  const fill = options.fill ?? '-'
  const style = options.style ?? 'dashes'
  const items = Array.isArray(lines) ? lines : [lines]

  if (fill === '=') {
    const rule = `// ${'='.repeat(Math.max(0, width - 3))}`
    // Trimmed for the same reason the `dashes` branch below trims its own decoration: an empty or
    // whitespace-only `line` (e.g. a blank profile name) would otherwise leave `//  ` - a line
    // whose only content is trailing whitespace. A non-empty `line` already ends in a non-space
    // character, so this is a no-op for every other caller.
    return [rule, ...items.map((line) => `//  ${line}`.trimEnd()), rule]
  }

  if (style === 'plain') return items.map((line) => `// ${line}`)

  if (style === 'brackets') return items.map((line) => `// ----- [ ${line} ] -----`)

  return items.map((line) => {
    const prefix = `// --- ${line} `
    const fill = '-'.repeat(Math.max(0, width - prefix.length))
    // A title that already fills `width` leaves no fill at all, and `prefix`'s own trailing space
    // would then be the last character on the line. Trimmed, for the same reason `renderRows`
    // trims a row whose comment was dropped: no line this writer emits ends in whitespace that
    // has nothing after it. Only decoration is affected - `line` itself still prints in full.
    return fill.length > 0 ? `${prefix}${fill}` : prefix.trimEnd()
  })
}

/**
 * Wraps `lines` in a `banner(title, options)` — unless `lines` is empty, in which case this
 * returns `[]` and emits nothing at all, banner included. This is what keeps an empty cvar group
 * (or, later, an empty alias category) from printing a banner over nothing: the caller builds every
 * section unconditionally and lets `section()` decide whether it survives into the file.
 */
export function section(title: string, lines: string[], options?: BannerOptions): string[] {
  if (lines.length === 0) return []
  return [...banner(title, options), ...lines]
}

export interface ColumnSpec {
  /** Spaces added after the column's longest cell, before the cap is checked. */
  margin: number
  /**
   * Hard cap on this column's resulting width (margin included). When the natural width (longest
   * cell + margin) would exceed `cap`, alignment for this column is abandoned entirely: every row
   * gets exactly one space of padding instead of being aligned to a shared (still-too-wide) column.
   * This is what stops one pathological entry (e.g. a absurdly long cvar name) from dragging an
   * entire section's alignment off screen — the decision the story's own "Decisions (Sprint)"
   * section spells out.
   */
  cap: number
}

/**
 * Pads each row's cells column-by-column so they line up — spaces only, never tabs (a tab-aligned
 * file re-renders differently in every editor, the reason this story exists at all).
 *
 * `columns[i]` describes column `i`'s alignment; a row's cells past `columns.length` are returned
 * unpadded (there is nothing to align them to — the last cell of a row typically has nothing
 * following it that needs a shared start column). Alignment is computed once per call, over every
 * row passed in — call this once per section, with only that section's rows, so "the value column"
 * means "the longest name in *this* section", never the whole file's.
 *
 * An empty `rows` returns `[]`; nothing else about this function has profile, cvar or bind
 * knowledge — it operates purely on strings.
 */
export function alignRows(rows: readonly (readonly string[])[], columns: readonly ColumnSpec[]): string[][] {
  if (rows.length === 0) return []

  const columnWidths = columns.map((spec, index) => {
    const longest = rows.reduce((max, row) => Math.max(max, (row[index] ?? '').length), 0)
    return longest + spec.margin
  })

  return rows.map((row) =>
    row.map((cell, index) => {
      const spec = columns[index]
      if (spec === undefined) return cell
      const width = columnWidths[index]!
      return width <= spec.cap ? cell.padEnd(width) : `${cell} `
    }),
  )
}

/**
 * Composes a comment body out of free `prose` and a machine-readable `tag` (story 042's
 * `[q2l …]` tail, rendered by `profile-metadata.ts` — this function only ever sees it as an
 * opaque string), no longer than `budget` characters.
 *
 * **The give-way order is the inverse of the tagless rule below**, and that inversion is the whole
 * point of this function. In story 040 the trailing comment was decoration, so it was the first
 * thing cut; since story 042 the tag carries *state* (which entry a line belongs to, which of its
 * two key slots it is, which layer it lives in) that nothing else in the file records, while the
 * prose is a display name the file can perfectly well be read without. So:
 *
 * 1. `<prose> <tag>` when both fit whole;
 * 2. otherwise the prose is truncated from its own end, keeping the tag intact, as long as at
 *    least one character of prose plus the separating space still fit;
 * 3. otherwise the prose is dropped entirely and the bare `tag` is returned;
 * 4. and only a `budget` that cannot hold even the bare tag gives up on the tag — falling back to
 *    the pre-042 rule (as much prose as fits, `''` when not even that), so that line degrades to
 *    what story 040 would have written for it. Unreachable through any real input (every user-typed
 *    name reaching a rendered line is clamped long before this point), which is exactly why it is
 *    handled here rather than asserted away: an unreachable branch that silently emitted a
 *    *truncated* tag would produce a malformed `[q2l` with no closing `]`, and a half tag is worse
 *    than no tag — `parseMetaTag` reports the whole comment as malformed and the metadata is lost
 *    either way, only louder.
 *
 * So the tag is always present in full or absent in full, never cut; and the result is never
 * longer than `budget`.
 *
 * With an empty `tag` this degrades exactly to `attachComment`'s pre-042 behaviour (truncate the
 * prose, then drop it), which is what keeps every untagged line in a rendered file byte-identical
 * to what story 040 wrote.
 */
export function fitProseAndTag(prose: string, tag: string, budget: number): string {
  if (budget <= 0) return ''
  // No tag, or no room for one: the pre-042 rule, as much prose as fits.
  if (tag.length === 0 || tag.length > budget) return prose.slice(0, budget)

  const whole = prose.length > 0 ? `${prose} ${tag}` : tag
  if (whole.length <= budget) return whole

  // One character short of the tag's own room is the separating space; anything left over is
  // prose. Trimmed at its new end so a cut landing mid-space cannot leave `name  [q2l …]`.
  const room = budget - tag.length - 1
  const truncated = room > 0 ? prose.slice(0, room).replace(/\s+$/, '') : ''
  return truncated.length > 0 ? `${truncated} ${tag}` : tag
}

/**
 * Appends a `prose`+`tag` comment to `code` as a trailing `//` comment, kept inside `budget` (a
 * latin1 byte count, i.e. `string.length` — see `render.ts`'s own file doc comment for why that
 * equivalence holds). Never wraps and never touches `code`: the command is the contract, so when
 * command and comment cannot both fit, the comment is what gives — see `fitProseAndTag` for the
 * order in which its two halves do.
 *
 * The comment is dropped whole (and `code` returned verbatim) when `code` plus the bare `//`
 * prefix already fills the budget, or when `fitProseAndTag` cannot fit anything at all — so a
 * `code` too long to carry a comment is never itself cut to make room for one.
 */
export function attachTaggedComment(
  code: string,
  prose: string,
  tag: string,
  budget: number,
): string {
  const prefix = `${code}  // `
  if (prefix.length >= budget) return code

  const body = fitProseAndTag(prose, tag, budget - prefix.length)
  return body.length === 0 ? code : `${prefix}${body}`
}

/**
 * Appends `comment` to `code` as a trailing `//` comment, kept inside `budget`. Truncate then
 * drop: the tagless (pre-story-042) form of `attachTaggedComment`, kept as its own named entry
 * point for every caller that has only prose to attach.
 *
 * - Fits whole: `<code>  // <comment>`.
 * - Does not fit whole, but `code` plus the bare `//` prefix still leaves room for at least one
 *   character of comment: the comment is truncated to exactly what fits.
 * - No room even for one character: `comment` is dropped entirely and `code` is returned verbatim.
 *
 * An empty `comment` is never attached at all — `code` alone is returned, so a caller does not have
 * to special-case "no comment" before calling this.
 *
 * `render.ts` routes every row through `attachTaggedComment` since story 042 D2 (an untagged row
 * passes `tag: ''` and lands on exactly this rule), so this is the primitive's untagged form rather
 * than a second implementation: it names the pre-042 contract that `fitProseAndTag` still falls
 * back to, and is the entry point for a caller that has only prose.
 */
export function attachComment(code: string, comment: string, budget: number): string {
  return attachTaggedComment(code, comment, '', budget)
}

/**
 * Makes `text` safe to place as a trailing `//` comment or inside a banner line: CR/LF/tab each
 * become a single space (any one of them left alone would either cut the line early or reopen it
 * as two), and any character outside the latin1 range (code point above `0xFF`) is dropped outright
 * rather than mangled — the writer encodes every rendered file as latin1, so a character that
 * cannot survive that trip must never reach this file's output at all.
 *
 * Does not trim or collapse repeated spaces: a comment that already reads oddly because of it is
 * still the user's own text, faithfully kept — this function's only job is the round-trip, not
 * tidiness.
 */
export function sanitizeComment(text: string): string {
  let out = ''
  for (const ch of text) {
    if (ch === '\r' || ch === '\n' || ch === '\t') {
      out += ' '
      continue
    }
    if (ch.charCodeAt(0) <= 0xff) out += ch
  }
  return out
}
