/**
 * What a Save would change (story 049 D2): the live profile measured against its own
 * `baseline` (story 049 D1, `./profile-baseline`).
 *
 * The one place that answers "which of this profile's edits are not in the file yet" - for the
 * save bar's before/after list, for the per-row "unsaved" indicator, and for the counters that
 * must agree with both. Pure and shared rather than renderer-local (story 049, Decisions): it is
 * contract-level logic over `ConfigProfile` that has to stay in lockstep with `render.ts`'s field
 * set, and it is only testable cheaply as a pure function.
 *
 * ## The comparison is against what the file would say, not against the record
 *
 * Both sides are normalised through `captureBaseline` before anything is compared, so this module
 * never repeats D1's `?? []` / `!== false` / `?? 'dashes'` reads and can never disagree with the
 * snapshot it is diffing against. On top of that, two per-section rules exist purely to keep the
 * answer aligned with `render.ts`:
 *
 * - **Cvars are compared on their resolved value** (`writeValueFor`), i.e. on the value the `set`
 *   line would carry. Story 048 made the writer emit a line for *every* catalogue cvar, so a cvar
 *   the profile never stored is written at `def.default`; comparing stored maps instead would
 *   report every untouched catalogue cvar as a change the moment one side happens to spell it out.
 * - **A bind with an empty command is the same as no bind at all**, because `collectBindEntries`
 *   drops it at render time (`bind x ""` prints the current bind rather than setting one).
 *
 * ## No baseline means no changes here
 *
 * A profile with no `baseline` yields an empty change set, whether or not it is `dirty`. For
 * `dirty !== true` that is the literal truth (story 049, Decisions: "a profile with no stored
 * baseline and `dirty !== true` is treated as its own baseline"). For a legacy `dirty === true`
 * record from before this story there genuinely is no saved state to measure against, and this
 * function degrades to "nothing to show" rather than throwing or inventing a sentinel: the
 * "no known saved state" outcome, and the disabled discard that goes with it (D3/D6), keys off
 * `profile.baseline` being absent - never off an empty change set, which is also what a perfectly
 * clean profile produces.
 *
 * Pure by contract, like every other `src/shared/config` module: no node, no DOM, no electron.
 */

import type {
  ConfigAction,
  ConfigCommand,
  ConfigProfile,
  UnrecognizedConfigLine,
} from '../modules/config'
import { actionKeySlots } from './action-slots'
import type { AltLayer } from './alt-layers'
import { findCvar } from './cvar-catalog'
import type { CvarDef } from './cvar-facts'
import { isDefaultValue, writeValueFor } from './cvar-defaults'
import { captureBaseline, type ProfileBaseline } from './profile-baseline'

/**
 * Which part of the profile a change belongs to - the buckets the save bar renders as groups.
 *
 * `categories` is deliberately **not** one of them: story 049's plan fixes this set at six, and the
 * profile's custom category names, while they do reach the file (as section banners), have no
 * change row of their own here.
 */
export type ProfileChangeSection =
  'cvars' | 'binds' | 'actions' | 'layers' | 'settings' | 'unrecognized'

/** Section order in the flat list, and the order the buckets are built in. */
const SECTION_ORDER: readonly ProfileChangeSection[] = [
  'cvars',
  'binds',
  'actions',
  'layers',
  'settings',
  'unrecognized',
]

export type ProfileChangeKind = 'added' | 'removed' | 'changed'

/**
 * One pending change, in the shape the story's examples ask for ("`sensitivity` 3 -> 4.5",
 * "`F1` unbound -> `say gg`").
 *
 * `before`/`after` are plain, already-legible strings - never objects, never i18n keys - and the
 * missing side of an `added`/`removed` change is `undefined` rather than an empty string or a word
 * like "unbound": what to *show* for a side that does not exist is the renderer's decision (D5),
 * which is the only layer that may put translated prose on screen. Both properties are always
 * *present*, `undefined` value and all, so `'before' in change` never becomes a second, subtly
 * different way of asking what `kind` already answers.
 *
 * `key` is the stable identity a row lookup uses (see `ProfileChangeSet.keys`); `label` is what to
 * print. They differ only where identity is not the same thing as the display name: a catalogue
 * cvar is keyed by its lower-cased catalogue name (`cvarChangeKey`) but labelled with the
 * catalogue's own spelling, and an action or layer is keyed by its `id` but labelled with its name.
 */
export interface ProfileChange {
  section: ProfileChangeSection
  kind: ProfileChangeKind
  key: string
  label: string
  before?: string
  after?: string
}

/**
 * Every pending change, three ways: flat (the whole list, in section order), per section (empty
 * sections **absent**, so the save bar renders no group for them - story AC5), and as key sets.
 *
 * The key sets are what make a per-row indicator affordable: a row asks
 * `changes.keys.cvars.has(cvarChangeKey(name))` in O(1) instead of scanning the flat list once per
 * row on every render. Unlike `sections`, all six sets are always present (empty when that section
 * has no change), so a caller never has to null-check before asking.
 */
export interface ProfileChangeSet {
  changes: readonly ProfileChange[]
  sections: Partial<Record<ProfileChangeSection, readonly ProfileChange[]>>
  keys: Record<ProfileChangeSection, ReadonlySet<string>>
  /** `changes.length`, carried so the bar's badge does not have to reach into the array. */
  count: number
}

/**
 * The key a cvar change is filed under: the catalogue identity (`def.name` lower-cased, exactly
 * what `findCvar` matches on) for a recognized cvar, the stored name verbatim for one the catalogue
 * does not know.
 *
 * Exported so a Settings row (D7) derives the key the same way this module does rather than
 * re-deriving the catalogue-vs-unknown rule. The two spaces cannot collide: a name that equals some
 * `def.name.toLowerCase()` is by definition one `findCvar` resolves, so it never takes the
 * unrecognized branch.
 */
export function cvarChangeKey(name: string): string {
  const def = findCvar(name)
  return def ? def.name.toLowerCase() : name
}

/** `a` before `b`, `undefined` last - the locale-free ordering idiom `render.ts` already uses. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Canonical JSON for a deep structural comparison: object keys sorted (so two records that differ
 * only in insertion order are equal), arrays left in order (an action's `commands` order is
 * meaningful), and a property explicitly set to `undefined` treated as absent (which is what it is
 * to every optional field on `ConfigAction`).
 *
 * Used for actions and layers, whose "did anything about this entry change" question spans a dozen
 * optional fields; enumerating them here would be a second field list to keep in sync with
 * `ConfigAction` for no gain, and missing one would mean silently under-reporting a change.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => compareText(left, right))
    .map(([name, entry]) => `${JSON.stringify(name)}:${canonical(entry)}`)
    .join(',')}}`
}

// ---------------------------------------------------------------------------
// Cvars
// ---------------------------------------------------------------------------

/** One side's view of a cvar: which catalogue def it is (if any), how it was spelled, and the
 * value a `set` line would carry for it. */
interface CvarEntry {
  def: CvarDef | undefined
  name: string
  resolved: string
}

/**
 * Reads one side's `cvars` map the way `buildCvarSections` does: bucketed by catalogue identity,
 * one entry per bucket, the largest stored spelling winning a collision (`sensitivity` vs
 * `Sensitivity`, both reachable through an import that keeps a file's casing) - the same tie-break
 * the writer uses, so the value compared here is the value that would actually be written.
 * A key `findCvar` does not recognize is kept under its own verbatim name with its verbatim value.
 */
function indexCvars(cvars: Record<string, string>): Map<string, CvarEntry> {
  const entries = new Map<string, CvarEntry>()
  for (const [name, value] of Object.entries(cvars)) {
    const def = findCvar(name)
    if (!def) {
      entries.set(name, { def: undefined, name, resolved: value })
      continue
    }
    const id = def.name.toLowerCase()
    const held = entries.get(id)
    if (held === undefined || held.name < name) {
      entries.set(id, { def, name, resolved: writeValueFor(def, value) })
    }
  }
  return entries
}

/**
 * Whether two *resolved* catalogue-cvar values are the same value, under this cvar's own kind:
 * numerically for a numeric pair (`"1"` and `"1.0"`), case-insensitively for a `choice`,
 * case-sensitively for a `text`, with `toggle`'s `"true"`/`"1"` spellings collapsed.
 *
 * That rule already exists, exactly once, as `isDefaultValue`'s - so it is *called* here with a def
 * whose `default` is the value being compared against, rather than copied into a fourth
 * hand-written `sameValue`. (`cvar-defaults.ts`'s own file comment counts three copies already; a
 * fourth that drifted would make this diff and the writer disagree about what a change even is.)
 *
 * The one behaviour that does not carry over is `isDefaultValue`'s "an empty value is always the
 * default" short-circuit, which exists for *stored* values and would read a cleared value as equal
 * to whatever it replaced. Resolved values are never blank as the catalogue stands (no `CvarDef`
 * has an empty `default`, and `writeValueFor` falls back to that default for a blank stored value),
 * so the guard is unreachable today - it is here so that adding such a def later cannot silently
 * turn "cleared" into "unchanged".
 */
function sameCvarValue(def: CvarDef, before: string, after: string): boolean {
  if (before === after) return true
  if (before.trim() === '' || after.trim() === '') return before.trim() === after.trim()
  return isDefaultValue({ ...def, default: before }, after)
}

/**
 * The cvar changes.
 *
 * A **catalogue** cvar is only ever `changed`, never added or removed: since story 048 the file
 * carries a `set` line for it either way, so the map-key presence difference this diff can see
 * (stored on one side, absent on the other) is not a difference the file has. Both sides resolve
 * through `writeValueFor`, which is what makes an untouched cvar - absent from both maps, or
 * present at its default in one of them - compare equal.
 *
 * An **unrecognized** cvar keeps presence semantics and a verbatim, byte-exact value comparison:
 * the writer neither substitutes a default nor normalises anything for it (`stripCatalogDefaults`
 * draws the same carve-out), so `"1"` and `"1.0"` really are two different lines in the file and
 * are reported as a change. Numeric-aware comparison needs a `kind`, and an unrecognized cvar has
 * none to be aware of.
 */
function diffCvars(before: ProfileBaseline, after: ProfileBaseline): ProfileChange[] {
  const beforeCvars = indexCvars(before.cvars)
  const afterCvars = indexCvars(after.cvars)
  const changes: ProfileChange[] = []

  for (const key of [...new Set([...beforeCvars.keys(), ...afterCvars.keys()])].sort(compareText)) {
    const held = beforeCvars.get(key)
    const live = afterCvars.get(key)
    const def = live?.def ?? held?.def

    if (def) {
      // The absent side is not "no line" but "the line at its default" - story 048's always-write.
      const beforeValue = held ? held.resolved : writeValueFor(def, undefined)
      const afterValue = live ? live.resolved : writeValueFor(def, undefined)
      if (sameCvarValue(def, beforeValue, afterValue)) continue
      changes.push({
        section: 'cvars',
        kind: 'changed',
        key,
        label: def.name,
        before: beforeValue,
        after: afterValue,
      })
      continue
    }

    if (held && live) {
      if (held.resolved === live.resolved) continue
      changes.push({
        section: 'cvars',
        kind: 'changed',
        key,
        label: live.name,
        before: held.resolved,
        after: live.resolved,
      })
    } else if (live) {
      changes.push({
        section: 'cvars',
        kind: 'added',
        key,
        label: live.name,
        before: undefined,
        after: live.resolved,
      })
    } else if (held) {
      changes.push({
        section: 'cvars',
        kind: 'removed',
        key,
        label: held.name,
        before: held.resolved,
        after: undefined,
      })
    }
  }

  return changes
}

// ---------------------------------------------------------------------------
// Binds
// ---------------------------------------------------------------------------

/** The command on `key`, or `undefined` where the file would carry no `bind` line at all - an
 * absent key and a blank command are the same thing to `collectBindEntries`. */
function bindCommand(binds: Record<string, string>, key: string): string | undefined {
  const command = binds[key]
  return command === undefined || command.trim() === '' ? undefined : command
}

/**
 * The bind changes, keyed by the **stored** key spelling rather than a normalised one.
 *
 * `render.ts` writes `bind <key>` with the stored spelling verbatim, and every write path into
 * `profile.binds` normalises on the way in (`adoptProfileBinds`, `applyActionBindMirror`), so the
 * two sides spell a given key identically and a raw comparison is both the simplest and the one
 * that matches the file. The residual case - a key whose *spelling* changed - reads as a removal
 * plus an addition, which is what the file does too: two different `bind` lines.
 */
function diffBinds(before: ProfileBaseline, after: ProfileBaseline): ProfileChange[] {
  const keys = [...new Set([...Object.keys(before.binds), ...Object.keys(after.binds)])].sort(
    compareText,
  )
  const changes: ProfileChange[] = []

  for (const key of keys) {
    const held = bindCommand(before.binds, key)
    const live = bindCommand(after.binds, key)
    if (held === live) continue
    changes.push({
      section: 'binds',
      kind: held === undefined ? 'added' : live === undefined ? 'removed' : 'changed',
      key,
      label: key,
      before: held,
      after: live,
    })
  }

  return changes
}

// ---------------------------------------------------------------------------
// Actions and layers - id-keyed, order-insensitive
// ---------------------------------------------------------------------------

/** Both sides' rows by id, plus the id order to report them in: the live order first (what the
 * Controls tab shows), then the ids only the baseline still has, in baseline order. Reordering the
 * array alone therefore produces no change at all - the ids and their contents are identical. */
function pairById<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
): { held: Map<string, T>; live: Map<string, T>; ids: string[] } {
  // Two rows sharing an id are one entry to every id-keyed lookup in this codebase (see
  // `render.ts#buildEntryRefs`), so the later one wins here too.
  const held = new Map(before.map((row) => [row.id, row]))
  const live = new Map(after.map((row) => [row.id, row]))
  const ids = [...live.keys(), ...[...held.keys()].filter((id) => !live.has(id))]
  return { held, live, ids }
}

function describeCommand(command: ConfigCommand): string {
  return command.kind === 'message' ? `${command.channel} ${command.text}` : command.text
}

/** One key slot as `ALT+r` / `r`, or `''` for an empty slot. */
function describeSlot(key: string | undefined, modifier: string | undefined): string {
  const name = key?.trim() ?? ''
  if (!name) return ''
  return modifier ? `${modifier}+${name}` : name
}

/** An action as one legible line: `Quick gg (message) F1: say gg`. Deliberately free of prose -
 * every word in it is profile data - so nothing here needs translating. All of an action's key
 * slots are listed, in `keys` order, not just the first two (story 050). */
function describeAction(action: ConfigAction): string {
  const slots = actionKeySlots(action)
    .map((slot) => describeSlot(slot.key, slot.modifier))
    .filter((slot) => slot.length > 0)
  const head = `${action.name || action.id} (${action.kind})`
  const keys = slots.length > 0 ? ` ${slots.join(', ')}` : ''
  const alias = action.aliasName ? ` [${action.aliasName}]` : ''
  return `${head}${keys}${alias}: ${action.commands.map(describeCommand).join('; ')}`
}

/** A layer as one legible line: `Drops (hold, ALT): 1=drop rl, 2=drop rg`. Overrides are sorted by
 * key so a map rebuilt in another order does not read as a different layer. */
function describeLayer(layer: AltLayer): string {
  const trigger = layer.triggerKey?.trim() ?? ''
  const head = `${layer.name || layer.id} (${layer.mode}${trigger ? `, ${trigger}` : ''})`
  const overrides = Object.entries(layer.overrides)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, command]) => `${key}=${command}`)
    .join(', ')
  return `${head}: ${overrides}`
}

/**
 * The added/removed/changed rows for one id-keyed section.
 *
 * "Changed" is decided by a deep structural comparison (`canonical`), so every field counts -
 * including the ones no summary line shows (`catalogId`, `keepEmptyAlias`), which do reach the file
 * as `[q2l ...]` tag content. Where two structurally different rows happen to summarise identically,
 * the canonical form is shown instead: a change row whose before and after read the same would
 * look like a bug, and this is the one place that can tell the two cases apart.
 */
function diffById<T extends { id: string }>(
  section: ProfileChangeSection,
  before: readonly T[],
  after: readonly T[],
  labelOf: (row: T) => string,
  describe: (row: T) => string,
): ProfileChange[] {
  const { held, live, ids } = pairById(before, after)
  const changes: ProfileChange[] = []

  for (const id of ids) {
    const heldRow = held.get(id)
    const liveRow = live.get(id)

    if (heldRow && liveRow) {
      if (canonical(heldRow) === canonical(liveRow)) continue
      const heldText = describe(heldRow)
      const liveText = describe(liveRow)
      const legible = heldText !== liveText
      changes.push({
        section,
        kind: 'changed',
        key: id,
        label: labelOf(liveRow),
        before: legible ? heldText : canonical(heldRow),
        after: legible ? liveText : canonical(liveRow),
      })
    } else if (liveRow) {
      changes.push({
        section,
        kind: 'added',
        key: id,
        label: labelOf(liveRow),
        before: undefined,
        after: describe(liveRow),
      })
    } else if (heldRow) {
      changes.push({
        section,
        kind: 'removed',
        key: id,
        label: labelOf(heldRow),
        before: describe(heldRow),
        after: undefined,
      })
    }
  }

  return changes
}

// ---------------------------------------------------------------------------
// Per-profile settings
// ---------------------------------------------------------------------------

/**
 * The per-profile scalars a save writes (`name`, `writeUnbindall`, `sectionHeaderStyle`), compared
 * on their resolved values - both sides went through `captureBaseline`, so an absent
 * `writeUnbindall` is already the `true` it renders as, and an absent `sectionHeaderStyle` is
 * already `'dashes'`.
 *
 * `name` is here rather than in a section of its own (review finding, story 049): a rename is
 * pending file content like the other two - it is the header banner's text and the canonical file's
 * name, both written by the next save (story 043) - and the story fixes this diff's section list at
 * six, so `settings` is the bucket it belongs in. It is reported first because it is the coarsest of
 * the three.
 *
 * `before`/`after` are the values themselves as strings (`"true"`, `"dashes"`); `key` is the field
 * name, which is what a renderer translates on (D5), never this text.
 */
function diffSettings(before: ProfileBaseline, after: ProfileBaseline): ProfileChange[] {
  const changes: ProfileChange[] = []

  if (before.name !== after.name) {
    changes.push({
      section: 'settings',
      kind: 'changed',
      key: 'name',
      label: 'name',
      before: before.name,
      after: after.name,
    })
  }

  if (before.writeUnbindall !== after.writeUnbindall) {
    changes.push({
      section: 'settings',
      kind: 'changed',
      key: 'writeUnbindall',
      label: 'writeUnbindall',
      before: String(before.writeUnbindall),
      after: String(after.writeUnbindall),
    })
  }

  if (before.sectionHeaderStyle !== after.sectionHeaderStyle) {
    changes.push({
      section: 'settings',
      kind: 'changed',
      key: 'sectionHeaderStyle',
      label: 'sectionHeaderStyle',
      before: before.sectionHeaderStyle,
      after: after.sectionHeaderStyle,
    })
  }

  return changes
}

// ---------------------------------------------------------------------------
// Preserved (unrecognized) lines
// ---------------------------------------------------------------------------

/**
 * Preserved lines by `<file>:<line>` - the only identity they have, since an
 * `UnrecognizedConfigLine` carries no id.
 *
 * A repeat of the same `{file, line}` (not producible by an import, which walks each file once, but
 * reachable from a hand-edited store) gets a `#<n>` suffix rather than overwriting the first, so no
 * line can be silently dropped from the comparison.
 */
function indexUnrecognized(
  lines: readonly UnrecognizedConfigLine[],
): Map<string, UnrecognizedConfigLine> {
  const seen = new Map<string, number>()
  const indexed = new Map<string, UnrecognizedConfigLine>()
  for (const line of lines) {
    const base = `${line.file}:${line.line}`
    const occurrence = (seen.get(base) ?? 0) + 1
    seen.set(base, occurrence)
    indexed.set(occurrence === 1 ? base : `${base}#${occurrence}`, line)
  }
  return indexed
}

/**
 * The preserved-line changes: added, removed, or a different text on the same `{file, line}`.
 *
 * Per-line rather than a coarse "the count differs" (the two options the story left open): a
 * tidy-up that re-classifies one line into a real cvar changes the count *and* which line went, and
 * only the per-line form can say which. Ordered by file, then line number, which is how a reader of
 * the original file would meet them.
 */
function diffUnrecognized(before: ProfileBaseline, after: ProfileBaseline): ProfileChange[] {
  const held = indexUnrecognized(before.unrecognized)
  const live = indexUnrecognized(after.unrecognized)
  const changes: ProfileChange[] = []

  const keys = [...new Set([...held.keys(), ...live.keys()])].sort((left, right) => {
    const a = live.get(left) ?? held.get(left)!
    const b = live.get(right) ?? held.get(right)!
    return compareText(a.file, b.file) || a.line - b.line || compareText(left, right)
  })

  for (const key of keys) {
    const heldLine = held.get(key)
    const liveLine = live.get(key)
    if (heldLine && liveLine && heldLine.text === liveLine.text) continue
    const anchor = liveLine ?? heldLine!
    changes.push({
      section: 'unrecognized',
      kind: heldLine === undefined ? 'added' : liveLine === undefined ? 'removed' : 'changed',
      key,
      label: `${anchor.file}:${anchor.line}`,
      before: heldLine?.text,
      after: liveLine?.text,
    })
  }

  return changes
}

// ---------------------------------------------------------------------------

/** Buckets and key sets over the flat list - the one place that decides that an empty section is
 * absent from `sections` while its key set is still present but empty. */
function buildChangeSet(changes: ProfileChange[]): ProfileChangeSet {
  const sections: Partial<Record<ProfileChangeSection, ProfileChange[]>> = {}
  const keys = Object.fromEntries(
    SECTION_ORDER.map((section) => [section, new Set<string>()]),
  ) as Record<ProfileChangeSection, Set<string>>

  for (const change of changes) {
    ;(sections[change.section] ??= []).push(change)
    keys[change.section].add(change.key)
  }

  return { changes, sections, keys, count: changes.length }
}

/**
 * Every change a Save would write for `profile`, measured against its own `baseline`.
 *
 * Empty - all six buckets absent, all six key sets empty - for a profile that equals its baseline,
 * and for a profile that has no baseline at all (see the file doc comment for why that is not an
 * error here).
 */
export function diffProfileAgainstBaseline(profile: ConfigProfile): ProfileChangeSet {
  const baseline = profile.baseline
  if (!baseline) return buildChangeSet([])

  // The live side goes through D1's own capture, so "what counts as a field, and how is it
  // normalised" is answered once, by the module that defines the snapshot.
  const live = captureBaseline(profile)

  return buildChangeSet([
    ...diffCvars(baseline, live),
    ...diffBinds(baseline, live),
    ...diffById(
      'actions',
      baseline.actions,
      live.actions,
      (action) => action.name || action.id,
      describeAction,
    ),
    ...diffById(
      'layers',
      baseline.layers,
      live.layers,
      (layer) => layer.name || layer.id,
      describeLayer,
    ),
    ...diffSettings(baseline, live),
    ...diffUnrecognized(baseline, live),
  ])
}
