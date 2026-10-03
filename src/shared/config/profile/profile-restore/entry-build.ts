import { bindValueFor } from '@shared/config/aliases/action-mirror'
import { fitProseAndTag } from '@shared/config/syntax/cfg-layout'
import { withKeySlot } from '@shared/config/catalog/action-slots'
import {
  collapseWaitRuns,
  configCommandFor,
  entryKindFor,
  splitAliasBody,
} from '@shared/config/aliases/alias-import'
import { normalizeBindKey } from '@shared/config/syntax/key-names'
import type { ModifierTrigger } from '@shared/config/aliases/modifier-layers'
import { COMMENT_LINE_BUDGET, COMMENT_PREFIX } from '@shared/config/syntax/file-vocabulary'
import type {
  ActionEntryKind,
  ActionKeySlot,
  ConfigAction,
  ConfigCommand,
} from '@shared/modules/config'
import {
  type RestoreSourcePosition,
  type RestoreAliasLine,
  type RestoreBindLine,
  type UnboundEntryLine,
  type RestoreWarningReason,
  type RestoreWarning,
  type Section,
  sectionFor,
  type TaggedLine,
  type EntryGroup,
} from './types'
import { TAG_SIGIL } from './comment-parse'
import { categoryRegistry } from './categories'

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export const MODIFIER_TRIGGERS = new Set<string>(['ALT', 'CTRL', 'SHIFT'])

/** `alias <base>_p<n>` - a chunk of a body too long for one line (`alias-render.ts`). */
export const CHUNK_SUFFIX = /^(.*)_p(\d+)$/
/** `alias <base>_c<n>` - a command hoisted out of a layer body (`alt-layers.ts`). */
export const HELPER_SUFFIX = /_c\d+$/

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
 * ## `chunkBodies`: where the writer's own command boundaries are
 *
 * `body` is the fold as *text*, which is all the recogniser wants. A reader that turns the fold back
 * into *commands* needs one thing the joined text has lost: `renderActionAlias` only ever splits a
 * chunk **between two commands**, so a chunk boundary is a command boundary the file records - and
 * the one command kind that spans several segments (`{ kind: 'wait' }` -> `frames` literal `wait`
 * segments) is therefore never split across two chunks. Two *adjacent* wait commands can be, and
 * once the two chunk bodies are joined, `collapseWaitRuns` cannot tell that run from one longer
 * wait: `wait(3)` + `wait(2)` would read back as one `wait(5)`, whose 28-character expansion no longer
 * fits where the 16-character one did, so the next render would move the chunk boundary and break
 * the fixed point (story 042). `chunkBodies` keeps the bodies apart, in order,
 * so a caller can classify each one on its own and concatenate.
 */
export function foldedAliasBody(lines: readonly TaggedLine<RestoreAliasLine>[]): {
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
    if (match && names.has(match[1]!))
      chunks.push({ index: Number(match[2]), body: line.item.body })
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
 * Run **per chunk body**, not over the fold: a chunk boundary
 * is a command boundary the writer recorded, so a wait run that ends one chunk and a wait run that
 * opens the next are two commands, not one - see `foldedAliasBody`'s `chunkBodies` for the
 * cost of collapsing across the join.
 */
export function commandsFromAliases(lines: readonly TaggedLine<RestoreAliasLine>[]): {
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
export function commandsFromSegments(segments: readonly string[]): ConfigCommand[] {
  return collapseWaitRuns(segments.map(configCommandFor))
}

/**
 * The entry's `kind`, inferred - the tag carries no `k`: the field would restate something
 * the lines already say, and a second source could only ever drift from them.
 *
 * The `kind: 'alias'` test comes first and is the only way to reach that kind: an entry that has an
 * alias line, that no line claims a key for **and** that carries no unbound line is story 019's
 * definition of one (never bound). Everything else is a keyed kind, and a single `say`/`say_team`
 * body makes that one a message (`entryKindFor`, story 041 - the same table the untagged path uses)
 * rather than a `bind`.
 *
 * `bound` counts *every* slot claim, anchors included, not just bind lines: an entry bound only
 * through a modifier layer has its key on an anchor line and no bind line at all
 * (`render.ts#buildAnchorLines`), and it is still a bound entry.
 *
 * ## `hasUnboundLine`, and why it has to outrank the alias line (story 063, D2)
 *
 * An alias line records what an entry *runs*, never whether its key slot is filled, so on its own it
 * cannot tell "a `kind: 'alias'` entry, deliberately never bound" apart from "a `bind`/`message`
 * entry whose one key slot happens to be empty" - a grenade row, seeded with a body and no key.
 * Reading both as `kind: 'alias'` would lose the second one's bind slot permanently: the Controls
 * tab has no key cell for an alias entry, so the row could never be bound again.
 *
 * So the file records the missing fact - `render.ts#isUnboundEntry` writes the commented-out
 * `//bind "<cmd>"` for a keyless `bind`/`message` entry *even when it also has an alias line* - and
 * this is the reader that has to believe it. A group with an unbound line is a
 * keyed kind with an empty slot; an alias line with no unbound line beside it is the deliberate
 * alias entry. That is a real distinction the writer makes, which is why the unbound line outranks
 * both the alias line and the message table here.
 *
 * Two consequences worth naming:
 *
 * - A `kind: 'alias'` entry whose body is a single `say` (`alias gg "say gg"`, never bound) stays an
 *   alias entry rather than being promoted to `kind: 'message'` on every read: the two shapes differ
 *   in the file, so promoting it would grow an unbound line the original never had and break
 *   story 042's fixed point. A keyless `kind: 'message'` entry comes back as one, off its own
 *   unbound line.
 * - A file written without an unbound line for a keyless bodied `bind` entry still reads back as
 *   `kind: 'alias'`. Nothing here can recover a fact the file never recorded; the first save
 *   writes it, and every read after that is right.
 */
export function inferKind(
  commands: readonly ConfigCommand[],
  hasAliasLine: boolean,
  bound: boolean,
  hasUnboundLine: boolean,
): ActionEntryKind {
  if (hasAliasLine && !bound && !hasUnboundLine) return 'alias'
  return entryKindFor(commands) === 'message' ? 'message' : 'bind'
}

/** One line's claim on a key slot: a bind line (whose key is the config text's own) or an anchor
 * line (whose key is in its tag, since a comment-only line has no code to read it off). */
export interface SlotClaim {
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
export function keySlotsFrom(group: EntryGroup, warnings: RestoreWarning[]): ActionKeySlot[] {
  const claims: SlotClaim[] = [
    ...group.binds.map((line) => ({ at: line.item, fields: line.fields, key: line.item.key })),
    // Every anchor carries a non-empty `key` - that field is what made the line an anchor at all
    // (`claimsEntryAnchor`), so there is no keyless-anchor case to filter out here.
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
export function buildEntry(
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

  // No `entry-alias-duplicate` report here: two
  // same-named `alias` lines never reach one group, because every caller folds `alias` lines
  // last-definition-wins by name *before* calling this module (see that reason's own doc comment).
  // The one place the second body is actually discarded is that fold, and that is where the warning
  // is raised - `file-source.ts#discardedAliasWarnings`.

  // One claim, one slot, in claim order - see this function's doc comment for why there is no
  // conflict case left to handle.
  const slots = keySlotsFrom(group, warnings)

  const fields =
    group.aliases[0]?.fields ??
    group.binds[0]?.fields ??
    group.anchors[0]?.fields ??
    group.unbounds[0]!.fields
  const kind = inferKind(
    commands,
    fromAliases !== null,
    slots.length > 0,
    group.unbounds.length > 0,
  )

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
 * ## Why not simply the first alias line's prose
 *
 * The writer puts the entry's one display name on *every* line of its family, but each line pays for
 * its own code first, so a line with a long body carries a cut name - or, past `attachTaggedComment`'s
 * last resort, no name at all. The first alias line is very often exactly that line: a chunk-split
 * entry emits `<name>_p1` before its parent, and `_p1` is a line filled to the byte with commands
 * while the parent (`"<name>_p1; <name>_p2"`) and the bind line have room to spare. Reading the
 * entry's name off it would restore the *cut* spelling, and the next render would write that
 * shortened name onto the roomy lines as well - a file that differs from the one on disk with
 * nobody having touched it, which story 042's fixed point forbids.
 *
 * So the longest prose the group's lines carry wins, on one condition: every shorter alias-line
 * prose has to be what the writer would have put there for that longer name (`proseCutOf`, the same
 * exact reconstruction `twoPartProse` uses - not a prefix test). Lines that disagree for any other
 * reason (a hand-renamed comment) keep the first alias line's own prose, rather than
 * letting an unrelated bind-line comment rename the entry.
 *
 * A bind or anchor line's prose is compared by *length* only, since neither records a `codeWidth` to
 * reconstruct a cut from. That costs nothing here and risks nothing: unlike `twoPartProse`, this
 * function decides no merge - the group is already one entry, identified by name and tag - so the
 * only question left is which of its own lines spells its name most completely.
 */
export function entryProse(group: EntryGroup): string {
  // The answer whenever the group's lines disagree for a reason the budget does not explain.
  // `||`, not `??`: a line whose prose gave way to its tag entirely carries `''` and must fall
  // through (`??` only falls through for a *missing line*, so a nameless alias line would take the
  // name off the bind line beside it and turn it into the alias name instead).
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

/**
 * What `render.ts` would have written as this line's display prose if the entry's name were `full` -
 * `full` itself when it fits, the exact cut `fitProseAndTag` makes when it does not, and `''` when
 * the line's budget left no room for prose at all. `null` when the line does not record how wide its
 * code was, so the question cannot be answered rather than guessed at.
 *
 * ## Reconstructed, not estimated
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
 * what makes the comparison in `proseCutOf` a *proof* rather than a tolerance: accepting any
 * shorter prose that is a prefix of the longer one cannot tell a cut apart from three genuinely
 * different sibling names that happen to be prefixes of each other ("Slow", "Slow mo",
 * "Slow motion walk") - the merge-away-a-name defect `matchAnchor` also avoids.
 */
export function writtenProseFor(line: TaggedLine<RestoreAliasLine>, full: string): string | null {
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
export function proseCutOf(
  prose: string,
  full: string,
  line: TaggedLine<RestoreAliasLine>,
): boolean {
  const written = writtenProseFor(line, full)
  return written !== null && written.trim() === prose
}

/** One line's whole command text as an entry's commands - classified the same way an alias body's
 * segment is (so `say hi` comes back as a message, not as raw text), and an empty text as no
 * commands at all rather than as one empty command. */
export function soleCommand(text: string): ConfigCommand[] {
  const command = text.trim()
  return command.length > 0 ? [configCommandFor(command)] : []
}

/** An aliasless entry's commands: its bind line's command (see `soleCommand`). */
export function bindCommands(binds: readonly TaggedLine<RestoreBindLine>[]): ConfigCommand[] {
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
export function unboundCommands(unbounds: readonly UnboundEntryLine[]): ConfigCommand[] {
  return soleCommand(unbounds[0]?.command ?? '')
}

/**
 * The `aliasName` an entry with no alias line has to carry so that its bind value survives a
 * re-render: the bind command itself, when it is a single token and the entry would otherwise
 * mirror as something else. A continuous catalogue row (`+forward`, whose `bindValueFor` already
 * *is* its command) needs none and must not get one - an explicit `+forward` alias name would make
 * `actionsWithAliasLine` keep an `alias +forward +forward` line the original file never had.
 */
export function ownAliasNameFromBind(
  action: ConfigAction,
  binds: readonly TaggedLine<RestoreBindLine>[],
): string | null {
  const command = binds[0]?.item.command.trim() ?? ''
  if (command.length === 0 || /\s/.test(command)) return null
  return bindValueFor(action) === command ? null : command
}
