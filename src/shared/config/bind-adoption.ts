/**
 * Raw binds -> catalogue actions (story 034).
 *
 * Before this story a profile had two disjoint editing surfaces with two
 * disjoint storages: the Overview keyboard wrote command text straight into
 * `profile.binds` (and into a layer's own `overrides`), while the Controls grid
 * read only `profile.actions`. Nothing ever converted the former into the
 * latter, so a hand-bound - or, worse, *imported* - `bind w "+forward"` showed
 * up on the keyboard and left the Movement row reading "empty". Same board,
 * same profile, two answers.
 *
 * `adoptRawBinds` closes that by making `actions` the single authority: every
 * raw entry whose command text is one a catalogue row renders is turned into
 * that row's `ConfigAction` (`catalogId` and all), and the entry it came from
 * is rewritten to the value the mirror would have written for it
 * (`bindValueFor`, `action-mirror.ts`). Run it on every read and every write
 * and "the keyboard shows something Controls does not" stops being a reachable
 * state.
 *
 * What it deliberately does NOT do:
 *
 * - Invent a row for a command no catalogue row renders (`+use`, `kill`, a
 *   chained macro). Those stay raw binds, visible on the Overview board only -
 *   Controls has no category that could hold them.
 * - Touch a non-modifier layer's overrides. A `ConfigAction` can only express a
 *   modifier binding (`keyModifier`, i.e. ALT/CTRL/SHIFT - see
 *   `modifier-layers.ts`); an override inside a layer triggered by, say, `-`
 *   has no representation in `actions` at all.
 * - Change what a key does. Adoption is a re-encoding, never a re-binding: a
 *   raw entry is only adopted when the row it resolves to would render exactly
 *   the commands that entry already runs, and an entry that cannot be adopted
 *   losslessly (a full row - both slots taken; an existing action whose
 *   commands differ) is left exactly as it was.
 *
 * Pure by contract, `newId` is the caller's id factory (same idiom as
 * `applyActionLayerMirror`): no node, no DOM, no electron.
 */

import type { AltLayer } from '@shared/config/alt-layers'
import { ACTION_ALIAS_PREFIX } from '@shared/config/alias-render'
import { bindValueFor } from '@shared/config/action-mirror'
import { allCatalogRows, commandsForRow, type CatalogRow } from '@shared/config/catalog-rows'
import { normalizeBindKey } from '@shared/config/key-names'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import type { ConfigAction, ConfigCommand } from '@shared/modules/config'

export interface AdoptableProfile {
  binds: Record<string, string>
  layers?: AltLayer[]
  actions?: ConfigAction[]
}

export interface AdoptionResult {
  binds: Record<string, string>
  layers: AltLayer[]
  actions: ConfigAction[]
  /** How many raw entries became (or joined) a catalogue action - `0` means nothing changed and
   * every returned reference is the input's own. */
  adopted: number
}

/** A command list as one comparable signature: `;`-separated, trimmed, lower-cased. Engine
 * commands are case-insensitive and the catalogue spells them lower-case, so comparing
 * case-insensitively is the engine's own rule, not a convenience. */
function signature(commands: string[]): string {
  return commands
    .flatMap((command) => command.split(';'))
    .map((step) => step.trim().toLowerCase())
    .filter((step) => step.length > 0)
    .join('; ')
}

function actionSignature(action: ConfigAction): string {
  return signature(
    action.commands.map((command: ConfigCommand) =>
      command.kind === 'message' ? `${command.channel} ${command.text}` : command.text,
    ),
  )
}

interface CatalogMatch {
  row: CatalogRow
  withAmmo: boolean
}

/**
 * Command signature -> the row that renders it. Built once per call from
 * `allCatalogRows()`, so the "first row wins" rule is the flat list's own order
 * (see its doc comment): `drop grenades` resolves to `dropWeapon:grenades`
 * rather than `dropAmmo:hgrenades`, deterministically, and a row with an ammo
 * command registers both its with-ammo and its without-ammo form.
 */
function buildCatalogIndex(): Map<string, CatalogMatch> {
  const index = new Map<string, CatalogMatch>()
  const register = (key: string, match: CatalogMatch): void => {
    if (!index.has(key)) index.set(key, match)
  }
  for (const row of allCatalogRows()) {
    register(signature(row.commands), { row, withAmmo: false })
    if (row.ammoCommand) register(signature([...row.commands, row.ammoCommand]), { row, withAmmo: true })
  }
  return index
}

/** A fresh action for `row`, carrying exactly the slot that is being adopted. */
function materialise(
  row: CatalogRow,
  withAmmo: boolean,
  key: string,
  modifier: ModifierTrigger | undefined,
  newId: () => string,
): ConfigAction {
  return {
    id: newId(),
    categoryId: row.categoryId,
    // Plain, non-translated, stable text - the row's own raw command, exactly what the
    // renderer's own materialisation (`catalog-binds.ts`'s `nameForRow`) uses, so an adopted row
    // and a row bound in the Controls grid are indistinguishable afterwards.
    name: row.commands[0] ?? row.catalogId,
    kind: 'bind',
    catalogId: row.catalogId,
    commands: commandsForRow(row, withAmmo),
    key,
    ...(modifier ? { keyModifier: modifier } : {}),
  }
}

/** Does `action` already carry `(key, modifier)` in one of its two slots? */
function alreadyHolds(
  action: ConfigAction,
  normalizedKey: string,
  modifier: ModifierTrigger | undefined,
): boolean {
  const primary =
    action.key && normalizeBindKey(action.key) === normalizedKey && action.keyModifier === modifier
  const secondary =
    action.secondaryKey &&
    normalizeBindKey(action.secondaryKey) === normalizedKey &&
    action.secondaryKeyModifier === modifier
  return Boolean(primary || secondary)
}

/**
 * Write `(key, modifier)` into `action`'s first free slot, or return `null` when
 * both are taken - a row holds at most two keys (story 015 decision 1), so a
 * third raw bind on the same command stays raw rather than silently replacing
 * one of them.
 */
function withSlot(
  action: ConfigAction,
  key: string,
  modifier: ModifierTrigger | undefined,
): ConfigAction | null {
  if (!action.key?.trim()) {
    return { ...action, key, keyModifier: modifier }
  }
  if (!action.secondaryKey?.trim()) {
    return { ...action, secondaryKey: key, secondaryKeyModifier: modifier }
  }
  return null
}

/** The modifier a layer stands for, or `undefined` when its trigger is not one of the three
 * (`modifier-layers.ts`'s own rule: a layer is matched by normalized `triggerKey`, never by
 * name). */
function modifierForLayer(layer: AltLayer): ModifierTrigger | undefined {
  const normalized = normalizeBindKey(layer.triggerKey ?? '')
  return normalized === 'ALT' || normalized === 'CTRL' || normalized === 'SHIFT' ? normalized : undefined
}

/**
 * Is this exact entry - `(key, modifier)` carrying `value` - already some
 * action's own mirror?
 *
 * Key-scoped on purpose, and that scoping is the whole point: since story 034 a
 * continuous catalogue row mirrors as its own `+command` (`bindValueFor`), so a
 * value-only test could not tell "this is the mirror of the action that holds
 * this key" from "a second key running the same command". The first must be
 * skipped (there is nothing to adopt), the second must be adopted into the
 * row's free Secondary slot - which is exactly how `+moveup` on both SPACE and
 * MOUSE2 ends up as one row with two keys instead of one row and one orphan.
 */
function mirrorsSlot(
  actions: readonly ConfigAction[],
  key: string,
  modifier: ModifierTrigger | undefined,
  value: string,
): boolean {
  const normalizedKey = normalizeBindKey(key)
  return actions.some(
    (action) => alreadyHolds(action, normalizedKey, modifier) && bindValueFor(action) === value,
  )
}

/**
 * One raw entry's worth of work, shared by the base-binds and the
 * layer-overrides pass: resolve the command, find or create the row's action,
 * claim a slot. Returns the value the entry should now carry, or `null` to leave
 * it exactly as it is.
 */
function adoptEntry(
  state: { actions: ConfigAction[] },
  index: Map<string, CatalogMatch>,
  key: string,
  command: string,
  modifier: ModifierTrigger | undefined,
  newId: () => string,
): string | null {
  const trimmed = command.trim()
  if (trimmed.length === 0) return null
  // Already a mirrored value - this entry *is* an action's, nothing to adopt.
  if (trimmed.startsWith(ACTION_ALIAS_PREFIX)) return null
  if (mirrorsSlot(state.actions, key, modifier, trimmed)) return null

  const match = index.get(signature([trimmed]))
  if (!match) return null

  const normalizedKey = normalizeBindKey(key)
  const existingIndex = state.actions.findIndex((action) => action.catalogId === match.row.catalogId)

  if (existingIndex < 0) {
    const created = materialise(match.row, match.withAmmo, normalizedKey, modifier, newId)
    state.actions = [...state.actions, created]
    return bindValueFor(created)
  }

  const existing = state.actions[existingIndex]!
  // The action is the authority on what the row runs (its ammo choice, its
  // message). An entry whose commands differ from it is a *different*
  // instruction that happens to resolve to the same row, so re-encoding it
  // would change what the key does - out of bounds for adoption.
  if (actionSignature(existing) !== signature([trimmed])) return null
  if (alreadyHolds(existing, normalizedKey, modifier)) return bindValueFor(existing)

  const updated = withSlot(existing, normalizedKey, modifier)
  if (!updated) return null
  state.actions = state.actions.map((action, i) => (i === existingIndex ? updated : action))
  return bindValueFor(updated)
}

/**
 * Adopt every adoptable raw entry in `profile`, base binds first (sorted by
 * key, so which key of a two-key row lands in the Primary slot is deterministic
 * rather than a function of `state.json`'s insertion order), then each modifier
 * layer's overrides in layer order.
 *
 * Idempotent: a second call finds every previously adopted entry already
 * carrying a mirrored value and returns its input untouched, references and all.
 */
export function adoptRawBinds(profile: AdoptableProfile, newId: () => string): AdoptionResult {
  const index = buildCatalogIndex()
  const state = { actions: [...(profile.actions ?? [])] }
  let adopted = 0

  const nextBinds: Record<string, string> = { ...profile.binds }
  for (const key of Object.keys(profile.binds).sort()) {
    const value = adoptEntry(state, index, key, profile.binds[key]!, undefined, newId)
    if (value === null) continue
    delete nextBinds[key]
    nextBinds[normalizeBindKey(key)] = value
    adopted += 1
  }

  const layers = profile.layers ?? []
  const nextLayers = layers.map((layer) => {
    const modifier = modifierForLayer(layer)
    if (!modifier) return layer

    let changed = false
    const overrides: Record<string, string> = { ...layer.overrides }
    for (const key of Object.keys(layer.overrides).sort()) {
      const value = adoptEntry(state, index, key, layer.overrides[key]!, modifier, newId)
      if (value === null) continue
      delete overrides[key]
      overrides[normalizeBindKey(key)] = value
      changed = true
      adopted += 1
    }
    return changed ? { ...layer, overrides } : layer
  })

  if (adopted === 0) {
    return { binds: profile.binds, layers, actions: profile.actions ?? [], adopted: 0 }
  }
  return { binds: nextBinds, layers: nextLayers, actions: state.actions, adopted }
}
