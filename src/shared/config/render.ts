import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { BUILT_IN_ACTION_CATEGORIES } from '@shared/modules/config'
import type { AltLayer, GeneratedAlias, GenerateLayerResult } from '@shared/config/alt-layers'
import { generateLayerAliases } from '@shared/config/alt-layers'
import { renderActionAlias } from '@shared/config/alias-render'
import { actionsWithAliasLine } from '@shared/config/alias-references'
import { bindValueFor } from '@shared/config/action-mirror'
import { categoryLabelFor, commentLabelFor } from '@shared/config/comment-labels'
import { normalizeBindKey } from '@shared/config/key-names'
import { ALL_CVARS, findCvar } from '@shared/config/cvar-catalog'
import type { CvarDef } from '@shared/config/cvar-facts'
import { CVAR_GROUP_LABELS, CVAR_GROUP_ORDER } from '@shared/config/cvar-facts'
import type { ColumnSpec, SectionHeaderStyle } from '@shared/config/cfg-layout'
import {
  alignRows,
  attachTaggedComment,
  banner,
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
 */
const COMMENT_LINE_BUDGET = STRICTEST_LINE_BUDGET - 1

// ---------------------------------------------------------------------------
// Story 042 D2: the `[q2l ...]` metadata tags this file attaches.
//
// `profile-metadata.ts` owns the grammar (how a tag is spelled and read back);
// `cfg-layout.ts` owns the budget rule (prose gives way, the tag survives).
// What lives here is the only part that needs profile knowledge: *which* fields
// each kind of line gets, and how an entry ref is derived from an action id.
// ---------------------------------------------------------------------------

/** FNV-1a's 32-bit offset basis and prime. */
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * FNV-1a over `text`, 32 bits, `Math.imul` for the wrap-around multiply (a plain `*` overflows
 * into a float and stops being FNV after the first few characters).
 *
 * Each UTF-16 code unit is folded in as two bytes, low then high, rather than as one masked byte:
 * an `action.id` is a UUID today and therefore pure ASCII, but masking would map two different
 * non-ASCII ids onto the same hash for no reason at all, and a hash collision here costs a longer
 * ref at best and a mis-paired entry at worst.
 */
function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    hash = Math.imul(hash ^ (unit & 0xff), FNV_PRIME)
    hash = Math.imul(hash ^ ((unit >>> 8) & 0xff), FNV_PRIME)
  }
  return hash >>> 0
}

/** One round of the ref: exactly 8 lowercase hex digits, zero-padded so the width never varies. */
function refRound(text: string): string {
  return fnv1a32(text).toString(16).padStart(8, '0')
}

/**
 * `rounds * 8` hex digits for `actionId`: the plain FNV-1a of the id, then (only when a collision
 * forces it) 8 more digits per extra round, each round hashing `<round>:<id length>:<id>`.
 *
 * Written as a *chained* hash rather than a wider one because FNV-1a-32 has only 8 hex digits to
 * give: "extend the prefix" needs digits that do not exist in a 32-bit hash, and a chain produces
 * them deterministically from the id alone - no counter, no clock, no dependence on what else is
 * in the profile. The extra round's input is length-prefixed rather than merely separated, so no
 * pair of ids can construct the same round input out of two different `(id, round)` pairs.
 */
function entryRefHex(actionId: string, rounds: number): string {
  let out = refRound(actionId)
  for (let round = 1; round < rounds; round++) {
    out += refRound(`${round}:${actionId.length}:${actionId}`)
  }
  return out
}

/**
 * The `e` ref for `actionId` as it renders when nothing collides with it: 8 hex digits of FNV-1a
 * over the id.
 *
 * Exported for `render.test.ts`, which pins rendered lines byte-for-byte and would otherwise have
 * to carry a second copy of the hash - the same reason it already asserts against
 * `alias-render.ts`'s own `aliasNameFor`. The hash *function* is pinned separately by a test that
 * spells one known id's ref out as a literal, so this export cannot make the byte-exact
 * assertions tautological.
 */
export function entryRefFor(actionId: string): string {
  return entryRefHex(actionId, 1)
}

/**
 * How far a colliding ref may grow before the last-resort suffix takes over. Four rounds is 32 hex
 * digits, i.e. four independent 32-bit collisions on the same id pair; the suffix below exists
 * because an unbounded loop on adversarial input is a hang, not because this cap can be reached.
 */
const MAX_ENTRY_REF_ROUNDS = 4

/**
 * `action.id` -> its `e` ref, for every action in the profile.
 *
 * `e` is a hash of the id and not an index on purpose (the story's own decision): it stays the same
 * when an entry is inserted above it, so story 043 can show a whole-file diff that is not a wall of
 * renumbered refs. The price is that two ids can hash alike, and two entries sharing an `e` inside
 * one file would be *merged* on import - so a collision has to be broken, and broken the same way
 * on every render of the same profile:
 *
 * - Ids are walked in sorted order, not `profile.actions` order. Sorting is what keeps the
 *   tie-break local: which member of a colliding pair grows depends only on that pair, so
 *   inserting an unrelated entry cannot move the growth to the other one and rewrite two lines
 *   that did not change.
 * - The first id to claim a ref keeps its 8 digits; a later id whose ref is already taken grows by
 *   8 more digits at a time (`entryRefHex`) until it is free.
 * - Past `MAX_ENTRY_REF_ROUNDS` (unreachable: four consecutive 32-bit collisions) the ref takes a
 *   `-<n>` suffix, `n` being how many refs were already assigned - still a pure function of the
 *   sorted id list, still distinct, and still parseable (`e` is an opaque token to the reader).
 *
 * Two actions that genuinely share an `id` (only reachable through a hand-edited store) share one
 * ref, which is the honest answer: they are one entry as far as every other id-keyed lookup in
 * this codebase is concerned.
 */
function buildEntryRefs(actions: readonly ConfigAction[]): Map<string, string> {
  const refs = new Map<string, string>()
  const used = new Set<string>()

  for (const id of [...new Set(actions.map((action) => action.id))].sort()) {
    let ref = entryRefHex(id, 1)
    for (let rounds = 2; used.has(ref) && rounds <= MAX_ENTRY_REF_ROUNDS; rounds++) {
      ref = entryRefHex(id, rounds)
    }
    if (used.has(ref)) ref = `${ref}-${used.size}`
    used.add(ref)
    refs.set(id, ref)
  }

  return refs
}

/** Which of an entry's two key slots a bind line renders. `1` is `key`, `2` is `secondaryKey` -
 * the same two slots `action-mirror.ts` mirrors into `profile.binds`, in the same order. */
type KeySlot = 1 | 2

/**
 * The fields only an *anchor* line (`buildAnchorLines`) ever contributes - a comment-only line that
 * stands in for something the file's config text has no place for.
 *
 * `key` and `aliasName` are never passed for a real bind or alias line: those lines already carry
 * both as code (`bind <key> …`, `alias <name> …`), and a second, tag-side copy could only ever drift
 * from the line the engine actually reads.
 */
interface AnchorTagFields {
  /** The slot's key, as tag content - only where no `bind` line spells it out. */
  key?: string
  /** The entry's own `aliasName` - only where no alias line in the file carries it. */
  aliasName?: string
}

/**
 * The `[q2l ...]` tag for one line that belongs to an entry: `e` and `k` always, `cid` when the
 * entry is catalogue-backed, and `slot`/`mod` only for a line that renders one specific key slot
 * (a bind or layer-override line - an alias line is the entry itself, not one of its keys).
 *
 * `mod` is read off the slot the line renders rather than off the action as a whole, because an
 * entry's two slots can carry two different modifiers. It is unreachable on a *base* bind line as
 * this file stands - `buildBindOwnerIndex` never claims a modified slot, since story 016 mirrors
 * those into a modifier layer instead of into `profile.binds` - and is emitted from the slot
 * anyway, so the field is right the day a line does render one.
 *
 * `anchor` carries the two fields only an anchor line has anywhere to put (see `AnchorTagFields`).
 */
function entryTag(
  action: ConfigAction,
  ref: string,
  slot?: KeySlot,
  anchor: AnchorTagFields = {},
): string {
  const modifier = slot === 2 ? action.secondaryKeyModifier : action.keyModifier
  return formatMetaTag({
    e: ref,
    k: action.kind,
    cid: action.catalogId || undefined,
    an: anchor.aliasName,
    slot: slot === undefined ? undefined : String(slot),
    mod: slot === undefined || !modifier ? undefined : modifier,
    key: anchor.key,
  })
}

/** The `[q2l cat=<id>]` tag for a category section header, or `''` for the trailing "other"
 * bucket - that bucket is the *absence* of a category (its members' `categoryId` matches none the
 * profile has), so there is no id to record and a tag would invent one. */
function categoryTag(categoryId: string | null): string {
  return categoryId === null ? '' : formatMetaTag({ cat: categoryId })
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
 * Every category id a section can be built for, in the order the story fixes: the built-in
 * categories first (movement, weapons, drops - the Controls tab's own order), then the profile's
 * own categories in their stored array order. Deduplicated, so a custom category that reuses a
 * built-in id cannot produce two sections with the same banner.
 */
function orderedCategoryIds(profile: ConfigProfile): string[] {
  const ids: string[] = []
  for (const category of BUILT_IN_ACTION_CATEGORIES) if (!ids.includes(category.id)) ids.push(category.id)
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
function buildAliasSections(
  profile: ConfigProfile,
  actions: ConfigAction[],
  refs: Map<string, string>,
  style: SectionHeaderStyle,
): string[][] {
  return groupByCategory(profile, actions, (action) => action.categoryId).map((group) => {
    const rows: CodeRow[] = []
    for (const action of group.items) {
      const comment = proseText(commentLabelFor(action, profile))
      // No `slot`: an alias line is the entry itself, not one of its two key slots. A chunk-split
      // action's whole `_p<n>` family shares the one tag, exactly as it shares the one label.
      const tag = entryTag(action, refs.get(action.id) ?? entryRefFor(action.id))
      for (const alias of renderActionAlias(action).aliases) {
        rows.push({ ...splitAliasLine(alias), comment, tag })
      }
    }
    return titledSection(
      `Aliases: ${categoryTitle(group.categoryId, profile)}`,
      categoryTag(group.categoryId),
      renderRows(rows),
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
  /** Which of the owner's two key slots this bind sits in - what story 042's `slot` field records,
   * and what pairs the two bind lines of one entry back together on import. */
  slot: KeySlot
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
    // The two mirror slots, read exactly as `action-mirror.ts#mirrorSlots` (private there) and
    // `alias-references.ts#ownMirrorBindKeys` read them - a modified slot is not a base bind.
    const slots = [
      { number: 1 as KeySlot, key: action.key, modified: Boolean(action.keyModifier) },
      { number: 2 as KeySlot, key: action.secondaryKey, modified: Boolean(action.secondaryKeyModifier) },
    ]
    for (const slot of slots) {
      const key = slot.key?.trim()
      if (!key || slot.modified) continue
      owners.set(ownerIndexKey(normalizeBindKey(key), value), {
        action,
        index,
        slot: slot.number,
      })
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
  refs: Map<string, string>,
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
      tag: owner
        ? entryTag(owner.action, refs.get(owner.action.id) ?? entryRefFor(owner.action.id), owner.slot)
        : '',
    }
  }

  const categorySections = groupByCategory(
    profile,
    owned,
    (entry) => entry.owner!.action.categoryId,
  ).map((group) =>
    titledSection(
      `Binds: ${categoryTitle(group.categoryId, profile)}`,
      categoryTag(group.categoryId),
      renderRows(group.items.map(bindRow)),
      style,
    ),
  )

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
  slot: KeySlot
  /** Normalized key of `slot` - see the normalisation note in `buildAnchorLines`. */
  key: string
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
 * per-override line for a `[q2l …]` tag to ride on either. Nothing else in the file can say *which*
 * of the entry's two slots that key is, or which modifier it carries. So every modified slot gets
 * its own anchor - including for an entry that does keep an alias line, because that line is the
 * entry, not one of its keys, and carries no `slot`/`mod` at all. Without this, an entry whose
 * *both* slots are modified left the two keys to `profile-restore.ts`' stable-but-guessed
 * (modifier, key) fallback, which silently swapped primary and secondary for half of all such
 * entries.
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

    const slots = [
      { number: 1 as KeySlot, key: action.key, modifier: action.keyModifier },
      { number: 2 as KeySlot, key: action.secondaryKey, modifier: action.secondaryKeyModifier },
    ]
    for (const slot of slots) {
      const key = slot.key?.trim()
      if (!key || !slot.modifier) continue
      anchors.push({
        action,
        slot: slot.number,
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
function anchorRow(anchor: AnchorLine, ref: string, profile: ConfigProfile): string {
  const tag = entryTag(anchor.action, ref, anchor.slot, {
    key: anchor.key,
    aliasName: anchor.aliasName,
  })
  const prose = proseText(commentLabelFor(anchor.action, profile))
  return `// ${fitProseAndTag(prose, tag, COMMENT_LINE_BUDGET - 3)}`
}

/**
 * The anchor sections: one per category, in the same order the alias and bind sections use, holding
 * every anchor line `buildAnchorLines` found in that category.
 *
 * Emitted after the bind sections and before the layer sections, so the line sits under its own
 * category header (attribution is positional on the reading side) and outside every layer section
 * (`profile-restore.ts` treats a tagged line inside a layer section as the layer's, not an entry's).
 */
function buildAnchorSections(
  profile: ConfigProfile,
  anchors: readonly AnchorLine[],
  refs: Map<string, string>,
  style: SectionHeaderStyle,
): string[][] {
  return groupByCategory(profile, anchors, (anchor) => anchor.action.categoryId).map((group) =>
    titledSection(
      `${ANCHOR_TITLE_PREFIX}${categoryTitle(group.categoryId, profile)}`,
      categoryTag(group.categoryId),
      group.items.map((anchor) =>
        anchorRow(anchor, refs.get(anchor.action.id) ?? entryRefFor(anchor.action.id), profile),
      ),
      style,
    ),
  )
}

/**
 * Builds the file's header block: a `=`-ruled banner carrying the profile name and the hand-edit
 * sentence (AC1). The profile name is passed through `sanitizeComment` first - a user-typed name
 * could otherwise carry a CR/LF (which would split this single banner line into several,
 * corrupting the file's structure) or a character outside latin1 (which would break the writer's
 * latin1 round-trip) - the same reason trailing comments get sanitized, just applied one line
 * earlier in the file.
 *
 * Story 042 D2 hangs the format's version marker (`[q2l v=<META_FORMAT_VERSION>]`) off the profile
 * name line. It rides *here* and not on the sentinel line above deliberately: `writer.ts`,
 * `cleanup.ts` and `canonical.ts` all match on that first line - one of them on its exact bytes -
 * so `sentinelLine()` stays byte-identical and the version lives on the first line that is free to
 * change. One marker per file; no per-line tag repeats `v`.
 */
function buildHeaderBlock(profile: ConfigProfile): string[] {
  const version = formatMetaTag({ v: String(META_FORMAT_VERSION) })
  return banner(
    [fitProseAndTag(bannerText(profile.name), version, BANNER_CONTENT_BUDGET), HAND_EDIT_SENTENCE],
    { fill: '=' },
  )
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

/**
 * Builds one cvar group's section: `set <name> "<value>"` per cvar in `names`, name-column aligned
 * within this section only, under a `// --- <label> ---...` banner - omitted entirely when `names`
 * is empty (`section()`'s own job). `names` is already in the order the group should render.
 */
function buildCvarSection(
  label: string,
  names: string[],
  cvars: Record<string, string>,
  style: SectionHeaderStyle,
): string[] {
  const rows = alignRows(
    names.map((name) => [name, `"${cvars[name]}"`]),
    [CVAR_NAME_COLUMN],
  )
  // No tag: a cvar group is not one of the profile's categories and a `set` line is not an entry,
  // so there is no `cat` id to record and nothing for a per-line tag to say.
  return titledSection(label, '', rows.map(([name, value]) => `set ${name}${value}`), style)
}

/**
 * Groups `cvars` into cvar-group sections, in `CVAR_GROUP_ORDER`, plus a trailing "other" section
 * for names no `CvarDef` recognizes - nothing is dropped (AC: "cvars ... the launcher has no
 * section for still get written").
 *
 * Within a recognized group, cvars render in `ALL_CVARS`' own index order (so a section reads like
 * the Settings tab); within "other", alphabetically - neither ordering depends on `Object.keys`'
 * insertion order, so the result stays deterministic. Cvar names are matched against the catalog
 * case-insensitively (`findCvar`'s own rule), and the catalog index lookup follows the same rule so
 * a differently-cased stored key still sorts correctly against its catalog entry - with the stored
 * name itself as the tie-break, since two such spellings share one catalog index.
 *
 * Returns one block (a banner plus its lines) per non-empty group, in order - never includes an
 * empty group's banner (delegated to `section()`).
 */
function buildCvarSections(cvars: Record<string, string>, style: SectionHeaderStyle): string[][] {
  const names = Object.keys(cvars)
  if (names.length === 0) return []

  const catalogIndexByName = new Map(ALL_CVARS.map((def, index) => [def.name.toLowerCase(), index]))
  const known: { name: string; group: CvarDef['group']; index: number }[] = []
  const unknown: string[] = []

  for (const name of names) {
    const def = findCvar(name)
    if (def) {
      known.push({ name, group: def.group, index: catalogIndexByName.get(def.name.toLowerCase())! })
    } else {
      unknown.push(name)
    }
  }

  const blocks: string[][] = []
  for (const group of CVAR_GROUP_ORDER) {
    const groupNames = known
      .filter((entry) => entry.group === group)
      // Name as the tie-break, not just the catalog index: `findCvar` matches case-insensitively,
      // so two differently-cased spellings of one cvar (`sensitivity` and `Sensitivity`, both
      // reachable via an import that keeps a file's own casing) resolve to the *same* index. With
      // the index alone the comparator returns 0 for that pair and the stable sort falls back to
      // `Object.keys` insertion order - the one insertion-order dependency AC5 rules out.
      .sort((a, b) => a.index - b.index || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((entry) => entry.name)
    blocks.push(buildCvarSection(CVAR_GROUP_LABELS[group], groupNames, cvars, style))
  }
  blocks.push(buildCvarSection(OTHER_CVAR_GROUP_LABEL, [...unknown].sort(), cvars, style))

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
 * Layout (story 040; D2 built the first two blocks, D3 everything from the aliases on):
 *
 * 1. the unchanged `sentinelLine()`, still literally line 1 - every ownership check in
 *    `writer.ts`/`cleanup.ts`/`canonical.ts` matches on it;
 * 2. a `=`-ruled header banner (profile name plus the metadata format's `[q2l v=...]` version
 *    marker, then the hand-edit sentence);
 * 2b. (story 040 D4) a single bare `unbindall` line, when `profile.writeUnbindall` is not
 *    explicitly `false` - the per-profile setting defaults to on, so a profile with no stored
 *    value carries this line exactly as one with `writeUnbindall: true` does;
 * 3. one `// --- <label> ---` section per cvar group in `CVAR_GROUP_ORDER`, plus an "other"
 *    section for cvars no `CvarDef` recognizes, each section's `set` lines name-column aligned
 *    among themselves and ordered by `ALL_CVARS`' catalog index (alphabetically in "other");
 * 4. the action alias sections, one per category (built-in order, then `profile.categories` order,
 *    then "other"), entries in `profile.actions` order, every line carrying a trailing
 *    `// <display name>`;
 * 5. the bind sections, one per category in the same order as the alias sections, each bind
 *    ordered by its owning action's index and carrying that entry's display name as a comment;
 * 6. an "other binds" section, sorted by key, for every bind no action owns;
 * 6b. (story 042, review fix) one `Entries: <category>` section per category holding an *anchor*
 *    line - a comment-only, `[q2l …]`-tagged line - for every key slot no config line can record,
 *    i.e. every slot bound only through a modifier layer (`buildAnchorLines`);
 * 7. one section per layer in `profile.layers` order, holding that layer's generated aliases and
 *    the `bind <trigger> <command>` line that reaches them - last in the file on purpose, so a
 *    layer's trigger always wins the key it shares with a base bind (see `buildLayerSections`).
 *
 * A section with nothing in it emits no banner at all (`section()`), and blocks are separated by
 * exactly one blank line (`joinBlocks`). Nothing is dropped to make the layout tidy: a cvar, alias
 * or bind the launcher has no category for lands in an explicit "other" section instead.
 *
 * Story 042 D2 hangs a machine-readable `[q2l ...]` tail off the comments blocks 2 and 4-7 already
 * carried, so a rendered file records what the plain Quake II syntax has no place for: which entry
 * a line belongs to (`e`), its `kind` (`k`), its catalogue identity (`cid`), which of its two key
 * slots a bind line is (`slot`, `mod`), which category a section holds (`cat`) and which layer
 * (`layer`, `mode`, `trigger`). Three properties of that are load-bearing rather than cosmetic and
 * are each pinned by their own test: the tags never touch line 1 (`sentinelLine()` stays
 * byte-identical, because three ownership checks elsewhere match on it), `v` appears exactly once
 * in the whole file, and under line-budget pressure the *prose* gives way while the tag survives -
 * the inverse of story 040's rule, since the display name is decoration and the tag is state. The
 * cvar sections and the unowned-bind section carry no tags at all: a `set` line is not an entry,
 * and a bind no action owns has nothing to point a tag at.
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

  // Story 042: one ref table for the whole file, built over *every* action rather than only the
  // ones that keep an alias line - a bind's owner may well be an action `actionsWithAliasLine`
  // filtered out, and the alias section and the bind section have to agree on its `e`.
  const entryRefs = buildEntryRefs(profile.actions ?? [])

  const bindEntries = collectBindEntries(profile, layerResults)

  // Story 042 (review fix): every key slot the file's own config lines cannot record - a modified
  // slot has no `bind` line by construction, and no `slot`/`mod` anywhere else either.
  // `buildAnchorLines` gives each one a comment-only anchor line to carry its `[q2l …]` tag; see its
  // doc comment, including why an entry with no line at all deliberately gets nothing.
  const aliasLineActions = aliasActions.filter(
    (action) => renderActionAlias(action).aliases.length > 0,
  )
  const anchors = buildAnchorLines(profile, aliasLineActions)

  const lines: string[] = [
    sentinelLine(profile.id),
    ...joinBlocks([
      buildHeaderBlock(profile),
      buildUnbindallBlock(profile),
      ...buildCvarSections(profile.cvars, sectionHeaderStyle),
      ...buildAliasSections(profile, aliasActions, entryRefs, sectionHeaderStyle),
      // The bind sections come *before* the layer sections, so that a layer's trigger bind is the
      // last `bind` line in the file - see `buildLayerSections`' doc comment.
      ...buildBindSections(profile, entryRefs, bindEntries, sectionHeaderStyle),
      ...buildAnchorSections(profile, anchors, entryRefs, sectionHeaderStyle),
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
