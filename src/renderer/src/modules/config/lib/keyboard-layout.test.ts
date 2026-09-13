import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import { aliasNameFor } from '@shared/config/alias-render'
import { resolveAliasChain } from './keyboard-layout'

/**
 * Story 015 D8: proves the Overview's alias-chain expansion still works for a
 * two-key action (decision 1 mirrors `key` and `secondaryKey` onto the same
 * generated alias). `resolveAliasChain` takes the *bind command string*, not a
 * key, and both keys' `profile.binds` entries hold the identical alias name
 * (see `profiles.ts#setActions`, tested by D1) - so there is only one distinct
 * input to resolve here, not two. This test exercises that one call and
 * documents why a second, "other key" call would be redundant rather than
 * implying it covers something it does not.
 */
function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'ab12cd34-0000-0000-0000-000000000000',
    categoryId: 'drops',
    name: 'Rocket Launcher',
    kind: 'bind',
    commands: [{ kind: 'raw', text: 'drop rl' }],
    ...overrides,
  }
}

describe('resolveAliasChain (story 015: dual-bound drop row)', () => {
  it('resolves a two-key action alias to its full command list from the alias name alone', () => {
    const dropRow = action({
      catalogId: 'dropWeapon:rlauncher',
      keys: [{ key: 'r' }, { key: 'PGUP' }],
      commands: [
        { kind: 'raw', text: 'drop rocket launcher' },
        { kind: 'raw', text: 'drop rockets' },
        { kind: 'message', channel: 'say_team', text: 'need ammo' },
      ],
    })

    // Both `bind r <alias>` and `bind PGUP <alias>` mirror the identical alias
    // name (D1) - so resolving "the bind command for either key" is the same
    // single call: `resolveAliasChain(aliasNameFor(dropRow), [dropRow])`.
    const resolved = resolveAliasChain(aliasNameFor(dropRow), [dropRow])

    expect(resolved).toEqual(['drop rocket launcher', 'drop rockets', 'say_team need ammo'])
  })

  /**
   * Story 039, D5: the prefix gate (`startsWith(ACTION_ALIAS_PREFIX)`) is gone - the lookup goes
   * straight to `actions` by `aliasNameFor`, so a short readable name with no `q2l_a_` prefix at
   * all resolves exactly the same way a legacy generated name did.
   */
  it('expands bind q "ssg_sg" to the entry\'s command lines when aliasName is a readable name', () => {
    const ssgRow = action({
      catalogId: 'weaponUse:use_sshotgun',
      aliasName: 'ssg_sg',
      keys: [{ key: 'q' }],
      commands: [{ kind: 'raw', text: 'use super shotgun' }],
    })

    const resolved = resolveAliasChain('ssg_sg', [ssgRow])

    expect(resolved).toEqual(['use super shotgun'])
  })

  it('falls through to the plain ";" split for a bind value that is not any action\'s alias name', () => {
    const ssgRow = action({
      catalogId: 'weaponUse:use_sshotgun',
      aliasName: 'ssg_sg',
      keys: [{ key: 'q' }],
      commands: [{ kind: 'raw', text: 'use super shotgun' }],
    })

    // "weapnext" is an unknown token here - no action in the list resolves to it - so it must
    // fall through to the plain `;` split, not be swallowed or misread as an alias reference.
    const resolved = resolveAliasChain('weapnext', [ssgRow])

    expect(resolved).toEqual(['weapnext'])
  })

  /**
   * Story 045, D10: a toggle binds to its dispatch alias name (`aliasNameFor`), same as a plain
   * `kind: 'alias'` action - the story's own acceptance line ("key V ... reads Zoom with both
   * state labels, not zoom_s1") is what this pins: one returned step naming the entry plus both
   * state labels, not the raw dispatch/state alias text.
   */
  it('resolves a toggle bind to its own name plus both state labels, in one step', () => {
    const zoom = action({
      kind: 'toggle',
      name: 'Zoom',
      aliasName: 'zoom',
      commands: [],
      parts: [
        { commands: [{ kind: 'raw', text: 'zoom_fov' }], label: 'In' },
        { commands: [{ kind: 'raw', text: 'norm_fov' }], label: 'Out' },
      ],
    })

    const resolved = resolveAliasChain('zoom', [zoom])

    expect(resolved).toEqual(['Zoom: In / Out'])
  })

  it('falls back to a placeholder label for a toggle state with no label or aliasName', () => {
    const zoom = action({
      kind: 'toggle',
      name: 'Zoom',
      aliasName: 'zoom',
      commands: [],
      parts: [
        { commands: [{ kind: 'raw', text: 'zoom_fov' }] },
        { commands: [{ kind: 'raw', text: 'norm_fov' }] },
      ],
    })

    const resolved = resolveAliasChain('zoom', [zoom])

    expect(resolved).toEqual(['Zoom: State 1 / State 2'])
  })

  /**
   * Story 045, D10: a press/release entry's bind value is its `+base` form (`bindValueFor`), not
   * its sign-free `aliasNameFor` - the lookup has to match on `bindValueFor` too, or a real key's
   * bind value never finds the action at all.
   */
  it('resolves a press/release bind (its "+base" bind value) to its own name', () => {
    const slow = action({
      kind: 'press-release',
      name: 'slow',
      aliasName: 'slow',
      commands: [],
      parts: [
        { commands: [{ kind: 'raw', text: 'cl_forwardspeed 110' }] },
        { commands: [{ kind: 'raw', text: 'cl_forwardspeed 200' }] },
      ],
    })

    const resolved = resolveAliasChain('+slow', [slow])

    expect(resolved).toEqual(['slow'])
  })
})
