import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STANDARD_TEMPLATE } from '@shared/modules/config'
import { StateStore } from '../../services/state'
import { ProfilesStore } from './profiles'

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

  it('persists changes through the state store', () => {
    profiles.create({ name: 'Persisted', from: 'empty' })

    expect(state.configProfiles()).toHaveLength(1)
    expect(state.configProfiles()[0]!.name).toBe('Persisted')
  })
})
