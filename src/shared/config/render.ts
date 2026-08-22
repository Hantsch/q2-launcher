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
import type { ColumnSpec } from '@shared/config/cfg-layout'
import { alignRows, attachComment, banner, sanitizeComment, section } from '@shared/config/cfg-layout'
import { limitsFor } from '@shared/config/engine-limits'
import type { EngineKind } from '@shared/types/engine'
import type { SwitchBindChainInput } from './switch-bind'
import { renderSwitchBindChain } from './switch-bind'

/**
 * Plain ASCII sentence the header block carries once story 043's re-import lands (AC1) - phrased as
 * a general caution rather than naming that story, since it does not exist yet. Matches the tone
 * of the target sketch in the story's own Requirement section.
 */
const HAND_EDIT_SENTENCE = 'Q2 Launcher - do not hand-edit while the launcher has the profile open'

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

/** Banner label for actions whose `categoryId` matches neither a built-in category nor one of
 * `profile.categories` (a category the user removed while its entries stayed behind). Plain ASCII,
 * same rule as `OTHER_CVAR_GROUP_LABEL`, and deliberately not routed through `categoryLabelFor` -
 * "other" is not a category id, it is the absence of one. */
const OTHER_CATEGORY_LABEL = 'Other'

/** Banner title for the binds no action owns - hand-typed, imported, or left behind by a deleted
 * entry. Distinct from a `Binds: Other` section (an *owned* bind whose owner's category is gone):
 * these have no owning entry at all, and therefore no display name to comment with. */
const UNOWNED_BINDS_LABEL = 'Other binds'

/**
 * One rendered line, before alignment and before its comment is attached.
 *
 * Split into `head`/`body` rather than kept as one string so `alignRows` can give a section a
 * shared value column and a shared comment column; `comment` is already sanitized (the builders
 * below do that at the point they resolve a label) and is `''` for a row that has no display name
 * to show - an unowned bind, whose owner the file has no record of.
 */
interface CodeRow {
  head: string
  body: string
  comment: string
}

/**
 * Aligns `rows` among themselves and attaches each row's trailing comment.
 *
 * The value column is only aligned under two conditions. First, at least one row in the section
 * has to carry a comment: in a section where none do (the unowned binds), padding the value column
 * would leave every line with trailing spaces and nothing after them. Second, the column has to
 * fit `CODE_BODY_COLUMN.cap` - and when it does not, the column is dropped rather than left to
 * `alignRows`' own one-space fallback, because that fallback plus the two spaces `attachComment`
 * adds would put *three* spaces in front of every `//` in the section. Dropping the column instead
 * gives the plain, unaligned `code  // comment` form, which is what "no alignment" should look
 * like.
 *
 * A row whose comment is dropped anyway - `attachComment` returning `code` unchanged because not
 * even one character of comment fits - has its padding trimmed back off, so no line in the file
 * ever ends in whitespace it does not need.
 */
function renderRows(rows: CodeRow[]): string[] {
  const commented = rows.some((row) => row.comment.length > 0)
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
    const line = attachComment(code, rows[index]!.comment, COMMENT_LINE_BUDGET)
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

/** `sanitizeComment` plus the AC7 length clamp - every string this file hands to `banner()` or
 * `section()` goes through here, so no banner line can outgrow the engine's line budget. */
function bannerText(text: string): string {
  return sanitizeComment(text).slice(0, BANNER_TEXT_CAP)
}

/** One `section()`, with its title clamped to the banner budget (`bannerText`). The only way this
 * file opens a section, so an over-long title cannot slip past AC7 at a single call site. */
function titledSection(title: string, lines: string[]): string[] {
  return section(bannerText(title), lines)
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
function buildAliasSections(profile: ConfigProfile, actions: ConfigAction[]): string[][] {
  return groupByCategory(profile, actions, (action) => action.categoryId).map((group) => {
    const rows: CodeRow[] = []
    for (const action of group.items) {
      const comment = sanitizeComment(commentLabelFor(action, profile))
      for (const alias of renderActionAlias(action).aliases) {
        rows.push({ ...splitAliasLine(alias), comment })
      }
    }
    return titledSection(`Aliases: ${categoryTitle(group.categoryId, profile)}`, renderRows(rows))
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
): string[][] {
  return (profile.layers ?? []).map((layer, index) => {
    const { aliases, triggerBind } = layerResults[index]!
    if (aliases.length === 0) return []

    const comment = sanitizeComment(layer.name)
    const rows: CodeRow[] = aliases.map((alias) => ({ ...splitAliasLine(alias), comment }))
    if (triggerBind !== null) {
      rows.push({ head: `bind ${triggerBind.key}`, body: triggerBind.command, comment })
    }

    return titledSection(layerSectionTitle(layer), renderRows(rows))
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
    // The two mirror slots, read exactly as `action-mirror.ts#mirrorSlots` (private there) and
    // `alias-references.ts#ownMirrorBindKeys` read them - a modified slot is not a base bind.
    const slots = [
      { key: action.key, modified: Boolean(action.keyModifier) },
      { key: action.secondaryKey, modified: Boolean(action.secondaryKeyModifier) },
    ]
    for (const slot of slots) {
      const key = slot.key?.trim()
      if (!key || slot.modified) continue
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
 * The bind sections: one per category in the same order the alias sections use, holding the binds
 * whose owning action sits in that category, each with a trailing `// <label>`; then one "other
 * binds" section for every bind no action owns, sorted by key and carrying no comment - the file
 * has no display name for a line the user typed themselves.
 *
 * A bind whose command is empty is not written at all (the user's decision). That happens *here*,
 * on the way out: `profile.binds` is read, never mutated, so nothing downstream of the writer sees
 * a different profile than the one it was handed. `bind x ""` prints the current bind instead of
 * setting one, so it was never doing what the file made it look like it was doing.
 */
function buildBindSections(profile: ConfigProfile): string[][] {
  const owners = buildBindOwnerIndex(profile)
  const owned: BindEntry[] = []
  const unowned: BindEntry[] = []

  for (const [key, command] of Object.entries(profile.binds)) {
    const value = command.trim()
    if (value.length === 0) continue
    const normalizedKey = normalizeBindKey(key)
    const owner = owners.get(ownerIndexKey(normalizedKey, value))
    const entry: BindEntry = { key, normalizedKey, command, owner }
    if (owner) owned.push(entry)
    else unowned.push(entry)
  }

  owned.sort(compareOwnedBinds)
  unowned.sort(compareByKey)

  const bindRow = (entry: BindEntry): CodeRow => ({
    head: `bind ${entry.key}`,
    body: `"${entry.command}"`,
    comment: entry.owner ? sanitizeComment(commentLabelFor(entry.owner.action, profile)) : '',
  })

  const categorySections = groupByCategory(
    profile,
    owned,
    (entry) => entry.owner!.action.categoryId,
  ).map((group) =>
    titledSection(`Binds: ${categoryTitle(group.categoryId, profile)}`, renderRows(group.items.map(bindRow))),
  )

  return [...categorySections, titledSection(UNOWNED_BINDS_LABEL, renderRows(unowned.map(bindRow)))]
}

/**
 * Builds the file's header block: a `=`-ruled banner carrying the profile name and the hand-edit
 * sentence (AC1). The profile name is passed through `sanitizeComment` first - a user-typed name
 * could otherwise carry a CR/LF (which would split this single banner line into several,
 * corrupting the file's structure) or a character outside latin1 (which would break the writer's
 * latin1 round-trip) - the same reason trailing comments get sanitized, just applied one line
 * earlier in the file.
 */
function buildHeaderBlock(profile: ConfigProfile): string[] {
  return banner([bannerText(profile.name), HAND_EDIT_SENTENCE], { fill: '=' })
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
function buildCvarSection(label: string, names: string[], cvars: Record<string, string>): string[] {
  const rows = alignRows(
    names.map((name) => [name, `"${cvars[name]}"`]),
    [CVAR_NAME_COLUMN],
  )
  return titledSection(label, rows.map(([name, value]) => `set ${name}${value}`))
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
function buildCvarSections(cvars: Record<string, string>): string[][] {
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
    blocks.push(buildCvarSection(CVAR_GROUP_LABELS[group], groupNames, cvars))
  }
  blocks.push(buildCvarSection(OTHER_CVAR_GROUP_LABEL, [...unknown].sort(), cvars))

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
  return `${OWNERSHIP_MARKER} ${profileId} - generated, do not edit`
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
 * 2. a `=`-ruled header banner (profile name, hand-edit sentence);
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
 * 7. one section per layer in `profile.layers` order, holding that layer's generated aliases and
 *    the `bind <trigger> <command>` line that reaches them - last in the file on purpose, so a
 *    layer's trigger always wins the key it shares with a base bind (see `buildLayerSections`).
 *
 * A section with nothing in it emits no banner at all (`section()`), and blocks are separated by
 * exactly one blank line (`joinBlocks`). Nothing is dropped to make the layout tidy: a cvar, alias
 * or bind the launcher has no category for lands in an explicit "other" section instead.
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

  // Story 038/039: only the actions whose alias line something can actually reach. The list is
  // filtered here rather than inside `renderActionAlias`, which is also the action editor's own
  // preview renderer and must keep showing an action's alias whether or not the file will carry
  // it.
  const aliasActions = actionsWithAliasLine(profile.actions ?? [], {
    actions: profile.actions ?? [],
    binds: profile.binds,
    layers,
  })

  const lines: string[] = [
    sentinelLine(profile.id),
    ...joinBlocks([
      buildHeaderBlock(profile),
      buildUnbindallBlock(profile),
      ...buildCvarSections(profile.cvars),
      ...buildAliasSections(profile, aliasActions),
      // The bind sections come *before* the layer sections, so that a layer's trigger bind is the
      // last `bind` line in the file - see `buildLayerSections`' doc comment.
      ...buildBindSections(profile),
      ...buildLayerSections(profile, layerResults),
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
