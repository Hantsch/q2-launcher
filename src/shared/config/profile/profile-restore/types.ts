import type { AltLayer } from '@shared/config/aliases/alt-layers'
import type { ImportedActionsResult } from '@shared/config/aliases/alias-import'
import type { ConfigAction, ConfigActionCategory, ConfigCvarSection } from '@shared/modules/config'

/**
 * Where a line came from. `line` is what makes section attribution possible at all (see the file
 * doc comment), so it is required rather than optional; `file` is required with it because a line
 * number alone is ambiguous the moment an import reads more than one file, which every real import
 * does (`config.cfg` + `autoexec.cfg` + whatever they `exec`).
 */
export interface RestoreSourcePosition {
  /** On-disk file name the line came from, e.g. `q2l-profile-<id>.cfg`. */
  file: string
  /** 1-based line number within that file. */
  line: number
}

/** One folded `alias <name> <body>` line - structurally `import-reader.ts`'s `ImportedAlias`. */
export interface RestoreAliasLine extends RestoreSourcePosition {
  name: string
  /** Raw argument text, outer quotes already stripped by the parser, unsplit. */
  body: string
  /** The line's trailing comment (marker stripped), `''` when it had none. */
  comment: string
  /**
   * Characters of the raw line before its `//` marker, the two-space separator included -
   * `config-parser.ts#ParsedAlias.codeWidth`, carried through the reader unchanged.
   *
   * Optional because it is *evidence about the file*, not content: with it, this module can
   * reproduce exactly how much room `fitProseAndTag` had left for the line's display prose and
   * therefore whether a shorter prose on one line is that same name **cut** or a different name
   * (`proseCutOf`). Without it - a caller that assembles lines from something other than a parsed
   * file - the comparison falls back to plain equality, which splits rather than merges: the safe
   * direction, since a split loses no name.
   */
  codeWidth?: number
}

/** One live `bind <key> <command>` line, after `unbind`/`unbindall` folding. */
export interface RestoreBindLine extends RestoreSourcePosition {
  key: string
  command: string
  comment: string
}

/** One live `set <name> <value>` line. Read for its trailing comment only - a `set` line is not an
 * entry and carries no tag of its own (`render.ts`), so the only thing a cvar's comment can
 * contribute here is a *report* that someone hand-edited a tag into or out of it.
 *
 * `file`/`line` are the WINNING (last-assignment-wins) definition's position - what the malformed-
 * tag warning below reports against, and what a launcher-written file's own reconciliation uses.
 * `firstFile`/`firstLine`, when a caller has them, are the name's FIRST
 * occurrence's position instead - section attribution (`readCvarSections`) is placement, not value,
 * and the story's own "a name listed twice is claimed by its first placement" rule applies to a
 * name's SECTION the same way it applies to a bind's category, independently of which occurrence's
 * VALUE actually wins at runtime. Optional and defaulting to `file`/`line` when absent, so a caller
 * that never had two occurrences of the same name to begin with (the launcher's own round-trip
 * reader, `file-source.ts`) needs no change at all. */
export interface RestoreCvarLine extends RestoreSourcePosition {
  name: string
  value: string
  comment: string
  firstFile?: string
  firstLine?: number
}

/** One comment-only line - `import-reader.ts`'s `ImportedCommentLine`. */
export interface RestoreCommentLine extends RestoreSourcePosition {
  /** Comment text with the `//` marker stripped, never the raw line. */
  text: string
}

export interface RestoreProfilePartsInput {
  /** The import's folded alias definitions, in document order. */
  aliases: readonly RestoreAliasLine[]
  /** The import's live binds, in document order. */
  binds: readonly RestoreBindLine[]
  /** The import's live cvars, in document order. */
  cvars: readonly RestoreCvarLine[]
  /** Comment-only lines, in document order - the section headers, the header block and the
   * ownership sentinel all arrive here. */
  comments: readonly RestoreCommentLine[]
  /**
   * Story 041's "attempt as layer" answers, passed straight through to `buildImportedActions` on
   * the untagged path. Meaningless on the tagged path (a launcher-written file records its layers,
   * so there is nothing to guess and nothing to ask) and ignored there.
   */
  layerAliases?: readonly string[]
  /** The caller's id factory - same idiom as `buildImportedActions`/`adoptRawBinds`. */
  newId: () => string
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * Why a restore had something to say about a line. Reasons, never prose: D5 maps each to an i18n
 * key, so nothing user-visible is authored here (CLAUDE.md - main sends keys, not sentences).
 */
export type RestoreWarningReason =
  /** The file was written by a launcher whose format version is newer than this build's. */
  | 'metadata-version-newer'
  /** A `v` field that is not a positive integer. */
  | 'metadata-version-invalid'
  /** Tags exist but no `v` marker does - the header block's marker was hand-deleted. */
  | 'metadata-version-missing'
  /** `parseMetaTag` reported a `[q2l` it could not read as a well-formed tag. */
  | 'tag-malformed'
  /** An `alias` line carries no `[q2l` tag at all - not malformed, simply absent (hand-added, or an
   * older file). Reconstructed through 041's own inference instead of being dropped (AC5). */
  | 'tag-missing'
  /** The tag carried keys this build's registry does not know (`subject` lists them). */
  | 'tag-unknown-keys'
  /** `mod` was a value that is not a `ModifierTrigger`. */
  | 'tag-modifier-unknown'
  /** A tagged line sits under no section header, so its category could not be recovered. */
  | 'entry-section-unknown'
  /**
   * An `alias` line whose name a later `alias` line in the same file re-defines (`subject` is that
   * name), so the earlier definition's body never reaches this function at all - the engine keeps
   * only the last definition of a name and every reader in this codebase folds `alias` lines the
   * same way before calling here (`main/modules/config/file-source.ts#foldConfig`,
   * `main/modules/config/core/import-reader.ts#applyAlias`).
   *
   * **Produced by that fold, not by this module**. The
   * first version of this reason was reported from `buildEntry` instead, on the theory that two
   * same-named `alias` lines would meet in one entry group here - they cannot: the fold has already
   * collapsed them to one line by the time `restoreProfileParts` sees the input, so the branch was
   * unreachable and a user's entry still vanished without a word. Reporting it where the body is
   * actually discarded is what makes the loss visible; see `file-source.ts#discardedAliasWarnings`.
   *
   * Kept in this union rather than given a vocabulary of its own because it is a statement about
   * reading one profile file back, which is exactly what `RestoreWarning` is the vocabulary for,
   * and because `ParsedCanonicalProfile.warnings` is the one list the read path carries.
   */
  | 'entry-alias-duplicate'
  /** A layer section's `mode` tag disagreed with the alias names the section actually contains. */
  | 'layer-mode-contradicted'
  /** A layer section's `trigger` tag disagreed with the section's own trigger bind. */
  | 'layer-trigger-contradicted'

// No reasons exist for the `k` and `slot` tag fields, which the tag does not carry:
// `tag-kind-unknown`/`tag-kind-contradicted` (kind is inferred now, so there is no tagged kind left
// to contradict) and `tag-slot-conflict`/`modifier-slot-unavailable` (slot claims simply append in
// file order, so "this slot is already taken" and "no free slot" are both structurally
// unreachable). Their `en.json` strings went with them.

export interface RestoreWarning {
  reason: RestoreWarningReason
  /** On-disk file name the offending line came from. */
  file: string
  /** 1-based line number within that file. */
  line: number
  /** The offending value itself when there is one (a key name, a `k` value, a list of unknown tag
   * keys) - file data, like `ImportWarning.target`, never generated prose. */
  subject?: string
}

/** `RestoreWarningReason` -> the i18n key it crosses the module boundary as. A total record, so a
 * new reason fails the build until it has a key. */
export const RESTORE_WARNING_KEYS: Record<RestoreWarningReason, string> = {
  'metadata-version-newer': 'config.import.warning.metadata-version-newer',
  'metadata-version-invalid': 'config.import.warning.metadata-version-invalid',
  'metadata-version-missing': 'config.import.warning.metadata-version-missing',
  'tag-malformed': 'config.import.warning.tag-malformed',
  'tag-missing': 'config.import.warning.tag-missing',
  'tag-unknown-keys': 'config.import.warning.tag-unknown-keys',
  'tag-modifier-unknown': 'config.import.warning.tag-modifier-unknown',
  'entry-section-unknown': 'config.import.warning.entry-section-unknown',
  'entry-alias-duplicate': 'config.import.warning.entry-alias-duplicate',
  'layer-mode-contradicted': 'config.import.warning.layer-mode-contradicted',
  'layer-trigger-contradicted': 'config.import.warning.layer-trigger-contradicted',
}

export interface RestoreProfilePartsResult {
  actions: ConfigAction[]
  /** Only the categories that had to be created locally - a built-in `cat` id is adopted, not created. */
  categories: ConfigActionCategory[]
  /**
   * The profile's cvar sections as the file's own banners state them, in banner
   * order, each carrying the names of the `set` lines that sit under it - see "Cvar sections" in
   * this file's doc comment. Never carries the reserved `Defaults`/`Other` buckets, so a launcher
   * file with the always-write toggle on reads back with those cvars *unplaced*, which is the state
   * that re-renders the same file.
   */
  cvarSections: ConfigCvarSection[]
  layers: AltLayer[]
  /** Every discrepancy, malformed tag and unrecognised field, in the order they were met. */
  warnings: RestoreWarning[]
  /** The profile id the file's ownership stamp names - the header banner's own `[q2l … id=…]` tag
   * or a pre-051 sentinel line, whichever the file carries - reported so the import
   * dialog can say *which* profile is being restored, never adopted (AC4). `null` for a file with
   * neither. */
  sourceProfileId: string | null
  /** The `v` the file was written with, or `null` when it carries none (a foreign config, or a
   * launcher file whose header marker was hand-deleted - the warning tells those two apart). */
  metadataVersion: number | null
  /**
   * Story 041's ambiguous-rebind list, so this function is a drop-in for the `buildImportedActions`
   * call `import.ts` makes today (D5). Always empty on the tagged path: a launcher-written file
   * records its layers, so there is nothing for the review step to ask about.
   */
  ambiguous: ImportedActionsResult['ambiguous']
  /**
   * Comment-only lines this call fully understood as a recognised `[q2l ...]` tag - the header
   * block's version marker, a well-formed section banner (`cat=`/`layer=`), or a well-formed entry
   * anchor line - identified by `file`+`line` so `import.ts` can subtract them from the import
   * preview's `preserved` list: "preserved" means "we don't understand this, so we kept it
   * verbatim", and these lines are the opposite of that. A malformed tag is never included here -
   * it degraded to inference (AC5) rather than being understood, so it stays visible in `preserved`
   * too. Always empty on the untagged/foreign-config delegation path, where nothing here recognised
   * anything at all.
   */
  consumedCommentLines: RestoreSourcePosition[]
}

/** One section header, in document order. `kind: 'plain'` is an untagged banner; `kind: 'other'` is
 * specifically the reserved "Other"/"Other binds" bucket (see `OTHER_BUCKET_TITLES`);
 * `kind: 'subcategory'` is a `[q2l sub=…]` second-level banner, whose parent is the
 * `parent` field below; `kind: 'cvarsection'`/`'cvarsubsection'` are the `[q2l cvs=…]`/
 * `[q2l cvsub=…]` cvar-section banners of story 059 D3, structurally the same pair one namespace
 * over. */
export interface Section extends RestoreSourcePosition {
  kind: 'category' | 'subcategory' | 'layer' | 'plain' | 'other' | 'cvarsection' | 'cvarsubsection'
  /** The header's own title, decoration stripped - a category name, a sub-category name, a cvar
   * section's name, or a layer's rendered title. */
  title: string
  /**
   * For `kind: 'subcategory'`/`'cvarsubsection'` only: the section this banner sits inside - the
   * nearest preceding `kind: 'category'`/`kind: 'cvarsection'` header in the same file, resolved
   * once here rather than re-derived at every use, so "the parent is positional" is stated in
   * exactly one place.
   *
   * `undefined` when there is none (a hand-edited file whose sub-banner sits above every category
   * header, or under an untagged one). Such a section still opens - it is a section boundary either
   * way - it simply has no category to register its sub-category into, so the lines under it fall
   * into the shared fallback drawer like any other tagged line with no section of its own.
   */
  parent?: Section
  /**
   * Which of the writer's per-category blocks this header opened, as the literal `TITLE_PREFIXES`
   * entry it carried (`'Aliases: '`, `'Binds: '`, `'Entries: '`), or `undefined` for a header with
   * no such prefix (a cvar group, a layer, a foreign file's own banner).
   *
   * `render.ts` writes one section per category in *three* separate passes - the alias sections
   * (block 4), then the bind sections (block 5), then the `Entries:` anchor/unbound sections (6b) -
   * and each pass walks `profile.categories` in the profile's own order. So the document order of
   * category headers is three interleaved subsequences of one order, not that order itself, and
   * "first header wins" would read `Aliases: Alpha` (block 4) as coming before `Binds: Bewegung`
   * (block 5) even where the profile has Bewegung first. Keeping the prefix is what lets
   * `categoryRegistry` compare only headers from the *same* block and merge the three subsequences
   * back into the one order the file was written from.
   */
  block?: string
  fields: Record<string, string>
}

/** The section a line at `position` sits in: the last header above it in the same file. */
export function sectionFor(
  sections: readonly Section[],
  position: RestoreSourcePosition,
): Section | null {
  let found: Section | null = null
  for (const section of sections) {
    if (section.file === position.file && section.line < position.line) found = section
  }
  return found
}

/** The line number the section after `section` starts at in the same file, or `Infinity`. */
export function sectionEnd(sections: readonly Section[], section: Section): number {
  let end = Number.POSITIVE_INFINITY
  for (const candidate of sections) {
    if (candidate.file !== section.file) continue
    if (candidate.line > section.line && candidate.line < end) end = candidate.line
  }
  return end
}

/** One tagged line, with its parsed tag - the raw material an entry is rebuilt from. */
export interface TaggedLine<T> {
  item: T
  fields: Record<string, string>
  prose: string
}

/**
 * One unbound line, with the two halves `unboundLineParts` split its code out of:
 * `prose` is the display name only (the `TaggedLine` field it stands in for) and `command` is the
 * commented-out `bind`'s own argument - the entry's one command, or `''` for an entry that
 * genuinely has none.
 */
export interface UnboundEntryLine extends TaggedLine<RestoreCommentLine> {
  command: string
}

/** Every line the config text identifies as one entry: the entry's alias line(s), its bind line(s),
 * its anchor line(s) - the comment-only lines `render.ts#buildAnchorLines` writes for a key slot
 * that has no config line of its own because its modifier lives in a layer - and its unbound line,
 * the commented-out `bind` `render.ts#unboundLine` writes for an entry that has none of the other
 * three. */
export interface EntryGroup {
  /**
   * How the text identified this entry: the grouped alias name, the shared bind value, or - for an
   * anchor that matched no entry at all - `anchor:<file>:<line>`. File data, so it doubles as a
   * warning `subject` and as the last-resort display name, the two things the old `e` ref was
   * borrowed for.
   *
   * The *map* key `groupEntryLines` files a group under is this plus the line's category scope
   * (see `groupFor` there) - not repeated here, because a warning must name what the file says, not
   * an internal scope token.
   */
  key: string
  aliases: TaggedLine<RestoreAliasLine>[]
  binds: TaggedLine<RestoreBindLine>[]
  anchors: TaggedLine<RestoreCommentLine>[]
  /**
   * The group's unbound line(s) - at most one in a launcher-written file.
   *
   * Never together with a `bind` or an anchor line: those two *are* key claims, and the writer emits
   * this line precisely because the entry has none (`render.ts#isUnboundEntry`).
   *
   * **With an alias line, though, it now can be**: a keyless `bind`/`message`
   * entry with a body has both, the alias line for what it runs and the unbound line for its empty
   * key slot. `groupEntryLines#matchUnbound` is what joins those two into this one group - by the
   * `an` field (else the commented-out bind's own value, which is the same `aliasNameFor` either
   * way), onto an alias-line group of the same category that claims no key and whose `cid` agrees.
   * Without that join the two lines became two entries: one alias row and one keyless bind row, both
   * carrying the same name and body.
   *
   * Everything the join cannot vouch for keeps a group of its own (`unbound:<file>:<line>`) instead,
   * which is also every unbound line's shape before D1. Two rows the file legitimately spells the
   * same way - two commandless seeded rows in one category, whose bodies are both `""` - must not
   * collapse into one, and a merge there is exactly the "one row loses its name, its commands and
   * its keys" failure `matchAnchor`'s own doc comment refuses to risk.
   */
  unbounds: UnboundEntryLine[]
}

/**
 * The prefix this module gives a heuristically-detected sub-category's synthetic `sub` key (story
 * 053 D4), so that a foreign, untagged second-level marker can reuse every mechanism D3 built for a
 * tagged `[q2l sub=…]` banner - `registerSubcategory`, `categoryKeyFor`, `idFor`,
 * `subcategoryIdFor` - all keyed off `section.fields.sub` and none of them caring *where* that value
 * came from. Prefixed (rather than a bare line number) so a caller can tell "this section's identity
 * is inferred, not stated by the file" apart from a real `sub=` value without a second field.
 */
export const HEURISTIC_SUBCATEGORY_PREFIX = 'heur:'
