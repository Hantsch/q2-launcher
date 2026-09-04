import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '../modules/config'
import { captureBaseline, type ProfileBaseline } from './profile-baseline'

/** Exactly the render-relevant subset story 049 decided on - the list this whole module is. */
const BASELINE_FIELDS: readonly (keyof ProfileBaseline)[] = [
  'actions',
  'binds',
  'categories',
  'cvars',
  'layers',
  'name',
  'sectionHeaderStyle',
  'unrecognized',
  'writeUnbindall',
]

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

/** A profile with every optional, render-relevant field populated. */
function fullProfile(): ConfigProfile {
  return profile({
    cvars: { sensitivity: '4.5' },
    binds: { w: '+forward' },
    layers: [
      { id: 'l1', name: 'Alt', mode: 'hold', triggerKey: 'ALT', overrides: { r: '+attack' } },
    ],
    categories: [{ id: 'c1', name: 'Chat' }],
    actions: [
      {
        id: 'a1',
        categoryId: 'c1',
        name: 'gg',
        kind: 'message',
        commands: [{ kind: 'message', channel: 'say', text: 'gg' }],
        keys: [{ key: 'F1' }],
      },
    ],
    writeUnbindall: false,
    sectionHeaderStyle: 'brackets',
    unrecognized: [{ file: 'config.cfg', line: 12, text: 'somethingodd 1' }],
  })
}

describe('captureBaseline', () => {
  it('captures exactly the render-relevant subset, and nothing else', () => {
    const captured = captureBaseline(
      // Fields outside the subset are deliberately present here: the assertion below is that none
      // of them - including a previously stored `baseline`, which must never nest inside itself -
      // makes it into the snapshot.
      {
        ...fullProfile(),
        fileHash: 'abc',
        fileSeenAt: 1,
        dirty: true,
        fileState: 'unchanged',
        baseline: captureBaseline(profile()),
      },
    )

    expect(Object.keys(captured).sort()).toEqual([...BASELINE_FIELDS])
    expect(captured).toEqual({
      name: 'Profile One',
      cvars: { sensitivity: '4.5' },
      binds: { w: '+forward' },
      layers: [
        { id: 'l1', name: 'Alt', mode: 'hold', triggerKey: 'ALT', overrides: { r: '+attack' } },
      ],
      categories: [{ id: 'c1', name: 'Chat' }],
      actions: [
        {
          id: 'a1',
          categoryId: 'c1',
          name: 'gg',
          kind: 'message',
          commands: [{ kind: 'message', channel: 'say', text: 'gg' }],
          keys: [{ key: 'F1' }],
        },
      ],
      writeUnbindall: false,
      sectionHeaderStyle: 'brackets',
      unrecognized: [{ file: 'config.cfg', line: 12, text: 'somethingodd 1' }],
    })
  })

  it('normalises the optional fields a profile may simply not carry', () => {
    // A never-edited profile straight out of `create()`: no layers, no categories, no actions, no
    // unrecognized lines, and neither of the two per-profile settings. The snapshot resolves each
    // to what a render would use, so a later `layers: []` cannot read as a change.
    expect(captureBaseline(profile())).toEqual({
      name: 'Profile One',
      cvars: {},
      binds: {},
      layers: [],
      categories: [],
      actions: [],
      writeUnbindall: true,
      sectionHeaderStyle: 'dashes',
      unrecognized: [],
    })
  })

  it('is a deep copy: later mutation of the live profile cannot reach the snapshot', () => {
    const live = fullProfile()
    const captured = captureBaseline(live)

    live.cvars.sensitivity = '9'
    live.cvars.crosshair = '1'
    live.binds.w = 'kill'
    delete live.binds.w
    live.layers![0]!.overrides.r = 'kill'
    live.layers![0]!.name = 'Renamed'
    live.layers!.push({ id: 'l2', name: 'Ctrl', mode: 'toggle', triggerKey: null, overrides: {} })
    live.categories![0]!.name = 'Renamed'
    live.categories!.pop()
    const firstCommand = live.actions![0]!.commands[0]!
    if (firstCommand.kind === 'raw' || firstCommand.kind === 'message') firstCommand.text = 'bg'
    live.actions![0]!.keys = [{ key: 'F2' }]
    live.actions!.length = 0
    live.unrecognized![0]!.text = 'changed'
    live.unrecognized!.push({ file: 'x.cfg', line: 1, text: 'more' })

    expect(captured).toEqual(captureBaseline(fullProfile()))
  })

  it('does not share containers with the profile it captured', () => {
    const live = fullProfile()
    const captured = captureBaseline(live)

    expect(captured.cvars).not.toBe(live.cvars)
    expect(captured.binds).not.toBe(live.binds)
    expect(captured.layers).not.toBe(live.layers)
    expect(captured.layers[0]).not.toBe(live.layers![0])
    expect(captured.layers[0]!.overrides).not.toBe(live.layers![0]!.overrides)
    expect(captured.categories).not.toBe(live.categories)
    expect(captured.categories[0]).not.toBe(live.categories![0])
    expect(captured.actions).not.toBe(live.actions)
    expect(captured.actions[0]).not.toBe(live.actions![0])
    expect(captured.actions[0]!.commands).not.toBe(live.actions![0]!.commands)
    expect(captured.actions[0]!.commands[0]).not.toBe(live.actions![0]!.commands[0])
    expect(captured.unrecognized).not.toBe(live.unrecognized)
    expect(captured.unrecognized[0]).not.toBe(live.unrecognized![0])
  })

  it('reads `writeUnbindall` the way the writer does - absent means on, only `false` means off', () => {
    expect(captureBaseline(profile()).writeUnbindall).toBe(true)
    expect(captureBaseline(profile({ writeUnbindall: true })).writeUnbindall).toBe(true)
    expect(captureBaseline(profile({ writeUnbindall: false })).writeUnbindall).toBe(false)
  })

  it('captures the profile name - a rename is pending file content, not just a list label', () => {
    // `render.ts`'s `buildHeaderBlock` prints the name in the file's header banner, and the save
    // renames the canonical `.cfg` to match, so a snapshot without it could not describe the file.
    expect(captureBaseline(profile({ name: 'Renamed' })).name).toBe('Renamed')
  })

  it('capturing a captured profile twice yields the same snapshot', () => {
    // The property D1's acceptance is stated in terms of: seeding a baseline is idempotent, so a
    // re-confirmed file (`markFileSeen` on unchanged bytes) cannot drift the snapshot.
    const live = fullProfile()
    expect(captureBaseline(live)).toEqual(captureBaseline({ ...live, baseline: captureBaseline(live) }))
  })
})
