import { stripLineComment, tokenize } from '@shared/config/syntax/command-tokenizer'
import { parseMetaTag } from '@shared/config/profile/profile-metadata'
import { OWNERSHIP_MARKER } from '@shared/config/syntax/file-vocabulary'
import { STEP_ALIAS_PREFIX } from '@shared/config/aliases/switch-bind'
import type { RestoreCommentLine, Section } from './types'

/** The sentinel's text as the parser hands it over, i.e. `OWNERSHIP_MARKER` with the `//` marker
 * stripped. Derived from that constant rather than restated, so the two can never drift. */
export const SENTINEL_TEXT = OWNERSHIP_MARKER.replace(/^\/\/\s*/, '')

/** `banner()`'s `brackets`-style fixed prefix/suffix (`cfg-layout.ts`'s `// ----- [ <line> ] -----`,
 * `//` already stripped) - exact literal anchors, not a character class, so `bannerTitle` strips
 * only `banner()`'s own decoration and never a title that happens to contain the same characters. */
export const BRACKETS_PREFIX = '----- [ '
export const BRACKETS_SUFFIX = ' ] -----'

/** `banner()`'s `dashes`-style fixed prefix (`// --- <line> ----...`, `//` already stripped) and its
 * variable-length fill: a single space then a run of `-` to the end of the string - the only shape
 * `banner()`'s dashes branch ever produces after that prefix. */
export const DASHES_PREFIX = '--- '
export const DASHES_SUFFIX = / -+$/

/** A run of rule characters long enough to call a comment line a banner. Three, so the single
 * hyphens in the sentinel and the hand-edit sentence are not mistaken for decoration. */
export const BANNER_RULE = /-{3,}|={3,}/

/** Exactly what `switch-bind.ts#stepAliasName` generates (`STEP_ALIAS_PREFIX` then one or more
 * digits, nothing else) - not a bare `startsWith`, which would also swallow a hand-added alias that
 * merely starts with the same prefix (e.g. `q2l_sword`). */
export const STEP_ALIAS_NAME = new RegExp(`^${STEP_ALIAS_PREFIX}\\d+$`)

/** The three title prefixes `render.ts` puts in front of a category name (`Aliases: Weapons`,
 * `Binds: Weapons`, `Entries: Weapons`). Stripped when a title is read back as a category name, or a
 * custom category would come back renamed - and the round-trip would stop being a fixed point. A
 * category the user really did name `Binds: x` loses that prefix once; the alternative is every
 * restored custom category gaining one. */
export const TITLE_PREFIXES = ['Aliases: ', 'Binds: ', 'Entries: ']

/** Same three prefixes as `TITLE_PREFIXES`, as a regex anchored at the start of the (trimmed, tag
 * already stripped) comment text. `render.ts#buildAliasSections`/`buildBindSections`/
 * `buildAnchorSections` put exactly one of these in front of *every* category section's title,
 * unconditionally - the "Other" bucket included (`"Aliases: Other"`) - regardless of whether the
 * section still carries a `cat=` tag. That makes it a safe, narrow signal for "this untagged line is
 * a real category section header whose tag is gone, not some other kind of comment": nothing else
 * this writer emits (a cvar group's plain label, the hand-edit sentence, a layer's `Layer: ` title)
 * starts with one of these three words followed by a colon and a space. See its one call site below
 * for what this closes: `plain` header style has no decoration `BANNER_RULE` could otherwise match,
 * so without this a hand-deleted `cat=` tag left a real category invisible as a section boundary
 * under that style specifically. */
export const CATEGORY_TITLE_PREFIX = new RegExp(
  `^(?:${TITLE_PREFIXES.map((p) => p.trim().slice(0, -1)).join('|')}): `,
)

/**
 * A parsed comment, tag and prose separated, tolerant of a *banner*'s trailing decoration.
 *
 * `parseMetaTag`'s grammar (D1) ends a tag at the end of the string: nothing may follow the `]`.
 * That holds for a trailing code-line comment, and deliberately not for a section header, where the
 * writer puts the tag *inside* the decoration (`// --- Weapons [q2l cat=weapons] -----`, the
 * story's own sketch). So the trailing decoration is cut off before the grammar sees the line -
 * here, in the layer that knows what a banner is, rather than by widening the grammar for every
 * caller.
 */
export interface ParsedComment {
  /** Everything before the tag: the display name, or a banner's title. */
  prose: string
  fields: Record<string, string>
  unknownKeys: string[]
  malformed: boolean
  /** Did the line carry a `[q2l` at all (well-formed or not)? */
  tagged: boolean
  /** Did `tagEndIndex` actually find and cut off a well-formed tag tail (`[q2l …]` followed by
   * nothing but decoration)? `bannerTitle` needs this,
   * distinct from `tagged`: when this is `true`, `prose` never contains `banner()`'s trailing fill -
   * it was sliced away *before* `parseMetaTag` ever saw it - so a title ending in its own real
   * `<space>-+` cannot be told apart from stripped fill, and `bannerTitle` must not try. When
   * `tagged` is `true` but this is `false` (a `[q2l` present but too malformed for `tagEndIndex` to
   * find a clean tail), `prose` is the *whole* raw text and may still carry real fill, same as an
   * untagged banner. */
  tagSliced: boolean
}

/**
 * The tag's literal sigil, exactly the substring `parseMetaTag` anchors on.
 *
 * The *presence* of this substring in a code line's trailing comment is
 * the only thing left that distinguishes a launcher-written `bind`/`alias` line from a raw one the
 * user typed and commented themselves - which is why `render.ts#entryTag` never returns `''` and
 * gives a fieldless entry line the bare `[q2l]` marker. `groupEntryLines` tests for it directly.
 */
export const TAG_SIGIL = '[q2l'

/** Index just past a well-formed tag's `]`, or `-1` when the text carries no tag whose tail is
 * followed by nothing but decoration. */
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
 * Is this comment-only line claimed by the *entry* scan - i.e. is it an anchor line
 * (`render.ts#buildAnchorLines`), or any other tagged line kind that names an entry?
 *
 * The one predicate both scans over the comment lines consult, because they must agree: a line the
 * anchor scan in `groupEntryLines` takes as an entry anchor must never *also* be read as a section
 * header by `scanComments`. It could, before this was factored out - the banner test only looked at
 * the line's prose, so an anchor whose display name happened to contain three consecutive `-` or `=`
 * characters (`Strafe --- left`, a name nothing stops a user typing) was read as an untagged banner
 * as well: it minted a bogus category named after that prose and re-filed every line below it in the
 * same section under it, with no warning and no way for a fixed-point test on the rendered text to
 * notice, since the second render is a valid file - just a different profile.
 *
 * the discriminator is the `key` field, which replaced `e` here. Only an anchor line
 * ever carries `key` - a real `bind` line spells its key as code and never gets one
 * (`render.ts#entryTag`) - so it is exactly as narrow a signal as `e` was, without the ref. A
 * `cat`/`layer`/`v` field is what makes a tagged line a *header* rather than an entry line, so a
 * line carrying one is not claimed here even if someone hand-edited a `key` into it. Malformedness
 * is deliberately not consulted: `parseMetaTag` yields `fields: {}` for a tag it could not parse at
 * all (so `key` is absent and this returns `false` anyway), and for a tag with one garbled token
 * among good ones the entry scan does claim the line - this predicate has to say the same thing it
 * does.
 */
export function claimsEntryAnchor(parsed: ParsedComment): boolean {
  const key = parsed.fields.key
  if (key === undefined || key.trim().length === 0) return false
  return (
    parsed.fields.cat === undefined &&
    parsed.fields.layer === undefined &&
    parsed.fields.v === undefined &&
    taggedSubcategoryId(parsed.fields) === null &&
    // `cvs`/`cvsub` join the header marker fields for the same reason `sub` did - a
    // cvar section banner is a header, and a hand-edited `key=` next to one must not let this
    // predicate and `scanComments` disagree about what the line is.
    taggedCvarSectionId(parsed.fields) === null &&
    taggedCvarSubsectionId(parsed.fields) === null
  )
}

/**
 * The sub-category id a `[q2l …]` tag states, or `null` for a tag that carries no
 * `sub` field or carries an empty one.
 *
 * One reader for the field rather than three `fields.sub` reads, because the three places that
 * consult it must agree about what "this line is a sub-category banner" means: `scanComments`, which
 * opens the section, and `claimsEntryAnchor`/`claimsUnboundEntry`, which must *not* claim such a line
 * for an entry (`claimedByEntryScan`'s own doc comment - a line one scan claims and the other reads
 * as a header re-files everything below it). `sub` joins `cat`/`layer`/`v` in both predicates for
 * exactly that reason: it is a *header* marker field, and a hand-edited `key=` or `bind …` prose
 * next to it must not turn a banner into an entry.
 *
 * An empty value (`[q2l sub=]`, only reachable by hand-editing) is not an id, so it opens no
 * sub-category section - the line falls through to the ordinary untagged-banner path instead, which
 * is the same "degrade to what the line still says" direction a hand-deleted `sub=` takes.
 */
export function taggedSubcategoryId(fields: Record<string, string>): string | null {
  const id = (fields.sub ?? '').trim()
  return id.length > 0 ? id : null
}

/**
 * The cvar-section id a `[q2l …]` tag states, or `null` for a tag carrying no `cvs`
 * field or an empty one - `taggedSubcategoryId`'s counterpart for the Settings tab's own grouping,
 * with the identical "an empty value is not an id, so the line degrades to an untagged banner"
 * rule.
 */
export function taggedCvarSectionId(fields: Record<string, string>): string | null {
  const id = (fields.cvs ?? '').trim()
  return id.length > 0 ? id : null
}

/** The cvar-sub-section id a `[q2l …]` tag states - `cvsub`, the second level's own
 * field, read exactly like `cvs` above. */
export function taggedCvarSubsectionId(fields: Record<string, string>): string | null {
  const id = (fields.cvsub ?? '').trim()
  return id.length > 0 ? id : null
}

/**
 * The id a grouping record gets: the id the file states, when it is non-empty and
 * no record of the same registry has taken it in this restore, else a freshly minted one. Either way
 * the result is recorded in `taken`, so a later banner stating an id this restore already handed
 * out - a hand-duplicated `[q2l sub=…]` tag, say - is minted rather than merged into a record it does
 * not belong to. Mirrors `categoryRegistry#mintTemplate`, which has always kept a template id
 * verbatim for the same reason: an id the file states is the id the next render must write back.
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
 * Is `comment.text` symmetrically wrapped in a run of >=3 identical punctuation characters
 * (`##### 1st row #####`, `*** Setup ***`, `~~~ Extras ~~~`) - the shape a foreign author's own
 * hand-typed second-level marker takes, with no `[q2l …]` tag to say so?
 *
 * `key` is the decoration *character* alone, not its run length: `##### Row A #####` and
 * `### Row B ###` are the same author's same decoration typed at two different widths, and treating
 * them as different keys would defeat the "occurs on at least two lines" gate below for exactly the
 * files it exists for. Not restricted to `#`: real Quake II config collections use `*`, `~`, `./`,
 * `_` and others just as often, so the character class is "any punctuation", not a fixed set - except
 * `-` and `=`, excluded on purpose: those are `BANNER_RULE`'s own two characters, and *this* writer's
 * own dashes/brackets banners (`cfg-layout.ts#banner`) are themselves symmetric dash-wrapped text
 * (`--- Weapons ----------`, `----- [ Weapons ] -----`) - matching them here would let this writer's
 * own, already-recognised category and cvar-group banners count toward "repeated decoration" and
 * mint bogus sub-categories out of an ordinary launcher file. A foreign author's own decoration is
 * never this writer's `-`/`=`, so excluding them costs the heuristic nothing it is meant to catch.
 */
export function decorationWrap(text: string): { key: string; title: string } | null {
  const match = /^([^A-Za-z0-9\s\-=])\1{2,}\s+(.+?)\s+\1{2,}$/.exec(text.trim())
  if (!match) return null
  const [, char, title] = match
  return { key: char!, title: title! }
}

/**
 * A comment-only line wrapped in a **mirrored** run of punctuation - `.: Main Key's :.`,
 * `<< Setup >>`, `|: Extras :|` - as its bare title, or `null` for a line that is not shaped that
 * way. The *top-level* companion to `decorationWrap` below (story 053 D4).
 *
 * Why this exists at all: a foreign file's own top-level header decides whether the second level can
 * be read at all, because `heuristicSubcategoryParent` only attaches a repeated-decoration sub-marker
 * to a `'category'`/`'plain'` section that already precedes it. Without it, the only untagged line
 * that opens such a section is one carrying this writer's *own* decoration (`BANNER_RULE`'s `-`/`=`
 * runs) or one of its three fixed title prefixes (`CATEGORY_TITLE_PREFIX`) - so a header like
 * `.: Main Key's :.` (`dm.cfg`'s own) would open no section, and the `##### 1st row #####`
 * markers under it would be orphaned and contribute nothing. This is deliberately a *recognition* rule
 * only: the line opens an ordinary untagged `'plain'` section like any other foreign banner, and
 * nothing here fuses two banners into a `Main / Sub` name.
 *
 * Three conditions keep the shape narrow enough to be safe on a launcher-written file:
 *
 * 1. **Mirrored, not merely symmetric.** The trailing run must be the leading run read backwards,
 *    with paired delimiters flipped (`<<` ↔ `>>`, `[:` ↔ `:]`) - the property a hand-drawn wrap has
 *    and an ordinary sentence does not, which is what keeps a comment whose first and last words
 *    happen to be non-Latin script (letters and digits of *every* script are excluded from the
 *    decoration class for this reason) from being read as a header.
 * 2. **Not a uniform run of one character.** `##### 1st row #####` is `decorationWrap`'s shape, and
 *    it stays exclusively `decorationWrap`'s: that shape is only ever a section marker when it
 *    *recurs* (the story's own "repeated" gate, and the reason a single stray `##### note #####`
 *    mints nothing). A mirrored run of two *different* punctuation characters is a deliberately typed
 *    matched pair, so it does not need a second occurrence to vouch for it.
 * 3. **`-` and `=` excluded**, exactly as in `decorationWrap` and for the same reason: those are this
 *    writer's own banner characters (`BANNER_RULE`, `cfg-layout.ts#banner`), already recognised by
 *    the branch this one sits in, and matching them here would give a second, competing answer for a
 *    line that already has one.
 */
export const MIRROR_WRAP = /^([^\s\-=\p{L}\p{N}]{2,})\s+(.+?)\s+([^\s\-=\p{L}\p{N}]{2,})$/u

/** A title has to say *something*: at least one letter or digit, in any script. Without this,
 * `.: :: :.` would mint a category literally named `::`. */
export const MIRROR_TITLE_CONTENT = /[\p{L}\p{N}]/u

/** The paired delimiters that mirror into each other rather than into themselves, so `<< X >>` reads
 * as wrapped and `<< X <<` does not. Every other punctuation character mirrors to itself. */
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
 * The outer bracket-and-dash-fill layer a foreign author sometimes draws around their own
 * `mirroredWrapTitle`-shaped banner, with no `//` marker anywhere on the line at all -
 * `dm.cfg`'s own convention: `<<--------------------------- .: General Settings :. ----------------
 * ------------>>`. `config-parser.ts` classifies a line like this as `unrecognized`, never as a
 * comment, since nothing on it ever starts with `//`; `foreignBannerCommentText` below is what lets
 * such a line reach `scanComments` at all, and this is the layer that sits *outside* the
 * `.: … :.`-shaped title `mirroredWrapTitle` already knows how to read.
 *
 * The same mirror-pair rule as `mirroredWrapTitle` (open/close delimiters must be genuine mirrors of
 * each other, via `MIRROR_PAIRS`), with a run of `-` allowed - and only `-` - between the delimiter
 * and the inner text on each side: that is the one character this writer's own decoration
 * (`BANNER_RULE`) also uses, and it is exactly the fill a foreign author draws to pad a banner out to
 * a fixed width. Returns the inner text unchanged (decoration and delimiters stripped, whitespace
 * still surrounding it), or `null` for a line that is not wrapped this way at all - the caller still
 * has to decide whether what's left is itself a recognisable title.
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
 * Does this raw, **unrecognized** config line look like a foreign author's own
 * section banner?
 *
 * `scanComments` only ever looks at `RestoreProfilePartsInput.comments`, so a banner drawn with no
 * comment marker at all - `dm.cfg`'s own `<<--- .: General Settings :. --->>` and
 * `      ########## 1st Block ########` conventions - would otherwise never become a section
 * boundary, and every cvar (or bind) under it would read back unplaced instead of filed under the
 * name the file itself gives it. This is the recognizer `import.ts#toRestoreInput` calls to decide
 * which of a foreign file's `unrecognized` lines are worth promoting into a synthetic comment line
 * for `scanComments` to judge on the exact same terms as a real one - never a second, parallel
 * section-boundary mechanism: `scanComments` still owns "is this a banner", `cvarSectionRegistry`
 * still owns "what cvars belong to it".
 *
 * Recognised through the *same* shapes any other untagged banner already is - `mirroredWrapTitle`
 * (`.: Main Key's :.`, with `peelForeignBracketWrap`'s outer layer stripped first when the line
 * carries one) and `decorationWrap` (`##### 1st row #####`, which needs no peeling - it already
 * matches on the raw, un-commented text directly) - so nothing here invents a fourth banner shape;
 * it only widens *where* the first three are allowed to look. A bare command, a `wait`, an `echo` -
 * the overwhelming majority of a foreign file's own `unrecognized` lines - matches none of them and
 * is correctly left alone.
 *
 * Returns the text `scanComments` should treat as this line's comment (marker-already-stripped) text,
 * or `null` for a line this does not recognise at all.
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
 * How many comment-only lines, per file and per decoration character, are wrapped the way
 * `decorationWrap` recognises - the "repeated" half of the repeated-decoration heuristic: "a comment-
 * only line whose text is symmetrically wrapped in a run of >=3 identical punctuation characters
 * counts as a banner only if that same decoration occurs on at least two lines of the imported file"
 * (the story's own words). One stray hand-typed decorated comment - the single-occurrence case - is
 * exactly what this count is for telling apart from a real, repeated section-marker convention.
 *
 * Scoped to *untagged* lines only (`TAG_SIGIL` absent): a launcher-written file's own tagged category
 * banners routinely reuse this writer's dashes/equals decoration too, and counting those in would let
 * an unrelated real category header vouch for a single stray foreign-looking comment elsewhere in a
 * mixed file. Scoped per file for the same reason `sectionFor`/`categoryKeyFor`'s parent search is:
 * two files handed to one restore (`config.cfg` + `autoexec.cfg`) are unrelated documents, and a
 * decoration repeating across both would say nothing true about either one.
 */
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

/**
 * The category-shaped section a heuristically-detected sub-banner should nest under, or `undefined`
 * when this line does not qualify at all (not decorated, its decoration is not repeated, or nothing
 * category-shaped precedes it in this file).
 *
 * "Category-shaped" is deliberately `'category'` *or* `'plain'` - a real tagged category and a
 * foreign file's own untagged banner (`.: Main Key's :.`, recognised the ordinary way by
 * `mirroredWrapTitle`/`BANNER_RULE`/`CATEGORY_TITLE_PREFIX` before this function ever runs) both
 * count, because a foreign
 * file's own top-level header is never going to carry a `cat=` tag either. Depth stays exactly two
 * levels (the story's own Decisions): the nearest preceding header of *either* shape is taken, never
 * a preceding `'subcategory'`, so a run of several decorated banners under one top-level header nest
 * as flat siblings rather than a chain this reader would otherwise invent.
 */
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
 * (`render.ts#unboundLine` writes `bind "<cmd>"`, and `<cmd>` is `""` for an entry with no commands
 * at all - both spellings start `bind ` and both carry a token after it). Tested against the
 * *prose* half of a parsed comment, i.e. the text with the `[q2l …]` tail already cut off.
 */
export const UNBOUND_CODE = /^bind\s+\S/

/**
 * Is this comment-only line an **unbound line** - the commented-out `bind` the
 * writer gives an entry that would otherwise leave no trace in the file at all
 * (`render.ts#isUnboundEntry`: a plain `bind`/`message` entry with no key slot, no bind line and no
 * alias line)?
 *
 * The sibling of `claimsEntryAnchor`, and deliberately shaped like it: a comment-only line the entry
 * scan claims must never *also* be read as a section header by `scanComments` (an unbound line's
 * prose is a user-typed display name and may contain `---`, which `BANNER_RULE` would otherwise
 * take for decoration - the very defect `claimsEntryAnchor`'s own doc comment describes), so both
 * scans consult this one predicate. `claimedByEntryScan` below is what makes that hard to get wrong.
 *
 * Three conditions, and the *combination* is what makes the signal narrow enough to be safe on a
 * foreign file:
 *
 * 1. **The comment text starts with `bind ` + an argument** (the story's own decision on the
 *    discriminator). Read off the prose, so the trailing `// <name> [q2l …]` the line also carries
 *    is not part of the test.
 * 2. **A `[q2l` tag is present and readable.** Tag presence is the whole launcher-owned signal
 *    (see "The marker tag" in `docs/systems/profile-file-format.md`), and it
 *    is what tells this line from a player's own hand-typed `// bind "+forward" - maybe later`,
 *    which is otherwise indistinguishable from it. "Readable" is `readTag`'s own rule for a code
 *    line, restated here because an unbound line *is* a code line, just a commented-out one: a tag
 *    with one garbled token among good ones still identifies the line, a tag nothing at all can be
 *    read out of does not.
 * 3. **None of the marker fields another tagged shape carries** - `key` (an anchor line), `cat`/
 *    `layer`/`sub` (a section header), `v` (the header block). This is how an unbound line is told apart
 *    from every other tagged comment *without* inventing a marker field of its own, and it makes
 *    this predicate and `claimsEntryAnchor` mutually exclusive by construction: an anchor needs a
 *    non-empty `key`, this needs the absence of one.
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
    // Same addition, same reason, as in `claimsEntryAnchor` above (story 059 D3).
    taggedCvarSectionId(parsed.fields) === null &&
    taggedCvarSubsectionId(parsed.fields) === null
  )
}

/**
 * Is this comment-only line claimed by the entry scan in *any* of its shapes - an anchor line or an
 * unbound line?
 *
 * The one call `scanComments` makes, so a shape added to the entry scan can never be forgotten in
 * the header scan: the two passes have to agree about every line, or a line the entries claim is
 * *also* minted as a section (a bogus category named after a display name, re-filing every line
 * below it) - `claimsEntryAnchor`'s doc comment describes what that cost the first time.
 */
export function claimedByEntryScan(parsed: ParsedComment): boolean {
  return claimsEntryAnchor(parsed) || claimsUnboundEntry(parsed)
}

/**
 * An unbound line split back into the two halves the writer composed it from: the `bind` command's
 * own argument, and the display prose of the trailing comment `attachTaggedComment` put after it.
 *
 * Read with the *same* tokenizer primitives `config-parser.ts` reads a real `bind` line with
 * (`stripLineComment`, then `tokenize`), because that is exactly what this line is - a config line
 * that happens to be commented out. Doing it by hand instead would have to re-derive the two rules
 * that matter here and could get either wrong: a `//` inside a quoted command (`say "see
 * http://…"`) is not the start of the display comment, and an empty argument (`bind ""`) is a real,
 * meaningful token rather than a missing one - `//bind ""` round-trips as "this entry genuinely has
 * no commands", which is most of what `STANDARD_TEMPLATE` seeds.
 *
 * `parsed.prose` is the input rather than the raw text, so the `[q2l …]` tail is already gone and
 * cannot be mistaken for part of the display name.
 */
export function unboundLineParts(parsed: ParsedComment): { command: string; prose: string } {
  const code = stripLineComment(parsed.prose)
  const tokens = tokenize(code)
  return {
    // Everything after the `bind` verb. No key token to skip, unlike `config-parser.ts`'s own
    // `bind <key> <command>`: an unbound entry has no key at all - that is what makes it unbound.
    command: tokens.slice(1).join(' ').trim(),
    // `COMMENT_PREFIX`'s two spaces plus the `//` marker sit between the two halves; the marker is
    // where `stripLineComment` stopped, so the prose starts two characters later - the same slice
    // `config-parser.ts` takes for a real line's trailing comment.
    prose: code.length < parsed.prose.length ? parsed.prose.slice(code.length + 2).trim() : '',
  }
}

/** Pure `banner()` decoration and nothing else - the header block's own `=`-rule lines
 * (`buildHeaderBlock`), post-`//`-strip. Used only to recognise (and zero out) a rule line that
 * `BANNER_RULE` would otherwise misread as an untagged section title with real content. */
export const PURE_DECORATION = /^[\s\-=[\]]*$/

/**
 * A banner line's title: the prose with `banner()`'s own decoration and one `Aliases: `/`Binds: `
 * prefix off.
 *
 * Not "strip any run of decoration-class characters" (`-`, `=`, `[`, `]`, whitespace): that is not
 * the inverse of what `banner()`/`titledSection` write, and would eat the real, user-typed edge of
 * a category named e.g. `Tier-1-`, `[Prototype]` or `Setup =`, breaking AC2's fixed point.
 * `banner()` only ever wraps content in one of three *exact, known* shapes (`style`'s three
 * cases), so this recognises each shape by its fixed anchor and strips only that anchor -
 * never a same-looking run that happens to be the title's own text:
 *
 * - `brackets`: the fixed `----- [ ` prefix and, only when also present (an *untagged* banner -
 *   `parseComment`'s tag cut already removes a tagged banner's trailing decoration before this ever
 *   sees it), the fixed ` ] -----` suffix.
 * - `dashes`: the fixed `--- ` prefix and, only when `tagSliced` is `false` (see below) and a
 *   trailing run of `-` characters immediately after a single space runs to the end of the string -
 *   `banner()`'s fill, which is always separated from the content by exactly that one space and
 *   never appears without it.
 * - `plain` (or anything neither of the above matches, e.g. the sentinel/hand-edit-sentence lines
 *   this is never called on): no decoration at all, so nothing is stripped beyond surrounding
 *   whitespace - unless the *entire* remaining text is itself pure decoration (the header block's
 *   own `=`-rule line, which `BANNER_RULE` would otherwise misread as a section title with real
 *   content, minting a category literally named 70-odd `=` characters), in which case the title is
 *   `''` so the caller's `title.length > 0` guard rejects it.
 *
 * `tagSliced` (`ParsedComment`'s own field) is what distinguishes "no fill is present to strip" from
 * "fill was stripped already" - not a `BANNER_WIDTH` coincidence. `parseComment`'s `tagEndIndex` cuts a
 * well-formed tag's *entire* tail (tag plus everything after it, all decoration by construction) off
 * before `parseMetaTag` ever runs, so a *tagged* banner's `prose` never contains fill regardless of
 * how much real fill the file has - and `parseMetaTag` itself trims trailing whitespace, so the one
 * separating space between title and where the tag was is gone too. Without `tagSliced`,
 * `DASHES_SUFFIX`'s `/ -+$/` could not tell a real trailing `<space>-+` in the title (`"Weapons -"`,
 * `"Tier -"`) from stripped fill, and would erode it for *any* tagged dashes-style title ending that
 * way. A tagged banner skips the fill-strip branch entirely; only a genuinely untagged banner
 * (where fill really can still be in `prose`) tries it, and that exact-width coincidence remains the
 * one honestly-unreached limitation.
 */
export function bannerTitle(prose: string, tagSliced: boolean): { title: string; block?: string } {
  const trimmedStart = prose.replace(/^\s+/, '')
  let bare: string
  if (trimmedStart.startsWith(BRACKETS_PREFIX)) {
    const rest = trimmedStart.slice(BRACKETS_PREFIX.length)
    // Same rule as `dashes` below, for the same reason - a *tagged* brackets banner's `rest` never legitimately ends in the real
    // `BRACKETS_SUFFIX` (`tagEndIndex` already cut that whole closing `] -----` off along with the
    // tag), so checking for it here only ever matches a title whose own text happens to end in that
    // literal 8-character string (a custom category deliberately or accidentally named e.g.
    // `----- [ Nested ] -----`) - a false positive that strips real content, not decoration. Only a
    // genuinely untagged brackets banner can still have the real suffix in `rest` at all.
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
  // The stripped prefix is *reported* as well as removed: it names which of the
  // writer's three per-category blocks the header belongs to, and `categoryRegistry`'s ordering
  // needs that to read the file's category order back off the sections - see `Section.block`.
  const prefix = TITLE_PREFIXES.find((candidate) => bare.startsWith(candidate))
  return prefix ? { title: bare.slice(prefix.length), block: prefix } : { title: bare }
}
