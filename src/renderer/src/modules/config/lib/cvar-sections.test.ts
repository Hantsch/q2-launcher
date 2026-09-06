import { describe, expect, it } from 'vitest'
import type { ConfigCvarSection } from '@shared/modules/config'
import { buildCvarSectionGroups } from './cvar-rows'
import {
  createCvarSection,
  createCvarSubsection,
  cvarPlacementOptions,
  deleteCvarSection,
  deleteCvarSubsection,
  moveCvarSection,
  moveCvarSubsection,
  moveCvarToSection,
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
