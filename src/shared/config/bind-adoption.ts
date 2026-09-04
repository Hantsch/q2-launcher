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
 *   modifier binding (a key slot's own `modifier`, i.e. ALT/CTRL/SHIFT - see
 *   `modifier-layers.ts`); an override inside a layer triggered by, say, `-`
 *   has no representation in `actions` at all.
 * - Mint an entry on an identity the profile already uses. An entry's identity in the file is the
 *   alias name it renders under (story 050), so a second entry claiming it would write a second
 *   `alias <same name>` line and come back as one entry on the next read. Such a raw entry either
 *   joins the entry that owns the identity - when it runs exactly its commands - or stays raw
 *   (`identityOwnerIndex`).
 * - Change what a key does. Adoption is a re-encoding, never a re-binding: a
 *   raw entry is only adopted when the row it resolves to would render exactly
 *   the commands that entry already runs; an existing action whose commands
 *   differ is left exactly as it was, and a raw entry on a key the row does
 *   not yet hold gets its own new slot appended (story 050 - no longer capped
 *   at two) rather than being rejected.
 *
 * Pure by contract, `newId` is the caller's id factory (same idiom as
 * `applyActionLayerMirror`): no node, no DOM, no electron.
 */

import type { AltLayer } from '@shared/config/alt-layers'
import { actionKeySlots, keySlotCount, withKeySlot } from '@shared/config/action-slots'
import { aliasNameFor } from '@shared/config/alias-render'
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
      command.kind === 'message'
        ? `${command.channel} ${command.text}`
        : command.kind === 'wait'
          ? Array(Math.max(0, command.frames)).fill('wait').join('; ')
          : command.text,
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
    keys: [{ key, ...(modifier ? { modifier } : {}) }],
  }
}

/**
 * Index of the entry that already renders under the identity a freshly minted action for `match`
 * would take - its alias name, or the value a mirror pass writes for it (`bindValueFor`) - or
 * `-1` when that identity is free.
 *
 * Consulted before minting, because since story 050 that identity *is* the entry's identity in the
 * file: the reader groups an alias line by its own name and a bind line by its bind value
 * (`profile-restore.ts#groupEntryLines`), so two entries rendering under one name are one entry
 * again on the next read - and the file they render to holds two `alias <same name> …` lines, of
 * which the engine keeps exactly one. Matching by `catalogId` alone could not see that: an entry
 * the user assembled by hand carries no `cid`, and its display name may slug to the very alias
 * name the row's own command text does ("Drop rockets" and `drop rockets` both give
 * `drop_rockets` - the `holdLayerProfile` fixture's shape, where a `drop rockets` override in the
 * ALT layer used to mint a second, identically-named entry and cost the hand-made one its display
 * name on the next read).
 *
 * Finding an owner is not by itself permission to adopt into it - the caller still applies the
 * same-commands rule - but it does forbid minting: a second entry on a taken identity is a lost
 * entry, so the raw line stays raw instead.
 *
 * The identity is probed off `materialise` itself rather than re-derived here, so this can never
 * drift from what would actually be minted; neither name depends on the probe's id or slot.
 */
function identityOwnerIndex(actions: readonly ConfigAction[], match: CatalogMatch): number {
  const minted = materialise(match.row, match.withAmmo, '', undefined, () => '')
  const aliasName = aliasNameFor(minted)
  const value = bindValueFor(minted)
  return actions.findIndex(
    (action) => aliasNameFor(action) === aliasName || bindValueFor(action) === value,
  )
}

/** Does `action` already carry `(key, modifier)` in one of its slots? */
function alreadyHolds(
  action: ConfigAction,
  normalizedKey: string,
  modifier: ModifierTrigger | undefined,
): boolean {
  return actionKeySlots(action).some(
    (slot) => slot.key.trim() && normalizeBindKey(slot.key) === normalizedKey && slot.modifier === modifier,
  )
}

/**
 * Write `(key, modifier)` into `action`'s first free slot, or the next new slot when
 * every existing one is taken - story 050 removed the two-slot cap, so adoption now
 * appends rather than leaving a third raw bind on the same command unadopted.
 */
function withSlot(
  action: ConfigAction,
  key: string,
  modifier: ModifierTrigger | undefined,
): ConfigAction {
  const slots = actionKeySlots(action)
  const emptyIndex = slots.findIndex((slot) => !slot.key.trim())
  const index = emptyIndex >= 0 ? emptyIndex : keySlotCount(action)
  return withKeySlot(action, index, { key, ...(modifier ? { modifier } : {}) })
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
 * Is `value` the alias name some action in the profile renders under - a
 * reference to that alias, not a command of its own?
 *
 * Unscoped by key, unlike `mirrorsSlot`: a bind can call another action's
 * alias from any key, not just the one that alias's own action holds (that is
 * exactly what a user's hand-typed `bind y "weapnext_ready"` referencing a
 * `kind: 'alias'` entry looks like). Story 039 dropped the `q2l_a_` prefix
 * test that used to catch this (a name may now be a short readable word),
 * which is also what surfaces the `weapnext` case: a catalogue row can render
 * the single-token command `weapnext`, and an action can just as legally be
 * named (or `aliasName`-d) `weapnext`. Checking alias names first is what
 * tells "this value calls that alias" apart from "this value is that
 * catalogue row's own command" before the catalogue lookup ever runs, so the
 * alias reference is left alone instead of being re-adopted as the row.
 */
function isAliasReference(actions: readonly ConfigAction[], value: string): boolean {
  return actions.some((action) => aliasNameFor(action) === value)
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
  // A reference to some action's alias, or already this slot's own mirrored value - either way
  // nothing to adopt.
  if (isAliasReference(state.actions, trimmed)) return null
  if (mirrorsSlot(state.actions, key, modifier, trimmed)) return null

  const match = index.get(signature([trimmed]))
  if (!match) return null

  const normalizedKey = normalizeBindKey(key)
  const byCatalogId = state.actions.findIndex((action) => action.catalogId === match.row.catalogId)
  // No action carries the row yet - but before minting one, look for the entry that already
  // renders under the identity the fresh one would take (`identityOwnerIndex`).
  const existingIndex = byCatalogId >= 0 ? byCatalogId : identityOwnerIndex(state.actions, match)

  if (existingIndex < 0) {
    const created = materialise(match.row, match.withAmmo, normalizedKey, modifier, newId)
    state.actions = [...state.actions, created]
    return bindValueFor(created)
  }

  const existing = state.actions[existingIndex]!
  // An entry that only *shares* the identity has to be a legal mirror target as well: a
  // `kind: 'alias'` entry renders under its own name and is never mirrored into a bind or an
  // override at all (story 019), so it cannot take this slot - and minting next to it would still
  // duplicate its name. Leave the raw entry raw; the Overview board keeps showing it.
  if (byCatalogId < 0 && existing.kind === 'alias') return null
  // The action is the authority on what the row runs (its ammo choice, its
  // message). An entry whose commands differ from it is a *different*
  // instruction that happens to resolve to the same row, so re-encoding it
  // would change what the key does - out of bounds for adoption.
  if (actionSignature(existing) !== signature([trimmed])) return null
  if (alreadyHolds(existing, normalizedKey, modifier)) return bindValueFor(existing)

  const updated = withSlot(existing, normalizedKey, modifier)
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
