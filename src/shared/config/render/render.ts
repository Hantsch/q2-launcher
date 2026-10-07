/**
 * Renders a `ConfigProfile` to the `.cfg` text the launcher writes, and the one-line-`exec` loader.
 *
 * Exports `renderProfileFile`, `renderLoaderFile`, `profileFileName`, `sentinelLine` and the
 * profile-file name constants, and re-exports the written vocabulary from `file-vocabulary.ts` so
 * importers keep naming it through the renderer that writes it.
 *
 * - Pure: no `fs`, no encoding choice. The caller writes the string as `latin1`, so every literal
 *   here stays plain ASCII.
 * - Deterministic: every ordering derives from stored data (catalogue index, array index, key
 *   sort), never from map insertion order or a clock, so one profile renders byte-identically.
 * - The file is a header block, an optional `unbindall`, cvar sections, action alias sections, bind
 *   sections, anchor/unbound sections, then layer sections last so a layer's trigger bind wins the
 *   key it shares with a base bind. An empty section emits no banner.
 * - Comments carry machine-readable `[q2l ...]` tags (grammar in `profile-metadata.ts`, budget in
 *   `cfg-layout.ts`); under line-budget pressure the prose gives way and the tag survives. The
 *   profile id appears once, in the header tag.
 * - `profile-restore/` reads the result back: render(restore(text)) === text for an unchanged file.
 */

import type {
  ConfigAction,
  ConfigActionCategory,
  ConfigCvarSection,
  ConfigProfile,
} from '@shared/modules/config'
import { actionKeySlots } from '@shared/config/catalog/action-slots'
import type {
  AltLayer,
  GeneratedAlias,
  GenerateLayerResult,
} from '@shared/config/aliases/alt-layers'
import { generateLayerAliases } from '@shared/config/aliases/alt-layers'
import { renderActionAlias, twoPartAliasNames } from '@shared/config/aliases/alias-render'
import { actionsWithAliasLine } from '@shared/config/aliases/alias-references'
import { bindValueFor } from '@shared/config/aliases/action-mirror'
import {
  categoryLabelFor,
  commentLabelFor,
  cvarSectionLabelFor,
  cvarSubsectionLabelFor,
  subcategoryLabelFor,
} from '@shared/config/render/comment-labels'
import { normalizeBindKey } from '@shared/config/syntax/key-names'
import { ALL_CVARS, findCvar } from '@shared/config/catalog/cvar-catalog'
import { writeValueFor } from '@shared/config/catalog/cvar-defaults'
import type { ColumnSpec, SectionHeaderStyle } from '@shared/config/syntax/cfg-layout'
import {
  alignRows,
  attachTaggedComment,
  banner,
  BANNER_WIDTH,
  fitProseAndTag,
  sanitizeComment,
  section,
} from '@shared/config/syntax/cfg-layout'
import {
  META_FORMAT_VERSION,
  formatMetaTag,
  neutralizeProse,
} from '@shared/config/profile/profile-metadata'
import type { SwitchBindChainInput } from '../aliases/switch-bind'
import { renderSwitchBindChain } from '../aliases/switch-bind'
import {
  COMMENT_LINE_BUDGET,
  CVAR_DEFAULTS_SECTION_ID,
  OTHER_CATEGORY_LABEL,
  OWNERSHIP_MARKER,
  UNOWNED_BINDS_LABEL,
} from '@shared/config/syntax/file-vocabulary'

/** Importers of the written vocabulary keep naming it through the renderer that writes it. */
export {
  COMMENT_LINE_BUDGET,
  STRICTEST_LINE_BUDGET,
  COMMENT_PREFIX,
  CVAR_DEFAULTS_SECTION_ID,
  HAND_EDIT_SENTENCE,
  OTHER_CATEGORY_LABEL,
  OWNERSHIP_MARKER,
  UNOWNED_BINDS_LABEL,
} from '@shared/config/syntax/file-vocabulary'

/**
 * Label for cvars no `CvarDef` in `ALL_CVARS` recognizes (an engine cvar the catalog does not know,
 * or a stale one). Plain ASCII like every banner literal here; not from `CVAR_GROUP_LABELS` because
 * "other" is not one of `CvarDef['group']`'s four values, so there is no i18n key to pin against.
 */
const OTHER_CVAR_GROUP_LABEL = 'Other'

/** Column spec for a cvar section's name column: one space after the longest name, capped so one
 * absurdly long cvar name cannot push the section's alignment off screen (`alignRows` documents the
 * fallback past the cap). */
const CVAR_NAME_COLUMN: ColumnSpec = { margin: 1, cap: 40 }

// The `[q2l ...]` tags: `profile-metadata.ts` owns the grammar, `cfg-layout.ts` the budget rule.
// No `e`, `k` or `slot` field: entry pairing, kind (`entryKindFor`) and slot come from the text.

/**
 * The fields only an anchor line (`buildAnchorLines`) contributes - a comment-only line standing in
 * for something the config text has no place for.
 *
 * Never passed for a real bind or alias line: a bind line spells its key as code and cannot carry a
 * modifier (a modified slot has no bind line, `buildBindOwnerIndex` skips it; it is mirrored into a
 * modifier layer), and an alias line spells the alias name. A tag-side copy could only drift from
 * the line the engine reads.
 */
interface AnchorTagFields {
  /** The slot's key, as tag content - only where no `bind` line spells it out. */
  key?: string
  /**
   * The slot's own `modifier`, read off the slot the anchor renders because an entry's slots can each
   * carry a different one; only reachable here, since a modified slot never produces a `bind` line.
   */
  modifier?: string
  /** The entry's own `aliasName` - only where no alias line in the file carries it. */
  aliasName?: string
  /**
   * A toggle/press-release state's own display label - only on the rendered alias line
   * that is that state (named `twoPartAliasNames(action).first` or `.second`). Never on the dispatch
   * alias or a `_p<n>` chunk, which are plumbing or a fragment of one half's body: a label there
   * would let a reader find "In"/"Out" on the wrong line.
   */
  label?: string
}

/**
 * The `[q2l ...]` tag for one line that belongs to an entry: `cid` when catalogue-backed, plus on an
 * anchor line the `key`/`mod`/`an` its subject needs (`AnchorTagFields`).
 *
 * **Never returns `''`**: a line with nothing to record still gets the bare `[q2l]` marker, the
 * only thing telling a launcher-owned bind from a raw one the user typed - without it the line
 * moves into "other binds" and the fixed point is gone. Prose and tag stay separate because
 * `fitProseAndTag` lets the prose give way under the byte budget.
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
 * bucket - the absence of a category (its members' `categoryId` matches none the profile has), so
 * there is no id to record. `ord` is the category's position (`categoryOrdinals`); every bucket a
 * section is built for comes from `orderedCategoryIds` and has an entry, so it always has one. */
function categoryTag(categoryId: string | null, ordinals: ReadonlyMap<string, number>): string {
  if (categoryId === null) return ''
  const ordinal = ordinals.get(categoryId)
  return formatMetaTag({
    cat: categoryId,
    ord: ordinal === undefined ? undefined : String(ordinal),
  })
}

/** The `[q2l sub=<id>]` tag for a sub-category banner. Nothing rides alongside it: the
 * parent category is derivable from the section the banner sits inside (positional attribution).
 * Never `''`: every bucket `withSubcategoryBuckets` builds a banner for is one of
 * `category.subcategories`. */
function subcategoryTag(subcategoryId: string): string {
  return formatMetaTag({ sub: subcategoryId })
}

/** The `[q2l cvs=<id>]` tag for a cvar-section banner, without `ord`: unlike categories
 * (three render passes, so categories sharing no pass need a stated order) `buildCvarSections`
 * renders every cvar section in one pass, so the file's banner order states the profile's order.
 * Never `''`, the reserved `Defaults` section included (`CVAR_DEFAULTS_SECTION_ID`). */
function cvarSectionTag(sectionId: string): string {
  return formatMetaTag({ cvs: sectionId })
}

/** The `[q2l cvsub=<id>]` tag for a cvar-sub-section banner; no `cvs` alongside it, the
 * parent section being derivable from position. */
function cvarSubsectionTag(subsectionId: string): string {
  return formatMetaTag({ cvsub: subsectionId })
}

/**
 * Each category's position in `profile.categories`, as the `ord` field. Sections are written in
 * three passes, each only for categories with something in it, so two categories sharing no pass
 * would swap without changing a byte; `profile-restore.ts#orderByFileSections` reads this for what
 * the headers cannot state. Only categories with an entry are numbered: a restore mints categories
 * from entries, so a gap would be closed by the next render and change the file untouched.
 */
function categoryOrdinals(profile: ConfigProfile): Map<string, number> {
  const withEntries = new Set((profile.actions ?? []).map((action) => action.categoryId))
  const ordinals = new Map<string, number>()
  for (const id of orderedCategoryIds(profile)) {
    if (withEntries.has(id)) ordinals.set(id, ordinals.size)
  }
  return ordinals
}

/** The `[q2l layer=... mode=... trigger=...]` tag for a layer section header. `trigger` is omitted,
 * never emitted empty, when the layer has no trigger key, so "no trigger" reads back as
 * an absent field rather than a key named `""`. */
function layerTag(layer: AltLayer): string {
  const trigger = layer.triggerKey?.trim() ?? ''
  return formatMetaTag({
    layer: layer.id,
    mode: layer.mode,
    trigger: trigger.length > 0 ? trigger : undefined,
  })
}

/**
 * Column spec for the code head of a bind/alias/layer row (`alias <name>` or `bind <key>`, keyword
 * included). The keyword is part of the cell so a layer section mixing `alias` and `bind` lines still
 * aligns its values in one column. Capped like `CVAR_NAME_COLUMN`.
 */
const CODE_HEAD_COLUMN: ColumnSpec = { margin: 1, cap: 40 }

/**
 * Column spec for the value/body column of a commented row, which decides where the `//` starts.
 * `margin: 0` on purpose: `attachComment` adds two spaces before the `//`, so zero margin plus those
 * two is "comment column = longest code part + 2"; a margin here would widen the gap by a constant.
 */
const CODE_BODY_COLUMN: ColumnSpec = { margin: 0, cap: 56 }

/**
 * One rendered line, before alignment and before its comment is attached. Split into `head`/`body`
 * so `alignRows` can share a value and comment column; `comment` is already sanitized and
 * neutralized (via `proseText`) and `''` for a row with no display name (an unowned bind).
 *
 * `tag` is the row's `[q2l ...]` metadata, `''` for a line no entry owns, kept apart from `comment`
 * because the halves are not equally expendable under budget pressure (`fitProseAndTag`).
 */
interface CodeRow {
  head: string
  body: string
  comment: string
  tag: string
}

/**
 * Aligns `rows` among themselves and attaches each row's trailing comment. The value column is
 * aligned only if some row has something after its code (else padding leaves trailing spaces) and
 * it fits `CODE_BODY_COLUMN.cap`; otherwise it is dropped, as `alignRows`' one-space fallback plus
 * `attachComment`'s two spaces would put three spaces before every `//`. A row whose comment is
 * dropped anyway has its padding trimmed.
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
 * A generated alias line split back into its head (`alias <name>`) and body exactly as
 * `renderAliasLine` wrote it, quotes included when it quoted.
 *
 * Taken off the rendered `line` rather than re-derived from `alias.body`, so the "quote the body
 * exactly when it contains a `;`" rule that `alt-layers.ts` and `alias-render.ts` share is not
 * copied here. The guard is belt-and-braces: a line that did not start with `alias <name> ` is
 * emitted whole as its own head rather than sliced into nonsense.
 */
function splitAliasLine(alias: GeneratedAlias): { head: string; body: string } {
  const head = `alias ${alias.name} `
  if (!alias.line.startsWith(head)) return { head: alias.line, body: '' }
  return { head: `alias ${alias.name}`, body: alias.line.slice(head.length) }
}

/**
 * Every category id a section can be built for: the profile's own categories in stored array order,
 * and nothing else. Categories are ordinary profile-owned data, so reordering one in the
 * Controls rail moves its section, and a profile without a `movement` category writes no Movement
 * section. Entries filed under an id the profile lacks are not lost: they land in `groupByCategory`'s
 * trailing "other" bucket. Deduplicated, so a duplicated id cannot produce two same-banner sections.
 */
function orderedCategoryIds(profile: ConfigProfile): string[] {
  const ids: string[] = []
  for (const category of profile.categories ?? [])
    if (!ids.includes(category.id)) ids.push(category.id)
  return ids
}

/** One category's bucket. `categoryId: null` is the trailing "other" bucket - items whose category
 * the profile no longer has, which are written all the same (nothing is dropped for tidiness). */
interface CategoryGroup<T> {
  categoryId: string | null
  items: T[]
}

/**
 * Buckets `items` by category, in `orderedCategoryIds` order plus a trailing "other" bucket. Order
 * inside a bucket is the caller's `items` order, so a pre-sorted caller (binds by owning-action
 * index) keeps it. Empty buckets are returned too: `section()` drops them, so "no banner with
 * nothing under it" stays one rule in one place.
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
 * One category bucket's lines with the second bucketing level applied: the ungrouped run first,
 * then one banner-and-body block per sub-category - emitted even when empty, so a new sub-category
 * survives a reload. Uses `banner()`, not `section()` (which drops an empty body), and no
 * `Binds: ` prefix (noise inside an already-prefixed section).
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
    categoryId === null
      ? undefined
      : (profile.categories ?? []).find((entry) => entry.id === categoryId)
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
 * Longest banner content this file will emit. `banner()` never truncates by design, so every line
 * must stay inside the engine's line budget here: IPC schemas cap user-typed strings at 120
 * characters, but the persisted schema caps none, so a hand-edited store could put a kilobyte line
 * in front of the engine's `char line[1024]`. 256 leaves room for composed titles
 * (`Layer: <name> (<mode>, on <key>)`) plus prefix and fill inside `STRICTEST_LINE_BUDGET`.
 */
const BANNER_TEXT_CAP = 256

/**
 * Room a banner's `<title> [q2l ...]` content has, decoration excluded: eight below
 * `COMMENT_LINE_BUDGET`, what the widest banner form puts around its content (`// --- ` in front, one
 * space behind; the `=` header form spends four, so one budget covers both). `fitProseAndTag` enforces
 * it, so a tagged banner holds the budget too: the title gives way, the tag survives, and a tag too
 * long to fit alone (only from a hand-edited store's huge category or layer id) is dropped whole
 * rather than truncated into a `[q2l` with no closing bracket.
 */
const BANNER_CONTENT_BUDGET = COMMENT_LINE_BUDGET - 8

/** `sanitizeComment`, `neutralizeProse` and the length clamp - every title this file hands to
 * `banner()` or `section()` goes through here, so no banner line outgrows the engine's budget and no
 * user-typed name can forge a `[q2l ...]` tag in one. */
function bannerText(text: string): string {
  return neutralizeProse(sanitizeComment(text)).slice(0, BANNER_TEXT_CAP)
}

/** `sanitizeComment` plus `neutralizeProse` - the trailing-comment counterpart of `bannerText`, with
 * no clamp because `attachTaggedComment` already keeps a code line inside the budget. Neutralising
 * stops a user-typed display name (`SSG [q2l cat=weapons]`) from reading back as a real tag
 * (`neutralizeProse`). */
function proseText(text: string): string {
  return neutralizeProse(sanitizeComment(text))
}

/** One `section()` with its title clamped (`bannerText`) and `tag` (`''` when there is no metadata)
 * appended inside the decoration. The only way this file opens a section, so an over-long title or a
 * forgotten tag cannot slip in at a single call site.
 *
 * `style` is the profile's `sectionHeaderStyle`, threaded down from `renderProfileFile` (the one
 * place that knows the effective value, `?? 'dashes'`). It changes only the decoration around the
 * title/tag content, which is identical across all three styles. */
function titledSection(
  title: string,
  tag: string,
  lines: string[],
  style: SectionHeaderStyle,
): string[] {
  return section(fitProseAndTag(bannerText(title), tag, BANNER_CONTENT_BUDGET), lines, { style })
}

/** Like `titledSection`, but the banner is emitted even when `lines` is empty: a user-created cvar
 * section with no cvars yet must not vanish on the next reload, the cvar-section counterpart of the
 * sub-banner `withSubcategoryBuckets` emits. Uses `banner()` directly because `section()`
 * drops a banner with an empty body. */
function bannerSection(
  title: string,
  tag: string,
  lines: string[],
  style: SectionHeaderStyle,
): string[] {
  return [
    ...banner(fitProseAndTag(bannerText(title), tag, BANNER_CONTENT_BUDGET), { style }),
    ...lines,
  ]
}

/** The plain-English banner text for a category bucket. User-typed custom names run through
 * `sanitizeComment` first, as the profile name does in the header. */
function categoryTitle(categoryId: string | null, profile: ConfigProfile): string {
  if (categoryId === null) return OTHER_CATEGORY_LABEL
  return sanitizeComment(categoryLabelFor(categoryId, profile))
}

/** The banner text for a sub-category: `categoryTitle` one level down, sanitized as user-typed prose.
 * No "other" case: a sub-banner is only built for a name in `category.subcategories`
 * (`withSubcategoryBuckets`); an entry matching none lands in the ungrouped run. (story 053) */
function subcategoryTitle(
  categoryId: string,
  subcategoryId: string,
  profile: ConfigProfile,
): string {
  return sanitizeComment(subcategoryLabelFor(categoryId, subcategoryId, profile))
}

/** The banner text for a cvar section: `categoryTitle` with a bare label and no title prefix,
 * sanitized as user-typed prose. (story 059) */
function cvarSectionTitle(sectionId: string, profile: ConfigProfile): string {
  return sanitizeComment(cvarSectionLabelFor(sectionId, profile))
}

/** The banner text for a cvar sub-section: `subcategoryTitle` one level down, bare label. */
function cvarSubsectionTitle(
  sectionId: string,
  subsectionId: string,
  profile: ConfigProfile,
): string {
  return sanitizeComment(cvarSubsectionLabelFor(sectionId, subsectionId, profile))
}

/** One category/sub-category bucket's alias rows, for every action in `actions`. Per-bucket (the
 * category's ungrouped run, then each sub-category) rather than per category.
 *
 * `actions` is the list `actionsWithAliasLine` already filtered, in `profile.actions` order. A
 * chunk-split action contributes its whole `_p<n>` family, every line labelled with the entry name -
 * the parts are one entry, and an unlabelled `_p2` would read like an orphan. */
function aliasRowsFor(actions: readonly ConfigAction[], profile: ConfigProfile): CodeRow[] {
  const rows: CodeRow[] = []
  for (const action of actions) {
    const comment = proseText(commentLabelFor(action, profile))
    // No anchor fields: an alias line is the entry, not one of its key slots, and spells the alias
    // name as code. A chunk-split action's `_p<n>` family shares the one tag as it shares the label,
    // and a catalogue-less entry still gets the bare `[q2l]` marker (`entryTag`).
    const tag = entryTag(action)
    // A toggle/press-release entry's two state lines each carry their own `lbl`; every
    // other line (the dispatch alias, any `_p<n>` chunk) keeps the plain `tag`. `twoPartAliasNames`
    // is the one place knowing which rendered name is which half, so the files cannot disagree.
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

/** The alias sections: one per category, each holding every alias line its actions produce with a
 * trailing `// <label>` naming the entry. */
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

/** A layer section's banner: the layer's name, mode and trigger key, so a reader can identify it
 * without the Layers panel. A layer with no trigger says so rather than showing empty
 * parentheses. */
function layerSectionTitle(layer: AltLayer): string {
  const trigger = layer.triggerKey?.trim() ?? ''
  const reach = trigger ? `on ${sanitizeComment(trigger)}` : 'no trigger key'
  return `Layer: ${sanitizeComment(layer.name)} (${layer.mode}, ${reach})`
}

/**
 * One section per layer, in `profile.layers` order: its generated aliases, then the `bind <trigger>
 * <command>` line that reaches them.
 *
 * **These come last in the file, and that is load-bearing**: of two `bind`s on one key the last
 * wins, and a layer trigger may collide with a base bind (`alt-layers.ts`' `layer.triggerConflict`
 * promises the layer's wins). A layer with no aliases contributes nothing (its nominal `triggerBind`
 * would point at nothing); one with aliases but no trigger key renders no bind line.
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
    // No per-line tag: these lines belong to the layer, whose ref, mode and trigger are on the
    // section header (the only place the key registry allows `layer`/`mode`/`trigger`). Membership is
    // positional, as for a category section's lines.
    const rows: CodeRow[] = aliases.map((alias) => ({ ...splitAliasLine(alias), comment, tag: '' }))
    if (triggerBind !== null) {
      rows.push({ head: `bind ${triggerBind.key}`, body: triggerBind.command, comment, tag: '' })
    }

    return titledSection(layerSectionTitle(layer), layerTag(layer), renderRows(rows), style)
  })
}

/** An action that owns a bind, plus its index in `profile.actions` - the section-internal sort key
 * ("the owning action's index"). */
interface BindOwner {
  action: ConfigAction
  index: number
}

/**
 * Index key for the reverse lookup below: a normalized key plus the exact value found on it,
 * separated by a NUL written as the escape `\u0000`, never a raw byte (a raw control byte makes this
 * module a binary blob to grep and can be stripped by an editor, collapsing the key). NUL cannot
 * occur in either half (`sanitizeCommand`/`normalizeBindKey` never produce it and the payload schemas
 * reject control characters), so the halves cannot run together.
 */
function ownerIndexKey(normalizedKey: string, value: string): string {
  return `${normalizedKey}\u0000${value}`
}

/**
 * The reverse index **bind value -> owning action**, to exactly the ownership model the mirror
 * leaves: **key-scoped and value-based, both required** (the action holds that key in an
 * unmodified slot and the value is its own `bindValueFor` - neither alone carries ownership), the
 * pair `applyActionBindMirror`'s strip pass uses. A modified slot and a `kind: 'alias'` entry are
 * skipped; the later action wins an exact tie. A wrong match files a bind under the wrong banner;
 * an unmatched one lands in "other binds", never lost - the index never decides whether to write.
 */
function buildBindOwnerIndex(profile: ConfigProfile): Map<string, BindOwner> {
  const owners = new Map<string, BindOwner>()

  ;(profile.actions ?? []).forEach((action, index) => {
    if (action.kind === 'alias') return
    const value = bindValueFor(action)
    // Every mirror slot, read as `action-mirror.ts#mirrorSlots` and
    // `alias-references.ts#ownMirrorBindKeys` read them (all of `actionKeySlots`, uncapped - story
    // 050); a modified slot is not a base bind.
    for (const slot of actionKeySlots(action)) {
      const key = slot.key?.trim()
      if (!key || slot.modifier) continue
      owners.set(ownerIndexKey(normalizeBindKey(key), value), { action, index })
    }
  })

  return owners
}

/** One entry of `profile.binds` as the writer sees it, with the owner the reverse index resolved (or
 * `undefined` for a hand-typed/imported bind). `normalizedKey` is for sorting only; the key written
 * is `key`, verbatim. */
interface BindEntry {
  key: string
  normalizedKey: string
  command: string
  owner: BindOwner | undefined
}

/** Deterministic order inside a category section: the owning action's index first (the Controls tab
 * order), then the key, so an action holding two keys renders both side by side. */
function compareOwnedBinds(a: BindEntry, b: BindEntry): number {
  const byAction = a.owner!.index - b.owner!.index
  if (byAction !== 0) return byAction
  return compareByKey(a, b)
}

/** Deterministic order for the unowned binds: normalized key, then the stored spelling so entries
 * that normalize alike (`f9` and `F9`) still have a fixed order. */
function compareByKey(a: BindEntry, b: BindEntry): number {
  if (a.normalizedKey !== b.normalizedKey) return a.normalizedKey < b.normalizedKey ? -1 : 1
  if (a.key === b.key) return 0
  return a.key < b.key ? -1 : 1
}

/**
 * `ownerIndexKey`s for every layer trigger bind `buildLayerSections` actually emits. A re-imported
 * file legitimately adds a `profile.binds` entry for the trigger (`import.ts#commitImport`), which
 * `buildBindOwnerIndex` cannot resolve, so it would render as a redundant "other binds" copy and the
 * file would grow on every round trip. Key and value together, so an unrelated bind on the same key
 * is never swallowed.
 */
function buildLayerTriggerIndex(layerResults: readonly GenerateLayerResult[]): Set<string> {
  const keys = new Set<string>()
  for (const { aliases, triggerBind } of layerResults) {
    if (aliases.length === 0 || triggerBind === null) continue
    keys.add(ownerIndexKey(normalizeBindKey(triggerBind.key), triggerBind.command))
  }
  return keys
}

/** Every bind line the file will carry, split by whether an entry owns it - the one pass deciding
 * that, so `buildBindSections` reads the same answer the render-time omissions produced. Both lists
 * are sorted. */
interface BindEntries {
  owned: BindEntry[]
  unowned: BindEntry[]
}

/**
 * Reads `profile.binds` into the two sorted lists `buildBindSections` writes, applying the two
 * render-time omissions (an empty command is not written; a bind that is one of `layerResults`' own
 * trigger lines belongs to `buildLayerSections`). Split out so `renderProfileFile` runs it once and
 * the omissions have one home.
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
 * The bind sections: one per category in the alias sections' order, each bind commented with its
 * owning action's label; then one "other binds" section, sorted by key, uncommented. A bind with an
 * empty command is not written (`bind x ""` prints rather than sets); `profile.binds` is never
 * mutated. A bind matching a layer trigger line (`buildLayerTriggerIndex`) is skipped too.
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
      // An unowned bind gets neither: no display name for a hand-typed line, no entry to tag.
      comment: owner ? proseText(commentLabelFor(owner.action, profile)) : '',
      // An owned line always gets a tag, even a fieldless `[q2l]`: its presence marks the line as the
      // launcher's on read-back (`entryTag`). Which of the entry's slots it is comes from its file
      // position, not a field.
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

// Anchor lines: the key slots that otherwise leave no tagged line in the file at all.

/** Banner title prefix for an anchor section. `profile-restore`'s `TITLE_PREFIXES` strips it back
 * off when reading a category name from the header, as for `Aliases: ` and `Binds: `, so a custom
 * category does not come back renamed. */
const ANCHOR_TITLE_PREFIX = 'Entries: '

/**
 * One anchor line: one modified key slot of an entry, standing in for the `bind` line a modified slot
 * never gets (see `buildAnchorLines`).
 */
interface AnchorLine {
  action: ConfigAction
  /** Normalized key of the slot this anchor stands for. The slot index is not recorded: it comes
   * back from the order the anchor lines appear, so `buildAnchorLines` walks slots in
   * index order. */
  key: string
  /** The slot's modifier. Always set - an unmodified slot never gets an anchor. */
  modifier: string
  /** The entry's own `aliasName`, carried only when no alias line in the file carries it. */
  aliasName?: string
}

/**
 * The anchor lines the file needs, in `profile.actions` order, decided per slot.
 *
 * **A modified slot** (`Alt+R`) has no `bind` line - it lives in the layer's overrides - so each
 * gets its own anchor, in slot order and uncapped, even beside an alias line.
 * **Slot order is the only record of which slot is which**: the reader takes claims in file order,
 * bind lines then anchors, so reordering silently permutes keys.
 * A slot with a bind line, an unmodified slot without one, and a `kind: 'alias'` entry get none.
 *
 * An entry with no key and no alias line (an unbound continuous catalogue row) leaves no trace and
 * is dropped on re-import. An entry anchor to keep it was tried and reverted: identity came back
 * without its commands, and `applySlot` would point a key at an alias nothing defines.
 */
function buildAnchorLines(
  profile: ConfigProfile,
  aliasLineActions: readonly ConfigAction[],
): AnchorLine[] {
  const withAliasLine = new Set(aliasLineActions.map((action) => action.id))

  const anchors: AnchorLine[] = []
  for (const action of profile.actions ?? []) {
    if (action.kind === 'alias') continue
    // Only recorded when no alias line does: with one, that line's name is the entry's alias name
    // and a tag repeating it would be a second, driftable source. With no alias line and no bind line
    // to read the mirrored value off, the tag is the only place it can live.
    const aliasName = withAliasLine.has(action.id)
      ? undefined
      : action.aliasName?.trim() || undefined

    // Every slot, in slot order (see the doc comment).
    for (const slot of actionKeySlots(action)) {
      const key = slot.key?.trim()
      if (!key || !slot.modifier) continue
      anchors.push({
        action,
        modifier: slot.modifier,
        // Normalized, not verbatim: the key is tag content here, and the layer override this anchor
        // pairs with is stored normalized (`applyActionLayerMirror`, `collectOverrides`). The stored
        // spelling would make a re-imported file re-render differently by casing alone.
        key: normalizeBindKey(key),
        aliasName,
      })
    }
  }
  return anchors
}

/** One anchor line: a bare `// <display name> [q2l …]` comment, no code. The budget is
 * `COMMENT_LINE_BUDGET` minus the `// ` it spends on its own marker, and the prose gives way to the
 * tag under pressure as on a code line (`fitProseAndTag`). */
function anchorRow(anchor: AnchorLine, profile: ConfigProfile): string {
  const tag = entryTag(anchor.action, {
    key: anchor.key,
    modifier: anchor.modifier,
    aliasName: anchor.aliasName,
  })
  const prose = proseText(commentLabelFor(anchor.action, profile))
  return `// ${fitProseAndTag(prose, tag, COMMENT_LINE_BUDGET - 3)}`
}

// The unbound line, the `Entries:` section's second shape: a keyless `'bind'`/`'message'` entry
// gets it even beside an alias line - the alias records commands, not whether the key slot is filled.

/**
 * Is `action` a candidate for the unbound line - does it have no key slot of its own at all?
 * `'alias'`, `'toggle'` and `'press-release'` entries emit only their alias line(s) and have no
 * key slot, so a `//bind` beside them would double-emit the fact. A plain `'bind'`/`'message'`
 * entry gets the line whenever it has neither an owned bind line (`ownedBindActionIds`) nor an
 * anchor (`anchoredActionIds`), alias line or not; without it `inferKind` read a keyless bodied
 * entry as `kind: 'alias'`, permanently disabling its bind slot.
 */
function isUnboundEntry(
  action: ConfigAction,
  ownedBindActionIds: ReadonlySet<string>,
  anchoredActionIds: ReadonlySet<string>,
): boolean {
  if (action.kind !== 'bind' && action.kind !== 'message') return false
  if (ownedBindActionIds.has(action.id)) return false
  if (anchoredActionIds.has(action.id)) return false
  return true
}

/**
 * Every action `isUnboundEntry` holds for, in `profile.actions` order - the order `buildAnchorLines`
 * walks, so the caller can merge the two lists back into one file order.
 */
function collectUnboundActions(
  profile: ConfigProfile,
  bindEntries: BindEntries,
  anchors: readonly AnchorLine[],
): ConfigAction[] {
  const ownedBindActionIds = new Set(bindEntries.owned.map((entry) => entry.owner!.action.id))
  const anchoredActionIds = new Set(anchors.map((anchor) => anchor.action.id))
  return (profile.actions ?? []).filter((action) =>
    isUnboundEntry(action, ownedBindActionIds, anchoredActionIds),
  )
}

/**
 * The command an unbound line's body carries - a real would-be bind command, never a bare marker (the
 * reverted "entry anchor" attempt, see `buildAnchorLines`): `""` for an entry with no commands (most
 * of `STANDARD_TEMPLATE`'s seeded rows), else `bindValueFor(action)`, the value the mirror would write
 * on a key - the function `buildBindOwnerIndex` uses - so a row later bound through the UI restores to
 * the value a fresh bind would produce.
 */
function unboundCommand(action: ConfigAction): string {
  return action.commands.length === 0 ? '' : bindValueFor(action)
}

/**
 * One unbound line: `//bind "<cmd>"   // <name> [q2l â€¦]`, the commented-out bind a keyless entry
 * otherwise never gets; the tag marks it launcher-owned. It carries `an` only where no alias line
 * spells the name as code (`withAliasLine`, as in `buildAnchorLines`): a second copy would drift
 * and break `render(parse(render(p))) === render(p)`. No `key`/`mod`: it has no key slot.
 */
function unboundLine(
  action: ConfigAction,
  profile: ConfigProfile,
  withAliasLine: ReadonlySet<string>,
): string {
  const code = `//bind "${unboundCommand(action)}"`
  const aliasName = withAliasLine.has(action.id) ? undefined : action.aliasName?.trim() || undefined
  const tag = entryTag(action, { aliasName })
  const prose = proseText(commentLabelFor(action, profile))
  return attachTaggedComment(code, prose, tag, COMMENT_LINE_BUDGET)
}

/** One item of an `Entries: <cat>` section: an anchor line or an unbound line. A discriminated union
 * (not two arrays) so the section builder sorts both back into one file order before rendering. */
type EntrySectionItem =
  | { kind: 'anchor'; action: ConfigAction; anchor: AnchorLine }
  | { kind: 'unbound'; action: ConfigAction }

/**
 * The anchor and unbound-line entries, merged back into `profile.actions` order. The two lists are
 * disjoint (`isUnboundEntry` excludes every anchored action), so a stable sort by action index
 * suffices, and an entry with several anchors keeps the slot order `buildAnchorLines` produced.
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

/** One `EntrySectionItem` rendered to its line. `withAliasLine` is `unboundLine`'s guard against a
 * redundant `an`. */
function entrySectionItemRow(
  item: EntrySectionItem,
  profile: ConfigProfile,
  withAliasLine: ReadonlySet<string>,
): string {
  return item.kind === 'anchor'
    ? anchorRow(item.anchor, profile)
    : unboundLine(item.action, profile, withAliasLine)
}

/**
 * The entry sections: one per category in the alias and bind sections' order, holding that category's
 * anchor lines and unbound lines as siblings in `profile.actions` order.
 *
 * Emitted after the bind sections and before the layer sections, so each line sits under its category
 * header (attribution is positional on the reading side) and outside every layer section
 * (`profile-restore.ts` treats a tagged line inside a layer section as the layer's).
 */
function buildAnchorSections(
  profile: ConfigProfile,
  anchors: readonly AnchorLine[],
  unboundActions: readonly ConfigAction[],
  withAliasLine: ReadonlySet<string>,
  style: SectionHeaderStyle,
): string[][] {
  const items = buildEntrySectionItems(profile, anchors, unboundActions)
  const ordinals = categoryOrdinals(profile)
  return groupByCategory(profile, items, (item) => item.action.categoryId).map((group) => {
    // Bucket order is kept, so rows stay in the merged file order. No `renderRows` alignment: an
    // entry-section row is a bare `//` comment, not a code+value pair.
    const lines = withSubcategoryBuckets(
      profile,
      group.categoryId,
      group.items,
      (item) => item.action.subcategoryId,
      (bucketItems) => bucketItems.map((item) => entrySectionItemRow(item, profile, withAliasLine)),
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
 * The file's header block: `=`-rule banner lines around the name, then a line with only the tag
 * `formatMetaTag({ v, id: profile.id })`, which carries ownership.
 *
 * The name goes through `bannerText` first (a CR/LF would split the line, a non-latin1 character
 * breaks the round trip, a literal `[q2l` forges a tag). The tag is right-aligned so `]` lands on
 * `BANNER_WIDTH`; a longer one falls back to left-aligned, never truncated (unparseable).
 * `HAND_EDIT_SENTENCE` stays exported only so older files are recognised; nothing writes it.
 */
function buildHeaderBlock(profile: ConfigProfile): string[] {
  const [topRule, nameLine, bottomRule] = banner([bannerText(profile.name).trimEnd()], {
    fill: '=',
  })
  const tag = formatMetaTag({ v: String(META_FORMAT_VERSION), id: profile.id })
  return [topRule!, nameLine!, bottomRule!, headerTagLine(tag)]
}

/** The header block's fourth line: `tag` alone, right-aligned so its closing `]` sits on column
 * `BANNER_WIDTH`. Falls back to a left-aligned `//  <tag>` when the tag is longer than
 * `BANNER_WIDTH - 3`, so a pathological id never produces negative padding. */
function headerTagLine(tag: string): string {
  if (tag.length > BANNER_WIDTH - 3) return `//  ${tag}`
  return `//${' '.repeat(BANNER_WIDTH - 2 - tag.length)}${tag}`
}

/**
 * The `unbindall` line: a per-profile setting, default on. `!== false`, not `=== true`:
 * `profile.writeUnbindall` is optional and a profile with no stored value (persisted before the
 * setting, or built in a test without `src/main/modules/config/persisted.ts`'s `.catch(true)`) must behave as `true`.
 *
 * A bare single line, not wrapped in `section()`: nothing to banner or comment. Omitted (an empty
 * block) when `false`, so `joinBlocks` adds no stray blank line.
 */
function buildUnbindallBlock(profile: ConfigProfile): string[] {
  return profile.writeUnbindall === false ? [] : ['unbindall']
}

/** One `set` line before alignment: the cvar name as written and its already-resolved value
 * (`buildCvarSections` decided stored value vs catalogue default; nothing downstream re-reads
 * `profile.cvars`). */
interface CvarLine {
  name: string
  value: string
}

/** `set <name> "<value>"` per entry, name-column aligned within this call only (the per-bucket scope
 * `renderRows` gives a bind/alias bucket), in the given order. The block every cvar bucket renders
 * through: a section's ungrouped run, a sub-section, or the reserved `Defaults`/`Other` buckets. */
function renderCvarRows(lines: readonly CvarLine[]): string[] {
  const rows = alignRows(
    lines.map((line) => [line.name, `"${line.value}"`]),
    [CVAR_NAME_COLUMN],
  )
  return rows.map(([name, value]) => `set ${name}${value}`)
}

/**
 * One reserved cvar bucket's section (`Defaults` or `Other`), omitted when `lines` is empty
 * (`section()`'s job, unlike a profile-owned cvar section, which `bannerSection` always keeps). `tag`
 * is `cvarSectionTag(CVAR_DEFAULTS_SECTION_ID)` for `Defaults`, `''` for `Other` (untagged like
 * `UNOWNED_BINDS_LABEL`: no id for "the absence of a section").
 */
function buildReservedCvarSection(
  label: string,
  lines: CvarLine[],
  style: SectionHeaderStyle,
  tag: string,
): string[] {
  return titledSection(label, tag, renderCvarRows(lines), style)
}

/** Banner label for the reserved `Defaults` bucket - plain ASCII, never via `cvarSectionLabelFor`
 * since this id is never a real section the profile owns. */
const CVAR_DEFAULTS_SECTION_LABEL = 'Defaults'

/**
 * Resolves the cvars a section/sub-section lists into `CvarLine`s, given `claimed` (catalogue id ->
 * stored line) and `unknownAll`. The claim sets thread across the whole call, so a name listed
 * twice is claimed by its first placement. A name resolving to nothing produces no line.
 */
function makeCvarResolver(
  claimed: ReadonlyMap<string, CvarLine>,
  unknownAll: readonly CvarLine[],
  placedCatalogIds: Set<string>,
  placedUnknownNames: Set<string>,
): (name: string) => CvarLine | undefined {
  return (name: string): CvarLine | undefined => {
    const def = findCvar(name)
    if (def) {
      const id = def.name.toLowerCase()
      if (placedCatalogIds.has(id)) return undefined
      placedCatalogIds.add(id)
      const stored = claimed.get(id)
      return { name: stored?.name ?? def.name, value: writeValueFor(def, stored?.value) }
    }
    if (placedUnknownNames.has(name)) return undefined
    const found = unknownAll.find((line) => line.name === name)
    if (!found) return undefined
    placedUnknownNames.add(name)
    return found
  }
}

/**
 * Renders one `ConfigCvarSection`: its own `cvars` (the ungrouped run) first, then one
 * `bannerSection` per sub-section, mirroring `withSubcategoryBuckets` one level down. The section's
 * own banner also goes through `bannerSection`: an empty, freshly created section still writes its
 * banner, so it survives the next reload instead of looking deleted.
 */
function buildCvarSectionBlock(
  section: ConfigCvarSection,
  profile: ConfigProfile,
  resolveNamed: (name: string) => CvarLine | undefined,
  style: SectionHeaderStyle,
): string[] {
  const ownLines = renderCvarRows(section.cvars.map(resolveNamed).filter(isCvarLine))
  const lines = [...ownLines]
  for (const sub of section.subsections ?? []) {
    const subLines = renderCvarRows(sub.cvars.map(resolveNamed).filter(isCvarLine))
    lines.push(
      ...bannerSection(
        cvarSubsectionTitle(section.id, sub.id, profile),
        cvarSubsectionTag(sub.id),
        subLines,
        style,
      ),
    )
  }
  return bannerSection(
    cvarSectionTitle(section.id, profile),
    cvarSectionTag(section.id),
    lines,
    style,
  )
}

function isCvarLine(line: CvarLine | undefined): line is CvarLine {
  return line !== undefined
}

/**
 * The cvar sections: `profile.cvarSections` in order, each in its own `bannerSection` (written
 * even when empty), then two reserved buckets that never come from the profile's list:
 *
 * - **`Defaults`** (tag `cvs=defaults`): every catalogue cvar no real section placed, at its stored
 *   value or `def.default`, only when `profile.writeCatalogDefaults !== false` - with the toggle
 *   off it produces no line, not even under `Other`: what Settings shows is what the file gets.
 * - **`Other`** (untagged): every non-catalogue cvar no real section placed, sorted; never gated.
 */
function buildCvarSections(profile: ConfigProfile, style: SectionHeaderStyle): string[][] {
  /** Catalogue identity (`def.name` lowercased, the key `findCvar` matches on) -> the stored line
   * that claimed it: exactly one line per catalogue cvar, and the spelling rule below picks which. */
  const claimed = new Map<string, CvarLine>()
  const unknownAll: CvarLine[] = []

  for (const [name, value] of Object.entries(profile.cvars)) {
    const def = findCvar(name)
    if (!def) {
      unknownAll.push({ name, value })
      continue
    }
    const id = def.name.toLowerCase()
    const held = claimed.get(id)
    if (held === undefined || held.name < name) claimed.set(id, { name, value })
  }

  const placedCatalogIds = new Set<string>()
  const placedUnknownNames = new Set<string>()
  const resolveNamed = makeCvarResolver(claimed, unknownAll, placedCatalogIds, placedUnknownNames)

  const blocks: string[][] = (profile.cvarSections ?? []).map((section) =>
    buildCvarSectionBlock(section, profile, resolveNamed, style),
  )

  if (profile.writeCatalogDefaults !== false) {
    const defaultLines = ALL_CVARS.filter(
      (def) => !placedCatalogIds.has(def.name.toLowerCase()),
    ).map((def) => {
      const stored = claimed.get(def.name.toLowerCase())
      return { name: stored?.name ?? def.name, value: writeValueFor(def, stored?.value) }
    })
    blocks.push(
      buildReservedCvarSection(
        CVAR_DEFAULTS_SECTION_LABEL,
        defaultLines,
        style,
        cvarSectionTag(CVAR_DEFAULTS_SECTION_ID),
      ),
    )
  }

  const unplacedUnknown = unknownAll.filter((line) => !placedUnknownNames.has(line.name))
  blocks.push(
    buildReservedCvarSection(
      OTHER_CVAR_GROUP_LABEL,
      [...unplacedUnknown].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      style,
      '',
    ),
  )

  return blocks.filter((block) => block.length > 0)
}

/** Joins non-empty section blocks with exactly one blank line between consecutive blocks, never
 * before the first. An omitted (empty) block contributes nothing, so adjacent omissions leave no
 * double gap. */
function joinBlocks(blocks: string[][]): string[] {
  const nonEmpty = blocks.filter((block) => block.length > 0)
  return nonEmpty.flatMap((block, index) => (index === 0 ? block : ['', ...block]))
}

export const PROFILE_FILE_PREFIX = 'q2l-profile-'
export const PROFILE_FILE_SUFFIX = '.cfg'

/** File name of a profile's own cfg file inside baseq2, e.g. "q2l-profile-<id>.cfg". */
export function profileFileName(profileId: string): string {
  return `${PROFILE_FILE_PREFIX}${profileId}${PROFILE_FILE_SUFFIX}`
}

/**
 * Full sentinel comment line for `profileId`. A plain ASCII hyphen, not an em dash: the line must
 * survive the writer's latin1 round trip byte-for-byte, and `Buffer.from(str, 'latin1')` truncates
 * U+2014 to a control character. Every loader emits this line, so a non-ASCII separator would break
 * every write.
 */
export function sentinelLine(profileId: string): string {
  return `${OWNERSHIP_MARKER} ${profileId} - hand-edited changes are read back`
}

/**
 * Renders a profile's own cvars+binds(+layers) file (`baseq2/q2l-profile-<id>.cfg`). Deterministic:
 * every ordering derives from stored data, never insertion order or a clock. Ends with one `\n`.
 *
 * Blocks, each omitted when empty, separated by one blank line (`joinBlocks`): the header
 * (`buildHeaderBlock`, whose `[q2l v=.. id=..]` is the only ownership marker); a bare `unbindall`
 * unless `profile.writeUnbindall` is `false`; the cvar sections; the alias sections, one per
 * category; the bind sections; "other binds", sorted by key; per category the `Entries:` anchor and
 * unbound lines (`buildAnchorLines`, `collectUnboundActions`); and last one
 * section per layer, so a layer's trigger wins the key it shares with a base bind.
 *
 * A section with nothing in it emits no banner (`section()`). Blocks 4-7 carry the `[q2l ...]` tail.
 * Pinned by tests: the profile id appears once, inside the header tag; under
 * line-budget pressure the prose gives way and the tag survives; every line an entry owns carries a
 * tag, down to a bare `[q2l]` (`entryTag`); cvar and unowned-bind sections carry none.
 *
 * Actions add no bind line of their own: `setActions` mirrors keyed actions into `profile.binds`
 * (`bindValueFor`), read backwards to find an entry's owner
 * (`buildBindOwnerIndex`); an unresolved bind is written in "other binds". An empty-command bind
 * is not written (render-time only). The trailing comments are real bytes and can newly cross the
 * exec-buffer warning; intended, as `validation-scope.ts` renders the real file.
 *
 * A continuous catalogue row (`+forward`) is bound to its own command (the engine sends `-command`
 * on key-up only for a `+` bind string), so its alias is called by nobody: actions are filtered
 * through `actionsWithAliasLine`, per action (a chunk-split action keeps its `_p<n>` family or
 * loses it).
 */
export function renderProfileFile(profile: ConfigProfile): string {
  const layers = profile.layers ?? []
  const layerResults = layers.map((layer) => generateLayerAliases(layer, profile.binds))

  // `?? 'dashes'` mirrors `writeUnbindall`'s `!== false` read: a profile with no stored value
  // (persisted before the setting, or built without `src/main/modules/config/persisted.ts`'s `.catch('dashes')`) must
  // render exactly as `'dashes'`, byte-identical to before the setting existed.
  const sectionHeaderStyle: SectionHeaderStyle = profile.sectionHeaderStyle ?? 'dashes'

  // Only the actions whose alias line something can reach. Filtered here, not
  // inside `renderActionAlias`, which is also the action editor's preview renderer and must show an
  // action's alias whether or not the file carries it.
  const aliasActions = actionsWithAliasLine(profile.actions ?? [], {
    actions: profile.actions ?? [],
    binds: profile.binds,
    layers,
  })

  const bindEntries = collectBindEntries(profile, layerResults)

  // Every key slot the config lines cannot record (a modified slot has no `bind` line and no
  // `key`/`mod` elsewhere) gets a comment-only anchor line to carry its tag; see `buildAnchorLines`,
  // including why an entry with no line at all deliberately gets nothing.
  const aliasLineActions = aliasActions.filter(
    (action) => renderActionAlias(action).aliases.length > 0,
  )
  const anchors = buildAnchorLines(profile, aliasLineActions)
  const withAliasLine = new Set(aliasLineActions.map((action) => action.id))

  // Every plain bind/message entry the lines above leave with no key trace (`isUnboundEntry`).
  const unboundActions = collectUnboundActions(profile, bindEntries, anchors)

  const lines: string[] = [
    ...joinBlocks([
      buildHeaderBlock(profile),
      buildUnbindallBlock(profile),
      ...buildCvarSections(profile, sectionHeaderStyle),
      ...buildAliasSections(profile, aliasActions, sectionHeaderStyle),
      // The bind sections come before the layer sections, so a layer's trigger bind is the last
      // `bind` line in the file (`buildLayerSections`).
      ...buildBindSections(profile, bindEntries, sectionHeaderStyle),
      ...buildAnchorSections(profile, anchors, unboundActions, withAliasLine, sectionHeaderStyle),
      ...buildLayerSections(profile, layerResults, sectionHeaderStyle),
    ]),
  ]

  return `${lines.join('\n')}\n`
}

/**
 * Renders the loader written to every `autoexec.cfg`: a sentinel line for `profile.id` plus
 * `exec <profileFileName>`. Separate from `renderProfileFile` because it belongs to an
 * installation's default profile. `fileName` is resolved by the caller across the whole list
 * (`resolveProfileFileNames`), which alone can detect a collision. `switchBind` is appended after
 * the `exec` line, since `autoexec.cfg` is the one file no profile's own `exec` can clobber.
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
