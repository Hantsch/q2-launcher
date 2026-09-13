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
        keys: [{ key: 'w' }],
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
    // Sorted key order, so which key lands in the first slot is deterministic.
    expect(result.actions[0]!.keys).toEqual([{ key: 'MOUSE2' }, { key: 'SPACE' }])
    expect(result.binds).toEqual({ SPACE: '+moveup', MOUSE2: '+moveup' })
  })

  it('appends a third key on the same command as a new slot rather than leaving it raw (story 050)', () => {
    const result = adoptRawBinds(
      { binds: { SPACE: '+moveup', MOUSE2: '+moveup', UPARROW: '+moveup' } },
      idFactory(),
    )

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.keys).toEqual([
      { key: 'MOUSE2' },
      { key: 'SPACE' },
      { key: 'UPARROW' },
    ])
    expect(result.binds).toEqual({ SPACE: '+moveup', MOUSE2: '+moveup', UPARROW: '+moveup' })
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
      keys: [{ key: 'w' }],
    }

    const result = adoptRawBinds({ binds: { UPARROW: '+forward' }, actions: [existing] }, idFactory())

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.keys).toEqual([{ key: 'w' }, { key: 'UPARROW' }])
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
      keys: [{ key: 'g' }],
    }

    const result = adoptRawBinds(
      { binds: { h: 'drop shotgun; drop shells' }, actions: [existing] },
      idFactory(),
    )

    expect(result.adopted).toBe(0)
    expect(result.actions).toEqual([existing])
    expect(result.binds['h']).toBe('drop shotgun; drop shells')
  })

  it('joins a hand-made entry whose alias name the minted row would have taken (story 050)', () => {
    // No `catalogId` to match on, but "Drop rockets" slugs to the same alias name the row's own
    // command text does (`drop_rockets`). Minting would write that `alias` line twice - one entry
    // for the engine, one entry for the reader (`groupEntryLines` groups by exactly that name),
    // and the hand-made one's display name gone. The raw bind is a second key on it instead.
    const existing: ConfigAction = {
      id: 'a1',
      categoryId: 'drops',
      name: 'Drop rockets',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'drop rockets' }],
      keys: [{ key: '1' }],
    }

    const result = adoptRawBinds({ binds: { g: 'drop rockets' }, actions: [existing] }, idFactory())

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.name).toBe('Drop rockets')
    expect(result.actions[0]!.keys).toEqual([{ key: '1' }, { key: 'g' }])
    expect(result.binds['g']).toBe(aliasNameFor(existing))
  })

  it('leaves the raw bind raw when the entry owning that alias name runs something else', () => {
    // Same name collision, different commands: adopting would change what the key does, minting
    // would duplicate the alias name. Neither is allowed, so the line stays a raw bind.
    const existing: ConfigAction = {
      id: 'a1',
      categoryId: 'drops',
      name: 'Drop rockets',
      kind: 'bind',
      commands: [{ kind: 'raw', text: 'drop rockets' }, { kind: 'raw', text: 'say dropped' }],
      keys: [{ key: '1' }],
    }
    const binds = { g: 'drop rockets' }

    const result = adoptRawBinds({ binds, actions: [existing] }, idFactory())

    expect(result.adopted).toBe(0)
    expect(result.actions).toEqual([existing])
    expect(result.binds).toBe(binds)
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
      keys: [{ key: 'q' }],
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
    expect(adopted.keys).toEqual([{ key: 'q', modifier: 'ALT' }])
    expect(result.layers[0]!.overrides).toEqual({ q: aliasNameFor(adopted) })
  })

  it('leaves a layer whose trigger is not a modifier completely alone', () => {
    // A slot's `modifier` only knows ALT/CTRL/SHIFT, so an override in a layer triggered by `-`
    // has no representation in `actions` at all.
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
    expect(railgun.keys).toEqual([{ key: 'g' }])
    expect(shotgun.keys).toEqual([{ key: 'g', modifier: 'ALT' }])
  })
})
