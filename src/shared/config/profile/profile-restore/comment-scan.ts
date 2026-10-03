import { META_FORMAT_VERSION } from '@shared/config/profile/profile-metadata'
import {
  HAND_EDIT_SENTENCE,
  OTHER_CATEGORY_LABEL,
  UNOWNED_BINDS_LABEL,
} from '@shared/config/syntax/file-vocabulary'
import {
  type RestoreSourcePosition,
  type RestoreCommentLine,
  type RestoreWarning,
  type Section,
  HEURISTIC_SUBCATEGORY_PREFIX,
} from './types'
import {
  SENTINEL_TEXT,
  BANNER_RULE,
  CATEGORY_TITLE_PREFIX,
  type ParsedComment,
  TAG_SIGIL,
  parseComment,
  taggedSubcategoryId,
  taggedCvarSectionId,
  taggedCvarSubsectionId,
  decorationWrap,
  mirroredWrapTitle,
  decorationCounts,
  heuristicSubcategoryParent,
  claimedByEntryScan,
  bannerTitle,
} from './comment-parse'

/** The reserved, non-user-configurable "Other"/"Other binds" bucket titles (`render.ts`) - see
 * `categoryRegistry`'s `'other'` kind for why these get their own `Section.kind` rather than
 * falling through the generic untagged-banner path. */
export const OTHER_BUCKET_TITLES = new Set<string>([OTHER_CATEGORY_LABEL, UNOWNED_BINDS_LABEL])

export interface CommentScan {
  version: { value: number | null; file: string; line: number } | null
  sourceProfileId: string | null
  sections: Section[]
  /** Did any comment carry a `[q2l` tag at all? */
  anyTag: boolean
  warnings: RestoreWarning[]
  /** Comment-only lines this pass fully understood - the header's version marker and every
   * well-formed section banner - so `restoreProfileParts` can tell the import preview these are
   * not "we don't understand this" leftovers (see `RestoreProfilePartsResult.consumedCommentLines`).
   * A malformed tag is deliberately excluded: it is not fully understood, so AC5's "never discard
   * the line" still means keeping it visible in `preserved`. */
  consumed: RestoreSourcePosition[]
}

/** A `banner()` `fill: '='` rule line (`buildHeaderBlock`, `render.ts`), comment marker stripped. */
export const HEADER_RULE = /^=+$/

/**
 * Is the `v` line at hand the **banner** header's own tag line rather than the
 * legacy header block's name+tag line?
 *
 * The two shapes are told apart by what the line itself carries, since that is all this module ever
 * sees (`file-ownership.ts#readOwnershipStamp` answers the same question one layer up, from the raw
 * file text, and cannot be reused here - it takes a blob, this takes parsed comment lines):
 *
 * - a banner tag line is **tag-only** - `headerTagLine` writes the tag alone, right-aligned, with no
 *   prose beside it - and carries the `id` field;
 * - a legacy header's tag rides on the *name* line, so it always has prose, and never carries `id`
 *   (the field did not exist when that shape was written).
 *
 * Both conditions are required rather than either: `id` alone would let a hand-edit that pasted an
 * `id=` into an old name+tag line flip that file onto the backward branch, where the lines above it
 * are the wrong ones; empty prose alone would do the same for a pre-051 file whose profile name was
 * blank. A line failing this test simply takes the legacy branch, exactly as it did before.
 */
export function isBannerHeaderTagLine(parsed: ParsedComment): boolean {
  return (parsed.fields.id ?? '').trim().length > 0 && parsed.prose.trim().length === 0
}

/**
 * The comment line at `index`, but only when it really is the file's `line` (same file, that exact
 * line number) - the adjacency half of `consumeHeaderDecoration`'s positional check, in one place so
 * neither branch below can spell it differently.
 */
export function neighbourAt(
  comments: readonly RestoreCommentLine[],
  index: number,
  file: string,
  line: number,
): RestoreCommentLine | undefined {
  const candidate = comments[index]
  return candidate && candidate.file === file && candidate.line === line ? candidate : undefined
}

/**
 * The header block's own decoration lines, consumed so they do not surface as "unrecognised"
 * leftovers - none of them carries a tag of its own, so without this they fall through to
 * `preserved`, which for a real file is both misleading (this *is* recognised, launcher-owned
 * decoration) and, being a single long line in a single-line code view, the source of an axe
 * `scrollable-region-focusable` violation in the import dialog.
 *
 * Two block shapes, and the tag sits at a different end of each - which is the whole reason this
 * function has two branches:
 *
 * - **banner**: `=`-rule / name / `=`-rule / tag-only
 *   line. The tag is the block's **last** line, so the three decoration lines are consumed
 *   *backward* from it - `versionIndex - 1` is the closing rule, `- 2` the name, `- 3` the opening
 *   rule.
 * - **legacy** (pre-051, still read forever): `=`-rule / name+tag / `HAND_EDIT_SENTENCE` / `=`-rule.
 *   The tag sits in the block's middle, so its rule at `- 1` and the sentence and closing rule at
 *   `+ 1`/`+ 2` are consumed *forward*, exactly as before this deliverable - the branch is
 *   deliberately untouched.
 *
 * Both branches stay positional-**and**-content-checked, not positional alone: a neighbour is
 * consumed only if it is immediately adjacent by line number (same file, `line ± n`) *and* matches
 * the exact shape the writer produces there. A hand-edited or missing neighbour is simply not
 * consumed and stays visible in `preserved` - never a crash, never a wrong guess. The one line whose
 * content cannot be checked is the banner's name line (a user-typed profile name is arbitrary text),
 * so it is consumed only when *both* `=` rules around it are really there: the sandwich is what
 * identifies it, not its own text.
 *
 * Note what consumption is and is not: this only marks lines as understood for the import preview's
 * `preserved` list. Section attribution happens independently in `scanComments`' own chain, so no
 * branch here can ever swallow a real section header - the worst a wrong guess could cost is one
 * line's visibility in `preserved`, never a category or the lines under it.
 */
export function consumeHeaderDecoration(
  comments: readonly RestoreCommentLine[],
  versionIndex: number,
  file: string,
  line: number,
  consumed: RestoreSourcePosition[],
  banner: boolean,
): void {
  if (banner) {
    const closingRule = neighbourAt(comments, versionIndex - 1, file, line - 1)
    if (!closingRule || !HEADER_RULE.test(closingRule.text.trim())) return
    consumed.push({ file, line: closingRule.line })

    const nameLine = neighbourAt(comments, versionIndex - 2, file, line - 2)
    const openingRule = neighbourAt(comments, versionIndex - 3, file, line - 3)
    if (!nameLine || !openingRule) return
    if (!HEADER_RULE.test(openingRule.text.trim())) return
    // A tag on the name line means this is not the plain `//  <name>` line `banner()` writes but
    // some other launcher line that has a meaning of its own; leave it to whichever branch owns it.
    if (nameLine.text.includes(TAG_SIGIL)) return
    consumed.push({ file, line: nameLine.line })
    consumed.push({ file, line: openingRule.line })
    return
  }

  const openingRule = comments[versionIndex - 1]
  if (openingRule && openingRule.file === file && openingRule.line === line - 1) {
    if (HEADER_RULE.test(openingRule.text.trim())) consumed.push({ file, line: openingRule.line })
  }

  const sentence = comments[versionIndex + 1]
  if (!sentence || sentence.file !== file || sentence.line !== line + 1) return
  if (sentence.text.trim() !== HAND_EDIT_SENTENCE) return
  consumed.push({ file, line: sentence.line })

  const closingRule = comments[versionIndex + 2]
  if (!closingRule || closingRule.file !== file || closingRule.line !== line + 2) return
  if (HEADER_RULE.test(closingRule.text.trim())) consumed.push({ file, line: closingRule.line })
}

export interface ScanState {
  warnings: RestoreWarning[]
  sections: Section[]
  sentinels: { id: string; file: string }[]
  consumed: RestoreSourcePosition[]
  version: CommentScan['version']
  anyTag: boolean
  decorationTally: Map<string, number>
}

/** The ownership sentinel line, when `comment` is one. */
export function readSentinel(state: ScanState, comment: RestoreCommentLine): boolean {
  const { sentinels, consumed } = state
  const { file, line } = comment
  const trimmed = comment.text.trim()
  if (!trimmed.startsWith(SENTINEL_TEXT)) return false
  const id = trimmed.slice(SENTINEL_TEXT.length).trim().split(/\s+/)[0] ?? ''
  // A well-formed sentinel is understood (it is how `ownWrittenFile`/`sourceProfileId` get
  // decided at all) - it must join `consumed` on the same terms as the version marker and
  // section headers, or it drops out of `scan.consumed` and `preservedLinesFor` (import.ts)
  // still lists it as an unrecognised leftover, which is both misleading and, for a long
  // enough sentinel line, the axe `scrollable-region-focusable` violation on the import
  // dialog's single-line code view (each `preserved` entry renders its own scrollable `pre`).
  // An id-less sentinel is not fully understood, so it is left out and stays visible, same
  // rule as a malformed tag elsewhere in this scan.
  if (id.length > 0) {
    sentinels.push({ id, file })
    consumed.push({ file, line })
  }
  return true
}

/** Malformed-tag and unknown-key warnings for one line. */
export function recordTagDiagnostics(
  state: ScanState,
  comment: RestoreCommentLine,
  parsed: ParsedComment,
): void {
  const { warnings } = state
  const { file, line } = comment
  if (parsed.tagged) state.anyTag = true
  if (parsed.malformed) warnings.push({ reason: 'tag-malformed', file, line })
  if (parsed.unknownKeys.length > 0) {
    warnings.push({
      reason: 'tag-unknown-keys',
      file,
      line,
      subject: parsed.unknownKeys.join(','),
    })
  }
}

/** The `v` marker: version warnings, the header banner's ownership id and its decoration. */
export function readVersionMarker(
  state: ScanState,
  comments: readonly RestoreCommentLine[],
  index: number,
  parsed: ParsedComment,
): void {
  const { warnings, sentinels, consumed } = state
  const { file, line } = comments[index]!
  if (parsed.fields.v !== undefined && state.version === null) {
    const value = Number(parsed.fields.v)
    const valid = Number.isInteger(value) && value > 0
    if (!valid) {
      warnings.push({ reason: 'metadata-version-invalid', file, line, subject: parsed.fields.v })
    } else if (value > META_FORMAT_VERSION) {
      warnings.push({ reason: 'metadata-version-newer', file, line, subject: parsed.fields.v })
    }
    state.version = { value: valid ? value : null, file, line }
    if (!parsed.malformed) {
      // the banner header's tag line carries the profile id the legacy sentinel
      // line carries on its own, so it is the ownership statement for this file and joins
      // `sentinels` on exactly the sentinel branch's terms - a non-empty id, from a tag that
      // parsed cleanly. That is what makes `sourceProfileId` (and therefore `import.ts`'s
      // `ownWrittenFile`) resolve for a new-shape file at all, and it agrees with
      // `file-ownership.ts#readOwnershipStamp`, which likewise skips a malformed tag rather than
      // reading an id out of it. `preferred` below still prefers the id found in the *same* file
      // as the version marker, so a profile file and its loader `autoexec.cfg` (whose sentinel
      // names whichever profile is the installation's default) resolve to the profile's own id.
      const ownershipId = (parsed.fields.id ?? '').trim()
      if (ownershipId.length > 0) sentinels.push({ id: ownershipId, file })
      consumed.push({ file, line })
      consumeHeaderDecoration(comments, index, file, line, consumed, isBannerHeaderTagLine(parsed))
    }
  }
}

/** Section kinds a tag states outright; false when the line carries none of them. */
export function pushTaggedSection(
  state: ScanState,
  comment: RestoreCommentLine,
  parsed: ParsedComment,
): boolean {
  const { sections, consumed } = state
  const { file, line } = comment
  const { title, block } = bannerTitle(parsed.prose, parsed.tagSliced)
  if (parsed.fields.cat !== undefined) {
    sections.push({ kind: 'category', title, block, fields: parsed.fields, file, line })
    if (!parsed.malformed) consumed.push({ file, line })
  } else if (taggedSubcategoryId(parsed.fields) !== null) {
    // A second-level banner. Checked after `cat` and before `layer`, so a
    // hand-edited line carrying two header markers at once resolves to the outer level rather
    // than to whichever branch happens to come first - and never to no section at all.
    //
    // Its parent is read here, while the sections seen so far are still in document order: the
    // nearest preceding *category* header in this same file, which is where
    // `render.ts#withSubcategoryBuckets` writes it. Never a preceding sub-banner - depth is
    // exactly two levels (the story's own Decisions), so a sub-banner's parent is a category or
    // nothing, and a chain of sub-banners under one category is a flat list of siblings rather
    // than a nesting this reader would otherwise invent.
    const parent = [...sections]
      .reverse()
      .find((candidate) => candidate.kind === 'category' && candidate.file === file)
    sections.push({
      kind: 'subcategory',
      title,
      block,
      fields: parsed.fields,
      file,
      line,
      ...(parent ? { parent } : {}),
    })
    if (!parsed.malformed) consumed.push({ file, line })
  } else if (parsed.fields.layer !== undefined) {
    sections.push({ kind: 'layer', title, block, fields: parsed.fields, file, line })
    if (!parsed.malformed) consumed.push({ file, line })
  } else if (taggedCvarSectionId(parsed.fields) !== null) {
    // A cvar section banner, the Settings tab's counterpart of the `cat=` branch
    // above. Checked *before* the reserved-"Other" branch below on purpose: a section the user
    // really did name "Other" carries a real `cvs=<id>` of its own, and the reserved bucket is
    // defined by having no tag at all - so the tag decides, and a user-named "Other" section is
    // an ordinary section rather than the writer's untagged leftovers bucket. The reserved
    // `cvs=defaults` id is *not* filtered out here either: it opens a section boundary like any
    // other banner (the lines under it must not be attributed to the section above), and it is
    // `cvarSectionRegistry` that refuses to mint it - see its `cvarSectionKeyFor`.
    sections.push({ kind: 'cvarsection', title, block, fields: parsed.fields, file, line })
    if (!parsed.malformed) consumed.push({ file, line })
  } else if (taggedCvarSubsectionId(parsed.fields) !== null) {
    // The second level, parent resolved positionally exactly as the `sub=` branch
    // above resolves a sub-category's: the nearest preceding cvar-section header in this same
    // file, which is where `render.ts#buildCvarSectionBlock` writes it. Never a preceding
    // sub-section - depth is exactly two levels, same as one namespace over.
    const parent = [...sections]
      .reverse()
      .find((candidate) => candidate.kind === 'cvarsection' && candidate.file === file)
    sections.push({
      kind: 'cvarsubsection',
      title,
      block,
      fields: parsed.fields,
      file,
      line,
      ...(parent ? { parent } : {}),
    })
    if (!parsed.malformed) consumed.push({ file, line })
  } else {
    return false
  }
  return true
}

/** Section kinds inferred from the line's shape alone (no tag states them). */
export function pushUntaggedSection(
  state: ScanState,
  comment: RestoreCommentLine,
  parsed: ParsedComment,
): void {
  const { sections } = state
  const { file, line } = comment
  const { title, block } = bannerTitle(parsed.prose, parsed.tagSliced)
  // computed once per line, ahead of the section-kind chain below, since the
  // heuristic sub-category branch and its "did this qualify at all" condition need the same
  // answer - see `heuristicSubcategoryParent`'s own doc comment for what "qualify" means.
  const heuristicWrap = parsed.tagged ? null : decorationWrap(comment.text)
  const heuristicParent = heuristicSubcategoryParent(
    sections,
    heuristicWrap,
    state.decorationTally,
    file,
  )
  // the same "an untagged line the file itself decorated" question, one
  // level up - see `mirroredWrapTitle`. Untagged only, for the same reason `heuristicWrap` is: a
  // tagged line's tag has already said what the line is.
  const mirroredTitle = parsed.tagged ? null : mirroredWrapTitle(comment.text)
  if (!claimedByEntryScan(parsed) && title.length > 0 && OTHER_BUCKET_TITLES.has(title)) {
    // The reserved "Other"/"Other binds" bucket gets its
    // own section kind, recognised by its fixed, non-user-configurable title rather than by
    // `BANNER_RULE`'s decoration test - `plain` header style draws no decoration at all
    // (`cfg-layout.ts#banner`'s `plain` branch), so `BANNER_RULE` can never flag this line as a
    // section under that style, and every entry physically after it was silently re-filed into
    // whichever *earlier* tagged category happened to precede it instead (`sectionFor` finds the
    // nearest preceding section of any kind). Checked ahead of the generic untagged-banner branch
    // below so `dashes`/`brackets` (where `BANNER_RULE` *would* otherwise match) get the same
    // `'other'` kind too, instead of minting a real, persisted "Other" category - seeing
    // `categoryRegistry`'s `'other'` case for why that minting broke AC2 one render later.
    sections.push({ kind: 'other', title, block, fields: parsed.fields, file, line })
  } else if (!claimedByEntryScan(parsed) && heuristicWrap && heuristicParent) {
    // an untagged, decorated comment-only line whose decoration recurs elsewhere in
    // this file, sitting under a category-shaped header already seen - a foreign author's own
    // second-level marker (`##### 1st row #####`), promoted to a real `Section.kind: 'subcategory'`
    // exactly like a tagged `sub=` banner (D3), just detected from the file's own repetition
    // instead of a tag. The synthetic `sub` key is never rendered or shown - it exists only so
    // `registerSubcategory`/`categoryKeyFor`/`idFor` can key this section the same way they key a
    // tagged one, without a second lookup mechanism for the same idea.
    sections.push({
      kind: 'subcategory',
      title: heuristicWrap.title,
      fields: { sub: `${HEURISTIC_SUBCATEGORY_PREFIX}${file}:${line}` },
      file,
      line,
      parent: heuristicParent,
    })
  } else if (
    !claimedByEntryScan(parsed) &&
    ((title.length > 0 &&
      (BANNER_RULE.test(comment.text) || CATEGORY_TITLE_PREFIX.test(comment.text.trim()))) ||
      mirroredTitle !== null)
  ) {
    // An untagged banner - a cvar group, or a hand-written header in a file that is otherwise
    // ours (never the reserved "Other"/"Other binds" bucket - that is claimed by the branch just
    // above, regardless of header style). It opens a section all the same; whether anything is
    // ever filed under it decides whether a category gets minted for it.
    //
    // `claimedByEntryScan` first, and only then the decoration test: an entry line's prose is a
    // user-typed display name and may contain anything at all, `---` included, so the tag decides
    // what the line *is* and the decoration is only consulted for a line no tag has claimed.
    //
    // `BANNER_RULE` alone would leave a real category's header invisible as a section boundary under
    // `plain` style whenever its `[q2l cat=…]` tag was hand-deleted but the plain
    // `// Aliases: <name>` line survived - `plain` draws no decoration for `BANNER_RULE` to match, so
    // the entry would silently join whichever *earlier* real category preceded it, with no warning.
    // `CATEGORY_TITLE_PREFIX` closes that: every category section this writer emits, tagged or not,
    // "Other" bucket included, carries one of exactly three fixed prefixes (`TITLE_PREFIXES`) -
    // nothing else this writer emits (a cvar group's plain label, the hand-edit sentence, a layer's
    // `Layer: ` title) starts with one of them, so this is a narrow, safe signal rather than the
    // broader "any untagged comment-only line" heuristic considered and rejected for this same gap
    // (that would just as easily misread an ordinary hand-typed inline comment as a brand new
    // section, silently *splitting* a category instead of silently *merging* one).
    //
    // The narrow signal is safe against realistic prose (a comment merely mentioning "Aliases:" or
    // "Bind:" *without* the exact "word + colon + space at the very start of the line" shape never
    // triggers this). The one accepted cost of "narrow" over "broad": a hand-typed comment that DOES
    // happen to start with `Aliases: `/`Binds: `/`Entries: ` (e.g. a player's own note "Aliases: my
    // stuff below") is indistinguishable from a real category header with its tag hand-deleted, and
    // this branch cannot tell the two apart - it mints a section for it, silently, same as it would
    // for the genuine case. No warning fires because nothing here is malformed or missing relative
    // to what this line claims to be; the ambiguity is inherent to choosing this narrow, safe
    // signal over a broader, less safe one, not a bug in the signal itself.
    //
    // Two *adjacent* untagged banners are simply two sections - nothing fuses them into one
    // `Main / Sub` category or invents a name the file never states. The tagged `sub=` branch above
    // reads this writer's own second level back, and recognising an *untagged* foreign pair as a
    // real category + sub-category is the repeated-decoration heuristic's separate job (story 053 D4).
    //
    // a mirror-wrapped foreign header (`mirroredWrapTitle`) lands here
    // too, and brings its own stripped title - `bannerTitle` knows only this writer's three banner
    // shapes, so for `.: Main Key's :.` it would hand back the whole decorated line as the name.
    sections.push({
      kind: 'plain',
      title: mirroredTitle ?? title,
      block,
      fields: parsed.fields,
      file,
      line,
    })
  }
}

/**
 * One pass over the comment-only lines: the ownership stamp, the `v` marker, and the section
 * headers in document order.
 *
 * Ownership arrives in either of two shapes and both land in the same `sentinels` list: a pre-051
 * `OWNERSHIP_MARKER` line, and the header banner's own tag line, whose `id` field
 * replaced that separate line in a profile file. The stamp found in the *same file* as the version
 * marker wins, since that is the profile file whose metadata is being read; a loader `autoexec.cfg`
 * still carries a sentinel of its own (naming whichever profile was the installation's default,
 * `renderLoaderFile` writes it unchanged) and must not outvote it.
 */
export function scanComments(comments: readonly RestoreCommentLine[]): CommentScan {
  const state: ScanState = {
    warnings: [],
    sections: [],
    sentinels: [],
    consumed: [],
    version: null,
    anyTag: false,
    // computed once, up front, since the heuristic needs to know the *whole* file's
    // decoration usage before it can tell a real repeated marker from one stray decorated comment -
    // a per-line, streaming count could not answer "does this recur?" the first time a decoration is
    // seen.
    decorationTally: decorationCounts(comments),
  }

  for (let index = 0; index < comments.length; index++) {
    const comment = comments[index]!
    if (readSentinel(state, comment)) continue
    const parsed = parseComment(comment.text)
    recordTagDiagnostics(state, comment, parsed)
    readVersionMarker(state, comments, index, parsed)
    if (!pushTaggedSection(state, comment, parsed)) pushUntaggedSection(state, comment, parsed)
  }

  const { version, sentinels, sections, anyTag, warnings, consumed } = state
  const preferred =
    (version && sentinels.find((candidate) => candidate.file === version.file)) ?? sentinels[0]

  return { version, sourceProfileId: preferred?.id ?? null, sections, anyTag, warnings, consumed }
}
