import { describe, expect, it } from 'vitest'
import type { CvarDef } from '@shared/config/cvar-facts'
import { CVAR_GROUP_ORDER } from '@shared/config/cvar-facts'
import { ALL_CVARS, GRAPHICS_CVARS, PLAYER_CVARS, findCvar } from '@shared/config/cvar-catalog'
import { cvarChangeKey } from '@shared/config/profile-diff'
import { STANDARD_TEMPLATE, type ConfigCvarSection } from '@shared/modules/config'
import {
  buildCvarSectionGroups,
  cvarGroupKey,
  effectiveDefaultFor,
  isChanged,
  normalizeCvarValue,
  visibleRowsOf,
  type CvarRowEntry,
  type CvarSectionResult,
} from './cvar-rows'

const toggleDef: CvarDef = {
  name: 'freelook',
  labelKey: 'config.cvar.freelook.label',
  kind: 'toggle',
  group: 'player',
  descriptionKey: 'config.cvar.freelook.description',
  default: '1',
  common: true,
  byEngine: {
    vanilla: { engineDefault: '0' },
    r1q2: { engineDefault: '1' },
  },
}

/** A cvar the catalog has no `byEngine` entry for at all - the "engine has no facts for this
 * specific cvar" case, distinct from "no engine with facts is in scope". */
const noFactsDef: CvarDef = {
  name: 'gl_shadows_test',
  labelKey: 'config.cvar.gl_shadows.label',
  kind: 'toggle',
  group: 'graphics',
  descriptionKey: 'config.cvar.gl_shadows.description',
  default: '0',
  common: true,
}

/** Every section expanded, so the Advanced collapse is out of the way for the tests that are about
 * grouping rather than about the collapse itself. */
function allExpanded(sections: readonly ConfigCvarSection[]): Set<string> {
  return new Set([
    ...sections.map((section) => cvarGroupKey('section', section.id)),
    cvarGroupKey('defaults', 'defaults'),
    cvarGroupKey('other', 'other'),
  ])
}

function rowNames(groups: CvarSectionResult[]): string[] {
  return groups.flatMap((group) => visibleRowsOf(group).map((row) => row.name))
}

function groupNamed(groups: CvarSectionResult[], key: string): CvarSectionResult {
  const found = groups.find((group) => group.key === key)
  if (!found) throw new Error(`no group ${key} in ${groups.map((g) => g.key).join(', ')}`)
  return found
}

describe('normalizeCvarValue', () => {
  it('normalizes toggle-ish values to the same canonical "on"', () => {
    expect(normalizeCvarValue(toggleDef, '1')).toBe('1')
    expect(normalizeCvarValue(toggleDef, 'true')).toBe('1')
    expect(normalizeCvarValue(toggleDef, 'TRUE')).toBe('1')
    expect(normalizeCvarValue(toggleDef, ' 1 ')).toBe('1')
  })

  it('normalizes anything else to the canonical "off"', () => {
    expect(normalizeCvarValue(toggleDef, '0')).toBe('0')
    expect(normalizeCvarValue(toggleDef, 'false')).toBe('0')
    expect(normalizeCvarValue(toggleDef, '')).toBe('0')
  })

  it('leaves non-toggle kinds trimmed but otherwise untouched', () => {
    const sliderDef = PLAYER_CVARS.find((d) => d.name === 'fov')!
    expect(normalizeCvarValue(sliderDef, ' 110 ')).toBe('110')
  })
})

describe('effectiveDefaultFor', () => {
  it('uses the engine default when the engine is in scope and has facts for the cvar', () => {
    expect(effectiveDefaultFor(toggleDef, 'vanilla')).toBe('0')
    expect(effectiveDefaultFor(toggleDef, 'r1q2')).toBe('1')
  })

  it('falls back to the catalog default when no engine is in scope', () => {
    expect(effectiveDefaultFor(toggleDef, null)).toBe('1')
  })

  it('falls back to the catalog default when the engine has no byEngine entry for this cvar', () => {
    expect(effectiveDefaultFor(noFactsDef, 'r1q2')).toBe('0')
  })

  it('never invents an engine default for an engine the catalog has no facts for', () => {
    // 'custom' is a real EngineKind but not one of the three the catalog carries facts for.
    expect(effectiveDefaultFor(toggleDef, 'custom')).toBe('1')
  })
})

describe('isChanged', () => {
  it('is false when the value equals the effective default', () => {
    expect(isChanged(toggleDef, 'r1q2', '1')).toBe(false)
    expect(isChanged(toggleDef, 'vanilla', '0')).toBe(false)
  })

  it('is true when the value differs from the effective default', () => {
    expect(isChanged(toggleDef, 'vanilla', '1')).toBe(true)
  })

  it('treats "1" and "true" as equally unchanged against a "1" default', () => {
    expect(isChanged(toggleDef, 'r1q2', 'true')).toBe(false)
  })

  it('is false for an unset (empty string) value regardless of default', () => {
    expect(isChanged(toggleDef, 'vanilla', '')).toBe(false)
  })

  it('is false right after a reset writes the default value (no presence-based tracking)', () => {
    const def = PLAYER_CVARS.find((d) => d.name === 'fov')!
    const defaultValue = effectiveDefaultFor(def, null)
    expect(isChanged(def, null, defaultValue)).toBe(false)
  })
})

/**
 * Story 059 D7. The template case is the regression guard the story's acceptance names first ("a
 * template profile looks as today"): `STANDARD_TEMPLATE.cvarSections` groups `ALL_CVARS` by
 * `CVAR_GROUP_ORDER`, so grouping by section has to produce exactly the row order grouping by
 * `def.group` produced before this deliverable.
 */
describe('buildCvarSectionGroups - a template profile is unchanged', () => {
  const sections = STANDARD_TEMPLATE.cvarSections
  const values = { ...STANDARD_TEMPLATE.cvars }
  /** The template seeds one cvar the catalogue does not carry (`volume`, next to the catalogue's
   * `s_volume`). The pre-059 writer already wrote it into the file's untagged `Other` bucket while
   * the Settings tab - which iterated `ALL_CVARS` - showed no row for it at all. That is precisely
   * the invisibility AC3 removes, so the template's four sections must look exactly as before *and*
   * this one must now have a plain row. Derived rather than spelled out, so the assertion follows
   * the template if it ever seeds another one. */
  const templateUnknown = Object.keys(values).filter((name) => !findCvar(name))

  it('renders the four seeded sections in the catalogue group order, then the Other bucket', () => {
    const groups = buildCvarSectionGroups({ sections, values })
    expect(groups.filter((group) => group.kind === 'section').map((group) => group.section?.id)).toEqual(
      [...CVAR_GROUP_ORDER],
    )
    expect(groups.map((group) => group.kind)).toEqual(['section', 'section', 'section', 'section', 'other'])
  })

  it('produces exactly the rows the pre-059 def.group grouping produced, in the same order', () => {
    const groups = buildCvarSectionGroups({
      sections,
      values,
      expandedSections: allExpanded(sections),
    })
    const expected = CVAR_GROUP_ORDER.flatMap((group) =>
      ALL_CVARS.filter((def) => def.group === group).map((def) => def.name),
    )
    const sectionGroups = groups.filter((group) => group.kind === 'section')
    expect(rowNames(sectionGroups)).toEqual(expected)
    expect(sectionGroups.every((group) => visibleRowsOf(group).every((row) => row.kind === 'catalog'))).toBe(
      true,
    )
  })

  it('has no Defaults bucket, because every catalogue cvar is placed', () => {
    const groups = buildCvarSectionGroups({ sections, values })
    expect(groups.some((group) => group.kind === 'defaults')).toBe(false)
    // Even with the writer's toggle explicitly on - the bucket is empty, so it is not rendered at
    // all (the writer drops the empty block, this drops the empty group).
    const withToggle = buildCvarSectionGroups({ sections, values, writeCatalogDefaults: true })
    expect(withToggle.map((group) => group.key)).toEqual(groups.map((group) => group.key))
  })

  it("gives the template's one non-catalogue cvar a plain row instead of hiding it", () => {
    expect(templateUnknown.length).toBeGreaterThan(0)
    const groups = buildCvarSectionGroups({ sections, values })
    const other = groupNamed(groups, cvarGroupKey('other', 'other'))
    expect(other.rows.map((row) => row.name)).toEqual([...templateUnknown].sort())
    expect(other.rows.every((row) => row.kind === 'plain')).toBe(true)
  })

  it('counts per section and in total agree with the rows actually rendered', () => {
    const groups = buildCvarSectionGroups({
      sections,
      values,
      expandedSections: allExpanded(sections),
    })
    for (const group of groups) {
      expect(group.total).toBe(visibleRowsOf(group).length)
    }
    expect(groups.reduce((sum, group) => sum + group.total, 0)).toBe(
      ALL_CVARS.length + templateUnknown.length,
    )
  })
})

describe('buildCvarSectionGroups - the profile owns the grouping', () => {
  const sections: ConfigCvarSection[] = [
    {
      id: 'general',
      name: 'General Settings',
      cvars: ['hostname', 'fov', 'adr0'],
      subsections: [
        { id: 'downloads', name: 'Downloads', cvars: ['allow_download', 'allow_download_maps'] },
        { id: 'empty', name: 'Nothing yet', cvars: [] },
      ],
    },
    { id: 'gfx', name: 'GRAFIK SETTINGS', cvars: ['gl_shadows'] },
  ]
  const values: Record<string, string> = {
    hostname: 'my server',
    fov: '110',
    adr0: '1.2.3.4',
    allow_download: '1',
    allow_download_maps: '0',
    gl_shadows: '1',
  }

  it('renders the ungrouped run first, then the sub-sections in the profile order', () => {
    const groups = buildCvarSectionGroups({
      sections,
      values,
      writeCatalogDefaults: false,
      expandedSections: allExpanded(sections),
    })
    const general = groupNamed(groups, cvarGroupKey('section', 'general'))
    expect(general.rows.map((row) => row.name)).toEqual(['hostname', 'fov', 'adr0'])
    expect(general.subgroups.map((sub) => sub.subsection.id)).toEqual(['downloads', 'empty'])
    expect(general.subgroups[0]!.rows.map((row) => row.name)).toEqual([
      'allow_download',
      'allow_download_maps',
    ])
  })

  it('keeps an empty sub-section visible so it can still be renamed or deleted', () => {
    const groups = buildCvarSectionGroups({ sections, values, writeCatalogDefaults: false })
    const general = groupNamed(groups, cvarGroupKey('section', 'general'))
    const empty = general.subgroups.find((sub) => sub.subsection.id === 'empty')!
    expect(empty.rows).toEqual([])
    expect(empty.total).toBe(0)
  })

  it('gives a non-catalogue cvar a plain row with its stored value, and a catalogue one a rich row', () => {
    const groups = buildCvarSectionGroups({
      sections,
      values,
      writeCatalogDefaults: false,
      expandedSections: allExpanded(sections),
    })
    const general = groupNamed(groups, cvarGroupKey('section', 'general'))
    const hostname = general.rows.find((row) => row.name === 'hostname')!
    expect(hostname.kind).toBe('plain')
    expect(hostname.value).toBe('my server')
    expect('def' in hostname).toBe(false)

    const fov = general.rows.find((row) => row.name === 'fov')!
    expect(fov.kind).toBe('catalog')
    expect(fov.kind === 'catalog' && fov.def.name).toBe('fov')
    expect(fov.value).toBe('110')
  })

  it("counts a section's sub-section rows into the section's own total and edited counts", () => {
    const unsavedKeys = new Set([cvarChangeKey('allow_download'), cvarChangeKey('fov')])
    const groups = buildCvarSectionGroups({
      sections,
      values,
      unsavedKeys,
      writeCatalogDefaults: false,
      expandedSections: allExpanded(sections),
    })
    const general = groupNamed(groups, cvarGroupKey('section', 'general'))
    expect(general.total).toBe(5)
    expect(general.edited).toBe(2)
    expect(general.total).toBe(visibleRowsOf(general).length)
    const downloads = general.subgroups[0]!
    expect(downloads.total).toBe(2)
    expect(downloads.edited).toBe(1)
  })

  it('claims a name listed twice by its first placement only', () => {
    const twice: ConfigCvarSection[] = [
      { id: 'a', name: 'A', cvars: ['fov', 'hostname'] },
      { id: 'b', name: 'B', cvars: ['fov', 'hostname'] },
    ]
    const groups = buildCvarSectionGroups({
      sections: twice,
      values,
      writeCatalogDefaults: false,
      expandedSections: allExpanded(twice),
    })
    expect(groupNamed(groups, cvarGroupKey('section', 'a')).rows.map((r) => r.name)).toEqual([
      'fov',
      'hostname',
    ])
    expect(groupNamed(groups, cvarGroupKey('section', 'b')).rows).toEqual([])
    expect(rowNames(groups).filter((name) => name === 'fov')).toHaveLength(1)
  })

  it('shows no row for a non-catalogue name a section lists but the profile has no value for', () => {
    const dangling: ConfigCvarSection[] = [{ id: 'a', name: 'A', cvars: ['zz_never_stored'] }]
    const groups = buildCvarSectionGroups({
      sections: dangling,
      values: {},
      writeCatalogDefaults: false,
    })
    expect(rowNames(groups)).toEqual([])
  })

  it('renders a catalogue name a section lists even with no stored value - the file gets its default', () => {
    const listed: ConfigCvarSection[] = [{ id: 'a', name: 'A', cvars: ['fov'] }]
    const groups = buildCvarSectionGroups({
      sections: listed,
      values: {},
      writeCatalogDefaults: false,
      expandedSections: allExpanded(listed),
    })
    const row = groupNamed(groups, cvarGroupKey('section', 'a')).rows[0]!
    expect(row.kind).toBe('catalog')
    expect(row.value).toBe('')
  })

  it("carries the profile's own spelling of a catalogue cvar rather than the catalogue's", () => {
    const listed: ConfigCvarSection[] = [{ id: 'a', name: 'A', cvars: ['fov'] }]
    const groups = buildCvarSectionGroups({
      sections: listed,
      values: { FOV: '120' },
      writeCatalogDefaults: false,
      expandedSections: allExpanded(listed),
    })
    // One row, not two: `FOV` and `fov` are the same cvar to `findCvar`, so it can never end up
    // both placed here and in the reserved `Other` bucket as an unknown name.
    expect(rowNames(groups)).toEqual(['FOV'])
    expect(groupNamed(groups, cvarGroupKey('section', 'a')).rows[0]!.value).toBe('120')
  })
})

describe('buildCvarSectionGroups - unplaced cvars are never hidden', () => {
  const sections: ConfigCvarSection[] = [{ id: 'mine', name: 'Mine', cvars: ['fov'] }]
  const values: Record<string, string> = { fov: '110', hostname: 'srv', adr0: '1.2.3.4' }

  it('puts every unplaced non-catalogue cvar into the reserved Other group, alphabetically', () => {
    const groups = buildCvarSectionGroups({ sections, values, writeCatalogDefaults: false })
    const other = groupNamed(groups, cvarGroupKey('other', 'other'))
    expect(other.section).toBeNull()
    expect(other.rows.map((row) => row.name)).toEqual(['adr0', 'hostname'])
    expect(other.rows.every((row) => row.kind === 'plain')).toBe(true)
  })

  it('puts every unplaced catalogue cvar into the reserved Defaults group when the toggle is on', () => {
    const groups = buildCvarSectionGroups({
      sections,
      values,
      expandedSections: allExpanded(sections),
    })
    const defaults = groupNamed(groups, cvarGroupKey('defaults', 'defaults'))
    expect(defaults.total).toBe(ALL_CVARS.length - 1)
    expect(defaults.rows.map((row) => row.name)).not.toContain('fov')
    // Reserved buckets come last, in the writer's own order: sections, Defaults, Other.
    expect(groups.map((group) => group.kind)).toEqual(['section', 'defaults', 'other'])
  })

  it('drops the Defaults group when the profile turns catalogue defaults off, keeping Other', () => {
    const groups = buildCvarSectionGroups({ sections, values, writeCatalogDefaults: false })
    expect(groups.map((group) => group.kind)).toEqual(['section', 'other'])
  })

  it('shows every cvar of a profile that has no sections at all', () => {
    const groups = buildCvarSectionGroups({ values })
    const names = rowNames(groups)
    expect(names).toContain('hostname')
    expect(names).toContain('adr0')
    // `fov` is a catalogue cvar, so it lands in Defaults rather than Other - with its stored value.
    const fov = groups
      .flatMap((group) => visibleRowsOf(group))
      .find((row) => row.name === 'fov')!
    expect(fov.value).toBe('110')
  })

  it('never lets one cvar appear in two groups', () => {
    const groups = buildCvarSectionGroups({
      sections,
      values,
      expandedSections: allExpanded(sections),
    })
    const names = rowNames(groups)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('buildCvarSectionGroups - filter, unsaved-only and the Advanced collapse', () => {
  const sections: ConfigCvarSection[] = [
    {
      id: 'player',
      name: 'Player',
      // m_pitch is `common: false` in the catalogue; hostname is not in the catalogue at all.
      cvars: ['fov', 'm_pitch', 'hostname', 'sensitivity'],
    },
  ]
  const values: Record<string, string> = { fov: '110', hostname: 'srv' }
  const key = cvarGroupKey('section', 'player')

  it('filters over the cvar name, case-insensitively, with no resolver supplied', () => {
    const groups = buildCvarSectionGroups({
      sections,
      values,
      writeCatalogDefaults: false,
      filter: 'FOV',
    })
    expect(groupNamed(groups, key).rows.map((row) => row.name)).toEqual(['fov'])
  })

  it('filters a plain row over its name too', () => {
    const groups = buildCvarSectionGroups({
      sections,
      values,
      writeCatalogDefaults: false,
      filter: 'hostn',
    })
    expect(groupNamed(groups, key).rows.map((row) => row.name)).toEqual(['hostname'])
  })

  it('filters over the resolved label/description text, not the i18n key', () => {
    // Sprint decision (story 021): "Filter matches cvar name, label and description
    // (case-insensitive)" - a user types words like "field of view", never "config.cvar.fov.label".
    const labelText = (def: CvarDef): string => (def.name === 'fov' ? 'Field of view' : def.name)
    const descriptionText = (def: CvarDef): string =>
      def.name === 'sensitivity' ? 'Mouse look speed' : def.name

    const byLabel = buildCvarSectionGroups({
      sections,
      values,
      writeCatalogDefaults: false,
      filter: 'field of view',
      labelText,
      descriptionText,
    })
    expect(groupNamed(byLabel, key).rows.map((row) => row.name)).toEqual(['fov'])

    const byDescription = buildCvarSectionGroups({
      sections,
      values,
      writeCatalogDefaults: false,
      filter: 'mouse look',
      labelText,
      descriptionText,
    })
    expect(groupNamed(byDescription, key).rows.map((row) => row.name)).toEqual(['sensitivity'])

    // A plain row has no label or description at all, so a resolver can never rescue it - and the
    // resolvers are never called for one either (they take a `CvarDef` there is none of).
    const byKeyFragment = buildCvarSectionGroups({
      sections,
      values,
      writeCatalogDefaults: false,
      filter: 'label',
      labelText,
      descriptionText,
    })
    expect(groupNamed(byKeyFragment, key).rows).toEqual([])
  })

  it('editedOnly restricts rows to unsaved ones without touching total/edited', () => {
    const unsavedKeys = new Set([cvarChangeKey('hostname')])
    const groups = buildCvarSectionGroups({
      sections,
      values,
      unsavedKeys,
      writeCatalogDefaults: false,
      editedOnly: true,
      expandedSections: new Set([key]),
    })
    const group = groupNamed(groups, key)
    expect(group.rows.map((row) => row.name)).toEqual(['hostname'])
    expect(group.total).toBe(4)
    expect(group.edited).toBe(1)
    // The header's "N unsaved" is exactly what "Unsaved only" leaves on screen - the two counters
    // cannot disagree.
    expect(group.edited).toBe(visibleRowsOf(group).length)
  })

  it('keys unsavedKeys via cvarChangeKey, the same identity the change set uses', () => {
    const groups = buildCvarSectionGroups({
      sections,
      values,
      unsavedKeys: new Set(['FOV']),
      writeCatalogDefaults: false,
    })
    expect(groupNamed(groups, key).edited).toBe(0)
  })

  it('resolves a plain row\'s unsaved key from its verbatim name', () => {
    const groups = buildCvarSectionGroups({
      sections,
      values,
      unsavedKeys: new Set([cvarChangeKey('hostname')]),
      writeCatalogDefaults: false,
    })
    const hostname = groupNamed(groups, key).rows.find((row) => row.name === 'hostname')!
    expect(hostname.edited).toBe(true)
  })

  it('hides non-common rows while collapsed and counts them as advancedHidden', () => {
    const groups = buildCvarSectionGroups({ sections, values, writeCatalogDefaults: false })
    const group = groupNamed(groups, key)
    expect(group.rows.map((row) => row.name)).not.toContain('m_pitch')
    expect(group.advancedHidden).toBe(1)
    expect(group.hasAdvanced).toBe(true)
  })

  it('never hides a non-catalogue row behind the Advanced collapse', () => {
    // The story's decision: a cvar the catalogue knows nothing about is always "common", because
    // calling it advanced would be a guess.
    const groups = buildCvarSectionGroups({ sections, values, writeCatalogDefaults: false })
    expect(groupNamed(groups, key).rows.map((row) => row.name)).toContain('hostname')
  })

  it('hasAdvanced stays true once the section is expanded, independent of advancedHidden', () => {
    const expanded = buildCvarSectionGroups({
      sections,
      values,
      writeCatalogDefaults: false,
      expandedSections: new Set([key]),
    })
    const group = groupNamed(expanded, key)
    expect(group.hasAdvanced).toBe(true)
    expect(group.advancedHidden).toBe(0)
    expect(group.rows.map((row) => row.name)).toContain('m_pitch')
  })

  it('hasAdvanced is false for a section with no non-common rows at all', () => {
    const plainOnly: ConfigCvarSection[] = [{ id: 'x', name: 'X', cvars: ['hostname'] }]
    const groups = buildCvarSectionGroups({
      sections: plainOnly,
      values,
      writeCatalogDefaults: false,
    })
    const group = groupNamed(groups, cvarGroupKey('section', 'x'))
    expect(group.hasAdvanced).toBe(false)
    expect(group.advancedHidden).toBe(0)
  })

  it('reveals a filter hit inside a collapsed Advanced row instead of hiding it', () => {
    const groups = buildCvarSectionGroups({
      sections,
      values,
      writeCatalogDefaults: false,
      filter: 'm_pitch',
    })
    const group = groupNamed(groups, key)
    expect(group.rows.map((row) => row.name)).toEqual(['m_pitch'])
    expect(group.advancedHidden).toBe(0)
    expect(group.hasAdvanced).toBe(true)
  })

  it('applies the collapse inside a sub-section too, counting it into the section', () => {
    const nested: ConfigCvarSection[] = [
      {
        id: 'player',
        name: 'Player',
        cvars: ['fov'],
        subsections: [{ id: 'mouse', name: 'Mouse', cvars: ['m_pitch', 'hostname'] }],
      },
    ]
    const collapsed = buildCvarSectionGroups({
      sections: nested,
      values,
      writeCatalogDefaults: false,
    })
    const group = groupNamed(collapsed, key)
    expect(group.subgroups[0]!.rows.map((row) => row.name)).toEqual(['hostname'])
    expect(group.advancedHidden).toBe(1)
    expect(group.hasAdvanced).toBe(true)

    const expanded = buildCvarSectionGroups({
      sections: nested,
      values,
      writeCatalogDefaults: false,
      expandedSections: new Set([key]),
    })
    expect(groupNamed(expanded, key).subgroups[0]!.rows.map((row) => row.name)).toEqual([
      'm_pitch',
      'hostname',
    ])
  })
})

describe('buildCvarSectionGroups - the engine-facts selector has nothing to say about a plain row', () => {
  it('carries no def for a plain row, so no default, range or note can be resolved for it', () => {
    const groups = buildCvarSectionGroups({
      sections: [{ id: 'a', name: 'A', cvars: ['hostname', 'gl_shadows'] }],
      values: { hostname: 'srv', gl_shadows: '1' },
      writeCatalogDefaults: false,
      expandedSections: new Set([cvarGroupKey('section', 'a')]),
    })
    const rows: CvarRowEntry[] = groupNamed(groups, cvarGroupKey('section', 'a')).rows
    const plain = rows.find((row) => row.name === 'hostname')!
    expect(plain.kind).toBe('plain')

    // The catalogue row next to it still resolves its facts exactly as before, engine or not.
    const catalog = rows.find((row) => row.name === 'gl_shadows')!
    const shadowsDef = GRAPHICS_CVARS.find((d) => d.name === 'gl_shadows')!
    expect(catalog.kind === 'catalog' && catalog.def).toBe(shadowsDef)
    expect(effectiveDefaultFor(shadowsDef, 'r1q2')).toBe(shadowsDef.default)
  })
})
