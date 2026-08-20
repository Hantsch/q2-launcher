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
      key: 'r',
      secondaryKey: 'PGUP',
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
})
