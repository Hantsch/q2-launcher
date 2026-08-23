/**
 * Reconstruction: a launcher-written file's metadata + its config lines -> profile parts
 * (story 042, D4).
 *
 * `render.ts` (D2) writes what the plain Quake II syntax has no place for into `[q2l …]` tags;
 * `config-parser.ts`/`import-reader.ts` (D3) now hand those comments back; `profile-metadata.ts`
 * (D1) owns the grammar. This module is the one that decides what a parsed tag *means* - and, more
 * importantly, what happens when it means something the config line it sits on does not support.
 *
 * Same shape as `alias-import.ts` next door: plain data in, `newId` injected, parts out, no
 * `node:*`, no DOM, no electron. Pure because the import preview (renderer, later) and the commit
 * (main) must agree byte-for-byte about what a file restores to.
 *
 * ## The one rule: the config line wins
 *
 * A tag is a *record* of what the UI knew; the config line is the *observable state* of the file
 * the engine will actually read. Where the two disagree - the tag claims `k=alias` for an entry a
 * `bind` line points a key at, a `mod` value that is not a modifier, two lines claiming the same key
 * slot - the line wins and the discrepancy is reported (AC6). A malformed tag degrades that one
 * line to inference and is reported (AC5); it never fails the file and never discards the line, and
 * it cannot: `profile.binds`/`profile.cvars` are imported from the parsed lines directly by
 * `import.ts`, entirely independent of anything here. The worst a mangled tag can cost is the
 * *entry* (the Controls-tab row) that would have owned a bind - never the bind itself.
 *
 * ## Two paths, and why the second one is a delegation
 *
 * - **No `[q2l …]` anywhere** - a foreign config (`dm.cfg`). Then this is not a 042-era file at
 *   all and `buildImportedActions` (story 041) is called wholesale: same input, same `newId`, its
 *   result returned as-is. AC8 ("a foreign config still imports exactly as story 041 leaves it") is
 *   therefore a pure delegation rather than a second implementation that could drift - and
 *   `profile-restore.test.ts` pins it by calling both functions on one input and comparing.
 * - **A tag exists** - reconstruction from the record, described below. `v` is looked for in the
 *   header block's comment lines; a `v` larger than `META_FORMAT_VERSION` is not fatal (AC9), a
 *   missing `v` next to tags that *do* exist means a hand-deleted header, and both are reported
 *   rather than treated as "not our file".
 *
 * ## How an entry is put back together
 *
 * `e` (an FNV-1a of the original `action.id`, never an index) is the join key: every line carrying
 * the same `e` belongs to one entry. That is what pairs the two physical `bind` lines of a two-slot
 * entry (`slot=1` -> `key`, `slot=2` -> `secondaryKey`) and what ties them to the `alias` line that
 * defines what the entry *does*. The id itself is never adopted - `e` is an opaque token here, and
 * every id in the result comes from `newId` (AC4's rule, applied to entries, categories and layers
 * alike: importing a colleague's file must not collide with a local profile).
 *
 * What comes from where:
 *
 * | field                     | source                                                        |
 * | ------------------------- | ------------------------------------------------------------- |
 * | display `name`            | the comment's prose (story 040), alias line first             |
 * | `kind`                    | `k`, reconciled against the line (see `resolveKind`)          |
 * | `catalogId`               | `cid`                                                          |
 * | `aliasName`               | the alias line's own name; for an anchor-only entry, its `an`  |
 * | `commands` + their order  | the alias line's body, in body order                          |
 * | `keepEmptyAlias`          | a rendered `alias <name> ""`                                   |
 * | `key`/`secondaryKey`      | the `slot`-tagged bind (or anchor) lines sharing this `e`      |
 * | modifiers                 | a slot's own `mod`, or the modifier layer that overrides it     |
 * | `categoryId`              | the section header the line sits under                         |
 *
 * ## Sections, and why attribution is positional
 *
 * A `[q2l cat=<id>]` / `[q2l layer=<ref> mode=… trigger=…]` comment opens a section that runs until
 * the next section header in the same file; a line belongs to the last header above it. That is the
 * User's own decision (the category lives on the header, not on a per-entry tag), and it is why
 * every input line carries `file`/`line`: without a position, a line cannot be attributed to a
 * section at all. A built-in `cat` id is adopted verbatim; any other mints one local category per
 * distinct id, named from the header's prose title - a colleague's category id means nothing here,
 * their category *name* does.
 *
 * An **untagged** banner (a cvar group, the `Other binds` section, a hand-written header in a file
 * that is otherwise ours) opens a section too, named from its title, and two adjacent untagged
 * banners collapse into one `Main / Sub` category - the read-only two-level capability the User
 * asked for, applied where the file offers it. Nothing is minted for a section no entry lands in,
 * so the cvar-group banners of a normal launcher file produce no categories at all.
 *
 * ## Layers, and the one thing the tags cannot say
 *
 * A layer section header records the layer's identity, `mode` and `trigger`. Its *overrides* have no
 * per-line tag - `generateLayerAliases` renders a whole layer as one `+x`/`-x` (or `x_on`/`x_off`)
 * alias pair, so there is no per-override line for a tag to ride on. They are therefore read the way
 * story 016's mirror wrote them: out of the apply half's `bind <key> <command>` segments (following
 * `_p<n>` chunks and `_c<n>` helper aliases), exactly the shape that generator emits. `mode` and
 * `triggerKey` are cross-checked against those same lines - the alias *names* say whether a layer is
 * hold or toggle, and the section's own `bind` line says which key really reaches it - so here too
 * the file outranks the tag.
 *
 * A modifier binding (story 016's `Alt+R`) is not a bind line anywhere: it lives as an override in
 * the layer whose trigger is `ALT`. So after the entries and layers are back, every override in an
 * `ALT`/`CTRL`/`SHIFT`-triggered layer whose value is an entry's own mirrored value
 * (`bindValueFor`) hands that entry a modified key slot. The layer keeps the override - it is a
 * derived mirror of exactly that field, and `applyActionLayerMirror` would write it back
 * identically - so recording it on both sides is the profile's own invariant, not a duplication.
 *
 * That value match needs an entry to match *against*, and an entry bound only through a modifier has
 * neither an alias line nor a bind line to be rebuilt from - it used to be lost entirely. Since the
 * story-042 review fixes the writer gives every such slot an **anchor line**: a comment-only,
 * `[q2l e=… k=… cid=… an=… slot=… mod=… key=…]`-tagged line under its own category section
 * (`render.ts#buildAnchorLines`). It is read here like any other tagged line, fills its slot from
 * its own `slot`/`mod`/`key`, and its command is then taken from the layer override it names - the
 * only place the file records what such an entry actually does. A modified slot is anchored even
 * when the entry keeps an alias line, since that line carries no `slot`/`mod`: without the anchor,
 * an entry whose *both* slots are modified had its primary and secondary decided by the guessed
 * (modifier, key) fallback in `restoreModifierSlots` rather than by the file.
 *
 * An anchor with no `slot`/`key` at all is *read* here - it restores the entry's identity (name,
 * `kind`, `categoryId`, `catalogId`, `aliasName`) but not its `commands`, since with no key, no
 * alias line and no layer override the file records nowhere what such an entry runs. The writer no
 * longer emits that shape (see `render.ts#buildAnchorLines` for why an entry with no line at all is
 * deliberately dropped on import instead), so it only reaches this module out of a hand-edited or
 * older file - and tolerating one costs nothing, whereas refusing it would throw away a record the
 * user did not touch.
 */

import type { AltLayer, AltLayerMode } from '@shared/config/alt-layers'
import { bindValueFor } from '@shared/config/action-mirror'
import {
  buildImportedActions,
  configCommandFor,
  entryKindFor,
  splitAliasBody,
  type ImportedActionsResult,
} from '@shared/config/alias-import'
import { splitTopLevelSemicolons, tokenize } from '@shared/config/command-tokenizer'
import { normalizeBindKey } from '@shared/config/key-names'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import { META_FORMAT_VERSION, parseMetaTag } from '@shared/config/profile-metadata'
import {
  HAND_EDIT_SENTENCE,
  OTHER_CATEGORY_LABEL,
  OWNERSHIP_MARKER,
  UNOWNED_BINDS_LABEL,
} from '@shared/config/render'
import { STEP_ALIAS_PREFIX, SWITCH_ALIAS } from '@shared/config/switch-bind'
import {
  BUILT_IN_ACTION_CATEGORIES,
  type ActionEntryKind,
  type ConfigAction,
  type ConfigActionCategory,
  type ConfigCommand,
} from '@shared/modules/config'

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

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
}

/** One live `bind <key> <command>` line, after `unbind`/`unbindall` folding. */
export interface RestoreBindLine extends RestoreSourcePosition {
  key: string
  command: string
  comment: string
}

/** One live `set <name> <value>` line. Read for its trailing comment only - a `set` line is not an
 * entry and carries no tag of its own (`render.ts`), so the only thing a cvar's comment can
 * contribute here is a *report* that someone hand-edited a tag into or out of it. */
export interface RestoreCvarLine extends RestoreSourcePosition {
  name: string
  value: string
  comment: string
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
  /** `k` was a value that is not an `ActionEntryKind`. */
  | 'tag-kind-unknown'
  /** `k` contradicted the line: an alias entry is never bound, yet a bind line claimed this entry. */
  | 'tag-kind-contradicted'
  /** Two lines claimed the same key slot of one entry; the first one kept it. */
  | 'tag-slot-conflict'
  /** `mod` was a value that is not a `ModifierTrigger`. */
  | 'tag-modifier-unknown'
  /** A tagged line sits under no section header, so its category could not be recovered. */
  | 'entry-section-unknown'
  /** A layer section's `mode` tag disagreed with the alias names the section actually contains. */
  | 'layer-mode-contradicted'
  /** A layer section's `trigger` tag disagreed with the section's own trigger bind. */
  | 'layer-trigger-contradicted'
  /** A modifier layer overrides a key for an entry whose two slots are already both taken. */
  | 'modifier-slot-unavailable'

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

export interface RestoreProfilePartsResult {
  actions: ConfigAction[]
  /** Only the categories that had to be created locally - a built-in `cat` id is adopted, not created. */
  categories: ConfigActionCategory[]
  layers: AltLayer[]
  /** Every discrepancy, malformed tag and unrecognised field, in the order they were met. */
  warnings: RestoreWarning[]
  /** The profile id the file's ownership sentinel names, reported so the import dialog can say
   * *which* profile is being restored - never adopted (AC4). `null` for a file with no sentinel. */
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

// ---------------------------------------------------------------------------
// Comment scanning: the sentinel, the version marker, the section headers
// ---------------------------------------------------------------------------

/** The sentinel's text as the parser hands it over, i.e. `OWNERSHIP_MARKER` with the `//` marker
 * stripped. Derived from that constant rather than restated, so the two can never drift. */
const SENTINEL_TEXT = OWNERSHIP_MARKER.replace(/^\/\/\s*/, '')

/** `banner()`'s `brackets`-style fixed prefix/suffix (`cfg-layout.ts`'s `// ----- [ <line> ] -----`,
 * `//` already stripped) - exact literal anchors, not a character class, so `bannerTitle` strips
 * only `banner()`'s own decoration and never a title that happens to contain the same characters. */
const BRACKETS_PREFIX = '----- [ '
const BRACKETS_SUFFIX = ' ] -----'

/** `banner()`'s `dashes`-style fixed prefix (`// --- <line> ----...`, `//` already stripped) and its
 * variable-length fill: a single space then a run of `-` to the end of the string - the only shape
 * `banner()`'s dashes branch ever produces after that prefix. */
const DASHES_PREFIX = '--- '
const DASHES_SUFFIX = / -+$/

/** A run of rule characters long enough to call a comment line a banner. Three, so the single
 * hyphens in the sentinel and the hand-edit sentence are not mistaken for decoration. */
const BANNER_RULE = /-{3,}|={3,}/

/** Exactly what `switch-bind.ts#stepAliasName` generates (`STEP_ALIAS_PREFIX` then one or more
 * digits, nothing else) - not a bare `startsWith`, which would also swallow a hand-added alias that
 * merely starts with the same prefix (e.g. `q2l_sword`). */
const STEP_ALIAS_NAME = new RegExp(`^${STEP_ALIAS_PREFIX}\\d+$`)

/** The three title prefixes `render.ts` puts in front of a category name (`Aliases: Weapons`,
 * `Binds: Weapons`, `Entries: Weapons`). Stripped when a title is read back as a category name, or a
 * custom category would come back renamed - and the round-trip would stop being a fixed point. A
 * category the user really did name `Binds: x` loses that prefix once; the alternative is every
 * restored custom category gaining one. */
const TITLE_PREFIXES = ['Aliases: ', 'Binds: ', 'Entries: ']

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
 * under that style specifically (story-042-review round 6). */
const CATEGORY_TITLE_PREFIX = new RegExp(`^(?:${TITLE_PREFIXES.map((p) => p.trim().slice(0, -1)).join('|')}): `)

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
interface ParsedComment {
  /** Everything before the tag: the display name, or a banner's title. */
  prose: string
  fields: Record<string, string>
  unknownKeys: string[]
  malformed: boolean
  /** Did the line carry a `[q2l` at all (well-formed or not)? */
  tagged: boolean
  /** Did `tagEndIndex` actually find and cut off a well-formed tag tail (`[q2l …]` followed by
   * nothing but decoration)? `bannerTitle` (story-042-review round-5, fix-cycle-7) needs this,
   * distinct from `tagged`: when this is `true`, `prose` never contains `banner()`'s trailing fill -
   * it was sliced away *before* `parseMetaTag` ever saw it - so a title ending in its own real
   * `<space>-+` cannot be told apart from stripped fill, and `bannerTitle` must not try. When
   * `tagged` is `true` but this is `false` (a `[q2l` present but too malformed for `tagEndIndex` to
   * find a clean tail), `prose` is the *whole* raw text and may still carry real fill, same as an
   * untagged banner. */
  tagSliced: boolean
}

/** Index just past a well-formed tag's `]`, or `-1` when the text carries no tag whose tail is
 * followed by nothing but decoration. */
function tagEndIndex(text: string): number {
  const sigil = text.lastIndexOf('[q2l')
  if (sigil === -1) return -1
  const close = text.indexOf(']', sigil)
  if (close === -1) return -1
  return /^[\s\-=[\]]*$/.test(text.slice(close + 1)) ? close + 1 : -1
}

function parseComment(text: string): ParsedComment {
  const end = tagEndIndex(text)
  const parsed = parseMetaTag(end === -1 ? text : text.slice(0, end))
  return { ...parsed, tagged: text.includes('[q2l'), tagSliced: end !== -1 }
}

/**
 * Is this comment-only line claimed by the *entry* scan - i.e. is it an anchor line
 * (`render.ts#buildAnchorLines`), or any other tagged line kind that names an entry?
 *
 * The one predicate both scans over the comment lines consult, because they must agree: a line the
 * anchor scan in `groupByEntryRef` takes as an entry anchor must never *also* be read as a section
 * header by `scanComments`. It could, before this was factored out - the banner test only looked at
 * the line's prose, so an anchor whose display name happened to contain three consecutive `-` or `=`
 * characters (`Strafe --- left`, a name nothing stops a user typing) was read as an untagged banner
 * as well: it minted a bogus category named after that prose and re-filed every line below it in the
 * same section under it, with no warning and no way for a fixed-point test on the rendered text to
 * notice, since the second render is a valid file - just a different profile.
 *
 * A `cat`/`layer`/`v` field is what makes a tagged line a *header* rather than an entry line, so a
 * line carrying one is not claimed here even if someone hand-edited an `e` into it. Malformedness is
 * deliberately not consulted: `parseMetaTag` yields `fields: {}` for a tag it could not parse at all
 * (so `e` is absent and this returns `false` anyway), and for a tag with one garbled token among
 * good ones the entry scan does claim the line - this predicate has to say the same thing it does.
 */
function claimsEntryRef(parsed: ParsedComment): boolean {
  const ref = parsed.fields.e
  if (ref === undefined || ref.length === 0) return false
  return (
    parsed.fields.cat === undefined &&
    parsed.fields.layer === undefined &&
    parsed.fields.v === undefined
  )
}

/** Pure `banner()` decoration and nothing else - the header block's own `=`-rule lines
 * (`buildHeaderBlock`), post-`//`-strip. Used only to recognise (and zero out) a rule line that
 * `BANNER_RULE` would otherwise misread as an untagged section title with real content. */
const PURE_DECORATION = /^[\s\-=[\]]*$/

/**
 * A banner line's title: the prose with `banner()`'s own decoration and one `Aliases: `/`Binds: `
 * prefix off.
 *
 * Story-042-review finding 3 (fix-cycle-5 continuation): the original implementation stripped any
 * leading/trailing *run of decoration-class characters* (`-`, `=`, `[`, `]`, whitespace)
 * unconditionally, which is not the inverse of what `banner()`/`titledSection` actually write - a
 * custom category legitimately named e.g. `Tier-1-`, `[Prototype]` or `Setup =` had that real,
 * user-typed edge eaten as if it were decoration, breaking AC2's fixed point for exactly those
 * names. `banner()` only ever wraps content in one of three *exact, known* shapes (`style`'s three
 * cases), so this now recognises each shape by its fixed anchor and strips only that anchor -
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
 *   `''` so the caller's `title.length > 0` guard rejects it, matching the old blunt strip's one
 *   useful side effect without resurrecting its harmful one.
 *
 * Story-042-review round-5, finding 4 (fix-cycle-7): `tagSliced` (`ParsedComment`'s own field) is
 * what actually distinguishes "no fill is present to strip" from "fill was stripped already" - NOT
 * a `BANNER_WIDTH` coincidence, which was the wrong story. `parseComment`'s `tagEndIndex` cuts a
 * well-formed tag's *entire* tail (tag plus everything after it, all decoration by construction) off
 * before `parseMetaTag` ever runs, so a *tagged* banner's `prose` never contains fill regardless of
 * how much real fill the file has - and `parseMetaTag` itself trims trailing whitespace, so the one
 * separating space between title and where the tag used to be is gone too. Without `tagSliced`,
 * `DASHES_SUFFIX`'s `/ -+$/` had nothing left to distinguish a real trailing `<space>-+` in the
 * title (`"Weapons -"`, `"Tier -"`) from stripped fill, and eroded it every time - not just in the
 * one documented `BANNER_WIDTH`-exact edge case, but for *any* tagged dashes-style title ending that
 * way, fill present or not. A tagged banner now skips the fill-strip branch entirely; only a
 * genuinely untagged banner (where fill really can still be in `prose`) still tries it, and that
 * exact-width coincidence remains the one honestly-unreached limitation.
 */
function bannerTitle(prose: string, tagSliced: boolean): string {
  const trimmedStart = prose.replace(/^\s+/, '')
  let bare: string
  if (trimmedStart.startsWith(BRACKETS_PREFIX)) {
    const rest = trimmedStart.slice(BRACKETS_PREFIX.length)
    // Story-042-review round-5, finding 4 (fix-cycle-7): same fix as `dashes` below, for the same
    // reason - a *tagged* brackets banner's `rest` never legitimately ends in the real
    // `BRACKETS_SUFFIX` (`tagEndIndex` already cut that whole closing `] -----` off along with the
    // tag), so checking for it here only ever matches a title whose own text happens to end in that
    // literal 8-character string (a custom category deliberately or accidentally named e.g.
    // `----- [ Nested ] -----`) - a false positive that strips real content, not decoration. Only a
    // genuinely untagged brackets banner can still have the real suffix in `rest` at all.
    bare =
      !tagSliced && rest.endsWith(BRACKETS_SUFFIX) ? rest.slice(0, -BRACKETS_SUFFIX.length) : rest.trimEnd()
  } else if (trimmedStart.startsWith(DASHES_PREFIX)) {
    const rest = trimmedStart.slice(DASHES_PREFIX.length)
    const fill = tagSliced ? null : DASHES_SUFFIX.exec(rest)
    bare = fill ? rest.slice(0, fill.index) : rest.trimEnd()
  } else if (PURE_DECORATION.test(trimmedStart)) {
    bare = ''
  } else {
    bare = trimmedStart.trimEnd()
  }
  const prefix = TITLE_PREFIXES.find((candidate) => bare.startsWith(candidate))
  return prefix ? bare.slice(prefix.length) : bare
}

/** The reserved, non-user-configurable "Other"/"Other binds" bucket titles (`render.ts`) - see
 * `categoryRegistry`'s `'other'` kind for why these get their own `Section.kind` rather than
 * falling through the generic untagged-banner path. */
const OTHER_BUCKET_TITLES = new Set<string>([OTHER_CATEGORY_LABEL, UNOWNED_BINDS_LABEL])

/** One section header, in document order. `kind: 'plain'` is an untagged banner; `kind: 'other'` is
 * specifically the reserved "Other"/"Other binds" bucket (see `OTHER_BUCKET_TITLES`). */
interface Section extends RestoreSourcePosition {
  kind: 'category' | 'layer' | 'plain' | 'other'
  /** The header's own title, decoration stripped - a category name, or a layer's rendered title. */
  title: string
  /** The combined `Main / Sub` name for the second of two adjacent untagged banners. */
  pairedTitle?: string
  fields: Record<string, string>
}

interface CommentScan {
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
const HEADER_RULE = /^=+$/

/**
 * `buildHeaderBlock` (`render.ts`) always emits exactly four consecutive comment lines around the
 * version-tag line at `comments[versionIndex]`: a `=`-rule, the name+tag line itself, the fixed
 * `HAND_EDIT_SENTENCE`, and a closing `=`-rule. None of the other three carry a tag of their own,
 * so without this they fall through to `preserved` as "unrecognised" - which for a real file is both
 * misleading (this *is* recognised, launcher-owned decoration) and, being a single long line in a
 * single-line code view, the source of an axe `scrollable-region-focusable` violation in the import
 * dialog.
 *
 * Deliberately positional-and-content-checked, not positional alone: each neighbour is consumed
 * only if it is immediately adjacent by line number (same file, `line ± 1`/`± 2`) *and* matches the
 * exact shape `buildHeaderBlock` produces. A hand-edited or missing neighbour simply is not
 * consumed and stays visible in `preserved` - never a crash, never a wrong guess.
 */
function consumeHeaderDecoration(
  comments: readonly RestoreCommentLine[],
  versionIndex: number,
  file: string,
  line: number,
  consumed: RestoreSourcePosition[],
): void {
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

/**
 * One pass over the comment-only lines: the ownership sentinel, the `v` marker, and the section
 * headers in document order.
 *
 * The sentinel found in the *same file* as the version marker wins, since that is the profile file
 * whose metadata is being read; a loader `autoexec.cfg` carries a sentinel of its own (naming
 * whichever profile was the installation's default) and must not outvote it.
 */
function scanComments(comments: readonly RestoreCommentLine[]): CommentScan {
  const warnings: RestoreWarning[] = []
  const sections: Section[] = []
  const sentinels: { id: string; file: string }[] = []
  const consumed: RestoreSourcePosition[] = []
  let version: CommentScan['version'] = null
  let anyTag = false

  for (let index = 0; index < comments.length; index++) {
    const comment = comments[index]!
    const { file, line } = comment
    const trimmed = comment.text.trim()

    if (trimmed.startsWith(SENTINEL_TEXT)) {
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
      continue
    }

    const parsed = parseComment(comment.text)
    if (parsed.tagged) anyTag = true
    if (parsed.malformed) warnings.push({ reason: 'tag-malformed', file, line })
    if (parsed.unknownKeys.length > 0) {
      warnings.push({ reason: 'tag-unknown-keys', file, line, subject: parsed.unknownKeys.join(',') })
    }

    if (parsed.fields.v !== undefined && version === null) {
      const value = Number(parsed.fields.v)
      const valid = Number.isInteger(value) && value > 0
      if (!valid) {
        warnings.push({ reason: 'metadata-version-invalid', file, line, subject: parsed.fields.v })
      } else if (value > META_FORMAT_VERSION) {
        warnings.push({ reason: 'metadata-version-newer', file, line, subject: parsed.fields.v })
      }
      version = { value: valid ? value : null, file, line }
      if (!parsed.malformed) {
        consumed.push({ file, line })
        consumeHeaderDecoration(comments, index, file, line, consumed)
      }
    }

    const title = bannerTitle(parsed.prose, parsed.tagSliced)
    if (parsed.fields.cat !== undefined) {
      sections.push({ kind: 'category', title, fields: parsed.fields, file, line })
      if (!parsed.malformed) consumed.push({ file, line })
    } else if (parsed.fields.layer !== undefined) {
      sections.push({ kind: 'layer', title, fields: parsed.fields, file, line })
      if (!parsed.malformed) consumed.push({ file, line })
    } else if (!claimsEntryRef(parsed) && title.length > 0 && OTHER_BUCKET_TITLES.has(title)) {
      // Story-042-review round 5, fix-cycle-8: the reserved "Other"/"Other binds" bucket gets its
      // own section kind, recognised by its fixed, non-user-configurable title rather than by
      // `BANNER_RULE`'s decoration test - `plain` header style draws no decoration at all
      // (`cfg-layout.ts#banner`'s `plain` branch), so `BANNER_RULE` can never flag this line as a
      // section under that style, and every entry physically after it was silently re-filed into
      // whichever *earlier* tagged category happened to precede it instead (`sectionFor` finds the
      // nearest preceding section of any kind). Checked ahead of the generic untagged-banner branch
      // below so `dashes`/`brackets` (where `BANNER_RULE` *would* otherwise match) get the same
      // `'other'` kind too, instead of minting a real, persisted "Other" category - seeing
      // `categoryRegistry`'s `'other'` case for why that minting broke AC2 one render later.
      sections.push({ kind: 'other', title, fields: parsed.fields, file, line })
    } else if (
      !claimsEntryRef(parsed) &&
      title.length > 0 &&
      (BANNER_RULE.test(comment.text) || CATEGORY_TITLE_PREFIX.test(comment.text.trim()))
    ) {
      // An untagged banner - a cvar group, or a hand-written header in a file that is otherwise
      // ours (never the reserved "Other"/"Other binds" bucket - that is claimed by the branch just
      // above, regardless of header style). It opens a section all the same; whether anything is
      // ever filed under it decides whether a category gets minted for it.
      //
      // `claimsEntryRef` first, and only then the decoration test: an entry line's prose is a
      // user-typed display name and may contain anything at all, `---` included, so the tag decides
      // what the line *is* and the decoration is only consulted for a line no tag has claimed.
      //
      // Story-042-review round 6 (fix-cycle-8, second pass): `BANNER_RULE` alone left a real
      // category's header invisible as a section boundary under `plain` style specifically, whenever
      // its `[q2l cat=…]` tag was hand-deleted but the plain `// Aliases: <name>` line itself
      // survived - `plain` style draws no decoration at all for `BANNER_RULE` to match, so the entry
      // silently joined whichever *earlier* real category preceded it instead, with no warning.
      // `CATEGORY_TITLE_PREFIX` closes that: every category section this writer emits, tagged or not,
      // "Other" bucket included, carries one of exactly three fixed prefixes (`TITLE_PREFIXES`) -
      // nothing else this writer emits (a cvar group's plain label, the hand-edit sentence, a layer's
      // `Layer: ` title) starts with one of them, so this is a narrow, safe signal rather than the
      // broader "any untagged comment-only line" heuristic considered and rejected for this same gap
      // (that would just as easily misread an ordinary hand-typed inline comment as a brand new
      // section, silently *splitting* a category instead of silently *merging* one).
      //
      // Round 7's re-review confirmed the narrow signal itself is safe against realistic prose (a
      // comment merely mentioning "Aliases:" or "Bind:" *without* the exact "word + colon + space at
      // the very start of the line" shape never triggers this). It also named the one residual,
      // knowingly-accepted cost of choosing "narrow" over "broad": a hand-typed comment that DOES
      // happen to start with `Aliases: `/`Binds: `/`Entries: ` (e.g. a player's own note "Aliases: my
      // stuff below") is indistinguishable from a real category header with its tag hand-deleted, and
      // this branch cannot tell the two apart - it mints a section for it, silently, same as it would
      // for the genuine case. No warning fires because nothing here is malformed or missing relative
      // to what this line claims to be; the ambiguity is inherent to choosing this narrow, safe
      // signal over a broader, less safe one, not a bug in the signal itself.
      const previous = sections[sections.length - 1]
      // Story-042-review finding 4 (fix-cycle-5 continuation): pairing used to trigger whenever the
      // *previous section pushed at all* was plain, with no regard for what actually sits between
      // the two lines. A launcher-written file has several untagged banners of its own by design -
      // each cvar group, the alias/bind `Other` bucket (`render.ts`'s `categoryTag(null) === ''`),
      // `Other binds` - and whichever of those happened to render immediately before another one (a
      // `Graphics` cvar group followed by the `Other` entries bucket, say) got fused into one
      // fabricated category name (`Graphics / Other`) nothing in the file ever asked for. A genuine
      // two-level header (dm.cfg's `Main Key's` directly above `1st row`) has its two banner lines
      // truly adjacent - nothing else between them, not even a blank line; every one of this
      // writer's own untagged banners is always followed by its own real content (`set` lines, an
      // entry, or at minimum `joinBlocks`' blank-line separator) before the next banner, so requiring
      // exact line adjacency (same file, `line === previous.line + 1`) is what tells the two cases
      // apart without needing to know this module's own label constants.
      const adjacent =
        previous !== undefined && previous.file === file && previous.line === line - 1
      const paired = adjacent && previous.kind === 'plain' ? `${previous.title} / ${title}` : undefined
      sections.push({ kind: 'plain', title, pairedTitle: paired, fields: parsed.fields, file, line })
    }
  }

  const preferred =
    (version && sentinels.find((candidate) => candidate.file === version!.file)) ?? sentinels[0]

  return { version, sourceProfileId: preferred?.id ?? null, sections, anyTag, warnings, consumed }
}

/** The section a line at `position` sits in: the last header above it in the same file. */
function sectionFor(sections: readonly Section[], position: RestoreSourcePosition): Section | null {
  let found: Section | null = null
  for (const section of sections) {
    if (section.file === position.file && section.line < position.line) found = section
  }
  return found
}

/** The line number the section after `section` starts at in the same file, or `Infinity`. */
function sectionEnd(sections: readonly Section[], section: Section): number {
  let end = Number.POSITIVE_INFINITY
  for (const candidate of sections) {
    if (candidate.file !== section.file) continue
    if (candidate.line > section.line && candidate.line < end) end = candidate.line
  }
  return end
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const BUILT_IN_CATEGORY_IDS = new Set<string>(BUILT_IN_ACTION_CATEGORIES.map((c) => c.id))

/** Name for the drawer a tagged entry lands in when its own section cannot be determined - the
 * same plain-English label `alias-import.ts` gives an import's leftovers. */
const FALLBACK_CATEGORY_NAME = 'Imported'

/**
 * Hands out category ids, lazily: a built-in `cat` id verbatim (never created), one `newId()` per
 * distinct unknown `cat` id, one per untagged section, and one shared fallback drawer. Lazy is what
 * keeps a normal launcher file's cvar-group and `Other binds` banners from minting categories
 * nothing is ever filed under.
 */
function categoryRegistry(newId: () => string): {
  idFor: (section: Section | null) => string
  created: () => ConfigActionCategory[]
} {
  const created = new Map<string, ConfigActionCategory>()

  const mint = (key: string, name: string): string => {
    const existing = created.get(key)
    if (existing) return existing.id
    const category: ConfigActionCategory = { id: newId(), name }
    created.set(key, category)
    return category.id
  }

  return {
    idFor(section) {
      if (section === null) return mint('fallback', FALLBACK_CATEGORY_NAME)
      // Story-042-review round 5, fix-cycle-8: the reserved "Other"/"Other binds" bucket
      // (`Section.kind === 'other'`) is deliberately never `mint()`-ed into a real, persisted
      // `ConfigActionCategory` - `ConfigAction.categoryId` still has to be *some* real string (the
      // field is non-nullable), but `render.ts`'s "Other" bucket is defined as "this categoryId
      // matches nothing the profile has" (`groupByCategory`'s trailing bucket), not as a stored
      // `null`. Handing back a fresh id from `newId()` that is never registered anywhere satisfies
      // both: the action gets a valid id, and because that id was never added to any category list,
      // the very next render buckets it right back into the untagged "Other" section - the same
      // outcome the original (unrecoverable) orphaned id would have produced, and the actual fixed
      // point AC2 asks for. Minting a real "Other" category here, as an earlier version of this fix
      // did, created a category the source profile never had and stopped matching nothing on the
      // next render - an AC2 regression discovered by round 5's adversarial pass.
      if (section.kind === 'other') return newId()
      const tagged = section.fields.cat
      if (tagged !== undefined && tagged.length > 0) {
        // A colleague's category id means nothing locally, so an id this build does not recognise
        // mints a local category named from the header's own title (the story's own rule); a
        // built-in id is adopted as-is, and is the one case that creates nothing.
        return BUILT_IN_CATEGORY_IDS.has(tagged) ? tagged : mint(`cat:${tagged}`, section.title)
      }
      return mint(
        `${section.kind}:${section.file}:${section.line}`,
        section.pairedTitle ?? section.title,
      )
    },
    created: () => [...created.values()],
  }
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** One tagged line, with its parsed tag - the raw material an entry is rebuilt from. */
interface TaggedLine<T> {
  item: T
  fields: Record<string, string>
  prose: string
}

/** Every line sharing one `e` ref: the entry's alias line(s), its bind line(s) and its anchor
 * line(s) - the comment-only lines `render.ts#buildAnchorLines` writes for a key slot that has no
 * config line of its own because its modifier lives in a layer. */
interface EntryGroup {
  ref: string
  aliases: TaggedLine<RestoreAliasLine>[]
  binds: TaggedLine<RestoreBindLine>[]
  anchors: TaggedLine<RestoreCommentLine>[]
}

const ENTRY_KINDS = new Set<string>(['bind', 'message', 'alias'])
const MODIFIER_TRIGGERS = new Set<string>(['ALT', 'CTRL', 'SHIFT'])

/** `alias <base>_p<n>` - a chunk of a body too long for one line (`alias-render.ts`). */
const CHUNK_SUFFIX = /^(.*)_p(\d+)$/
/** `alias <base>_c<n>` - a command hoisted out of a layer body (`alt-layers.ts`). */
const HELPER_SUFFIX = /_c\d+$/

/**
 * An entry's commands, in body order, out of the alias line(s) that define it.
 *
 * A body too long for one line was split into `<name>_p<n>` chunks called by a parent whose own
 * body is nothing but their names. Recombining is therefore concatenation in `_p<n>` order - the
 * split only ever happened at a command boundary, so nothing has to be re-parsed to undo it - and
 * the parent's own body is dropped, since it holds the chunk names rather than commands.
 */
function commandsFromAliases(
  lines: readonly TaggedLine<RestoreAliasLine>[],
): { commands: ConfigCommand[]; aliasName: string; emptyBody: boolean } {
  const names = new Set(lines.map((line) => line.item.name))
  const chunks: { index: number; body: string }[] = []
  const parents: RestoreAliasLine[] = []

  for (const line of lines) {
    const match = CHUNK_SUFFIX.exec(line.item.name)
    if (match && names.has(match[1]!)) chunks.push({ index: Number(match[2]), body: line.item.body })
    else parents.push(line.item)
  }

  const parent = parents[0] ?? lines[0]!.item
  const body =
    chunks.length > 0
      ? chunks
          .sort((a, b) => a.index - b.index)
          .map((chunk) => chunk.body)
          .join('; ')
      : parent.body

  return {
    commands: splitAliasBody(body).map(configCommandFor),
    aliasName: parent.name,
    emptyBody: body.trim().length === 0,
  }
}

/**
 * The entry's `kind`, reconciled.
 *
 * `k` is adopted when it is one of the three real kinds and the line supports it. The one shape it
 * cannot be is `alias` on an entry a `bind` line points a key at: a `kind: 'alias'` entry is never
 * bound (story 019), so the writer can never have produced that pair - a bind line claiming it is a
 * hand-edit, and the bind line is the observable truth. An unreadable or absent `k` falls back to
 * what the commands themselves say (`entryKindFor`, the same table the untagged path uses).
 */
function resolveKind(
  tagged: string | undefined,
  commands: readonly ConfigCommand[],
  hasAliasLine: boolean,
  bound: boolean,
  report: (reason: RestoreWarningReason, subject?: string) => void,
): ActionEntryKind {
  const inferred = entryKindFor(commands) === 'message' ? 'message' : bound || !hasAliasLine ? 'bind' : 'alias'

  if (tagged === undefined) return inferred
  if (!ENTRY_KINDS.has(tagged)) {
    report('tag-kind-unknown', tagged)
    return inferred
  }
  if (tagged === 'alias' && bound) {
    report('tag-kind-contradicted', tagged)
    return inferred === 'message' ? 'message' : 'bind'
  }
  return tagged as ActionEntryKind
}

/** A `slot` value as one of the entry's two key slots, or `null` for anything else. */
function slotOf(value: string | undefined): 1 | 2 | null {
  return value === '1' ? 1 : value === '2' ? 2 : null
}

/** One line's claim on a key slot: a bind line (whose key is the config text's own) or an anchor
 * line (whose key is in its tag, since a comment-only line has no code to read it off). */
interface SlotClaim {
  at: RestoreSourcePosition
  fields: Record<string, string>
  key: string
}

/**
 * One entry out of one `e` group.
 *
 * The bind lines fill the two key slots by their own `slot` tag (the two lines of a two-slot entry
 * differ in exactly that field); a line whose slot is already taken is reported and dropped rather
 * than allowed to overwrite the line that claimed it first, because a bind reassigned to the wrong
 * slot is precisely the silent damage this module exists to avoid. A slot with no readable `slot`
 * tag takes the first free one - the file still says this key belongs to this entry, only not which
 * of its two slots.
 *
 * An anchor line claims a slot the same way, and is processed *after* every bind line: a bind line
 * is an observable config line and an anchor is only a record, so where the two disagree the line
 * wins (this module's one rule) and the anchor is reported as a slot conflict.
 */
function buildEntry(
  group: EntryGroup,
  sections: readonly Section[],
  categories: ReturnType<typeof categoryRegistry>,
  newId: () => string,
  warnings: RestoreWarning[],
): ConfigAction {
  const first = group.aliases[0]?.item ?? group.binds[0]?.item ?? group.anchors[0]!.item
  const report = (reason: RestoreWarningReason, subject?: string): void => {
    warnings.push({ reason, file: first.file, line: first.line, subject })
  }

  const fromAliases = group.aliases.length > 0 ? commandsFromAliases(group.aliases) : null
  const commands = fromAliases?.commands ?? []

  const claims: SlotClaim[] = [
    ...group.binds.map((line) => ({ at: line.item, fields: line.fields, key: line.item.key })),
    // An anchor with no `key` field records no slot at all. The writer emits no such line today
    // (`render.ts#buildAnchorLines`), so this is a hand-edited or older file; it still contributes
    // the entry's identity below, just no key.
    ...group.anchors
      .filter((line) => (line.fields.key ?? '').trim().length > 0)
      .map((line) => ({ at: line.item, fields: line.fields, key: line.fields.key!.trim() })),
  ]

  const slots: ({ key: string; modifier?: ModifierTrigger } | undefined)[] = [undefined, undefined]
  for (const claim of claims) {
    const wanted = slotOf(claim.fields.slot)
    // A claim that names a slot (`wanted !== null`) which is already taken is a genuine conflict -
    // it must be reported and dropped here, never silently re-homed into the *other* slot by the
    // `findIndex` fallback below. Falling through there was fix-cycle-5's slot-swap bug: a duplicated
    // `slot=1` tag landed in slot 2 instead of being rejected, quietly turning a conflicting claim
    // into the entry's secondary key. Only a claim with NO slot opinion at all (`wanted === null`,
    // a hand-edited or older line) asks `findIndex` for whichever slot is still free.
    if (wanted !== null && slots[wanted - 1] !== undefined) {
      warnings.push({
        reason: 'tag-slot-conflict',
        file: claim.at.file,
        line: claim.at.line,
        subject: claim.key,
      })
      continue
    }
    const index = wanted !== null ? wanted - 1 : slots.findIndex((slot) => slot === undefined)
    if (index === -1) {
      warnings.push({
        reason: 'tag-slot-conflict',
        file: claim.at.file,
        line: claim.at.line,
        subject: claim.key,
      })
      continue
    }
    const modifier = claim.fields.mod
    if (modifier !== undefined && !MODIFIER_TRIGGERS.has(modifier.toUpperCase())) {
      warnings.push({
        reason: 'tag-modifier-unknown',
        file: claim.at.file,
        line: claim.at.line,
        subject: modifier,
      })
    }
    slots[index] = {
      key: normalizeBindKey(claim.key),
      ...(modifier !== undefined && MODIFIER_TRIGGERS.has(modifier.toUpperCase())
        ? { modifier: modifier.toUpperCase() as ModifierTrigger }
        : {}),
    }
  }

  const bound = group.binds.length > 0
  const fields = group.aliases[0]?.fields ?? group.binds[0]?.fields ?? group.anchors[0]!.fields
  const kind = resolveKind(fields.k, commands, fromAliases !== null, bound, report)

  // The display name is the comment's prose - the alias line's first, since that line *is* the
  // entry; a bind line's prose says the same thing, and a line whose prose gave way to its tag
  // under budget pressure has none at all, which is why there is a fall-back rather than a warning.
  const prose = (
    group.aliases[0]?.prose ??
    group.binds.find((line) => line.prose.trim().length > 0)?.prose ??
    group.anchors.find((line) => line.prose.trim().length > 0)?.prose ??
    ''
  ).trim()

  const section = sectionFor(sections, first)
  if (section === null) report('entry-section-unknown', group.ref)

  const catalogId = fields.cid

  const action: ConfigAction = {
    id: newId(),
    categoryId: categories.idFor(section),
    name: prose.length > 0 ? prose : (fromAliases?.aliasName ?? slots[0]?.key ?? group.ref),
    kind,
    // A body's own order is the command order (the story's decision: the config text already
    // carries it, so no tag repeats it). With no alias line at all - a continuous catalogue row
    // bound to its bare `+command`, or a self-mirroring alias the writer drops - the bind line's
    // command is the entry's one command, which is exactly what that line records.
    commands: fromAliases !== null ? commands : bindCommands(group.binds),
    ...(catalogId ? { catalogId } : {}),
    ...(slots[0] ? { key: slots[0]!.key } : {}),
    ...(slots[1] ? { secondaryKey: slots[1]!.key } : {}),
    ...(slots[0]?.modifier ? { keyModifier: slots[0]!.modifier } : {}),
    ...(slots[1]?.modifier ? { secondaryKeyModifier: slots[1]!.modifier } : {}),
    ...(fromAliases !== null && kind === 'alias' && fromAliases.emptyBody
      ? { keepEmptyAlias: true as const }
      : {}),
  }

  // The alias line's own name is the entry's `aliasName` (story 039) - never a tag, since the line
  // already carries it verbatim. With no alias line there are two fallbacks, in this order:
  //
  // 1. an anchor line's `an` field. An anchor-only entry has no line whose *code* could carry the
  //    name, so the tag is the only place the writer can record it (`render.ts#buildAnchorLines`) -
  //    and with no alias line in the file there is nothing for it to drift from.
  // 2. the bind value: what the file records this entry mirrors as, adopted exactly when the
  //    reconstructed entry would otherwise mirror as something else - which is what keeps a dropped
  //    self-mirroring alias (`alias weapnext weapnext`) from coming back as a second,
  //    differently-named alias line.
  const anchoredAliasName = group.anchors
    .map((line) => (line.fields.an ?? '').trim())
    .find((name) => name.length > 0)
  const aliasName =
    fromAliases !== null
      ? fromAliases.aliasName
      : (anchoredAliasName ?? ownAliasNameFromBind(action, group.binds))
  return aliasName ? { ...action, aliasName } : action
}

/** An aliasless entry's commands: its bind line's command, classified the same way an alias body's
 * segment is (so `bind t "say hi"` comes back as a message, not as raw text). */
function bindCommands(binds: readonly TaggedLine<RestoreBindLine>[]): ConfigCommand[] {
  const command = binds[0]?.item.command.trim() ?? ''
  return command.length > 0 ? [configCommandFor(command)] : []
}

/**
 * The `aliasName` an entry with no alias line has to carry so that its bind value survives a
 * re-render: the bind command itself, when it is a single token and the entry would otherwise
 * mirror as something else. A continuous catalogue row (`+forward`, whose `bindValueFor` already
 * *is* its command) needs none and must not get one - an explicit `+forward` alias name would make
 * `actionsWithAliasLine` keep an `alias +forward +forward` line the original file never had.
 */
function ownAliasNameFromBind(
  action: ConfigAction,
  binds: readonly TaggedLine<RestoreBindLine>[],
): string | null {
  const command = binds[0]?.item.command.trim() ?? ''
  if (command.length === 0 || /\s/.test(command)) return null
  return bindValueFor(action) === command ? null : command
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** `Layer: <name> (<mode>, on <key>)` / `(… , no trigger key)` - `render.ts`'s own banner title. */
const LAYER_TITLE = /^Layer:\s*(.*)\s+\((hold|toggle),\s*(?:on\s+(.+)|no trigger key)\)$/

interface LayerSectionLines {
  /** Every `alias` line inside the section, by name. */
  bodies: Map<string, string>
  /** The section's own `bind <key> <command>` lines - the trigger bind. */
  triggerBinds: RestoreBindLine[]
}

/** The lines physically inside a layer section: from its header down to the next header. */
function linesInSection(
  section: Section,
  sections: readonly Section[],
  aliases: readonly RestoreAliasLine[],
  binds: readonly RestoreBindLine[],
): LayerSectionLines {
  const end = sectionEnd(sections, section)
  const inside = (position: RestoreSourcePosition): boolean =>
    position.file === section.file && position.line > section.line && position.line < end

  const bodies = new Map<string, string>()
  for (const alias of aliases) if (inside(alias)) bodies.set(alias.name, alias.body)
  return { bodies, triggerBinds: binds.filter(inside) }
}

/**
 * A layer's overrides, walked out of its apply half exactly as `generateLayerAliases` wrote them:
 * every top-level `bind <key> <command>` segment is an override, a bare token naming another alias
 * of the same section is a `_p<n>` chunk to follow, and a `_c<n>` helper's body is substituted back
 * in for the command it was hoisted out of. `unbind`/`bind`-to-base segments of the *restore* half
 * are never reached, because the walk starts at the apply half and only follows its own chunks.
 */
function collectOverrides(bodies: Map<string, string>, applyName: string): Record<string, string> {
  const overrides: Record<string, string> = {}
  const visited = new Set<string>()

  const resolveCommand = (command: string): string => {
    const body = HELPER_SUFFIX.test(command) ? bodies.get(command) : undefined
    return body ?? command
  }

  const visit = (name: string): void => {
    if (visited.has(name)) return
    visited.add(name)
    const body = bodies.get(name)
    if (body === undefined) return

    for (const segment of splitTopLevelSemicolons(body).map((part) => part.trim())) {
      if (segment.length === 0) continue
      const tokens = tokenize(segment)
      const head = tokens[0]?.toLowerCase() ?? ''
      if (head === 'bind' && tokens.length >= 3) {
        overrides[normalizeBindKey(tokens[1]!)] = resolveCommand(tokens.slice(2).join(' '))
        continue
      }
      if (tokens.length === 1 && bodies.has(tokens[0]!)) visit(tokens[0]!)
    }
  }

  visit(applyName)
  return overrides
}

/** The mode the section's alias names actually spell: a `+x`/`-x` pair is hold, `x_on`/`x_off` is
 * toggle. This is the config line's own answer, so it outranks a `mode` tag that disagrees. */
function modeFromAliases(names: readonly string[]): AltLayerMode | null {
  const hold = names.some((name) => name.startsWith('+')) && names.some((name) => name.startsWith('-'))
  if (hold) return 'hold'
  const toggle = names.some((name) => name.endsWith('_on')) && names.some((name) => name.endsWith('_off'))
  return toggle ? 'toggle' : null
}

/** The alias the trigger key runs, one hop through a toggle's dispatch alias. */
function applyHalfName(lines: LayerSectionLines, mode: AltLayerMode): string | null {
  const names = [...lines.bodies.keys()]
  const target = lines.triggerBinds[0]?.command.trim()
  if (target && lines.bodies.has(target)) {
    const body = lines.bodies.get(target)!.trim()
    if (mode === 'toggle' && lines.bodies.has(body)) return body
    return target
  }
  return (
    names.find((name) => (mode === 'hold' ? name.startsWith('+') : name.endsWith('_on'))) ?? null
  )
}

function buildLayer(
  section: Section,
  sections: readonly Section[],
  input: RestoreProfilePartsInput,
  warnings: RestoreWarning[],
): AltLayer {
  const lines = linesInSection(section, sections, input.aliases, input.binds)
  const titleMatch = LAYER_TITLE.exec(section.title)

  const taggedMode = section.fields.mode === 'hold' || section.fields.mode === 'toggle' ? section.fields.mode : null
  const spelled = modeFromAliases([...lines.bodies.keys()])
  if (taggedMode !== null && spelled !== null && spelled !== taggedMode) {
    warnings.push({
      reason: 'layer-mode-contradicted',
      file: section.file,
      line: section.line,
      subject: section.fields.mode,
    })
  }
  const mode: AltLayerMode =
    spelled ?? taggedMode ?? (titleMatch?.[2] === 'toggle' ? 'toggle' : 'hold')

  // The section's own `bind <key> …` line is what really reaches this layer from the keyboard; the
  // `trigger` tag is the record of it. They only differ in a hand-edited file, and then the line
  // wins - a trigger the file does not actually bind is not a trigger.
  const boundTrigger = lines.triggerBinds[0] ? normalizeBindKey(lines.triggerBinds[0].key) : null
  const taggedTrigger = section.fields.trigger ? normalizeBindKey(section.fields.trigger) : null
  if (taggedTrigger !== null && boundTrigger !== null && taggedTrigger !== boundTrigger) {
    warnings.push({
      reason: 'layer-trigger-contradicted',
      file: section.file,
      line: section.line,
      subject: section.fields.trigger,
    })
  }

  const applyName = applyHalfName(lines, mode)

  return {
    id: input.newId(),
    name: titleMatch?.[1]?.trim() ?? section.title,
    mode,
    triggerKey: boundTrigger ?? taggedTrigger,
    overrides: applyName === null ? {} : collectOverrides(lines.bodies, applyName),
  }
}

/** A restored layer plus the position of the section header it came from - the locator every warning
 * about one of its overrides carries. The override itself lives inside a generated `+x`/`-x` alias
 * body that may hold every other override of the same layer too, so the section header is the
 * finest-grained *real* file position an override has; anything narrower would be invented. */
interface RestoredLayer {
  layer: AltLayer
  at: RestoreSourcePosition
}

/** One override of one modifier-triggered layer, ready to be handed to an entry. */
interface ModifierOverride {
  modifier: ModifierTrigger
  /** Normalized override key. */
  key: string
  command: string
  at: RestoreSourcePosition
}

/**
 * Every modifier-triggered layer's overrides in **one stable order: modifier, then key**.
 *
 * Deliberately not `layers` array order (nor `Object.entries` insertion order). Which of an entry's
 * two slots an override lands in used to follow whichever layer happened to come first in the array,
 * so two files that differ only in the order their layer sections appear restored the same entry
 * with its primary and secondary key *swapped* - silently, with no warning, and invisibly to a
 * fixed-point test, since both orderings re-render as valid (just different) profiles.
 *
 * For an entry whose slots are both modifier-only there is nothing in the file that records which
 * one was the primary (a modifier slot has no bind line, and the layer's override body carries no
 * per-override tag), so this cannot always restore the original assignment. What it can do - and
 * what matters for "a wrong restore must not reassign a user's binds differently every time" - is be
 * a pure function of the file's own content: the same file always produces the same slot assignment.
 * A slot whose anchor line does record its `slot` (`render.ts#buildAnchorLines`) never reaches
 * this fallback at all - `buildEntry` has already filled it from the tag.
 */
function modifierOverridesInStableOrder(layers: readonly RestoredLayer[]): ModifierOverride[] {
  const overrides: ModifierOverride[] = []
  for (const { layer, at } of layers) {
    const trigger = normalizeBindKey(layer.triggerKey ?? '')
    if (!MODIFIER_TRIGGERS.has(trigger)) continue
    for (const [key, command] of Object.entries(layer.overrides)) {
      overrides.push({
        modifier: trigger as ModifierTrigger,
        key: normalizeBindKey(key),
        command: command.trim(),
        at,
      })
    }
  }
  return overrides.sort((a, b) =>
    a.modifier !== b.modifier
      ? a.modifier < b.modifier
        ? -1
        : 1
      : a.key === b.key
        ? 0
        : a.key < b.key
          ? -1
          : 1,
  )
}

/** Does `action` already hold exactly this `(key, modifier)` slot - because an anchor line's tag
 * said so? Then the override that anchor stands for must not be handed out a second time. */
function holdsModifiedSlot(action: ConfigAction, key: string, modifier: ModifierTrigger): boolean {
  return (
    (action.key !== undefined && normalizeBindKey(action.key) === key && action.keyModifier === modifier) ||
    (action.secondaryKey !== undefined &&
      normalizeBindKey(action.secondaryKey) === key &&
      action.secondaryKeyModifier === modifier)
  )
}

/**
 * Story 016's modifier slots, read back out of the layers that carry them.
 *
 * A captured `Alt+R` is not a bind line anywhere - it is an override in the `ALT`-triggered layer,
 * written as `bindValueFor(action)`. Two passes over the same stably-ordered override list
 * (`modifierOverridesInStableOrder`):
 *
 * 1. **Commands.** An entry rebuilt from an anchor line alone (no alias line, no bind line - see
 *    `render.ts#buildAnchorLines`) already knows *which* slot it holds, from its tag, but has no
 *    command yet: the only place the file records what it does is the override itself. So the
 *    override's command becomes that entry's one command, which is exactly what the writer put
 *    there (`bindValueFor`) and therefore re-renders identically.
 * 2. **Slots.** Every other override whose value is an entry's own mirrored value hands that entry a
 *    modified slot, matched by value the same way `applyActionLayerMirror`'s own strip pass
 *    recognises what it wrote. An override already accounted for by pass 1's anchor
 *    (`holdsModifiedSlot`) is skipped, so an anchored slot is never duplicated into the entry's other
 *    slot as well.
 *
 * The override stays on the layer either way: it is a derived mirror of this exact field, and the
 * next save would write it back identically.
 *
 * Mutates the actions in place - they were just constructed here and are not shared yet.
 */
function restoreModifierSlots(
  actions: ConfigAction[],
  layers: readonly RestoredLayer[],
  warnings: RestoreWarning[],
): void {
  const overrides = modifierOverridesInStableOrder(layers)

  for (const override of overrides) {
    if (override.command.length === 0) continue
    const anchored = actions.find(
      (action) =>
        action.commands.length === 0 && holdsModifiedSlot(action, override.key, override.modifier),
    )
    if (anchored) anchored.commands = [configCommandFor(override.command)]
  }

  for (const override of overrides) {
    // Known limitation, deliberately not fixed (story 042 review round 2, NEW-4): the first action
    // whose mirrored value matches wins, with no check that an earlier override already claimed it -
    // ideally a matched override/action pair would leave the candidate pool. No profile this app can
    // write constructs two entries with the same `bindValueFor` (every writer is find-or-create on
    // `catalogId`, and a launcher-written file records every modified slot as an anchor line, which
    // is filled above and skipped below), so reaching it needs a hand-edited or foreign file.
    const owner = actions.find((action) => bindValueFor(action) === override.command)
    if (!owner || owner.kind === 'alias') continue
    if (holdsModifiedSlot(owner, override.key, override.modifier)) continue
    if (owner.key === undefined) {
      owner.key = override.key
      owner.keyModifier = override.modifier
    } else if (owner.secondaryKey === undefined) {
      owner.secondaryKey = override.key
      owner.secondaryKeyModifier = override.modifier
    } else {
      warnings.push({
        reason: 'modifier-slot-unavailable',
        file: override.at.file,
        line: override.at.line,
        subject: override.key,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Every tagged line, grouped by its `e` ref, in first-appearance order, plus any `alias` definition
 * that carries no `[q2l` tag at all (`untaggedAliases`).
 *
 * A hand-added `alias my_macro "…"` in an otherwise launcher-written file is not malformed - it
 * simply predates this restore pass entirely - but dropping it (the pre-fix-cycle-5 behaviour) is
 * silent data loss the story's own AC5 forbids: nothing else in this module ever re-derives an
 * `alias` line from `profile.binds`/`profile.cvars` the way `render.ts` re-derives it from
 * `actions`, so an alias definition that never becomes an entry here vanishes the moment the
 * restored profile is next rendered, even though the raw `bind` line pointing at its name survives
 * untouched in `profile.binds`. `restoreProfileParts` runs `untaggedAliases` through
 * `buildImportedActions` (041's own inference) the same way the wholesale-untagged-file path does -
 * the same "degrade to what the plain config lines say" rule AC5 already promises, just applied to
 * one line instead of the whole file.
 *
 * A *malformed* tag (present but broken) is deliberately excluded from `untaggedAliases`: it is
 * already reported via `tag-malformed`, and re-running it through inference here as well - on top
 * of whatever this same `e` ref's other lines (a surviving bind or anchor) already contributed to
 * its group - would risk a second, duplicate entry for one alias name rather than one degraded one.
 */
function groupByEntryRef(
  aliases: readonly RestoreAliasLine[],
  binds: readonly RestoreBindLine[],
  comments: readonly RestoreCommentLine[],
  layerSections: readonly Section[],
  sections: readonly Section[],
  warnings: RestoreWarning[],
  consumed: RestoreSourcePosition[],
): { groups: EntryGroup[]; untaggedAliases: RestoreAliasLine[] } {
  const groups = new Map<string, EntryGroup>()
  const groupFor = (ref: string): EntryGroup => {
    const existing = groups.get(ref)
    if (existing) return existing
    const created: EntryGroup = { ref, aliases: [], binds: [], anchors: [] }
    groups.set(ref, created)
    return created
  }

  const insideLayer = (position: RestoreSourcePosition): boolean =>
    layerSections.some((section) => {
      const end = sectionEnd(sections, section)
      return position.file === section.file && position.line > section.line && position.line < end
    })

  const untaggedAliases: RestoreAliasLine[] = []

  const scan = <T extends RestoreSourcePosition & { comment: string }>(
    items: readonly T[],
    add: (group: EntryGroup, line: TaggedLine<T>) => void,
    // Returns whether `item` was actually recovered - `false` for a tagless line the caller
    // recognises as never having carried a tag by design (a switch-bind chain alias), so no warning
    // fires for it either. `T` here is generic (`scan` is shared with the bind pass, which never
    // supplies this callback), so a name-based exclusion has to live in the caller's own typed
    // callback rather than here.
    onUntagged?: (item: T) => boolean,
  ): void => {
    for (const item of items) {
      const parsed = parseMetaTag(item.comment)
      if (parsed.malformed) warnings.push({ reason: 'tag-malformed', file: item.file, line: item.line })
      if (parsed.unknownKeys.length > 0) {
        warnings.push({
          reason: 'tag-unknown-keys',
          file: item.file,
          line: item.line,
          subject: parsed.unknownKeys.join(','),
        })
      }
      const ref = parsed.fields.e
      // A line inside a layer section belongs to the layer, not to an entry (it carries no `e` of
      // its own either - the check is belt-and-braces against a hand-moved line). This protects real
      // content: `render.ts#buildLayerSections` emits a hold layer's `+x`/`-x` alias pair (and a
      // toggle layer's dispatch/chunk/helper aliases, `alt-layers.ts`) with no tag at all - membership
      // is positional, by design (see that function's own doc comment) - so the alias scan needs this
      // exclusion just as much as the bind scan always has.
      //
      // Story-042-review round-5 (fix-cycle-7): an earlier version of this fix dropped `insideLayer`
      // from the *alias* recovery gate on the theory that no alias line is ever layer content - that
      // was wrong (proven by re-running a hold layer through this exact path: its `+alt`/`-alt` pair
      // came back as two bogus Controls-tab entries with false `tag-missing` warnings the moment the
      // gate stopped excluding them). Known, accepted limitation left in its place: `sectionEnd`
      // returns `Infinity` for a file's *last* section (there is no next one to bound it), so a
      // genuinely hand-added alias a user appends after a file's last layer - the position someone
      // editing the synced file in Notepad would actually pick - still reads as "inside that layer"
      // and is not recovered. Telling the two apart would need either the parser to carry blank-line
      // positions it does not today, or re-deriving `alt-layers.ts`'s full chunk/helper naming budget
      // here to whitelist a layer's *exact* alias family - both a materially larger change than this
      // fix-cycle's budget, for a narrower gap than the two false-positive entries this revert closes.
      if (ref === undefined || ref.length === 0 || insideLayer(item)) {
        // Only a caller that passed `onUntagged` (the alias scan) treats a tagless line as a gap to
        // report and recover: a raw `bind` line pointing straight at an engine command, never at one
        // of this entry model's aliases, legitimately carries no tag at all - warning on every one of
        // those would fire on every healthy launcher-written file, the exact false-positive AC6's
        // "config line wins" rule and 041's "raw bind stays a raw bind" decision both already reject.
        //
        // Story-042-review round-5 finding 1 (fix-cycle-7): a switch-bind chain alias
        // (`switch-bind.ts`'s `SWITCH_ALIAS`/`q2l_sw<n>`, story 007) lives in the *loader*
        // `autoexec.cfg` every import reads through its `exec` chain, and is untagged by design -
        // `renderLoaderFile` is explicitly outside this story's metadata system (see the Plan's "Not
        // touched" list). Without this exclusion every restore of an installation with in-session
        // profile switching configured grew three junk Controls-tab entries and three false
        // `tag-missing` warnings for the launcher's own generated lines.
        if (onUntagged && ref === undefined && !parsed.malformed && !insideLayer(item) && onUntagged(item)) {
          warnings.push({ reason: 'tag-missing', file: item.file, line: item.line })
        }
        continue
      }
      add(groupFor(ref), { item, fields: parsed.fields, prose: parsed.prose })
    }
  }

  scan(
    aliases,
    (group, line) => group.aliases.push(line),
    (item) => {
      // A switch-bind chain alias (story 007) is never a hand-added definition - it is
      // `renderLoaderFile`'s own generated content, untagged by this story's own design (the Plan's
      // "Not touched" list). Recovering it through 041's inference would file it as a real
      // Controls-tab entry and warn about metadata that was never supposed to exist.
      //
      // Story-042-review round 5, fix-cycle-8: `startsWith(STEP_ALIAS_PREFIX)` was too broad - a
      // hand-added `alias q2l_sword "…"` (a real word starting with the same prefix, `switch-bind.ts`
      // only ever emits `q2l_sw<digits>`) was silently excluded too, the exact data-loss class this
      // exclusion exists to avoid introducing. The exact shape (prefix, then digits, then end of
      // string) is what `stepAliasName` in `switch-bind.ts` actually generates.
      if (item.name === SWITCH_ALIAS || STEP_ALIAS_NAME.test(item.name)) return false
      untaggedAliases.push(item)
      return true
    },
  )
  scan(binds, (group, line) => group.binds.push(line))

  // The anchor lines (`render.ts#buildAnchorLines`). Scanned last, so an entry that exists *only*
  // as an anchor is discovered after every entry that has a real config line - the same
  // scan-order-not-document-order rule the alias/bind passes above already follow.
  //
  // `parseComment`, not `parseMetaTag`: a comment-only line may be a banner, whose tag sits inside
  // trailing decoration. Malformed tags and unknown keys are *not* reported here - `scanComments`
  // already walked every one of these lines and reported them once.
  for (const item of comments) {
    const parsed = parseComment(item.text)
    // `claimsEntryRef` is the shared predicate: a section header or the header block's version
    // marker is not an entry anchor even if someone hand-edited an `e` into it, and - the other way
    // round - a line this claims is never read as a section header either (see that function). A
    // tagged comment inside a layer section belongs to the layer, which is positional and therefore
    // stays here rather than moving into the predicate.
    if (!claimsEntryRef(parsed) || insideLayer(item)) continue
    if (!parsed.malformed) consumed.push({ file: item.file, line: item.line })
    groupFor(parsed.fields.e!).anchors.push({ item, fields: parsed.fields, prose: parsed.prose })
  }

  return { groups: [...groups.values()], untaggedAliases }
}

/**
 * Rebuilds a profile's entries, categories and layers from a launcher-written config's metadata,
 * reconciled against its config lines - or, for a file that carries no metadata at all, from story
 * 041's inference by delegating to `buildImportedActions`.
 *
 * The profile `id` is never adopted (AC4): the file's own is *reported* as `sourceProfileId` so the
 * import dialog can name the profile being restored, and every id in the result - entry, category
 * and layer alike - comes from `newId`.
 */
export function restoreProfileParts(input: RestoreProfilePartsInput): RestoreProfilePartsResult {
  const scan = scanComments(input.comments)
  const taggedLines = [...input.aliases, ...input.binds, ...input.cvars].some((line) =>
    line.comment.includes('[q2l'),
  )

  // No `[q2l` anywhere: not a 042-era file. Story 041's path, wholesale - no ids minted before the
  // delegation, so the ids it hands out are exactly the ones it would hand out on its own.
  if (!scan.anyTag && !taggedLines) {
    const delegated = buildImportedActions({
      aliases: input.aliases.map(({ name, body, file, line }) => ({ name, body, file, line })),
      binds: Object.fromEntries(input.binds.map((bind) => [bind.key, bind.command])),
      layerAliases: input.layerAliases,
      newId: input.newId,
    })
    return {
      actions: delegated.actions,
      categories: delegated.categories,
      layers: delegated.layers,
      ambiguous: delegated.ambiguous,
      warnings: [],
      sourceProfileId: scan.sourceProfileId,
      metadataVersion: null,
      consumedCommentLines: [],
    }
  }

  const warnings = [...scan.warnings]
  if (scan.version === null) {
    // Tags but no marker: the header block's `[q2l v=…]` was hand-deleted. Read the tags anyway -
    // refusing them would throw away exactly the record the user did not touch.
    const first = input.comments[0]
    warnings.push({ reason: 'metadata-version-missing', file: first?.file ?? '', line: first?.line ?? 0 })
  }

  const categories = categoryRegistry(input.newId)
  const layerSections = scan.sections.filter((section) => section.kind === 'layer')

  const consumedCommentLines = [...scan.consumed]
  const { groups, untaggedAliases } = groupByEntryRef(
    input.aliases,
    input.binds,
    input.comments,
    layerSections,
    scan.sections,
    warnings,
    consumedCommentLines,
  )
  const actions = groups.map((group) =>
    buildEntry(group, scan.sections, categories, input.newId, warnings),
  )

  // A hand-added `alias` line that carries no `[q2l` tag at all (`groupByEntryRef`'s doc comment) -
  // 041's own inference is what "degrading to what the plain config lines say" (AC5) means for a
  // line this pass never generated. `layerAliases: []` on purpose: the tagged path already reports
  // no `ambiguous` list at all (D4 - "there is nothing to guess" for an own-written file), so a
  // rebind-shaped hand-added alias converts as a plain entry rather than surfacing a review step
  // this path does not have. `binds` is the full map (not just the untagged ones), matching
  // `buildImportedActions`' own contract for resolving a layer's `triggerKey`.
  const delegatedCategories: ConfigActionCategory[] = []
  if (untaggedAliases.length > 0) {
    const delegated = buildImportedActions({
      aliases: untaggedAliases.map(({ name, body, file, line }) => ({ name, body, file, line })),
      binds: Object.fromEntries(input.binds.map((bind) => [bind.key, bind.command])),
      layerAliases: [],
      newId: input.newId,
    })
    actions.push(...delegated.actions)
    delegatedCategories.push(...delegated.categories)
  }

  const restoredLayers: RestoredLayer[] = layerSections.map((section) => ({
    layer: buildLayer(section, scan.sections, input, warnings),
    at: { file: section.file, line: section.line },
  }))
  const layers = restoredLayers.map((restored) => restored.layer)

  restoreModifierSlots(actions, restoredLayers, warnings)

  // Cvar lines carry no tag of their own (`render.ts`: a `set` line is not an entry), so the only
  // thing to say about one is that somebody hand-edited a `[q2l` into or out of it.
  for (const cvar of input.cvars) {
    const parsed = parseMetaTag(cvar.comment)
    if (parsed.malformed) warnings.push({ reason: 'tag-malformed', file: cvar.file, line: cvar.line })
  }

  return {
    actions,
    categories: [...categories.created(), ...delegatedCategories],
    layers,
    ambiguous: [],
    warnings,
    sourceProfileId: scan.sourceProfileId,
    metadataVersion: scan.version?.value ?? null,
    consumedCommentLines,
  }
}
