/**
 * Layout primitives for the config-file writer (story 040 D2) — banners, per-section column
 * alignment, budget-aware comment attachment and comment sanitization. Pure, profile-agnostic:
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

export interface BannerOptions {
  /** Defaults to `'-'`. */
  fill?: BannerFill
  /** Total banner width, comment marker included. Defaults to `BANNER_WIDTH`. */
  width?: number
}

/** Default banner width in characters (the `//` marker included), matching the story's own sketch. */
export const BANNER_WIDTH = 80

/**
 * Renders a banner block, ASCII decoration only — the text of `lines` itself is the caller's
 * responsibility (see `sanitizeComment` for anything user-typed that ends up here, e.g. a profile
 * name).
 *
 * - `fill: '='` — a full-width rule (`// ====...`) above and below every entry in `lines`, each
 *   emitted as its own `//  <line>` comment. This is the file's header block: profile name plus the
 *   hand-edit sentence sit between two rules, exactly like the story's own sketch.
 * - `fill: '-'` (default) — one line per entry in `lines`, the title embedded in the fill itself:
 *   `// --- <line> ---...` padded with `-` out to `width`. This is a section banner.
 *
 * Never truncates or drops anything: a `line` longer than `width` still prints in full, just past
 * the nominal width — this function has no budget concept, unlike `attachComment`.
 */
export function banner(lines: string | string[], options: BannerOptions = {}): string[] {
  const width = options.width ?? BANNER_WIDTH
  const fill = options.fill ?? '-'
  const items = Array.isArray(lines) ? lines : [lines]

  if (fill === '=') {
    const rule = `// ${'='.repeat(Math.max(0, width - 3))}`
    return [rule, ...items.map((line) => `//  ${line}`), rule]
  }

  return items.map((line) => {
    const prefix = `// --- ${line} `
    return `${prefix}${'-'.repeat(Math.max(0, width - prefix.length))}`
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
 * Appends `comment` to `code` as a trailing `//` comment, kept inside `budget` (a latin1 byte
 * count, i.e. `string.length` — see `render.ts`'s own file doc comment for why that equivalence
 * holds). Truncate then drop, never wrap and never touch `code`: the command is the contract, the
 * comment is decoration, so when the two cannot both fit, the comment is what gives.
 *
 * - Fits whole: `<code>  // <comment>`.
 * - Does not fit whole, but `code` plus the bare `//` prefix still leaves room for at least one
 *   character of comment: the comment is truncated to exactly what fits.
 * - No room even for one character: `comment` is dropped entirely and `code` is returned verbatim.
 *
 * An empty `comment` is never attached at all — `code` alone is returned, so a caller does not have
 * to special-case "no comment" before calling this.
 */
export function attachComment(code: string, comment: string, budget: number): string {
  if (comment.length === 0) return code

  const prefix = `${code}  // `
  if (prefix.length >= budget) return code

  const available = budget - prefix.length
  return `${prefix}${comment.slice(0, available)}`
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
