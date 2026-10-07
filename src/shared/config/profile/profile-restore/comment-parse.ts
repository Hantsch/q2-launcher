import { stripLineComment, tokenize } from '@shared/config/syntax/command-tokenizer'
import { parseMetaTag } from '@shared/config/profile/profile-metadata'
import { OWNERSHIP_MARKER } from '@shared/config/syntax/file-vocabulary'
import { STEP_ALIAS_PREFIX } from '@shared/config/aliases/switch-bind'
import type { RestoreCommentLine, Section } from './types'

export const SENTINEL_TEXT = OWNERSHIP_MARKER.replace(/^\/\/\s*/, '')

/** `banner()`'s `brackets` prefix/suffix (`//` stripped) - exact literals, so `bannerTitle` strips
 * only the writer's own decoration, never a title containing the same characters. */
export const BRACKETS_PREFIX = '----- [ '
export const BRACKETS_SUFFIX = ' ] -----'

/** `banner()`'s `dashes` prefix and its fill: one space, then `-` to the end of the string. */
export const DASHES_PREFIX = '--- '
export const DASHES_SUFFIX = / -+$/

/** A rule long enough to call a comment line a banner; three, so single hyphens in the sentinel are not decoration. */
export const BANNER_RULE = /-{3,}|={3,}/

/** Exactly `switch-bind.ts#stepAliasName`'s shape - a bare `startsWith` would swallow `q2l_sword`. */
export const STEP_ALIAS_NAME = new RegExp(`^${STEP_ALIAS_PREFIX}\\d+$`)

/** The title prefixes `render.ts` puts before a category name, stripped when read back or a custom
 * category would come back renamed (one named `Binds: x` loses that prefix once). */
export const TITLE_PREFIXES = ['Aliases: ', 'Binds: ', 'Entries: ']

/** The same prefixes as a regex over trimmed, tag-stripped text: nothing else the writer emits
 * starts that way, so it flags an untagged category header (`plain` has no `BANNER_RULE` decoration). */
export const CATEGORY_TITLE_PREFIX = new RegExp(
  `^(?:${TITLE_PREFIXES.map((p) => p.trim().slice(0, -1)).join('|')}): `,
)

/**
 * A parsed comment, tag and prose separated. A header keeps its tag inside the decoration
 * (`// --- Weapons [q2l cat=weapons] -----`), so that is cut here, not in `parseMetaTag`'s grammar.
 */
export interface ParsedComment {
  prose: string
  fields: Record<string, string>
  unknownKeys: string[]
  malformed: boolean
  tagged: boolean
  /**
   * Did `tagEndIndex` cut off a well-formed tag tail? Then `prose` never contains `banner()`'s fill,
   * so a title really ending in `<space>-+` cannot be told from fill and `bannerTitle` must not try.
   */
  tagSliced: boolean
}

/** The tag's sigil. Its presence is the only thing separating a launcher-written line from a raw
 * one, hence `render.ts#entryTag` never returns `''`. */
export const TAG_SIGIL = '[q2l'

/** Index just past a well-formed tag's `]`, or `-1` when no tag is followed by nothing but decoration. */
export function tagEndIndex(text: string): number {
  const sigil = text.lastIndexOf(TAG_SIGIL)
  if (sigil === -1) return -1
  const close = text.indexOf(']', sigil)
  if (close === -1) return -1
  return /^[\s\-=[\]]*$/.test(text.slice(close + 1)) ? close + 1 : -1
}

export function parseComment(text: string): ParsedComment {
  const end = tagEndIndex(text)
  const parsed = parseMetaTag(end === -1 ? text : text.slice(0, end))
  return { ...parsed, tagged: text.includes(TAG_SIGIL), tagSliced: end !== -1 }
}

/**
 * Is this comment-only line an anchor line (`render.ts#buildAnchorLines`)? Both scans consult it so
 * an anchor named `Strafe --- left` is never also minted as a banner (a bogus category, silently).
 *
 * `key` is the discriminator (a real `bind` spells its key as code). Any header field disqualifies
 * a line, even with a hand-edited `key`. Malformedness is not consulted: one garbled token among
 * good ones is still claimed by the entry scan.
 */
export function claimsEntryAnchor(parsed: ParsedComment): boolean {
  const key = parsed.fields.key
  if (key === undefined || key.trim().length === 0) return false
  return (
    parsed.fields.cat === undefined &&
    parsed.fields.layer === undefined &&
    parsed.fields.v === undefined &&
    taggedSubcategoryId(parsed.fields) === null &&
    taggedCvarSectionId(parsed.fields) === null &&
    taggedCvarSubsectionId(parsed.fields) === null
  )
}

/**
 * The sub-category id a tag states, or `null` for no `sub` field or an empty one. One reader so
 * `scanComments` and the `claims*` predicates agree on what a sub-category banner is; an empty
 * `[q2l sub=]` degrades to an untagged banner, like a deleted `sub=`.
 */
export function taggedSubcategoryId(fields: Record<string, string>): string | null {
  const id = (fields.sub ?? '').trim()
  return id.length > 0 ? id : null
}

export function taggedCvarSectionId(fields: Record<string, string>): string | null {
  const id = (fields.cvs ?? '').trim()
  return id.length > 0 ? id : null
}

export function taggedCvarSubsectionId(fields: Record<string, string>): string | null {
  const id = (fields.cvsub ?? '').trim()
  return id.length > 0 ? id : null
}

/**
 * The id a grouping record gets: the stated id when non-empty and not yet in `taken`, else a minted
 * one; recorded in `taken` either way. A hand-duplicated `[q2l sub=…]` is minted, not merged.
 * Mirrors `categoryRegistry#mintTemplate`.
 */
export function adoptableId(
  stated: string | null | undefined,
  taken: Set<string>,
  newId: () => string,
): string {
  const candidate = (stated ?? '').trim()
  const id = candidate.length > 0 && !taken.has(candidate) ? candidate : newId()
  taken.add(id)
  return id
}

/**
/**
 * Is `text` wrapped in a run of >=3 identical punctuation characters (`##### 1st row #####`) - a
 * foreign hand-typed marker? `key` is the character alone, so differing widths are one convention.
 * `-` and `=` are excluded: they are `BANNER_RULE`'s, and the writer's own banners would mint bogus sub-categories.
 */
export function decorationWrap(text: string): { key: string; title: string } | null {
  const match = /^([^A-Za-z0-9\s\-=])\1{2,}\s+(.+?)\s+\1{2,}$/.exec(text.trim())
  if (!match) return null
  const [, char, title] = match
  return { key: char!, title: title! }
}

/**
 * A comment-only line wrapped in a mirrored run of punctuation (`.: Main Key's :.`) as its bare
 * title, or `null`. Without it such a foreign header opens no section and the sub-markers under
 * it are orphaned (`heuristicSubcategoryParent` needs a preceding `'category'`/`'plain'`).
 *
 * Narrow, for safety on a launcher file: the trailing run must be the leading run reversed with
 * paired delimiters flipped, not a uniform run (`decorationWrap`'s), and without `-`, `=`, letters, digits.
 */
export const MIRROR_WRAP = /^([^\s\-=\p{L}\p{N}]{2,})\s+(.+?)\s+([^\s\-=\p{L}\p{N}]{2,})$/u

/** A title must contain a letter or digit in any script, or `.: :: :.` would mint a category `::`. */
export const MIRROR_TITLE_CONTENT = /[\p{L}\p{N}]/u

/** Delimiters that mirror into each other, so `<< X >>` is wrapped and `<< X <<` is not; all others mirror to themselves. */
export const MIRROR_PAIRS: Record<string, string> = {
  '<': '>',
  '>': '<',
  '[': ']',
  ']': '[',
  '(': ')',
  ')': '(',
  '{': '}',
  '}': '{',
}

export function mirroredWrapTitle(text: string): string | null {
  const match = MIRROR_WRAP.exec(text.trim())
  if (!match) return null
  const [, open, title, close] = match
  const mirrored = [...open!]
    .reverse()
    .map((char) => MIRROR_PAIRS[char] ?? char)
    .join('')
  if (close !== mirrored) return null
  if ([...open!].every((char) => char === open![0])) return null
  if (!MIRROR_TITLE_CONTENT.test(title!)) return null
  return title!.trim()
}

/**
 * The outer bracket-and-dash-fill layer a foreign author draws around a `mirroredWrapTitle` banner
 * with no `//` marker, e.g. `<<------ .: General Settings :. ------>>`. Same mirror-pair rule, with
 * a run of `-` allowed between delimiter and inner text. Yields the inner text, or `null`.
 */
export const FOREIGN_OUTER_WRAP =
  /^([^\s\-=\p{L}\p{N}]{1,})-*\s+(.+?)\s+-*([^\s\-=\p{L}\p{N}]{1,})$/u

export function peelForeignBracketWrap(text: string): string | null {
  const match = FOREIGN_OUTER_WRAP.exec(text)
  if (!match) return null
  const [, open, inner, close] = match
  const mirrored = [...open!]
    .reverse()
    .map((char) => MIRROR_PAIRS[char] ?? char)
    .join('')
  return close === mirrored ? inner! : null
}

/**
 * Does this raw `unrecognized` config line look like a foreign author's section banner, and what
 * comment text should `scanComments` judge it as (or `null`)? `import.ts#toRestoreInput` promotes
 * such lines to synthetic comment lines, since a banner with no comment marker would otherwise
 * never become a section boundary and its cvars would read back unplaced. It reuses the existing
 * shapes (`mirroredWrapTitle`, `decorationWrap`); a bare command, `wait` or `echo` matches none.
 */
export function foreignBannerCommentText(rawText: string): string | null {
  const trimmed = rawText.trim()
  if (trimmed.length === 0) return null
  const peeled = peelForeignBracketWrap(trimmed)
  if (peeled !== null && mirroredWrapTitle(peeled) !== null) return peeled
  if (mirroredWrapTitle(trimmed) !== null) return trimmed
  if (decorationWrap(trimmed) !== null) return trimmed
  return null
}

/**
/** Per file and decoration character, the count of untagged `decorationWrap` lines: a banner needs
 * the same decoration on two lines, or one stray comment would pass. Tagged lines are skipped. */
export function decorationCounts(comments: readonly RestoreCommentLine[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const comment of comments) {
    if (comment.text.includes(TAG_SIGIL)) continue
    const wrap = decorationWrap(comment.text)
    if (!wrap) continue
    const key = `${comment.file}:${wrap.key}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** The `'category'`/`'plain'` section a decoration-repeated sub-banner nests under, or `undefined`.
 * Depth stays two levels: the nearest such header, never a `'subcategory'`. */
export function heuristicSubcategoryParent(
  sections: readonly Section[],
  wrap: { key: string; title: string } | null,
  tally: ReadonlyMap<string, number>,
  file: string,
): Section | undefined {
  if (!wrap) return undefined
  const repeated = (tally.get(`${file}:${wrap.key}`) ?? 0) >= 2
  if (!repeated) return undefined
  return [...sections]
    .reverse()
    .find(
      (candidate) =>
        candidate.file === file && (candidate.kind === 'category' || candidate.kind === 'plain'),
    )
}

/**
 * The code half of an unbound line: a whole `bind` command commented out, with an argument
 * (`render.ts#unboundLine`; `bind ""` for no commands). Tested against the tag-stripped prose.
 */
export const UNBOUND_CODE = /^bind\s+\S/

/**
 * Is this comment-only line an unbound line (`render.ts#isUnboundEntry`)? The sibling of
 * `claimsEntryAnchor`; narrow for a foreign file:
 *
 * 1. The prose starts with `bind ` + an argument.
 * 2. A readable `[q2l` tag - the launcher-owned signal (`docs/systems/profile-file-format.md`),
 *    telling it from a hand-typed `// bind "+forward" - maybe later`.
 * 3. None of another shape's fields (`key`, `cat`/`layer`/`sub`, `v`): mutually exclusive with an anchor.
 */
export function claimsUnboundEntry(parsed: ParsedComment): boolean {
  if (!UNBOUND_CODE.test(parsed.prose.trim())) return false
  if (!parsed.tagged) return false
  if (parsed.malformed && Object.keys(parsed.fields).length === 0) return false
  return (
    (parsed.fields.key ?? '').trim().length === 0 &&
    parsed.fields.cat === undefined &&
    parsed.fields.layer === undefined &&
    parsed.fields.v === undefined &&
    taggedSubcategoryId(parsed.fields) === null &&
    taggedCvarSectionId(parsed.fields) === null &&
    taggedCvarSubsectionId(parsed.fields) === null
  )
}

/**
 * Is this comment-only line claimed by the entry scan, as anchor or unbound? The one call
 * `scanComments` makes, so a new shape cannot be forgotten there and mint a bogus category.
 */
export function claimedByEntryScan(parsed: ParsedComment): boolean {
  return claimsEntryAnchor(parsed) || claimsUnboundEntry(parsed)
}

/**
 * An unbound line split into the `bind` command's argument and the display prose of the trailing
 * comment. Uses the tokenizer primitives `config-parser.ts` uses for a real `bind`, so a `//`
 * inside a quoted command does not start the comment and `bind ""` is a real (empty) token.
 */
export function unboundLineParts(parsed: ParsedComment): { command: string; prose: string } {
  const code = stripLineComment(parsed.prose)
  const tokens = tokenize(code)
  return {
    // Everything after the `bind` verb; an unbound entry has no key token to skip.
    command: tokens.slice(1).join(' ').trim(),
    // `COMMENT_PREFIX`'s two spaces plus the `//` marker separate the halves.
    prose: code.length < parsed.prose.length ? parsed.prose.slice(code.length + 2).trim() : '',
  }
}

/** Pure `banner()` decoration - the header block's `=`-rule lines, so `BANNER_RULE` cannot misread one as a title. */
export const PURE_DECORATION = /^[\s\-=[\]]*$/

/**
 * A banner line's title: the prose with `banner()`'s own decoration and one `Aliases: `/`Binds: `
 * prefix off. Each of `banner()`'s three shapes is stripped by its fixed anchor only - stripping
 * any decoration-class run would eat the edge of a category named `Tier-1-` or `[Prototype]`.
 *
 * - `brackets`: the prefix and, for an untagged banner only, the suffix.
 * - `dashes`: the prefix and, only when `tagSliced` is `false`, a trailing `-` fill. A tagged
 *   banner's fill was already cut with the tag, so a real trailing `"Weapons -"` is not eroded.
 * - `plain`: only whitespace, unless the rest is pure decoration (the header block's `=` rule),
 *   which yields `''` for the caller's `title.length > 0` guard to reject.
 */
export function bannerTitle(prose: string, tagSliced: boolean): { title: string; block?: string } {
  const trimmedStart = prose.replace(/^\s+/, '')
  let bare: string
  if (trimmedStart.startsWith(BRACKETS_PREFIX)) {
    const rest = trimmedStart.slice(BRACKETS_PREFIX.length)
    // A tagged `rest` never legitimately ends in the suffix, so it is real title content.
    bare =
      !tagSliced && rest.endsWith(BRACKETS_SUFFIX)
        ? rest.slice(0, -BRACKETS_SUFFIX.length)
        : rest.trimEnd()
  } else if (trimmedStart.startsWith(DASHES_PREFIX)) {
    const rest = trimmedStart.slice(DASHES_PREFIX.length)
    const fill = tagSliced ? null : DASHES_SUFFIX.exec(rest)
    bare = fill ? rest.slice(0, fill.index) : rest.trimEnd()
  } else if (PURE_DECORATION.test(trimmedStart)) {
    bare = ''
  } else {
    bare = trimmedStart.trimEnd()
  }
  // The prefix names which per-category block the header belongs to (`Section.block`).
  const prefix = TITLE_PREFIXES.find((candidate) => bare.startsWith(candidate))
  return prefix ? { title: bare.slice(prefix.length), block: prefix } : { title: bare }
}
