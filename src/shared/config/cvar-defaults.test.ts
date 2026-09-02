import { describe, expect, it } from 'vitest'
import { findCvar } from './cvar-catalog'
import { isDefaultValue, stripCatalogDefaults, writeValueFor } from './cvar-defaults'

function must(name: string) {
  const def = findCvar(name)
  if (!def) throw new Error(`missing cvar def: ${name}`)
  return def
}

// cl_run: kind 'toggle', default '1'. sensitivity: kind 'slider', default '4'.
const CL_RUN = must('cl_run')
const SENSITIVITY = must('sensitivity')
// gl_shadows: kind 'toggle' but not a true boolean — accepts 0/1/2 shadow quality levels; default '0'.
const GL_SHADOWS = must('gl_shadows')
// name: kind 'text', default 'player' — a case-sensitive display string.
const NAME = must('name')
// skin: kind 'choice', default 'male/grunt' — an engine-keyword-style enum, case-insensitive.
const SKIN = must('skin')

describe('isDefaultValue', () => {
  it('matches the cvar name case-insensitively via findCvar, same rule findCvar itself uses', () => {
    expect(findCvar('CL_RUN')).toBe(findCvar('cl_run'))
    expect(findCvar('Cl_Run')?.name).toBe('cl_run')
  })

  it('treats "true" and "1" as the same toggle value', () => {
    expect(isDefaultValue(CL_RUN, 'true')).toBe(true)
    expect(isDefaultValue(CL_RUN, 'TRUE')).toBe(true)
    expect(isDefaultValue(CL_RUN, '1')).toBe(true)
    expect(isDefaultValue(CL_RUN, '0')).toBe(false)
    expect(isDefaultValue(CL_RUN, 'false')).toBe(false)
  })

  it('treats "1.0" and "1" as the same numeric value', () => {
    // sensitivity default is "4"
    expect(isDefaultValue(SENSITIVITY, '4.0')).toBe(true)
    expect(isDefaultValue(SENSITIVITY, '4')).toBe(true)
    expect(isDefaultValue(SENSITIVITY, '4.5')).toBe(false)
  })

  it('treats an empty or whitespace-only value as unset, i.e. default, regardless of def.default', () => {
    expect(isDefaultValue(CL_RUN, '')).toBe(true)
    expect(isDefaultValue(CL_RUN, '   ')).toBe(true)
    expect(isDefaultValue(SENSITIVITY, '')).toBe(true)
    expect(isDefaultValue(SENSITIVITY, '\t\n')).toBe(true)
  })

  it('does not collapse a non-boolean toggle value to the "0" default (gl_shadows: 0/1/2)', () => {
    expect(GL_SHADOWS.default).toBe('0')
    expect(isDefaultValue(GL_SHADOWS, '2')).toBe(false)
    expect(isDefaultValue(GL_SHADOWS, '1')).toBe(false)
    expect(isDefaultValue(GL_SHADOWS, '0')).toBe(true)
  })

  it('is case-sensitive for kind "text" cvars, where casing is meaningful (name)', () => {
    expect(NAME.default).toBe('player')
    expect(isDefaultValue(NAME, 'Player')).toBe(false)
    expect(isDefaultValue(NAME, 'player')).toBe(true)
  })

  it('stays case-insensitive for kind "choice" cvars, unlike "text" (skin)', () => {
    expect(SKIN.default).toBe('male/grunt')
    expect(isDefaultValue(SKIN, 'Male/Grunt')).toBe(true)
    expect(isDefaultValue(SKIN, 'MALE/GRUNT')).toBe(true)
    expect(isDefaultValue(SKIN, 'male/cipher')).toBe(false)
  })
})

describe('writeValueFor', () => {
  it('returns def.default when stored is undefined, empty or whitespace-only', () => {
    expect(writeValueFor(SENSITIVITY, undefined)).toBe('4')
    expect(writeValueFor(SENSITIVITY, '')).toBe('4')
    expect(writeValueFor(SENSITIVITY, '   ')).toBe('4')
  })

  it('returns the stored value verbatim, without re-normalizing it, otherwise', () => {
    expect(writeValueFor(SENSITIVITY, '4.0')).toBe('4.0')
    expect(writeValueFor(SENSITIVITY, '7')).toBe('7')
    expect(writeValueFor(CL_RUN, 'TRUE')).toBe('TRUE')
  })
})

describe('stripCatalogDefaults', () => {
  it('removes a catalogue cvar key whose value is the default, matching case-insensitively', () => {
    const out = stripCatalogDefaults({ CL_RUN: '1', Sensitivity: '10' })
    expect(out).toEqual({ Sensitivity: '10' })
  })

  it('removes a toggle key at its default via the "true"/"1" equivalence', () => {
    const out = stripCatalogDefaults({ cl_run: 'true' })
    expect(out).toEqual({})
  })

  it('removes a numeric key at its default via the "1.0"/"1" equivalence', () => {
    const out = stripCatalogDefaults({ sensitivity: '4.0' })
    expect(out).toEqual({})
  })

  it('treats an empty/whitespace stored value for a catalogue cvar as unset and removes it', () => {
    const out = stripCatalogDefaults({ sensitivity: '', cl_run: '   ' })
    expect(out).toEqual({})
  })

  it('leaves a non-catalogue key completely untouched, including when its value is empty', () => {
    const input = { sensitivity: '4', totally_unknown_cvar: '' }
    const out = stripCatalogDefaults(input)
    expect(out).toEqual({ totally_unknown_cvar: '' })
  })

  it('does not strip a non-boolean toggle value that differs from the "0" default (gl_shadows: "2")', () => {
    const out = stripCatalogDefaults({ gl_shadows: '2' })
    expect(out).toEqual({ gl_shadows: '2' })
  })

  it('does not strip a text cvar whose stored value differs only in case from the default (name)', () => {
    const out = stripCatalogDefaults({ name: 'Player' })
    expect(out).toEqual({ name: 'Player' })
  })

  it('does not mutate its input', () => {
    const input = { cl_run: '1', sensitivity: '10' }
    const snapshot = { ...input }
    stripCatalogDefaults(input)
    expect(input).toEqual(snapshot)
  })
})
