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
 * the engine will actually read. Where the two disagree - a `mod` value that is not a modifier, a
 * layer whose `mode`/`trigger` tag its own alias names contradict - the line wins and the
 * discrepancy is reported (AC6). A malformed tag degrades that one
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
 * Story 050 took the join key (`e`, an FNV-1a of the original `action.id`) out of the format
 * together with `k` and `slot`, because all three restate something the config text already says.
 * Identity is therefore read out of the *text* now (`groupEntryLines`):
 *
 * - an **alias line** is identified by its own alias name - a chunk-split `_p<n>` family folds onto
 *   the base line that references it, exactly as `commandsFromAliases` recombines their bodies;
 * - a **bind line** by its bind value, so the several physical `bind` lines running one command are
 *   one entry with several keys (AC4) with no ref involved;
 * - the two **join** when a bind value equals a grouped alias name - which is precisely what
 *   `bindValueFor`/`applyActionMirror` wrote there in the first place;
 * - an **anchor line** (see below) pairs with its entry inside the same category section, by `cid`
 *   when it carries one, else by its display prose - *exactly*, and by nothing wider: a prose
 *   prefix relation would merge two sibling entries whose names happen to nest (`Reload` inside
 *   `Reload weapon`), which costs one of them its keys and its commands outright;
 * - an **unbound line** (story 052 D3, see below) is one entry per line and pairs with nothing: the
 *   writer emits one only for an entry that has no other line at all, so there is nothing for it to
 *   pair with, and pairing could only ever fold two rows into one.
 *
 * Tag *presence* is what tells a launcher-owned code line from a raw bind the user typed and
 * commented themselves, so `render.ts` gives every entry line at least the bare `[q2l]` marker and
 * a code line with no tag at all is not an entry line here.
 *
 * An id is never adopted: every id in the result comes from `newId` (AC4's rule, applied to
 * entries, categories and layers alike - importing a colleague's file must not collide with a local
 * profile).
 *
 * What comes from where:
 *
 * | field                     | source                                                        |
 * | ------------------------- | ------------------------------------------------------------- |
 * | display `name`            | the comment's prose (story 040), alias line first             |
 * | `kind`                    | inferred from the commands and the lines (`entryKindFor`)      |
 * | `catalogId`               | `cid`                                                          |
 * | `aliasName`               | the alias line's own name; for an anchor-only entry, its `an`  |
 * | `commands` + their order  | the alias line's body, in body order                          |
 * | `keepEmptyAlias`          | a rendered `alias <name> ""`                                   |
 * | `keys`                    | the bind (then anchor) lines of this entry, in file order      |
 * | modifiers                 | a slot's own `mod`, or the modifier layer that overrides it     |
 * | `categoryId`              | the section header the line sits under                         |
 * | `subcategoryId`           | that header's own `sub` id, when it is a second-level banner    |
 *
 * Slot identity is file order and nothing else (story 050): every claim simply appends, bind lines
 * before anchor lines, with no cap of two - so a hand-added third `bind` line on an entry's value
 * comes back as that entry's slot 3 rather than as a conflict. One consequence is accepted and
 * documented in `docs/systems/profile-file-format.md`: an entry whose *modified* slot was slot 1
 * and whose plain slot was slot 2 comes back with the two swapped, since the plain slot's bind line
 * is claimed before the modified slot's anchor. Both keys and both modifiers survive and the file
 * re-renders byte-identically; only the intra-entry order flips.
 *
 * ## Sections, and why attribution is positional
 *
 * A `[q2l cat=<id>]` / `[q2l layer=<ref> mode=… trigger=…]` comment opens a section that runs until
 * the next section header in the same file; a line belongs to the last header above it. That is the
 * User's own decision (the category lives on the header, not on a per-entry tag), and it is why
 * every input line carries `file`/`line`: without a position, a line cannot be attributed to a
 * section at all. Every `cat` id mints a real, ordinary category (story 052 D4): a template id
 * (`movement`/`weapons`/`drops`) keeps that id, any other gets a local one - a colleague's category
 * id means nothing here, their category *name* does - and both are named from the header's own
 * prose title.
 *
 * An **untagged** banner (a cvar group, the `Other binds` section, a hand-written header in a file
 * that is otherwise ours) opens a section too, named from its title. Nothing is minted for a section
 * no entry lands in, so the cvar-group banners of a normal launcher file produce no categories at
 * all.
 *
 * ## The second level (story 053 D3)
 *
 * A `[q2l sub=<id>]` banner opens a **sub-category** section (`Section.kind: 'subcategory'`). It
 * carries nothing but that one id, because its parent is positional: the nearest preceding
 * `kind: 'category'` header in the same file, which is exactly where `render.ts`'s
 * `withSubcategoryBuckets` puts it (inside the category section it belongs to, after that
 * category's own ungrouped run). A line under such a banner is filed with **both** ids - its
 * parent's `categoryId` and this section's `subcategoryId` - so the two levels are one lookup, not
 * a second attribution pass.
 *
 * Unlike a category, a sub-category is registered **eagerly**, the moment its banner is seen
 * (`categoryRegistry`'s own `subcategories` pass), and registering it mints its parent category
 * eagerly with it. Lazy minting is right for a category - it is what keeps a cvar group's banner
 * from becoming a drawer nothing is in - and wrong here, for the one shape story 052 already had to
 * solve one level up: a sub-category the user has just created holds no entries at all, its banner
 * is the only trace of it in the file (`render.ts` emits an empty sub-banner deliberately), and
 * minting it only when something lands under it would make it vanish on the first reload.
 *
 * Story 042's read-only two-level import - two adjacent *untagged* banners collapsed into one
 * `Main / Sub` category name - is gone with this deliverable: the tagged form above replaces it,
 * and recognising an untagged foreign pair as a real category + sub-category pair is story 053 D4's
 * own job. A hand-deleted `sub=` tag therefore degrades to exactly what any other untagged banner
 * is - an ordinary section, minting an ordinary category for whatever lands under it - which is the
 * "never crashes, never loses the lines" direction this module fails in everywhere else.
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
 * `[q2l cid=… an=… mod=… key=…]`-tagged line under its own category section
 * (`render.ts#buildAnchorLines`). It is read here like any other tagged line, appends its slot from
 * its own `key`/`mod`, and its command is then taken from the layer override it names - the only
 * place the file records what such an entry actually does. A modified slot is anchored even when the
 * entry keeps an alias line, since that line carries no `key`/`mod`: without the anchor, an entry
 * whose slots are *all* modified had them decided by the guessed (modifier, key) fallback in
 * `restoreModifierSlots` rather than by the file.
 *
 * The `key` field is also the read-side *discriminator* for an anchor (story 050): only an anchor
 * line ever carries one, so a comment-only line with a `key` is an entry anchor and a comment
 * carrying `cat`/`layer`/`v` stays a section header. A comment-only line with neither is neither -
 * it stays a preserved, unrecognised line rather than becoming a keyless, commandless entry.
 *
 * ## The unbound line (story 052 D3)
 *
 * One shape used to leave no trace in the file at all: a plain `bind`/`message` entry with no key
 * (so no bind line, and no modifier layer to anchor it into) and no alias line either - a continuous
 * catalogue row nothing calls by name, or a row seeded with no commands at all. `render.ts` now
 * writes it a commented-out bind of its own, `//bind "<cmd>"   // <name> [q2l …]`, in the same
 * `Entries: <cat>` section as the anchors; `claimsUnboundEntry` recognises it here and
 * `unboundLineParts` reads its two halves back with the config tokenizer's own rules.
 *
 * What makes reading it back safe is what the reverted 042 "entry anchor" lacked: the body carries
 * the entry's *command*, so the restored entry is the entry rather than an empty stand-in - down to
 * `//bind ""`, which restores "genuinely no commands" rather than "the file could not say".
 * Recognition lives here rather than in `config-parser.ts` (the story's own decision): the tokenizer
 * stays untouched and a foreign file's comments are unaffected, since a line has to carry a readable
 * `[q2l …]` tag *and* start with a `bind` command *and* carry none of the marker fields every other
 * tagged shape has before anything here claims it.
 */

import type { AltLayer, AltLayerMode } from '@shared/config/alt-layers'
import { fitProseAndTag } from '@shared/config/cfg-layout'
import { bindValueFor } from '@shared/config/action-mirror'
import { actionKeySlots, keySlotCount, withKeySlot } from '@shared/config/action-slots'
import {
  buildImportedActions,
  collapseWaitRuns,
  configCommandFor,
  entryKindFor,
  splitAliasBody,
  type ImportedActionsResult,
} from '@shared/config/alias-import'
import {
  splitTopLevelSemicolons,
  stripLineComment,
  tokenize,
} from '@shared/config/command-tokenizer'
import {
  recognizeEntryIdioms,
  type RecognizedPressRelease,
  type RecognizedToggle,
} from '@shared/config/entry-idioms'
import { normalizeBindKey } from '@shared/config/key-names'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import { META_FORMAT_VERSION, parseMetaTag } from '@shared/config/profile-metadata'
import {
  COMMENT_LINE_BUDGET,
  COMMENT_PREFIX,
  HAND_EDIT_SENTENCE,
  OTHER_CATEGORY_LABEL,
  OWNERSHIP_MARKER,
  UNOWNED_BINDS_LABEL,
} from '@shared/config/render'
import { STEP_ALIAS_PREFIX, SWITCH_ALIAS } from '@shared/config/switch-bind'
import {
  TEMPLATE_ACTION_CATEGORIES,
  type ActionEntryKind,
  type ActionEntryPart,
  type ActionKeySlot,
  type ConfigAction,
  type ConfigActionCategory,
  type ConfigActionSubcategory,
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
   * **Produced by that fold, not by this module** (story-050 review, finding 4, second round). The
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

// Story 050 removed four reasons together with the `k` and `slot` tag fields they reported on:
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

export interface RestoreProfilePartsResult {
  actions: ConfigAction[]
  /** Only the categories that had to be created locally - a built-in `cat` id is adopted, not created. */
  categories: ConfigActionCategory[]
  layers: AltLayer[]
  /** Every discrepancy, malformed tag and unrecognised field, in the order they were met. */
  warnings: RestoreWarning[]
  /** The profile id the file's ownership stamp names - the header banner's own `[q2l … id=…]` tag
   * (story 051) or a pre-051 sentinel line, whichever the file carries - reported so the import
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

/**
 * The tag's literal sigil, exactly the substring `parseMetaTag` anchors on.
 *
 * Since story 050 dropped `e`, the *presence* of this substring in a code line's trailing comment is
 * the only thing left that distinguishes a launcher-written `bind`/`alias` line from a raw one the
 * user typed and commented themselves - which is why `render.ts#entryTag` never returns `''` and
 * gives a fieldless entry line the bare `[q2l]` marker. `groupEntryLines` tests for it directly.
 */
const TAG_SIGIL = '[q2l'

/** Index just past a well-formed tag's `]`, or `-1` when the text carries no tag whose tail is
 * followed by nothing but decoration. */
function tagEndIndex(text: string): number {
  const sigil = text.lastIndexOf(TAG_SIGIL)
  if (sigil === -1) return -1
  const close = text.indexOf(']', sigil)
  if (close === -1) return -1
  return /^[\s\-=[\]]*$/.test(text.slice(close + 1)) ? close + 1 : -1
}

function parseComment(text: string): ParsedComment {
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
 * Story 050: the discriminator is the `key` field, which replaced `e` here. Only an anchor line
 * ever carries `key` - a real `bind` line spells its key as code and never gets one
 * (`render.ts#entryTag`) - so it is exactly as narrow a signal as `e` was, without the ref. A
 * `cat`/`layer`/`v` field is what makes a tagged line a *header* rather than an entry line, so a
 * line carrying one is not claimed here even if someone hand-edited a `key` into it. Malformedness
 * is deliberately not consulted: `parseMetaTag` yields `fields: {}` for a tag it could not parse at
 * all (so `key` is absent and this returns `false` anyway), and for a tag with one garbled token
 * among good ones the entry scan does claim the line - this predicate has to say the same thing it
 * does.
 */
function claimsEntryAnchor(parsed: ParsedComment): boolean {
  const key = parsed.fields.key
  if (key === undefined || key.trim().length === 0) return false
  return (
    parsed.fields.cat === undefined &&
    parsed.fields.layer === undefined &&
    parsed.fields.v === undefined &&
    taggedSubcategoryId(parsed.fields) === null
  )
}

/**
 * The sub-category id a `[q2l …]` tag states (story 053 D3), or `null` for a tag that carries no
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
function taggedSubcategoryId(fields: Record<string, string>): string | null {
  const id = (fields.sub ?? '').trim()
  return id.length > 0 ? id : null
}

/**
 * The prefix this module gives a heuristically-detected sub-category's synthetic `sub` key (story
 * 053 D4), so that a foreign, untagged second-level marker can reuse every mechanism D3 built for a
 * tagged `[q2l sub=…]` banner - `registerSubcategory`, `categoryKeyFor`, `idFor`,
 * `subcategoryIdFor` - all keyed off `section.fields.sub` and none of them caring *where* that value
 * came from. Prefixed (rather than a bare line number) so a caller can tell "this section's identity
 * is inferred, not stated by the file" apart from a real `sub=` value without a second field.
 */
const HEURISTIC_SUBCATEGORY_PREFIX = 'heur:'

/**
 * Is `comment.text` symmetrically wrapped in a run of >=3 identical punctuation characters
 * (`##### 1st row #####`, `*** Setup ***`, `~~~ Extras ~~~`) - the shape a foreign author's own
 * hand-typed second-level marker takes, with no `[q2l …]` tag to say so (story 053 D4, "Foreign
 * second-level markers" in the story's Decisions)?
 *
 * `key` is the decoration *character* alone, not its run length: `##### Row A #####` and
 * `### Row B ###` are the same author's same decoration typed at two different widths, and treating
 * them as different keys would defeat the "occurs on at least two lines" gate below for exactly the
 * files it exists for. Not restricted to `#`: real Quake II config collections use `*`, `~`, `.`,
 * `_` and others just as often, so the character class is "any punctuation", not a fixed set - except
 * `-` and `=`, excluded on purpose: those are `BANNER_RULE`'s own two characters, and *this* writer's
 * own dashes/brackets banners (`cfg-layout.ts#banner`) are themselves symmetric dash-wrapped text
 * (`--- Weapons ----------`, `----- [ Weapons ] -----`) - matching them here would let this writer's
 * own, already-recognised category and cvar-group banners count toward "repeated decoration" and
 * mint bogus sub-categories out of an ordinary launcher file. A foreign author's own decoration is
 * never this writer's `-`/`=`, so excluding them costs the heuristic nothing it is meant to catch.
 */
function decorationWrap(text: string): { key: string; title: string } | null {
  const match = /^([^A-Za-z0-9\s\-=])\1{2,}\s+(.+?)\s+\1{2,}$/.exec(text.trim())
  if (!match) return null
  const [, char, title] = match
  return { key: char!, title: title! }
}

/**
 * A comment-only line wrapped in a **mirrored** run of punctuation - `.: Main Key's :.`,
 * `<< Setup >>`, `|: Extras :|` - as its bare title, or `null` for a line that is not shaped that
 * way. Story 053 D4 (review fix): the *top-level* companion to `decorationWrap` below.
 *
 * Why this exists at all: a foreign file's own top-level header decides whether the second level can
 * be read at all, because `heuristicSubcategoryParent` only attaches a repeated-decoration sub-marker
 * to a `'category'`/`'plain'` section that already precedes it. Before this, the only untagged line
 * that opened such a section was one carrying this writer's *own* decoration (`BANNER_RULE`'s `-`/`=`
 * runs) or one of its three fixed title prefixes (`CATEGORY_TITLE_PREFIX`) - so the exact header the
 * story names (`.: Main Key's :.`, `dm.cfg`'s own) opened no section, and the `##### 1st row #####`
 * markers under it were orphaned and contributed nothing. This is deliberately a *recognition* rule
 * only: the line opens an ordinary untagged `'plain'` section like any other foreign banner, and
 * nothing here revives story 042's `Main / Sub` name-fusion, which stays gone (D3's decision).
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
const MIRROR_WRAP = /^([^\s\-=\p{L}\p{N}]{2,})\s+(.+?)\s+([^\s\-=\p{L}\p{N}]{2,})$/u

/** A title has to say *something*: at least one letter or digit, in any script. Without this,
 * `.: :: :.` would mint a category literally named `::`. */
const MIRROR_TITLE_CONTENT = /[\p{L}\p{N}]/u

/** The paired delimiters that mirror into each other rather than into themselves, so `<< X >>` reads
 * as wrapped and `<< X <<` does not. Every other punctuation character mirrors to itself. */
const MIRROR_PAIRS: Record<string, string> = { '<': '>', '>': '<', '[': ']', ']': '[', '(': ')', ')': '(', '{': '}', '}': '{' }

function mirroredWrapTitle(text: string): string | null {
  const match = MIRROR_WRAP.exec(text.trim())
  if (!match) return null
  const [, open, title, close] = match
  const mirrored = [...open!].reverse().map((char) => MIRROR_PAIRS[char] ?? char).join('')
  if (close !== mirrored) return null
  if ([...open!].every((char) => char === open![0])) return null
  if (!MIRROR_TITLE_CONTENT.test(title!)) return null
  return title!.trim()
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
function decorationCounts(comments: readonly RestoreCommentLine[]): Map<string, number> {
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
function heuristicSubcategoryParent(
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
    .find((candidate) => candidate.file === file && (candidate.kind === 'category' || candidate.kind === 'plain'))
}

/**
 * The code half of an unbound line: a whole `bind` command commented out, with an argument
 * (`render.ts#unboundLine` writes `bind "<cmd>"`, and `<cmd>` is `""` for an entry with no commands
 * at all - both spellings start `bind ` and both carry a token after it). Tested against the
 * *prose* half of a parsed comment, i.e. the text with the `[q2l …]` tail already cut off.
 */
const UNBOUND_CODE = /^bind\s+\S/

/**
 * Is this comment-only line an **unbound line** (story 052 D2/D3) - the commented-out `bind` the
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
 * 2. **A `[q2l` tag is present and readable.** Tag presence is the whole launcher-owned signal since
 *    story 050 dropped `e` (see "The marker tag" in `docs/systems/profile-file-format.md`), and it
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
function claimsUnboundEntry(parsed: ParsedComment): boolean {
  if (!UNBOUND_CODE.test(parsed.prose.trim())) return false
  if (!parsed.tagged) return false
  if (parsed.malformed && Object.keys(parsed.fields).length === 0) return false
  return (
    (parsed.fields.key ?? '').trim().length === 0 &&
    parsed.fields.cat === undefined &&
    parsed.fields.layer === undefined &&
    parsed.fields.v === undefined &&
    taggedSubcategoryId(parsed.fields) === null
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
function claimedByEntryScan(parsed: ParsedComment): boolean {
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
 * no commands", which is most of what `STANDARD_TEMPLATE` seeds (story 052 D1).
 *
 * `parsed.prose` is the input rather than the raw text, so the `[q2l …]` tail is already gone and
 * cannot be mistaken for part of the display name.
 */
function unboundLineParts(parsed: ParsedComment): { command: string; prose: string } {
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
function bannerTitle(prose: string, tagSliced: boolean): { title: string; block?: string } {
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
  // The stripped prefix is *reported* as well as removed (story 052, D5 fix): it names which of the
  // writer's three per-category blocks the header belongs to, and `categoryRegistry`'s ordering
  // needs that to read the file's category order back off the sections - see `Section.block`.
  const prefix = TITLE_PREFIXES.find((candidate) => bare.startsWith(candidate))
  return prefix ? { title: bare.slice(prefix.length), block: prefix } : { title: bare }
}

/** The reserved, non-user-configurable "Other"/"Other binds" bucket titles (`render.ts`) - see
 * `categoryRegistry`'s `'other'` kind for why these get their own `Section.kind` rather than
 * falling through the generic untagged-banner path. */
const OTHER_BUCKET_TITLES = new Set<string>([OTHER_CATEGORY_LABEL, UNOWNED_BINDS_LABEL])

/** One section header, in document order. `kind: 'plain'` is an untagged banner; `kind: 'other'` is
 * specifically the reserved "Other"/"Other binds" bucket (see `OTHER_BUCKET_TITLES`);
 * `kind: 'subcategory'` is a `[q2l sub=…]` second-level banner (story 053 D3), whose parent is the
 * `parent` field below. */
interface Section extends RestoreSourcePosition {
  kind: 'category' | 'subcategory' | 'layer' | 'plain' | 'other'
  /** The header's own title, decoration stripped - a category name, a sub-category name, or a
   * layer's rendered title. */
  title: string
  /**
   * For `kind: 'subcategory'` only: the category section this banner sits inside - the nearest
   * preceding `kind: 'category'` header in the same file, resolved once here rather than re-derived
   * at every use, so "the parent is positional" is stated in exactly one place.
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
 * Is the `v` line at hand the **banner** header's own tag line (story 051 D2) rather than the
 * legacy header block's name+tag line?
 *
 * The two shapes are told apart by what the line itself carries, since that is all this module ever
 * sees (`file-ownership.ts#readOwnershipStamp` answers the same question one layer up, from the raw
 * file text, and cannot be reused here - it takes a blob, this takes parsed comment lines):
 *
 * - a banner tag line is **tag-only** - `headerTagLine` writes the tag alone, right-aligned, with no
 *   prose beside it - and carries the `id` field story 051 added;
 * - a legacy header's tag rides on the *name* line, so it always has prose, and never carries `id`
 *   (the field did not exist when that shape was written).
 *
 * Both conditions are required rather than either: `id` alone would let a hand-edit that pasted an
 * `id=` into an old name+tag line flip that file onto the backward branch, where the lines above it
 * are the wrong ones; empty prose alone would do the same for a pre-051 file whose profile name was
 * blank. A line failing this test simply takes the legacy branch, exactly as it did before.
 */
function isBannerHeaderTagLine(parsed: ParsedComment): boolean {
  return (parsed.fields.id ?? '').trim().length > 0 && parsed.prose.trim().length === 0
}

/**
 * The comment line at `index`, but only when it really is the file's `line` (same file, that exact
 * line number) - the adjacency half of `consumeHeaderDecoration`'s positional check, in one place so
 * neither branch below can spell it differently.
 */
function neighbourAt(
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
 * function has two branches (story 051 D5):
 *
 * - **banner** (story 051 D2, `render.ts#buildHeaderBlock`): `=`-rule / name / `=`-rule / tag-only
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
function consumeHeaderDecoration(
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

/**
 * One pass over the comment-only lines: the ownership stamp, the `v` marker, and the section
 * headers in document order.
 *
 * Ownership arrives in either of two shapes and both land in the same `sentinels` list: a pre-051
 * `OWNERSHIP_MARKER` line, and (story 051 D5) the header banner's own tag line, whose `id` field
 * replaced that separate line in a profile file. The stamp found in the *same file* as the version
 * marker wins, since that is the profile file whose metadata is being read; a loader `autoexec.cfg`
 * still carries a sentinel of its own (naming whichever profile was the installation's default,
 * `renderLoaderFile` writes it unchanged) and must not outvote it.
 */
function scanComments(comments: readonly RestoreCommentLine[]): CommentScan {
  const warnings: RestoreWarning[] = []
  const sections: Section[] = []
  const sentinels: { id: string; file: string }[] = []
  const consumed: RestoreSourcePosition[] = []
  let version: CommentScan['version'] = null
  let anyTag = false
  // Story 053 D4: computed once, up front, since the heuristic needs to know the *whole* file's
  // decoration usage before it can tell a real repeated marker from one stray decorated comment -
  // a per-line, streaming count could not answer "does this recur?" the first time a decoration is
  // seen.
  const decorationTally = decorationCounts(comments)

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
        // Story 051 D5: the banner header's tag line carries the profile id the pre-051 sentinel
        // line used to carry on its own, so it is the ownership statement for this file and joins
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

    const { title, block } = bannerTitle(parsed.prose, parsed.tagSliced)
    // Story 053 D4: computed once per line, ahead of the section-kind chain below, since the
    // heuristic sub-category branch and its "did this qualify at all" condition need the same
    // answer - see `heuristicSubcategoryParent`'s own doc comment for what "qualify" means.
    const heuristicWrap = parsed.tagged ? null : decorationWrap(comment.text)
    const heuristicParent = heuristicSubcategoryParent(sections, heuristicWrap, decorationTally, file)
    // Story 053 D4 (review fix): the same "an untagged line the file itself decorated" question, one
    // level up - see `mirroredWrapTitle`. Untagged only, for the same reason `heuristicWrap` is: a
    // tagged line's tag has already said what the line is.
    const mirroredTitle = parsed.tagged ? null : mirroredWrapTitle(comment.text)
    if (parsed.fields.cat !== undefined) {
      sections.push({ kind: 'category', title, block, fields: parsed.fields, file, line })
      if (!parsed.malformed) consumed.push({ file, line })
    } else if (taggedSubcategoryId(parsed.fields) !== null) {
      // A second-level banner (story 053 D3). Checked after `cat` and before `layer`, so a
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
    } else if (!claimedByEntryScan(parsed) && title.length > 0 && OTHER_BUCKET_TITLES.has(title)) {
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
      sections.push({ kind: 'other', title, block, fields: parsed.fields, file, line })
    } else if (!claimedByEntryScan(parsed) && heuristicWrap && heuristicParent) {
      // Story 053 D4: an untagged, decorated comment-only line whose decoration recurs elsewhere in
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
      //
      // Story 053 D3: two *adjacent* untagged banners used to be fused here into one category named
      // `Main / Sub` - story 042's read-only second level, which the model could not express any
      // other way. It can now (`ConfigActionCategory.subcategories`), the tagged `sub=` branch above
      // reads this writer's own second level back, and recognising an *untagged* foreign pair as a
      // real category + sub-category is story 053 D4's separate job with its own (repeated-
      // decoration) heuristic. So the fusion is gone rather than reworked: until D4 lands, two
      // adjacent untagged banners are simply two sections, and nothing invents a name the file never
      // states.
      //
      // Story 053 D4 (review fix): a mirror-wrapped foreign header (`mirroredWrapTitle`) lands here
      // too, and brings its own stripped title - `bannerTitle` knows only this writer's three banner
      // shapes, so for `.: Main Key's :.` it would hand back the whole decorated line as the name.
      sections.push({ kind: 'plain', title: mirroredTitle ?? title, block, fields: parsed.fields, file, line })
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

/** Name for the drawer a tagged entry lands in when its own section cannot be determined - the
 * same plain-English label `alias-import.ts` gives an import's leftovers. */
const FALLBACK_CATEGORY_NAME = 'Imported'

/** Registry key of the shared fallback drawer - the one key that belongs to no section at all, which
 * is why it sorts last (`orderByFileSections`). Distinct by construction from every section-derived
 * key, which is either `cat:<id>` or `<kind>:<file>:<line>`. */
const FALLBACK_CATEGORY_KEY = 'fallback'

/**
 * The registry key a section's entries are filed under - the identity a category's `Aliases: `,
 * `Binds: ` and `Entries: ` headers share (all three carry the same `cat=` tag), `null` for a
 * section that never mints a category at all (the reserved "Other" bucket).
 *
 * Pure and side-effect free on purpose: `idFor` mints from it, and `orderByFileSections` re-derives
 * it for **every** header in the file - including the ones no entry happened to be filed under, so a
 * category whose `Binds:` header carries all its entries still takes its place in the `Aliases:`
 * block's sequence.
 */
function categoryKeyFor(section: Section | null): string | null {
  if (section === null) return FALLBACK_CATEGORY_KEY
  // A sub-category section files its lines under its *parent* (story 053 D3): the second level is a
  // grouping inside a category, never a category of its own, so `categoryId` has to come out the
  // same for an entry in a sub-category as for one in that category's ungrouped run. A sub-banner
  // with no parent header at all (hand-edited) yields the shared fallback drawer, exactly like any
  // other tagged line whose section cannot be determined.
  if (section.kind === 'subcategory') return categoryKeyFor(section.parent ?? null)
  if (section.kind === 'other') return null
  const tagged = section.fields.cat
  if (tagged !== undefined && tagged.length > 0) return `cat:${tagged}`
  return `${section.kind}:${section.file}:${section.line}`
}

/**
 * The minted categories in the order their sections appear in the file (story 052 D5).
 *
 * Not simply "sort by the first header that mentions the category": `render.ts` writes the category
 * sections in three separate passes over `profile.categories` (aliases, then binds, then `Entries:`
 * anchors/unbound lines), and a category only gets a section in a pass that has something to put in
 * it. Document order is therefore three interleaved *subsequences* of one order - `Aliases: Alpha`
 * really does precede `Binds: Bewegung` in a file whose profile has Bewegung first - so the first
 * header alone reorders the rail exactly the way the bug being fixed here did, only more subtly.
 *
 * So each block (`Section.block`) contributes its own sequence, ordered within that block only, and
 * the sequences are merged: an edge per consecutive pair, then a topological walk that picks, among
 * the categories nothing is waiting on, the one whose first header comes first in the file. Since
 * every sequence is a subsequence of one and the same profile order, the merge reproduces that
 * order whenever the file states enough to determine it, and falls back to plain document order for
 * the pairs it does not (two categories that never share a block - possible only for a category
 * whose entries are all keyless aliases, where the file genuinely does not record the answer).
 *
 * Total and deterministic for any input, hand-edited files included: a contradictory pair of
 * sequences would leave a cycle with no zero-indegree node, and the loop then takes the earliest
 * remaining category by document position rather than dropping it. The fallback drawer belongs to no
 * section at all and so always sorts last.
 *
 * ## `ord`, and the pairs the sections genuinely cannot state (story 052, F3 fix)
 *
 * The merge above is exact for every pair of categories that share a block, and *guesses* for the
 * rest - two categories whose blocks never meet have no header pair to compare, so it falls back to
 * document position, which only says which of their two blocks the writer emits first. That is not a
 * near-miss: a profile whose category Alpha has only unbound entries (an `Entries:` section) and
 * whose category Bravo has only bound ones (a `Binds:` section) renders **byte-identically** with
 * those two swapped, so the reader was not misreading a signal - there was none, and Alpha and Bravo
 * changed places in the rail on the first rebuild-from-file whichever way round the user had put
 * them.
 *
 * `render.ts#categoryOrdinals` therefore records each category's position in the header's own tag,
 * and it is applied *on top of* the merge rather than instead of it: the merged order stands, and
 * `ord` re-sorts it. That ordering keeps three things a plain "sort by `ord`" would not:
 *
 * - a file written before this field existed (or one whose tags were hand-deleted) orders exactly as
 *   it did, since a missing `ord` changes nothing;
 * - a category with no `ord` - a hand-added section in an otherwise launcher-written file, the
 *   fallback drawer - keeps its merged position *relative to the numbered ones* by carrying the last
 *   `ord` seen before it forward, instead of being swept to one end of the rail;
 * - hand-edited nonsense (a duplicated or non-numeric `ord`) degrades to the merged order for the
 *   categories it affects rather than reordering the file at random, because the sort is stable and
 *   an unreadable value is treated as absent.
 */
function orderByFileSections(
  created: ReadonlyMap<string, ConfigActionCategory>,
  sections: readonly Section[],
): ConfigActionCategory[] {
  const keys = [...created.keys()]
  const firstAt = new Map<string, number>()
  const sequences = new Map<string, string[]>()
  /** The `ord` the file states for a category, from the first of its headers that carries a readable
   * one - all three of a category's headers carry the same value when this writer wrote them, so
   * "the first readable one wins" only ever picks between hand-edited disagreements, and it picks
   * deterministically. */
  const statedOrdinals = new Map<string, number>()

  sections.forEach((section, index) => {
    // A sub-category banner states nothing about the *category* order and must not be read as if it
    // did (story 053 D3). Its `categoryKeyFor` is its parent's, and its `block` is `undefined` (a
    // sub-banner carries no `Aliases: `/`Binds: `/`Entries: ` prefix by design), so leaving it in
    // would drop every category that has sub-categories into the one shared `''` sequence below -
    // where the three per-block subsequences are interleaved rather than comparable, and an edge
    // between two categories that share no block would be invented from nothing but which block the
    // writer happens to emit first. That is precisely the pair `ord` exists to answer.
    if (section.kind === 'subcategory') return
    const key = categoryKeyFor(section)
    if (key === null || !created.has(key)) return
    if (!firstAt.has(key)) firstAt.set(key, index)
    if (!statedOrdinals.has(key)) {
      const ordinal = readOrdinal(section.fields.ord)
      if (ordinal !== null) statedOrdinals.set(key, ordinal)
    }
    const block = section.block ?? ''
    const sequence = sequences.get(block) ?? []
    // A key repeated inside one block (only reachable by hand-editing two headers of the same
    // category into the same block) keeps its first position rather than adding a self-edge.
    if (!sequence.includes(key)) sequence.push(key)
    sequences.set(block, sequence)
  })

  const successors = new Map<string, Set<string>>()
  const waitingOn = new Map<string, number>(keys.map((key) => [key, 0]))
  for (const sequence of sequences.values()) {
    for (let index = 1; index < sequence.length; index += 1) {
      const from = sequence[index - 1]!
      const to = sequence[index]!
      const edges = successors.get(from) ?? new Set<string>()
      if (!edges.has(to)) {
        edges.add(to)
        waitingOn.set(to, (waitingOn.get(to) ?? 0) + 1)
      }
      successors.set(from, edges)
    }
  }

  // A category with no header of its own (the fallback drawer) sorts behind every one that has one.
  const position = (key: string): number => firstAt.get(key) ?? Number.MAX_SAFE_INTEGER
  const remaining = new Set(keys)
  const ordered: ConfigActionCategory[] = []
  while (remaining.size > 0) {
    let pick: string | null = null
    for (const key of remaining) {
      if (waitingOn.get(key) !== 0) continue
      if (pick === null || position(key) < position(pick)) pick = key
    }
    // Only a cycle (a hand-edited file whose blocks contradict each other) gets here.
    if (pick === null) {
      for (const key of remaining) if (pick === null || position(key) < position(pick)) pick = key
    }
    const next = pick!
    remaining.delete(next)
    ordered.push(created.get(next)!)
    for (const successor of successors.get(next) ?? []) {
      waitingOn.set(successor, (waitingOn.get(successor) ?? 1) - 1)
    }
  }
  return applyStatedOrdinals(ordered, created, statedOrdinals)
}

/** A category header's `ord` value as a number, or `null` when the header carries none or carries
 * something no writer of this format ever wrote (a hand-edited `ord=first`, a value past the safe
 * integer range). `null` means "this category is unnumbered", which `applyStatedOrdinals` handles as
 * a position to preserve rather than as an error - the file is never rejected over decoration. */
function readOrdinal(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * `merged` re-sorted by the `ord` the file states for each category (`render.ts#categoryOrdinals`),
 * with the merged order kept wherever the file states nothing - see `orderByFileSections`' doc
 * comment for why both halves are needed.
 *
 * The sort key is `(ord, offset)`: a numbered category takes its own `ord` at offset 0, and every
 * unnumbered category takes the last `ord` seen before it in the merged order at a growing offset,
 * so it lands immediately behind the numbered category it already followed. A category before any
 * numbered one carries `-Infinity` and stays at the front, in merged order. The comparison is by
 * `<` rather than by subtraction, so an infinite carry never produces `NaN`, and it is stable, so
 * two categories a hand-edited file gives the same `ord` keep the merged order between them.
 */
function applyStatedOrdinals(
  merged: readonly ConfigActionCategory[],
  created: ReadonlyMap<string, ConfigActionCategory>,
  statedOrdinals: ReadonlyMap<string, number>,
): ConfigActionCategory[] {
  if (statedOrdinals.size === 0) return [...merged]

  const byCategory = new Map<ConfigActionCategory, number>()
  for (const [key, category] of created) {
    const ordinal = statedOrdinals.get(key)
    if (ordinal !== undefined) byCategory.set(category, ordinal)
  }

  const sortKeys = new Map<ConfigActionCategory, { ordinal: number; offset: number }>()
  let ordinal = Number.NEGATIVE_INFINITY
  let offset = 0
  for (const category of merged) {
    const stated = byCategory.get(category)
    if (stated === undefined) offset += 1
    else {
      ordinal = stated
      offset = 0
    }
    sortKeys.set(category, { ordinal, offset })
  }

  return [...merged].sort((a, b) => {
    const left = sortKeys.get(a)!
    const right = sortKeys.get(b)!
    if (left.ordinal !== right.ordinal) return left.ordinal < right.ordinal ? -1 : 1
    return left.offset - right.offset
  })
}

/**
 * Hands out category ids, lazily: one category per distinct `cat` id, one per untagged section, and
 * one shared fallback drawer. Lazy is what keeps a normal launcher file's cvar-group and
 * `Other binds` banners from minting categories nothing is ever filed under.
 *
 * Story 052 D5 found the order the minted categories come back in to be the missing half of D4.
 * `created()` used to hand them out in *mint* order, and a category is minted the first time an
 * **entry** asks for it - so the array was in entry-discovery order (`groupEntryLines` walks every
 * alias-line entry, then every bind-line-only one, then anchors and unbound lines), which says
 * nothing about where the categories' sections sit in the file. That was harmless while `render.ts`
 * hardwired movement/weapons/drops first; since D4 made `orderedCategoryIds` follow
 * `profile.categories`, this array *is* the next file's section order, so a rebuild-from-file or a
 * re-import silently moved sections nobody had touched (story 042's fixed point, AC 8). `created()`
 * therefore orders by the file's own section order - see `orderByFileSections`.
 *
 * Story 052 D4: a *template* `cat` id (`movement`/`weapons`/`drops`) used to be adopted verbatim and
 * created nothing at all, because those three categories existed whether a profile carried them or
 * not - the rail always showed them and `render.ts` always wrote their sections. Now that a profile
 * has exactly the categories it carries, adopting an id without minting a record would silently
 * lose the section: the restored entries would point at a category the profile does not have, so the
 * rail would not show them and the next render would sweep them into the trailing "Other" bucket,
 * losing both the name and the position the file plainly stated. So a template id mints a real,
 * ordinary category like any other - it only keeps its *id* rather than getting a local one, so that
 * `cat=` tags, the template seed and the migration all keep meaning the same drawer (the story's
 * Decisions: "built-in ids stay `movement`/`weapons`/`drops`").
 */
function categoryRegistry(
  newId: () => string,
  sections: readonly Section[],
): {
  idFor: (section: Section | null) => string
  subcategoryIdFor: (section: Section | null) => string | undefined
  created: () => ConfigActionCategory[]
} {
  const created = new Map<string, ConfigActionCategory>()
  /** `<category key>` -> `<the `sub` id the file states>` -> the locally minted record. */
  const subcategories = new Map<string, Map<string, ConfigActionSubcategory>>()

  const mint = (key: string, name: string): string => {
    const existing = created.get(key)
    if (existing) return existing.id
    const category: ConfigActionCategory = { id: newId(), name }
    created.set(key, category)
    return category.id
  }

  /**
   * A `cat` id that names a template category: the id verbatim, the header's own title as the name
   * (a renamed category must come back renamed - AC 8), and the template's `nameKey` re-attached
   * only when the title is still exactly the template's English default, per the story's Decisions.
   * A renamed one is plain prose from here on, exactly like a user-created category.
   */
  const mintTemplate = (
    key: string,
    template: (typeof TEMPLATE_ACTION_CATEGORIES)[number],
    title: string,
  ): string => {
    const existing = created.get(key)
    if (existing) return existing.id
    const category: ConfigActionCategory = {
      id: template.id,
      name: title,
      ...(title === template.label ? { nameKey: template.labelKey } : {}),
    }
    created.set(key, category)
    return category.id
  }

  /**
   * The category id a section's lines are filed under, minting the category if this is the first
   * thing to ask for it. Hoisted out of the returned object so the eager sub-category pass below can
   * call it too - registering a sub-category has to mint its parent, or the second level would be
   * attached to nothing.
   */
  const idFor = (section: Section | null): string => {
    if (section === null) return mint(FALLBACK_CATEGORY_KEY, FALLBACK_CATEGORY_NAME)
    // A sub-category banner is not a category: its lines belong to the category it sits inside, so
    // the whole question is delegated one level up (story 053 D3). Delegating rather than reading
    // `categoryKeyFor`'s parent key and minting from *this* section is what keeps the category's
    // name the category's own - minting from here would name it after the sub-category.
    if (section.kind === 'subcategory') return idFor(section.parent ?? null)
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
    // `categoryKeyFor` is `null` for exactly that bucket, and is the *only* place a key is
    // derived from a section - `orderByFileSections` reads the same one back off the file.
    const key = categoryKeyFor(section)
    if (key === null) return newId()
    const tagged = section.fields.cat
    if (tagged !== undefined && tagged.length > 0) {
      // A colleague's category id means nothing locally, so an id this build does not recognise
      // mints a local category named from the header's own title (the story's own rule). A
      // template id keeps its id but is minted just the same - see this registry's doc comment.
      const template = TEMPLATE_ACTION_CATEGORIES.find((category) => category.id === tagged)
      return template ? mintTemplate(key, template, section.title) : mint(key, section.title)
    }
    return mint(key, section.title)
  }

  /**
   * One sub-category section registered into its parent category - **eagerly**, before a single
   * entry has been read (story 053 D3, the story's own "Empty sub-category" decision).
   *
   * That is the one place this registry is deliberately not lazy, and the reason is the shape the
   * lazy rule cannot see: a sub-category the user has just created holds no entries, so nothing
   * would ever ask for it, and `render.ts#withSubcategoryBuckets` writes its banner anyway
   * (`banner()` rather than `section()`, precisely so an empty one still leaves a trace). Registering
   * from the tag itself is what makes that trace mean something - it is story 052's "the file is the
   * source of truth for an empty row" mechanism one level down.
   *
   * Minting the *parent* eagerly with it follows from the same file: a category whose only content
   * is a sub-category renders a section too, and dropping the category would take the sub-category
   * with it. A category with neither is still minted by nothing at all, so a cvar group's banner
   * stays what it always was.
   *
   * The local id is minted, never adopted, exactly like a category's (AC4 - a colleague's id means
   * nothing here). The `sub` id the file states is only ever a *lookup key*, scoped to its parent's
   * key, which is also what keeps two categories that happen to state the same `sub` id apart.
   */
  const registerSubcategory = (section: Section): void => {
    const stated = taggedSubcategoryId(section.fields)
    if (stated === null) return
    const key = categoryKeyFor(section)
    // `null` is the reserved "Other" bucket, which is the *absence* of a category (see `idFor`) and
    // so has nothing to hang a sub-category on. Nothing is registered; the lines under the banner
    // still land where they would have.
    if (key === null) return
    // Mints the parent if this is the first mention of it - see this function's doc comment.
    idFor(section)
    const category = created.get(key)
    if (!category) return
    const known = subcategories.get(key) ?? new Map<string, ConfigActionSubcategory>()
    subcategories.set(key, known)
    if (known.has(stated)) return
    const record: ConfigActionSubcategory = { id: newId(), name: section.title }
    known.set(stated, record)
    // Attached in first-seen document order, which is the order `withSubcategoryBuckets` wrote them
    // in: it walks `category.subcategories` for every one of the category's three sections, so all
    // three state the same order and the first of them settles it. The field is only created once
    // there is something to put in it, so a category with no sub-categories keeps the exact shape it
    // had before this story.
    category.subcategories = [...(category.subcategories ?? []), record]
  }

  for (const section of sections) {
    if (section.kind === 'subcategory') registerSubcategory(section)
  }

  return {
    idFor,
    subcategoryIdFor(section) {
      if (section === null || section.kind !== 'subcategory') return undefined
      const stated = taggedSubcategoryId(section.fields)
      if (stated === null) return undefined
      const key = categoryKeyFor(section)
      return key === null ? undefined : subcategories.get(key)?.get(stated)?.id
    },
    created: () => orderByFileSections(created, sections),
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

/**
 * One unbound line (story 052 D3), with the two halves `unboundLineParts` split its code out of:
 * `prose` is the display name only (the `TaggedLine` field it stands in for) and `command` is the
 * commented-out `bind`'s own argument - the entry's one command, or `''` for an entry that
 * genuinely has none.
 */
interface UnboundEntryLine extends TaggedLine<RestoreCommentLine> {
  command: string
}

/** Every line the config text identifies as one entry: the entry's alias line(s), its bind line(s),
 * its anchor line(s) - the comment-only lines `render.ts#buildAnchorLines` writes for a key slot
 * that has no config line of its own because its modifier lives in a layer - and its unbound line,
 * the commented-out `bind` `render.ts#unboundLine` writes for an entry that has none of the other
 * three (story 052 D2). */
interface EntryGroup {
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
   * The group's unbound line(s) - at most one in a launcher-written file, and never together with
   * any of the three above: an unbound line is written *because* the entry has no other line, so
   * `groupEntryLines` gives every one of them a group of its own (`unbound:<file>:<line>`) rather
   * than matching it onto an existing entry the way an anchor is matched. Two rows the file
   * legitimately spells the same way - two commandless seeded rows in one category, whose bodies are
   * both `""` - must not collapse into one, and a merge here is exactly the "one row loses its name,
   * its commands and its keys" failure `matchAnchor`'s own doc comment refuses to risk.
   */
  unbounds: UnboundEntryLine[]
}

const MODIFIER_TRIGGERS = new Set<string>(['ALT', 'CTRL', 'SHIFT'])

/** `alias <base>_p<n>` - a chunk of a body too long for one line (`alias-render.ts`). */
const CHUNK_SUFFIX = /^(.*)_p(\d+)$/
/** `alias <base>_c<n>` - a command hoisted out of a layer body (`alt-layers.ts`). */
const HELPER_SUFFIX = /_c\d+$/

/**
 * One entry's alias line(s) folded back into the single body they were split out of.
 *
 * A body too long for one line was split into `<name>_p<n>` chunks called by a parent whose own
 * body is nothing but their names. Recombining is therefore concatenation in `_p<n>` order - the
 * split only ever happened at a command boundary, so nothing has to be re-parsed to undo it - and
 * the parent's own body is dropped, since it holds the chunk names rather than commands.
 *
 * Its own function (story 045, D7) because two readers need this exact fold and must not disagree
 * about it: `commandsFromAliases` below, which classifies the recombined body into commands, and
 * `recognizeTwoPartGroups`, which hands the recombined body *as text* to `entry-idioms.ts`. That
 * recogniser deliberately does not see through a chunk family itself (its own "`_p<n>` chunks are
 * the caller's problem" section) - a chunked toggle state reads `alias zoom_s1 "zoom_s1_p1;
 * zoom_s1_p2"` and its `alias zoom zoom_s2` rewrite sits inside the *last chunk*, so an unfolded
 * body is not the idiom and would fall back. Folding here, once, is what makes a chunk-split toggle
 * restore as a toggle.
 *
 * ## `chunkBodies`: where the writer's own command boundaries are (story-045 review round 2,
 * finding 3)
 *
 * `body` is the fold as *text*, which is all the recogniser wants. A reader that turns the fold back
 * into *commands* needs one thing the joined text has lost: `renderActionAlias` only ever splits a
 * chunk **between two commands**, so a chunk boundary is a command boundary the file records - and
 * the one command kind that spans several segments (`{ kind: 'wait' }` -> `frames` literal `wait`
 * segments) is therefore never split across two chunks. Two *adjacent* wait commands can be, and
 * once the two chunk bodies are joined, `collapseWaitRuns` cannot tell that run from one longer
 * wait: `wait(3)` + `wait(2)` came back as one `wait(5)`, whose 28-character expansion no longer
 * fits where the 16-character one did, so the next render moved the chunk boundary and story 042's
 * fixed point was gone on a file nobody had touched. `chunkBodies` keeps the bodies apart, in order,
 * so a caller can classify each one on its own and concatenate.
 */
function foldedAliasBody(lines: readonly TaggedLine<RestoreAliasLine>[]): {
  body: string
  /** The folded body per source line, in `_p<n>` order - one element for an unchunked entry. */
  chunkBodies: string[]
  aliasName: string
} {
  const names = new Set(lines.map((line) => line.item.name))
  const chunks: { index: number; body: string }[] = []
  const parents: RestoreAliasLine[] = []

  for (const line of lines) {
    const match = CHUNK_SUFFIX.exec(line.item.name)
    if (match && names.has(match[1]!)) chunks.push({ index: Number(match[2]), body: line.item.body })
    else parents.push(line.item)
  }

  const parent = parents[0] ?? lines[0]!.item
  const chunkBodies =
    chunks.length > 0
      ? chunks.sort((a, b) => a.index - b.index).map((chunk) => chunk.body)
      : [parent.body]
  return {
    body: chunkBodies.join('; '),
    chunkBodies,
    aliasName: parent.name,
  }
}

/**
 * An entry's commands, in body order, out of the alias line(s) that define it.
 *
 * `collapseWaitRuns` (story 045, D7) is what turns the `frames` literal `wait` segments
 * `commandLineFor` writes for a `{ kind: 'wait' }` command back into that one command - the exact
 * inverse of the writer, and the same call `alias-import.ts` makes on the foreign-config path, so
 * "how many literal waits are one command" has one answer rather than two. Without it a
 * launcher-written `alias hop_wait "wait; wait; wait; wait; wait"` came back as five raw commands
 * and the entry lost its wait-row identity on every reload (AC6).
 *
 * Run **per chunk body**, not over the fold (story-045 review round 2, finding 3): a chunk boundary
 * is a command boundary the writer recorded, so a wait run that ends one chunk and a wait run that
 * opens the next are two commands, not one - see `foldedAliasBody`'s `chunkBodies` for what
 * collapsing across the join cost.
 */
function commandsFromAliases(lines: readonly TaggedLine<RestoreAliasLine>[]): {
  commands: ConfigCommand[]
  aliasName: string
  emptyBody: boolean
} {
  const { body, chunkBodies, aliasName } = foldedAliasBody(lines)
  return {
    commands: chunkBodies.flatMap((chunk) => commandsFromSegments(splitAliasBody(chunk))),
    aliasName,
    emptyBody: body.trim().length === 0,
  }
}

/**
 * One body's worth of segments as `ConfigCommand`s - the single pipeline every restored command
 * list goes through, whole-body or per-half (`alias-import.ts#commandsForHalf` is its twin on the
 * import side).
 */
function commandsFromSegments(segments: readonly string[]): ConfigCommand[] {
  return collapseWaitRuns(segments.map(configCommandFor))
}

/**
 * The entry's `kind`, inferred - the only way there is since story 050 dropped `k` from the tag
 * (the field restated something the lines already say, and a second source could only ever drift
 * from them).
 *
 * A single `say`/`say_team` body is a message (`entryKindFor`, story 041 - the same table the
 * untagged path uses). Otherwise: an entry some line claims a key for, or one with no alias line to
 * be defined by, is a `bind`; an alias line nothing claims a key for is a `kind: 'alias'` entry,
 * which is exactly story 019's definition of one (never bound).
 *
 * `bound` counts *every* slot claim, anchors included, not just bind lines: an entry bound only
 * through a modifier layer has its key on an anchor line and no bind line at all
 * (`render.ts#buildAnchorLines`), and it is still a bound entry.
 */
function inferKind(
  commands: readonly ConfigCommand[],
  hasAliasLine: boolean,
  bound: boolean,
): ActionEntryKind {
  if (entryKindFor(commands) === 'message') return 'message'
  return bound || !hasAliasLine ? 'bind' : 'alias'
}

/** One line's claim on a key slot: a bind line (whose key is the config text's own) or an anchor
 * line (whose key is in its tag, since a comment-only line has no code to read it off). */
interface SlotClaim {
  at: RestoreSourcePosition
  fields: Record<string, string>
  key: string
}

/**
 * The key slots `group`'s own lines claim, in file order, bind lines before anchor lines - see
 * `buildEntry`'s doc comment for why claims simply append and neither "already taken" nor "no free
 * slot" is a state this can reach.
 *
 * Its own function (story 045, D7) so a merged `toggle`/`press-release` entry reads its slots
 * through the identical rule instead of a second copy of it - including the `tag-modifier-unknown`
 * report, which has to fire exactly once per claim whichever entry shape the group ends up in.
 */
function keySlotsFrom(group: EntryGroup, warnings: RestoreWarning[]): ActionKeySlot[] {
  const claims: SlotClaim[] = [
    ...group.binds.map((line) => ({ at: line.item, fields: line.fields, key: line.item.key })),
    // Every anchor carries a non-empty `key` - that field is what made the line an anchor at all
    // (`claimsEntryAnchor`), so there is no keyless-anchor case to filter out here since story 050.
    ...group.anchors.map((line) => ({
      at: line.item,
      fields: line.fields,
      key: line.fields.key!.trim(),
    })),
  ]

  // One claim, one slot, in claim order.
  return claims.map((claim) => {
    const modifier = claim.fields.mod
    const trigger = modifier?.toUpperCase()
    const known = trigger !== undefined && MODIFIER_TRIGGERS.has(trigger)
    if (modifier !== undefined && !known) {
      warnings.push({
        reason: 'tag-modifier-unknown',
        file: claim.at.file,
        line: claim.at.line,
        subject: modifier,
      })
    }
    return {
      key: normalizeBindKey(claim.key),
      ...(known ? { modifier: trigger as ModifierTrigger } : {}),
    }
  })
}

/**
 * One entry out of one group of lines the config text identified as one entry.
 *
 * **Slot claims simply append, in file order, uncapped** (story 050). Every bind line of the group
 * claims the next slot, in the order the lines appear in the file, and then every anchor line does -
 * bind lines first because a bind line is an observable config line and an anchor is only a record
 * of a slot the file's bind table deliberately has no line for. "This slot is already taken" and
 * "no free slot" are therefore not states this can reach any more, which is why the two warnings
 * that reported them are gone: a hand-added third `bind` line on the entry's value becomes its slot
 * 3 rather than an error, exactly as AC3 asks.
 *
 * The one consequence, accepted and documented: an entry whose modified slot came first in the UI
 * and whose plain slot came second comes back with the two swapped, because the plain slot's bind
 * line is claimed before the modified slot's anchor. Nothing is lost - both keys and both modifiers
 * survive, and the file re-renders byte-identically.
 */
function buildEntry(
  group: EntryGroup,
  sections: readonly Section[],
  categories: ReturnType<typeof categoryRegistry>,
  newId: () => string,
  warnings: RestoreWarning[],
): ConfigAction {
  const first =
    group.aliases[0]?.item ??
    group.binds[0]?.item ??
    group.anchors[0]?.item ??
    group.unbounds[0]!.item
  const report = (reason: RestoreWarningReason, subject?: string): void => {
    warnings.push({ reason, file: first.file, line: first.line, subject })
  }

  const fromAliases = group.aliases.length > 0 ? commandsFromAliases(group.aliases) : null
  const commands = fromAliases?.commands ?? []

  // No `entry-alias-duplicate` report here (story-050 review, finding 4, second round): two
  // same-named `alias` lines never reach one group, because every caller folds `alias` lines
  // last-definition-wins by name *before* calling this module (see that reason's own doc comment).
  // The one place the second body is actually discarded is that fold, and that is where the warning
  // is raised now - `file-source.ts#discardedAliasWarnings`.

  // One claim, one slot, in claim order - see this function's doc comment for why there is no
  // conflict case left to handle.
  const slots = keySlotsFrom(group, warnings)

  const fields =
    group.aliases[0]?.fields ??
    group.binds[0]?.fields ??
    group.anchors[0]?.fields ??
    group.unbounds[0]!.fields
  const kind = inferKind(commands, fromAliases !== null, slots.length > 0)

  const prose = entryProse(group)

  const section = sectionFor(sections, first)
  if (section === null) report('entry-section-unknown', group.key)

  const catalogId = fields.cid

  // Both levels come off the one section the line sits under (story 053 D3): `idFor` resolves a
  // sub-category banner to its parent category, and `subcategoryIdFor` is non-`undefined` for
  // exactly the sections that are one. Written only when there is one, so an entry in a category's
  // ungrouped run keeps the shape it had before this story.
  const subcategoryId = categories.subcategoryIdFor(section)

  const base: ConfigAction = {
    id: newId(),
    categoryId: categories.idFor(section),
    ...(subcategoryId ? { subcategoryId } : {}),
    name: prose.length > 0 ? prose : (fromAliases?.aliasName ?? slots[0]?.key ?? group.key),
    kind,
    // A body's own order is the command order (the story's decision: the config text already
    // carries it, so no tag repeats it). With no alias line at all - a continuous catalogue row
    // bound to its bare `+command`, or a self-mirroring alias the writer drops - the bind line's
    // command is the entry's one command, which is exactly what that line records; and with no bind
    // line either, the unbound line's commented-out body records that same one command (story 052
    // D3), down to the empty `""` of an entry that genuinely has none.
    commands:
      fromAliases !== null
        ? commands
        : group.binds.length > 0
          ? bindCommands(group.binds)
          : unboundCommands(group.unbounds),
    ...(catalogId ? { catalogId } : {}),
    ...(fromAliases !== null && kind === 'alias' && fromAliases.emptyBody
      ? { keepEmptyAlias: true as const }
      : {}),
  }

  // Through the accessor rather than by writing `keys` here: `action-slots.ts` is the single access
  // point for that array (its own doc comment), and appending at `index === keySlotCount` is
  // exactly the "next free slot" call it documents.
  const action = slots.reduce((carried, slot, index) => withKeySlot(carried, index, slot), base)

  // The alias line's own name is the entry's `aliasName` (story 039) - never a tag, since the line
  // already carries it verbatim. With no alias line there are two fallbacks, in this order:
  //
  // 1. an anchor line's - or an unbound line's - `an` field. Such an entry has no line whose *code*
  //    could carry the name, so the tag is the only place the writer can record it
  //    (`render.ts#buildAnchorLines`, `render.ts#unboundLine`) - and with no alias line in the file
  //    there is nothing for it to drift from. An unbound line carries `an` exactly when the entry
  //    had an `aliasName` at all, so restoring it only where the field is present is what keeps the
  //    entry rendering the same shape - an unconditional one would grow an alias line the file
  //    never had.
  // 2. the bind value: what the file records this entry mirrors as, adopted exactly when the
  //    reconstructed entry would otherwise mirror as something else - which is what keeps a dropped
  //    self-mirroring alias (`alias weapnext weapnext`) from coming back as a second,
  //    differently-named alias line.
  const anchoredAliasName = [...group.anchors, ...group.unbounds]
    .map((line) => (line.fields.an ?? '').trim())
    .find((name) => name.length > 0)
  const aliasName =
    fromAliases !== null
      ? fromAliases.aliasName
      : (anchoredAliasName ?? ownAliasNameFromBind(action, group.binds))
  return aliasName ? { ...action, aliasName } : action
}

/**
 * The entry's display name as its own lines record it - the **least-cut** spelling any of them still
 * carries.
 *
 * Extracted (story 045, D7) because it is also the *identity* test a two-part merge needs: story
 * 050 made prose the entry's identity, so two alias lines that disagree about their prose are two
 * entries whatever their bodies are wired like (`twoPartMergeFor`).
 *
 * ## Why not simply the first alias line's prose (story-045 review round 2, finding 4)
 *
 * The writer puts the entry's one display name on *every* line of its family, but each line pays for
 * its own code first, so a line with a long body carries a cut name - or, past `attachTaggedComment`'s
 * last resort, no name at all. The first alias line is very often exactly that line: a chunk-split
 * entry emits `<name>_p1` before its parent, and `_p1` is a line filled to the byte with commands
 * while the parent (`"<name>_p1; <name>_p2"`) and the bind line have room to spare. Reading the
 * entry's name off it restored the *cut* spelling, and the next render then wrote that shortened
 * name onto the roomy lines as well - a file that differs from the one on disk with nobody having
 * touched it, which is what story 042's fixed point forbids.
 *
 * So the longest prose the group's lines carry wins, on one condition: every shorter alias-line
 * prose has to be what the writer would have put there for that longer name (`proseCutOf`, the same
 * exact reconstruction `twoPartProse` uses - not a prefix test). Lines that disagree for any other
 * reason (a hand-renamed comment) keep the old answer, the first alias line's own prose, rather than
 * letting an unrelated bind-line comment rename the entry.
 *
 * A bind or anchor line's prose is compared by *length* only, since neither records a `codeWidth` to
 * reconstruct a cut from. That costs nothing here and risks nothing: unlike `twoPartProse`, this
 * function decides no merge - the group is already one entry, identified by name and tag - so the
 * only question left is which of its own lines spells its name most completely.
 */
function entryProse(group: EntryGroup): string {
  // The pre-review answer, and still the answer whenever the group's lines disagree for a reason
  // the budget does not explain. `||`, not `??`: a line whose prose gave way to its tag entirely
  // carries `''`, and that is the fall-through this chain always meant to describe (`??` only ever
  // fell through for a *missing line*, so a nameless alias line took the name off the bind line
  // beside it and turned it into the alias name instead).
  const fallback =
    group.aliases[0]?.prose.trim() ||
    group.binds.find((line) => line.prose.trim().length > 0)?.prose.trim() ||
    group.anchors.find((line) => line.prose.trim().length > 0)?.prose.trim() ||
    // An unbound group has this line and nothing else, so this is its only spelling of the name
    // (story 052 D3) - `prose` here is already the display half alone, `unboundLineParts` having
    // split the commented-out `bind` off it.
    group.unbounds.find((line) => line.prose.trim().length > 0)?.prose.trim() ||
    ''

  const otherProses = [...group.binds, ...group.anchors, ...group.unbounds].map((line) =>
    line.prose.trim(),
  )
  const longest = [...group.aliases.map((line) => line.prose.trim()), ...otherProses].reduce(
    (carried, prose) => (prose.length > carried.length ? prose : carried),
    '',
  )
  if (longest === fallback) return fallback

  const explained =
    group.aliases.every(
      (line) => line.prose.trim() === longest || proseCutOf(line.prose.trim(), longest, line),
    ) && otherProses.every((prose) => longest.startsWith(prose))
  return explained ? longest : fallback
}

// ---------------------------------------------------------------------------
// Two-part entries: the toggle trio and the `+x`/`-x` pair (story 045, D7)
// ---------------------------------------------------------------------------

/**
 * One accepted merge: the 2-3 `EntryGroup`s the config text wires into a single `toggle`/
 * `press-release` entry, and which of them the entry stands in for.
 */
interface TwoPartMerge {
  kind: 'toggle' | 'press-release'
  /**
   * The entry's one display prose, reassembled across the merged groups' lines: the longest of them,
   * and the merge only happened at all because every shorter one is exactly the cut that line's own
   * byte budget would have made of it (see `twoPartProse`). Carried on the merge rather than re-read
   * off `primary` in `buildTwoPartEntry`,
   * since `primary` is not always the line that kept the whole name - a press/release entry's
   * primary *is* its `+` half, and that is exactly the half a long body can truncate.
   */
  prose: string
  /**
   * The group the merged entry takes the place of - its position in the output, its prose, its
   * `cid`, its section and, crucially, its key slots. That is the group whose own name is what
   * `action-mirror.ts#bindValueFor` writes on every one of the entry's keys, so it is the group a
   * `bind` line lands in: the **dispatch** alias for a toggle (`bind v "zoom"`), the **press** half
   * for a pair (`bind SHIFT "+slow"`, sign and all - there is no group keyed on the sign-free base,
   * because `groupEntryLines` keys strictly on the literal alias name / bind value text).
   */
  primary: EntryGroup
  /** The name the merged entry renders under: the dispatch name, or the pair's sign-free base. */
  aliasName: string
  /** State 1 then state 2, or press then release - the order `parts` is stored in. */
  halves: { group: EntryGroup; keptName: string; segments: readonly string[] }[]
  /** Every group the merge consumes, `primary` included, so none of them also becomes its own entry. */
  consumed: EntryGroup[]
}

/**
 * Does this group claim a key of its own (a `bind` line or an anchor line)?
 *
 * Recognition runs before the anchor scan (see `merges` in `groupEntryLines`), so in practice only
 * the bind half can be non-empty here. Both are checked anyway: an anchor is a key claim by
 * definition, and a predicate that silently depends on *when* it is called is the kind of thing a
 * later reordering breaks without a failing test.
 */
function claimsAKey(group: EntryGroup): boolean {
  return group.binds.length > 0 || group.anchors.length > 0
}

/**
 * What `render.ts` would have written as this line's display prose if the entry's name were `full` -
 * `full` itself when it fits, the exact cut `fitProseAndTag` makes when it does not, and `''` when
 * the line's budget left no room for prose at all. `null` when the line does not record how wide its
 * code was, so the question cannot be answered rather than guessed at.
 *
 * ## Reconstructed, not estimated (story-045 review round 2, findings 1 and 4)
 *
 * `attachTaggedComment` composes `<code>  // <prose> <tag>` inside `COMMENT_LINE_BUDGET` and cuts
 * the *prose*, never the tag, when the three do not fit. Three of those four lengths are knowable
 * from the parsed line: the budget is a constant, the separator is a constant, and the tag is the
 * literal tail of the line's own comment. The fourth, `code`, is **not** derivable from `name` and
 * `body` - the writer's column alignment padded it and the body may have been quoted, and both are
 * gone by the time a line has been parsed - so it is measured off the raw line by the parser and
 * carried here as `codeWidth`.
 *
 * With all four known, the cut is reproduced by calling the very function that made it, which is
 * what makes the comparison in `proseCutOf` a *proof* rather than a tolerance: a first review round
 * accepted any shorter prose that was a prefix of the longer one whenever the longer one would not
 * have fitted, which cannot tell a cut apart from three genuinely different sibling names that
 * happen to be prefixes of each other ("Slow", "Slow mo", "Slow motion walk") - the same
 * merge-away-a-name defect story 050's own review closed in `matchAnchor`.
 */
function writtenProseFor(line: TaggedLine<RestoreAliasLine>, full: string): string | null {
  const codeWidth = line.item.codeWidth
  if (codeWidth === undefined) return null

  // `comment` is the raw text after the `//` marker, so the tag is its literal tail from the last
  // sigil on - the same anchor `parseComment` reads the tag off.
  const sigil = line.item.comment.lastIndexOf(TAG_SIGIL)
  const tag = sigil === -1 ? '' : line.item.comment.slice(sigil).trimEnd()

  // `codeWidth` counts the code plus the two spaces before the marker; `attachTaggedComment`'s own
  // prefix is those two spaces plus `// `, i.e. one character more than the marker itself.
  const prefix = codeWidth + COMMENT_PREFIX.length - 2
  if (prefix >= COMMENT_LINE_BUDGET) return ''

  const written = fitProseAndTag(full, tag, COMMENT_LINE_BUDGET - prefix)
  if (tag.length === 0) return written
  if (written === tag) return ''
  return written.endsWith(` ${tag}`) ? written.slice(0, -(tag.length + 1)) : written
}

/**
 * Is `prose` what this line would carry if the entry's display name were `full` - the *whole* name
 * when the line had room for it, or the exact cut its own budget forced? See `writtenProseFor` for
 * why this is answered by re-running the writer rather than by a prefix test.
 *
 * `false` when the line does not carry the evidence to answer (no `codeWidth`): a caller that cannot
 * prove a cut keeps the two names apart, which loses nothing.
 */
function proseCutOf(prose: string, full: string, line: TaggedLine<RestoreAliasLine>): boolean {
  const written = writtenProseFor(line, full)
  return written !== null && written.trim() === prose
}

/**
 * The one display prose the groups a two-part merge would collapse all agree on, or `null` when they
 * do not - the gate that decides whether the config text says these 2-3 alias families are *one
 * entry* (story 050 made prose the entry's identity) or several entries whose bodies happen to be
 * wired into an idiom.
 *
 * ## Why this is not plain string equality (story-045 review, finding 1)
 *
 * `render.ts` writes the entry's one display name onto every line of its alias family, but each line
 * spends its own byte budget on its own *code* first: a 900-character toggle state and the
 * `alias zoom zoom_s1` dispatch beside it get very different amounts of what is left over, so one
 * line can carry `Zoom with a long name` while the other carries `Zoom with a l`. Both are the same
 * entry, and requiring them to match character for character split it back into three plain alias
 * entries on read-back - kind, `parts` and `lbl` labels gone, and a next render that differs from
 * the last, which is exactly what AC6's fixed point forbids.
 *
 * ## And why it is not a plain prefix relation either
 *
 * Story 050's own review (finding 1, `matchAnchor` below) removed a prefix-tolerant prose match for
 * a good reason: `Reload` is a prefix of `Reload weapon`, and merging two genuinely different
 * sibling names loses one of them whole. Nor is "a prefix, on a line the whole name would not have
 * fitted on" enough (story-045 review round 2, finding 2): that admits three real, never-cut
 * sibling names on three cramped lines - `Slow`, `Slow mo`, `Slow motion walk` - collapsing into one
 * entry and losing two names with no warning, because it never checks that the shorter spelling sits
 * *at* the cut point. A line with four characters of room and `Slow` on it says nothing about
 * `Slow motion walk`; a line with eleven characters of room whose prose reads `Slow motion` does.
 *
 * So the condition is exact: every line's prose must be **what the writer would have written there**
 * for the candidate name, cut or whole (`proseCutOf`, which re-runs `fitProseAndTag` against that
 * line's own measured budget).
 *
 * The returned prose is the *longest* candidate, i.e. the least-cut spelling of the name the file
 * still has. Restoring the truncated one instead would make the next render write that shortened
 * name onto the short lines too - a different file, one render later.
 */
function twoPartProse(primary: EntryGroup, groups: readonly EntryGroup[]): string | null {
  const lines = groups.flatMap((group) => group.aliases)
  // `entryProse(primary)` is in the candidate set, not just the alias lines': a primary whose alias
  // line lost its prose entirely still has its bind/anchor lines to name it, and that fallback is
  // the one `buildEntry` would have used had this group stayed an entry of its own.
  const candidates = [...lines.map((line) => line.prose.trim()), entryProse(primary)]
  const full = candidates.reduce((longest, prose) => (prose.length > longest.length ? prose : longest), '')

  for (const line of lines) {
    const prose = line.prose.trim()
    if (prose === full) continue
    if (!proseCutOf(prose, full, line)) return null
  }
  return full
}

/**
 * A recognised toggle trio -> one merge, or `null` when the *file* says these are separate
 * entries after all.
 *
 * `entry-idioms.ts` decides whether the three bodies are *wired* as a toggle; the two extra
 * conditions here are about whether they are *one entry*, which only this reader can know:
 *
 *  - **One prose across all three lines** (`twoPartProse` - up to the per-line budget cut it
 *    documents). `render.ts#buildAliasSections` writes the entry's one display name on every line of
 *    its alias family, so a launcher-written toggle always agrees with itself. Three lines that
 *    disagree are three entries whose bodies happen to be wired into a loop - merging them would take
 *    two display names, and on the next render two `//` comments, out of the file. Story 050 made
 *    prose the entry's identity; this is that rule applied.
 *  - **Neither state claims a key of its own.** The writer binds a toggle's *dispatch* and nothing
 *    else, so a `bind`/anchor line on a state is a shape this reader has never written. Merging it
 *    would move that key onto the dispatch value (`bindValueFor`) and rewrite a bind line the user
 *    put there by hand, which is the one thing "the config line wins" forbids.
 *
 * Both fall back to the plain per-group `buildEntry` path, untouched - the story's all-or-nothing
 * rule, and what makes a hand-edited broken trio come back as plain alias entries for D8's Care
 * checks to report rather than as a half-built toggle.
 */
function toggleMergeFor(
  toggle: RecognizedToggle,
  byName: ReadonlyMap<string, EntryGroup>,
): TwoPartMerge | null {
  const dispatch = byName.get(toggle.dispatchName.toLowerCase())
  const first = byName.get(toggle.states[0].name.toLowerCase())
  const second = byName.get(toggle.states[1].name.toLowerCase())
  if (!dispatch || !first || !second) return null
  if (claimsAKey(first) || claimsAKey(second)) return null

  const prose = twoPartProse(dispatch, [dispatch, first, second])
  if (prose === null) return null

  return {
    kind: 'toggle',
    prose,
    primary: dispatch,
    aliasName: toggle.dispatchName,
    halves: [
      { group: first, keptName: toggle.states[0].name, segments: toggle.states[0].segments },
      { group: second, keptName: toggle.states[1].name, segments: toggle.states[1].segments },
    ],
    consumed: [dispatch, first, second],
  }
}

/**
 * A recognised `+x`/`-x` pair -> one merge, or `null`.
 *
 * The same two conditions as `toggleMergeFor` (one prose per `twoPartProse`, no key of the release
 * half's own), plus
 * one this shape needs on its own: the release half's name must be **exactly** `-<base>`, casing
 * included. `entry-idioms.ts` pairs the two halves case-insensitively, because the engine's own
 * alias lookup is - but a `press-release` entry stores only the sign-free base and appends `+`/`-`
 * at render time (story 045's Decisions), so merging `+Slow` with a hand-written `-slow` would
 * re-render that definition as `-Slow`: a rename of a line the user typed, and a byte the fixed
 * point would lose.
 */
function pressReleaseMergeFor(
  pair: RecognizedPressRelease,
  byName: ReadonlyMap<string, EntryGroup>,
): TwoPartMerge | null {
  if (pair.release.name !== `-${pair.baseName}`) return null

  const press = byName.get(pair.press.name.toLowerCase())
  const release = byName.get(pair.release.name.toLowerCase())
  if (!press || !release) return null
  if (claimsAKey(release)) return null

  const prose = twoPartProse(press, [press, release])
  if (prose === null) return null

  return {
    kind: 'press-release',
    prose,
    primary: press,
    aliasName: pair.baseName,
    halves: [
      { group: press, keptName: pair.press.name, segments: pair.press.segments },
      { group: release, keptName: pair.release.name, segments: pair.release.segments },
    ],
    consumed: [press, release],
  }
}

/**
 * Every two-part entry the config text wires out of `groups`, found by the one shared recogniser
 * `alias-import.ts` uses (story 045's Decisions: "one recogniser, because 050 removes `k`" - there
 * is no `k` tag left to read a kind off, so both readers derive it from the text).
 *
 * ## Folded bodies, one per group
 *
 * The recogniser wants one `{ name, body }` per entry with the body already recombined - see
 * `foldedAliasBody`. `groupEntryLines` has already folded the `_p<n>` *lines* onto their base
 * group, so one group is one alias definition here; folding the *text* is what is left to do, and
 * it is what lets a chunk-split toggle state (`alias zoom_s1 "zoom_s1_p1; zoom_s1_p2"`, its
 * `alias zoom zoom_s2` rewrite hiding in the last chunk) be recognised at all.
 *
 * ## Scoped per category section
 *
 * Recognition runs once per category scope, the same scope `groupEntryLines` keys its groups in.
 * An entry's whole alias family is written into one category's alias section by construction
 * (`render.ts#buildAliasSections`), so scoping costs a healthy file nothing - and merging across
 * two sections would produce one entry where the file has two, which re-renders into a different
 * file and loses story 042's fixed point outright.
 *
 * ## `waitAliases` is deliberately not used here
 *
 * The recogniser also resolves a `waitN` family to a frame count, which is right for a *foreign*
 * config (D6) and wrong for our own file: `alias hop20 "hop5; hop5; hop5; hop5"` would become one
 * `{ kind: 'wait', frames: 20 }` command and re-render as twenty literal `wait`s, silently
 * rewriting four references the user's other bodies may still call. The launcher's own file already
 * writes a `wait` command as literal `wait` segments, and `commandsFromAliases`' `collapseWaitRuns`
 * reads exactly those back - no name resolution needed, and none wanted.
 */
function recognizeTwoPartGroups(
  groups: readonly EntryGroup[],
  sections: readonly Section[],
): TwoPartMerge[] {
  const byScope = new Map<string, { group: EntryGroup; name: string; body: string }[]>()
  for (const group of groups) {
    const firstAlias = group.aliases[0]
    if (!firstAlias) continue
    const { body, aliasName } = foldedAliasBody(group.aliases)
    const scope = sectionCategoryKey(sectionFor(sections, firstAlias.item))
    const list = byScope.get(scope) ?? []
    list.push({ group, name: aliasName, body })
    byScope.set(scope, list)
  }

  const merges: TwoPartMerge[] = []
  for (const definitions of byScope.values()) {
    const recognized = recognizeEntryIdioms(definitions.map(({ name, body }) => ({ name, body })))
    if (recognized.toggles.length === 0 && recognized.pressReleases.length === 0) continue

    const byName = new Map<string, EntryGroup>(
      definitions.map(({ group, name }) => [name.toLowerCase(), group]),
    )
    for (const toggle of recognized.toggles) {
      const merge = toggleMergeFor(toggle, byName)
      if (merge) merges.push(merge)
    }
    for (const pair of recognized.pressReleases) {
      const merge = pressReleaseMergeFor(pair, byName)
      if (merge) merges.push(merge)
    }
  }
  return merges
}

/**
 * One `toggle`/`press-release` entry out of the groups `merge` collapses.
 *
 * A parallel path to `buildEntry` rather than a branch inside it: everything that function derives
 * per group - `kind` inference, the single `commands` list, `keepEmptyAlias`, the `aliasName`
 * fallbacks - is either already known here or does not apply to an entry whose bodies live in
 * `parts`. What *is* shared is shared through the same helpers (`entryProse`, `keySlotsFrom`,
 * `categories.idFor`), so the two paths cannot disagree about a name, a category or a key slot.
 *
 * - `parts[i].aliasName` carries the half's kept name verbatim for a toggle, exactly as D6 does on
 *   the import side, which is what makes `alias-render.ts#twoPartHalfNames` reproduce an imported
 *   `zoomin`/`zoomout` trio (or our own `zoom_s1`/`zoom_s2`) byte for byte instead of deriving a
 *   fresh pair. A `press-release` half gets none: the renderer appends `+`/`-` to the entry's own
 *   base name and ignores a per-part name there by design, so storing one would be dead data.
 * - `parts[i].label` is the half's own line's `lbl` (story 045, D4) - read off the line named
 *   exactly like the half, never off a `_p<n>` chunk, which is precisely where `render.ts` puts it.
 * - `commands` stays `[]`, per `ConfigAction.parts`' own contract.
 */
function buildTwoPartEntry(
  merge: TwoPartMerge,
  sections: readonly Section[],
  categories: ReturnType<typeof categoryRegistry>,
  newId: () => string,
  warnings: RestoreWarning[],
): ConfigAction {
  const group = merge.primary
  const first = group.aliases[0]?.item ?? group.binds[0]?.item ?? group.anchors[0]!.item

  const section = sectionFor(sections, first)
  if (section === null) warnings.push({ reason: 'entry-section-unknown', file: first.file, line: first.line, subject: group.key })

  // `merge.prose`, not `entryProse(group)`: the primary's own line is not always the one that kept
  // the whole display name (story-045 review, finding 1 - see `twoPartProse`).
  const prose = merge.prose
  const catalogId = group.aliases[0]?.fields.cid

  const parts = merge.halves.map((half): ActionEntryPart => {
    const label = half.group.aliases
      .find((line) => line.item.name === half.keptName)
      ?.fields.lbl?.trim()
    return {
      commands: commandsForHalf(half),
      ...(label ? { label } : {}),
      ...(merge.kind === 'toggle' ? { aliasName: half.keptName } : {}),
    }
  })

  const subcategoryId = categories.subcategoryIdFor(section)

  const base: ConfigAction = {
    id: newId(),
    categoryId: categories.idFor(section),
    ...(subcategoryId ? { subcategoryId } : {}),
    name: prose.length > 0 ? prose : merge.aliasName,
    kind: merge.kind,
    commands: [],
    ...(catalogId ? { catalogId } : {}),
    aliasName: merge.aliasName,
    parts: [parts[0]!, parts[1]!],
  }

  return keySlotsFrom(group, warnings).reduce(
    (carried, slot, index) => withKeySlot(carried, index, slot),
    base,
  )
}

/**
 * One half of a two-part entry's commands, with the chunk boundaries the file records still in place
 * (story-045 review round 2, finding 3 - the same defect `commandsFromAliases` closes, on the path
 * a toggle state or a `+`/`-` half takes).
 *
 * `half.segments` comes from the recogniser, which reads the half's *folded* body and therefore
 * cannot say where the writer's chunk boundaries were. The half's own alias lines can: they are the
 * `<half>_p<n>` family, and re-splitting each chunk body on its own is what keeps two adjacent
 * `wait` commands that straddle the boundary two commands.
 *
 * The recogniser's list stays the authority on *what the half's body is* - the two splits are
 * compared segment by segment first, and the recogniser's answer is used unchanged unless the chunk
 * split reproduces it exactly (a toggle state's list is the same one minus its trailing
 * `alias <dispatch> <other state>` rewrite, hence the one allowed missing tail segment). So a future
 * change to either splitter degrades to today's behaviour rather than to a silently different body.
 */
function commandsForHalf(half: TwoPartMerge['halves'][number]): ConfigCommand[] {
  const chunks = foldedAliasBody(half.group.aliases).chunkBodies.map(splitAliasBody)
  const flat = chunks.flat()
  const tail = flat.length - half.segments.length
  const aligned =
    (tail === 0 || tail === 1) &&
    half.segments.every((segment, index) => segment === flat[index])
  if (!aligned) return commandsFromSegments(half.segments)

  const kept = [...chunks]
  const last = kept.length - 1
  if (tail === 1) kept[last] = kept[last]!.slice(0, -1)
  return kept.flatMap((chunk) => commandsFromSegments(chunk))
}

/** One line's whole command text as an entry's commands - classified the same way an alias body's
 * segment is (so `say hi` comes back as a message, not as raw text), and an empty text as no
 * commands at all rather than as one empty command. */
function soleCommand(text: string): ConfigCommand[] {
  const command = text.trim()
  return command.length > 0 ? [configCommandFor(command)] : []
}

/** An aliasless entry's commands: its bind line's command (see `soleCommand`). */
function bindCommands(binds: readonly TaggedLine<RestoreBindLine>[]): ConfigCommand[] {
  return soleCommand(binds[0]?.item.command ?? '')
}

/**
 * An unbound entry's commands: the body of its commented-out `bind` line (story 052 D3), read
 * through the very same rule a bind line's command is read through - which is the point of that
 * line's shape. `render.ts#unboundCommand` writes `bindValueFor(action)` there, the exact value the
 * mirror would have put on a key, so this is the writer's inverse: a `//bind "+moveleft"` restores
 * the one `+moveleft` command a `bind w "+moveleft"` line would have, and a `//bind ""` restores
 * `[]` - "this entry genuinely has no commands", which is what most of `STANDARD_TEMPLATE`'s seeded
 * rows are (story 052 D1) and what the reverted 042 "entry anchor" could not tell apart from "the
 * file never recorded what this entry runs".
 */
function unboundCommands(unbounds: readonly UnboundEntryLine[]): ConfigCommand[] {
  return soleCommand(unbounds[0]?.command ?? '')
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

/** One override of one modifier-triggered layer, ready to be handed to an entry. */
interface ModifierOverride {
  modifier: ModifierTrigger
  /** Normalized override key. */
  key: string
  command: string
}

/**
 * Every modifier-triggered layer's overrides in **one stable order: modifier, then key**.
 *
 * Deliberately not `layers` array order (nor `Object.entries` insertion order). The slot an override
 * lands in used to follow whichever layer happened to come first in the array, so two files that
 * differ only in the order their layer sections appear restored the same entry with its slots in a
 * different order - silently, with no warning, and invisibly to a fixed-point test, since both
 * orderings re-render as valid (just different) profiles.
 *
 * For an entry whose slots are all modifier-only there is nothing in the file that records which one
 * came first (a modifier slot has no bind line, and the layer's override body carries no
 * per-override tag), so this cannot always restore the original order. What it can do - and what
 * matters for "a wrong restore must not reassign a user's binds differently every time" - is be a
 * pure function of the file's own content: the same file always produces the same slot order. A slot
 * whose anchor line records its `key`/`mod` (`render.ts#buildAnchorLines`) never reaches this
 * fallback at all - `buildEntry` has already claimed it from that line, in file order.
 */
function modifierOverridesInStableOrder(layers: readonly AltLayer[]): ModifierOverride[] {
  const overrides: ModifierOverride[] = []
  for (const layer of layers) {
    const trigger = normalizeBindKey(layer.triggerKey ?? '')
    if (!MODIFIER_TRIGGERS.has(trigger)) continue
    for (const [key, command] of Object.entries(layer.overrides)) {
      overrides.push({
        modifier: trigger as ModifierTrigger,
        key: normalizeBindKey(key),
        command: command.trim(),
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

/** Does `action` already hold exactly this `(key, modifier)` slot in *any* of its slots - because an
 * anchor line's tag said so? Then the override that anchor stands for must not be handed out a
 * second time. Every slot, not just the first two: story 050 uncapped `keys`, and `render.ts` writes
 * an anchor for every modified slot there is. */
function holdsModifiedSlot(action: ConfigAction, key: string, modifier: ModifierTrigger): boolean {
  return actionKeySlots(action).some(
    (slot) => normalizeBindKey(slot.key) === key && slot.modifier === modifier,
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
 * 2. **Slots.** Every other override whose value is an entry's own mirrored value **appends** a
 *    modified slot to that entry, matched by value the same way `applyActionLayerMirror`'s own strip
 *    pass recognises what it wrote. An override already accounted for by pass 1's anchor
 *    (`holdsModifiedSlot`) is skipped, so an anchored slot is never duplicated. Appending is why
 *    story 050 could delete `modifier-slot-unavailable`: `keys` is uncapped, so "the entry's slots
 *    are all taken" is not a state this can reach.
 *
 * The override stays on the layer either way: it is a derived mirror of this exact field, and the
 * next save would write it back identically.
 *
 * Replaces entries of `actions` in place - they were just constructed here and are not shared yet -
 * but never mutates a `ConfigAction` itself, so `withKeySlot`'s immutability contract holds.
 */
function restoreModifierSlots(actions: ConfigAction[], layers: readonly AltLayer[]): void {
  const overrides = modifierOverridesInStableOrder(layers)

  for (const override of overrides) {
    if (override.command.length === 0) continue
    // `action.parts === undefined` (story-045 review, finding 4): a `toggle`/`press-release` entry
    // keeps `commands: []` **by contract** - its real bodies live in `parts` - so "no command yet"
    // is not a statement about it at all. Without this guard the first modifier override whose
    // command matched fell straight into the branch below and wrote a raw command into a two-part
    // entry's `commands`, producing exactly the half-an-entry shape `ConfigAction.parts`' own doc
    // comment says the model must never hold (`modifiedSlotToggleProfile` is the reachable case: its
    // only slot is modified, so its key really does arrive on an anchor line). Such an entry needs
    // nothing from this pass anyway - its commands came off its own alias lines, and its slot off the
    // anchor - and pass 2 below already skips it through `holdsModifiedSlot`.
    const anchored = actions.findIndex(
      (action) =>
        action.parts === undefined &&
        action.commands.length === 0 &&
        holdsModifiedSlot(action, override.key, override.modifier),
    )
    if (anchored !== -1) {
      actions[anchored] = {
        ...actions[anchored]!,
        commands: [configCommandFor(override.command)],
      }
    }
  }

  for (const override of overrides) {
    // Known limitation, deliberately not fixed (story 042 review round 2, NEW-4): the first action
    // whose mirrored value matches wins, with no check that an earlier override already claimed it -
    // ideally a matched override/action pair would leave the candidate pool. No profile this app can
    // write constructs two entries with the same `bindValueFor` (every writer is find-or-create on
    // `catalogId`, and a launcher-written file records every modified slot as an anchor line, which
    // is filled above and skipped below), so reaching it needs a hand-edited or foreign file.
    const index = actions.findIndex((action) => bindValueFor(action) === override.command)
    if (index === -1) continue
    const owner = actions[index]!
    if (owner.kind === 'alias') continue
    if (holdsModifiedSlot(owner, override.key, override.modifier)) continue
    actions[index] = withKeySlot(owner, keySlotCount(owner), {
      key: override.key,
      modifier: override.modifier,
    })
  }
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * How this section identifies its *category*, for the "within the same section" scope an anchor is
 * matched in (the story's decision).
 *
 * Not the `Section` object itself: one category writes three separate banners in a launcher file
 * (`Aliases: X`, `Binds: X`, `Entries: X` - `render.ts`), so an anchor and the entry it belongs to
 * sit under three *different* header lines of the same category by construction. A tagged header's
 * `cat` id is that identity; the reserved "Other" bucket is one shared scope (all three of its
 * banners are `kind: 'other'`); an untagged banner falls back to its own title, which is what a
 * category whose `cat=` tag was hand-deleted still has in common across its three banners. A layer
 * header stays per-line, since layer membership is positional and never shared.
 */
function sectionCategoryKey(section: Section | null): string {
  if (section === null) return 'none'
  if (section.kind === 'layer') return `layer:${section.file}:${section.line}`
  if (section.kind === 'other') return 'other'
  // A sub-category narrows the scope rather than sharing its parent's (story 053 D3). The three
  // banners of one sub-category (its category's `Aliases: `/`Binds: `/`Entries: ` sections each carry
  // it, `withSubcategoryBuckets`) state the same parent and the same `sub` id, so an entry's own
  // lines still meet - and two entries the user named the same thing in two different
  // sub-categories of one category stay two entries, for exactly the reason the scope was made
  // per-category in the first place (story-050 review, finding 4: keyed on the bare name, the two
  // collapsed into one group and one of them vanished with its keys and its body).
  if (section.kind === 'subcategory') {
    return `${sectionCategoryKey(section.parent ?? null)}|sub:${taggedSubcategoryId(section.fields) ?? ''}`
  }
  const tagged = section.fields.cat
  if (tagged !== undefined && tagged.length > 0) return `cat:${tagged}`
  return `title:${section.title}`
}

/**
 * Every launcher-owned line, grouped into entries by what the config *text* says, in the order the
 * file itself puts those entries in (`orderGroupsByFile`), plus any `alias` definition that carries
 * no `[q2l` tag at all (`untaggedAliases`).
 *
 * ## What identifies an entry (story 050)
 *
 * There is no ref to group by any more, so identity comes out of the lines themselves - one shared
 * `Map`, whose keys are alias names and bind values, each **scoped to the category section the line
 * sits in** (`groupKey`):
 *
 * - **an alias line, by its own alias name.** A chunk-split body (`alias <base>_p<n>`,
 *   `alias-render.ts`) folds onto the base line that calls the chunks - the same family
 *   `commandsFromAliases` recombines the bodies of, so the fold and the recombination cannot
 *   disagree about what one entry is. Only a launcher-owned alias name in the *same* category counts
 *   as a base: folding onto an untagged line would pull a hand-added or layer-internal alias into an
 *   entry it has nothing to do with.
 * - **a bind line, by its bind value.** `render.ts` writes one value per entry (`bindValueFor`) on
 *   every one of its keys, so the several `bind` lines running one command are one entry with
 *   several keys (AC4), a third such line is a third key (AC3), and nothing has to agree about a
 *   field for that to hold.
 * - **the two join** by sharing that one key space: a bind value that *equals* a grouped alias name
 *   lands in that alias line's group, which is exactly what the mirror wrote there - a lookup
 *   rather than a guess, and the pairing AC4 asks for with no ref involved.
 * - **an anchor line, by `matchAnchor`** (see there): `cid`, then exact prose, within its own
 *   category section.
 *
 * ## Why the key is scoped to the category (story-050 review, finding 4)
 *
 * An entry's derived alias name is a slug of its display name with no id suffix
 * (`alias-render.ts#derivedAliasName`, story 039), so two entries the user happened to name the same
 * thing - `Fire` under Weapons and `Fire` under Movement - render two `alias fire` lines. Keyed on
 * the bare name, those two collapsed into one group here: one display name, one set of commands and
 * one `cid` survived, and the *other* entry vanished silently, its body and its keys with it. Every
 * line of one entry sits in one category scope by construction (`render.ts` writes an entry's alias
 * line under `Aliases: <cat>` and every one of its bind lines under `Binds: <cat>`, and
 * `sectionCategoryKey` deliberately collapses a category's three banners into one scope), which is
 * the same scope `matchAnchor` already matched anchors in - so scoping the whole key space costs
 * nothing a healthy file needs and keeps the two entries apart.
 *
 * The scope keeps the *groups* apart; it cannot put back a body the engine's own alias name space
 * already lost. Two entries whose alias names collide - in one category or in two - render two
 * `alias fire` lines, and every reader folds those to one line (last definition wins) before this
 * function runs, so one entry's commands are gone before grouping starts. That loss is reported
 * where it happens, by the fold itself (`entry-alias-duplicate`, see its own doc comment), not from
 * here: from here the surviving line is indistinguishable from a file that only ever had one.
 *
 * A code line carrying no `[q2l` at all is not an entry line: tag *presence* is the whole
 * launcher-owned signal since `e` went away, which is why `render.ts#entryTag` gives every entry
 * line at least the bare `[q2l]` marker. A line whose tag is present but *unreadable* (malformed,
 * with nothing parseable out of it) is not claimed either - it is already reported as
 * `tag-malformed`, and inventing an entry out of a value whose tag may not even have belonged to
 * this entry is the one thing a reader must not do. Its `bind`/`alias` line survives untouched in
 * `profile.binds` either way (see this module's doc comment).
 *
 * ## Why an untagged alias line is different
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
 * of whatever the same alias name's other lines already contributed to its group - would risk a
 * second, duplicate entry for one alias name rather than one degraded one.
 *
 * A raw `bind` line, by contrast, legitimately carries no tag at all (it points straight at an
 * engine command, never at one of this entry model's aliases), so warning on every one of those
 * would fire on every healthy launcher-written file - the exact false positive AC6's "config line
 * wins" rule and 041's "raw bind stays a raw bind" decision both already reject.
 */
function groupEntryLines(
  aliases: readonly RestoreAliasLine[],
  binds: readonly RestoreBindLine[],
  comments: readonly RestoreCommentLine[],
  layerSections: readonly Section[],
  sections: readonly Section[],
  warnings: RestoreWarning[],
  consumed: RestoreSourcePosition[],
): { groups: EntryGroup[]; untaggedAliases: RestoreAliasLine[]; merges: TwoPartMerge[] } {
  /** Category scope -> (alias name / bind value -> the group). */
  const groups = new Map<string, Map<string, EntryGroup>>()
  /**
   * Find-or-create, by the line's category scope and then by its own name/value. Two nested maps
   * rather than one composite string key: a bind value is arbitrary config text (`bind x "wait;
   * +attack"`), so there is no printable separator a composite key could safely be joined on, and
   * the per-category map is exactly the candidate set `matchAnchor` needs anyway.
   *
   * The group's own `key` field stays the bare file datum - the alias name, the bind value - because
   * that is what a warning's `subject` and the last-resort display name are allowed to be.
   */
  const groupFor = (category: string, key: string): EntryGroup => {
    let scope = groups.get(category)
    if (!scope) {
      scope = new Map<string, EntryGroup>()
      groups.set(category, scope)
    }
    const existing = scope.get(key)
    if (existing) return existing
    const created: EntryGroup = { key, aliases: [], binds: [], anchors: [], unbounds: [] }
    scope.set(key, created)
    return created
  }

  /** The category scope a line sits in - the same key `matchAnchor` scopes an anchor by, so an
   * entry's own lines and the anchors that belong to them are scoped identically. */
  const categoryKeyOf = (position: RestoreSourcePosition): string =>
    sectionCategoryKey(sectionFor(sections, position))

  /** Every group built so far, in creation order (category first seen, then name first seen within
   * it) - the fallback order `orderGroupsByFile` breaks its ties with. */
  const allGroups = (): EntryGroup[] => [...groups.values()].flatMap((scope) => [...scope.values()])

  /**
   * A line inside a layer section belongs to the layer, not to an entry. This protects real
   * content: `render.ts#buildLayerSections` emits a hold layer's `+x`/`-x` alias pair (and a toggle
   * layer's dispatch/chunk/helper aliases, `alt-layers.ts`) with no tag at all - membership is
   * positional, by design (see that function's own doc comment) - so the alias scan needs this
   * exclusion just as much as the bind scan always has.
   *
   * Story-042-review round-5 (fix-cycle-7): an earlier version of this fix dropped `insideLayer`
   * from the *alias* recovery gate on the theory that no alias line is ever layer content - that
   * was wrong (proven by re-running a hold layer through this exact path: its `+alt`/`-alt` pair
   * came back as two bogus Controls-tab entries with false `tag-missing` warnings the moment the
   * gate stopped excluding them). Known, accepted limitation left in its place: `sectionEnd`
   * returns `Infinity` for a file's *last* section (there is no next one to bound it), so a
   * genuinely hand-added alias a user appends after a file's last layer - the position someone
   * editing the synced file in Notepad would actually pick - still reads as "inside that layer"
   * and is not recovered. Telling the two apart would need either the parser to carry blank-line
   * positions it does not today, or re-deriving `alt-layers.ts`'s full chunk/helper naming budget
   * here to whitelist a layer's *exact* alias family - both a materially larger change than that
   * fix-cycle's budget, for a narrower gap than the two false-positive entries the revert closes.
   */
  const insideLayer = (position: RestoreSourcePosition): boolean =>
    layerSections.some((section) => {
      const end = sectionEnd(sections, section)
      return position.file === section.file && position.line > section.line && position.line < end
    })

  /**
   * One code line's trailing comment, read once: its parsed tag, whether it carried a `[q2l` at all,
   * and whether this pass claims it for an entry. Reported here rather than at the two call sites,
   * so a malformed tag or an unknown key is warned about exactly once per line whatever becomes of
   * the line afterwards.
   */
  const readTag = <T extends RestoreSourcePosition & { comment: string }>(
    item: T,
  ): { line: TaggedLine<T>; owned: boolean; tagged: boolean } => {
    const tagged = item.comment.includes(TAG_SIGIL)
    const parsed = parseMetaTag(item.comment)
    if (parsed.malformed) {
      warnings.push({ reason: 'tag-malformed', file: item.file, line: item.line })
    }
    if (parsed.unknownKeys.length > 0) {
      warnings.push({
        reason: 'tag-unknown-keys',
        file: item.file,
        line: item.line,
        subject: parsed.unknownKeys.join(','),
      })
    }
    // A tag with one garbled token among good ones still identifies its line as the launcher's -
    // only a tag nothing at all could be read out of does not. `claimsEntryAnchor` says the same
    // thing for a comment-only line, and the two predicates have to agree (see there).
    const readable = !parsed.malformed || Object.keys(parsed.fields).length > 0
    return {
      line: { item, fields: parsed.fields, prose: parsed.prose },
      owned: tagged && readable && !insideLayer(item),
      tagged,
    }
  }

  const untaggedAliases: RestoreAliasLine[] = []
  const aliasLines: TaggedLine<RestoreAliasLine>[] = []

  for (const item of aliases) {
    const { line, owned, tagged } = readTag(item)
    if (owned) {
      aliasLines.push(line)
      continue
    }
    if (tagged || insideLayer(item)) continue
    // A switch-bind chain alias (story 007) is never a hand-added definition - it is
    // `renderLoaderFile`'s own generated content, untagged by this story's own design (the Plan's
    // "Not touched" list). Recovering it through 041's inference would file it as a real
    // Controls-tab entry and warn about metadata that was never supposed to exist.
    //
    // Story-042-review round 5, fix-cycle-8: `startsWith(STEP_ALIAS_PREFIX)` was too broad - a
    // hand-added `alias q2l_sword "…"` (a real word starting with the same prefix; `switch-bind.ts`
    // only ever emits `q2l_sw<digits>`) was silently excluded too, the exact data-loss class this
    // exclusion exists to avoid introducing. The exact shape (prefix, then digits, then end of
    // string) is what `stepAliasName` in `switch-bind.ts` actually generates.
    if (item.name === SWITCH_ALIAS || STEP_ALIAS_NAME.test(item.name)) continue
    untaggedAliases.push(item)
    warnings.push({ reason: 'tag-missing', file: item.file, line: item.line })
  }

  /**
   * The three per-line-kind chains `orderGroupsByFile` orders the result with: each group in the
   * order its *first* line of that kind appears in the file. Collected here, while the input arrays
   * (document order, per `RestoreProfilePartsInput`) are being walked, rather than reconstructed
   * from line positions afterwards - a position pair would need a cross-file ordering this module
   * has no way to know, and the arrays already carry the answer.
   */
  const chains: { aliases: EntryGroup[]; binds: EntryGroup[]; anchors: EntryGroup[] } = {
    aliases: [],
    binds: [],
    anchors: [],
  }
  const chain = (kind: keyof typeof chains, group: EntryGroup): void => {
    if (!chains[kind].includes(group)) chains[kind].push(group)
  }

  // The `_p<n>` fold needs every owned alias name up front, which is why the alias lines were
  // collected first rather than grouped as they were read. Scoped by category like the group key
  // itself: a chunk line and the base line that calls it are always emitted into one alias section.
  const ownedAliasNames = new Map<string, Set<string>>()
  for (const line of aliasLines) {
    const category = categoryKeyOf(line.item)
    const named = ownedAliasNames.get(category) ?? new Set<string>()
    named.add(line.item.name)
    ownedAliasNames.set(category, named)
  }
  for (const line of aliasLines) {
    const category = categoryKeyOf(line.item)
    const chunk = CHUNK_SUFFIX.exec(line.item.name)
    const key =
      chunk && ownedAliasNames.get(category)?.has(chunk[1]!) ? chunk[1]! : line.item.name
    const group = groupFor(category, key)
    group.aliases.push(line)
    chain('aliases', group)
  }

  for (const item of binds) {
    const { line, owned } = readTag(item)
    if (!owned) continue
    // The bind value, straight into the same key space the alias names live in - see the join rule
    // in this function's doc comment. Two lines with one value therefore meet in one group without
    // either of them having to say so.
    const group = groupFor(categoryKeyOf(item), item.command.trim())
    group.binds.push(line)
    chain('binds', group)
  }

  /**
   * The two-part idioms (story 045, D7), recognised here - after every alias and bind line has
   * found its group, before the anchor scan below.
   *
   * The *position* matters, and it is the anchor scan that forces it. `render.ts` writes the
   * entry's one display prose on every line of its alias family, so a toggle's three groups carry
   * three *identical* proses - and `matchAnchor` demands exactly one candidate, which means a
   * toggle whose only key slot is a modified one (its claim lives on an anchor line, since a
   * modifier binding has no bind line at all - story 016) matched three candidates, matched none,
   * and its key came back as a separate, commandless entry of its own. Excluding the two half
   * groups from the candidate set leaves exactly the group the anchor is *for*: the dispatch alias
   * for a toggle, the `+` half for a pair - the same group `bindValueFor` mirrors onto, and the
   * same one `buildTwoPartEntry` reads the merged entry's slots off.
   */
  const merges = recognizeTwoPartGroups(allGroups(), sections)
  /** The non-primary half of every accepted merge - a group that is no longer an entry of its own. */
  const halfGroups = new Set(
    merges.flatMap((merge) => merge.consumed.filter((group) => group !== merge.primary)),
  )

  /** Every non-empty display prose the group's lines carry, in alias -> bind -> anchor order. All of
   * them, not just the first: an entry's lines can legitimately disagree about their prose (one of
   * them hand-renamed, or one of them budget-cut), so an anchor's own prose is compared against each
   * of them rather than against a single designated one. */
  const prosesOf = (group: EntryGroup): string[] =>
    [...group.aliases, ...group.binds, ...group.anchors, ...group.unbounds]
      .map((line) => line.prose.trim())
      .filter((prose) => prose.length > 0)

  /** The catalogue id the group's lines record, `''` for an entry with no catalogue link. Every line
   * of one entry carries the same `cid` (`render.ts#entryTag` reads it off the action, and the tag
   * is never the half that gives way under budget pressure), so the first line that has one speaks
   * for the group. */
  const cidOf = (group: EntryGroup): string =>
    [...group.aliases, ...group.binds, ...group.anchors, ...group.unbounds]
      .map((line) => (line.fields.cid ?? '').trim())
      .find((cid) => cid.length > 0) ?? ''

  /**
   * The entry an anchor line belongs to, or `null` when the file does not say unambiguously.
   *
   * Scoped to the anchor's own category section (`sectionCategoryKey`) and then, per the story's
   * decision, in two steps: by `cid` when the anchor carries one, else by *exact* display prose.
   * The second step is consulted only when the first had nothing to say, and each demands exactly
   * one candidate - two candidates is ambiguity, and the file has stopped being able to say which.
   *
   * **Exact prose, and nothing wider** (story-050 review, finding 1). An earlier version had a
   * third step that paired an anchor with an entry whose prose was merely a *prefix* of the
   * anchor's (in either direction), meant for one display name `fitProseAndTag` had cut at two
   * different lengths on two line kinds. That relation cannot tell such a cut apart from two
   * genuinely different sibling names where one is a prefix of the other (`Reload` next to
   * `Reload weapon`), and merging those two is the one outcome this function must never produce -
   * the merged-away entry loses its name, its commands and its key in one go, with no warning.
   * The User's decision names the entry's "own prose display name" as the anchor's link, and an
   * exact match is exactly that.
   *
   * **Correction to that reasoning** (story-045 review, finding 1). The original wording said a
   * prose cut needs "a display name over a thousand characters long", which is wrong: the budget is
   * spent on the line's *code* first, so a 120-character name on a 900-byte alias line is cut too
   * (see `writtenProseFor`). What keeps exact matching correct here is a different fact - an anchor is a
   * comment-only line, so it has the whole budget to itself and always carries the *whole* name, and
   * `prosesOf` offers **every** prose the candidate group's lines carry rather than one designated
   * one. So the anchor's full name still meets the group's own full-length line. The only shape that
   * misses is a group whose lines were *all* cut, which fails in the safe direction: the anchor
   * becomes its own row, nothing is merged away, and no line is lost. The two-part merge gates
   * cannot afford that fallback (splitting there loses the entry's kind), which is why they use
   * `twoPartProse`' budget-aware comparison instead of this one.
   *
   * `null` is not a failure and never drops a line: the caller gives such an anchor an entry of its
   * own. That is the drift the User accepted when the anchor's link became its prose - "if the user
   * later renames the entry's display text inconsistently across its lines, the anchor and the entry
   * drift apart into two separate rows in the UI, accepted as the user's own mistake, not something
   * the parser must reconcile". Splitting is also the safe direction to fail in: a wrong *merge*
   * would silently rewrite which keys one Controls-tab row owns, whereas a split leaves both rows,
   * both keys and every config line intact and visible.
   */
  const matchAnchor = (anchor: TaggedLine<RestoreCommentLine>): EntryGroup | null => {
    // The group map is keyed by category scope first, so the anchor's own scope *is* its candidate
    // set - the entry a match lands on can therefore never sit in a different category than the
    // anchor, which is what keeps the slot the anchor contributes inside the row the user sees it on.
    // Minus the half groups a two-part merge already claimed - see `merges` above for why.
    // Minus every group an unbound line created (story 052 D3), too: an unbound entry has no key
    // slot at all - that is *why* the writer gave it that line instead of an anchor - so an anchor,
    // which is nothing but a key-slot claim, can never belong to one. Leaving them in the candidate
    // set could only ever cost a real anchor its entry, by making a `cid` or a prose the two happen
    // to share ambiguous.
    const candidates = [...(groups.get(categoryKeyOf(anchor.item))?.values() ?? [])].filter(
      (group) => !halfGroups.has(group) && group.unbounds.length === 0,
    )
    if (candidates.length === 0) return null

    const cid = (anchor.fields.cid ?? '').trim()
    if (cid.length > 0) {
      const byCid = candidates.filter((group) => cidOf(group) === cid)
      return byCid.length === 1 ? byCid[0]! : null
    }

    const prose = anchor.prose.trim()
    if (prose.length === 0) return null

    const exact = candidates.filter((group) => prosesOf(group).includes(prose))
    return exact.length === 1 ? exact[0]! : null
  }

  // The anchor lines (`render.ts#buildAnchorLines`). Scanned last, and in document order, so every
  // entry that has a real config line already exists to be matched against - and so an anchor-only
  // entry's *second* anchor can match the group its first one created.
  //
  // `parseComment`, not `parseMetaTag`: a comment-only line may be a banner, whose tag sits inside
  // trailing decoration. Malformed tags and unknown keys are *not* reported here - `scanComments`
  // already walked every one of these lines and reported them once.
  for (const item of comments) {
    const parsed = parseComment(item.text)
    // A tagged comment inside a layer section belongs to the layer, which is positional and
    // therefore stays here rather than moving into either predicate.
    if (insideLayer(item)) continue

    // `claimsEntryAnchor`/`claimsUnboundEntry` are the shared predicates: a section header or the
    // header block's version marker is not an entry line even if someone hand-edited a `key` into
    // it, and - the other way round - a line either of them claims is never read as a section header
    // either (`claimedByEntryScan`, see there). The two are mutually exclusive, so the order of
    // these two branches decides nothing; both run *here*, in the one pass that consumes a comment
    // line, so a claimed line never reaches the import preview's `preserved` list.
    if (claimsEntryAnchor(parsed)) {
      if (!parsed.malformed) consumed.push({ file: item.file, line: item.line })
      const anchor: TaggedLine<RestoreCommentLine> = {
        item,
        fields: parsed.fields,
        prose: parsed.prose,
      }
      // An unmatched anchor becomes its own entry, created *inside its own category scope* so a
      // later anchor of the same (anchor-only) entry can still find it - `anchor:<file>:<line>` is
      // unique per line, so its own second anchor never lands here at all: it matches by `cid`/prose
      // above.
      const owner =
        matchAnchor(anchor) ?? groupFor(categoryKeyOf(item), `anchor:${item.file}:${item.line}`)
      owner.anchors.push(anchor)
      chain('anchors', owner)
      continue
    }

    if (!claimsUnboundEntry(parsed)) continue
    if (!parsed.malformed) consumed.push({ file: item.file, line: item.line })
    const { command, prose } = unboundLineParts(parsed)
    // Always its own group, never matched onto an existing one - the writer emits this line *only*
    // for an entry that has no other line in the file (`render.ts#isUnboundEntry`), so there is
    // nothing here for a match to attach to and a match could only ever fold two rows into one (see
    // `EntryGroup.unbounds`). Filed in the line's own category scope all the same, so the entry
    // lands in the `Entries: <cat>` section it sits under, exactly as an anchor does.
    const owner = groupFor(categoryKeyOf(item), `unbound:${item.file}:${item.line}`)
    owner.unbounds.push({ item, fields: parsed.fields, prose, command })
    // The same chain the anchors use: unbound lines and anchor lines are siblings in one `Entries:`
    // section, emitted in one merged `profile.actions` order (`render.ts#buildEntrySectionItems`),
    // so they are one subsequence of that order rather than two.
    chain('anchors', owner)
  }

  return {
    groups: orderGroupsByFile(allGroups(), [chains.aliases, chains.binds, chains.anchors]),
    untaggedAliases,
    merges,
  }
}

/**
 * The groups in an order the file's own line order can vouch for (story-050 review, finding 3).
 *
 * Why this is not just "sorted by first line": the writer does not lay an entry's lines out in one
 * run. `renderProfileFile` emits *every* category's alias section, then every category's bind
 * section, then the anchor sections - and sorts each of those independently by the owning action's
 * index (`compareOwnedBinds`). So the file carries the action order three times over, once per line
 * kind, each as a *subsequence* of it, and nothing else. Grouping in map-insertion order ignored all
 * three: groups were created from the alias lines before any bind line was read, so an aliasless
 * entry (a continuous catalogue row bound to its bare `+command`) always sorted *after* every
 * alias-backed entry of its category no matter where its bind line actually sat. `compareOwnedBinds`
 * then re-sorted that category's bind lines by the new index on the next render and the two key
 * lines swapped places - a byte difference on a file nobody had touched, which is exactly what
 * story 042's fixed point forbids.
 *
 * So the answer is the one order consistent with all three subsequences at once: a topological sort
 * over the chains, tie-broken by creation order for the pairs the file genuinely does not order (an
 * alias-only entry and a bind-only entry never share a section, so their relative order cannot be
 * read off the file - and cannot matter either, since no section re-renders them side by side).
 *
 * A cycle can only come from a hand-edited file whose sections were physically reordered against
 * each other; it is resolved by taking the earliest-created group still left and dropping its
 * incoming edges, so this always terminates and always returns every group exactly once.
 */
function orderGroupsByFile(
  all: readonly EntryGroup[],
  chains: readonly (readonly EntryGroup[])[],
): EntryGroup[] {
  const successors = new Map<EntryGroup, EntryGroup[]>(all.map((group) => [group, []]))
  const indegree = new Map<EntryGroup, number>(all.map((group) => [group, 0]))

  for (const chain of chains) {
    for (let index = 1; index < chain.length; index += 1) {
      const from = chain[index - 1]!
      const to = chain[index]!
      successors.get(from)!.push(to)
      indegree.set(to, indegree.get(to)! + 1)
    }
  }

  const remaining = new Set(all)
  const ordered: EntryGroup[] = []
  while (remaining.size > 0) {
    let next: EntryGroup | undefined
    for (const group of remaining) {
      if (indegree.get(group) === 0) {
        next = group
        break
      }
    }
    next ??= remaining.values().next().value!
    remaining.delete(next)
    ordered.push(next)
    for (const successor of successors.get(next)!) {
      indegree.set(successor, Math.max(0, indegree.get(successor)! - 1))
    }
  }

  return ordered
}

/**
 * Story 053 D4: promotes the sections `scanComments`'s repeated-decoration heuristic detected into
 * the actions `buildImportedActions` (story 041) already produced, for a wholly foreign file (no
 * `[q2l …]` tag anywhere) whose own untagged headers happen to state a real category + sub-category
 * pair (a `dm.cfg`-shaped file: `.: Main Key's :.` with `##### 1st row #####` blocks beneath).
 *
 * Deliberately additive rather than a parallel entry-builder: `buildImportedActions` already turns
 * every `alias` definition into a `ConfigAction` (AC8 - a foreign config still imports exactly as
 * story 041 leaves it), complete with its own content-guessed `categoryId` (`guessCategoryKey`). This
 * function only *overrides* that guess, and only for an action whose defining `alias` line's own
 * position falls inside a section the heuristic actually recognised - every other action, and every
 * file with no heuristic pair at all (the overwhelming majority; AC8's own pinned fixture included,
 * since its two banners each use a decoration seen only once and so never clears the "recurs on at
 * least two lines" gate), comes back untouched, categories and all.
 *
 * A raw bind with no alias line of its own is not reachable here - `buildImportedActions` never
 * builds a `ConfigAction` for one at all (`profile.binds` carries it directly, independent of this
 * whole module - the file's own doc comment), so it stays exactly as unowned as it always was; only
 * an alias-backed entry, which is what a foreign author's own `bind key aliasname` + `alias aliasname
 * …` pair always is, can be re-homed.
 */
function applyForeignSubcategoryHeuristic(
  delegated: Pick<ImportedActionsResult, 'actions' | 'categories'>,
  aliases: readonly RestoreAliasLine[],
  sections: readonly Section[],
  newId: () => string,
): { actions: ConfigAction[]; categories: ConfigActionCategory[] } {
  const heuristicSections = sections.filter(
    (section) =>
      section.kind === 'subcategory' && (section.fields.sub ?? '').startsWith(HEURISTIC_SUBCATEGORY_PREFIX),
  )
  if (heuristicSections.length === 0) return { actions: [...delegated.actions], categories: [...delegated.categories] }

  // Last definition of a name wins - the same fold every reader of this format applies before a body
  // ever reaches here (file doc comment); `aliases` is already that folded array, so "the" position
  // of a name is unambiguous.
  const positionByName = new Map(aliases.map((alias) => [alias.name, alias]))
  const registry = categoryRegistry(newId, sections)

  const actions = delegated.actions.map((action) => {
    if (!action.aliasName) return action
    const position = positionByName.get(action.aliasName)
    if (!position) return action
    const section = sectionFor(sections, position)
    if (!section) return action
    const isHeuristicSub = heuristicSections.includes(section)
    const isHeuristicParent = heuristicSections.some((sub) => sub.parent === section)
    if (!isHeuristicSub && !isHeuristicParent) return action
    const categoryId = registry.idFor(section)
    const subcategoryId = registry.subcategoryIdFor(section)
    return { ...action, categoryId, ...(subcategoryId ? { subcategoryId } : {}) }
  })

  // Only the categories an action still points at survive: a category `guessCategoryKey` minted for
  // an action this pass just re-homed would otherwise linger in the result with nothing in it,
  // contradicting "one category with sub-categories" (D4's own Accept). Every category this registry
  // itself mints *is* referenced, by construction (`idFor` only ever runs for an action being
  // re-homed onto it), so the filter only ever drops `delegated.categories` entries, never its own.
  const usedIds = new Set(actions.map((action) => action.categoryId))
  const categories = [...registry.created(), ...delegated.categories].filter((category) =>
    usedIds.has(category.id),
  )
  return { actions, categories }
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
    line.comment.includes(TAG_SIGIL),
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
    const { actions, categories } = applyForeignSubcategoryHeuristic(
      delegated,
      input.aliases,
      scan.sections,
      input.newId,
    )
    return {
      actions,
      categories,
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

  const categories = categoryRegistry(input.newId, scan.sections)
  const layerSections = scan.sections.filter((section) => section.kind === 'layer')

  const consumedCommentLines = [...scan.consumed]
  const { groups, untaggedAliases, merges } = groupEntryLines(
    input.aliases,
    input.binds,
    input.comments,
    layerSections,
    scan.sections,
    warnings,
    consumedCommentLines,
  )
  // Story 045, D7: `groupEntryLines` already ran the recogniser (it has to, so `matchAnchor` can
  // tell a toggle's three same-prose groups apart - see `merges` there). Applying it is strictly
  // additive: a group no merge consumed goes through `buildEntry` exactly as it did before this
  // story, which is what the story's all-or-nothing rule means on this side - a shape the recogniser
  // rejects (a cross-wired trio, a `+x` with no `-x`) restores as the same plain alias entries as
  // ever, and D8's Care checks report it from there. No warning is raised here for a rejected shape:
  // this module reports what a *tag* and its config line disagree about, and these bodies disagree
  // with nothing.
  const mergeByPrimary = new Map(merges.map((merge) => [merge.primary, merge]))
  const consumedGroups = new Set(merges.flatMap((merge) => merge.consumed))

  const actions: ConfigAction[] = []
  for (const group of groups) {
    const merge = mergeByPrimary.get(group)
    if (merge) {
      actions.push(buildTwoPartEntry(merge, scan.sections, categories, input.newId, warnings))
      continue
    }
    // A consumed non-primary group (a toggle's state, a pair's release half) already lives inside
    // the merged entry's `parts`; emitting it again would put its body in the file twice.
    if (consumedGroups.has(group)) continue
    actions.push(buildEntry(group, scan.sections, categories, input.newId, warnings))
  }

  // A hand-added `alias` line that carries no `[q2l` tag at all (`groupEntryLines`' doc comment) -
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

  const layers = layerSections.map((section) =>
    buildLayer(section, scan.sections, input, warnings),
  )

  restoreModifierSlots(actions, layers)

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
