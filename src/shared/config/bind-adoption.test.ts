import { describe, expect, it } from 'vitest'
import type { AltLayer } from '@shared/config/alt-layers'
import { aliasNameFor } from '@shared/config/alias-render'
import { adoptRawBinds } from '@shared/config/bind-adoption'
import type { ConfigAction } from '@shared/modules/config'

/** Deterministic ids, so an adopted action's alias name is stable across a run. */
function idFactory(): () => string {
  let n = 0
  return () => `id${(n += 1)}`
}

function layer(overrides: Partial<AltLayer> = {}): AltLayer {
  return { id: 'l1', name: 'Alt', mode: 'hold', triggerKey: 'ALT', overrides: {}, ...overrides }
}

describe('adoptRawBinds - base binds', () => {
  it('turns a raw movement bind into that row action, keeping the bind working', () => {
    const result = adoptRawBinds({ binds: { w: '+forward' } }, idFactory())

    expect(result.adopted).toBe(1)
    expect(result.actions).toEqual([
      {
        id: 'id1',
        categoryId: 'movement',
        name: '+forward',
        kind: 'bind',
        catalogId: 'movement:forward',
        commands: [{ kind: 'raw', text: '+forward' }],
        key: 'w',
      },
    ])
    // A continuous command is bound directly (see `action-mirror.ts`), so the bind text a working
    // config already had is exactly what stays on disk.
    expect(result.binds).toEqual({ w: '+forward' })
  })

  it('folds two keys running the same command into one row two slots', () => {
    const result = adoptRawBinds({ binds: { SPACE: '+moveup', MOUSE2: '+moveup' } }, idFactory())

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.catalogId).toBe('movement:moveup')
    // Sorted key order, so which key lands in Primary is deterministic.
    expect(result.actions[0]!.key).toBe('MOUSE2')
    expect(result.actions[0]!.secondaryKey).toBe('SPACE')
    expect(result.binds).toEqual({ SPACE: '+moveup', MOUSE2: '+moveup' })
  })

  it('leaves a third key on the same command raw - a row holds two slots, not three', () => {
    const result = adoptRawBinds(
      { binds: { SPACE: '+moveup', MOUSE2: '+moveup', UPARROW: '+moveup' } },
      idFactory(),
    )

    expect(result.actions).toHaveLength(1)
    expect(result.binds['UPARROW']).toBe('+moveup')
  })

  it('mirrors a non-continuous row through its alias', () => {
    const result = adoptRawBinds({ binds: { q: 'use super shotgun' } }, idFactory())

    const adopted = result.actions[0]!
    expect(adopted.catalogId).toBe('weaponUse:use_sshotgun')
    expect(result.binds).toEqual({ q: aliasNameFor(adopted) })
  })

  it('reads a drop pair back as one row with ammo on, and a lone drop as ammo off', () => {
    const withAmmo = adoptRawBinds({ binds: { g: 'drop shotgun; drop shells' } }, idFactory())
    expect(withAmmo.actions[0]!.catalogId).toBe('dropWeapon:shotgun')
    expect(withAmmo.actions[0]!.commands).toEqual([
      { kind: 'raw', text: 'drop shotgun' },
      { kind: 'raw', text: 'drop shells' },
    ])

    const withoutAmmo = adoptRawBinds({ binds: { g: 'drop shotgun' } }, idFactory())
    expect(withoutAmmo.actions[0]!.commands).toEqual([{ kind: 'raw', text: 'drop shotgun' }])
  })

  it('resolves an ambiguous drop command to the weapon row, deterministically', () => {
    // `drop grenades` is both `dropWeapon:grenades` and `dropAmmo:hgrenades`; the flat catalogue
    // row order decides, and the weapon group comes first.
    const result = adoptRawBinds({ binds: { g: 'drop grenades' } }, idFactory())
    expect(result.actions[0]!.catalogId).toBe('dropWeapon:grenades')
  })

  it('leaves a command no catalogue row renders alone', () => {
    const binds = { x: 'kill', y: '+use', z: 'wait; +attack' }
    const result = adoptRawBinds({ binds }, idFactory())

    expect(result.adopted).toBe(0)
    expect(result.binds).toBe(binds)
    expect(result.actions).toEqual([])
  })

  it('is idempotent - a second pass changes nothing and keeps every reference', () => {
    const once = adoptRawBinds({ binds: { w: '+forward', q: 'use railgun' } }, idFactory())
    const twice = adoptRawBinds(once, idFactory())

    expect(twice.adopted).toBe(0)
    expect(twice.binds).toBe(once.binds)
    expect(twice.actions).toBe(once.actions)
  })

  it('joins an existing row rather than creating a second one for the same catalogId', () => {
    const existing: ConfigAction = {
      id: 'a1',
      categoryId: 'movement',
      name: '+forward',
      kind: 'bind',
      catalogId: 'movement:forward',
      commands: [{ kind: 'raw', text: '+forward' }],
      key: 'w',
    }

    const result = adoptRawBinds({ binds: { UPARROW: '+forward' }, actions: [existing] }, idFactory())

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.secondaryKey).toBe('UPARROW')
  })

  it('refuses to adopt into a row whose commands differ from the bind', () => {
    // The action says "drop shotgun without its ammo"; the bind drops both. Adopting would
    // change what the key does, so the entry stays raw.
    const existing: ConfigAction = {
      id: 'a1',
      categoryId: 'drops',
      name: 'drop shotgun',
      kind: 'bind',
      catalogId: 'dropWeapon:shotgun',
      commands: [{ kind: 'raw', text: 'drop shotgun' }],
      key: 'g',
    }

    const result = adoptRawBinds(
      { binds: { h: 'drop shotgun; drop shells' }, actions: [existing] },
      idFactory(),
    )

    expect(result.adopted).toBe(0)
    expect(result.actions).toEqual([existing])
    expect(result.binds['h']).toBe('drop shotgun; drop shells')
  })

  it('never adopts a value a mirror pass wrote', () => {
    const binds = { r: 'q2l_a_gone_1234' }
    expect(adoptRawBinds({ binds }, idFactory()).adopted).toBe(0)
  })

  it('never adopts a value a mirror pass wrote, prefix-free equivalent: a readable aliasName', () => {
    // Same shape as the legacy-prefix case above, but the mirrored value is a short readable
    // name (story 039) with no `q2l_a_` prefix to gate on - the key-scoped `mirrorsSlot`/alias
    // checks must still recognise it as the slot's own mirror.
    const existing: ConfigAction = {
      id: 'a1',
      categoryId: 'weapons',
      name: 'Super shotgun',
      kind: 'bind',
      catalogId: 'weaponUse:use_sshotgun',
      aliasName: 'ssg_sg',
      commands: [{ kind: 'raw', text: 'use super shotgun' }],
      key: 'q',
    }

    const result = adoptRawBinds({ binds: { q: 'ssg_sg' }, actions: [existing] }, idFactory())

    expect(result.adopted).toBe(0)
    expect(result.actions).toEqual([existing])
    expect(result.binds).toEqual({ q: 'ssg_sg' })
  })

  it('does not re-adopt an alias reference into the catalogue row sharing its name (weapnext)', () => {
    // `weapnext` is both a single-token catalogue command (`weaponExtra:weapnext`) and a legal
    // alias name - an entry actually named `weapnext` must not be swallowed by the catalogue row
    // that happens to render the identical text, on some *other* key referencing it by name.
    const weapnextAlias: ConfigAction = {
      id: 'a1',
      categoryId: 'weapons',
      name: 'weapnext',
      kind: 'alias',
      commands: [{ kind: 'raw', text: 'weapnext' }],
    }

    const result = adoptRawBinds(
      { binds: { y: 'weapnext' }, actions: [weapnextAlias] },
      idFactory(),
    )

    expect(result.adopted).toBe(0)
    expect(result.actions).toEqual([weapnextAlias])
    expect(result.binds).toEqual({ y: 'weapnext' })
  })
})

describe('adoptRawBinds - layer overrides', () => {
  it('adopts a modifier layer override as a modifier-carrying slot', () => {
    // The reported bug: `Alt+Q` dropping a weapon showed on the keyboard and left the Weapon
    // dropping row empty, because a hand-made override is not an action.
    const result = adoptRawBinds(
      { binds: {}, layers: [layer({ overrides: { q: 'drop shotgun; drop shells' } })] },
      idFactory(),
    )

    const adopted = result.actions[0]!
    expect(adopted.catalogId).toBe('dropWeapon:shotgun')
    expect(adopted.key).toBe('q')
    expect(adopted.keyModifier).toBe('ALT')
    expect(result.layers[0]!.overrides).toEqual({ q: aliasNameFor(adopted) })
  })

  it('leaves a layer whose trigger is not a modifier completely alone', () => {
    // `keyModifier` only knows ALT/CTRL/SHIFT, so an override in a layer triggered by `-` has no
    // representation in `actions` at all.
    const layers = [layer({ id: 'l2', name: 'test', triggerKey: '-', overrides: { w: '+forward' } })]
    const result = adoptRawBinds({ binds: {}, layers }, idFactory())

    expect(result.adopted).toBe(0)
    expect(result.actions).toEqual([])
    expect(result.layers).toBe(layers)
  })

  it('keeps a base slot and a modifier slot on the same row apart', () => {
    const result = adoptRawBinds(
      { binds: { g: 'drop railgun; drop slugs' }, layers: [layer({ overrides: { g: 'drop shotgun; drop shells' } })] },
      idFactory(),
    )

    const railgun = result.actions.find((a) => a.catalogId === 'dropWeapon:railgun')!
    const shotgun = result.actions.find((a) => a.catalogId === 'dropWeapon:shotgun')!
    expect(railgun.key).toBe('g')
    expect(railgun.keyModifier).toBeUndefined()
    expect(shotgun.key).toBe('g')
    expect(shotgun.keyModifier).toBe('ALT')
  })
})
