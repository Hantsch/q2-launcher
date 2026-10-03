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
 * One entry's alias line(s) folded back into the single body they were split out of: a body too long
 * for one line was split into `<name>_p<n>` chunks called by a parent, and the split happens only at
 * command boundaries, so recombining is concatenation in `_p<n>` order. Shared by
 * `commandsFromAliases` and `recognizeTwoPartGroups`, whose recogniser does not see through chunks.
 *
 * `chunkBodies` keeps the bodies apart because a chunk boundary is a command boundary the file
 * records: two adjacent `wait` commands can straddle one, and once joined `collapseWaitRuns` could
 * not tell them from one longer wait (`wait(3)` + `wait(2)` as `wait(5)`), moving the boundary on
 * the next render and breaking the fixed point.
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
 * An entry's commands, in body order, out of the alias line(s) that define it. `collapseWaitRuns`
 * turns the literal `wait` segments back into a `{ kind: 'wait' }` command - the writer's inverse,
 * shared with `alias-import.ts` so "how many literal waits are one command" has one answer. Run per
 * chunk body, not over the fold: a wait run ending one chunk and one opening the next are two commands.
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
 * One body's worth of segments as `ConfigCommand`s - the single pipeline every restored command list
 * goes through, whole-body or per-half (`alias-import.ts#commandsForHalf` is its import-side twin).
 */
export function commandsFromSegments(segments: readonly string[]): ConfigCommand[] {
  return collapseWaitRuns(segments.map(configCommandFor))
}

/**
 * The entry's `kind`, inferred - the tag carries no `k`, since a second source could only drift.
 * A single `say`/`say_team` body makes it a message (`entryKindFor`, the untagged path's table).
 * `bound` counts every slot claim, anchors included: an entry bound only through a modifier layer
 * has its key on an anchor line (`render.ts#buildAnchorLines`).
 *
 * ## `hasUnboundLine` outranks the alias line (story 063)
 *
 * An alias line records what an entry runs, not whether its key slot is filled, so alone it cannot
 * tell a never-bound `kind: 'alias'` entry from a `bind`/`message` entry with an empty slot (a
 * grenade row seeded with a body and no key); reading both as `'alias'` would lose the bind slot
 * permanently. `render.ts#isUnboundEntry` therefore writes a commented-out `//bind` even with an
 * alias line, so an unbound line means a keyed kind with an empty slot.
 *
 * - A never-bound `alias gg "say gg"` stays an alias, not promoted to `'message'`: promoting would
 *   grow an unbound line the original never had and break the fixed point.
 * - A file written without that line for a keyless bodied `bind` entry reads back as `'alias'`:
 *   nothing recovers a fact the file never recorded; the first save writes it.
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
 * The key slots `group`'s own lines claim, in file order, bind lines before anchor lines (see
 * `buildEntry` for why claims simply append).
 *
 * Its own function so a merged `toggle`/`press-release` entry reads its slots by the same rule,
 * including the `tag-modifier-unknown` report, which must fire once per claim whichever entry shape
 * the group becomes.
 */
export function keySlotsFrom(group: EntryGroup, warnings: RestoreWarning[]): ActionKeySlot[] {
  const claims: SlotClaim[] = [
    ...group.binds.map((line) => ({ at: line.item, fields: line.fields, key: line.item.key })),
    // Every anchor carries a non-empty `key` - that is what made it an anchor
    // (`claimsEntryAnchor`) - so there is no keyless anchor to filter out.
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
 * **Slot claims append in file order, uncapped**: bind lines first (observable config lines), then
 * anchors (which only record a slot the bind table has no line for). "Slot already taken" and "no
 * free slot" are unreachable: a hand-added third `bind` becomes slot 3. Consequence: an entry whose
 * modified slot came first in the UI comes back swapped, though keys and modifiers survive and the
 * file re-renders byte-identically.
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

  // No `entry-alias-duplicate` report here: two same-named `alias` lines never reach one group,
  // because every caller folds them last-wins before calling this module. The second body is
  // discarded in that fold, which raises the warning (`file-source.ts#discardedAliasWarnings`).

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

  // Both levels come off the one section the line sits under: `idFor` resolves a sub-category banner
  // to its parent category and `subcategoryIdFor` is set only for such sections, so an entry in a
  // category's ungrouped run keeps its shape.
  const subcategoryId = categories.subcategoryIdFor(section)

  const base: ConfigAction = {
    id: newId(),
    categoryId: categories.idFor(section),
    ...(subcategoryId ? { subcategoryId } : {}),
    name: prose.length > 0 ? prose : (fromAliases?.aliasName ?? slots[0]?.key ?? group.key),
    kind,
    // A body's own order is the command order. With no alias line (a continuous catalogue row bound
    // to its bare `+command`, or a self-mirroring alias the writer drops) the bind line's command is
    // the entry's one command; with no bind line either, the unbound line's commented-out body
    // records it, down to the empty `""` of an entry that has none.
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

  // Through the accessor: `action-slots.ts` is the single access point for `keys`, and appending at
  // `index === keySlotCount` is its documented "next free slot" call.
  const action = slots.reduce((carried, slot, index) => withKeySlot(carried, index, slot), base)

  // The alias line's own name is the entry's `aliasName`. Without one, in order: (1) an anchor or
  // unbound line's `an` field - the only place the writer records it; restored only where present,
  // else it would grow an alias line; (2) the bind value, adopted exactly when the entry would
  // otherwise mirror as something else, so a dropped self-mirroring alias (`alias weapnext
  // weapnext`) does not return as a differently-named alias line.
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
 * The entry's display name as its own lines record it - the least-cut spelling any still carries.
 * Also the identity test of a two-part merge (`twoPartMergeFor`): lines disagreeing about prose are
 * separate entries.
 *
 * Not the first alias line's prose: each line pays for its own code first, so a chunk-split entry's
 * `<name>_p1`, filled to the byte, carries a cut name while the parent has room; restoring the cut
 * spelling would shorten the roomy lines on the next render. So the longest prose wins, provided
 * every shorter alias-line prose is what the writer would have put there for it (`proseCutOf`, not a
 * prefix test). Other disagreement (a hand-renamed comment) keeps the first alias line's prose.
 *
 * Bind and anchor prose is compared by length only (no `codeWidth`): that is safe because this
 * decides no merge, only which line spells the name most completely.
 */
export function entryProse(group: EntryGroup): string {
  // The answer whenever the lines disagree for a reason the budget does not explain. `||`, not `??`:
  // a line whose prose gave way to its tag carries `''` and must fall through, or a nameless alias
  // line would take the bind line's name and turn it into the alias name.
  const fallback =
    group.aliases[0]?.prose.trim() ||
    group.binds.find((line) => line.prose.trim().length > 0)?.prose.trim() ||
    group.anchors.find((line) => line.prose.trim().length > 0)?.prose.trim() ||
    // An unbound group has this line and nothing else; `prose` is already the display half alone,
    // `unboundLineParts` having split the commented-out `bind` off.
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
 * What `render.ts` would have written as this line's display prose if the entry's name were `full`:
 * `full` when it fits, the exact cut `fitProseAndTag` makes when not, `''` when the budget left no
 * room, `null` when the line does not record its code width (unanswerable, not guessed).
 *
 * Reconstructed, not estimated: `attachTaggedComment` composes `<code>  // <prose> <tag>` inside
 * `COMMENT_LINE_BUDGET` and cuts the prose, never the tag. Budget, separator and tag are knowable;
 * the code width is not derivable (alignment padding, quoting), so the parser measures it
 * (`codeWidth`). Calling the function that made the cut makes `proseCutOf` a proof, not a
 * tolerance: accepting any shorter prefix could not tell a cut from sibling names ("Slow", "Slow mo").
 */
export function writtenProseFor(line: TaggedLine<RestoreAliasLine>, full: string): string | null {
  const codeWidth = line.item.codeWidth
  if (codeWidth === undefined) return null

  // `comment` is the raw text after the `//` marker, so the tag is its literal tail from the last
  // sigil - the anchor `parseComment` reads the tag off.
  const sigil = line.item.comment.lastIndexOf(TAG_SIGIL)
  const tag = sigil === -1 ? '' : line.item.comment.slice(sigil).trimEnd()

  // `codeWidth` counts the code plus two spaces before the marker; `attachTaggedComment`'s prefix is
  // those two spaces plus `// `, one character more than the marker itself.
  const prefix = codeWidth + COMMENT_PREFIX.length - 2
  if (prefix >= COMMENT_LINE_BUDGET) return ''

  const written = fitProseAndTag(full, tag, COMMENT_LINE_BUDGET - prefix)
  if (tag.length === 0) return written
  if (written === tag) return ''
  return written.endsWith(` ${tag}`) ? written.slice(0, -(tag.length + 1)) : written
}

/**
 * Is `prose` what this line would carry if the entry's name were `full` - the whole name when it had
 * room, or the exact cut its budget forced? Answered by re-running the writer (`writtenProseFor`),
 * not a prefix test. `false` when the line lacks the evidence (no `codeWidth`): a caller that cannot
 * prove a cut keeps the names apart, which loses nothing.
 */
export function proseCutOf(
  prose: string,
  full: string,
  line: TaggedLine<RestoreAliasLine>,
): boolean {
  const written = writtenProseFor(line, full)
  return written !== null && written.trim() === prose
}

/** One line's whole command text as an entry's commands - classified like an alias body segment (so
 * `say hi` comes back as a message, not raw text), and empty text as no commands rather than one
 * empty command. */
export function soleCommand(text: string): ConfigCommand[] {
  const command = text.trim()
  return command.length > 0 ? [configCommandFor(command)] : []
}

/** An aliasless entry's commands: its bind line's command (see `soleCommand`). */
export function bindCommands(binds: readonly TaggedLine<RestoreBindLine>[]): ConfigCommand[] {
  return soleCommand(binds[0]?.item.command ?? '')
}

/**
 * An unbound entry's commands: the body of its commented-out `bind` line, read as a bind line's
 * command is - the inverse of `render.ts#unboundCommand`. `//bind ""` restores `[]`, which is most
 * of `STANDARD_TEMPLATE`'s seeded rows.
 */
export function unboundCommands(unbounds: readonly UnboundEntryLine[]): ConfigCommand[] {
  return soleCommand(unbounds[0]?.command ?? '')
}

/**
 * The `aliasName` an entry with no alias line must carry for its bind value to survive a re-render:
 * the bind command itself, when it is a single token and the entry would otherwise mirror as
 * something else. A continuous catalogue row (`+forward`, whose `bindValueFor` already is its
 * command) needs none: an explicit `+forward` alias name would make `actionsWithAliasLine` keep an
 * `alias +forward +forward` line the original file never had.
 */
export function ownAliasNameFromBind(
  action: ConfigAction,
  binds: readonly TaggedLine<RestoreBindLine>[],
): string | null {
  const command = binds[0]?.item.command.trim() ?? ''
  if (command.length === 0 || /\s/.test(command)) return null
  return bindValueFor(action) === command ? null : command
}
