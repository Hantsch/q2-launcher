import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigCommand } from '../modules/config'
import { splitAliasBody, configCommandFor } from './alias-import'
import { isDropEntry, dropStateFor, withDropAmmo, withDropMessage } from './drop-entries'

/**
 * Builds the `ConfigCommand[]` a real import would produce for a raw alias body - same split +
 * per-segment classification `alias-import.ts#buildImportedActions` itself uses - so these fixtures
 * exercise `drop-entries.ts` against realistic bodies rather than hand-rolled `ConfigCommand` shapes.
 */
function bodyCommands(body: string): ConfigCommand[] {
  return splitAliasBody(body).map(configCommandFor)
}

/** One `kind: 'alias'` entry named `name`, rendering under `name` verbatim (`aliasName` set, exactly
 * as `alias-import.ts#buildImportedActions` does for every imported definition) with `body` as its
 * commands. */
function aliasAction(name: string, body: string): ConfigAction {
  return {
    id: name,
    categoryId: 'imported',
    name,
    kind: 'alias',
    aliasName: name,
    commands: bodyCommands(body),
  }
}

// The sixteen `drop_*` bodies, verbatim, from docs/fixtures/dmalias.cfg:86-103.
const FIXTURE_DROPS: Record<string, string> = {
  drop_shotgun: 'drop Shotgun; drop shells; say_team dropped shotgun; wave 1',
  drop_sshotgun: 'drop Super Shotgun; drop shells; say_team dropped super shotgun; wave 1',
  drop_machine: 'drop Machinegun; drop bullets; say_team dropped machinegun; wave 1',
  drop_chain: 'drop chaingun; drop bullets; say_team dropped chaingun; wave 1',
  drop_grenadel: 'drop Grenade Launcher; drop grenades; say_team dropped grenade launcher; wave 1',
  drop_rocketl: 'drop rocket launcher; drop rockets; say_team dropped rocket launcher; wave 1',
  drop_hyperb: 'drop Hyperblaster; drop cells; say_team dropped hyperblaster; wave 1',
  drop_rail: 'drop railgun; drop slugs; say_team dropped railgun; wave 1',
  drop_powers: 'drop cells;drop power shield;say_team dropped powershield;wave 1',
  drop_tech: 'say_team dropped tech;drop tech',
  drop_shells: 'drop shells;drop shells;say_team dropped shells',
  drop_bullets: 'drop bullets;drop bullets;say_team dropped bullets',
  drop_grens: 'drop grenades;drop grenades;say_team dropped grenades',
  drop_rocks: 'drop rockets;drop rockets;say_team dropped rockets',
  drop_cells: 'drop cells;drop cells;say_team dropped cells',
  drop_slugs: 'drop slugs;drop slugs;say_team dropped slugs',
}

const DALL_BODY =
  'say_team dropped everything; drop rocket launcher; drop rockets; drop railgun; drop slugs; ' +
  'drop chaingun; drop machinegun; drop bullets; drop super shotgun; drop shotgun; drop shells; ' +
  'drop hyperblaster; drop cells; drop grenade launcher; drop grenades;'

describe('isDropEntry', () => {
  it('recognises every one of the sixteen drop_* fixture bodies', () => {
    for (const [name, body] of Object.entries(FIXTURE_DROPS)) {
      expect(isDropEntry(aliasAction(name, body)), name).toBe(true)
    }
  })

  it('rejects dall even though its whole body is drop commands', () => {
    expect(isDropEntry(aliasAction('dall', DALL_BODY))).toBe(false)
  })

  it('rejects a drop_-named alias with no drop command at all', () => {
    expect(isDropEntry(aliasAction('drop_nothing', 'say_team hello; wave 1'))).toBe(false)
  })

  it('respects a user-renamed alias (aliasName wins over name)', () => {
    const action: ConfigAction = {
      id: 'a1',
      categoryId: 'imported',
      name: 'My Shotgun Drop',
      kind: 'alias',
      aliasName: 'drop_shotgun',
      commands: bodyCommands(FIXTURE_DROPS.drop_shotgun!),
    }
    expect(isDropEntry(action)).toBe(true)
  })
})

describe('dropStateFor', () => {
  it('reports item, ammo presence and message for drop_shotgun', () => {
    const state = dropStateFor(aliasAction('drop_shotgun', FIXTURE_DROPS.drop_shotgun!))
    expect(state.item).toBe('Shotgun')
    expect(state.hasAmmo).toBe(true)
    expect(state.ammo).toBe('shells')
    expect(state.itemAmmo).toBe('shells')
    expect(state.message).toBe('dropped shotgun')
    expect(state.channel).toBe('say_team')
  })

  it('reports no ammo and no known item-ammo for drop_tech', () => {
    const state = dropStateFor(aliasAction('drop_tech', FIXTURE_DROPS.drop_tech!))
    expect(state.item).toBe('tech')
    expect(state.hasAmmo).toBe(false)
    expect(state.ammo).toBeUndefined()
    expect(state.itemAmmo).toBeUndefined()
    expect(state.message).toBe('dropped tech')
  })

  it('recognises a same-named second drop as the ammo command (drop_shells)', () => {
    const state = dropStateFor(aliasAction('drop_shells', FIXTURE_DROPS.drop_shells!))
    expect(state.item).toBe('shells')
    expect(state.hasAmmo).toBe(true)
    expect(state.ammo).toBe('shells')
  })

  /**
   * Story 055 review, finding 4: the ammo toggle's pressed state and its enabled state must never
   * contradict each other. The six ammo-item drops in the fixture (`drop_shells` and siblings) are
   * exactly the shape that made them: an ammo command IS present (`hasAmmo`), while the item - an
   * ammo item itself - has no `ammo` field of its own (`itemAmmo` undefined), which is what the UI
   * used to read as "disabled". `canToggleAmmo` is the signal the toggle's disabled state comes off
   * now, and it says yes precisely because there is a command to remove.
   */
  it('keeps the ammo toggle operable for an ammo-item drop that carries an ammo command', () => {
    for (const name of ['drop_shells', 'drop_bullets', 'drop_grens', 'drop_rocks', 'drop_cells', 'drop_slugs']) {
      const state = dropStateFor(aliasAction(name, FIXTURE_DROPS[name]!))
      expect(state.hasAmmo, name).toBe(true)
      expect(state.itemAmmo, name).toBeUndefined()
      expect(state.canToggleAmmo, name).toBe(true)
    }
  })

  it('goes disabled AND unpressed once such an entry\'s ammo command is removed', () => {
    const off = withDropAmmo(aliasAction('drop_shells', FIXTURE_DROPS.drop_shells!), false)
    const state = dropStateFor(off)
    // One-way by design: nothing left to remove, and no catalogue ammo type to re-add for an ammo
    // item - but never pressed-and-disabled at the same time, which is the whole point.
    expect(state.hasAmmo).toBe(false)
    expect(state.canToggleAmmo).toBe(false)
  })

  it('reports canToggleAmmo for the two ordinary shapes: a weapon with ammo, and drop_tech', () => {
    expect(dropStateFor(aliasAction('drop_shotgun', FIXTURE_DROPS.drop_shotgun!)).canToggleAmmo).toBe(true)
    // No ammo command present and no catalogue ammo to add - the one case AC 4 asks to disable.
    expect(dropStateFor(aliasAction('drop_tech', FIXTURE_DROPS.drop_tech!)).canToggleAmmo).toBe(false)
  })

  it('reports no message when the body carries none', () => {
    const state = dropStateFor(aliasAction('drop_rail_noish', 'drop railgun; drop slugs'))
    expect(state.message).toBeUndefined()
    expect(state.channel).toBeUndefined()
    expect(state.messageIndex).toBeUndefined()
  })
})

describe('withDropAmmo / withDropMessage round-trip extras survive', () => {
  // drop_rail plus a second, unrelated `drop power shield` (not a catalogue ammo name, so it is
  // never mistaken for the ammo command - same non-ammo-item shape as drop_powers' own second `drop`
  // in the fixture) and a trailing `wave 1` - the extras AC6 asks to survive both toggles untouched
  // and in original relative order.
  const BASE_BODY = 'drop railgun; drop slugs; drop power shield; wave 1'

  function base(): ConfigAction {
    return aliasAction('drop_rail', BASE_BODY)
  }

  function rawTexts(action: ConfigAction): string[] {
    return action.commands.filter((c): c is Extract<ConfigCommand, { kind: 'raw' }> => c.kind === 'raw').map((c) => c.text)
  }

  it('withDropAmmo(off) removes only the recognised ammo command', () => {
    const off = withDropAmmo(base(), false)
    expect(rawTexts(off)).toEqual(['drop railgun', 'drop power shield', 'wave 1'])
  })

  it('withDropAmmo(off) then withDropAmmo(on) round-trips back to the original ammo command', () => {
    const off = withDropAmmo(base(), false)
    const on = withDropAmmo(off, true)
    expect(rawTexts(on)).toEqual(['drop railgun', 'drop slugs', 'drop power shield', 'wave 1'])
  })

  it('withDropAmmo(on) on an entry already carrying ammo is a no-op', () => {
    const action = base()
    const unchanged = withDropAmmo(action, true)
    expect(unchanged).toBe(action)
  })

  it('withDropAmmo(on) does nothing when the item has no known ammo (drop_tech)', () => {
    const tech = aliasAction('drop_tech', 'drop tech; wave 1')
    const on = withDropAmmo(tech, true)
    expect(on.commands).toEqual(tech.commands)
  })

  it('withDropMessage(on) inserts after the ammo command, before wave 1, leaving extras untouched', () => {
    const withMsg = withDropMessage(base(), true, 'hello team', 'say_team')
    expect(rawTexts(withMsg)).toEqual(['drop railgun', 'drop slugs', 'drop power shield', 'wave 1'])
    const state = dropStateFor(withMsg)
    expect(state.message).toBe('hello team')
    expect(state.channel).toBe('say_team')
    // inserted right after the ammo command (index 1), before the second drop power shield and wave 1
    expect(withMsg.commands[2]).toEqual({ kind: 'message', channel: 'say_team', text: 'hello team' })
  })

  it('withDropMessage(on) then withDropMessage(off) round-trips back to the original body', () => {
    const withMsg = withDropMessage(base(), true, 'hello team', 'say_team')
    const removed = withDropMessage(withMsg, false)
    expect(removed.commands).toEqual(base().commands)
  })

  it('withDropMessage(off) on an entry with no message is a no-op', () => {
    const action = base()
    const result = withDropMessage(action, false)
    expect(result).toBe(action)
  })

  it('withDropMessage(on) replaces an existing message in place rather than inserting a second one', () => {
    const withOriginalMessage = aliasAction('drop_shotgun', FIXTURE_DROPS.drop_shotgun!)
    const updated = withDropMessage(withOriginalMessage, true, 'new text', 'say')
    const messageCommands = updated.commands.filter((c) => c.kind === 'message')
    expect(messageCommands).toHaveLength(1)
    expect(messageCommands[0]).toEqual({ kind: 'message', channel: 'say', text: 'new text' })
    // extras (wave 1) still present and in place
    expect(rawTexts(updated)).toEqual(['drop Shotgun', 'drop shells', 'wave 1'])
  })

  // Story 055 review, finding 2: a body with two message commands is not something this story's own
  // entries ever produce, but a hand-written/imported one could. `dropStateFor`'s `messageIndex`
  // locks onto the FIRST one it sees, so `withDropMessage(off)` must remove that same first one -
  // matching `catalog-binds.ts#deriveRowState`, which now also reads the first message for display,
  // so a user never sees text (the second message) that turning the toggle off then fails to delete.
  it('withDropMessage(off) removes the FIRST message command when the body has two', () => {
    const action = aliasAction(
      'drop_rail',
      'drop railgun; drop slugs; say_team first; say second; wave 1',
    )
    const state = dropStateFor(action)
    expect(state.message).toBe('first')
    expect(state.channel).toBe('say_team')

    const removed = withDropMessage(action, false)
    const messageCommands = removed.commands.filter((c) => c.kind === 'message')
    expect(messageCommands).toEqual([{ kind: 'message', channel: 'say', text: 'second' }])
  })
})
