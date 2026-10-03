import type { AltLayer } from '@shared/config/aliases/alt-layers'
import type { ImportedActionsResult } from '@shared/config/aliases/alias-import'
import type { ConfigAction, ConfigActionCategory, ConfigCvarSection } from '@shared/modules/config'

/** Where a line came from; `file` is required because a line number alone is ambiguous across files. */
export interface RestoreSourcePosition {
  file: string
  line: number
}

export interface RestoreAliasLine extends RestoreSourcePosition {
  name: string
  body: string
  /** The line's trailing comment (marker stripped), `''` when it had none. */
  comment: string
  /** Characters before the `//` marker, separator included (`config-parser.ts#ParsedAlias.codeWidth`); lets `proseCutOf` tell a shortened prose from another name. Absent: equality, which splits rather than merges. */
  codeWidth?: number
}

/** One live `bind <key> <command>` line, after `unbind`/`unbindall` folding. */
export interface RestoreBindLine extends RestoreSourcePosition {
  key: string
  command: string
  comment: string
}

/**
 * One live `set <name> <value>` line, read for its trailing comment only (it is not an entry).
 * `file`/`line` are the last assignment; `firstFile`/`firstLine` (default: the same) the first,
 * which claims the name for section attribution (`readCvarSections`).
 */
export interface RestoreCvarLine extends RestoreSourcePosition {
  name: string
  value: string
  comment: string
  firstFile?: string
  firstLine?: number
}

export interface RestoreCommentLine extends RestoreSourcePosition {
  text: string
}

export interface RestoreProfilePartsInput {
  aliases: readonly RestoreAliasLine[]
  binds: readonly RestoreBindLine[]
  cvars: readonly RestoreCvarLine[]
  comments: readonly RestoreCommentLine[]
  /** "Attempt as layer" answers for `buildImportedActions` on the untagged path; ignored when tagged. */
  layerAliases?: readonly string[]
  newId: () => string
}

/**
 * Why a restore had something to say about a line. Reasons, never prose: each maps to an i18n
 * key, so nothing user-visible is authored here.
 */
export type RestoreWarningReason =
  | 'metadata-version-newer'
  | 'metadata-version-invalid'
  /** Tags exist but no `v` marker does - the header block's marker was hand-deleted. */
  | 'metadata-version-missing'
  | 'tag-malformed'
  /** An `alias` line carries no `[q2l` tag - reconstructed through the inference, not dropped. */
  | 'tag-missing'
  | 'tag-unknown-keys'
  | 'tag-modifier-unknown'
  | 'entry-section-unknown'
  /** Produced by the fold in `file-source.ts#discardedAliasWarnings`, not by this module; listed here because `ParsedCanonicalProfile.warnings` is the one list the read path carries. */
  | 'entry-alias-duplicate'
  /** A layer section's `mode` tag disagreed with the alias names the section actually contains. */
  | 'layer-mode-contradicted'
  /** A layer section's `trigger` tag disagreed with the section's own trigger bind. */
  | 'layer-trigger-contradicted'


export interface RestoreWarning {
  reason: RestoreWarningReason
  file: string
  line: number
  /** The offending value (a key name, a list of unknown tag keys) - file data, never prose. */
  subject?: string
}

/** Reason -> i18n key. A total record, so a new reason fails the build until it has a key. */
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
  /** Only categories that had to be created locally - a built-in `cat` id is adopted, not created. */
  categories: ConfigActionCategory[]
  /** The cvar sections as the file's banners state them; never the reserved `Defaults`/`Other` buckets, so those cvars read back unplaced. */
  cvarSections: ConfigCvarSection[]
  layers: AltLayer[]
  warnings: RestoreWarning[]
  /** The profile id the ownership stamp names, reported for the import dialog, never adopted; `null` if none. */
  sourceProfileId: string | null
  /** The `v` the file was written with; `null` for a foreign config or a hand-deleted marker (the warning tells them apart). */
  metadataVersion: number | null
  ambiguous: ImportedActionsResult['ambiguous']
  /** Comment lines fully understood as a recognised tag, so `import.ts` can subtract them from `preserved`. A malformed tag is never included; empty on the untagged path. */
  consumedCommentLines: RestoreSourcePosition[]
}

/**
 * One section header, in document order. `'plain'` is an untagged banner; `'other'` the reserved
 * "Other"/"Other binds" bucket (`OTHER_BUCKET_TITLES`); `'subcategory'` a `[q2l sub=…]` banner;
 * `'cvarsection'`/`'cvarsubsection'` the `[q2l cvs=…]`/`[q2l cvsub=…]` pair one namespace over.
 */
export interface Section extends RestoreSourcePosition {
  kind: 'category' | 'subcategory' | 'layer' | 'plain' | 'other' | 'cvarsection' | 'cvarsubsection'
  title: string
  /**
   * For `'subcategory'`/`'cvarsubsection'`: the nearest preceding `'category'`/`'cvarsection'`
   * header in the same file. `undefined` when there is none - the section still opens, but its
   * lines fall into the shared fallback drawer like any tagged line with no section.
   */
  parent?: Section
  /** The `TITLE_PREFIXES` entry that opened this header, if any. `categoryRegistry` compares headers of one block only, to merge `render.ts`'s three per-category passes back into written order. */
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

/** One unbound line: `prose` is the display name, `command` the commented-out `bind`'s argument (`''` if none). */
export interface UnboundEntryLine extends TaggedLine<RestoreCommentLine> {
  command: string
}

/**
 * Every line the config text identifies as one entry: alias line(s), bind line(s), anchor line(s)
 * (`render.ts#buildAnchorLines`) and its unbound line (`render.ts#unboundLine`).
 */
export interface EntryGroup {
  /**
   * How the text identified the entry: the alias name, the shared bind value, or
   * `anchor:<file>:<line>`. File data, so it doubles as a warning `subject`; the map key in
   * `groupEntryLines` adds the category scope (`groupFor`), which a warning must not expose.
   */
  key: string
  aliases: TaggedLine<RestoreAliasLine>[]
  binds: TaggedLine<RestoreBindLine>[]
  anchors: TaggedLine<RestoreCommentLine>[]
  /**
   * At most one; never with a `bind` or anchor line (`render.ts#isUnboundEntry`), but it can sit with
   * an alias line - `groupEntryLines#matchUnbound` joins them. What it cannot vouch for keeps its
   * own group (`unbound:<file>:<line>`), so two identically spelled rows never collapse.
   */
  unbounds: UnboundEntryLine[]
}

/**
 * Prefix of a heuristically-detected sub-category's synthetic `sub` key, so a foreign untagged
 * marker reuses every mechanism built for a tagged `[q2l sub=…]` banner (all keyed off
 * `section.fields.sub`) and an inferred identity stays distinguishable from a real one.
 */
export const HEURISTIC_SUBCATEGORY_PREFIX = 'heur:'
