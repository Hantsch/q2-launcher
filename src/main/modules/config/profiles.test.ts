import { randomUUID } from 'node:crypto'
import { bindValueFor } from '@shared/config/action-mirror'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  STANDARD_TEMPLATE,
  TEMPLATE_ACTION_CATEGORIES,
  type ConfigAction,
  type ConfigActionCategory,
} from '@shared/modules/config'
import { allCatalogRows } from '@shared/config/catalog-rows'
import type { AltLayer } from '@shared/config/alt-layers'
import { StateStore } from '../../services/state'
import { aliasNameFor } from '@shared/config/alias-render'
import { captureBaseline } from '@shared/config/profile-baseline'
import { keySlotAt } from '@shared/config/action-slots'
import { diffProfileAgainstBaseline } from '@shared/config/profile-diff'
import { ProfilesStore } from './profiles'
import { renderProfileFile } from './render'
import {
  setProfileActionsInputSchema,
  setProfileBindsInputSchema,
  setProfileLayersInputSchema,
} from './schemas'

/**
 * One rendered bind/alias line stripped back to the bare command: story 040 D3's trailing
 * `// <label>` comment removed and its column padding collapsed to a single space. Same helper,
 * same reasoning, as `render.test.ts`'s own copy - the assertions in this file are about what
 * `setActions`/`setLayers` make the writer emit, not about the writer's column widths, which
 * `render.test.ts` pins verbatim.
 */
function unformat(line: string): string {
  return line.replace(/\s{2,}\/\/ .*$/, '').replace(/\s{2,}/g, ' ')
}

describe('ProfilesStore', () => {
  let filePath: string
  let state: StateStore
  let profiles: ProfilesStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-config-profiles-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
    profiles = new ProfilesStore(state)
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('starts empty', () => {
    expect(profiles.list()).toEqual([])
  })

  it('creates an empty profile', () => {
    const result = profiles.create({ name: 'My Profile', from: 'empty' })

    expect(result).toHaveLength(1)
    const created = result[0]!
    expect(created.name).toBe('My Profile')
    expect(created.cvars).toEqual({})
    expect(created.binds).toEqual({})
    expect(created.id).toBeTruthy()
    expect(created.createdAt).toBe(created.updatedAt)
  })

  // Story 052 D1: "Creating an empty profile seeds no categories" (AC4).
  it('creates an empty profile with neither categories nor actions', () => {
    const [created] = profiles.create({ name: 'My Profile', from: 'empty' })

    expect(created!.categories ?? []).toEqual([])
    expect(created!.actions ?? []).toEqual([])
  })

  it('creates a profile from the standard template', () => {
    const result = profiles.create({ name: 'Vanilla', from: 'template' })

    const created = result[0]!
    expect(created.cvars).toEqual(STANDARD_TEMPLATE.cvars)
    expect(created.binds).toEqual(STANDARD_TEMPLATE.binds)
    // Copied, not aliased: mutating the profile must never touch the shared template.
    created.cvars['sensitivity'] = '10'
    expect(STANDARD_TEMPLATE.cvars['sensitivity']).not.toBe('10')
  })

  // Story 052 D1 (AC4): "a template profile has the three categories with every catalogue row
  // (unbound except the template's own 6 binds)".
  it('creates a profile from the standard template with the three categories and every catalogue row', () => {
    const [created] = profiles.create({ name: 'Vanilla', from: 'template' })

    expect(created!.categories).toHaveLength(3)
    expect(created!.categories!.map((c) => c.id).sort()).toEqual(['drops', 'movement', 'weapons'])
    for (const category of created!.categories!) {
      const template = TEMPLATE_ACTION_CATEGORIES.find((t) => t.id === category.id)!
      expect(category.name).toBe(template.label)
      expect(category.nameKey).toBe(template.labelKey)
    }

    const allRows = allCatalogRows()
    expect(created!.actions).toHaveLength(allRows.length)
    // Every action id is fresh, not the shared template's own static id, and unique per profile.
    const ids = new Set(created!.actions!.map((a) => a.id))
    expect(ids.size).toBe(created!.actions!.length)
    for (const action of created!.actions!) {
      expect(action.id.startsWith('template:')).toBe(false)
    }

    // The template's own 6 binds keep their commands; every other catalogue row is unbound.
    const boundCommands = new Set(Object.values(STANDARD_TEMPLATE.binds))
    const boundActions = created!.actions!.filter((a) => a.commands.length > 0)
    expect(boundActions).toHaveLength(6)
    for (const action of boundActions) {
      const command = action.commands[0]!
      expect(command.kind).toBe('raw')
      expect(boundCommands.has(command.kind === 'raw' ? command.text : '')).toBe(true)
    }
    const unboundActions = created!.actions!.filter((a) => a.commands.length === 0)
    expect(unboundActions).toHaveLength(allRows.length - 6)

    // Copied, not aliased: mutating the created profile must never touch the shared template.
    created!.categories![0]!.name = 'Mutated'
    expect(STANDARD_TEMPLATE.categories[0]!.name).not.toBe('Mutated')
    created!.actions![0]!.name = 'Mutated'
    expect(STANDARD_TEMPLATE.actions[0]!.name).not.toBe('Mutated')
  })

  it('allows duplicate names', () => {
    profiles.create({ name: 'Same', from: 'empty' })
    const result = profiles.create({ name: 'Same', from: 'empty' })

    expect(result).toHaveLength(2)
    expect(result[0]!.id).not.toBe(result[1]!.id)
  })

  it('renames a profile, touching only name and updatedAt', () => {
    const [created] = profiles.create({ name: 'Original', from: 'empty' })

    const result = profiles.rename({ id: created!.id, name: 'Renamed' })

    const renamed = result.find((p) => p.id === created!.id)!
    expect(renamed.name).toBe('Renamed')
    expect(renamed.id).toBe(created!.id)
    expect(renamed.createdAt).toBe(created!.createdAt)
    expect(renamed.cvars).toEqual(created!.cvars)
    expect(renamed.binds).toEqual(created!.binds)
  })

  it('throws when renaming an unknown id', () => {
    expect(() => profiles.rename({ id: 'missing', name: 'X' })).toThrow()
  })

  it('removes a profile', () => {
    const [created] = profiles.create({ name: 'ToRemove', from: 'empty' })

    const result = profiles.remove({ id: created!.id })

    expect(result).toEqual([])
  })

  it('throws when removing an unknown id', () => {
    expect(() => profiles.remove({ id: 'missing' })).toThrow()
  })

  it('removing an assigned profile drops its assignments with it (Decision 3)', () => {
    const [a] = profiles.create({ name: 'ToRemove', from: 'empty' })
    const [, b] = profiles.create({ name: 'Keep', from: 'empty' })
    profiles.assign({ profileId: a!.id, installationId: 'i1' })
    profiles.assign({ profileId: b!.id, installationId: 'i1' })

    const result = profiles.remove({ id: a!.id })

    // The deleted profile's record - and with it its assignments - is gone
    // outright, so no installation-side view can resolve `a.id` anywhere in
    // what remains.
    expect(result.find((p) => p.id === a!.id)).toBeUndefined()
    expect(result.some((p) => p.assignments.some((entry) => entry.installationId === a!.id))).toBe(
      false,
    )
    // The surviving profile's own assignment is untouched by the deletion.
    expect(result.find((p) => p.id === b!.id)!.assignments).toEqual([
      { installationId: 'i1', isDefault: false },
    ])
  })

  it('persists changes through the state store', () => {
    profiles.create({ name: 'Persisted', from: 'empty' })

    expect(state.configProfiles()).toHaveLength(1)
    expect(state.configProfiles()[0]!.name).toBe('Persisted')
  })

  it("replaces a profile's whole binds map, touching only binds and updatedAt", async () => {
    const [created] = profiles.create({ name: 'Original', from: 'empty' })
    // Give updatedAt a chance to actually differ from createdAt.
    await new Promise((resolve) => setTimeout(resolve, 10))

    const result = profiles.setBinds({
      profileId: created!.id,
      binds: { w: '+forward', s: '+back' },
    })

    const updated = result.find((p) => p.id === created!.id)!
    expect(updated.binds).toEqual({ w: '+forward', s: '+back' })
    expect(updated.name).toBe(created!.name)
    expect(updated.cvars).toEqual(created!.cvars)
    expect(updated.createdAt).toBe(created!.createdAt)
    expect(updated.updatedAt).not.toBe(created!.updatedAt)
  })

  it('setBinds replaces rather than merges the binds map', () => {
    const [created] = profiles.create({ name: 'Original', from: 'template' })

    // `kill` on purpose, not a catalogue command: since story 034 a raw bind whose command *is*
    // a catalogue row's (`weapnext`, `+forward`, `drop shotgun`) is adopted into that row's action
    // and rewritten to its mirrored value, which would test adoption rather than replace-semantics.
    const result = profiles.setBinds({ profileId: created!.id, binds: { x: 'kill' } })

    const updated = result.find((p) => p.id === created!.id)!
    expect(updated.binds).toEqual({ x: 'kill' })
  })

  it('throws when setting binds on an unknown id', () => {
    expect(() => profiles.setBinds({ profileId: 'missing', binds: {} })).toThrow()
  })

  it("replaces a profile's whole layers array, touching only layers and updatedAt", async () => {
    const [created] = profiles.create({ name: 'Original', from: 'empty' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const layer = {
      id: 'l1',
      name: 'Drops',
      mode: 'hold' as const,
      triggerKey: 'ALT',
      overrides: { '1': 'drop rl' },
    }
    const result = profiles.setLayers({ profileId: created!.id, layers: [layer] })

    const updated = result.find((p) => p.id === created!.id)!
    expect(updated.layers).toEqual([layer])
    expect(updated.name).toBe(created!.name)
    expect(updated.createdAt).toBe(created!.createdAt)
    expect(updated.updatedAt).not.toBe(created!.updatedAt)
  })

  it('setLayers replaces rather than merges the layers array', () => {
    const [created] = profiles.create({ name: 'Original', from: 'empty' })
    const first = {
      id: 'l1',
      name: 'Drops',
      mode: 'hold' as const,
      triggerKey: 'ALT',
      overrides: {},
    }
    profiles.setLayers({ profileId: created!.id, layers: [first] })

    const second = {
      id: 'l2',
      name: 'Zoom',
      mode: 'toggle' as const,
      triggerKey: 'v',
      overrides: {},
    }
    const result = profiles.setLayers({ profileId: created!.id, layers: [second] })

    const updated = result.find((p) => p.id === created!.id)!
    expect(updated.layers).toEqual([second])
  })

  it('throws when setting layers on an unknown id', () => {
    expect(() => profiles.setLayers({ profileId: 'missing', layers: [] })).toThrow()
  })

  describe('setActions', () => {
    const category: ConfigActionCategory = { id: 'movement', name: 'Movement' }

    function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
      return {
        id: randomUUID(),
        categoryId: category.id,
        name: 'Jump',
        kind: 'bind',
        commands: [{ kind: 'raw', text: '+moveup' }],
        ...overrides,
      }
    }

    it('a hand-written bind on a different key survives a setActions call', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      // Not a catalogue command (story 034 would adopt one into its row's action - see the
      // `setBinds` test above), so this stays the hand-typed bind the test is about.
      profiles.setBinds({ profileId: created!.id, binds: { w: 'kill' } })

      const keyed = action({ keys: [{ key: 'f' }] })
      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [keyed],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds['w']).toBe('kill')
    })

    it('produces binds[normalizedKey] === aliasNameFor(action) for a keyed action', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })

      const keyed = action({ keys: [{ key: 'f' }] })
      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [keyed],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds['f']).toBe(aliasNameFor(keyed))
      expect(updated.categories).toEqual([category])
      expect(updated.actions).toEqual([keyed])
    })

    it('story 019 D3: setActions -> list returns actions in the exact order sent, including interleaved categories and an alias entry', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const other: ConfigActionCategory = { id: 'weapons', name: 'Weapons' }
      const ordered = [
        action({ id: 'a3', categoryId: other.id, name: 'Third' }),
        action({ id: 'a1', name: 'First' }),
        action({ id: 'a2', kind: 'alias', name: '+test' }),
      ]

      profiles.setActions({
        profileId: created!.id,
        categories: [category, other],
        actions: ordered,
      })

      const listed = profiles.list().find((p) => p.id === created!.id)!
      expect(listed.actions).toEqual(ordered)
      expect(listed.actions!.map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])
      expect(listed.categories).toEqual([category, other])
    })

    it('removing a previously-keyed action makes its bind disappear entirely', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const keyed = action({ keys: [{ key: 'f' }] })
      profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [keyed],
      })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(Object.keys(updated.binds)).not.toContain('f')
    })

    it('when two actions land on the same normalized key, the later one in the array wins', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const first = action({ keys: [{ key: 'f' }], name: 'First' })
      const second = action({ keys: [{ key: 'f' }], name: 'Second' })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [first, second],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds['f']).toBe(aliasNameFor(second))
      expect(updated.binds['f']).not.toBe(aliasNameFor(first))
    })

    it('a lowercase "f9" and an uppercase "F9" land on the same normalized bind entry', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const lower = action({ keys: [{ key: 'f9' }], name: 'Lower' })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [lower],
      })

      const updated = result.find((p) => p.id === created!.id)!
      // normalizeBindKey upper-cases named-key-shaped tokens, so a lowercase
      // "f9" is stored under "F9", not "f9".
      expect(updated.binds['F9']).toBe(aliasNameFor(lower))
      expect(updated.binds['f9']).toBeUndefined()
    })

    it("replaces a profile's whole categories/actions, touching only categories/actions/binds/updatedAt", async () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      await new Promise((resolve) => setTimeout(resolve, 10))

      const keyed = action({ keys: [{ key: 'f' }] })
      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [keyed],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.name).toBe(created!.name)
      expect(updated.cvars).toEqual(created!.cvars)
      expect(updated.createdAt).toBe(created!.createdAt)
      expect(updated.updatedAt).not.toBe(created!.updatedAt)
    })

    it('round trips categories/actions through the state store', async () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      // Story 015: `secondaryKey`/`catalogId` are persisted like any other action
      // field, so a reload has to hand back both slots and the row identity.
      const keyed = action({
        keys: [{ key: 'f' }, { key: 'MOUSE2' }],
        catalogId: 'movement.jump',
      })
      profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [keyed],
      })
      await state.settle()

      const reloaded = new StateStore(filePath)
      await reloaded.load()
      const reloadedProfiles = new ProfilesStore(reloaded)

      const persisted = reloadedProfiles.find(created!.id)!
      expect(persisted.categories).toEqual([category])
      expect(persisted.actions).toEqual([keyed])
      // `bindValueFor`, not `aliasNameFor`: this row is a catalogue row (`catalogId`) whose whole
      // body is one continuous `+command`, and story 034 binds those directly - an alias would
      // swallow the engine's `-moveup` on key-up.
      expect(persisted.binds['f']).toBe(bindValueFor(keyed))
    })

    it('throws when setting actions on an unknown profile id', () => {
      expect(() =>
        profiles.setActions({ profileId: 'missing', categories: [], actions: [] }),
      ).toThrow()
    })

    it("an action's key wins over a user's hand-written bind on the same key (review finding)", () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      profiles.setBinds({ profileId: created!.id, binds: { f: 'weapnext' } })

      const keyed = action({ keys: [{ key: 'f' }] })
      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [keyed],
      })

      // Assigning an action to a key that already had a hand-written bind
      // takes over that key, same as any other bind assignment in this app
      // (KeyBindDialog does the same) - it does not silently keep the old
      // bind underneath the new one.
      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds['f']).toBe(aliasNameFor(keyed))
    })

    // Story 015 (decision 1): `key` and `secondaryKey` are two bind entries on one alias.
    it('an action with only a secondaryKey produces exactly that one bind', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const secondaryOnly = action({ keys: [{ key: 'MOUSE2' }] })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [secondaryOnly],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds).toEqual({ MOUSE2: aliasNameFor(secondaryOnly) })
    })

    it('an action with both keys produces two binds pointing at the same alias', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const both = action({ keys: [{ key: 'f' }, { key: 'MOUSE2' }] })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [both],
      })

      const updated = result.find((p) => p.id === created!.id)!
      // One alias per action, not per slot - so both keys carry the identical value.
      expect(updated.binds).toEqual({
        f: aliasNameFor(both),
        MOUSE2: aliasNameFor(both),
      })
    })

    it("clearing only the secondaryKey removes only that key's bind", () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const both = action({ keys: [{ key: 'f' }, { key: 'MOUSE2' }] })
      profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [both],
      })

      // Same action (same id, so the same alias name), second slot cleared.
      const primaryOnly: ConfigAction = { ...both, keys: [{ key: 'f' }] }
      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [primaryOnly],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds['f']).toBe(aliasNameFor(both))
      expect(Object.keys(updated.binds)).not.toContain('MOUSE2')
    })

    it('an action whose two slots normalize to the same key writes it once', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const sameKeyTwice = action({ keys: [{ key: 'f9' }, { key: 'F9' }] })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [sameKeyTwice],
      })

      const updated = result.find((p) => p.id === created!.id)!
      // Both writes carry the same alias, so a self-collision is a no-op rather
      // than one slot silently shadowing the other.
      expect(updated.binds).toEqual({ F9: aliasNameFor(sameKeyTwice) })
    })

    it('trims a whitespace-padded key before normalizing it (review finding)', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const keyed = action({ keys: [{ key: '  f9  ' }] })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [keyed],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds['F9']).toBe(aliasNameFor(keyed))
      expect(Object.keys(updated.binds)).not.toContain('  f9  ')
    })
  })

  // Story 016 D8: both setters now derive the layer-side generated-alias mirror
  // (`applyActionLayerMirror`), and `setActions` stops writing a base bind for
  // a slot that carries a modifier. Own `category`/`action` fixtures rather
  // than reaching into the `setActions` block above's scope.
  describe('story 016: modifier-bound slots', () => {
    const category: ConfigActionCategory = { id: 'drops', name: 'Weapon dropping' }

    function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
      return {
        id: 'ab12cd34-0000-4000-8000-000000000001',
        categoryId: category.id,
        name: 'Rocket Launcher',
        kind: 'bind',
        catalogId: 'dropWeapon:rlauncher',
        // A materialised Weapon-dropping row (story 015 decision 6): item, its
        // ammo, then the team message.
        commands: [
          { kind: 'raw', text: 'drop rocket launcher' },
          { kind: 'raw', text: 'drop rockets' },
          { kind: 'message', channel: 'say_team', text: 'need ammo' },
        ],
        ...overrides,
      }
    }

    /** Every persisted layer whose trigger is `modifier` - normally exactly one. */
    function modifierLayer(profileId: string, modifier: string): AltLayer[] {
      const layers = profiles.find(profileId)!.layers ?? []
      return layers.filter((layer) => layer.triggerKey === modifier)
    }

    it('writes no base bind for a slot that carries a modifier, only the layer override', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const altBound = action({ keys: [{ key: 'r', modifier: 'ALT' }] })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [altBound],
      })

      const updated = result.find((p) => p.id === created!.id)!
      // `Alt+R` is not a bind Quake 2 can express - it exists only as an
      // override inside the ALT layer.
      expect(updated.binds).toEqual({})
      const [alt, ...extraAltLayers] = modifierLayer(created!.id, 'ALT')
      expect(extraAltLayers).toEqual([])
      expect(alt!.overrides).toEqual({ r: aliasNameFor(altBound) })
      expect(alt!.mode).toBe('hold')
    })

    it('judges the two slots independently: Primary on Alt, Secondary on the base layer', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const mixed = action({ keys: [{ key: 'r', modifier: 'ALT' }, { key: 'MOUSE2' }] })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [mixed],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds).toEqual({ MOUSE2: aliasNameFor(mixed) })
      expect(modifierLayer(created!.id, 'ALT')[0]!.overrides).toEqual({ r: aliasNameFor(mixed) })
    })

    it('judges the two slots independently the other way round: Primary base, Secondary on Ctrl', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const mixed = action({ keys: [{ key: 'r' }, { key: 'MOUSE2', modifier: 'CTRL' }] })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [mixed],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds).toEqual({ r: aliasNameFor(mixed) })
      expect(modifierLayer(created!.id, 'ALT')).toEqual([])
      expect(modifierLayer(created!.id, 'CTRL')[0]!.overrides).toEqual({
        MOUSE2: aliasNameFor(mixed),
      })
    })

    it("a hand-typed bind on the modifier slot's own key is neither written nor dropped", () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      profiles.setBinds({ profileId: created!.id, binds: { r: 'kill' } })

      const altBound = action({ keys: [{ key: 'r', modifier: 'ALT' }] })
      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [altBound],
      })

      const updated = result.find((p) => p.id === created!.id)!
      // Binding a row to `Alt+R` must not touch what bare `r` does - that is the
      // whole point of putting it on a modifier.
      expect(updated.binds).toEqual({ r: 'kill' })
      expect(modifierLayer(created!.id, 'ALT')[0]!.overrides).toEqual({ r: aliasNameFor(altBound) })
    })

    it('a slot that loses its modifier becomes a base bind again and leaves no stale override', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const altBound = action({ keys: [{ key: 'r', modifier: 'ALT' }] })
      profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [altBound],
      })

      // Same action (same id, so the same alias name), modifier cleared.
      const baseBound: ConfigAction = { ...altBound, keys: [{ key: 'r' }] }
      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [baseBound],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds).toEqual({ r: aliasNameFor(baseBound) })
      // The ALT layer survives (the user may have named/configured it) but its
      // mirrored override is gone rather than firing on Alt+R forever.
      expect(modifierLayer(created!.id, 'ALT')[0]!.overrides).toEqual({})
    })

    it('a slot that gains a modifier drops its own stale generated base bind', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const baseBound = action({ keys: [{ key: 'r' }] })
      const first = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [baseBound],
      })
      expect(first.find((p) => p.id === created!.id)!.binds).toEqual({ r: aliasNameFor(baseBound) })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [{ ...baseBound, keys: [{ key: 'r', modifier: 'ALT' }] }],
      })

      // Otherwise bare `r` would keep firing the row with no modifier held.
      expect(result.find((p) => p.id === created!.id)!.binds).toEqual({})
    })

    it('reuses a hand-made ALT layer by trigger key and leaves its own overrides and other layers alone', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const zoom = {
        id: 'zoom-1',
        name: 'Zoom',
        mode: 'toggle' as const,
        triggerKey: 'v',
        overrides: { '1': 'wave 1' },
      }
      const handMadeAlt = {
        id: 'hand-alt',
        name: 'Rocketjump',
        mode: 'hold' as const,
        triggerKey: 'ALT',
        overrides: { q: 'say_team taking rl' },
      }
      profiles.setLayers({ profileId: created!.id, layers: [zoom, handMadeAlt] })

      const altBound = action({ keys: [{ key: 'r', modifier: 'ALT' }] })
      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [altBound],
      })

      const updated = result.find((p) => p.id === created!.id)!
      // Matched by trigger key, never by name - no second, competing ALT layer.
      expect(updated.layers).toHaveLength(2)
      expect(updated.layers![0]).toEqual(zoom)
      expect(updated.layers![1]!.id).toBe('hand-alt')
      expect(updated.layers![1]!.name).toBe('Rocketjump')
      expect(updated.layers![1]!.overrides).toEqual({
        q: 'say_team taking rl',
        r: aliasNameFor(altBound),
      })
    })

    it('setLayers re-derives an override a stale panel save left out, keeping hand-made ones', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const staleSnapshot = {
        id: 'l-alt',
        name: 'Alt',
        mode: 'hold' as const,
        triggerKey: 'ALT',
        overrides: { q: 'say_team taking rl' },
      }
      profiles.setLayers({ profileId: created!.id, layers: [staleSnapshot] })

      const altBound = action({ keys: [{ key: 'r', modifier: 'ALT' }] })
      profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [altBound],
      })

      // The Layers panel saves the array it loaded *before* the capture above -
      // a wholesale replace would silently drop the row's Alt+R override.
      const result = profiles.setLayers({ profileId: created!.id, layers: [staleSnapshot] })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.layers).toHaveLength(1)
      expect(updated.layers![0]!.id).toBe('l-alt')
      expect(updated.layers![0]!.overrides).toEqual({
        q: 'say_team taking rl',
        r: aliasNameFor(altBound),
      })
    })

    it('setLayers strips a mirrored override whose action no longer carries that slot', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })

      // No actions on this profile at all, so nothing may claim an override -
      // yet the incoming array carries a `q2l_a_*` value from an older save.
      const result = profiles.setLayers({
        profileId: created!.id,
        layers: [
          {
            id: 'l-alt',
            name: 'Alt',
            mode: 'hold' as const,
            triggerKey: 'ALT',
            overrides: { r: 'q2l_a_rocket_launcher_ab12', q: 'say_team taking rl' },
          },
        ],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.layers![0]!.overrides).toEqual({ q: 'say_team taking rl' })
    })

    it('setLayers does not touch a non-modifier layer or the actions array', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const altBound = action({ keys: [{ key: 'r', modifier: 'ALT' }] })
      profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [altBound],
      })

      const zoom = {
        id: 'zoom-1',
        name: 'Zoom',
        mode: 'toggle' as const,
        triggerKey: 'v',
        overrides: { '1': 'wave 1' },
      }
      const result = profiles.setLayers({ profileId: created!.id, layers: [zoom] })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.layers![0]).toEqual(zoom)
      expect(updated.actions).toEqual([altBound])
      // A layer whose trigger is not a modifier never receives a mirrored override.
      expect(updated.layers![0]!.overrides).toEqual({ '1': 'wave 1' })
    })

    // AC 5: one action, two ways of reaching it, one executed command.
    it('renders the identical executed command whether the row is base-bound or modifier-bound', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const dropRow = action({ keys: [{ key: 'r' }] })
      const alias = aliasNameFor(dropRow)
      // The ammo + say_team row renders as one alias body either way; the ALT
      // layer's own aliases slug off its name ("Alt" -> `+alt`/`-alt`).
      const aliasLine = `alias ${alias} "drop rocket launcher; drop rockets; say_team need ammo"`

      profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [dropRow],
      })
      const baseLines = renderProfileFile(profiles.find(created!.id)!).split('\n').map(unformat)

      // Same action, same id, same alias - only the modifier is added.
      profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [{ ...dropRow, keys: [{ key: 'r', modifier: 'ALT' }] }],
      })
      const modifierLines = renderProfileFile(profiles.find(created!.id)!).split('\n').map(unformat)

      // The thing that actually executes is byte-identical in both files.
      expect(baseLines).toContain(aliasLine)
      expect(modifierLines).toContain(aliasLine)
      // The action-generated alias line(s) - identified by the known alias name itself (story 039,
      // D7 dropped the `q2l_a_` prefix this filter used to key off) - are identical in both
      // renders too, not just present.
      expect(modifierLines.filter((line) => line.startsWith(`alias ${alias}`))).toEqual(
        baseLines.filter((line) => line.startsWith(`alias ${alias}`)),
      )

      // Base-bound: `r` runs the alias directly.
      expect(baseLines).toContain(`bind r "${alias}"`)
      expect(baseLines.filter((line) => line.startsWith('bind '))).toEqual([`bind r "${alias}"`])

      // Modifier-bound: holding ALT rebinds `r` to that same alias, releasing it
      // puts `r` back, and `r` is never bound on the base layer.
      // One command per half, so `renderAliasLine` leaves both bodies unquoted.
      expect(modifierLines).toContain(`alias +alt bind r ${alias}`)
      expect(modifierLines).toContain('alias -alt unbind r')
      expect(modifierLines).toContain('bind ALT +alt')
      expect(modifierLines.filter((line) => line.startsWith('bind '))).toEqual(['bind ALT +alt'])
    })
  })
  // Story 019 D2: an alias entry renders as its own alias and is never bound -
  // neither into `binds` nor into a layer override. Own fixtures, like the
  // story 016 block above.
  describe('story 019: alias entries', () => {
    const category: ConfigActionCategory = { id: 'jumps', name: 'Jumps' }

    function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
      return {
        id: 'aaaa0000-0000-4000-8000-000000000001',
        categoryId: category.id,
        name: 'Test binding',
        kind: 'bind',
        commands: [{ kind: 'raw', text: '+test' }],
        ...overrides,
      }
    }

    const aliasEntry = action({
      id: 'bbbb1111-0000-4000-8000-000000000002',
      name: '+test',
      kind: 'alias',
      commands: [{ kind: 'raw', text: '+attack' }],
    })

    it('contributes neither a bind nor a layer override, even carrying key + modifier', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        // The UI has no key slot for an alias entry (D5), but the mirror may
        // not rely on that: key data on an alias row is still never bound.
        actions: [
          { ...aliasEntry, keys: [{ key: 'r' }] },
          { ...aliasEntry, id: 'cccc2222', name: '-test', keys: [{ key: 'g', modifier: 'ALT' }] },
        ],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds).toEqual({})
      expect(updated.layers ?? []).toEqual([])
      // The rows themselves are persisted as sent - only the mirrors skip them.
      expect(updated.actions).toHaveLength(2)
    })

    it('drops the stale generated bind of a row that has just become an alias, hand-made binds intact', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      profiles.setBinds({ profileId: created!.id, binds: { w: 'kill' } })

      const wasBound = action({ keys: [{ key: 'r' }] })
      const first = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [wasBound],
      })
      expect(first.find((p) => p.id === created!.id)!.binds).toEqual({
        w: 'kill',
        r: aliasNameFor(wasBound),
      })

      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [{ ...wasBound, kind: 'alias' }],
      })

      // Otherwise `r` would keep calling an alias this save no longer writes.
      expect(result.find((p) => p.id === created!.id)!.binds).toEqual({ w: 'kill' })
    })

    it('drops the stale override of a modifier-bound row that has just become an alias', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const wasBound = action({ keys: [{ key: 'r', modifier: 'ALT' }] })
      profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [wasBound],
      })
      const alt = profiles.find(created!.id)!.layers!.find((l) => l.triggerKey === 'ALT')!
      expect(alt.overrides).toEqual({ r: aliasNameFor(wasBound) })

      profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [{ ...wasBound, kind: 'alias' }],
      })

      // The layer survives (the user may have configured it); its mirrored
      // override does not.
      const after = profiles.find(created!.id)!.layers!.find((l) => l.triggerKey === 'ALT')!
      expect(after.overrides).toEqual({})
    })

    it('renders the alias definition before the binding that calls it, and no bind for it', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const binding = action({ keys: [{ key: 'f' }] })
      profiles.setActions({
        profileId: created!.id,
        categories: [category],
        // Array order is the emission order: the alias first, then its caller.
        actions: [aliasEntry, binding],
      })

      const lines = renderProfileFile(profiles.find(created!.id)!).split('\n').map(unformat)
      const aliasLine = lines.indexOf('alias +test +attack')
      const bindingLine = lines.indexOf(`alias ${aliasNameFor(binding)} +test`)

      expect(aliasLine).toBeGreaterThanOrEqual(0)
      expect(bindingLine).toBeGreaterThan(aliasLine)
      // Exactly one bind line: the binding's key. Nothing binds `+test`.
      expect(lines.filter((line) => line.startsWith('bind '))).toEqual([
        `bind f "${aliasNameFor(binding)}"`,
      ])
    })
  })

  // Story 041 (D6): `createFromImport` gains `actions`/`categories`/`layers`,
  // stored alongside the existing `cvars`/`binds`/`unrecognized` rather than
  // replacing them, and the pre-existing story 034 bind-adoption pass must not
  // double-count an imported alias entry.
  describe('createFromImport (story 041 D6)', () => {
    it('stores actions/categories/layers alongside cvars/binds/unrecognized', () => {
      const category: ConfigActionCategory = { id: 'imported', name: 'Imported' }
      const aliasAction: ConfigAction = {
        id: 'a1',
        categoryId: category.id,
        name: 'greeting',
        kind: 'alias',
        commands: [{ kind: 'message', channel: 'say', text: 'hi' }],
        aliasName: 'greeting',
      }
      const layer: AltLayer = {
        id: 'l1',
        name: 'cali',
        mode: 'toggle',
        triggerKey: null,
        overrides: { KP_END: 'fuck' },
      }

      const result = profiles.createFromImport({
        name: 'Imported',
        cvars: { sensitivity: '3' },
        // Not a catalogue command (story 034 would adopt one into its own
        // row's action - see the `setBinds` test above), so this stays the
        // hand-typed bind the test is about.
        binds: { x: 'kill' },
        unrecognized: [{ file: 'config.cfg', line: 1, text: 'wave hi' }],
        actions: [aliasAction],
        categories: [category],
        layers: [layer],
      })

      const created = result[0]!
      expect(created.cvars).toEqual({ sensitivity: '3' })
      expect(created.binds).toEqual({ x: 'kill' })
      expect(created.unrecognized).toEqual([{ file: 'config.cfg', line: 1, text: 'wave hi' }])
      expect(created.actions).toEqual([aliasAction])
      expect(created.categories).toEqual([category])
      expect(created.layers).toEqual([layer])
    })

    it("a raw imported bind referencing an alias by name is left alone, not double-adopted into a second catalogue action - even when the alias's name collides with a catalogue command (bind-adoption.ts's own documented case)", () => {
      const category: ConfigActionCategory = { id: 'imported', name: 'Imported' }
      // Named exactly like the `weapnext` catalogue command - the alias import
      // gives this action `aliasName: 'weapnext'`, and the raw bind below
      // merely calls it by that name, same as a hand-typed config would.
      const weapnextAlias: ConfigAction = {
        id: randomUUID(),
        categoryId: category.id,
        name: 'weapnext',
        kind: 'alias',
        commands: [{ kind: 'raw', text: 'impulse 10' }],
        aliasName: 'weapnext',
      }

      const result = profiles.createFromImport({
        name: 'Imported',
        cvars: {},
        binds: { y: 'weapnext' },
        unrecognized: [],
        actions: [weapnextAlias],
        categories: [category],
        layers: [],
      })

      const created = result[0]!
      // The bare-token bind stays exactly as imported, pointing at the alias by
      // name - `adoptRawBinds`'s `isAliasReference` check must recognise it and
      // skip catalogue adoption, so there is exactly one action, not two.
      expect(created.binds).toEqual({ y: 'weapnext' })
      expect(created.actions).toEqual([weapnextAlias])
      expect((created.actions ?? []).filter((a) => a.catalogId === 'weaponExtra:weapnext')).toEqual(
        [],
      )
    })
  })

  describe('story 034: raw binds are adopted into catalogue actions', () => {
    it('adopts a bind saved from the Overview keyboard into its Controls row', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })

      const result = profiles.setBinds({
        profileId: created!.id,
        binds: { w: '+forward', SPACE: '+moveup', MOUSE2: '+moveup', x: 'kill' },
      })

      const updated = result.find((p) => p.id === created!.id)!
      const forward = (updated.actions ?? []).find((a) => a.catalogId === 'movement:forward')!
      const jump = (updated.actions ?? []).find((a) => a.catalogId === 'movement:moveup')!

      expect(keySlotAt(forward, 0)?.key).toBe('w')
      expect(keySlotAt(jump, 0)?.key).toBe('MOUSE2')
      expect(keySlotAt(jump, 1)?.key).toBe('SPACE')
      // The binds themselves still say what they said - adoption re-encodes, it does not re-bind.
      expect(updated.binds).toEqual({ w: '+forward', SPACE: '+moveup', MOUSE2: '+moveup', x: 'kill' })
    })

    it('adopts a template profile the moment it is created', () => {
      const [created] = profiles.create({ name: 'From template', from: 'template' })

      expect((created!.actions ?? []).map((a) => a.catalogId)).toContain('movement:forward')
    })

    it('adopts an ALT-layer override as a modifier-bound row', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const result = profiles.setLayers({
        profileId: created!.id,
        layers: [
          { id: 'l1', name: 'Alt', mode: 'hold', triggerKey: 'ALT', overrides: { q: 'drop shotgun; drop shells' } },
        ],
      })

      const updated = result.find((p) => p.id === created!.id)!
      const dropShotgun = (updated.actions ?? []).find((a) => a.catalogId === 'dropWeapon:shotgun')!

      expect(keySlotAt(dropShotgun, 0)?.key).toBe('q')
      expect(keySlotAt(dropShotgun, 0)?.modifier).toBe('ALT')
      expect(updated.layers![0]!.overrides).toEqual({ q: aliasNameFor(dropShotgun) })
      expect(updated.binds).toEqual({})
    })

    it('survives a reload - the adopted action is what the Controls grid reads back', async () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      profiles.setBinds({ profileId: created!.id, binds: { q: 'use railgun' } })
      await state.settle()

      const reloaded = new StateStore(filePath)
      await reloaded.load()
      const persisted = new ProfilesStore(reloaded).find(created!.id)!

      const railgun = (persisted.actions ?? []).find((a) => a.catalogId === 'weaponUse:use_railgun')!
      expect(keySlotAt(railgun, 0)?.key).toBe('q')
      expect(persisted.binds['q']).toBe(aliasNameFor(railgun))
    })
  })

  /**
   * Story 049 D1: the last-saved `baseline` is seeded at exactly the points `fileHash` is, and from
   * the record as it is actually stored - i.e. *after* the `adoptProfileBinds` pass `commit` runs
   * over everything. A snapshot taken before that pass would differ from the stored profile in
   * `binds`/`actions` and make a freshly adopted profile report unsaved changes it does not have.
   */
  describe('story 049: the last-saved baseline', () => {
    it('is absent on a profile whose file has never been confirmed', () => {
      const [created] = profiles.create({ name: 'Never saved', from: 'template' })
      expect(created!.baseline).toBeUndefined()
    })

    it('is seeded by markFileSeen and left alone by a later edit', () => {
      const [created] = profiles.create({ name: 'Saved', from: 'empty' })
      const seen = profiles
        .markFileSeen(created!.id, 'hash-1', 1_700_000_000_000)
        .find((p) => p.id === created!.id)!

      expect(seen.baseline).toEqual(captureBaseline(seen))
      expect(seen.baseline!.cvars).toEqual({})

      // An edit is exactly what the baseline must NOT follow - that is the unsaved change.
      const edited = profiles
        .setCvars({ profileId: created!.id, cvars: { sensitivity: '4.5' } })
        .find((p) => p.id === created!.id)!
      expect(edited.baseline!.cvars).toEqual({})
      expect(edited.cvars).toEqual({ sensitivity: '4.5' })
    })

    it('is seeded by adoptFromFile from the adopted, stripped fields - not from the raw file ones', () => {
      const [created] = profiles.create({ name: 'Adopting', from: 'empty' })
      const adopted = profiles
        .adoptFromFile(
          created!.id,
          {
            name: 'From the file',
            cvars: { sensitivity: '4.5' },
            // A hand-added raw catalogue bind: the adoption pass turns this into the Controls row's
            // own action and rewrites the bind, so the stored record is not the one passed in here.
            binds: { q: 'use railgun' },
            actions: [],
            categories: [],
            layers: [],
            writeUnbindall: false,
            sectionHeaderStyle: 'brackets',
          },
          'hash-2',
          1_700_000_000_001,
        )
        .find((p) => p.id === created!.id)!

      const railgun = (adopted.actions ?? []).find((a) => a.catalogId === 'weaponUse:use_railgun')!
      expect(adopted.baseline).toEqual(captureBaseline(adopted))
      expect(adopted.baseline!.binds).toEqual({ q: aliasNameFor(railgun) })
      expect(adopted.baseline!.actions).toEqual(adopted.actions)
      expect(adopted.baseline!.writeUnbindall).toBe(false)
      expect(adopted.baseline!.sectionHeaderStyle).toBe('brackets')
    })

    it('is seeded by addRebuilt, and survives a reload of state.json', async () => {
      const rebuilt = profiles
        .addRebuilt({
          id: 'rebuilt-1',
          name: 'Rebuilt',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          cvars: { sensitivity: '4.5' },
          binds: { q: 'use railgun' },
          assignments: [],
          fileHash: 'hash-3',
          fileSeenAt: 1_700_000_000_002,
          dirty: false,
          fileState: 'unchanged',
        })
        .find((p) => p.id === 'rebuilt-1')!

      expect(rebuilt.baseline).toEqual(captureBaseline(rebuilt))
      await state.settle()

      const reloaded = new StateStore(filePath)
      await reloaded.load()
      const persisted = new ProfilesStore(reloaded).find('rebuilt-1')!
      expect(persisted.baseline).toEqual(rebuilt.baseline)
      // And the record it describes still matches it, so nothing reads as unsaved after a restart.
      expect(persisted.baseline).toEqual(captureBaseline(persisted))
    })
  })

  /**
   * Story 049 D3: `discard` restores a profile's content to its `baseline`, without writing any
   * file - `ProfilesStore.discard` never imports or calls anything from `./writer`/`./sync`/
   * `./canonical` (the file-writing modules), so this is structurally, not just behaviourally, a
   * no-file-touched operation. Verified here purely against the in-memory `ProfilesStore`/
   * `StateStore` pair the rest of this file already uses - no real filesystem profile file is ever
   * created for these tests, so there is nothing for `discard` to have touched.
   */
  describe('discard (story 049 D3)', () => {
    it('restores every baseline-covered field, clears dirty, and bumps updatedAt', async () => {
      const [created] = profiles.create({ name: 'Saved', from: 'empty' })
      const seen = profiles
        .markFileSeen(created!.id, 'hash-1', 1_700_000_000_000)
        .find((p) => p.id === created!.id)!
      const savedUpdatedAt = seen.updatedAt

      // Edit everything the baseline covers.
      profiles.rename({ id: created!.id, name: 'Renamed' })
      profiles.setCvars({ profileId: created!.id, cvars: { sensitivity: '4.5' } })
      profiles.setBinds({ profileId: created!.id, binds: { q: 'use railgun' } })
      profiles.setWriteUnbindall({ profileId: created!.id, writeUnbindall: false })
      profiles.setSectionHeaderStyle({ profileId: created!.id, sectionHeaderStyle: 'brackets' })
      const edited = profiles.setDirty(created!.id, true).find((p) => p.id === created!.id)!
      expect(edited.dirty).toBe(true)
      expect(edited.cvars).toEqual({ sensitivity: '4.5' })

      await new Promise((resolve) => setTimeout(resolve, 2))
      const result = profiles.discard(created!.id)
      expect(result.outcome).toBe('discarded')
      if (result.outcome !== 'discarded') throw new Error('unreachable')

      const discarded = result.profiles.find((p) => p.id === created!.id)!
      expect(discarded.name).toBe(seen.baseline!.name)
      expect(discarded.cvars).toEqual(seen.baseline!.cvars)
      expect(discarded.binds).toEqual(seen.baseline!.binds)
      expect(discarded.writeUnbindall).toBe(seen.baseline!.writeUnbindall)
      expect(discarded.sectionHeaderStyle).toBe(seen.baseline!.sectionHeaderStyle)
      expect(discarded.layers).toEqual(seen.baseline!.layers)
      expect(discarded.categories).toEqual(seen.baseline!.categories)
      expect(discarded.actions).toEqual(seen.baseline!.actions)
      expect(discarded.unrecognized).toEqual(seen.baseline!.unrecognized)
      expect(discarded.dirty).toBe(false)
      expect(discarded.updatedAt).not.toBe(savedUpdatedAt)

      // The cache-of-the-file fields are untouched by a discard - it never wrote anything.
      expect(discarded.fileHash).toBe(seen.fileHash)
      expect(discarded.fileSeenAt).toBe(seen.fileSeenAt)
      expect(discarded.fileState).toBe(seen.fileState)
      expect(discarded.baseline).toEqual(seen.baseline)
    })

    it('restores the name after a rename, the one edit that reaches the file without writing it', () => {
      // Review finding: a `rename` marks the profile dirty and defers both the header banner and the
      // file rename to the next save (story 043), so it is pending file content like any cvar edit.
      // Before the fix the diff did not see it and the discard left the profile renamed - every
      // other field back at the last saved state, the name not.
      const [created] = profiles.create({ name: 'Saved', from: 'empty' })
      const seen = profiles
        .markFileSeen(created!.id, 'hash-1', 1_700_000_000_000)
        .find((p) => p.id === created!.id)!
      expect(seen.baseline!.name).toBe('Saved')

      const renamed = profiles
        .rename({ id: created!.id, name: 'Renamed' })
        .find((p) => p.id === created!.id)!
      expect(renamed.name).toBe('Renamed')
      // The baseline still describes the file, which no rename has reached.
      expect(renamed.baseline!.name).toBe('Saved')

      const pending = diffProfileAgainstBaseline(renamed)
      expect(pending.sections.settings).toEqual([
        {
          section: 'settings',
          kind: 'changed',
          key: 'name',
          label: 'name',
          before: 'Saved',
          after: 'Renamed',
        },
      ])

      const result = profiles.discard(created!.id)
      if (result.outcome !== 'discarded') throw new Error('unreachable')
      const discarded = result.profiles.find((p) => p.id === created!.id)!

      expect(discarded.name).toBe('Saved')
      expect(discarded.dirty).toBe(false)
      // ...and the profile now genuinely equals its baseline again: nothing pending at all.
      expect(diffProfileAgainstBaseline(discarded).count).toBe(0)
    })

    it('returns noBaseline and mutates nothing for a profile that was never saved', () => {
      const [created] = profiles.create({ name: 'Never saved', from: 'template' })
      expect(created!.baseline).toBeUndefined()

      const result = profiles.discard(created!.id)
      expect(result).toEqual({ outcome: 'noBaseline' })

      const unchanged = profiles.find(created!.id)!
      expect(unchanged).toEqual(created)
    })

    it('throws for an unknown profile id', () => {
      expect(() => profiles.discard('missing')).toThrow('config profile not found: missing')
    })
  })
})

describe('setProfileBindsInputSchema / setProfileLayersInputSchema (IPC payload validation)', () => {
  it('rejects a binds payload whose value is not a map of strings', () => {
    expect(setProfileBindsInputSchema.safeParse({ profileId: 'p1', binds: { w: 1 } }).success).toBe(
      false,
    )
  })

  it('rejects a binds payload missing profileId', () => {
    expect(setProfileBindsInputSchema.safeParse({ binds: {} }).success).toBe(false)
  })

  it('accepts a well-formed binds payload', () => {
    expect(
      setProfileBindsInputSchema.safeParse({ profileId: 'p1', binds: { w: '+forward' } }).success,
    ).toBe(true)
  })

  it('rejects a layers payload with a garbage shape (string instead of array)', () => {
    expect(setProfileLayersInputSchema.safeParse({ profileId: 'p1', layers: 'nope' }).success).toBe(
      false,
    )
  })

  it('rejects a layers payload with an invalid mode', () => {
    expect(
      setProfileLayersInputSchema.safeParse({
        profileId: 'p1',
        layers: [{ id: 'l1', name: 'Drops', mode: 'sticky', triggerKey: 'ALT', overrides: {} }],
      }).success,
    ).toBe(false)
  })

  it('accepts a well-formed layers payload', () => {
    expect(
      setProfileLayersInputSchema.safeParse({
        profileId: 'p1',
        layers: [{ id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: {} }],
      }).success,
    ).toBe(true)
  })

  // Story 011: triggerKey becomes nullable - null means "no trigger assigned yet".
  it('accepts a layers payload with triggerKey: null', () => {
    expect(
      setProfileLayersInputSchema.safeParse({
        profileId: 'p1',
        layers: [{ id: 'l1', name: 'Drops', mode: 'hold', triggerKey: null, overrides: {} }],
      }).success,
    ).toBe(true)
  })

  it('rejects a layers payload with triggerKey: "" (empty string)', () => {
    expect(
      setProfileLayersInputSchema.safeParse({
        profileId: 'p1',
        layers: [{ id: 'l1', name: 'Drops', mode: 'hold', triggerKey: '', overrides: {} }],
      }).success,
    ).toBe(false)
  })
})

// Story 015 (decisions 1 + 2): the payload gains two optional fields and no new channel.
describe('setProfileActionsInputSchema (IPC payload validation)', () => {
  function payload(action: Record<string, unknown>): unknown {
    return {
      profileId: 'p1',
      categories: [{ id: 'movement', name: 'Movement' }],
      actions: [
        {
          id: 'a1',
          categoryId: 'movement',
          name: 'Jump',
          kind: 'bind',
          commands: [{ kind: 'raw', text: '+moveup' }],
          ...action,
        },
      ],
    }
  }

  it('accepts an actions payload carrying secondaryKey and catalogId', () => {
    expect(
      setProfileActionsInputSchema.safeParse(
        payload({ key: 'f', secondaryKey: 'MOUSE2', catalogId: 'movement.jump' }),
      ).success,
    ).toBe(true)
  })

  it('accepts an actions payload with neither field (a pre-015 action)', () => {
    expect(setProfileActionsInputSchema.safeParse(payload({ key: 'f' })).success).toBe(true)
  })

  it('rejects a secondaryKey longer than the key limit, same as key', () => {
    const tooLong = 'x'.repeat(21)
    expect(setProfileActionsInputSchema.safeParse(payload({ secondaryKey: tooLong })).success).toBe(
      false,
    )
    // The point is that the second slot is no laxer than the first.
    expect(setProfileActionsInputSchema.safeParse(payload({ key: tooLong })).success).toBe(false)
  })

  it('rejects an empty catalogId', () => {
    expect(setProfileActionsInputSchema.safeParse(payload({ catalogId: '' })).success).toBe(false)
  })
})
