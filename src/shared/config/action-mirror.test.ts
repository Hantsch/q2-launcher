import { describe, expect, it } from 'vitest'
import { aliasNameFor } from '@shared/config/alias-render'
import { applyActionBindMirror, bindValueFor, isMirroredValue } from '@shared/config/action-mirror'
import type { ActionKeySlot, ConfigAction } from '@shared/modules/config'

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

/** Builds `action`'s `keys` array from a sparse list of slots - `undefined` entries are skipped, so
 * a caller can express "no primary slot, only a secondary one" as `keySlots(undefined, slot)`. */
function keySlots(...slots: (ActionKeySlot | undefined)[]): ActionKeySlot[] {
  return slots.filter((slot): slot is ActionKeySlot => slot !== undefined)
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

  // Story 039 D4: once an alias name is prefix-free, a mirrored value and a hand-typed reference
  // to that same alias by name are byte-for-byte identical. The `key` argument is what tells them
  // apart - a value only counts as a mirror when the action that would have written it actually
  // holds the key it was found on.
  describe('scoped to a key', () => {
    function ssgSg(overrides: Partial<ConfigAction> = {}): ConfigAction {
      return action({
        id: 'ssg',
        categoryId: 'weapons',
        name: 'SSG + SG',
        aliasName: 'ssg_sg',
        keys: keySlots({ key: 'q' }),
        commands: [
          { kind: 'raw', text: 'use super shotgun' },
          { kind: 'raw', text: 'use shotgun' },
        ],
        ...overrides,
      })
    }

    it('owns its value on the key it actually holds, in either slot', () => {
      const primary = ssgSg({ keys: keySlots({ key: 'q' }) })
      expect(isMirroredValue('ssg_sg', [primary], 'q')).toBe(true)

      // The key sits in the second slot this time - slot identity comes from array order, not from
      // a fixed "primary"/"secondary" field (story 050), so `holdsKey` must check every slot.
      const secondary = ssgSg({ keys: keySlots({ key: '' }, { key: 'mouse3' }) })
      expect(isMirroredValue('ssg_sg', [secondary], 'MOUSE3')).toBe(true)
    })

    it('does not swallow a hand-typed reference to another entry\'s alias by name', () => {
      // `bound` owns `q`; the value `ssg_sg` also happens to be sitting on key `z`, but `bound`
      // does not hold `z` in any slot, so that `z` entry is not `bound`'s mirror - it is a
      // hand-typed reference to `bound`'s alias, and must be reported as such, not hidden.
      const bound = ssgSg({ keys: keySlots({ key: 'q' }) })
      expect(isMirroredValue('ssg_sg', [bound], 'z')).toBe(false)
    })

    it('falls back to the old, unscoped behaviour when no key is given', () => {
      const bound = ssgSg({ keys: keySlots({ key: 'q' }) })
      expect(isMirroredValue('ssg_sg', [bound])).toBe(true)
    })
  })
})

describe('applyActionBindMirror', () => {
  it('writes one entry per non-modifier slot and normalizes the key', () => {
    const jump = action({
      name: '+moveup',
      catalogId: 'movement:moveup',
      commands: [{ kind: 'raw', text: '+moveup' }],
      keys: keySlots({ key: 'space' }, { key: 'mouse2' }),
    })

    expect(applyActionBindMirror({}, [jump])).toEqual({ SPACE: '+moveup', MOUSE2: '+moveup' })
  })

  it('writes a third slot too, not just the first two', () => {
    const jump = action({
      name: '+moveup',
      catalogId: 'movement:moveup',
      commands: [{ kind: 'raw', text: '+moveup' }],
      keys: keySlots({ key: 'space' }, { key: 'mouse2' }, { key: 'j' }),
    })

    expect(applyActionBindMirror({}, [jump])).toEqual({
      SPACE: '+moveup',
      MOUSE2: '+moveup',
      j: '+moveup',
    })
  })

  it('skips a slot that carries a modifier - that one belongs to its layer', () => {
    const altBound = action({
      catalogId: 'movement:forward',
      keys: keySlots({ key: 'r', modifier: 'ALT' }),
    })
    expect(applyActionBindMirror({}, [altBound])).toEqual({})
  })

  it('skips an alias entry outright', () => {
    const aliasEntry = action({ kind: 'alias', name: '+test', keys: keySlots({ key: 'r' }) })
    expect(applyActionBindMirror({}, [aliasEntry])).toEqual({})
  })

  it('strips a previous action own direct mirror when the slot is gone, keeping hand-typed binds', () => {
    const before = action({ catalogId: 'movement:forward', keys: keySlots({ key: 'w' }) })
    const binds = { w: '+forward', x: 'kill', UPARROW: '+forward' }

    // The row was cleared in the Controls grid: it is no longer in `actions` at all.
    const next = applyActionBindMirror(binds, [], [before])

    expect(next).toEqual({ x: 'kill', UPARROW: '+forward' })
  })

  it('strips every q2l_a_* entry regardless of which action wrote it', () => {
    expect(applyActionBindMirror({ r: 'q2l_a_gone_1234', x: 'kill' }, [])).toEqual({ x: 'kill' })
  })

  // Story 039 D3: the prefix stops being the ownership test. These cases carry an explicit,
  // prefix-free `aliasName`, so every one of them fails if the strip ever falls back to
  // `startsWith(LEGACY_ACTION_ALIAS_PREFIX)` alone (nothing here starts with `q2l_a_`), and the
  // hand-typed `z: 'ssg_sg'` fails if the value-based half is ever applied without its key scope.
  describe('with prefix-free alias names', () => {
    function ssgSg(overrides: Partial<ConfigAction> = {}): ConfigAction {
      return action({
        id: 'ssg',
        categoryId: 'weapons',
        name: 'SSG + SG',
        aliasName: 'ssg_sg',
        commands: [
          { kind: 'raw', text: 'use super shotgun' },
          { kind: 'raw', text: 'use shotgun' },
        ],
        ...overrides,
      })
    }

    it('mirrors under the readable name, not a generated one', () => {
      expect(bindValueFor(ssgSg())).toBe('ssg_sg')
      expect(applyActionBindMirror({}, [ssgSg({ keys: keySlots({ key: 'q' }) })])).toEqual({
        q: 'ssg_sg',
      })
    })

    it('leaves hand-typed binds alone, including a hand-typed reference to the alias itself', () => {
      const bound = ssgSg({ keys: keySlots({ key: 'q' }) })
      // `z` holds the very value the mirror writes for `q` - hand-typed by the user on a key this
      // action does not own, so it is not ours to remove.
      const binds = { q: 'ssg_sg', r: '+attack', x: 'some_alias', z: 'ssg_sg' }

      expect(applyActionBindMirror(binds, [bound], [bound])).toEqual({
        q: 'ssg_sg',
        r: '+attack',
        x: 'some_alias',
        z: 'ssg_sg',
      })
    })

    it('clears the bind of a slot the user cleared in the Controls grid', () => {
      const before = ssgSg({ keys: keySlots({ key: 'q' }) })
      const cleared = ssgSg({ keys: [] })

      expect(applyActionBindMirror({ q: 'ssg_sg', r: '+attack' }, [cleared], [before])).toEqual({
        r: '+attack',
      })
    })

    it('drops the base bind of a slot that just gained a modifier', () => {
      // The layer mirror picks this slot up instead (`modifier-layers.test.ts` asserts the other
      // half of the same save); what must not happen is the key staying bound in both places.
      const before = ssgSg({ keys: keySlots({ key: 'q' }) })
      const modified = ssgSg({ keys: keySlots({ key: 'q', modifier: 'ALT' }) })

      expect(applyActionBindMirror({ q: 'ssg_sg', z: 'ssg_sg' }, [modified], [before])).toEqual({
        z: 'ssg_sg',
      })
    })

    it('leaves nothing behind when the action is deleted', () => {
      const before = ssgSg({ keys: keySlots({ key: 'q' }, { key: 'MOUSE3' }) })

      expect(
        applyActionBindMirror({ q: 'ssg_sg', MOUSE3: 'ssg_sg', r: '+attack' }, [], [before]),
      ).toEqual({ r: '+attack' })
    })

    it('mirrors an unmodified third slot into binds, and a modified third slot is skipped here', () => {
      // Story 050, D3's acceptance criterion: slot index 2 (a third key) is not a special case -
      // the mirror loops over every slot the accessor returns, not just the first two.
      const unmodified = ssgSg({
        keys: keySlots({ key: 'q' }, { key: 'MOUSE3' }, { key: 'k' }),
      })
      expect(applyActionBindMirror({}, [unmodified])).toEqual({
        q: 'ssg_sg',
        MOUSE3: 'ssg_sg',
        k: 'ssg_sg',
      })

      const modifiedThird = ssgSg({
        keys: keySlots({ key: 'q' }, { key: 'MOUSE3' }, { key: 'k', modifier: 'ALT' }),
      })
      expect(applyActionBindMirror({}, [modifiedThird])).toEqual({
        q: 'ssg_sg',
        MOUSE3: 'ssg_sg',
      })
    })
  })

  it('lets the later action win when two claim one key', () => {
    const first = action({ id: 'a1', catalogId: 'movement:forward', keys: keySlots({ key: 'f' }) })
    const second = action({
      id: 'a2',
      name: '+back',
      catalogId: 'movement:back',
      commands: [{ kind: 'raw', text: '+back' }],
      keys: keySlots({ key: 'f' }),
    })

    expect(applyActionBindMirror({}, [first, second])).toEqual({ f: '+back' })
  })
})
