import type { ConfigAction, ConfigCommand } from '@shared/modules/config'
import type { GeneratedAlias } from '@shared/config/alt-layers'
import {
  MAX_ALIAS_NAME,
  MAX_LINE_BYTES,
  sanitizeCommand,
  slugAliasName,
} from '@shared/config/alt-layers'

/**
 * Advanced-tab actions (story 008) -> alias lines.
 *
 * An action is a named list of commands the user assembled in the UI; the
 * engine has no such concept, so every action is written as one alias and the
 * action's key (if any) is bound to that alias name. That indirection is what
 * makes a long command chain possible at all: `Cbuf_Execute` reads one command
 * into `char line[1024]`, and a `bind <key> "a; b; c; ..."` line would hit that
 * limit far sooner than an alias body that can be split across helper aliases.
 *
 * Pure, like `render.ts` itself - no `fs`, no encoding choice. The caller
 * writes the resulting text as latin1; everything here is plain concatenation
 * of latin1-range characters, which round-trips through that encoding on its
 * own.
 *
 * The engine rules this file follows (quoting, the 1024-byte line, why a body
 * may never contain a `"`) are the ones documented at the top of
 * `src/shared/config/alt-layers.ts`, and the constants and helpers are reused
 * from there rather than restated, so an action alias and a layer alias can
 * never disagree about what fits on a line.
 *
 * What is deliberately *not* done here: a `;` inside a single user-typed
 * command is left alone. To the engine it is a command separator, which is
 * exactly what a user typing `wait; +attack` into the raw-command row means -
 * the body is re-parsed when the alias runs, so an inline `;` behaves the same
 * whether the user wrote one command containing it or two commands. (Layers
 * hoist such commands into helper aliases because there the body is a `bind`
 * value, where an inline `;` would end the `bind` early instead. That does not
 * apply to an alias body.)
 */

/** Every alias generated *for* an action under the legacy, machine-generated scheme starts with
 * this - the `setActions` handler's bind mirror identifies a *legacy-format* value by exactly this
 * prefix (never a live ownership test - see `profiles.ts`'s `setActions`/`setLayers` doc comments),
 * so it is one constant, here.
 *
 * A `kind: 'alias'` entry is not such an alias: it renders under its own name and is never
 * mirrored into a bind or a layer override at all (story 019), so it deliberately carries no
 * prefix - see `derivedAliasName`.
 *
 * Named `LEGACY_*` (story 039, D1) because the readable-name flip (D7) gives a plain action a name
 * that carries no such prefix at all - `derivedAliasName` below no longer produces this format, and
 * `ACTION_ALIAS_PREFIX` (the pre-D7 re-export of this constant) is gone: every call site now either
 * needs the current, key-scoped ownership rule (`action-mirror.ts#bindValueFor`) or this exact
 * legacy marker, never a live prefix test.
 */
export const LEGACY_ACTION_ALIAS_PREFIX = 'q2l_a_'

/** Usable alias-name characters: the 32nd is the terminator (see `MAX_ALIAS_NAME`). */
const USABLE_ALIAS_NAME = MAX_ALIAS_NAME - 1

/** Characters of the action's `id` appended to disambiguate same-named actions under the legacy
 * format (`legacyAliasNameFor`) - unchanged, private to that function; the readable-name path
 * (`derivedAliasName`) has no id suffix at all. */
const LEGACY_ID_SUFFIX_LENGTH = 4

/**
 * Reserve for the chunk suffix `_p<n>`, so a split action's parts still fit in
 * the name budget. Two digits is not a cap: a chunk holds at least one command,
 * so a three-digit part number needs an action with 100+ commands, and even
 * then the name is 25 + 5 = 30 characters and still fits the usable 31. The
 * reserve just keeps the common case's arithmetic honest.
 */
const PART_SUFFIX_RESERVE = '_p'.length + 2

/**
 * Length of the legacy format's name slug (decision 15), private to `legacyAliasNameFor` and
 * unchanged since before story 039: prefix (6) + slug (14) + `_` (1) + id (4) = 25, leaving 6 of
 * the usable 31 for `_p<n>`. `legacyAliasNameFor` must keep reproducing this exact format forever
 * (D6's migration depends on it), so this stays scoped to it rather than shared with the
 * readable-name budget below.
 */
const LEGACY_SLUG_LENGTH = Math.min(
  14,
  USABLE_ALIAS_NAME - LEGACY_ACTION_ALIAS_PREFIX.length - 1 - LEGACY_ID_SUFFIX_LENGTH - PART_SUFFIX_RESERVE,
)

/**
 * Content budget for a *derived* (readable) alias name (story 039, D7, "Plan": budget 26 chars):
 * `USABLE_ALIAS_NAME` (31) minus the `_p<n>` chunk-suffix reserve (4) minus 1 for a sign that may
 * not even apply. The sign is reserved unconditionally rather than only when the entry actually
 * carries one - the same "reserve the maximum, not the sum" bias `alt-layers.ts#generateLayerAliases`
 * already uses for its own affixes - so a name's length never depends on whether this particular
 * action happens to be signed. Deliberately a *different* number from `alias-names.ts`'s
 * `MAX_OWN_ALIAS_NAME_LENGTH` (27): that budget is for a user-typed `aliasName` and counts the sign
 * as part of the typed string itself, while this one is the slug *content* with the sign accounted
 * for separately, on top - both are the same `USABLE_ALIAS_NAME - PART_SUFFIX_RESERVE` (27) source
 * budget, this one further reduced by 1 for the sign slot.
 */
const DERIVED_ALIAS_NAME_BUDGET = USABLE_ALIAS_NAME - PART_SUFFIX_RESERVE - 1

/**
 * Bytes kept free at the end of every generated line. The same 16 bytes
 * `alt-layers.ts` reserves (its `LINE_HEADROOM`, which is private): the engine
 * appends its own separator, and a line landing exactly on the limit is the one
 * case nobody ever tests. Restated rather than imported because it is not
 * exported there - the value must stay in step with it, which is what
 * `alias-render.test.ts`'s "under 1024 bytes" assertions guard.
 */
const LINE_HEADROOM = 16

/**
 * Length of `text` in latin1 bytes. `String.length` counts UTF-16 code units,
 * which is exactly the latin1 byte count - same reasoning as
 * `alt-layers.ts#latin1ByteLength`, and the reason no `Buffer` is needed for
 * the length maths.
 */
function latin1ByteLength(text: string): number {
  return text.length
}

/**
 * Quoted as `alias <name> "<body>"` exactly when the body carries a `;`, so
 * `Cbuf_Execute` keeps the whole list as one command; a single-command body
 * needs no quotes. Identical rule to `alt-layers.ts#renderAliasLine`, and safe
 * to nest-free because `sanitizeCommand` has already dropped every `"`.
 */
function renderAliasLine(name: string, body: string): string {
  return body.includes(';') ? `alias ${name} "${body}"` : `alias ${name} ${body}`
}

function makeAlias(name: string, body: string): GeneratedAlias {
  return { name, body, line: renderAliasLine(name, body) }
}

/** True while the rendered line still has the engine's headroom left. */
function lineFits(name: string, body: string): boolean {
  return latin1ByteLength(renderAliasLine(name, body)) < MAX_LINE_BYTES - LINE_HEADROOM
}

/**
 * One `ConfigCommand` as the single command line it becomes in the alias body.
 * A message is just its channel plus its text (`say_team [ HELP ] $$loc_here`)
 * - to the engine there is no difference between a message and any other
 * command, which is why one type covers both entry kinds.
 *
 * Sanitized here even though the payload schema already rejects `"` and
 * non-latin1 text: every generator in this codebase re-sanitizes immediately
 * before embedding into an alias body rather than trusting an upstream
 * validator transitively, because a body that reaches disk with a quote in it
 * corrupts every following line of the file, not just its own.
 *
 * Exported as `commandLineFor` so the renderer's keyboard-overview expansion
 * (`resolveAliasChain`) and the action editor's byte-length preview render a
 * `ConfigCommand` exactly the way the writer does - one function, not a
 * second reimplementation that can drift from what lands on disk.
 */
export function commandLineFor(command: ConfigCommand): string {
  const raw = command.kind === 'message' ? `${command.channel} ${command.text}` : command.text
  return sanitizeCommand(raw)
}

/**
 * The legacy, machine-generated alias name for an action:
 * `q2l_a_<slug(name,14)>_<id[0:4]>` (decision 15), or - for a `kind: 'alias'` entry - the sign-aware
 * slug of its own name, with no prefix and no id suffix at all (decision from story 019, before
 * `aliasName` existed). Id-suffixed (for the non-alias case) so two actions the user named alike
 * never collide, and short enough that the `_p<n>` suffix of a split action still fits.
 *
 * The id suffix is defensively slugged rather than sliced: an id is normally a
 * uuid's first four hex characters and always alias-safe, but a caller with a
 * short or unusual id must not be able to produce a name the engine cannot
 * parse. Nothing survivable left -> `0000`, in the same spirit as
 * `slugAliasName`'s own fallback.
 *
 * Exported on its own because the `setActions` handler needs the identical name
 * for the `binds` mirror it writes (decision 17) - the bind and the alias are
 * generated from one function, never from two implementations of one format.
 *
 * This function's body must **not** change (story 039, D6's migration and D3's legacy-strip pass
 * depend on its exact output staying stable forever) - unlike `derivedAliasName` below, which D7
 * gives its own, human-readable derivation instead of delegating here.
 */
export function legacyAliasNameFor(action: ConfigAction): string {
  if (action.kind === 'alias') {
    const raw = action.name.trim()
    const sign = raw.startsWith('+') || raw.startsWith('-') ? raw.slice(0, 1) : ''
    const budget = USABLE_ALIAS_NAME - sign.length - PART_SUFFIX_RESERVE
    // No explicit fallback here: this function must keep reproducing the pre-039 output
    // byte-for-byte (see the doc comment above), which used `slugAliasName`'s own default
    // ('layer') for a name that slugs to nothing. `derivedAliasName` below is the one that gets
    // the new 'entry' fallback - passing it here too would make this function's output disagree
    // with what a pre-039 build already wrote to disk for such an action, breaking D6's migration
    // match on read.
    return `${sign}${slugAliasName(raw.slice(sign.length), budget)}`
  }

  const slug = slugAliasName(action.name, LEGACY_SLUG_LENGTH)
  const idSuffix =
    action.id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, LEGACY_ID_SUFFIX_LENGTH) || '0000'
  return `${LEGACY_ACTION_ALIAS_PREFIX}${slug}_${idSuffix}`
}

/**
 * The name an action derives to when it has no explicit `aliasName` (story 039, D7): a sign-aware
 * slug of the display name, with no prefix and no id suffix - `ssg_sg`, not
 * `q2l_a_ssg_sg_9a2f`. This is the name shown as the alias-name field's placeholder, too, and what
 * `aliasNameFor` falls back to.
 *
 * The sign is carried over - verbatim, not slugged away - only for a `kind: 'alias'` entry (the
 * story's Decisions): that entry *is* the alias definition, so `+slow` must stay `+slow`, the same
 * reasoning `legacyAliasNameFor`'s own alias-kind branch already applies and this function now
 * shares (the two used to be one private helper, `ownAliasName`, called from both places; collapsed
 * here since only the budget differs). A `kind: 'bind'`/`'message'` entry's name is a label, not the
 * engine's press/release idiom, so it is slugged sign-free even when it happens to start with
 * `+`/`-` - otherwise an adopted `+forward` catalogue row would derive the alias name `+forward` and
 * shadow the engine command it runs.
 *
 * No id suffix means two entries that derive to the same name collide into one engine alias. That is
 * deliberate - the name is the contract with whatever binding calls it - and it is reported as a
 * duplicate rather than silently disambiguated (D8's validation).
 */
export function derivedAliasName(action: ConfigAction): string {
  const raw = action.name.trim()
  const sign = action.kind === 'alias' && (raw.startsWith('+') || raw.startsWith('-')) ? raw.slice(0, 1) : ''
  return `${sign}${slugAliasName(raw.slice(sign.length), DERIVED_ALIAS_NAME_BUDGET, 'entry')}`
}

/**
 * The alias name an action actually renders under. `aliasName` (story 039), when set, wins
 * verbatim - sign and all, no slugging, no id suffix - because it is the name the user typed and
 * chose to be the contract with whatever binding calls it. An action without one falls back to
 * `derivedAliasName`, which today is byte-for-byte the pre-039 generated name, so nothing already
 * on disk or under test changes until a later deliverable flips the fallback itself.
 *
 * An empty-string `aliasName` (possible via the forgiving persisted schema) is treated the same as
 * "not set" - a blank name is not a name a binding could reference by.
 */
export function aliasNameFor(action: ConfigAction): string {
  return action.aliasName ? action.aliasName : derivedAliasName(action)
}

export interface RenderedActionAliases {
  /**
   * Definition order: the chunk aliases (`_p1`, `_p2`, ...) first, then the
   * alias that calls them. Quake 2 resolves an alias body when it runs, not
   * when it is defined, so this is for readability - the same order
   * `generateLayerAliases` emits.
   */
  aliases: GeneratedAlias[]
}

/**
 * Render one action's alias (or its split family).
 *
 * The commands are joined with `'; '` into one body. If that fits on a line
 * with the headroom above, it is a single alias and nothing else happens.
 *
 * Otherwise the commands are chunked, using the same incremental
 * fill-then-flush pass as `alt-layers.ts#buildHalf`: commands are appended to
 * the current chunk one at a time, and before appending, the chunk *as it would
 * then read*, rendered under the name it will be flushed as, is measured. If
 * that no longer fits, the chunk is flushed first (`<alias>_p<n>`, one counter
 * per action, starting at 1) and the command starts the next one. Splitting
 * only ever happens at a command boundary, so no command can be cut in half,
 * and the order is never disturbed. The parent alias then calls the parts in
 * order (`<alias>_p1; <alias>_p2`), which is how the whole chain still runs as
 * one action.
 *
 * A command that does not fit on a line even alone is emitted anyway rather
 * than dropped (same as upstream): a chunk always takes at least one command.
 * Truncating or discarding a command the user typed would be the silent
 * failure this whole module exists to avoid - the over-long line is visible in
 * the preview, a missing one is not.
 *
 * An action with no usable commands produces no aliases at all. `alias <name>`
 * with an empty body does not define an alias, it *prints* one, so emitting it
 * would put a line in the file that does nothing and binds a key to nothing.
 *
 * That rule is scoped to a *generated* action alias (story 038 AC6) and stays scoped there (story
 * 041, D3, "Decided in refine"): an action with `keepEmptyAlias` set - a user-authored hook like
 * `alias blaster_settings ""` the importer preserved - still emits its one line with an empty body
 * even though it has zero usable commands, because that alias definition is the entry, not a
 * leftover of one, and dropping it on the first save would be silent data loss.
 */
export function renderActionAlias(action: ConfigAction): RenderedActionAliases {
  const name = aliasNameFor(action)
  const commands = action.commands.map(commandLineFor).filter((command) => command.length > 0)
  if (commands.length === 0) {
    // Not `makeAlias(name, '')`: `renderAliasLine` quotes a body only when it contains a `;` (the
    // same rule as `alt-layers.ts#renderAliasLine`, deliberately unchanged for every other caller),
    // which would render this as `alias <name> ` - not a value the engine treats as an empty body at
    // all (a bare `alias <name>` with nothing after it *prints* the alias instead of defining one).
    // `alias <name> ""` is the one line that both round-trips through `sanitizeCommand` (which never
    // produces a lone `"`) and actually defines an empty-bodied alias, so it is spelled out here.
    return action.keepEmptyAlias
      ? { aliases: [{ name, body: '', line: `alias ${name} ""` }] }
      : { aliases: [] }
  }

  const oneLine = commands.join('; ')
  if (lineFits(name, oneLine)) return { aliases: [makeAlias(name, oneLine)] }

  const chunks: GeneratedAlias[] = []
  const chunkNames: string[] = []
  let current: string[] = []

  const flush = (): void => {
    if (current.length === 0) return
    const chunkName = `${name}_p${chunks.length + 1}`
    chunks.push(makeAlias(chunkName, current.join('; ')))
    chunkNames.push(chunkName)
    current = []
  }

  for (const command of commands) {
    // The name the current chunk will be flushed under - measuring against the
    // final name is what keeps a chunk from overflowing once it is renamed.
    const pendingName = `${name}_p${chunks.length + 1}`
    if (current.length > 0 && !lineFits(pendingName, [...current, command].join('; '))) flush()
    current.push(command)
  }
  flush()

  // The parent cannot overflow in practice: a chunk holds ~1000 bytes of
  // commands, so reaching the point where the chunk names alone fill a line
  // would take tens of kilobytes of commands in a single action.
  return { aliases: [...chunks, makeAlias(name, chunkNames.join('; '))] }
}

/**
 * Every action's alias lines, flattened, in `actions` array order - not sorted.
 * Actions have no natural sort key (two may share a name, and their order is
 * the order the user arranged them in), the same reason `renderProfileFile`
 * emits layers in array order. Deterministic all the same, since
 * `renderActionAlias` is pure and the array order is persisted.
 */
export function renderActionAliasLines(actions: ConfigAction[]): string[] {
  return actions.flatMap((action) => renderActionAlias(action).aliases.map((alias) => alias.line))
}
