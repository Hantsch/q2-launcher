import type { ConfigAction, ConfigActionCategory, ConfigProfile } from '@shared/modules/config'
import { actionKeySlots } from '@shared/config/action-slots'
import type { AltLayer, GeneratedAlias, GenerateLayerResult } from '@shared/config/alt-layers'
import { generateLayerAliases } from '@shared/config/alt-layers'
import { renderActionAlias, twoPartAliasNames } from '@shared/config/alias-render'
import { actionsWithAliasLine } from '@shared/config/alias-references'
import { bindValueFor } from '@shared/config/action-mirror'
import { categoryLabelFor, commentLabelFor, subcategoryLabelFor } from '@shared/config/comment-labels'
import { normalizeBindKey } from '@shared/config/key-names'
import { ALL_CVARS, findCvar } from '@shared/config/cvar-catalog'
import { CVAR_GROUP_LABELS, CVAR_GROUP_ORDER } from '@shared/config/cvar-facts'
import { writeValueFor } from '@shared/config/cvar-defaults'
import type { ColumnSpec, SectionHeaderStyle } from '@shared/config/cfg-layout'
import {
  alignRows,
  attachTaggedComment,
  banner,
  BANNER_WIDTH,
  fitProseAndTag,
  sanitizeComment,
  section,
} from '@shared/config/cfg-layout'
import { META_FORMAT_VERSION, formatMetaTag, neutralizeProse } from '@shared/config/profile-metadata'
import { limitsFor } from '@shared/config/engine-limits'
import type { EngineKind } from '@shared/types/engine'
import type { SwitchBindChainInput } from './switch-bind'
import { renderSwitchBindChain } from './switch-bind'

/**
 * Plain ASCII sentence the header block carries once story 043's re-import lands (AC1) - phrased as
 * a general caution rather than naming that story, since it does not exist yet. Matches the tone
 * of the target sketch in the story's own Requirement section.
 *
 * Exported (story 042 fix-cycle-5) so `profile-restore.ts` can recognise the header block's fixed
 * four-line shape (rule / name+tag / this sentence / rule) as understood decoration rather than an
 * unrecognised leftover - the same reason it already imports `OWNERSHIP_MARKER` from here.
 */
export const HAND_EDIT_SENTENCE =
  'Q2 Launcher - hand-edited changes to this file are read back'

/**
 * Label for cvars a profile carries that no `CvarDef` in `ALL_CVARS` recognizes (an engine cvar the
 * catalog has not been taught about yet, or a stale/renamed one). Plain ASCII, same rule as every
 * other banner/comment literal in this file - not sourced from `cvar-facts.ts`'s `CVAR_GROUP_LABELS`
 * because "other" is not one of `CvarDef['group']`'s four real values, so it has no matching i18n
 * key to pin against (unlike the four real groups, which D1's `comment-labels.test.ts` already
 * pins).
 */
const OTHER_CVAR_GROUP_LABEL = 'Other'

/** Column spec for a cvar section's name column: one space after the longest name, capped so one
 * absurdly long (or malformed) cvar name cannot push the whole section's alignment off screen - see
 * `alignRows`'s own doc comment for the fallback behaviour once the cap is busted. */
const CVAR_NAME_COLUMN: ColumnSpec = { margin: 1, cap: 40 }

/** The engines `engine-limits.ts` carries source-cited line-budget facts for. Repeated here as a
 * literal (rather than imported) because that module's own backing array is private - same
 * precedent `cvar-facts.ts`'s `ENGINE_KINDS_WITH_FACTS` sets. */
const ENGINES_WITH_LINE_LIMITS: readonly EngineKind[] = ['r1q2', 'q2pro', 'vanilla']

/**
 * The strictest (smallest) per-line byte budget across every engine this app has facts for.
 * `render.ts` is engine-agnostic - a profile is not tied to one engine at render time - so a line
 * has to fit the tightest of the three, not just whichever engine the profile happens to target
 * today (story 040's Decisions). Computed rather than hardcoded so a future engine addition with a
 * smaller line budget is picked up automatically; currently 1024 on all three
 * (`engine-limits.ts`'s `CBUF_LINE_BYTES`). Cvar `set` lines carry no trailing comment in this
 * deliverable, so nothing here calls `attachComment` with it yet - it exists for the bind/alias
 * sections story 040 D3 adds on top of this file.
 */
export const STRICTEST_LINE_BUDGET = Math.min(
  ...ENGINES_WITH_LINE_LIMITS.map((engine) => limitsFor(engine)!.maxLineBytes),
)

/**
 * The budget `attachComment` is actually given for a trailing `// <label>` (story 040 D3).
 *
 * One byte below `STRICTEST_LINE_BUDGET`, because `maxLineBytes` is an *exclusive* bound
 * everywhere else in this codebase: `validate-structure.ts` reports `lineTooLong` at
 * `latin1ByteLength(rawLine) >= limits.maxLineBytes`, and `alt-layers.ts`/`alias-render.ts` keep a
 * whole 16 bytes of headroom below it for the separator the engine appends. `attachComment` fills
 * its budget exactly when it truncates, so handing it the raw 1024 would let a comment produce a
 * line of exactly 1024 bytes - a line the writer's own validator then flags as an error. Only the
 * decoration is squeezed by this; the command part is never measured against it at all (see
 * `attachComment`'s own contract), so an over-long *command* stays over-long and visible rather
 * than being silently cut.
 *
 * Exported since the story-045 review (finding 1): `profile-restore.ts` has to be able to tell a
 * display prose this budget *cut* on one line apart from a genuinely different prose on another, and
 * the only honest way to do that is to measure against the very number the writer measured against.
 */
export const COMMENT_LINE_BUDGET = STRICTEST_LINE_BUDGET - 1

/**
 * The two spaces plus `// ` `attachTaggedComment` puts between a line's code and its comment body.
 * Exported for the same reason `COMMENT_LINE_BUDGET` is - a reader reconstructing how much room a
 * line had for its prose has to subtract exactly what the writer added.
 */
export const COMMENT_PREFIX = '  // '

// ---------------------------------------------------------------------------
// Story 042 D2 / story 050 D6: the `[q2l ...]` metadata tags this file attaches.
//
// `profile-metadata.ts` owns the grammar (how a tag is spelled and read back);
// `cfg-layout.ts` owns the budget rule (prose gives way, the tag survives).
// What lives here is the only part that needs profile knowledge: *which* fields
// each kind of line gets.
//
// Story 050 cut that down to almost nothing. `e` (an 8-hex entry ref), `k` (the
// entry kind) and `slot` (which key slot a line renders) are all gone: the
// first only ever existed to pair the several lines of one entry, which the
// config text itself now does (an alias line by its name, a bind line by its
// value); the second is derivable from the line's own body (`entryKindFor`,
// story 041); the third is derivable from the order the lines appear in the
// file (first claim = slot 1, and so on). With `e` went this file's whole ref
// machinery - `fnv1a32`, `entryRefHex`, `entryRefFor`, `buildEntryRefs` and
// their collision tie-break - because there are no refs left to build.
// ---------------------------------------------------------------------------

/**
 * The fields only an *anchor* line (`buildAnchorLines`) ever contributes - a comment-only line that
 * stands in for something the file's config text has no place for.
 *
 * None of the three is ever passed for a real bind or alias line: a bind line already spells its own
 * key as code and can never carry a modifier at all (a modified slot has no bind line by
 * construction - `buildBindOwnerIndex` skips it, story 016 mirrors it into a modifier layer
 * instead), and an alias line already spells the entry's own alias name. A second, tag-side copy of
 * any of them could only ever drift from the line the engine actually reads.
 */
interface AnchorTagFields {
  /** The slot's key, as tag content - only where no `bind` line spells it out. */
  key?: string
  /**
   * The slot's own `modifier`. Read off the slot the anchor renders rather than off the action as a
   * whole, because an entry's slots can each carry a different modifier - and only reachable here,
   * since a modified slot never produces a `bind` line to put a `mod` on.
   */
  modifier?: string
  /** The entry's own `aliasName` - only where no alias line in the file carries it. */
  aliasName?: string
  /**
   * A toggle/press-release state's own display label (story 045, D4) - only on the one rendered
   * alias line that *is* that state (the line whose name is `twoPartAliasNames(action).first` or
   * `.second`). Never on the dispatch alias line or a `_p<n>` chunk line: those are not a state
   * themselves, they are the entry's plumbing or a fragment of one half's body, and putting the
   * label there would let a reader find "In"/"Out" on the wrong line.
   */
  label?: string
}

/**
 * The `[q2l ...]` tag for one line that belongs to an entry: `cid` when the entry is
 * catalogue-backed, plus - on an anchor line only - the `key`/`mod`/`an` that line's own subject
 * needs (see `AnchorTagFields`). Nothing else: everything story 042 also put here is derivable
 * from the file itself (see the block comment above).
 *
 * **Never returns `''`.** An entry line with no catalogue link and no anchor fields still gets the
 * bare `[q2l]` marker - `formatMetaTag` renders exactly that for empty fields, and
 * `cfg-layout.ts#fitProseAndTag` joins it to the line's prose under that line's own byte budget
 * (which is why the two halves stay separate here rather than being composed in one call - prose is
 * the half that gives way under pressure). That marker is load-bearing rather than tidy: with `e`
 * gone, the tag's mere *presence* is the only thing left that tells a launcher-owned bind line from a raw
 * bind the user typed and commented themselves. Drop it and such a line reads back unowned, moves
 * into the "other binds" section on the next render, and story 042's fixed point is gone one render
 * later.
 */
function entryTag(action: ConfigAction, anchor: AnchorTagFields = {}): string {
  return formatMetaTag({
    cid: action.catalogId || undefined,
    an: anchor.aliasName,
    key: anchor.key,
    mod: anchor.modifier,
    lbl: anchor.label,
  })
}

/** The `[q2l cat=<id> ord=<n>]` tag for a category section header, or `''` for the trailing "other"
 * bucket - that bucket is the *absence* of a category (its members' `categoryId` matches none the
 * profile has), so there is no id to record and a tag would invent one. `ord` is the category's own
 * position (`categoryOrdinals`); a header whose category has no ordinal cannot occur, since every
 * bucket a section is built for comes from `orderedCategoryIds` and every one of those that renders
 * a section has at least one entry. */
function categoryTag(categoryId: string | null, ordinals: ReadonlyMap<string, number>): string {
  if (categoryId === null) return ''
  const ordinal = ordinals.get(categoryId)
  return formatMetaTag({ cat: categoryId, ord: ordinal === undefined ? undefined : String(ordinal) })
}

/** The `[q2l sub=<id>]` tag for a second-level (sub-category) section banner (story 053 D2/story
 * 050's "minimum tag" rule) - nothing else rides alongside it, because the parent category is
 * already derivable from the section the banner sits inside (positional attribution, the same
 * reasoning `buildAnchorSections`'s own doc comment gives for why a line needs no `cat` beyond its
 * header). Unlike `categoryTag`, this never returns `''`: every bucket `withSubcategoryBuckets`
 * builds a banner for really is one of `category.subcategories`, so there is always an id to
 * record. */
function subcategoryTag(subcategoryId: string): string {
  return formatMetaTag({ sub: subcategoryId })
}

/**
 * Each category's position in `profile.categories`, as the `ord` field records it (story 052, F3
 * fix).
 *
 * **Why the file has to say this at all.** The section headers alone cannot: the writer emits its
 * category sections in three separate passes over `profile.categories` (the alias sections, then the
 * bind sections, then the `Entries:` ones), and a category only gets a section in a pass that has
 * something to put in it. Document order is therefore three interleaved *subsequences* of the
 * profile's order, and two categories that share no pass - one whose entries are all still unbound
 * (an `Entries:` section and nothing else), one whose entries are all bound (a `Binds:` section and
 * nothing else) - have no header pair to compare at all. Rendering such a profile with its two
 * categories swapped produces a **byte-identical** file, so no reader could tell the two apart; the
 * rail silently flipped them on the first rebuild-from-file (AC 8's "the file's section order follows
 * the profile's category order"). `profile-restore.ts#orderByFileSections` merges what the headers
 * *do* state and reads this field for the rest.
 *
 * **Why it counts only categories that carry an entry.** A category with no entries writes no section
 * at all, so a restore cannot bring it back (`profile-restore.ts` mints a category from the entries
 * filed under it, never from a bare header). Numbering it anyway would leave a gap in the ordinals
 * the *next* render - of a profile that no longer has it - closes, and the file would differ from the
 * one on disk with nobody having touched it: story 042's fixed point, broken by the very field meant
 * to protect the order it guards. Counting exactly the categories a restore reproduces keeps both
 * renders numbering identically.
 */
function categoryOrdinals(profile: ConfigProfile): Map<string, number> {
  const withEntries = new Set((profile.actions ?? []).map((action) => action.categoryId))
  const ordinals = new Map<string, number>()
  for (const id of orderedCategoryIds(profile)) {
    if (withEntries.has(id)) ordinals.set(id, ordinals.size)
  }
  return ordinals
}

/** The `[q2l layer=... mode=... trigger=...]` tag for a layer section header. `trigger` is omitted
 * entirely - never emitted empty - when the layer has no trigger key (story 011), so "no trigger"
 * reads back as an absent field rather than as a key named `""`. */
function layerTag(layer: AltLayer): string {
  const trigger = layer.triggerKey?.trim() ?? ''
  return formatMetaTag({
    layer: layer.id,
    mode: layer.mode,
    trigger: trigger.length > 0 ? trigger : undefined,
  })
}

/**
 * Column spec for the code *head* of a bind/alias/layer row - `alias <name>` or `bind <key>`,
 * keyword included. The keyword is part of the cell rather than a fixed prefix so a layer section,
 * which mixes `alias` and `bind` lines, still lines its values up in one column (`bind ` is one
 * character shorter than `alias `). Capped for the same reason `CVAR_NAME_COLUMN` is: one
 * pathological alias name must not drag a whole section's value column off screen.
 */
const CODE_HEAD_COLUMN: ColumnSpec = { margin: 1, cap: 40 }

/**
 * Column spec for the value/body column of a commented row - the column that decides where the
 * trailing `//` starts.
 *
 * `margin: 0` on purpose: `attachComment` adds exactly two spaces of its own before the `//`, so a
 * zero-margin value column plus those two spaces *is* the story's "comment column = longest code
 * part + 2". Giving this column a margin as well would just widen that gap by a constant.
 */
const CODE_BODY_COLUMN: ColumnSpec = { margin: 0, cap: 56 }

/**
 * Banner label for actions whose `categoryId` matches neither a built-in category nor one of
 * `profile.categories` (a category the user removed while its entries stayed behind). Plain ASCII,
 * same rule as `OTHER_CVAR_GROUP_LABEL`, and deliberately not routed through `categoryLabelFor` -
 * "other" is not a category id, it is the absence of one.
 *
 * Exported (story-042-review round 5, fix-cycle-8) so `profile-restore.ts` can recognise this
 * reserved, non-user-configurable title on read-back regardless of `sectionHeaderStyle` - `plain`
 * style's banner (`// Aliases: Other`) carries no decoration at all, so `BANNER_RULE` can never
 * flag it as a section on its own, and even where a style's decoration lets `BANNER_RULE` notice it
 * (`dashes`/`brackets`), the generic untagged-section path would otherwise *mint* a brand new,
 * really-existing category named "Other" - which is a real category the original profile never
 * had, and a categoryId that no longer matches nothing on the next render either, breaking AC2's
 * fixed point one render later. Recognising the label lets the reconstruction hand the entry a
 * fresh, never-registered id instead (see `profile-restore.ts#categoryRegistry`), which continues
 * to match nothing on the very next render, exactly like the original orphaned id it stands in for.
 */
export const OTHER_CATEGORY_LABEL = 'Other'

/** Banner title for the binds no action owns - hand-typed, imported, or left behind by a deleted
 * entry. Distinct from a `Binds: Other` section (an *owned* bind whose owner's category is gone):
 * these have no owning entry at all, and therefore no display name to comment with. Exported for
 * the same reason `OTHER_CATEGORY_LABEL` is. */
export const UNOWNED_BINDS_LABEL = 'Other binds'

/**
 * One rendered line, before alignment and before its comment is attached.
 *
 * Split into `head`/`body` rather than kept as one string so `alignRows` can give a section a
 * shared value column and a shared comment column; `comment` is already sanitized and neutralized
 * (the builders below do that at the point they resolve a label, via `proseText`) and is `''` for a
 * row that has no display name to show - an unowned bind, whose owner the file has no record of.
 *
 * `tag` is the row's rendered `[q2l ...]` metadata (story 042), `''` for a line no entry owns. It
 * is kept apart from `comment` rather than pre-composed into it because the two halves are not
 * equally expendable under budget pressure - see `fitProseAndTag`.
 */
interface CodeRow {
  head: string
  body: string
  comment: string
  tag: string
}

/**
 * Aligns `rows` among themselves and attaches each row's trailing comment.
 *
 * The value column is only aligned under two conditions. First, at least one row in the section has
 * to have something to put after its code - a display name, or (story 042) a metadata tag: in a
 * section where none do (the unowned binds), padding the value column would leave every line with
 * trailing spaces and nothing after them. Second, the column has to
 * fit `CODE_BODY_COLUMN.cap` - and when it does not, the column is dropped rather than left to
 * `alignRows`' own one-space fallback, because that fallback plus the two spaces `attachComment`
 * adds would put *three* spaces in front of every `//` in the section. Dropping the column instead
 * gives the plain, unaligned `code  // comment` form, which is what "no alignment" should look
 * like.
 *
 * A row whose comment is dropped anyway - `attachTaggedComment` returning `code` unchanged because
 * not even the bare tag fits - has its padding trimmed back off, so no line in the file ever ends
 * in whitespace it does not need.
 */
function renderRows(rows: CodeRow[]): string[] {
  const commented = rows.some((row) => row.comment.length > 0 || row.tag.length > 0)
  const widestBody = rows.reduce((widest, row) => Math.max(widest, row.body.length), 0)
  const columns =
    commented && widestBody <= CODE_BODY_COLUMN.cap
      ? [CODE_HEAD_COLUMN, CODE_BODY_COLUMN]
      : [CODE_HEAD_COLUMN]

  return alignRows(
    rows.map((row) => [row.head, row.body]),
    columns,
  ).map((cells, index) => {
    const code = `${cells[0]}${cells[1]}`
    const row = rows[index]!
    const line = attachTaggedComment(code, row.comment, row.tag, COMMENT_LINE_BUDGET)
    return line === code ? code.trimEnd() : line
  })
}

/**
 * A generated alias line split back into its head (`alias <name>`) and its body exactly as
 * `renderAliasLine` wrote it - quotes included when it quoted, absent when it did not.
 *
 * Taken off the rendered `line` rather than re-derived from `alias.body`, so this file never
 * carries a second copy of the "quote the body exactly when it contains a `;`" rule that
 * `alt-layers.ts` and `alias-render.ts` already share. The guard is belt-and-braces: every
 * `GeneratedAlias` in this codebase is built by one of those two renderers and therefore does
 * start with `alias <name> `, but a line that somehow did not would be emitted whole as its own
 * head rather than sliced into nonsense.
 */
function splitAliasLine(alias: GeneratedAlias): { head: string; body: string } {
  const head = `alias ${alias.name} `
  if (!alias.line.startsWith(head)) return { head: alias.line, body: '' }
  return { head: `alias ${alias.name}`, body: alias.line.slice(head.length) }
}

/**
 * Every category id a section can be built for: the profile's own categories, in their stored array
 * order, and nothing else (story 052 D4).
 *
 * Until 052 this list started with the three built-in categories (movement, weapons, drops), which
 * hardwired both their presence and their position in the file regardless of what the profile
 * actually carried. Categories are ordinary, profile-owned data now, so the file's section order is
 * simply `profile.categories`' order - reordering a category in the Controls rail moves its section,
 * and a profile that has no `movement` category writes no Movement section. Entries filed under an
 * id the profile no longer has are not lost: they land in `groupByCategory`'s trailing "other"
 * bucket, same as before.
 *
 * Deduplicated, so a profile that somehow carries one id twice cannot produce two sections with the
 * same banner.
 */
function orderedCategoryIds(profile: ConfigProfile): string[] {
  const ids: string[] = []
  for (const category of profile.categories ?? []) if (!ids.includes(category.id)) ids.push(category.id)
  return ids
}

/** One category's bucket. `categoryId: null` is the trailing "other" bucket - items whose category
 * the profile no longer has, which are written all the same (nothing is dropped for tidiness). */
interface CategoryGroup<T> {
  categoryId: string | null
  items: T[]
}

/**
 * Buckets `items` by category, in `orderedCategoryIds` order plus a trailing "other" bucket.
 * Insertion order inside a bucket is the caller's `items` order, so a caller that already sorted
 * (binds, by owning-action index) keeps its ordering and a caller that passes `profile.actions`
 * order gets exactly that. Empty buckets are returned too - `section()` is what drops them, so
 * "no section with a banner and nothing under it" stays one rule in one place.
 */
function groupByCategory<T>(
  profile: ConfigProfile,
  items: readonly T[],
  categoryIdOf: (item: T) => string,
): CategoryGroup<T>[] {
  const order = orderedCategoryIds(profile)
  const buckets = new Map<string, T[]>(order.map((id) => [id, [] as T[]]))
  const other: T[] = []

  for (const item of items) {
    const bucket = buckets.get(categoryIdOf(item))
    if (bucket) bucket.push(item)
    else other.push(item)
  }

  return [
    ...order.map((id) => ({ categoryId: id as string | null, items: buckets.get(id)! })),
    { categoryId: null, items: other },
  ]
}

/**
 * Renders one category bucket's lines with story 053 D2's second bucketing level applied:
 * `items`' own ungrouped run first (an entry whose `subcategoryId` is absent or matches none of
 * `category.subcategories`, mirroring how `groupByCategory` itself treats a dangling
 * `categoryId`), then one banner-and-body block per sub-category in `category.subcategories`
 * order - emitted **even for a sub-category whose bucket is empty** (story 052's "the file is the
 * source of truth for an empty section" mechanism, reused one level down: a sub-category the user
 * just created must not vanish on the next reload).
 *
 * `categoryId === null` (the trailing "other" bucket `groupByCategory` always appends) and a
 * `categoryId` the profile no longer carries a category for both take the flat path straight
 * through to `renderLines` - there is no `ConfigActionCategory` to read `subcategories` off of
 * either way, so the whole bucket renders as one ungrouped run, exactly as every category rendered
 * before this story.
 *
 * `renderLines` is handed each bucket's items and renders that bucket's own lines in isolation
 * (its own `renderRows` alignment pass, or its own plain per-item mapping) - each bucket gets
 * exactly the same per-section treatment a category's own top-level bucket already got, one level
 * further down, mirroring `buildAliasSections`/`buildBindSections`/`buildAnchorSections`'s
 * existing per-category call to `renderRows`.
 *
 * The sub-banner itself is `banner()` in the same `sectionHeaderStyle` as a category banner (the
 * story's decision: no new decoration, indent or width), tagged with `subcategoryTag` and titled
 * with `subcategoryTitle` - carrying no `Binds: `/`Aliases: `/`Entries: ` prefix, since inside an
 * already-prefixed category section that prefix would be noise. Built with `banner()` directly
 * rather than through `titledSection`/`section()`, because `section()` drops a banner outright
 * when its body is empty - exactly the "empty sub-category" case this function must keep.
 */
function withSubcategoryBuckets<T>(
  profile: ConfigProfile,
  categoryId: string | null,
  items: readonly T[],
  subcategoryIdOf: (item: T) => string | undefined,
  renderLines: (items: readonly T[]) => string[],
  style: SectionHeaderStyle,
): string[] {
  const category: ConfigActionCategory | undefined =
    categoryId === null ? undefined : (profile.categories ?? []).find((entry) => entry.id === categoryId)
  if (!category) return renderLines(items)

  const subcategories = category.subcategories ?? []
  const buckets = new Map<string, T[]>(subcategories.map((sub) => [sub.id, [] as T[]]))
  const ungrouped: T[] = []
  for (const item of items) {
    const subcategoryId = subcategoryIdOf(item)
    const bucket = subcategoryId !== undefined ? buckets.get(subcategoryId) : undefined
    ;(bucket ?? ungrouped).push(item)
  }

  const lines = renderLines(ungrouped)
  for (const subcategory of subcategories) {
    lines.push(
      ...banner(
        fitProseAndTag(
          bannerText(subcategoryTitle(category.id, subcategory.id, profile)),
          subcategoryTag(subcategory.id),
          BANNER_CONTENT_BUDGET,
        ),
        { style },
      ),
      ...renderLines(buckets.get(subcategory.id)!),
    )
  }
  return lines
}

/**
 * Longest banner *content* (a title, or one header line) this file will emit.
 *
 * AC7 - "every line stays inside the engine's line-length budget, comments included" - covers the
 * banner lines too, and `banner()` has no budget concept of its own by design (see its own doc
 * comment: it never truncates). Every user-typed string that reaches a banner is capped at 120
 * characters by the IPC payload schemas (`main/modules/config/schemas.ts`: profile name, category
 * name, layer name), so no reachable input comes close - but the *persisted* schema
 * (`main/lib/schemas.ts`) caps none of them, so a hand-edited store could otherwise put a
 * multi-kilobyte comment line in front of the engine's `char line[1024]` cbuf. Clamping here rather
 * than in `cfg-layout.ts` keeps that primitive's "never truncates" contract intact: this file is
 * the one that knows the budget.
 *
 * 256 rather than the raw budget: it is comfortably above the 120-character cap every real name
 * obeys and leaves room for the composed titles below (`Layer: <name> (<mode>, on <key>)`) plus
 * `banner()`'s own prefix and fill to still land well inside `STRICTEST_LINE_BUDGET`.
 */
const BANNER_TEXT_CAP = 256

/**
 * Room a banner's `<title> [q2l ...]` content has, `banner()`'s own decoration excluded.
 *
 * Eight characters below `COMMENT_LINE_BUDGET`, which is exactly what the widest of the two banner
 * forms puts around its content (`// --- ` in front, one space behind); the `=`-ruled header form
 * spends four, so one budget covers both conservatively. This is the ceiling `fitProseAndTag`
 * enforces for a banner line, and it is what makes AC7 hold for a *tagged* banner too: the title
 * gives way, the tag survives, and a tag so long it cannot fit alone (only reachable from a
 * hand-edited store's multi-kilobyte category or layer id) is dropped whole rather than truncated
 * into a `[q2l` with no closing bracket.
 */
const BANNER_CONTENT_BUDGET = COMMENT_LINE_BUDGET - 8

/** `sanitizeComment`, story 042's prose neutralisation and the AC7 length clamp - every string this
 * file hands to `banner()` or `section()` as a *title* goes through here, so no banner line can
 * outgrow the engine's line budget and no user-typed name can forge a `[q2l ...]` tag in one. */
function bannerText(text: string): string {
  return neutralizeProse(sanitizeComment(text)).slice(0, BANNER_TEXT_CAP)
}

/** `sanitizeComment` plus story 042's prose neutralisation - the trailing-comment counterpart of
 * `bannerText`, with no length clamp because `attachTaggedComment` already keeps a code line inside
 * the budget. Neutralisation is what stops a user-typed display name (`SSG [q2l cat=weapons]`) from
 * reading back as a real tag: see `neutralizeProse`. */
function proseText(text: string): string {
  return neutralizeProse(sanitizeComment(text))
}

/** One `section()`, with its title clamped to the banner budget (`bannerText`) and `tag` (`''` for
 * a section that has no metadata to record) appended after it, inside the decoration. The only way
 * this file opens a section, so an over-long title cannot slip past AC7 - and a tag cannot be
 * forgotten - at a single call site.
 *
 * `style` (story 042 D7) is the profile's `sectionHeaderStyle`, threaded down from
 * `renderProfileFile` through every section builder below rather than re-read here - this file has
 * exactly one place that knows the effective value (`renderProfileFile` itself, `?? 'dashes'`), and
 * every other function just carries it. It changes only the decoration `banner()` draws around the
 * title/tag content computed above; the content itself is identical across all three styles. */
function titledSection(title: string, tag: string, lines: string[], style: SectionHeaderStyle): string[] {
  return section(fitProseAndTag(bannerText(title), tag, BANNER_CONTENT_BUDGET), lines, { style })
}

/** The plain-English banner text for a category bucket. User-typed custom category names run
 * through `sanitizeComment` first, for the same reason the profile name does in the header. */
function categoryTitle(categoryId: string | null, profile: ConfigProfile): string {
  if (categoryId === null) return OTHER_CATEGORY_LABEL
  return sanitizeComment(categoryLabelFor(categoryId, profile))
}

/** The plain-English banner text for a sub-category (story 053 D2) - mirrors `categoryTitle` one
 * level down, `sanitizeComment`d for the same reason a user-typed category name is: a sub-category
 * name is user-typed prose too. No "other" case: unlike a category id, a bucket this file ever
 * builds a sub-banner for always names one of `category.subcategories` (`withSubcategoryBuckets`
 * only iterates that array) - an entry whose own `subcategoryId` matches nothing lands in the
 * category's ungrouped run instead, never in a synthesized sub-category bucket. */
function subcategoryTitle(categoryId: string, subcategoryId: string, profile: ConfigProfile): string {
  return sanitizeComment(subcategoryLabelFor(categoryId, subcategoryId, profile))
}

/**
 * The alias sections: one per category, each carrying every alias line the actions in that
 * category produce, with a trailing `// <label>` naming the entry (AC3).
 *
 * `actions` is the list `actionsWithAliasLine` already filtered (story 038/039) and is in
 * `profile.actions` array order, which is the order a category's entries render in. A chunk-split
 * action contributes its whole `_p<n>` family here, every line labelled with the same entry name -
 * the parts are one entry to the user, and a `_p2` line with no comment would read like an
 * orphan.
 */
/** One category/sub-category bucket's worth of alias rows, for every action in `actions` - the
 * per-action logic `buildAliasSections` ran inline before story 053 D2 needed to call it once per
 * bucket (the category's own ungrouped run, then once per sub-category) instead of once per
 * category. */
function aliasRowsFor(actions: readonly ConfigAction[], profile: ConfigProfile): CodeRow[] {
  const rows: CodeRow[] = []
  for (const action of actions) {
    const comment = proseText(commentLabelFor(action, profile))
    // No anchor fields: an alias line is the entry itself, not one of its key slots, and the line
    // already spells the entry's alias name as code. A chunk-split action's whole `_p<n>` family
    // shares the one tag, exactly as it shares the one label. A catalogue-less entry still gets
    // the bare `[q2l]` marker here - see `entryTag`.
    const tag = entryTag(action)
    // A toggle/press-release entry's two state lines each carry their own `lbl` (story 045, D4) -
    // every other line for the entry (the dispatch alias, any `_p<n>` chunk of either half) keeps
    // the plain `tag` above. `twoPartAliasNames` is the one place that knows which rendered name
    // is which half, so the two files can never disagree about it.
    const halfNames = twoPartAliasNames(action)
    const parts = action.parts
    const labelTagFor = (aliasName: string): string => {
      if (!halfNames || !parts) return tag
      if (aliasName === halfNames.first) return entryTag(action, { label: parts[0]?.label })
      if (aliasName === halfNames.second) return entryTag(action, { label: parts[1]?.label })
      return tag
    }
    for (const alias of renderActionAlias(action).aliases) {
      rows.push({ ...splitAliasLine(alias), comment, tag: labelTagFor(alias.name) })
    }
  }
  return rows
}

function buildAliasSections(
  profile: ConfigProfile,
  actions: ConfigAction[],
  style: SectionHeaderStyle,
): string[][] {
  const ordinals = categoryOrdinals(profile)
  return groupByCategory(profile, actions, (action) => action.categoryId).map((group) => {
    const lines = withSubcategoryBuckets(
      profile,
      group.categoryId,
      group.items,
      (action) => action.subcategoryId,
      (items) => renderRows(aliasRowsFor(items, profile)),
      style,
    )
    return titledSection(
      `Aliases: ${categoryTitle(group.categoryId, profile)}`,
      categoryTag(group.categoryId, ordinals),
      lines,
      style,
    )
  })
}

/** A layer section's banner: the layer's name, its mode and the key that triggers it - a layer a
 * reader can identify without cross-referencing the Layers panel. A layer with no trigger assigned
 * (story 011) says so rather than showing an empty pair of parentheses. */
function layerSectionTitle(layer: AltLayer): string {
  const trigger = layer.triggerKey?.trim() ?? ''
  const reach = trigger ? `on ${sanitizeComment(trigger)}` : 'no trigger key'
  return `Layer: ${sanitizeComment(layer.name)} (${layer.mode}, ${reach})`
}

/**
 * One section per layer, in `profile.layers` order: the layer's generated alias lines followed by
 * the `bind <trigger> <command>` line that reaches them, so a layer is one self-contained block.
 *
 * **These sections are emitted last in the file, after every bind section**, and that placement is
 * load-bearing rather than cosmetic. A `.cfg` is `exec`d top to bottom and the engine's binding
 * table keeps one command per key, so of two `bind` lines on the same key the *last one in the file
 * wins*: both run, only the later one survives. A layer's trigger key is allowed to collide with an
 * ordinary bind - the app knowingly permits it and warns about it (`alt-layers.ts`'
 * `layer.triggerConflict`, whose copy promises the user "the layer's trigger binding will take
 * priority"). The pre-040 writer kept that promise for free by emitting every trigger bind in one
 * block at the end of the file.
 *
 * Story 040's "Decided during refine" placed the layer sections *between* the aliases and the
 * binds; that ordering was written without this consequence in view, and would let a colliding base
 * bind be written after the trigger and silently win - nothing dropped, just the wrong line in
 * charge of the key. Moving the whole layer block behind the binds restores the invariant for every
 * case at once instead of special-casing one collision: any base bind vs. any trigger, and between
 * layers, where a later `profile.layers` entry keeps winning over an earlier one exactly as before.
 * A deliberate deviation from that stated section order, taken for a correctness reason; the file
 * still reads aliases-then-binds, only the self-contained layer blocks moved past them.
 *
 * Today's two skip rules are unchanged. A layer that produced no aliases contributes no lines at
 * all - `generateLayerAliases` still returns a nominal `triggerBind` for it, and emitting that
 * bind would point a key at an alias nothing ever defined - and a layer with aliases but no
 * trigger key renders its aliases with no bind line, exactly as before.
 *
 * The trigger bind keeps its unquoted `bind ALT +alt` form (`triggerBind.command` is always a
 * single slugged alias name), and every line in the section is commented with the layer's own
 * name: AC3 asks for a trailing display name on every generated bind and alias, and for these
 * lines the layer *is* the thing they were generated for.
 */
function buildLayerSections(
  profile: ConfigProfile,
  layerResults: readonly GenerateLayerResult[],
  style: SectionHeaderStyle,
): string[][] {
  return (profile.layers ?? []).map((layer, index) => {
    const { aliases, triggerBind } = layerResults[index]!
    if (aliases.length === 0) return []

    const comment = proseText(layer.name)
    // No per-line tag: these lines belong to the *layer*, not to an entry, and everything a reader
    // needs about the layer (its ref, mode and trigger) is on the section header - which is
    // also the only place story 042's key registry allows `layer`/`mode`/`trigger`. Membership is
    // positional, the same way a category section's own lines belong to their header.
    const rows: CodeRow[] = aliases.map((alias) => ({ ...splitAliasLine(alias), comment, tag: '' }))
    if (triggerBind !== null) {
      rows.push({ head: `bind ${triggerBind.key}`, body: triggerBind.command, comment, tag: '' })
    }

    return titledSection(layerSectionTitle(layer), layerTag(layer), renderRows(rows), style)
  })
}

/** An action that owns a bind, plus its index in `profile.actions` - the section-internal sort key
 * the story fixes ("the owning action's index in `profile.actions`"). */
interface BindOwner {
  action: ConfigAction
  index: number
}

/**
 * Index key for the reverse lookup below: a normalized key plus the exact value found on it.
 * A NUL byte separates them, written as the escape `\u0000` and never as a raw byte in this
 * file (a raw control byte makes this module a binary blob to grep/ripgrep and can be silently
 * stripped by an editor, which would collapse the two halves into a colliding key). NUL cannot
 * occur in either half (`sanitizeCommand`/`normalizeBindKey` never produce it and
 * the payload schemas reject control characters), so the two parts can never run together into a
 * colliding string.
 */
function ownerIndexKey(normalizedKey: string, value: string): string {
  return `${normalizedKey}\u0000${value}`
}

/**
 * The reverse index this deliverable exists to get right: **bind value -> owning action**.
 *
 * No helper answers this today. `action-mirror.ts` only goes forward (action -> the value its
 * mirror writes, `bindValueFor`) or answers a yes/no (`isMirroredValue`), so the index is built
 * here - and built to exactly the ownership model story 039 left behind, never a looser one:
 *
 * - **Key-scoped and value-based, both halves required.** An entry in `profile.binds` belongs to
 *   an action when the action holds that key in an unmodified slot *and* the value on it is that
 *   action's own `bindValueFor`. Neither half carries ownership alone - once alias names are
 *   readable (039), a mirrored `ssg_sg` is byte-for-byte a value a user could have typed on any
 *   other key, and a key is a slot rather than an identity. This is the same pair
 *   `applyActionBindMirror`'s strip pass uses to decide what it may delete, which is the point:
 *   the writer must label exactly the entries the mirror considers its own.
 * - **A modified slot is skipped** (story 016): `Alt+R` is never mirrored into `binds` at all, it
 *   lives in that modifier layer's overrides, so an action holding only modified slots owns no
 *   base bind and a plain `r` typed by hand stays unowned.
 * - **A `kind: 'alias'` entry is skipped** (story 019): it is never bound, so it can never own a
 *   bind line even if some key happens to carry its name.
 * - **Later action wins** on an exact key+value tie, mirroring `applyActionBindMirror`'s own
 *   "later action in the array wins" rewrite pass - the surviving entry on that key really is the
 *   one the last mirror pass wrote.
 *
 * Getting this wrong is not a cosmetic risk: a bind matched to the wrong action is filed under the
 * wrong banner with the wrong name, and a bind matched to no action is not lost but demoted to the
 * "other binds" section. Nothing in `renderProfileFile` drops a bind because it failed to find an
 * owner - the two consumers of this index are "which section" and "which comment", never "whether
 * to write the line".
 */
function buildBindOwnerIndex(profile: ConfigProfile): Map<string, BindOwner> {
  const owners = new Map<string, BindOwner>()

  ;(profile.actions ?? []).forEach((action, index) => {
    if (action.kind === 'alias') return
    const value = bindValueFor(action)
    // *Every* mirror slot, read exactly as `action-mirror.ts#mirrorSlots` and
    // `alias-references.ts#ownMirrorBindKeys` read them (all of `actionKeySlots`, no cap of two
    // since story 050) - a modified slot is not a base bind.
    for (const slot of actionKeySlots(action)) {
      const key = slot.key?.trim()
      if (!key || slot.modifier) continue
      owners.set(ownerIndexKey(normalizeBindKey(key), value), { action, index })
    }
  })

  return owners
}

/** One entry of `profile.binds` as the writer sees it, with the owner the reverse index resolved
 * (or `undefined` for a hand-typed/imported bind). `normalizedKey` is carried for sorting only -
 * the key actually written is `key`, verbatim as stored. */
interface BindEntry {
  key: string
  normalizedKey: string
  command: string
  owner: BindOwner | undefined
}

/** Deterministic order inside a category section: the owning action's index first (the order the
 * user arranged the Controls tab in), then the key - so an action holding two keys renders both,
 * side by side, in a stable order. */
function compareOwnedBinds(a: BindEntry, b: BindEntry): number {
  const byAction = a.owner!.index - b.owner!.index
  if (byAction !== 0) return byAction
  return compareByKey(a, b)
}

/** Deterministic order for the unowned binds: normalized key, with the stored spelling as the
 * tie-break so two entries that normalize alike (`f9` and `F9`) still have a fixed order. */
function compareByKey(a: BindEntry, b: BindEntry): number {
  if (a.normalizedKey !== b.normalizedKey) return a.normalizedKey < b.normalizedKey ? -1 : 1
  if (a.key === b.key) return 0
  return a.key < b.key ? -1 : 1
}

/**
 * `ownerIndexKey`s for every layer's own trigger bind that `buildLayerSections` actually emits (a
 * layer whose `aliases` came back empty contributes no section at all - see that function's doc
 * comment - so its nominal `triggerBind` was never written and cannot be physically present in
 * `profile.binds` either).
 *
 * Exists because `profile.binds` mirrors the *physical* bind table (story 034 decision), and a
 * layer's trigger key is a real `bind <key> <command>` line same as any other - so once a file
 * carrying one is re-imported, `profile.binds` legitimately gains an entry for it
 * (`import.ts#commitImport` stores `result.binds` verbatim, never filtered by entry ownership).
 * `buildBindOwnerIndex` only ever resolves an *action's* own bind, so without this index that
 * reimported entry would fall into "other binds" and render a second, redundant copy of a line
 * `buildLayerSections` already writes under the layer's own section - the file would grow a section
 * every time it round-trips. Checked the same way an action's ownership is (`ownerIndexKey`: key
 * *and* value both), so an unrelated hand-typed bind that merely happens to share a layer's trigger
 * key is never swallowed by this - only the exact line the layer itself would write is.
 */
function buildLayerTriggerIndex(layerResults: readonly GenerateLayerResult[]): Set<string> {
  const keys = new Set<string>()
  for (const { aliases, triggerBind } of layerResults) {
    if (aliases.length === 0 || triggerBind === null) continue
    keys.add(ownerIndexKey(normalizeBindKey(triggerBind.key), triggerBind.command))
  }
  return keys
}

/** Every bind line the file will actually carry, split by whether an entry owns it - the one pass
 * that decides that, so `buildBindSections` (which section a line goes in) reads exactly the same
 * answer the two render-time omissions below produced. Both lists are already sorted. */
interface BindEntries {
  owned: BindEntry[]
  unowned: BindEntry[]
}

/**
 * Reads `profile.binds` into the two sorted lists `buildBindSections` writes, applying the two
 * render-time omissions on the way (an empty command is not written at all; a bind that *is* one of
 * `layerResults`' own trigger lines belongs to `buildLayerSections`). Split out of
 * `buildBindSections` so `renderProfileFile` runs it exactly once and the two omissions have one
 * home rather than being re-derived by any second caller.
 */
function collectBindEntries(
  profile: ConfigProfile,
  layerResults: readonly GenerateLayerResult[],
): BindEntries {
  const owners = buildBindOwnerIndex(profile)
  const layerTriggers = buildLayerTriggerIndex(layerResults)
  const owned: BindEntry[] = []
  const unowned: BindEntry[] = []

  for (const [key, command] of Object.entries(profile.binds)) {
    const value = command.trim()
    if (value.length === 0) continue
    const normalizedKey = normalizeBindKey(key)
    if (layerTriggers.has(ownerIndexKey(normalizedKey, value))) continue
    const owner = owners.get(ownerIndexKey(normalizedKey, value))
    const entry: BindEntry = { key, normalizedKey, command, owner }
    if (owner) owned.push(entry)
    else unowned.push(entry)
  }

  owned.sort(compareOwnedBinds)
  unowned.sort(compareByKey)
  return { owned, unowned }
}

/**
 * The bind sections: one per category in the same order the alias sections use, holding the binds
 * whose owning action sits in that category, each with a trailing `// <label>`; then one "other
 * binds" section for every bind no action owns, sorted by key and carrying no comment - the file
 * has no display name for a line the user typed themselves.
 *
 * A bind whose command is empty is not written at all (the user's decision). That happens *here*,
 * on the way out: `profile.binds` is read, never mutated, so nothing downstream of the writer sees
 * a different profile than the one it was handed. `bind x ""` prints the current bind instead of
 * setting one, so it was never doing what the file made it look like it was doing.
 *
 * A bind matching one of `layerResults`' own trigger lines (`buildLayerTriggerIndex`) is skipped
 * entirely here too, for the same reason: that line is `buildLayerSections`' to write, and it
 * already does.
 */
function buildBindSections(
  profile: ConfigProfile,
  entries: BindEntries,
  style: SectionHeaderStyle,
): string[][] {
  const { owned, unowned } = entries

  const bindRow = (entry: BindEntry): CodeRow => {
    const owner = entry.owner
    return {
      head: `bind ${entry.key}`,
      body: `"${entry.command}"`,
      // An unowned bind gets neither: the file has no display name for a line the user typed, and
      // no entry to point a `[q2l ...]` tag at either.
      comment: owner ? proseText(commentLabelFor(owner.action, profile)) : '',
      // An owned line always gets a tag, even a fieldless `[q2l]` one: its mere presence is what
      // marks the line as the launcher's on read-back (see `entryTag`). Which of the entry's slots
      // this line is comes from its position in the file, not from a field.
      tag: owner ? entryTag(owner.action) : '',
    }
  }

  const ordinals = categoryOrdinals(profile)
  const categorySections = groupByCategory(
    profile,
    owned,
    (entry) => entry.owner!.action.categoryId,
  ).map((group) => {
    const lines = withSubcategoryBuckets(
      profile,
      group.categoryId,
      group.items,
      (entry) => entry.owner!.action.subcategoryId,
      (items) => renderRows(items.map(bindRow)),
      style,
    )
    return titledSection(
      `Binds: ${categoryTitle(group.categoryId, profile)}`,
      categoryTag(group.categoryId, ordinals),
      lines,
      style,
    )
  })

  return [
    ...categorySections,
    titledSection(UNOWNED_BINDS_LABEL, '', renderRows(unowned.map(bindRow)), style),
  ]
}

// ---------------------------------------------------------------------------
// Anchor lines (story 042, review fix): the key slots that otherwise leave no
// tagged line in the file at all.
// ---------------------------------------------------------------------------

/** Banner title prefix for an anchor section. `profile-restore.ts`'s `TITLE_PREFIXES` strips this
 * back off when it reads a category name out of the header, exactly as it does for `Aliases: ` and
 * `Binds: ` - so a custom category does not come back renamed. */
const ANCHOR_TITLE_PREFIX = 'Entries: '

/**
 * One anchor line: one **modified key slot** of an entry, standing in for the `bind` line story 016
 * never writes for it. One shape only - see `buildAnchorLines` for the second shape this story's
 * review added and then took back out again.
 */
interface AnchorLine {
  action: ConfigAction
  /** Normalized key of the slot this anchor stands for - see the normalisation note in
   * `buildAnchorLines`. Which slot index that is, is not recorded: it comes back from the order the
   * anchor lines appear in the file (story 050), which is why `buildAnchorLines` walks an entry's
   * slots in index order. */
  key: string
  /** The slot's modifier. Always set - an unmodified slot never gets an anchor at all. */
  modifier: string
  /** The entry's own `aliasName`, carried only when no alias line in the file carries it. */
  aliasName?: string
}

/**
 * The anchor lines the file needs, in `profile.actions` order. The rule is per *slot*, never "does
 * this action have some line somewhere".
 *
 * **A modified slot** (story 016's `Alt+R`) has no `bind` line of its own - it is mirrored into the
 * modifier layer's overrides instead (`buildBindOwnerIndex` skips such a slot deliberately) - and a
 * layer's overrides render as *one* `+alt`/`-alt` alias pair covering all of them, so there is no
 * per-override line for a `[q2l …]` tag to ride on either. Nothing else in the file can say that
 * this entry claims that key, or which modifier it carries there. So **every** modified slot gets
 * its own anchor - every slot of every entry, in slot order, with no cap of two (story 050) -
 * including for an entry that does keep an alias line, because that line is the entry, not one of
 * its keys, and carries no `key`/`mod` at all. Without this, an entry whose slots are *all*
 * modified would leave every one of its keys to `profile-restore.ts`' stable-but-guessed
 * (modifier, key) fallback.
 *
 * **Slot order is the only record of which slot is which** since story 050 dropped the `slot`
 * field: the reader takes claims in file order (bind lines first, then anchors), so the anchors of
 * one entry have to be emitted in ascending slot index - the `for` loop below over
 * `actionKeySlots(action)` is that guarantee, and reordering it would silently permute an entry's
 * keys on the next import.
 *
 * A slot that *does* have a bind line never gets an anchor (one fact, one place), and an unmodified
 * slot with no bind line gets none either: the file's bind table is the observable truth about which
 * key runs what, so recording a key claim the bind table contradicts would hand that key back to
 * this entry on import and let the next save overwrite whatever really sits on it. A
 * `kind: 'alias'` entry gets no anchor at all (story 019: it is never bound and never mirrored into
 * a layer, so a modifier on one is stale data with no representation in the file).
 *
 * ## An entry with no line anywhere gets nothing - deliberately, twice over
 *
 * An entry with no key at all and no alias line either (a catalogue-backed continuous row like
 * `+forward` the user has not bound yet: it mirrors as its own bare command, so story 034/038 drops
 * the alias line, and with no key there is no bind line to fall back to) leaves **no trace in the
 * file**, exactly as before story 042. It is dropped on re-import.
 *
 * Round 2 of this story's review gave such an entry an *entry* anchor - a `slot`/`key`-less line
 * carrying `e`/`k`/`cid`/`an` - so its name, kind, category and catalogue identity survived. Round 3
 * reverted that, because the identity came back without the one thing that makes it usable: with no
 * key, no alias line and no layer override, the file has nowhere to record what the entry *runs*, so
 * `restoreProfileParts` hands it back with `commands: []`. The Controls tab's slot editor is
 * find-or-create on `catalogId` (`renderer/src/modules/config/lib/catalog-binds.ts#applySlot`), so
 * the next time the user binds that same catalogue row through the UI, the restored empty entry is
 * found and spread as the base - and the freshly bound key ends up pointing at an alias name nothing
 * in the file defines: a silently dead key in-game. Dropping the entry instead is strictly better,
 * because `applySlot` then falls through to `freshAction`, which regenerates the row's commands from
 * the catalogue definition. A lost display name is recoverable; a bind that looks set and does
 * nothing is not.
 */
function buildAnchorLines(
  profile: ConfigProfile,
  aliasLineActions: readonly ConfigAction[],
): AnchorLine[] {
  const withAliasLine = new Set(aliasLineActions.map((action) => action.id))

  const anchors: AnchorLine[] = []
  for (const action of profile.actions ?? []) {
    if (action.kind === 'alias') continue
    // Only recorded when no alias line does: with one in the file, *that line's name* is the entry's
    // own alias name (the story's decision - the config text already carries it), and a tag
    // repeating it would be a second, driftable source for the same fact. With no alias line and no
    // bind line to read the mirrored value off, the tag is the only place it can live.
    const aliasName = withAliasLine.has(action.id) ? undefined : action.aliasName?.trim() || undefined

    // Every slot, in slot order - see the slot-order note in this function's doc comment.
    for (const slot of actionKeySlots(action)) {
      const key = slot.key?.trim()
      if (!key || !slot.modifier) continue
      anchors.push({
        action,
        modifier: slot.modifier,
        // Normalized, not verbatim: the key is *tag content* here rather than a rendered command, and
        // the layer override this anchor pairs with is stored normalized too (`applyActionLayerMirror`
        // / `collectOverrides` both normalize). Writing the stored spelling instead would make the
        // re-render of a re-imported file differ from the original by casing alone.
        key: normalizeBindKey(key),
        aliasName,
      })
    }
  }
  return anchors
}

/** One anchor line: a bare `// <display name> [q2l …]` comment, no code at all. The budget is
 * `COMMENT_LINE_BUDGET` minus the `// ` this line spends on its own marker, and the prose gives way
 * to the tag under pressure exactly as it does on a code line (`fitProseAndTag`). */
function anchorRow(anchor: AnchorLine, profile: ConfigProfile): string {
  const tag = entryTag(anchor.action, {
    key: anchor.key,
    modifier: anchor.modifier,
    aliasName: anchor.aliasName,
  })
  const prose = proseText(commentLabelFor(anchor.action, profile))
  return `// ${fitProseAndTag(prose, tag, COMMENT_LINE_BUDGET - 3)}`
}

// ---------------------------------------------------------------------------
// Story 052 D2: the unbound line - a second shape this same section carries,
// for the one entry shape an anchor line does not cover at all: no key of any
// kind (so no bind line and no modifier layer to anchor), and no alias line
// either (see `actionsWithAliasLine`/`renderActionAlias` - a catalogue's own
// continuous row with nothing calling its alias, or an entry seeded with no
// commands at all, never gets one). Before this deliverable such an entry left
// literally nothing in the file (`buildAnchorLines`'s own doc comment,
// "An entry with no line anywhere gets nothing - deliberately, twice over").
//
// D2 gives it a sibling of the anchor line, in the very same `Entries: <cat>`
// section and read back through the same category-scoped matcher (a later
// deliverable, D3) - not a parallel mechanism, one more shape the section
// already has a home for.
// ---------------------------------------------------------------------------

/**
 * Is `action` a candidate for the unbound line - would it otherwise leave no trace at all?
 *
 * Deliberately narrower than "has no key": a `kind: 'alias'`, `'toggle'` or `'press-release'` entry
 * always emits its own alias line(s) (story 045 D3's "always kept" guard in `actionsWithAliasLine`),
 * so giving one of those a second, commented-out trace here would double-emit the same fact - "one
 * fact, one place" (the story's own decision). Only a plain `'bind'`/`'message'` entry can end up
 * with literally nothing: `aliasLineActionIds` is exactly the set of actions
 * `renderActionAlias` produced at least one line for (whether or not anything calls that alias -
 * `actionsWithAliasLine`'s own "keyless, unreferenced survives" guard already covers the ordinary
 * case), `ownedBindActionIds` is who `collectBindEntries` matched a `binds` key to, and
 * `anchoredActionIds` is who `buildAnchorLines` already gave a modified-slot anchor to (that anchor
 * is not this entry's *command* trace, but the command itself still lives in the modifier layer's
 * alias - a real trace this deliverable must not duplicate).
 */
function isUnboundEntry(
  action: ConfigAction,
  aliasLineActionIds: ReadonlySet<string>,
  ownedBindActionIds: ReadonlySet<string>,
  anchoredActionIds: ReadonlySet<string>,
): boolean {
  if (action.kind !== 'bind' && action.kind !== 'message') return false
  if (aliasLineActionIds.has(action.id)) return false
  if (ownedBindActionIds.has(action.id)) return false
  if (anchoredActionIds.has(action.id)) return false
  return true
}

/**
 * Every action `isUnboundEntry` holds for, in `profile.actions` order - the same order
 * `buildAnchorLines` walks, so the two lists can be merged back into one file order by the caller.
 */
function collectUnboundActions(
  profile: ConfigProfile,
  aliasLineActions: readonly ConfigAction[],
  bindEntries: BindEntries,
  anchors: readonly AnchorLine[],
): ConfigAction[] {
  const aliasLineActionIds = new Set(aliasLineActions.map((action) => action.id))
  const ownedBindActionIds = new Set(bindEntries.owned.map((entry) => entry.owner!.action.id))
  const anchoredActionIds = new Set(anchors.map((anchor) => anchor.action.id))
  return (profile.actions ?? []).filter((action) =>
    isUnboundEntry(action, aliasLineActionIds, ownedBindActionIds, anchoredActionIds),
  )
}

/**
 * The command an unbound line's body carries - a real, would-be bind command, never a bare marker
 * (the reverted "entry anchor" attempt's mistake, see `buildAnchorLines`'s doc comment): `""` for an
 * entry with no commands at all (most of `STANDARD_TEMPLATE`'s seeded rows - story 052 D1), else
 * `bindValueFor(action)`, the exact value the mirror would write on a key if this entry had one -
 * the same function `buildBindOwnerIndex`/`collectBindEntries` use, so a row that later *does* get
 * bound through the UI (D3, a later deliverable) restores to the identical value a fresh bind of it
 * would have produced.
 */
function unboundCommand(action: ConfigAction): string {
  return action.commands.length === 0 ? '' : bindValueFor(action)
}

/**
 * One unbound line: `//bind "<cmd>"   // <name> [q2l …]` - the commented-out bind an entry with no
 * key and no alias line otherwise never gets. Shares its trailing-comment machinery
 * (`attachTaggedComment`, `COMMENT_LINE_BUDGET`) with every real code line in this file, with the
 * literal `//bind "<cmd>"` standing in for `code`: to a human it reads as a bind the launcher has
 * commented out, and the tag is what tells `profile-restore.ts` (D3) it is launcher-owned rather than
 * a hand-typed comment.
 *
 * Carries `an` (the entry's own `aliasName`) exactly as an anchor-only entry does - only where no
 * alias line exists to spell it out as code, which for an unbound entry is unconditionally true (it
 * is unbound precisely because it has none). No `key`/`mod`: an unbound entry has no key slot at all,
 * modified or otherwise, by construction (`isUnboundEntry` excludes anything `buildAnchorLines`
 * already anchored).
 */
function unboundLine(action: ConfigAction, profile: ConfigProfile): string {
  const code = `//bind "${unboundCommand(action)}"`
  const tag = entryTag(action, { aliasName: action.aliasName?.trim() || undefined })
  const prose = proseText(commentLabelFor(action, profile))
  return attachTaggedComment(code, prose, tag, COMMENT_LINE_BUDGET)
}

/** One item of an `Entries: <cat>` section - either an existing anchor line or (story 052 D2) an
 * unbound line. A discriminated union rather than two parallel arrays so the section builder below
 * can sort both shapes back into one file order without caring which is which until it renders a
 * row. */
type EntrySectionItem =
  | { kind: 'anchor'; action: ConfigAction; anchor: AnchorLine }
  | { kind: 'unbound'; action: ConfigAction }

/**
 * The anchor and unbound-line entries, merged back into `profile.actions` order.
 *
 * The two lists are disjoint by construction (`isUnboundEntry` excludes every action
 * `anchors` already covers), so this is a plain stable sort by each item's action index rather than
 * a real merge - `Array#sort` in V8/every engine this app targets is stable, so an entry with more
 * than one anchor (several modified slots) keeps those anchors in the slot order `buildAnchorLines`
 * produced them in.
 */
function buildEntrySectionItems(
  profile: ConfigProfile,
  anchors: readonly AnchorLine[],
  unboundActions: readonly ConfigAction[],
): EntrySectionItem[] {
  const actionIndex = new Map<string, number>()
  ;(profile.actions ?? []).forEach((action, index) => actionIndex.set(action.id, index))

  const items: (EntrySectionItem & { index: number })[] = [
    ...anchors.map((anchor) => ({
      kind: 'anchor' as const,
      action: anchor.action,
      anchor,
      index: actionIndex.get(anchor.action.id) ?? 0,
    })),
    ...unboundActions.map((action) => ({
      kind: 'unbound' as const,
      action,
      index: actionIndex.get(action.id) ?? 0,
    })),
  ]
  return items.sort((a, b) => a.index - b.index)
}

/** One `EntrySectionItem` rendered to its line - `anchorRow` for an anchor, `unboundLine` (story 052
 * D2) for an unbound entry. */
function entrySectionItemRow(item: EntrySectionItem, profile: ConfigProfile): string {
  return item.kind === 'anchor' ? anchorRow(item.anchor, profile) : unboundLine(item.action, profile)
}

/**
 * The entry sections: one per category, in the same order the alias and bind sections use, holding
 * every anchor line `buildAnchorLines` found in that category plus (story 052 D2) every unbound line
 * `collectUnboundActions` found in it - siblings in the same section, in `profile.actions` order.
 *
 * Emitted after the bind sections and before the layer sections, so the line sits under its own
 * category header (attribution is positional on the reading side) and outside every layer section
 * (`profile-restore.ts` treats a tagged line inside a layer section as the layer's, not an entry's).
 */
function buildAnchorSections(
  profile: ConfigProfile,
  anchors: readonly AnchorLine[],
  unboundActions: readonly ConfigAction[],
  style: SectionHeaderStyle,
): string[][] {
  const items = buildEntrySectionItems(profile, anchors, unboundActions)
  const ordinals = categoryOrdinals(profile)
  return groupByCategory(profile, items, (item) => item.action.categoryId).map((group) => {
    // `groupByCategory`/`withSubcategoryBuckets` keep the caller's order inside a bucket, so each
    // rendered bucket's rows stay in the merged file order `buildEntrySectionItems` produced them
    // in. No `renderRows` alignment here (unlike the alias/bind buckets): an entry-section row is a
    // bare `//` comment, never a code+value pair to align a column for.
    const lines = withSubcategoryBuckets(
      profile,
      group.categoryId,
      group.items,
      (item) => item.action.subcategoryId,
      (bucketItems) => bucketItems.map((item) => entrySectionItemRow(item, profile)),
      style,
    )
    return titledSection(
      `${ANCHOR_TITLE_PREFIX}${categoryTitle(group.categoryId, profile)}`,
      categoryTag(group.categoryId, ordinals),
      lines,
      style,
    )
  })
}

/**
 * Builds the file's header block (story 051 D2): a small four-line banner, and now the *whole*
 * header - `renderProfileFile` no longer prepends `sentinelLine()` in front of it, so this is
 * literally the first thing a rendered file contains.
 *
 * ```
 * // ==============================================================================
 * //  <name>
 * // ==============================================================================
 * //                              [q2l v=1 id=<profile.id>]
 * ```
 *
 * - The two rules and the name line come from `banner([...], { fill: '=' })` - the same primitive
 *   every other header this codebase draws uses, just with one content line. The profile name is
 *   passed through `bannerText` first (sanitize + neutralize-prose + length cap - a user-typed name
 *   could otherwise carry a CR/LF that splits this single line into several, a character outside
 *   latin1 that breaks the writer's round-trip, or a literal `[q2l` that forges a tag) and then
 *   `trimEnd()`ed: with no tag riding beside it any more, a name that is empty or ends in whitespace
 *   would otherwise leave `//  <name>` carrying trailing blanks it does not need.
 * - The fourth line is *only* the tag - `formatMetaTag({ v: String(META_FORMAT_VERSION), id:
 *   profile.id })` - which is what carries ownership now (story 051): no second, sentinel-shaped
 *   line repeats the id. It is right-aligned so its closing `]` lands on `BANNER_WIDTH`, reading as
 *   a small stamp rather than another line of prose - `//` followed by exactly enough spaces to push
 *   the tag flush to the right edge. When the tag alone is too long for that to leave even one space
 *   of padding (longer than `BANNER_WIDTH - 3`, only reachable from a hand-edited store with an
 *   absurd profile id), it falls back to a plain left-aligned `//  <tag>`, the same shape the name
 *   line uses - never truncated, since a truncated tag is unparseable and worse than an unaligned
 *   one.
 *
 * The former hand-edit sentence line is gone from this block entirely: `HAND_EDIT_SENTENCE` stays
 * exported for `profile-restore.ts`/`rebuild.ts` to recognise on a *read* of an older file, but no
 * render path writes it any more.
 */
function buildHeaderBlock(profile: ConfigProfile): string[] {
  const [topRule, nameLine, bottomRule] = banner([bannerText(profile.name).trimEnd()], { fill: '=' })
  const tag = formatMetaTag({ v: String(META_FORMAT_VERSION), id: profile.id })
  return [topRule!, nameLine!, bottomRule!, headerTagLine(tag)]
}

/**
 * The header block's fourth line: `tag` alone, right-aligned so its closing `]` sits on column
 * `BANNER_WIDTH` - `//` plus just enough spaces to push it flush right. Falls back to a plain
 * left-aligned `//  <tag>` (the name line's own shape) when the tag by itself is longer than
 * `BANNER_WIDTH - 3`, so a pathological id never leaves *negative* padding.
 */
function headerTagLine(tag: string): string {
  if (tag.length > BANNER_WIDTH - 3) return `//  ${tag}`
  return `//${' '.repeat(BANNER_WIDTH - 2 - tag.length)}${tag}`
}

/**
 * The `unbindall` line (story 040 D4): a per-profile setting, default **on**. `!== false` rather
 * than `=== true` is deliberate - `profile.writeUnbindall` is optional, and a profile with no
 * stored value (every profile persisted before this story, or one built in a test without going
 * through `main/lib/schemas.ts`'s `.catch(true)`) has to behave exactly as `true`, not as `false`.
 *
 * A bare single line, never wrapped in `section()`: there is nothing to banner here and no
 * per-entry comment to attach, just the one command the header's own sentence already told the
 * reader is there. Omitted outright (an empty block) when the effective value is `false`, so
 * `joinBlocks` contributes no stray blank line for it either.
 */
function buildUnbindallBlock(profile: ConfigProfile): string[] {
  return profile.writeUnbindall === false ? [] : ['unbindall']
}

/** One `set` line before alignment: the cvar name exactly as it will be written, and the value that
 * goes after it (already resolved - `buildCvarSections` decided whether that is a stored value or a
 * catalogue default, and nothing downstream of it looks at `profile.cvars` again). */
interface CvarLine {
  name: string
  value: string
}

/**
 * Builds one cvar group's section: `set <name> "<value>"` per entry in `lines`, name-column aligned
 * within this section only, under a `// --- <label> ---...` banner - omitted entirely when `lines`
 * is empty (`section()`'s own job). `lines` is already in the order the group should render.
 *
 * Takes resolved name/value pairs rather than names plus the profile's `cvars` map (story 048 D2):
 * the value on a line is no longer `cvars[name]` - a catalogue cvar the profile never stored has a
 * line all the same, carrying `def.default` - so the lookup cannot live here any more without this
 * function needing the catalogue too. One place resolves the value, one place renders it.
 */
function buildCvarSection(label: string, lines: CvarLine[], style: SectionHeaderStyle): string[] {
  const rows = alignRows(
    lines.map((line) => [line.name, `"${line.value}"`]),
    [CVAR_NAME_COLUMN],
  )
  // No tag: a cvar group is not one of the profile's categories and a `set` line is not an entry,
  // so there is no `cat` id to record and nothing for a per-line tag to say.
  return titledSection(label, '', rows.map(([name, value]) => `set ${name}${value}`), style)
}

/**
 * The cvar-group sections, in `CVAR_GROUP_ORDER`, plus a trailing "other" section for names no
 * `CvarDef` recognizes - nothing is dropped (AC: "cvars ... the launcher has no section for still
 * get written").
 *
 * ## Story 048 D2: every catalogue cvar gets a line, not just the stored ones
 *
 * The recognized groups are built by walking `ALL_CVARS` itself, so a rendered file states the
 * *complete* intended configuration rather than only the cvars the user happened to deviate on.
 * That is what makes `exec`ing the file idempotent: whatever ran before it (`config.cfg`, an
 * `autoexec.cfg`, another profile, a mod) cannot leave a stale value standing, because every
 * catalogue cvar is written back to its intended value on every exec. A cvar the profile has no
 * stored value for is written at `def.default` (`writeValueFor`, which also treats an empty or
 * whitespace-only stored value as "nothing stored" - see its own doc comment).
 *
 * Iterating the catalogue also *is* the old ordering: `ALL_CVARS`' index order is what the previous
 * implementation sorted the stored names back into, so a section still reads like the Settings tab
 * and still cannot depend on `Object.keys`' insertion order. Only the *set* of lines changed, and
 * the value on a line the profile did not store.
 *
 * ## Exactly one line per catalogue cvar
 *
 * `findCvar` matches case-insensitively, so a profile can carry two spellings of one cvar
 * (`sensitivity` and `Sensitivity`, both reachable through an import that keeps a file's own
 * casing). Before this deliverable those rendered as two `set` lines side by side; now they must
 * not, because the second line would no longer be another *stored* value - it would be the
 * catalogue default rendering after the user's real value and winning at exec time, a silent
 * clobber. So the stored keys are bucketed by catalogue identity first, and each bucket contributes
 * exactly one line.
 *
 * Which spelling of a colliding pair wins is decided by the stored name, largest last - i.e. the
 * one that already rendered *last* before this change and therefore already won at exec time.
 * Deterministic (a pure function of the key set, never of insertion order) and behaviour-preserving
 * for the one case where the two spellings hold different values. The line is written under that
 * winning stored spelling, not under `def.name`: a stored key's casing is the user's, and
 * canonicalizing it here is a separate question from what this deliverable changes.
 *
 * A stored key `findCvar` does not recognize lands in "other" untouched - verbatim value, no default
 * substitution, sorted alphabetically among its peers.
 *
 * Returns one block (a banner plus its lines) per non-empty group, in order - never includes an
 * empty group's banner (delegated to `section()`).
 */
function buildCvarSections(cvars: Record<string, string>, style: SectionHeaderStyle): string[][] {
  /** Catalogue identity (`def.name` lowercased, the key `findCvar` itself matches on) -> the stored
   * line that claimed it. */
  const claimed = new Map<string, CvarLine>()
  const unknown: CvarLine[] = []

  for (const [name, value] of Object.entries(cvars)) {
    const def = findCvar(name)
    if (!def) {
      unknown.push({ name, value })
      continue
    }
    const id = def.name.toLowerCase()
    const held = claimed.get(id)
    if (held === undefined || held.name < name) claimed.set(id, { name, value })
  }

  const blocks: string[][] = []
  for (const group of CVAR_GROUP_ORDER) {
    const lines = ALL_CVARS.filter((def) => def.group === group).map((def) => {
      const stored = claimed.get(def.name.toLowerCase())
      return {
        name: stored?.name ?? def.name,
        value: writeValueFor(def, stored?.value),
      }
    })
    blocks.push(buildCvarSection(CVAR_GROUP_LABELS[group], lines, style))
  }
  blocks.push(
    buildCvarSection(
      OTHER_CVAR_GROUP_LABEL,
      [...unknown].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      style,
    ),
  )

  return blocks.filter((block) => block.length > 0)
}

/**
 * Joins non-empty section blocks with exactly one blank line between consecutive blocks - never
 * before the first one. An empty block (an omitted section) contributes nothing, not even a stray
 * blank line, so two adjacent omissions never leave a double gap.
 */
function joinBlocks(blocks: string[][]): string[] {
  const nonEmpty = blocks.filter((block) => block.length > 0)
  return nonEmpty.flatMap((block, index) => (index === 0 ? block : ['', ...block]))
}

/**
 * Turns a `ConfigProfile` into the deterministic `.cfg` text q2-launcher
 * writes to disk. Pure - no `fs`, no encoding choice. The caller (the
 * writer) is responsible for writing the resulting string out as `latin1`;
 * this module only has to make sure the strings it produces are safe to
 * round-trip through that encoding, which plain string concatenation of
 * latin1-range characters guarantees on its own.
 */

export const PROFILE_FILE_PREFIX = 'q2l-profile-'
export const PROFILE_FILE_SUFFIX = '.cfg'

/** File name of a profile's own cfg file inside baseq2, e.g. "q2l-profile-<id>.cfg". */
export function profileFileName(profileId: string): string {
  return `${PROFILE_FILE_PREFIX}${profileId}${PROFILE_FILE_SUFFIX}`
}

/**
 * Prefix every q2-launcher-generated file starts with. Used both to write the
 * sentinel line and, by the writer, to detect "is this a file we generated
 * previously" (vs. the user's own hand-written file) - the prefix is checked,
 * not the whole line, because the loader file's sentinel legitimately carries a
 * *different* profile id across saves (whichever profile is the installation's
 * current default) and must still be recognised as ours.
 */
export const OWNERSHIP_MARKER = '// q2-launcher profile'

/**
 * Full sentinel comment line for `profileId`.
 *
 * Uses a plain ASCII hyphen rather than an em dash: the whole line has to
 * survive the writer's latin1 round trip byte-for-byte (see the encoding
 * note above), and an em dash (U+2014) does not - `Buffer.from(str,
 * 'latin1')` truncates it to a control character. Every profile emits this
 * line, so a non-ASCII separator here would break every write, not just ones
 * with high-ASCII cvar/bind values.
 */
export function sentinelLine(profileId: string): string {
  return `${OWNERSHIP_MARKER} ${profileId} - hand-edited changes are read back`
}

/**
 * Renders a profile's own cvars+binds(+layers) file (what gets written to
 * `baseq2/q2l-profile-<id>.cfg`). Deterministic: every ordering below is derived from stored data
 * (a catalog index, an array index, a sort over keys), never from `Object.keys` insertion order or
 * a clock, so the same profile always renders byte-identical output regardless of how its maps
 * were built.
 *
 * Layout (story 040; D2 built the first two blocks, D3 everything from the aliases on; story 051 D2
 * folded what was blocks 1+2 into one four-line header block, see `buildHeaderBlock`):
 *
 * 1. the four-line header block: a `=`-ruled banner around the profile name, then a right-aligned
 *    `[q2l v=<META_FORMAT_VERSION> id=<profile.id>]` tag line - the file's *only* ownership
 *    marker now (story 051; the old separate `sentinelLine()` prefix and hand-edit sentence are
 *    gone from this render path, `sentinelLine()` itself only still used by `renderLoaderFile`);
 * 2b. (story 040 D4) a single bare `unbindall` line, when `profile.writeUnbindall` is not
 *    explicitly `false` - the per-profile setting defaults to on, so a profile with no stored
 *    value carries this line exactly as one with `writeUnbindall: true` does;
 * 3. one `// --- <label> ---` section per cvar group in `CVAR_GROUP_ORDER`, carrying a `set` line
 *    for *every* cvar in `ALL_CVARS` (story 048 D2 - a cvar the profile stored no value for is
 *    written at its catalogue default, so the file states the complete intended configuration and
 *    `exec`ing it is idempotent), plus an "other" section for cvars no `CvarDef` recognizes; each
 *    section's `set` lines are name-column aligned among themselves and ordered by `ALL_CVARS`'
 *    catalog index (alphabetically in "other");
 * 4. the action alias sections, one per category (built-in order, then `profile.categories` order,
 *    then "other"), entries in `profile.actions` order, every line carrying a trailing
 *    `// <display name>`;
 * 5. the bind sections, one per category in the same order as the alias sections, each bind
 *    ordered by its owning action's index and carrying that entry's display name as a comment;
 * 6. an "other binds" section, sorted by key, for every bind no action owns;
 * 6b. (story 042, review fix; story 052 D2 adds the second shape) one `Entries: <category>` section
 *    per category holding an *anchor* line - a comment-only, `[q2l …]`-tagged line - for every key
 *    slot no config line can record, i.e. every slot bound only through a modifier layer
 *    (`buildAnchorLines`), plus an *unbound* line - `//bind "<cmd>"   // <name> [q2l …]` - for every
 *    plain bind/message entry that would otherwise leave no trace in the file at all
 *    (`collectUnboundActions`);
 * 7. one section per layer in `profile.layers` order, holding that layer's generated aliases and
 *    the `bind <trigger> <command>` line that reaches them - last in the file on purpose, so a
 *    layer's trigger always wins the key it shares with a base bind (see `buildLayerSections`).
 *
 * A section with nothing in it emits no banner at all (`section()`), and blocks are separated by
 * exactly one blank line (`joinBlocks`). Nothing is dropped to make the layout tidy: a cvar, alias
 * or bind the launcher has no category for lands in an explicit "other" section instead.
 *
 * Story 042 D2 hangs a machine-readable `[q2l ...]` tail off the comments blocks 4-7 already
 * carried, so a rendered file records what the plain Quake II syntax has no place for; story 050 D6
 * then cut it back to exactly that and nothing more: an entry's catalogue identity (`cid`), an
 * anchor line's own key and modifier (`key`, `mod`) and its entry's alias name where no alias line
 * spells it (`an`), which category a section holds (`cat`) and which layer (`layer`, `mode`,
 * `trigger`). What a line's own text already says is no longer repeated in its tag: the entry a
 * line belongs to (story 042's `e` ref) now comes from the alias name or bind value the line
 * carries as code, its kind from the line's body, and which key slot of that entry it is from the
 * order the claiming lines appear in the file. Several properties of the result are load-bearing
 * rather than cosmetic and are each pinned by their own test: the profile id appears exactly once
 * in the whole file, and only inside the header block's tag (story 051 D2 - no second,
 * sentinel-shaped copy of it anywhere else), under line-budget pressure the *prose* gives way while
 * a per-line tag survives - the inverse of story 040's rule, since the display name is decoration
 * and the tag is state - and **every** line an entry owns carries a tag, down to a bare `[q2l]`
 * with no fields at all, because that presence is now the only thing distinguishing a generated
 * bind line from a raw one the user typed and commented (see `entryTag`). The cvar sections and the
 * unowned-bind section carry no tags at all: a `set` line is not an entry, and a bind no action
 * owns has nothing to point a tag at.
 *
 * The two layer skip rules predate this story and are unchanged. A layer with no valid overrides
 * generates `aliases: []` but still returns a nominal `triggerBind` - emitting that bind would
 * point the trigger key at an alias that was never defined - so such a layer contributes no
 * section at all; a layer with overrides but no trigger key (story 011) returns `triggerBind:
 * null` and renders its aliases with no bind line to reach them from the keyboard.
 *
 * Actions add no bind line of their own: the `setActions` handler mirrors every keyed action into
 * `profile.binds` as `<key> -> bindValueFor(action)` (story 008 decision 17, story 034), so the
 * bind sections already emit them and `profile.binds` stays the single source of truth for
 * key -> command. What *is* new is that the writer now has to read that mirror backwards to know
 * which entry a bind belongs to - see `buildBindOwnerIndex`, and note that a bind whose owner it
 * cannot resolve is written all the same, just in the "other binds" section. An action whose
 * commands are all empty produces no alias at all, exactly as an empty layer does.
 *
 * A bind whose command is empty is not written (the user's decision for this story). That is a
 * render-time omission only - `profile.binds` is read and never mutated.
 *
 * The trailing comments are real bytes in the file, so a large profile's `effectiveSize` grows
 * with them and can newly cross the engine's exec-buffer warning threshold on r1q2/vanilla (q2pro
 * measures after `COM_Compress`, which strips comments, so it is unaffected). That is the intended
 * surface of this story, not a bug to suppress: `validation-scope.ts` renders the real file and
 * Care warns on the real budget, and silently shrinking the file the user asked for would be
 * worse than the warning.
 *
 * Since story 034 that mirrored value is not always the alias name: a
 * continuous catalogue row (`+forward`, `+attack`) is bound to its own command
 * directly, because the engine only sends the matching `-command` on key-up
 * when the bind string itself starts with `+` (`action-mirror.ts`'s
 * `bindValueFor`). Such an action's alias is then defined and called by
 * nobody, so story 038 filters the action list through
 * `actionsWithAliasLine` (`./alias-references`) before rendering: an alias
 * line whose name appears nowhere else in the file does nothing, the same
 * reason `renderActionAlias` already emits nothing for an action with no
 * usable commands. `kind: 'alias'` entries and actions whose mirror *does* go
 * through the alias are never filtered - see that function for the three
 * guards. The filter is per action, so a chunk-split action either keeps its
 * whole `_p<n>` family or loses all of it.
 *
 * Trigger bind lines are deliberately unquoted (`bind <key> <command>`, not
 * `bind <key> "<command>"`): `triggerBind.command` is always a single slugged
 * alias name (`+drops`, `zoom`) with no spaces, so quoting it would just be a
 * second convention alongside the unquoted single-token commands
 * `generateLayerAliases` itself already writes inside alias bodies (e.g.
 * `bind 1 weapnext`) - introducing quotes here would be inconsistent with
 * that, for no benefit.
 *
 * Ends with a single trailing newline (`\n` only - never `\r\n`).
 */
export function renderProfileFile(profile: ConfigProfile): string {
  const layers = profile.layers ?? []
  const layerResults = layers.map((layer) => generateLayerAliases(layer, profile.binds))

  // Story 042 D7: the per-profile section-banner decoration. `!== undefined` mirrors
  // `writeUnbindall`'s own `!== false` read (story 040 D4) - a profile with no stored value
  // (every profile persisted before this deliverable, or one built without going through
  // `main/lib/schemas.ts`'s `.catch('dashes')`) has to render exactly as `'dashes'`, byte-identical
  // to what this file emitted before this setting existed.
  const sectionHeaderStyle: SectionHeaderStyle = profile.sectionHeaderStyle ?? 'dashes'

  // Story 038/039: only the actions whose alias line something can actually reach. The list is
  // filtered here rather than inside `renderActionAlias`, which is also the action editor's own
  // preview renderer and must keep showing an action's alias whether or not the file will carry
  // it.
  const aliasActions = actionsWithAliasLine(profile.actions ?? [], {
    actions: profile.actions ?? [],
    binds: profile.binds,
    layers,
  })

  const bindEntries = collectBindEntries(profile, layerResults)

  // Story 042 (review fix): every key slot the file's own config lines cannot record - a modified
  // slot has no `bind` line by construction, and no `key`/`mod` anywhere else either.
  // `buildAnchorLines` gives each one a comment-only anchor line to carry its `[q2l …]` tag; see its
  // doc comment, including why an entry with no line at all deliberately gets nothing.
  const aliasLineActions = aliasActions.filter(
    (action) => renderActionAlias(action).aliases.length > 0,
  )
  const anchors = buildAnchorLines(profile, aliasLineActions)

  // Story 052 D2: every plain bind/message entry the lines above leave with no trace at all - see
  // `isUnboundEntry`'s doc comment for exactly which shape that is.
  const unboundActions = collectUnboundActions(profile, aliasLineActions, bindEntries, anchors)

  const lines: string[] = [
    ...joinBlocks([
      buildHeaderBlock(profile),
      buildUnbindallBlock(profile),
      ...buildCvarSections(profile.cvars, sectionHeaderStyle),
      ...buildAliasSections(profile, aliasActions, sectionHeaderStyle),
      // The bind sections come *before* the layer sections, so that a layer's trigger bind is the
      // last `bind` line in the file - see `buildLayerSections`' doc comment.
      ...buildBindSections(profile, bindEntries, sectionHeaderStyle),
      ...buildAnchorSections(profile, anchors, unboundActions, sectionHeaderStyle),
      ...buildLayerSections(profile, layerResults, sectionHeaderStyle),
    ]),
  ]

  return `${lines.join('\n')}\n`
}

/**
 * Renders the loader (what gets written to every `autoexec.cfg` - baseq2's
 * own and every played-mod folder's copy): a sentinel line for `profile.id`
 * followed by `exec <profileFileName>`. This is deliberately a separate, tiny
 * function from `renderProfileFile` because the loader is always generated
 * for whichever profile is an installation's *default*, which is not
 * necessarily the profile whose own cvars file was just (re)written -
 * callers pass whatever profile object is currently the default.
 *
 * `fileName` is the profile's resolved on-disk file name (story 022,
 * `@shared/config/profile-files`'s `resolveProfileFileNames`) - the caller
 * resolves it across the whole profile list and passes it in here, since this
 * function only ever sees one profile and cannot detect a name collision with
 * another.
 *
 * `switchBind` is story 007's optional in-session profile switch chain
 * (`./switch-bind`): when given, its rendered chain is appended after the
 * `exec` line, since the loader `autoexec.cfg` is the one file every
 * profile's own `exec` cannot clobber (story 007 decision 4). Called with no
 * third argument, or with an input `renderSwitchBindChain` reduces to `''`
 * for (fewer than 2 profiles, or no usable key - see its own doc comment),
 * this renders byte-identical to the plain sentinel+exec loader. The chain
 * text itself carries no trailing newline, so it slots in as one more line
 * before the loader's own final `\n`.
 */
export function renderLoaderFile(
  profile: ConfigProfile,
  fileName: string,
  switchBind?: SwitchBindChainInput,
): string {
  const chain = switchBind ? renderSwitchBindChain(switchBind) : ''
  const lines = [sentinelLine(profile.id), `exec ${fileName}`]
  if (chain) lines.push(chain)
  return `${lines.join('\n')}\n`
}
