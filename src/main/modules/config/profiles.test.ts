import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  STANDARD_TEMPLATE,
  type ConfigAction,
  type ConfigActionCategory,
} from '@shared/modules/config'
import { StateStore } from '../../services/state'
import { aliasNameFor } from '@shared/config/alias-render'
import { ProfilesStore } from './profiles'
import { setProfileBindsInputSchema, setProfileLayersInputSchema } from './schemas'

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

  it('creates a profile from the standard template', () => {
    const result = profiles.create({ name: 'Vanilla', from: 'template' })

    const created = result[0]!
    expect(created.cvars).toEqual(STANDARD_TEMPLATE.cvars)
    expect(created.binds).toEqual(STANDARD_TEMPLATE.binds)
    // Copied, not aliased: mutating the profile must never touch the shared template.
    created.cvars['sensitivity'] = '10'
    expect(STANDARD_TEMPLATE.cvars['sensitivity']).not.toBe('10')
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

    const result = profiles.setBinds({ profileId: created!.id, binds: { x: 'weapnext' } })

    const updated = result.find((p) => p.id === created!.id)!
    expect(updated.binds).toEqual({ x: 'weapnext' })
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
    const category: ConfigActionCategory = { id: 'movement', name: 'Movement', entryKind: 'bind' }

    function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
      return {
        id: randomUUID(),
        categoryId: category.id,
        name: 'Jump',
        commands: [{ kind: 'raw', text: '+moveup' }],
        ...overrides,
      }
    }

    it('a hand-written bind on a different key survives a setActions call', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      profiles.setBinds({ profileId: created!.id, binds: { w: '+forward' } })

      const keyed = action({ key: 'f' })
      const result = profiles.setActions({
        profileId: created!.id,
        categories: [category],
        actions: [keyed],
      })

      const updated = result.find((p) => p.id === created!.id)!
      expect(updated.binds['w']).toBe('+forward')
    })

    it('produces binds[normalizedKey] === aliasNameFor(action) for a keyed action', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })

      const keyed = action({ key: 'f' })
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

    it('removing a previously-keyed action makes its bind disappear entirely', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const keyed = action({ key: 'f' })
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
      const first = action({ key: 'f', name: 'First' })
      const second = action({ key: 'f', name: 'Second' })

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
      const lower = action({ key: 'f9', name: 'Lower' })

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

      const keyed = action({ key: 'f' })
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
      const keyed = action({ key: 'f' })
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
      expect(persisted.binds['f']).toBe(aliasNameFor(keyed))
    })

    it('throws when setting actions on an unknown profile id', () => {
      expect(() =>
        profiles.setActions({ profileId: 'missing', categories: [], actions: [] }),
      ).toThrow()
    })

    it("an action's key wins over a user's hand-written bind on the same key (review finding)", () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      profiles.setBinds({ profileId: created!.id, binds: { f: 'weapnext' } })

      const keyed = action({ key: 'f' })
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

    it('trims a whitespace-padded key before normalizing it (review finding)', () => {
      const [created] = profiles.create({ name: 'Original', from: 'empty' })
      const keyed = action({ key: '  f9  ' })

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
})
