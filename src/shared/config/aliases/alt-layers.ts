/**
 * Alternate binding layers — the pure alias generator.
 *
 * Quake 2 has no modifiers. The engine sees ALT and W as two unrelated keys,
 * so `bind ALT+W` is not a thing that exists. What a layer actually is: the
 * trigger key runs an alias that rebinds the affected keys, and a second alias
 * puts them back. Getting that pair out of sync is how configs end up with
 * keys that "randomly" do the wrong thing, so both halves are generated here
 * from one description and never by hand.
 *
 *   hold   alias +drops "bind 1 drop rl; bind 2 drop rg"
 *          alias -drops "bind 1 weapnext; unbind 2"
 *          bind ALT +drops
 *
 *   toggle alias zoom_on  "bind 1 x; alias zoom zoom_off"
 *          alias zoom_off "bind 1 y; alias zoom zoom_on"
 *          alias zoom     zoom_on
 *          bind v zoom
 *
 * The toggle form works by rewriting the dispatch alias every time it fires,
 * which is the only way to hold state in the console language.
 *
 * Ported from the external q2-config-manager project (`src/core/altlayers.ts`)
 * — its naming and chunking idioms, **not** its quoting: upstream nested
 * quotes inside an alias body, which Quake 2 silently eats (see the quoting
 * rules below).
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*`, no DOM,
 * no electron. The renderer uses it for the live preview, main's writer uses
 * it for the file — one generator, so preview and disk can never disagree.
 *
 * ## What the engine actually does (every rule below follows from this)
 *
 * - `Cbuf_Execute` copies one command at a time into `char line[1024]`, ending
 *   it at the first `;` or `\n` that is **not inside quotes**. That is the
 *   1024-byte line limit and the reason a multi-command alias body has to be
 *   wrapped in quotes: `alias +foo bind 1 a; bind 2 b` defines `+foo` as
 *   `bind 1 a` and executes `bind 2 b` immediately, at write time.
 * - Its quote tracking is a plain counter over the line, so an unbalanced or
 *   nested quote moves the split to the wrong place — for the rest of the
 *   file. Quake 2 has no in-quote escaping, so a nested quote cannot be
 *   written at all.
 * - `Cmd_Alias_f` concatenates the tokens after the alias name with single
 *   spaces, and the tokenizer has already stripped quotes. `alias +foo bind 1
 *   use blaster` (unquoted, several tokens) is therefore correct, and
 *   `alias +foo "bind 1 "use blaster""` stores `bind 1 use blaster` at best
 *   and corrupts the following lines at worst.
 *
 * Hence: bodies never contain a quote character, and a body is wrapped in one
 * pair of quotes exactly when it contains a `;`.
 */

export type AltLayerMode = 'hold' | 'toggle'

export interface AltLayer {
  id: string
  name: string
  mode: AltLayerMode
  /**
   * `null` when the layer has no trigger assigned yet (story 011): it still
   * renders its aliases, but is not reachable from the keyboard until a
   * trigger is bound via `assignLayerTrigger`.
   */
  triggerKey: string | null
  /** key -> command, this layer's own overrides only (never the base layer's binds). */
  overrides: Record<string, string>
}

/**
 * `MAX_ALIAS_NAME` characters including the implicit terminator, so 31 are
 * usable. `MAX_LINE_BYTES` is `Cbuf_Execute`'s `char line[1024]`.
 */
export const MAX_ALIAS_NAME = 32
export const MAX_LINE_BYTES = 1024

/** Usable alias-name characters: the 32nd is the terminator. */
const USABLE_ALIAS_NAME = MAX_ALIAS_NAME - 1

/**
 * Headroom kept free at the end of every generated line (same value upstream
 * uses): the engine appends its own separator, and a line that lands exactly
 * on the limit is the one case nobody ever tests.
 */
const LINE_HEADROOM = 16

export interface GeneratedAlias {
  name: string
  body: string
  /**
   * Rendered `alias <name> <body>` line — quoted as `alias <name> "<body>"`
   * exactly when the body contains a `;`. The body itself never contains a
   * quote character, so these can never nest.
   */
  line: string
}

export interface LayerIssue {
  /** i18n key, never prose. */
  key:
    | 'layer.empty'
    | 'layer.selfbind'
    | 'layer.plusbind'
    | 'layer.triggerConflict'
    | 'layer.quote'
    | 'layer.noTrigger'
  level: 'warning' | 'error'
  /** Structured params for the i18n string (e.g. { key: 'w', command: '+forward' }). */
  params?: Record<string, string>
}

export interface GenerateLayerResult {
  aliases: GeneratedAlias[]
  /**
   * The bind that activates the layer: which key, which command. `null` when
   * the layer has no trigger — never a `{ key: '' }` placeholder, so no
   * caller can emit `bind  <command>` by omission.
   */
  triggerBind: { key: string; command: string } | null
  issues: LayerIssue[]
}

/**
 * Length of `text` in latin1 bytes.
 *
 * `String.length` counts UTF-16 code units, which is *exactly* the latin1 byte
 * count: latin1 writes one byte per code unit (a surrogate pair, two units,
 * becomes two bytes). Only UTF-8 would differ, and the config files this
 * module feeds are written as latin1/high-ASCII, because that is what the
 * engine reads. So no `Buffer` import is needed — which matters, since
 * `src/shared` may not touch node.
 */
function latin1ByteLength(text: string): number {
  return text.length
}

/**
 * Make a command safe to place inside an alias body — or, since D6, safe to
 * store as a base bind at all: the raw-command field the keybinding editor
 * saves through is otherwise unsanitised on the way to `render.ts`, which
 * would nest a user-typed `"` and produce exactly the broken syntax this
 * module exists to avoid (review finding, story 006). Exported so
 * `KeyBindDialog` can apply the identical rule before saving a base bind,
 * instead of only ever sanitising inside a layer body.
 *
 * - Quote characters are dropped. Inside a quoted body they would nest and
 *   break the line split; inside an unquoted body the tokenizer strips them
 *   anyway. Dropping them writes exactly what the engine would have stored.
 * - All whitespace collapses to single spaces. A tab is a token separator and
 *   a newline ends the command — either one inside a bind command would cut
 *   the generated line in half.
 */
export function sanitizeCommand(command: string): string {
  return command.replace(/"/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * A command that has to be hoisted into its own helper alias instead of being
 * embedded in a layer body: an inline `;` would end the surrounding `bind`
 * early, and a `"` is a command the user wrote quotes into, which is worth
 * isolating in one visible place rather than smearing through a long body.
 */
function needsHelperAlias(rawCommand: string): boolean {
  return rawCommand.includes(';') || rawCommand.includes('"')
}

function renderAliasLine(name: string, body: string): string {
  // Quoted exactly when the body carries a `;`, so `Cbuf_Execute` keeps the
  // whole list as one command. A single-command body needs no quotes at all.
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
 * Sanitize a human-entered layer name into an alias-safe slug: lower case,
 * runs of anything outside `[a-z0-9_]` collapsed to a single `_`, no leading
 * or trailing `_`, `fallback` when nothing survives, truncated to `maxLength`.
 *
 * German umlauts are transliterated first (the upstream idiom), so "Größe"
 * becomes `groesse` rather than `gr_e`.
 *
 * Collisions between two different layers' slugs are deliberately **not**
 * handled here — that needs to know about the other layers, which a pure
 * per-layer generator does not. Disambiguating is the caller's job.
 *
 * `fallback` (story 039, D1) defaults to `'layer'` for this module's own
 * callers (an alt-layer whose name slugs to nothing). `alias-render.ts` passes
 * `'entry'` instead, so an action whose name slugs to nothing reads as an
 * action, not a layer.
 */
export function slugAliasName(name: string, maxLength: number, fallback = 'layer'): string {
  const slug = name
    .toLowerCase()
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  // The trimmed slug starts with `[a-z0-9]`, so trimming the truncation's
  // trailing `_` back off can never empty it.
  return (slug || fallback).slice(0, Math.max(1, maxLength)).replace(/_+$/, '')
}

function digits(value: number): number {
  return String(Math.max(1, value)).length
}

/**
 * Generate one layer's aliases plus its trigger bind.
 *
 * `baseBinds` is the profile's base-layer bind map (key -> command); it is
 * needed for the restore half and to spot `+command` collisions.
 *
 * An empty layer returns `aliases: []` **and** its nominal `triggerBind`; a
 * caller writing to disk must skip the trigger bind when there are no aliases,
 * otherwise the trigger key would be overwritten with a call to an alias that
 * does not exist.
 */
export function generateLayerAliases(
  layer: AltLayer,
  baseBinds: Record<string, string>,
): GenerateLayerResult {
  const issues: LayerIssue[] = []
  const triggerKey = layer.triggerKey?.trim() ?? ''

  // Overrides with no key or no command are not overrides. A stored empty
  // command would render as `bind 1 `, which prints the current bind instead
  // of setting one.
  const overrides = Object.entries(layer.overrides)
    .map(([key, command]) => ({ key: key.trim(), raw: command ?? '' }))
    .filter((entry) => entry.key.length > 0 && sanitizeCommand(entry.raw).length > 0)

  const baseCommandFor = (key: string): string => sanitizeCommand(baseBinds[key] ?? '')
  const rawBaseCommandFor = (key: string): string => baseBinds[key] ?? ''

  if (overrides.length === 0) {
    issues.push({ key: 'layer.empty', level: 'warning' })
  } else if (!triggerKey) {
    // The layer has content but nothing binds it into reach from the
    // keyboard — additional information on top of `layer.empty`, not a
    // replacement for it, so the two never fire together.
    issues.push({ key: 'layer.noTrigger', level: 'warning' })
  }

  // A layer that remaps its own trigger key can never be left again: the key
  // that would release it now does something else.
  if (triggerKey && overrides.some((entry) => entry.key === triggerKey)) {
    issues.push({ key: 'layer.selfbind', level: 'error', params: { key: triggerKey } })
  }

  // The classic trap: a `+command` looks up its `-command` at release time. If
  // the bind changed while the key was held, the release half never fires and
  // the player keeps walking forward. One issue per offending key.
  for (const entry of overrides) {
    const baseCommand = baseCommandFor(entry.key)
    if (baseCommand.startsWith('+')) {
      issues.push({
        key: 'layer.plusbind',
        level: 'warning',
        params: { key: entry.key, command: baseCommand },
      })
    }
  }

  // The trigger bind is emitted last and therefore wins — say so rather than
  // dropping the user's existing bind silently.
  const triggerBase = triggerKey ? baseCommandFor(triggerKey) : ''
  if (triggerBase) {
    issues.push({
      key: 'layer.triggerConflict',
      level: 'warning',
      params: { key: triggerKey, command: triggerBase },
    })
  }

  // --- name budget -------------------------------------------------------
  //
  // Every alias of one layer's family must fit in 31 usable characters, so the
  // base slug is shortened by the longest affix this family can actually
  // produce. The members are `+base`/`-base` (hold), `base`/`base_on`/
  // `base_off` (toggle), the chunk aliases `base_pN` and the helper aliases
  // `base_cN`. No member carries two affixes at once — chunks and helpers hang
  // off the bare base, never off a signed or `_on`/`_off` name — so the
  // reserve is the maximum, not the sum.
  const modeAffix = layer.mode === 'hold' ? 1 : '_off'.length

  const helperCandidates =
    overrides.filter((entry) => needsHelperAlias(entry.raw)).length +
    overrides.filter((entry) => needsHelperAlias(rawBaseCommandFor(entry.key))).length
  const helperAffix = helperCandidates > 0 ? 2 + digits(helperCandidates) : 0

  // Upper bound on the number of chunks: chunk numbering runs across both
  // halves and a chunk holds at least one command, so it can never exceed the
  // total command count (`+ 2` for the toggle's two dispatch rewrites). The
  // reserve is unconditional: whether a body chunks depends on the length of
  // every command in it, so "does this layer need chunks" is only knowable
  // after the names it would use exist. Reserving 3-5 characters that a short
  // layer never spends is worth strictly more than a name that fits until the
  // day someone binds one more key.
  const maxChunks = overrides.length * 2 + 2
  const chunkAffix = overrides.length > 0 ? 2 + digits(maxChunks) : 0

  const reserve = Math.max(modeAffix, helperAffix, chunkAffix)
  const base = slugAliasName(layer.name, USABLE_ALIAS_NAME - reserve)

  const dispatchName = base
  const onName = layer.mode === 'hold' ? `+${base}` : `${base}_on`
  const offName = layer.mode === 'hold' ? `-${base}` : `${base}_off`
  const triggerBind = triggerKey
    ? { key: triggerKey, command: layer.mode === 'hold' ? onName : dispatchName }
    : null

  if (overrides.length === 0) {
    return { aliases: [], triggerBind, issues }
  }

  // --- helper aliases ----------------------------------------------------
  const helpers: GeneratedAlias[] = []
  const helperByCommand = new Map<string, string>()

  /** Hoist a command into `alias <base>_cN <command>` and return that name. */
  const hoist = (command: string): string => {
    const known = helperByCommand.get(command)
    if (known) return known
    // Numbering counts only commands that are actually hoisted, and identical
    // commands share one helper — so the numbers are dense, never sparse.
    const name = `${base}_c${helpers.length + 1}`
    helperByCommand.set(command, name)
    helpers.push(makeAlias(name, command))
    return name
  }

  const bindCommand = (key: string, raw: string): string => {
    const command = sanitizeCommand(raw)
    return needsHelperAlias(raw) ? `bind ${key} ${hoist(command)}` : `bind ${key} ${command}`
  }

  // Apply half first, restore half second, both in override-iteration order —
  // that order is what the `_cN` numbering follows.
  const applyCommands = overrides.map((entry) => bindCommand(entry.key, entry.raw))
  const restoreCommands = overrides.map((entry) => {
    const raw = rawBaseCommandFor(entry.key)
    // Without an explicit unbind, a key that was free before the layer stays
    // bound after it is released.
    return sanitizeCommand(raw) ? bindCommand(entry.key, raw) : `unbind ${entry.key}`
  })

  // --- chunking ----------------------------------------------------------
  //
  // One counter for the whole layer, so the two halves can never generate the
  // same `_pN` name. Chunk names hang off the bare base (no `+`/`-`, no
  // `_on`/`_off`), which keeps them inside the name budget.
  let chunkCount = 0
  const buildHalf = (
    parentName: string,
    commands: string[],
  ): {
    body: string
    chunks: GeneratedAlias[]
  } => {
    const oneLine = commands.join('; ')
    if (lineFits(parentName, oneLine)) return { body: oneLine, chunks: [] }

    const chunks: GeneratedAlias[] = []
    const chunkNames: string[] = []
    let current: string[] = []

    const flush = (): void => {
      if (current.length === 0) return
      const name = `${base}_p${++chunkCount}`
      chunks.push(makeAlias(name, current.join('; ')))
      chunkNames.push(name)
      current = []
    }

    for (const command of commands) {
      const nextName = `${base}_p${chunkCount + 1}`
      if (current.length > 0 && !lineFits(nextName, [...current, command].join('; '))) flush()
      current.push(command)
    }
    flush()

    // The parent only calls the chunks. It cannot overflow in practice: a
    // chunk holds ~1000 bytes of commands, so filling 30 of them (the point
    // where the chunk names alone reach the limit) would take 30 KB of binds,
    // far more than the engine has bindable keys.
    return { body: chunkNames.join('; '), chunks }
  }

  const on = buildHalf(
    onName,
    layer.mode === 'hold' ? applyCommands : [...applyCommands, `alias ${dispatchName} ${offName}`],
  )
  const off = buildHalf(
    offName,
    layer.mode === 'hold'
      ? restoreCommands
      : [...restoreCommands, `alias ${dispatchName} ${onName}`],
  )

  // Definition order: helpers, chunks, the two halves, then the toggle's
  // dispatch alias. Quake 2 resolves alias bodies when they run, not when they
  // are defined, so this is for readability — and for the dispatch alias,
  // which must end up pointing at the "on" half after the block is executed.
  const aliases: GeneratedAlias[] = [
    ...helpers,
    ...on.chunks,
    ...off.chunks,
    makeAlias(onName, on.body),
    makeAlias(offName, off.body),
  ]
  if (layer.mode === 'toggle') aliases.push(makeAlias(dispatchName, onName))

  return { aliases, triggerBind, issues }
}

/**
 * Assign, move or clear a layer's trigger key (story 011 decision 3): one key
 * triggers at most one layer, so assigning a key that is already another
 * layer's trigger moves it here in the same call rather than leaving two
 * layers pointing at the same `bind <key>` line.
 *
 * - `key: string` — sets `layerId`'s trigger to `key` and clears that same
 *   key off every *other* layer that currently holds it as its trigger.
 * - `key: null` — clears `layerId`'s own trigger only; no other layer is
 *   touched.
 *
 * Never touches `overrides`. Returns a new array; if `layerId` matches no
 * layer, the input is returned unchanged (no layer is invented, nothing
 * throws).
 */
export function assignLayerTrigger(
  layers: AltLayer[],
  layerId: string,
  key: string | null,
): AltLayer[] {
  if (!layers.some((candidate) => candidate.id === layerId)) return layers

  return layers.map((candidate) => {
    if (candidate.id === layerId) return { ...candidate, triggerKey: key }
    if (key !== null && candidate.triggerKey === key) return { ...candidate, triggerKey: null }
    return candidate
  })
}

/** The layer whose trigger is `key`, or `null` if no layer's trigger matches. */
export function findLayerByTriggerKey(layers: AltLayer[], key: string): AltLayer | null {
  return layers.find((candidate) => candidate.triggerKey === key) ?? null
}
