import { describe, expect, it } from 'vitest'
import type { CvarDef } from '@shared/config/cvar-facts'
import { ALL_CVARS, GRAPHICS_CVARS, PLAYER_CVARS } from '@shared/config/cvar-catalog'
import { cvarChangeKey } from '@shared/config/profile-diff'
import { buildCvarGroups, effectiveDefaultFor, isChanged, normalizeCvarValue } from './cvar-rows'

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

describe('buildCvarGroups', () => {
  it('orders groups exactly Player, Network, Graphics, Sound', () => {
    const groups = buildCvarGroups(ALL_CVARS, { values: {}, engine: null })
    expect(groups.map((g) => g.group)).toEqual(['player', 'network', 'graphics', 'sound'])
  })

  it('computes correct per-group total and edited counts, independent of filter/editedOnly', () => {
    const playerGroupDefs = ALL_CVARS.filter((d) => d.group === 'player')
    // Story 049 D7: "edited" is a lookup into `unsavedKeys` (the profile's pending change set),
    // never a value comparison here - `fov`'s key being in the set is what makes it edited,
    // independent of what `values` itself holds.
    const unsavedKeys = new Set([cvarChangeKey('fov')])
    const values: Record<string, string> = { fov: '120' }
    const groups = buildCvarGroups(ALL_CVARS, { values, unsavedKeys, engine: null })
    const player = groups.find((g) => g.group === 'player')!
    expect(player.total).toBe(playerGroupDefs.length)
    expect(player.edited).toBe(1)
  })

  it('is not edited when the row is absent from unsavedKeys, even if the value differs from the catalogue default', () => {
    // The exact scenario story 049 D7 must still get right: a profile saved long ago with a
    // non-default fov must not show as edited just because it still differs from the catalogue
    // default - only presence in the change set decides "edited" now.
    const values: Record<string, string> = { fov: '120' }
    const groups = buildCvarGroups(ALL_CVARS, { values, unsavedKeys: new Set(), engine: null })
    const player = groups.find((g) => g.group === 'player')!
    expect(player.edited).toBe(0)
  })

  it('keys unsavedKeys via cvarChangeKey, the same identity the change set uses', () => {
    // A key spelled some other way (e.g. differently-cased, or not run through cvarChangeKey at
    // all) must not accidentally match - this guards against a caller passing raw cvar names when
    // the catalogue key differs in casing.
    const values: Record<string, string> = { fov: '120' }
    const groups = buildCvarGroups(ALL_CVARS, {
      values,
      unsavedKeys: new Set(['FOV']),
      engine: null,
    })
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
    const unsavedKeys = new Set([cvarChangeKey('fov')])
    const values: Record<string, string> = { fov: '120' }
    const groups = buildCvarGroups(ALL_CVARS, {
      values,
      unsavedKeys,
      engine: null,
      editedOnly: true,
    })
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
