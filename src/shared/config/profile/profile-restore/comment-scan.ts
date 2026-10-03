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

/** The reserved, non-user-configurable "Other"/"Other binds" bucket titles (`render.ts`). They get
 * their own `Section.kind` rather than the generic untagged-banner path (see `categoryRegistry`). */
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
   * not leftovers (`RestoreProfilePartsResult.consumedCommentLines`). A malformed tag is excluded:
   * it is not fully understood, so the line stays visible in `preserved`. */
  consumed: RestoreSourcePosition[]
}

/** A `banner()` `fill: '='` rule line (`buildHeaderBlock`, `render.ts`), comment marker stripped. */
export const HEADER_RULE = /^=+$/

/**
 * Is the `v` line at hand the banner header's own tag line rather than the legacy header block's
 * name+tag line? Told apart by what the line itself carries (`file-ownership.ts#readOwnershipStamp`
 * answers the same question from raw text and cannot be reused on parsed comment lines):
 *
 * - a banner tag line is tag-only (`headerTagLine` writes it right-aligned, no prose) and carries
 *   `id`;
 * - a legacy tag rides on the name line, so it has prose, and never carries `id`.
 *
 * Both conditions are required: `id` alone would let a hand-pasted `id=` flip an old name+tag line
 * onto the backward branch, where the lines above are the wrong ones; empty prose alone would do the
 * same for a pre-051 file with a blank profile name. A failing line takes the legacy branch.
 */
export function isBannerHeaderTagLine(parsed: ParsedComment): boolean {
  return (parsed.fields.id ?? '').trim().length > 0 && parsed.prose.trim().length === 0
}

/**
 * The comment line at `index`, but only when it really is the file's `line` (same file, exact line
 * number) - the adjacency half of `consumeHeaderDecoration`'s positional check, in one place.
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
 * The header block's decoration lines, consumed so they do not surface as "unrecognised" leftovers:
 * none carries a tag, so they would fall through to `preserved`, which is misleading (this is
 * launcher-owned decoration) and, as one long line in a single-line code view, the source of an axe
 * `scrollable-region-focusable` violation in the import dialog.
 *
 * Two block shapes with the tag at different ends, hence two branches:
 *
 * - **banner**: `=`-rule / name / `=`-rule / tag-only line. The tag is the last line, so the three
 *   decoration lines are consumed backward from it.
 * - **legacy** (pre-051, read forever): `=`-rule / name+tag / `HAND_EDIT_SENTENCE` / `=`-rule. The
 *   tag is in the middle, so its rule at `- 1` and the sentence and closing rule at `+ 1`/`+ 2` are
 *   consumed forward.
 *
 * Both are positional and content-checked: a neighbour is consumed only if adjacent by line number
 * (same file) and matching the shape the writer produces there; a hand-edited or missing neighbour
 * stays visible in `preserved`. The banner's name line is arbitrary user text, so it is consumed only
 * when both `=` rules around it are there - the sandwich identifies it.
 *
 * Consumption only marks lines understood for the preview's `preserved` list; section attribution is
 * independent (`scanComments`), so a wrong guess costs at most one line's visibility, never a
 * category or the lines under it.
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
    // A tag on the name line means some other launcher line with a meaning of its own, not the
    // plain `//  <name>` line `banner()` writes; leave it to whichever branch owns it.
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
  // A well-formed sentinel is understood and joins `consumed` on the same terms as the version
  // marker and section headers; otherwise `preservedLinesFor` (import.ts) lists it as an
  // unrecognised leftover, and a long one trips the axe `scrollable-region-focusable` violation in
  // the import dialog. An id-less sentinel is not fully understood and stays visible, like a
  // malformed tag.
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
      // The banner header's tag line carries the profile id the legacy sentinel line carries, so it
      // is the file's ownership statement and joins `sentinels` on the same terms: a non-empty id
      // from a cleanly parsed tag. That makes `sourceProfileId` (and `import.ts`'s `ownWrittenFile`)
      // resolve for a new-shape file, in agreement with `readOwnershipStamp`, which also skips a
      // malformed tag. `preferred` below still prefers the id in the version marker's own file, so a
      // profile file wins over its loader `autoexec.cfg`.
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
    // A second-level banner, checked after `cat` and before `layer` so a hand-edited line with two
    // header markers resolves to the outer level rather than to no section at all.
    //
    // Its parent is the nearest preceding category header in this file (where
    // `render.ts#withSubcategoryBuckets` writes it), resolved while sections are still in document
    // order. Never a preceding sub-banner: depth is two levels, so several sub-banners under one
    // category are flat siblings.
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
    // A cvar section banner, the Settings tab's counterpart of `cat=`. Checked before the reserved
    // "Other" branch because the reserved bucket is defined by having no tag: a section the user
    // named "Other" carries its own `cvs=<id>` and is an ordinary section. The reserved
    // `cvs=defaults` still opens a boundary (lines under it must not be attributed to the section
    // above); `cvarSectionKeyFor` is what refuses to mint it.
    sections.push({ kind: 'cvarsection', title, block, fields: parsed.fields, file, line })
    if (!parsed.malformed) consumed.push({ file, line })
  } else if (taggedCvarSubsectionId(parsed.fields) !== null) {
    // The second level, parent resolved positionally like the `sub=` branch: the nearest preceding
    // cvar-section header in this file (`render.ts#buildCvarSectionBlock`), never a sub-section.
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
  // Computed once ahead of the section-kind chain: the heuristic sub-category branch and its
  // "did this qualify" condition need the same answer (`heuristicSubcategoryParent`).
  const heuristicWrap = parsed.tagged ? null : decorationWrap(comment.text)
  const heuristicParent = heuristicSubcategoryParent(
    sections,
    heuristicWrap,
    state.decorationTally,
    file,
  )
  // The same question one level up (`mirroredWrapTitle`). Untagged only: a tag has already said what
  // the line is.
  const mirroredTitle = parsed.tagged ? null : mirroredWrapTitle(comment.text)
  if (!claimedByEntryScan(parsed) && title.length > 0 && OTHER_BUCKET_TITLES.has(title)) {
    // The reserved "Other"/"Other binds" bucket is recognised by its fixed title, not by
    // `BANNER_RULE`: the `plain` header style draws no decoration, so every entry after it would be
    // re-filed into whichever earlier category `sectionFor` finds. Checked ahead of the generic
    // banner branch so `dashes`/`brackets` also get `'other'` instead of minting a persisted "Other"
    // category (see `categoryRegistry`).
    sections.push({ kind: 'other', title, block, fields: parsed.fields, file, line })
  } else if (!claimedByEntryScan(parsed) && heuristicWrap && heuristicParent) {
    // An untagged decorated line whose decoration recurs in this file, under a category-shaped
    // header: a foreign author's second-level marker (`##### 1st row #####`), promoted to a
    // `'subcategory'` like a tagged `sub=` banner. The synthetic `sub` key is never shown; it only
    // lets `registerSubcategory`/`categoryKeyFor`/`idFor` key it as they key a tagged one.
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
    // An untagged banner - a cvar group, or a hand-written header in an otherwise launcher file
    // (never the reserved "Other" bucket, claimed above). It opens a section; whether anything is
    // filed under it decides whether a category is minted for it.
    //
    // `claimedByEntryScan` comes first: an entry line's prose is a user-typed name that may contain
    // `---`, so the tag decides what the line is and decoration is only consulted for unclaimed lines.
    //
    // `BANNER_RULE` alone would leave a category's header invisible under `plain` style when its
    // `[q2l cat=…]` tag was hand-deleted (no decoration to match), so its entries would silently join
    // the earlier category. `CATEGORY_TITLE_PREFIX` closes that: every category section this writer
    // emits carries one of three fixed prefixes and nothing else it emits does. The broader "any
    // untagged comment line" rule was rejected because it would split a category at an ordinary
    // inline comment instead of merely merging one.
    //
    // Accepted cost: a hand-typed comment that starts with `Aliases: `/`Binds: `/`Entries: ` is
    // indistinguishable from a header with its tag deleted and mints a section, without a warning
    // since nothing is malformed relative to what the line claims to be.
    //
    // Two adjacent untagged banners are simply two sections; nothing fuses them into `Main / Sub`.
    // Reading an untagged foreign pair as category + sub-category is the repeated-decoration
    // heuristic's job.
    //
    // A mirror-wrapped foreign header (`mirroredWrapTitle`) lands here with its own stripped title,
    // since `bannerTitle` knows only this writer's three shapes and would return the whole line.
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
 * Ownership arrives in two shapes that land in one `sentinels` list: a pre-051 `OWNERSHIP_MARKER`
 * line and the header banner's tag line (its `id` field). The stamp in the same file as the version
 * marker wins, since that is the profile file being read; a loader `autoexec.cfg` carries its own
 * sentinel (`renderLoaderFile` names whichever profile is the installation's default) and must not
 * outvote it.
 */
export function scanComments(comments: readonly RestoreCommentLine[]): CommentScan {
  const state: ScanState = {
    warnings: [],
    sections: [],
    sentinels: [],
    consumed: [],
    version: null,
    anyTag: false,
    // Computed up front: the heuristic needs the whole file's decoration usage to tell a repeated
    // marker from a stray decorated comment, which a streaming count cannot answer at first sight.
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
