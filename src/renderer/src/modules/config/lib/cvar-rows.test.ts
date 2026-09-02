import { describe, expect, it } from 'vitest'
import type { CvarDef } from '@shared/config/cvar-facts'
import { ALL_CVARS, GRAPHICS_CVARS, PLAYER_CVARS } from '@shared/config/cvar-catalog'
import { buildCvarGroups, effectiveDefaultFor, isChanged, isEdited, normalizeCvarValue } from './cvar-rows'

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

describe('isEdited', () => {
  // Story 048 D6: "edited" compares against a saved-cvars baseline, never against the catalogue
  // default - a value can differ from the default and still be unedited (it was saved that way),
  // and a value equal to the default can still be edited (the user just set it back to that number).
  it('is false when the value equals the baseline, even though it differs from the catalogue default', () => {
    // toggleDef's catalog default is '1' - baseline '0' with a current value that matches the
    // baseline, not the default, must read as unedited.
    expect(isEdited(toggleDef, '0', '0')).toBe(false)
  })

  it('is true when the value differs from the baseline, even though it equals the catalogue default', () => {
    // Value equals the def's own default ('1'), but the baseline says '0' was last saved.
    expect(isEdited(toggleDef, '1', '0')).toBe(true)
  })

  it('treats "1" and "true" as equally unedited against a "1" baseline (same normalization as isChanged)', () => {
    expect(isEdited(toggleDef, 'true', '1')).toBe(false)
  })

  it('numeric-normalizes non-toggle values against the baseline, same as sameValue elsewhere', () => {
    const sliderDef = PLAYER_CVARS.find((d) => d.name === 'fov')!
    expect(isEdited(sliderDef, '110', '110.0')).toBe(false)
    expect(isEdited(sliderDef, '120', '110')).toBe(true)
  })

  it('is true when the value is cleared back to empty but the baseline had something saved', () => {
    // Unlike isChanged (an empty value is never "changed from default"), a baseline is a concrete
    // prior value - clearing a field the baseline had content in is itself an edit.
    expect(isEdited(toggleDef, '', '1')).toBe(true)
  })

  it('is false when both the value and the baseline are unset', () => {
    expect(isEdited(toggleDef, '', '')).toBe(false)
  })
})

describe('buildCvarGroups', () => {
  it('orders groups exactly Player, Network, Graphics, Sound', () => {
    const groups = buildCvarGroups(ALL_CVARS, { values: {}, engine: null })
    expect(groups.map((g) => g.group)).toEqual(['player', 'network', 'graphics', 'sound'])
  })

  it('computes correct per-group total and edited counts, independent of filter/editedOnly', () => {
    const playerGroupDefs = ALL_CVARS.filter((d) => d.group === 'player')
    // fov's saved baseline is its own default ('100') here on purpose - story 048 D6: what makes a
    // row "edited" is the current value moving away from the baseline, not from the catalogue
    // default, so this asserts against a baseline explicitly rather than relying on the default.
    const baseline: Record<string, string> = { fov: '100' }
    const values: Record<string, string> = { fov: '120' }
    const groups = buildCvarGroups(ALL_CVARS, { values, baseline, engine: null })
    const player = groups.find((g) => g.group === 'player')!
    expect(player.total).toBe(playerGroupDefs.length)
    expect(player.edited).toBe(1)
  })

  it('is not edited when the value differs from the catalogue default but matches the saved baseline', () => {
    // The exact scenario story 048 changed: a profile saved long ago with a non-default fov must
    // not show as edited just because it still differs from the catalogue default.
    const baseline: Record<string, string> = { fov: '120' }
    const values: Record<string, string> = { fov: '120' }
    const groups = buildCvarGroups(ALL_CVARS, { values, baseline, engine: null })
    const player = groups.find((g) => g.group === 'player')!
    expect(player.edited).toBe(0)
  })

  it('filter matches over the cvar name, case-insensitively, with no resolver supplied', () => {
    const byName = buildCvarGroups(ALL_CVARS, { values: {}, engine: null, filter: 'FOV' })
    const namedRows = byName.flatMap((g) => g.rows.map((r) => r.def.name))
    expect(namedRows).toContain('fov')
    expect(namedRows).not.toContain('sensitivity')

    const byNameFragment = buildCvarGroups(ALL_CVARS, {
      values: {},
      engine: null,
      filter: 'cl_maxfps',
    })
    const rows2 = byNameFragment.flatMap((g) => g.rows.map((r) => r.def.name))
    expect(rows2).toContain('cl_maxfps')
  })

  it('filter matches the resolved label/description text, not the i18n key, when a resolver is supplied', () => {
    // Sprint decision: "Filter matches cvar name, label and description (case-insensitive)" - a user
    // types words like "field of view", never the i18n key "config.cvar.fov.label" (review finding).
    const labelText = (def: CvarDef): string => (def.name === 'fov' ? 'Field of view' : def.name)
    const descriptionText = (def: CvarDef): string =>
      def.name === 'sensitivity' ? 'Mouse look speed' : def.name

    const byLabel = buildCvarGroups(ALL_CVARS, {
      values: {},
      engine: null,
      filter: 'field of view',
      labelText,
      descriptionText,
    })
    expect(byLabel.flatMap((g) => g.rows.map((r) => r.def.name))).toContain('fov')

    const byDescription = buildCvarGroups(ALL_CVARS, {
      values: {},
      engine: null,
      filter: 'mouse look',
      labelText,
      descriptionText,
    })
    expect(byDescription.flatMap((g) => g.rows.map((r) => r.def.name))).toContain('sensitivity')

    // Typing a substring of the i18n key itself ("label"/"config"/"cvar") must not match everything
    // now that resolved text, not the key, is what filtering matches against.
    const byKeyFragment = buildCvarGroups(ALL_CVARS, {
      values: {},
      engine: null,
      filter: 'label',
      labelText,
      descriptionText,
    })
    expect(byKeyFragment.flatMap((g) => g.rows).length).toBe(0)
  })

  it('editedOnly restricts rows to edited ones without touching total/edited counts', () => {
    const baseline: Record<string, string> = { fov: '100' }
    const values: Record<string, string> = { fov: '120' }
    const groups = buildCvarGroups(ALL_CVARS, { values, baseline, engine: null, editedOnly: true })
    const player = groups.find((g) => g.group === 'player')!
    expect(player.rows.map((r) => r.def.name)).toEqual(['fov'])
    expect(player.total).toBe(ALL_CVARS.filter((d) => d.group === 'player').length)
  })

  it('showAdvanced=false hides non-common rows and counts them as advancedHidden', () => {
    const groups = buildCvarGroups(ALL_CVARS, { values: {}, engine: null, showAdvanced: false })
    const player = groups.find((g) => g.group === 'player')!
    const rowNames = player.rows.map((r) => r.def.name)
    // m_pitch is common: false in the catalog.
    expect(rowNames).not.toContain('m_pitch')
    expect(player.advancedHidden).toBeGreaterThan(0)
    expect(player.rows.every((r) => r.def.common !== false)).toBe(true)
  })

  it('hasAdvanced stays true once the group is expanded, independent of advancedHidden', () => {
    // Player has non-common rows (e.g. m_pitch), so hasAdvanced must be true whether the section is
    // collapsed or expanded - unlike advancedHidden, which legitimately drops to 0 once expanded.
    // Before the fix, the toggle button was gated on `advancedHidden > 0` and vanished here, leaving
    // no way to re-collapse the section (review finding).
    const collapsed = buildCvarGroups(ALL_CVARS, { values: {}, engine: null, showAdvanced: false })
    const expanded = buildCvarGroups(ALL_CVARS, { values: {}, engine: null, showAdvanced: true })
    const playerCollapsed = collapsed.find((g) => g.group === 'player')!
    const playerExpanded = expanded.find((g) => g.group === 'player')!

    expect(playerCollapsed.hasAdvanced).toBe(true)
    expect(playerCollapsed.advancedHidden).toBeGreaterThan(0)
    expect(playerExpanded.hasAdvanced).toBe(true)
    expect(playerExpanded.advancedHidden).toBe(0)
  })

  it('hasAdvanced stays true when a filter already reveals every advanced row', () => {
    // Filtering to "m_pitch" reveals the only non-common row that matches, so advancedHidden for the
    // *other* non-common rows is unrelated to whether the group's advanced section exists at all -
    // hasAdvanced must not depend on filter state (review finding: the toggle must not lie or vanish
    // while filtering).
    const groups = buildCvarGroups(ALL_CVARS, {
      values: {},
      engine: null,
      showAdvanced: false,
      filter: 'm_pitch',
    })
    const player = groups.find((g) => g.group === 'player')!
    expect(player.hasAdvanced).toBe(true)
  })

  it('hasAdvanced is false for a group with no non-common rows at all', () => {
    const allCommon: CvarDef[] = [{ ...toggleDef, group: 'network' }]
    const groups = buildCvarGroups(allCommon, { values: {}, engine: null, showAdvanced: false })
    const network = groups.find((g) => g.group === 'network')!
    expect(network.hasAdvanced).toBe(false)
    expect(network.advancedHidden).toBe(0)
  })

  it('reveals a filter hit inside a collapsed Advanced row instead of hiding it', () => {
    // m_pitch is common: false - collapsed under showAdvanced: false, but a filter that matches it
    // must reveal it rather than looking like "no results".
    const groups = buildCvarGroups(ALL_CVARS, {
      values: {},
      engine: null,
      showAdvanced: false,
      filter: 'm_pitch',
    })
    const player = groups.find((g) => g.group === 'player')!
    expect(player.rows.map((r) => r.def.name)).toContain('m_pitch')
    // Revealed by the filter, so it is not counted among the rows still hidden by the collapse -
    // only the other non-common player rows that do *not* match "m_pitch" are (ch_scale, msg).
    const otherNonCommonPlayerRows = ALL_CVARS.filter(
      (d) => d.group === 'player' && d.common === false && d.name !== 'm_pitch',
    )
    expect(player.advancedHidden).toBe(otherNonCommonPlayerRows.length)
  })

  it('resolves an engine-absent cvar default from the catalog only, never attributing engine numbers', () => {
    // No engine in scope at all.
    const noEngine = buildCvarGroups(ALL_CVARS, { values: { fov: '' }, engine: null })
    const fovNoEngine = noEngine.flatMap((g) => g.rows).find((r) => r.def.name === 'fov')!
    expect(effectiveDefaultFor(fovNoEngine.def, null)).toBe('100') // catalog default, not any engine's '90'

    // An engine in scope that the catalog has no byEngine facts for on this cvar at all.
    const shadowsDef = GRAPHICS_CVARS.find((d) => d.name === 'gl_shadows')!
    expect(shadowsDef.byEngine).toBeUndefined()
    expect(effectiveDefaultFor(shadowsDef, 'r1q2')).toBe(shadowsDef.default)
  })
})
