import { describe, expect, it } from 'vitest'
import { aliasNameFor } from '@shared/config/alias-render'
import { applyActionBindMirror, bindValueFor, isMirroredValue } from '@shared/config/action-mirror'
import type { ConfigAction } from '@shared/modules/config'

function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'a1',
    categoryId: 'movement',
    name: '+forward',
    kind: 'bind',
    commands: [{ kind: 'raw', text: '+forward' }],
    ...overrides,
  }
}

describe('bindValueFor', () => {
  it('binds a continuous catalogue row directly to its own command', () => {
    // The engine only sends the `-command` on key-up when the bind string itself starts with
    // `+` (`keys.c`), so routing `+forward` through an alias would stick the key down.
    expect(bindValueFor(action({ catalogId: 'movement:forward' }))).toBe('+forward')
  })

  it('uses the alias for a catalogue row that is not a bare press/release command', () => {
    const useShotgun = action({
      categoryId: 'weapons',
      name: 'use shotgun',
      catalogId: 'weaponUse:use_shotgun',
      commands: [{ kind: 'raw', text: 'use shotgun' }],
    })
    expect(bindValueFor(useShotgun)).toBe(aliasNameFor(useShotgun))
  })

  it('uses the alias for a catalogue row with more than one command', () => {
    const dropShotgun = action({
      categoryId: 'drops',
      name: 'drop shotgun',
      catalogId: 'dropWeapon:shotgun',
      commands: [
        { kind: 'raw', text: 'drop shotgun' },
        { kind: 'raw', text: 'drop shells' },
      ],
    })
    expect(bindValueFor(dropShotgun)).toBe(aliasNameFor(dropShotgun))
  })

  it('uses the alias for a hand-written action carrying a +command (no catalogId)', () => {
    // Deliberately narrow: only a catalogue row's command text is unique per row, which is what
    // makes the mirrors' value-based strip passes safe.
    const freeForm = action({ catalogId: undefined })
    expect(bindValueFor(freeForm)).toBe(aliasNameFor(freeForm))
  })
})

describe('isMirroredValue', () => {
  it('recognises both mirror shapes and nothing else', () => {
    const movement = action({ catalogId: 'movement:forward' })
    const message = action({
      id: 'a2',
      name: 'Help',
      commands: [{ kind: 'message', channel: 'say_team', text: 'help' }],
    })
    const actions = [movement, message]

    expect(isMirroredValue('+forward', actions)).toBe(true)
    expect(isMirroredValue(aliasNameFor(message), actions)).toBe(true)
    expect(isMirroredValue('kill', actions)).toBe(false)
    expect(isMirroredValue('', actions)).toBe(false)
  })
})

describe('applyActionBindMirror', () => {
  it('writes one entry per non-modifier slot and normalizes the key', () => {
    const jump = action({
      name: '+moveup',
      catalogId: 'movement:moveup',
      commands: [{ kind: 'raw', text: '+moveup' }],
      key: 'space',
      secondaryKey: 'mouse2',
    })

    expect(applyActionBindMirror({}, [jump])).toEqual({ SPACE: '+moveup', MOUSE2: '+moveup' })
  })

  it('skips a slot that carries a modifier - that one belongs to its layer', () => {
    const altBound = action({ catalogId: 'movement:forward', key: 'r', keyModifier: 'ALT' })
    expect(applyActionBindMirror({}, [altBound])).toEqual({})
  })

  it('skips an alias entry outright', () => {
    const aliasEntry = action({ kind: 'alias', name: '+test', key: 'r' })
    expect(applyActionBindMirror({}, [aliasEntry])).toEqual({})
  })

  it('strips a previous action own direct mirror when the slot is gone, keeping hand-typed binds', () => {
    const before = action({ catalogId: 'movement:forward', key: 'w' })
    const binds = { w: '+forward', x: 'kill', UPARROW: '+forward' }

    // The row was cleared in the Controls grid: it is no longer in `actions` at all.
    const next = applyActionBindMirror(binds, [], [before])

    expect(next).toEqual({ x: 'kill', UPARROW: '+forward' })
  })

  it('strips every q2l_a_* entry regardless of which action wrote it', () => {
    expect(applyActionBindMirror({ r: 'q2l_a_gone_1234', x: 'kill' }, [])).toEqual({ x: 'kill' })
  })

  it('lets the later action win when two claim one key', () => {
    const first = action({ id: 'a1', catalogId: 'movement:forward', key: 'f' })
    const second = action({
      id: 'a2',
      name: '+back',
      catalogId: 'movement:back',
      commands: [{ kind: 'raw', text: '+back' }],
      key: 'f',
    })

    expect(applyActionBindMirror({}, [first, second])).toEqual({ f: '+back' })
  })
})
