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

/** Every generated action alias starts with this - the `setActions` handler's bind mirror
 * (D4) identifies the binds it owns by exactly this prefix, so it is one constant, here. */
export const ACTION_ALIAS_PREFIX = 'q2l_a_'

/** Usable alias-name characters: the 32nd is the terminator (see `MAX_ALIAS_NAME`). */
const USABLE_ALIAS_NAME = MAX_ALIAS_NAME - 1

/** Characters of the action's `id` appended to disambiguate same-named actions. */
const ID_SUFFIX_LENGTH = 4

/**
 * Reserve for the chunk suffix `_p<n>`, so a split action's parts still fit in
 * the name budget. Two digits is not a cap: a chunk holds at least one command,
 * so a three-digit part number needs an action with 100+ commands, and even
 * then the name is 25 + 5 = 30 characters and still fits the usable 31. The
 * reserve just keeps the common case's arithmetic honest.
 */
const PART_SUFFIX_RESERVE = '_p'.length + 2

/**
 * Length of the name slug (decision 15). Capped a second time by what the name
 * budget actually allows, so the whole family stays inside `MAX_ALIAS_NAME`
 * by construction rather than by comment: prefix (6) + slug (14) + `_` (1) +
 * id (4) = 25, leaving 6 of the usable 31 for `_p<n>`.
 */
const SLUG_LENGTH = Math.min(
  14,
  USABLE_ALIAS_NAME - ACTION_ALIAS_PREFIX.length - 1 - ID_SUFFIX_LENGTH - PART_SUFFIX_RESERVE,
)

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
 * The generated alias name for an action: `q2l_a_<slug(name,14)>_<id[0:4]>`
 * (decision 15). Id-suffixed so two actions the user named alike never collide,
 * and short enough that the `_p<n>` suffix of a split action still fits.
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
 */
export function aliasNameFor(action: ConfigAction): string {
  const slug = slugAliasName(action.name, SLUG_LENGTH)
  const idSuffix =
    action.id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, ID_SUFFIX_LENGTH) || '0000'
  return `${ACTION_ALIAS_PREFIX}${slug}_${idSuffix}`
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
 */
export function renderActionAlias(action: ConfigAction): RenderedActionAliases {
  const name = aliasNameFor(action)
  const commands = action.commands.map(commandLineFor).filter((command) => command.length > 0)
  if (commands.length === 0) return { aliases: [] }

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
