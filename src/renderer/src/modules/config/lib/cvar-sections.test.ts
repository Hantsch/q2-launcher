import { describe, expect, it } from 'vitest'
import type { ConfigCvarSection, ConfigProfile } from '@shared/modules/config'
import { renderProfileFile } from '@shared/config/render'
import { buildCvarSectionGroups } from './cvar-rows'
import {
  createCvarSection,
  createCvarSubsection,
  cvarPlacementOptions,
  deleteCvarSection,
  deleteCvarSubsection,
  moveCvarSection,
  moveCvarSubsection,
  moveCvarToPosition,
  moveCvarToSection,
  moveSectionToIndex,
  moveSubsectionToIndex,
  removeCvarFromSections,
  renameCvarSection,
  renameCvarSubsection,
} from './cvar-sections'

function section(
  id: string,
  cvars: string[],
  extra: Partial<ConfigCvarSection> = {},
): ConfigCvarSection {
  return { id, name: id, cvars, ...extra }
}

describe('createCvarSection', () => {
  it('creates an empty, freshly-ided section', () => {
    const created = createCvarSection('My section')
    expect(created.name).toBe('My section')
    expect(created.cvars).toEqual([])
    expect(created.id.length).toBeGreaterThan(0)
  })
})

describe('renameCvarSection', () => {
  it('renames the section and preserves cvars/subsections, dropping only nameKey', () => {
    const sections = [
      section('a', ['fov'], { nameKey: 'seed.a', subsections: [{ id: 's1', name: 'Sub', cvars: ['x'] }] }),
    ]
    const result = renameCvarSection(sections, 'a', 'Renamed')
    expect(result[0]).toEqual({
      id: 'a',
      name: 'Renamed',
      cvars: ['fov'],
      subsections: [{ id: 's1', name: 'Sub', cvars: ['x'] }],
    })
  })

  it('leaves other sections untouched', () => {
    const sections = [section('a', []), section('b', ['x'])]
    const result = renameCvarSection(sections, 'a', 'Renamed')
    expect(result[1]).toEqual(section('b', ['x']))
  })
})

describe('moveCvarSection', () => {
  it('swaps adjacent sections up and down', () => {
    const sections = [section('a', []), section('b', []), section('c', [])]
    expect(moveCvarSection(sections, 'b', 'up').map((s) => s.id)).toEqual(['b', 'a', 'c'])
    expect(moveCvarSection(sections, 'b', 'down').map((s) => s.id)).toEqual(['a', 'c', 'b'])
  })

  it('is a no-op at either edge', () => {
    const sections = [section('a', []), section('b', [])]
    expect(moveCvarSection(sections, 'a', 'up')).toEqual(sections)
    expect(moveCvarSection(sections, 'b', 'down')).toEqual(sections)
  })
})

describe('deleteCvarSection', () => {
  it("moves a middle section's cvars to the PREVIOUS section", () => {
    const sections = [section('a', ['x1']), section('b', ['x2']), section('c', ['x3'])]
    const result = deleteCvarSection(sections, 'b')
    expect(result.map((s) => s.id)).toEqual(['a', 'c'])
    expect(result.find((s) => s.id === 'a')!.cvars).toEqual(['x1', 'x2'])
    expect(result.find((s) => s.id === 'c')!.cvars).toEqual(['x3'])
  })

  it("moves the FIRST section's cvars to the following one instead (no previous)", () => {
    const sections = [section('a', ['x1']), section('b', ['x2'])]
    const result = deleteCvarSection(sections, 'a')
    expect(result.map((s) => s.id)).toEqual(['b'])
    expect(result[0]!.cvars).toEqual(['x2', 'x1'])
  })

  it('leaves the last remaining section with nowhere to send its cvars - they become unplaced', () => {
    const sections = [section('a', ['x1'])]
    const result = deleteCvarSection(sections, 'a')
    expect(result).toEqual([])
  })

  it("carries the deleted section's own subsections over to the target section", () => {
    const sections = [
      section('a', ['x1']),
      section('b', ['x2'], { subsections: [{ id: 's1', name: 'Sub', cvars: ['y'] }] }),
    ]
    const result = deleteCvarSection(sections, 'b')
    expect(result[0]!.subsections).toEqual([{ id: 's1', name: 'Sub', cvars: ['y'] }])
  })

  it('is a no-op for an unknown id', () => {
    const sections = [section('a', ['x1'])]
    expect(deleteCvarSection(sections, 'missing')).toEqual(sections)
  })
})

describe('createCvarSubsection / renameCvarSubsection / moveCvarSubsection / deleteCvarSubsection', () => {
  it('creates an empty sub-section under the given section', () => {
    const sections = [section('a', [])]
    const result = createCvarSubsection(sections, 'a', 'New sub')
    expect(result[0]!.subsections).toHaveLength(1)
    expect(result[0]!.subsections![0]).toMatchObject({ name: 'New sub', cvars: [] })
  })

  it('renames a sub-section without touching its cvars', () => {
    const sections = [section('a', [], { subsections: [{ id: 's1', name: 'Old', cvars: ['x'] }] })]
    const result = renameCvarSubsection(sections, 'a', 's1', 'New')
    expect(result[0]!.subsections![0]).toEqual({ id: 's1', name: 'New', cvars: ['x'] })
  })

  it('swaps adjacent sub-sections up and down', () => {
    const sections = [
      section('a', [], {
        subsections: [
          { id: 's1', name: 'One', cvars: [] },
          { id: 's2', name: 'Two', cvars: [] },
        ],
      }),
    ]
    const moved = moveCvarSubsection(sections, 'a', 's2', 'up')
    expect(moved[0]!.subsections!.map((s) => s.id)).toEqual(['s2', 's1'])
  })

  it("deletes a sub-section, folding its cvars into the parent section's ungrouped run", () => {
    const sections = [
      section('a', ['existing'], {
        subsections: [{ id: 's1', name: 'Sub', cvars: ['x', 'y'] }],
      }),
    ]
    const result = deleteCvarSubsection(sections, 'a', 's1')
    expect(result[0]!.cvars).toEqual(['existing', 'x', 'y'])
    expect(result[0]!.subsections).toEqual([])
  })
})

describe('removeCvarFromSections / moveCvarToSection', () => {
  const sections = [
    section('a', ['fov', 'sensitivity']),
    section('b', [], { subsections: [{ id: 's1', name: 'Sub', cvars: ['rate'] }] }),
  ]

  it('removes a cvar from wherever it sits, section run or sub-section', () => {
    expect(removeCvarFromSections(sections, 'fov').find((s) => s.id === 'a')!.cvars).toEqual([
      'sensitivity',
    ])
    expect(
      removeCvarFromSections(sections, 'rate').find((s) => s.id === 'b')!.subsections![0]!.cvars,
    ).toEqual([])
  })

  it('moves a cvar into another section, removing it from its old spot first', () => {
    const result = moveCvarToSection(sections, 'fov', { sectionId: 'b' })
    expect(result.find((s) => s.id === 'a')!.cvars).toEqual(['sensitivity'])
    expect(result.find((s) => s.id === 'b')!.cvars).toEqual(['fov'])
  })

  it('moves a cvar into a sub-section', () => {
    const result = moveCvarToSection(sections, 'fov', { sectionId: 'b', subsectionId: 's1' })
    expect(result.find((s) => s.id === 'b')!.subsections![0]!.cvars).toEqual(['rate', 'fov'])
  })

  it('never leaves a cvar listed twice after a move', () => {
    const result = moveCvarToSection(sections, 'rate', { sectionId: 'a' })
    const total = result.flatMap((s) => [...s.cvars, ...(s.subsections ?? []).flatMap((sub) => sub.cvars)])
    expect(total.filter((name) => name === 'rate')).toHaveLength(1)
  })
})

describe('adding a cvar by name (D8 acceptance): catalogue name gets the rich row, unknown name a plain one', () => {
  it('places cl_maxfps as a catalog row and zz_unknown as a plain row once added to a section', () => {
    const sections = [section('a', [])]
    const withBoth = moveCvarToSection(
      moveCvarToSection(sections, 'cl_maxfps', { sectionId: 'a' }),
      'zz_unknown',
      { sectionId: 'a' },
    )
    const groups = buildCvarSectionGroups({
      sections: withBoth,
      values: { cl_maxfps: '90', zz_unknown: 'value' },
    })
    const rows = groups[0]!.rows
    expect(rows.find((row) => row.name === 'cl_maxfps')?.kind).toBe('catalog')
    expect(rows.find((row) => row.name === 'zz_unknown')?.kind).toBe('plain')
  })
})

describe('moveSectionToIndex (story 054 D9)', () => {
  it('reorders a section to an arbitrary index, not just an adjacent swap', () => {
    const sections = [section('a', []), section('b', []), section('c', [])]
    expect(moveSectionToIndex(sections, 'c', 0).map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('clamps an out-of-range index instead of throwing', () => {
    const sections = [section('a', []), section('b', []), section('c', [])]
    expect(moveSectionToIndex(sections, 'a', 99).map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('is a no-op for an unknown section id', () => {
    const sections = [section('a', []), section('b', [])]
    expect(moveSectionToIndex(sections, 'missing', 0)).toEqual(sections)
  })

  it('never reorders a reserved bucket id, even if one somehow sits in the array', () => {
    const sections = [section('defaults', []), section('a', []), section('other', [])]
    expect(moveSectionToIndex(sections, 'defaults', 2).map((s) => s.id)).toEqual([
      'defaults',
      'a',
      'other',
    ])
    expect(moveSectionToIndex(sections, 'other', 0).map((s) => s.id)).toEqual([
      'defaults',
      'a',
      'other',
    ])
  })
})

describe('moveSubsectionToIndex (story 054 D9)', () => {
  it('reorders a sub-section to an arbitrary index', () => {
    const withSubs = section('a', [], {
      subsections: [
        { id: 's1', name: 'One', cvars: [] },
        { id: 's2', name: 'Two', cvars: [] },
        { id: 's3', name: 'Three', cvars: [] },
      ],
    })
    const result = moveSubsectionToIndex(withSubs, 's3', 0)
    expect(result.subsections!.map((s) => s.id)).toEqual(['s3', 's1', 's2'])
  })

  it('is a no-op for an unknown subsection id', () => {
    const withSubs = section('a', [], { subsections: [{ id: 's1', name: 'One', cvars: [] }] })
    expect(moveSubsectionToIndex(withSubs, 'missing', 0)).toEqual(withSubs)
  })
})

describe('moveCvarToPosition (story 054 D9)', () => {
  it("moves a cvar between sections at an exact index, not just appended", () => {
    const sections = [section('a', ['fov', 'sensitivity']), section('b', ['rate'])]
    const result = moveCvarToPosition(sections, 'sensitivity', { sectionId: 'b', index: 0 })
    expect(result.find((s) => s.id === 'a')!.cvars).toEqual(['fov'])
    expect(result.find((s) => s.id === 'b')!.cvars).toEqual(['sensitivity', 'rate'])
  })

  it('moves a cvar between sub-sections at an exact index', () => {
    const sections = [
      section('a', [], {
        subsections: [
          { id: 's1', name: 'One', cvars: ['x'] },
          { id: 's2', name: 'Two', cvars: ['y', 'z'] },
        ],
      }),
    ]
    const result = moveCvarToPosition(sections, 'x', { sectionId: 'a', subsectionId: 's2', index: 1 })
    expect(result[0]!.subsections![0]!.cvars).toEqual([])
    expect(result[0]!.subsections![1]!.cvars).toEqual(['y', 'x', 'z'])
  })

  it('moves a cvar out of a reserved bucket (not present in any section) into a real section', () => {
    const sections = [section('a', ['existing'])]
    // "cl_maxfps" is not listed anywhere here, meaning it currently renders in the reserved
    // Defaults bucket (per buildCvarSectionGroups) - moving it into a real section must still work.
    const result = moveCvarToPosition(sections, 'cl_maxfps', { sectionId: 'a', index: 0 })
    expect(result[0]!.cvars).toEqual(['cl_maxfps', 'existing'])
  })

  it('is a no-op when the target section is a reserved bucket id', () => {
    const sections = [section('a', ['fov'])]
    expect(moveCvarToPosition(sections, 'fov', { sectionId: 'defaults', index: 0 })).toEqual(
      sections,
    )
    expect(moveCvarToPosition(sections, 'fov', { sectionId: 'other', index: 0 })).toEqual(sections)
  })

  it('is a no-op for an unknown target section id', () => {
    const sections = [section('a', ['fov'])]
    expect(moveCvarToPosition(sections, 'fov', { sectionId: 'missing', index: 0 })).toEqual(
      sections,
    )
  })

  it('is a no-op for an unknown target subsection id', () => {
    const sections = [section('a', ['fov'], { subsections: [{ id: 's1', name: 'One', cvars: [] }] })]
    expect(
      moveCvarToPosition(sections, 'fov', { sectionId: 'a', subsectionId: 'missing', index: 0 }),
    ).toEqual(sections)
  })
})

describe('cvarPlacementOptions', () => {
  it('lists every section then each of its sub-sections, in order', () => {
    const sections = [
      section('a', [], { subsections: [{ id: 's1', name: 'Sub A', cvars: [] }] }),
      section('b', []),
    ]
    const options = cvarPlacementOptions(sections, (s) => s.name)
    expect(options).toEqual([
      { sectionId: 'a', label: 'a' },
      { sectionId: 'a', subsectionId: 's1', label: 'a / Sub A' },
      { sectionId: 'b', label: 'b' },
    ])
  })
})

/**
 * Story 054 D11: the render half of "order survives save, discard and render" for Settings -
 * `moveSectionToIndex`/`moveSubsectionToIndex`/`moveCvarToPosition` are pure array-position helpers
 * (tested against their own return values above); this pins that a profile built from their output
 * renders its cvar sections/sub-sections/cvars in the NEW order. The full render(parse(render))
 * round trip over the same reordered shape lives in `round-trip.test.ts` (a main-process test, since
 * the real file parser is main-only) - this only needs to show the write side.
 */
describe('story 054 D11: a reorder renders in its new order', () => {
  function profile(cvarSections: ConfigCvarSection[], cvars: Record<string, string>): ConfigProfile {
    return {
      id: 'p1',
      name: 'Profile',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      cvars,
      binds: {},
      assignments: [],
      cvarSections,
      writeCatalogDefaults: false,
    }
  }

  it('moveSectionToIndex: the rendered file emits the cvar sections in the new order', () => {
    const sections = [section('one', ['zz_one']), section('two', ['zz_two']), section('three', ['zz_three'])]
    const reordered = moveSectionToIndex(sections, 'three', 0)

    const text = renderProfileFile(profile(reordered, { zz_one: '1', zz_two: '2', zz_three: '3' }))
    const banners = [...text.matchAll(/^\/\/ --- (\S+) \[q2l cvs=/gm)].map((m) => m[1])
    expect(banners).toEqual(['three', 'one', 'two'])
  })

  it('moveSubsectionToIndex: the rendered file emits the sub-sections in the new order', () => {
    const withSubs = section('main', [], {
      subsections: [
        { id: 'sub-a', name: 'Alpha', cvars: ['zz_a'] },
        { id: 'sub-b', name: 'Beta', cvars: ['zz_b'] },
        { id: 'sub-c', name: 'Gamma', cvars: ['zz_c'] },
      ],
    })
    const reordered = moveSubsectionToIndex(withSubs, 'sub-c', 0)

    const text = renderProfileFile(
      profile([reordered], { zz_a: '1', zz_b: '2', zz_c: '3' }),
    )
    const banners = [...text.matchAll(/^\/\/ --- (\S+) \[q2l cvsub=/gm)].map((m) => m[1])
    expect(banners).toEqual(['Gamma', 'Alpha', 'Beta'])
  })

  it('moveCvarToPosition: the rendered file lists the cvars in the new order within their section', () => {
    const sections = [section('main', ['zz_first', 'zz_second', 'zz_third'])]
    const reordered = moveCvarToPosition(sections, 'zz_third', { sectionId: 'main', index: 0 })

    const text = renderProfileFile(
      profile(reordered, { zz_first: '1', zz_second: '2', zz_third: '3' }),
    )
    const setOrder = [...text.matchAll(/^set (\S+)\s/gm)].map((m) => m[1])
    expect(setOrder).toEqual(['zz_third', 'zz_first', 'zz_second'])
  })
})
