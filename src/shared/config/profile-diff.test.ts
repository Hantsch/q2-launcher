import { describe, expect, it } from 'vitest'
import type { ActionKeySlot, ConfigAction, ConfigProfile } from '../modules/config'
import type { AltLayer } from './alt-layers'
import { captureBaseline, type ProfileBaseline } from './profile-baseline'
import {
  cvarChangeKey,
  diffProfileAgainstBaseline,
  type ProfileChange,
  type ProfileChangeSection,
} from './profile-diff'

/**
 * Story 049 D2. The cases that matter here are the ones where the *file* and the *record* disagree
 * - story 048 writes a `set` line for every catalogue cvar, so a diff that compared stored maps
 * would report a change for cvars nobody touched - plus the ordering and presence traps the story's
 * Model Hints call out (unknown cvars, empty values, `"1"` vs `"1.0"`, removed binds, reordered
 * actions).
 */

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile One',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

/** A profile plus the baseline it would carry had it been saved in the `saved` state. */
function withBaseline(
  saved: Partial<ConfigProfile>,
  live: Partial<ConfigProfile> = saved,
): ConfigProfile {
  return profile({ ...live, baseline: captureBaseline(profile(saved)) })
}

function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'a1',
    categoryId: 'weapons',
    name: 'Rocket',
    kind: 'bind',
    commands: [{ kind: 'raw', text: 'use rocket launcher' }],
    ...overrides,
  }
}

/** An action whose `keys` array is exactly the given slots, in order. */
function withKeys(base: ConfigAction, ...keys: ActionKeySlot[]): ConfigAction {
  return { ...base, keys }
}

function layer(overrides: Partial<AltLayer> = {}): AltLayer {
  return {
    id: 'l1',
    name: 'Drops',
    mode: 'hold',
    triggerKey: 'ALT',
    overrides: { '1': 'drop rl' },
    ...overrides,
  }
}

/** The single change in `section`, failing loudly when there is not exactly one. */
function only(changes: ProfileChangeSet_, section: ProfileChangeSection): ProfileChange {
  const bucket = changes.sections[section] ?? []
  expect(
    bucket,
    `expected exactly one ${section} change, got ${JSON.stringify(bucket)}`,
  ).toHaveLength(1)
  return bucket[0]!
}

type ProfileChangeSet_ = ReturnType<typeof diffProfileAgainstBaseline>

describe('diffProfileAgainstBaseline - nothing pending', () => {
  it('reports no change for a profile with no baseline, dirty or not', () => {
    // A profile that has never been saved IS its own baseline (nothing pending); a legacy dirty
    // record has no saved state to measure against, and degrades to "nothing to show" rather than
    // guessing - the "no known saved state" UX keys off `profile.baseline`, not off this result.
    for (const dirty of [undefined, true]) {
      const changes = diffProfileAgainstBaseline(profile({ cvars: { sensitivity: '9' }, dirty }))
      expect(changes.count).toBe(0)
      expect(changes.changes).toEqual([])
      expect(changes.sections).toEqual({})
    }
  })

  it('reports an empty set, with every bucket absent, for a profile equal to its baseline', () => {
    const saved: Partial<ConfigProfile> = {
      cvars: { sensitivity: '4.5', totally_unknown_cvar: 'x' },
      binds: { F1: 'say gg' },
      actions: [action()],
      layers: [layer()],
      categories: [{ id: 'c1', name: 'Chat' }],
      writeUnbindall: false,
      sectionHeaderStyle: 'brackets',
      unrecognized: [{ file: 'config.cfg', line: 12, text: 'somethingodd 1' }],
    }

    const changes = diffProfileAgainstBaseline(withBaseline(saved))

    expect(changes.count).toBe(0)
    expect(changes.sections).toEqual({})
    for (const set of Object.values(changes.keys)) expect(set.size).toBe(0)
  })

  it('keeps every key set present (and empty) even with no change at all, so a row lookup needs no null check', () => {
    const changes = diffProfileAgainstBaseline(withBaseline({}))
    expect(Object.keys(changes.keys).sort()).toEqual([
      'actions',
      'binds',
      'cvars',
      'layers',
      'settings',
      'unrecognized',
    ])
  })

  it('leaves untouched sections out of the buckets when another section did change', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline({ binds: { F1: 'say gg' } }, { binds: { F1: 'say gl hf' } }),
    )
    expect(Object.keys(changes.sections)).toEqual(['binds'])
  })
})

describe('diffProfileAgainstBaseline - cvars (resolved value, story 048 always-write)', () => {
  it('reports nothing for a catalogue cvar stored at its default on one side and absent on the other', () => {
    // The file carries `set cl_run "1"` either way since 048, so the map-key difference is not a
    // difference the file has - in both directions.
    expect(diffProfileAgainstBaseline(withBaseline({}, { cvars: { cl_run: '1' } })).count).toBe(0)
    expect(diffProfileAgainstBaseline(withBaseline({ cvars: { cl_run: '1' } }, {})).count).toBe(0)
  })

  it('reports nothing for a catalogue cvar absent from both sides', () => {
    expect(diffProfileAgainstBaseline(withBaseline({ cvars: {} }, { cvars: {} })).count).toBe(0)
  })

  it('reports a real edit as changed, with before/after as the story spells them', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline({ cvars: { sensitivity: '3' } }, { cvars: { sensitivity: '4.5' } }),
    )
    expect(only(changes, 'cvars')).toEqual({
      section: 'cvars',
      kind: 'changed',
      key: 'sensitivity',
      label: 'sensitivity',
      before: '3',
      after: '4.5',
    })
  })

  it('reports an edit away from the default even when the baseline never stored the cvar', () => {
    const changes = diffProfileAgainstBaseline(withBaseline({}, { cvars: { sensitivity: '9' } }))
    expect(only(changes, 'cvars')).toMatchObject({ kind: 'changed', before: '4', after: '9' })
  })

  it('reports a cleared catalogue cvar as a change back to its default, never as a removal', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline({ cvars: { sensitivity: '9' } }, { cvars: { sensitivity: '' } }),
    )
    expect(only(changes, 'cvars')).toMatchObject({ kind: 'changed', before: '9', after: '4' })
  })

  it('does not report a numeric-equal but textually different value for a numeric catalogue cvar', () => {
    // "1" vs "1.0" - `isDefaultValue`'s own numeric rule, reused rather than re-derived.
    expect(
      diffProfileAgainstBaseline(
        withBaseline({ cvars: { sensitivity: '4.5' } }, { cvars: { sensitivity: '4.50' } }),
      ).count,
    ).toBe(0)
    expect(
      diffProfileAgainstBaseline(
        withBaseline({ cvars: { vid_gamma: '1' } }, { cvars: { vid_gamma: '1.0' } }),
      ).count,
    ).toBe(0)
  })

  it('does not report a toggle spelled differently ("true" vs "1")', () => {
    expect(
      diffProfileAgainstBaseline(
        withBaseline({ cvars: { cl_run: '0' } }, { cvars: { cl_run: 'false' } }),
      ).count,
    ).toBe(0)
  })

  it('does not report a choice cvar differing only in case, but does report a text cvar', () => {
    expect(
      diffProfileAgainstBaseline(
        withBaseline({ cvars: { skin: 'male/grunt' } }, { cvars: { skin: 'Male/Grunt' } }),
      ).count,
    ).toBe(0)
    // `name` is kind 'text' - the casing of a player's display name is the value.
    expect(
      diffProfileAgainstBaseline(
        withBaseline({ cvars: { name: 'player' } }, { cvars: { name: 'Player' } }),
      ).count,
    ).toBe(1)
  })

  it('compares the spelling that would actually be written when a profile carries two of them', () => {
    // `buildCvarSections` writes one line per catalogue cvar, the largest stored spelling winning
    // (`held.name < name`) - and lower-case sorts after upper-case, so `sensitivity` is the value
    // in the file and the value that must be compared.
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        { cvars: { sensitivity: '3', Sensitivity: '5' } },
        { cvars: { sensitivity: '4', Sensitivity: '5' } },
      ),
    )
    expect(only(changes, 'cvars')).toMatchObject({ before: '3', after: '4' })

    // ...and a change confined to the losing spelling is not in the file either.
    expect(
      diffProfileAgainstBaseline(
        withBaseline(
          { cvars: { sensitivity: '3', Sensitivity: '5' } },
          { cvars: { sensitivity: '3', Sensitivity: '6' } },
        ),
      ).count,
    ).toBe(0)
  })

  it('gives an unknown cvar presence semantics: added, removed and verbatim changed', () => {
    const added = diffProfileAgainstBaseline(withBaseline({}, { cvars: { zz_unknown: '2' } }))
    expect(only(added, 'cvars')).toEqual({
      section: 'cvars',
      kind: 'added',
      key: 'zz_unknown',
      label: 'zz_unknown',
      before: undefined,
      after: '2',
    })

    const removed = diffProfileAgainstBaseline(withBaseline({ cvars: { zz_unknown: '2' } }, {}))
    expect(only(removed, 'cvars')).toMatchObject({ kind: 'removed', before: '2', after: undefined })

    const changed = diffProfileAgainstBaseline(
      withBaseline({ cvars: { zz_unknown: '2' } }, { cvars: { zz_unknown: '3' } }),
    )
    expect(only(changed, 'cvars')).toMatchObject({ kind: 'changed', before: '2', after: '3' })
  })

  it('reports a numeric-equal but textually different unknown cvar as changed', () => {
    // Deliberate asymmetry with the catalogue case: the writer emits an unrecognized cvar's value
    // verbatim (no default substitution, no kind to normalise by), so `"1"` and `"1.0"` really are
    // two different lines - the same carve-out `stripCatalogDefaults` makes.
    const changes = diffProfileAgainstBaseline(
      withBaseline({ cvars: { zz_unknown: '1' } }, { cvars: { zz_unknown: '1.0' } }),
    )
    expect(only(changes, 'cvars')).toMatchObject({ kind: 'changed', before: '1', after: '1.0' })
  })

  it('treats an unknown cvar stored as the empty string as present, unlike a blank catalogue one', () => {
    // `set zz_unknown ""` is a line the file carries; `sensitivity: ''` is "nothing stored".
    const unknown = diffProfileAgainstBaseline(withBaseline({}, { cvars: { zz_unknown: '' } }))
    expect(only(unknown, 'cvars')).toMatchObject({ kind: 'added', after: '' })

    expect(
      diffProfileAgainstBaseline(withBaseline({}, { cvars: { sensitivity: '  ' } })).count,
    ).toBe(0)
    expect(
      diffProfileAgainstBaseline(
        withBaseline({ cvars: { zz_unknown: '' } }, { cvars: { zz_unknown: '' } }),
      ).count,
    ).toBe(0)
  })

  it('keys a change by catalogue identity, so a row looks itself up regardless of stored casing', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline({ cvars: { Sensitivity: '3' } }, { cvars: { Sensitivity: '8' } }),
    )
    expect(changes.keys.cvars.has(cvarChangeKey('SENSITIVITY'))).toBe(true)
    expect(cvarChangeKey('Sensitivity')).toBe('sensitivity')
    expect(cvarChangeKey('zz_unknown')).toBe('zz_unknown')
  })
})

describe('diffProfileAgainstBaseline - binds', () => {
  it('reports an added bind with no before, per the story\'s "F1 unbound -> say gg"', () => {
    const changes = diffProfileAgainstBaseline(withBaseline({}, { binds: { F1: 'say gg' } }))
    expect(only(changes, 'binds')).toEqual({
      section: 'binds',
      kind: 'added',
      key: 'F1',
      label: 'F1',
      before: undefined,
      after: 'say gg',
    })
  })

  it('reports a removed bind (present in the baseline, absent from the profile)', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline({ binds: { F1: 'say gg' } }, { binds: {} }),
    )
    expect(only(changes, 'binds')).toMatchObject({
      kind: 'removed',
      before: 'say gg',
      after: undefined,
    })
    expect(changes.keys.binds.has('F1')).toBe(true)
  })

  it('reports a rebound key as changed', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline({ binds: { w: '+forward' } }, { binds: { w: '+back' } }),
    )
    expect(only(changes, 'binds')).toMatchObject({
      kind: 'changed',
      before: '+forward',
      after: '+back',
    })
  })

  it('treats a blank command as no bind at all, the way the writer does', () => {
    // `bind x ""` prints the current bind instead of setting one, so `collectBindEntries` drops it.
    expect(diffProfileAgainstBaseline(withBaseline({}, { binds: { F1: '   ' } })).count).toBe(0)

    const cleared = diffProfileAgainstBaseline(
      withBaseline({ binds: { F1: 'say gg' } }, { binds: { F1: '' } }),
    )
    expect(only(cleared, 'binds')).toMatchObject({ kind: 'removed', before: 'say gg' })
  })

  it('does not care in which order the two bind maps were built', () => {
    expect(
      diffProfileAgainstBaseline(
        withBaseline(
          { binds: { w: '+forward', a: '+moveleft' } },
          { binds: { a: '+moveleft', w: '+forward' } },
        ),
      ).count,
    ).toBe(0)
  })
})

describe('diffProfileAgainstBaseline - actions', () => {
  it('reports nothing for the same actions in a different array order', () => {
    const first = action({ id: 'a1', name: 'Rocket' })
    const second = action({
      id: 'a2',
      name: 'Railgun',
      commands: [{ kind: 'raw', text: 'use railgun' }],
    })
    expect(
      diffProfileAgainstBaseline(
        withBaseline({ actions: [first, second] }, { actions: [second, first] }),
      ).count,
    ).toBe(0)
  })

  it('reports nothing when an action object is rebuilt with its keys in another order', () => {
    const saved = withKeys(action({ id: 'a1', catalogId: 'rl' }), { key: 'F1' })
    const rebuilt: ConfigAction = {
      catalogId: 'rl',
      keys: [{ key: 'F1' }],
      commands: [{ kind: 'raw', text: 'use rocket launcher' }],
      kind: 'bind',
      name: 'Rocket',
      categoryId: 'weapons',
      id: 'a1',
    }
    expect(
      diffProfileAgainstBaseline(withBaseline({ actions: [saved] }, { actions: [rebuilt] })).count,
    ).toBe(0)
  })

  it('reports an edited action as changed, with a legible before/after', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        { actions: [withKeys(action({}), { key: 'F1' })] },
        {
          actions: [
            withKeys(
              action({ commands: [{ kind: 'message', channel: 'say', text: 'gg' }] }),
              { key: 'F2' },
            ),
          ],
        },
      ),
    )
    expect(only(changes, 'actions')).toEqual({
      section: 'actions',
      kind: 'changed',
      key: 'a1',
      label: 'Rocket',
      before: 'Rocket (bind) F1: use rocket launcher',
      after: 'Rocket (bind) F2: say gg',
      details: [
        { field: 'keys', before: 'F1', after: 'F2' },
        { field: 'commands', before: 'use rocket launcher', after: 'say gg' },
      ],
    })
  })

  it('shows a modified key slot with its modifier', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        { actions: [withKeys(action({}), { key: 'r' })] },
        { actions: [withKeys(action({}), { key: 'r', modifier: 'ALT' }, { key: 'F5' })] },
      ),
    )
    expect(only(changes, 'actions')).toMatchObject({
      before: 'Rocket (bind) r: use rocket launcher',
      after: 'Rocket (bind) ALT+r, F5: use rocket launcher',
    })
  })

  it('story 050: names a change on a slot beyond index 1 (a third key)', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        { actions: [withKeys(action({}), { key: 'q' }, { key: 'e' }, { key: 'w' })] },
        { actions: [withKeys(action({}), { key: 'q' }, { key: 'e' }, { key: 'r' })] },
      ),
    )
    expect(only(changes, 'actions')).toMatchObject({
      kind: 'changed',
      key: 'a1',
      before: 'Rocket (bind) q, e, w: use rocket launcher',
      after: 'Rocket (bind) q, e, r: use rocket launcher',
    })
  })

  it('reports an added and a removed action, keyed by id', () => {
    const added = diffProfileAgainstBaseline(withBaseline({}, { actions: [action()] }))
    expect(only(added, 'actions')).toMatchObject({
      kind: 'added',
      key: 'a1',
      before: undefined,
      after: 'Rocket (bind): use rocket launcher',
    })

    const removed = diffProfileAgainstBaseline(
      withBaseline({ actions: [action()] }, { actions: [] }),
    )
    expect(only(removed, 'actions')).toMatchObject({ kind: 'removed', after: undefined })
    expect(removed.keys.actions.has('a1')).toBe(true)
  })

  it('an action change names each changed field with its own before and after', () => {
    // Story 064 AC1: the row must state the concrete old and new value per field, not two long
    // summary lines the reader has to compare by eye.
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        { actions: [withKeys(action({ name: 'Rocket' }), { key: 'F1' })] },
        {
          actions: [
            withKeys(
              action({
                name: 'Rocket launcher',
                commands: [
                  { kind: 'raw', text: 'use rocket launcher' },
                  { kind: 'message', channel: 'say', text: 'rl out' },
                ],
              }),
              { key: 'F1', modifier: 'ALT' },
            ),
          ],
        },
      ),
    )

    expect(changes.count).toBe(1)
    expect(only(changes, 'actions').details).toEqual([
      { field: 'name', before: 'Rocket', after: 'Rocket launcher' },
      { field: 'keys', before: 'F1', after: 'ALT+F1' },
      {
        field: 'commands',
        before: 'use rocket launcher',
        // One command per line, so the command that changed is not buried in a single long line.
        after: 'use rocket launcher\nsay rl out',
      },
    ])
  })

  it('reports a one-command edit as one change whose commands detail names both commands', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        { actions: [action({ commands: [{ kind: 'raw', text: 'use rocket launcher' }] })] },
        { actions: [action({ commands: [{ kind: 'raw', text: 'use bfg10k' }] })] },
      ),
    )
    expect(changes.count).toBe(1)
    expect(only(changes, 'actions').details).toEqual([
      { field: 'commands', before: 'use rocket launcher', after: 'use bfg10k' },
    ])
  })

  it('names each half of a two-part entry in its parts detail', () => {
    const base = action({
      kind: 'toggle',
      commands: [],
      parts: [
        { commands: [{ kind: 'raw', text: 'cl_run 1' }], label: 'on' },
        { commands: [{ kind: 'raw', text: 'cl_run 0' }], label: 'off' },
      ],
    })
    const edited: ConfigAction = {
      ...base,
      parts: [
        base.parts![0]!,
        {
          commands: [
            { kind: 'raw', text: 'cl_run 0' },
            { kind: 'wait', frames: 2 },
          ],
          label: 'off',
        },
      ],
    }

    const changes = diffProfileAgainstBaseline(
      withBaseline({ actions: [base] }, { actions: [edited] }),
    )
    expect(only(changes, 'actions').details).toEqual([
      {
        field: 'parts',
        before: 'on: cl_run 1\noff: cl_run 0',
        after: 'on: cl_run 1\noff: cl_run 0; wait; wait',
      },
    ])
  })

  it('a structurally different entry never falls back to canonical JSON', () => {
    // Story 064 AC3. `catalogId` reaches the file (as `cid` in the `[q2l ...]` tag) but has no place
    // in a legible summary, so both sides summarise identically - the case that used to print raw
    // canonical JSON at the reader. It now names the field instead.
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        { actions: [action({ catalogId: 'rl' })] },
        { actions: [action({ catalogId: 'bfg' })] },
      ),
    )
    const change = only(changes, 'actions')
    expect(change.kind).toBe('changed')
    expect(change.before).toBe('Rocket (bind): use rocket launcher')
    expect(change.after).toBe('Rocket (bind): use rocket launcher')
    expect(change.details).toEqual([{ field: 'catalogId', before: 'rl', after: 'bfg' }])

    // The other field that reaches the file without reaching the summary (story 041 D3).
    const kept = diffProfileAgainstBaseline(
      withBaseline(
        { actions: [action({ kind: 'alias', commands: [] })] },
        { actions: [action({ kind: 'alias', commands: [], keepEmptyAlias: true })] },
      ),
    )
    expect(only(kept, 'actions').details).toEqual([
      { field: 'keepEmptyAlias', before: undefined, after: 'true' },
    ])

    // No side of any change, and no detail of any change, is JSON in either case.
    for (const change of [...changes.changes, ...kept.changes]) {
      for (const value of [
        change.before,
        change.after,
        ...(change.details ?? []).flatMap((detail) => [detail.before, detail.after]),
      ]) {
        expect(value ?? '').not.toMatch(/[{[]"/)
      }
      expect(change.details ?? []).not.toHaveLength(0)
    }
  })
})

describe('diffProfileAgainstBaseline - layers', () => {
  it('reports nothing for the same layers in a different array order', () => {
    const first = layer({ id: 'l1' })
    const second = layer({ id: 'l2', name: 'Zoom', mode: 'toggle', triggerKey: 'v' })
    expect(
      diffProfileAgainstBaseline(
        withBaseline({ layers: [first, second] }, { layers: [second, first] }),
      ).count,
    ).toBe(0)
  })

  it("reports nothing when a layer's overrides map was rebuilt in another key order", () => {
    expect(
      diffProfileAgainstBaseline(
        withBaseline(
          { layers: [layer({ overrides: { '1': 'drop rl', '2': 'drop rg' } })] },
          { layers: [layer({ overrides: { '2': 'drop rg', '1': 'drop rl' } })] },
        ),
      ).count,
    ).toBe(0)
  })

  it('reports a renamed, retriggered or re-overridden layer as changed', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        { layers: [layer()] },
        {
          layers: [
            layer({ name: 'Drop weapons', triggerKey: null, overrides: { '1': 'drop bfg' } }),
          ],
        },
      ),
    )
    expect(only(changes, 'layers')).toEqual({
      section: 'layers',
      kind: 'changed',
      key: 'l1',
      label: 'Drop weapons',
      before: 'Drops (hold, ALT): 1=drop rl',
      after: 'Drop weapons (hold): 1=drop bfg',
      details: [
        { field: 'name', before: 'Drops', after: 'Drop weapons' },
        // An unassigned trigger has no value to state, so that side stays empty rather than
        // reading "null" - the renderer decides what to show for a side that does not exist.
        { field: 'triggerKey', before: 'ALT', after: undefined },
        { field: 'overrides', before: '1=drop rl', after: '1=drop bfg' },
      ],
    })
  })

  it('lists a layer\'s overrides one "key=command" per line, key-sorted', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        { layers: [layer({ overrides: { '2': 'drop rg', '1': 'drop rl' } })] },
        { layers: [layer({ overrides: { '1': 'drop rl', '2': 'drop bfg' } })] },
      ),
    )
    expect(only(changes, 'layers').details).toEqual([
      { field: 'overrides', before: '1=drop rl\n2=drop rg', after: '1=drop rl\n2=drop bfg' },
    ])
  })

  it('reports an added and a removed layer', () => {
    expect(
      only(diffProfileAgainstBaseline(withBaseline({}, { layers: [layer()] })), 'layers'),
    ).toMatchObject({
      kind: 'added',
      key: 'l1',
      after: 'Drops (hold, ALT): 1=drop rl',
    })
    expect(
      only(diffProfileAgainstBaseline(withBaseline({ layers: [layer()] }, {})), 'layers'),
    ).toMatchObject({ kind: 'removed', before: 'Drops (hold, ALT): 1=drop rl' })
  })
})

describe('diffProfileAgainstBaseline - per-profile settings', () => {
  it('reports a rename as a settings change (review finding: the name is pending file content)', () => {
    // A `rename` marks the profile dirty and writes nothing (story 043): the header banner still
    // carries the old name and the canonical `.cfg` is still under the old file name until a save.
    const changes = diffProfileAgainstBaseline(withBaseline({ name: 'Saved' }, { name: 'Renamed' }))

    expect(changes.count).toBe(1)
    expect(only(changes, 'settings')).toEqual({
      section: 'settings',
      kind: 'changed',
      key: 'name',
      label: 'name',
      before: 'Saved',
      after: 'Renamed',
    })
    expect(changes.keys.settings.has('name')).toBe(true)
  })

  it('reports writeUnbindall and sectionHeaderStyle as their own bucket', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        { writeUnbindall: true, sectionHeaderStyle: 'dashes' },
        { writeUnbindall: false, sectionHeaderStyle: 'plain' },
      ),
    )
    expect(changes.sections.settings).toEqual([
      {
        section: 'settings',
        kind: 'changed',
        key: 'writeUnbindall',
        label: 'writeUnbindall',
        before: 'true',
        after: 'false',
      },
      {
        section: 'settings',
        kind: 'changed',
        key: 'sectionHeaderStyle',
        label: 'sectionHeaderStyle',
        before: 'dashes',
        after: 'plain',
      },
    ])
  })

  it('compares the resolved settings, so an absent field is not a change against its default', () => {
    // `writeUnbindall` renders as on when absent, `sectionHeaderStyle` as 'dashes'.
    expect(
      diffProfileAgainstBaseline(
        withBaseline({ writeUnbindall: true, sectionHeaderStyle: 'dashes' }, {}),
      ).count,
    ).toBe(0)
    expect(
      diffProfileAgainstBaseline(
        withBaseline({}, { writeUnbindall: false, sectionHeaderStyle: 'dashes' }),
      ).count,
    ).toBe(1)
  })
})

describe('diffProfileAgainstBaseline - preserved (unrecognized) lines', () => {
  it('reports an added, a removed and a rewritten line, ordered by file and line number', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        {
          unrecognized: [
            { file: 'config.cfg', line: 12, text: 'oddity 1' },
            { file: 'config.cfg', line: 30, text: 'gone 1' },
          ],
        },
        {
          unrecognized: [
            { file: 'autoexec.cfg', line: 4, text: 'fresh 1' },
            { file: 'config.cfg', line: 12, text: 'oddity 2' },
          ],
        },
      ),
    )

    expect(changes.sections.unrecognized).toEqual([
      {
        section: 'unrecognized',
        kind: 'added',
        key: 'autoexec.cfg:4',
        label: 'autoexec.cfg:4',
        before: undefined,
        after: 'fresh 1',
      },
      {
        section: 'unrecognized',
        kind: 'changed',
        key: 'config.cfg:12',
        label: 'config.cfg:12',
        before: 'oddity 1',
        after: 'oddity 2',
      },
      {
        section: 'unrecognized',
        kind: 'removed',
        key: 'config.cfg:30',
        label: 'config.cfg:30',
        before: 'gone 1',
        after: undefined,
      },
    ])
  })

  it('does not let a repeated {file, line} swallow the line that shares it', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        {
          unrecognized: [
            { file: 'config.cfg', line: 12, text: 'first' },
            { file: 'config.cfg', line: 12, text: 'second' },
          ],
        },
        { unrecognized: [{ file: 'config.cfg', line: 12, text: 'first' }] },
      ),
    )
    expect(only(changes, 'unrecognized')).toMatchObject({
      kind: 'removed',
      key: 'config.cfg:12#2',
      before: 'second',
    })
  })
})

describe('diffProfileAgainstBaseline - the whole change set', () => {
  it('carries every section at once, in section order, with matching buckets, keys and count', () => {
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        {
          cvars: { sensitivity: '3' },
          binds: { F1: 'say gg' },
          actions: [action()],
          layers: [layer()],
          writeUnbindall: true,
          unrecognized: [{ file: 'config.cfg', line: 12, text: 'oddity 1' }],
        },
        {
          cvars: { sensitivity: '4.5' },
          binds: { F1: 'say gl hf' },
          actions: [action({ name: 'RL' })],
          layers: [layer({ name: 'Weapon drops' })],
          writeUnbindall: false,
          unrecognized: [],
        },
      ),
    )

    expect(changes.changes.map((change) => change.section)).toEqual([
      'cvars',
      'binds',
      'actions',
      'layers',
      'settings',
      'unrecognized',
    ])
    expect(changes.count).toBe(6)
    expect(
      changes.changes.filter((change) => change.before === undefined && change.after === undefined),
    ).toEqual([])
    for (const [section, bucket] of Object.entries(changes.sections)) {
      expect(bucket!.map((change) => change.key).sort()).toEqual(
        [...changes.keys[section as ProfileChangeSection]].sort(),
      )
    }
  })

  it('details do not change the change count or which entries are reported', () => {
    // Story 064 AC4: five changed fields on one action and three on one layer are still one row
    // each. The tab badge, the per-row unsaved indicators and Discard all read `count`/`keys`, so a
    // field-level split would inflate all three.
    const changes = diffProfileAgainstBaseline(
      withBaseline(
        {
          cvars: { sensitivity: '3' },
          binds: { F1: 'say gg' },
          actions: [withKeys(action({ catalogId: 'rl', aliasName: '+rl' }), { key: 'F1' })],
          layers: [layer()],
          writeUnbindall: true,
          unrecognized: [{ file: 'config.cfg', line: 12, text: 'oddity 1' }],
        },
        {
          cvars: { sensitivity: '4.5' },
          binds: { F1: 'say gl hf' },
          actions: [
            withKeys(
              action({
                name: 'RL',
                catalogId: 'bfg',
                aliasName: '+bfg',
                commands: [{ kind: 'message', channel: 'say', text: 'boom' }],
              }),
              { key: 'F2' },
            ),
          ],
          layers: [
            layer({ name: 'Weapon drops', triggerKey: 'v', overrides: { '1': 'drop bfg' } }),
          ],
          writeUnbindall: false,
          unrecognized: [{ file: 'config.cfg', line: 12, text: 'oddity 2' }],
        },
      ),
    )

    expect(changes.count).toBe(6)
    expect(changes.changes.map((change) => `${change.section}/${change.key}`)).toEqual([
      'cvars/sensitivity',
      'binds/F1',
      'actions/a1',
      'layers/l1',
      'settings/writeUnbindall',
      'unrecognized/config.cfg:12',
    ])
    expect(only(changes, 'actions').details).toHaveLength(5)
    expect(only(changes, 'layers').details).toHaveLength(3)
    for (const [section, bucket] of Object.entries(changes.sections)) {
      expect(bucket!.map((change) => change.key).sort()).toEqual(
        [...changes.keys[section as ProfileChangeSection]].sort(),
      )
    }
    // ...and only the two summary-line sections carry details at all: elsewhere the row already
    // states the value itself, so a field breakdown would just restate it.
    for (const change of changes.changes) {
      expect(change.details === undefined).toBe(
        change.section !== 'actions' && change.section !== 'layers',
      )
    }
  })

  it('does not mutate the profile or its baseline', () => {
    const live = withBaseline({ cvars: { sensitivity: '3' } }, { cvars: { sensitivity: '9' } })
    const before = JSON.stringify(live)
    diffProfileAgainstBaseline(live)
    expect(JSON.stringify(live)).toBe(before)
  })

  it('measures against the stored baseline, not against a re-capture of the live profile', () => {
    const baseline: ProfileBaseline = captureBaseline(profile({ cvars: { sensitivity: '3' } }))
    const live = profile({ cvars: { sensitivity: '3' }, baseline })
    expect(diffProfileAgainstBaseline(live).count).toBe(0)
    expect(diffProfileAgainstBaseline({ ...live, cvars: { sensitivity: '4' } }).count).toBe(1)
  })
})
