import type { AltLayer, AltLayerMode } from '@shared/config/aliases/alt-layers'
import { bindValueFor } from '@shared/config/aliases/action-mirror'
import { actionKeySlots, keySlotCount, withKeySlot } from '@shared/config/catalog/action-slots'
import { configCommandFor } from '@shared/config/aliases/alias-import'
import { splitTopLevelSemicolons, tokenize } from '@shared/config/syntax/command-tokenizer'
import { normalizeBindKey } from '@shared/config/syntax/key-names'
import type { ModifierTrigger } from '@shared/config/aliases/modifier-layers'
import type { ConfigAction } from '@shared/modules/config'
import {
  type RestoreSourcePosition,
  type RestoreAliasLine,
  type RestoreBindLine,
  type RestoreProfilePartsInput,
  type RestoreWarning,
  type Section,
  sectionEnd,
} from './types'
import { adoptableId } from './comment-parse'
import { MODIFIER_TRIGGERS, HELPER_SUFFIX } from './entry-build'

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** `Layer: <name> (<mode>, on <key>)` / `(… , no trigger key)` - `render.ts`'s own banner title. */
const LAYER_TITLE = /^Layer:\s*(.*)\s+\((hold|toggle),\s*(?:on\s+(.+)|no trigger key)\)$/

interface LayerSectionLines {
  /** Every `alias` line inside the section, by name. */
  bodies: Map<string, string>
  /** The section's own `bind <key> <command>` lines - the trigger bind. */
  triggerBinds: RestoreBindLine[]
}

/** The lines physically inside a layer section: from its header down to the next header. */
function linesInSection(
  section: Section,
  sections: readonly Section[],
  aliases: readonly RestoreAliasLine[],
  binds: readonly RestoreBindLine[],
): LayerSectionLines {
  const end = sectionEnd(sections, section)
  const inside = (position: RestoreSourcePosition): boolean =>
    position.file === section.file && position.line > section.line && position.line < end

  const bodies = new Map<string, string>()
  for (const alias of aliases) if (inside(alias)) bodies.set(alias.name, alias.body)
  return { bodies, triggerBinds: binds.filter(inside) }
}

/**
 * A layer's overrides, walked out of its apply half exactly as `generateLayerAliases` wrote them:
 * every top-level `bind <key> <command>` segment is an override, a bare token naming another alias
 * of the same section is a `_p<n>` chunk to follow, and a `_c<n>` helper's body is substituted back
 * in for the command it was hoisted out of. `unbind`/`bind`-to-base segments of the *restore* half
 * are never reached, because the walk starts at the apply half and only follows its own chunks.
 */
function collectOverrides(bodies: Map<string, string>, applyName: string): Record<string, string> {
  const overrides: Record<string, string> = {}
  const visited = new Set<string>()

  const resolveCommand = (command: string): string => {
    const body = HELPER_SUFFIX.test(command) ? bodies.get(command) : undefined
    return body ?? command
  }

  const visit = (name: string): void => {
    if (visited.has(name)) return
    visited.add(name)
    const body = bodies.get(name)
    if (body === undefined) return

    for (const segment of splitTopLevelSemicolons(body).map((part) => part.trim())) {
      if (segment.length === 0) continue
      const tokens = tokenize(segment)
      const head = tokens[0]?.toLowerCase() ?? ''
      if (head === 'bind' && tokens.length >= 3) {
        overrides[normalizeBindKey(tokens[1]!)] = resolveCommand(tokens.slice(2).join(' '))
        continue
      }
      if (tokens.length === 1 && bodies.has(tokens[0]!)) visit(tokens[0]!)
    }
  }

  visit(applyName)
  return overrides
}

/** The mode the section's alias names actually spell: a `+x`/`-x` pair is hold, `x_on`/`x_off` is
 * toggle. This is the config line's own answer, so it outranks a `mode` tag that disagrees. */
function modeFromAliases(names: readonly string[]): AltLayerMode | null {
  const hold =
    names.some((name) => name.startsWith('+')) && names.some((name) => name.startsWith('-'))
  if (hold) return 'hold'
  const toggle =
    names.some((name) => name.endsWith('_on')) && names.some((name) => name.endsWith('_off'))
  return toggle ? 'toggle' : null
}

/** The alias the trigger key runs, one hop through a toggle's dispatch alias. */
function applyHalfName(lines: LayerSectionLines, mode: AltLayerMode): string | null {
  const names = [...lines.bodies.keys()]
  const target = lines.triggerBinds[0]?.command.trim()
  if (target && lines.bodies.has(target)) {
    const body = lines.bodies.get(target)!.trim()
    if (mode === 'toggle' && lines.bodies.has(body)) return body
    return target
  }
  return (
    names.find((name) => (mode === 'hold' ? name.startsWith('+') : name.endsWith('_on'))) ?? null
  )
}

/**
 * One layer from its `[q2l layer=…]` section. `takenLayerIds` is the ids every layer built before
 * this one in the same restore got, so the tag's own id is adopted when it is well-formed and still
 * free and minted otherwise (story 079 D1, `adoptableId`) - a hand-duplicated layer tag yields two
 * layers, not one id twice.
 */
export function buildLayer(
  section: Section,
  sections: readonly Section[],
  input: RestoreProfilePartsInput,
  warnings: RestoreWarning[],
  takenLayerIds: Set<string>,
): AltLayer {
  const lines = linesInSection(section, sections, input.aliases, input.binds)
  const titleMatch = LAYER_TITLE.exec(section.title)

  const taggedMode =
    section.fields.mode === 'hold' || section.fields.mode === 'toggle' ? section.fields.mode : null
  const spelled = modeFromAliases([...lines.bodies.keys()])
  if (taggedMode !== null && spelled !== null && spelled !== taggedMode) {
    warnings.push({
      reason: 'layer-mode-contradicted',
      file: section.file,
      line: section.line,
      subject: section.fields.mode,
    })
  }
  const mode: AltLayerMode =
    spelled ?? taggedMode ?? (titleMatch?.[2] === 'toggle' ? 'toggle' : 'hold')

  // The section's own `bind <key> …` line is what really reaches this layer from the keyboard; the
  // `trigger` tag is the record of it. They only differ in a hand-edited file, and then the line
  // wins - a trigger the file does not actually bind is not a trigger.
  const boundTrigger = lines.triggerBinds[0] ? normalizeBindKey(lines.triggerBinds[0].key) : null
  const taggedTrigger = section.fields.trigger ? normalizeBindKey(section.fields.trigger) : null
  if (taggedTrigger !== null && boundTrigger !== null && taggedTrigger !== boundTrigger) {
    warnings.push({
      reason: 'layer-trigger-contradicted',
      file: section.file,
      line: section.line,
      subject: section.fields.trigger,
    })
  }

  const applyName = applyHalfName(lines, mode)

  return {
    id: adoptableId(section.fields.layer, takenLayerIds, input.newId),
    name: titleMatch?.[1]?.trim() ?? section.title,
    mode,
    triggerKey: boundTrigger ?? taggedTrigger,
    overrides: applyName === null ? {} : collectOverrides(lines.bodies, applyName),
  }
}

/** One override of one modifier-triggered layer, ready to be handed to an entry. */
interface ModifierOverride {
  modifier: ModifierTrigger
  /** Normalized override key. */
  key: string
  command: string
}

/**
 * Every modifier-triggered layer's overrides in **one stable order: modifier, then key**.
 *
 * Deliberately not `layers` array order (nor `Object.entries` insertion order). Following the array
 * would make the slot an override lands in depend on which layer came first, so two files that
 * differ only in the order their layer sections appear would restore the same entry with its slots
 * in a different order - silently, and invisibly to a fixed-point test, since both orderings
 * re-render as valid (just different) profiles.
 *
 * For an entry whose slots are all modifier-only there is nothing in the file that records which one
 * came first (a modifier slot has no bind line, and the layer's override body carries no
 * per-override tag), so this cannot always restore the original order. What it can do - and what
 * matters for "a wrong restore must not reassign a user's binds differently every time" - is be a
 * pure function of the file's own content: the same file always produces the same slot order. A slot
 * whose anchor line records its `key`/`mod` (`render.ts#buildAnchorLines`) never reaches this
 * fallback at all - `buildEntry` has already claimed it from that line, in file order.
 */
function modifierOverridesInStableOrder(layers: readonly AltLayer[]): ModifierOverride[] {
  const overrides: ModifierOverride[] = []
  for (const layer of layers) {
    const trigger = normalizeBindKey(layer.triggerKey ?? '')
    if (!MODIFIER_TRIGGERS.has(trigger)) continue
    for (const [key, command] of Object.entries(layer.overrides)) {
      overrides.push({
        modifier: trigger as ModifierTrigger,
        key: normalizeBindKey(key),
        command: command.trim(),
      })
    }
  }
  return overrides.sort((a, b) =>
    a.modifier !== b.modifier
      ? a.modifier < b.modifier
        ? -1
        : 1
      : a.key === b.key
        ? 0
        : a.key < b.key
          ? -1
          : 1,
  )
}

/** Does `action` already hold exactly this `(key, modifier)` slot in *any* of its slots - because an
 * anchor line's tag said so? Then the override that anchor stands for must not be handed out a
 * second time. Every slot, not just the first two: `keys` is uncapped, and `render.ts` writes
 * an anchor for every modified slot there is. */
function holdsModifiedSlot(action: ConfigAction, key: string, modifier: ModifierTrigger): boolean {
  return actionKeySlots(action).some(
    (slot) => normalizeBindKey(slot.key) === key && slot.modifier === modifier,
  )
}

/**
 * Story 016's modifier slots, read back out of the layers that carry them.
 *
 * A captured `Alt+R` is not a bind line anywhere - it is an override in the `ALT`-triggered layer,
 * written as `bindValueFor(action)`. Two passes over the same stably-ordered override list
 * (`modifierOverridesInStableOrder`):
 *
 * 1. **Commands.** An entry rebuilt from an anchor line alone (no alias line, no bind line - see
 *    `render.ts#buildAnchorLines`) already knows *which* slot it holds, from its tag, but has no
 *    command yet: the only place the file records what it does is the override itself. So the
 *    override's command becomes that entry's one command, which is exactly what the writer put
 *    there (`bindValueFor`) and therefore re-renders identically.
 * 2. **Slots.** Every other override whose value is an entry's own mirrored value **appends** a
 *    modified slot to that entry, matched by value the same way `applyActionLayerMirror`'s own strip
 *    pass recognises what it wrote. An override already accounted for by pass 1's anchor
 *    (`holdsModifiedSlot`) is skipped, so an anchored slot is never duplicated. Appending is why
 *    there is no `modifier-slot-unavailable` reason: `keys` is uncapped, so "the entry's slots
 *    are all taken" is not a state this can reach.
 *
 * The override stays on the layer either way: it is a derived mirror of this exact field, and the
 * next save would write it back identically.
 *
 * Replaces entries of `actions` in place - they were just constructed here and are not shared yet -
 * but never mutates a `ConfigAction` itself, so `withKeySlot`'s immutability contract holds.
 */
export function restoreModifierSlots(actions: ConfigAction[], layers: readonly AltLayer[]): void {
  const overrides = modifierOverridesInStableOrder(layers)

  for (const override of overrides) {
    if (override.command.length === 0) continue
    // `action.parts === undefined`: a `toggle`/`press-release` entry
    // keeps `commands: []` **by contract** - its real bodies live in `parts` - so "no command yet"
    // is not a statement about it at all. Without this guard the first modifier override whose
    // command matched fell straight into the branch below and wrote a raw command into a two-part
    // entry's `commands`, producing exactly the half-an-entry shape `ConfigAction.parts`' own doc
    // comment says the model must never hold (`modifiedSlotToggleProfile` is the reachable case: its
    // only slot is modified, so its key really does arrive on an anchor line). Such an entry needs
    // nothing from this pass anyway - its commands came off its own alias lines, and its slot off the
    // anchor - and pass 2 below already skips it through `holdsModifiedSlot`.
    const anchored = actions.findIndex(
      (action) =>
        action.parts === undefined &&
        action.commands.length === 0 &&
        holdsModifiedSlot(action, override.key, override.modifier),
    )
    if (anchored !== -1) {
      actions[anchored] = {
        ...actions[anchored]!,
        commands: [configCommandFor(override.command)],
      }
    }
  }

  for (const override of overrides) {
    // Known limitation, deliberately not fixed: the first action
    // whose mirrored value matches wins, with no check that an earlier override already claimed it -
    // ideally a matched override/action pair would leave the candidate pool. No profile this app can
    // write constructs two entries with the same `bindValueFor` (every writer is find-or-create on
    // `catalogId`, and a launcher-written file records every modified slot as an anchor line, which
    // is filled above and skipped below), so reaching it needs a hand-edited or foreign file.
    const index = actions.findIndex((action) => bindValueFor(action) === override.command)
    if (index === -1) continue
    const owner = actions[index]!
    if (owner.kind === 'alias') continue
    if (holdsModifiedSlot(owner, override.key, override.modifier)) continue
    actions[index] = withKeySlot(owner, keySlotCount(owner), {
      key: override.key,
      modifier: override.modifier,
    })
  }
}
