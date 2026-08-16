import { describe, expect, it } from 'vitest'
import { findCvar } from './cvar-catalog'
import { validateCvars } from './validate-cvars'

function must(name: string) {
  const def = findCvar(name)
  if (!def) throw new Error(`missing cvar def: ${name}`)
  return def
}

describe('validateCvars — engine value notes', () => {
  it('flags r_maxfps 0 as an error-level finding on r1q2, using the note\'s own specific explanation', () => {
    const findings = validateCvars({ r_maxfps: '0' }, 'r1q2')

    const found = findings.find((f) => f.subject.id === 'r_maxfps')
    const expectedNote = must('r_maxfps').byEngine?.r1q2?.valueNotes?.find((n) => n.value === '0')
    expect(found).toBeDefined()
    expect(found?.level).toBe('error')
    // The note's own message key (cvar-facts.ts's "what the engine actually
    // does, in full sentences"), not a generic wrapper - a review finding
    // caught an earlier version pointing at a note the Validation tab never
    // renders instead of naming R1Q2's 5-FPS behaviour directly.
    expect(found?.messageKey).toBe(expectedNote?.messageKey)
    expect(found?.messageKey).toBe('config.cvar.r_maxfps.byEngine.r1q2.valueNote.0')
    expect(found?.engine).toBe('r1q2')
    expect(found?.subject).toEqual({ kind: 'cvar', id: 'r_maxfps' })
    expect(found?.source).toContain('r1q2')
  })

  it('produces no finding for r_maxfps 0 on q2pro (info note, unremarkable there)', () => {
    // Q2PRO does have a valueNotes entry for r_maxfps 0 (see cvar-catalog.ts),
    // but it is level: 'info' - "0 means unlimited". An info note explains
    // the value (so the range check that 0 < q2pro's min of 10 would
    // otherwise trigger is skipped) without itself becoming a finding.
    const found = must('r_maxfps').byEngine?.q2pro?.valueNotes?.find((n) => n.value === '0')
    expect(found?.level).toBe('info') // sanity-check the assumption this test relies on

    const findings = validateCvars({ r_maxfps: '0' }, 'q2pro')
    expect(findings.some((f) => f.subject.id === 'r_maxfps')).toBe(false)
  })
})

describe('validateCvars — out-of-range values', () => {
  it('reports a clamped out-of-range value with the clamp message and bound', () => {
    // r_maxfps on r1q2: min 5, max 1000, clamps: true. 3000 is above max.
    const findings = validateCvars({ r_maxfps: '3000' }, 'r1q2')

    const found = findings.find((f) => f.subject.id === 'r_maxfps')
    expect(found).toBeDefined()
    expect(found?.level).toBe('warning')
    expect(found?.messageKey).toBe('config.validation.cvar.outOfRangeClamped')
    expect(found?.params).toMatchObject({ name: 'r_maxfps', value: '3000', min: 5, max: 1000, bound: 1000 })
  })

  it('reports a non-clamping out-of-range value with the plain range message', () => {
    // rate on r1q2: min 1000, max 100000, no clamps override -> clamps: false.
    const findings = validateCvars({ rate: '500' }, 'r1q2')

    const found = findings.find((f) => f.subject.id === 'rate')
    expect(found).toBeDefined()
    expect(found?.level).toBe('warning')
    expect(found?.messageKey).toBe('config.validation.cvar.outOfRange')
    expect(found?.params).toMatchObject({ name: 'rate', value: '500', min: 1000, max: 100000, bound: 1000 })
    expect(found?.source).toContain('rate')
  })

  it('does not flag a value inside the engine range', () => {
    const findings = validateCvars({ rate: '25000' }, 'r1q2')
    expect(findings.some((f) => f.subject.id === 'rate')).toBe(false)
  })
})

describe('validateCvars — absent cvars', () => {
  it('reports a cvar the engine does not know, rather than skipping it', () => {
    // ch_scale is absent on both r1q2 and vanilla (cvar-facts.test.ts's own example).
    const findings = validateCvars({ ch_scale: '1' }, 'r1q2')

    const found = findings.find((f) => f.subject.id === 'ch_scale')
    expect(found).toBeDefined()
    expect(found?.level).toBe('error')
    expect(found?.messageKey).toBe('config.validation.cvar.absent')
    expect(found?.engine).toBe('r1q2')
  })

  it('produces no finding at all for a cvar not present in the profile map', () => {
    const findings = validateCvars({}, 'r1q2')
    expect(findings).toHaveLength(0)
  })

  it('is supported (no absent finding) on q2pro, which does register ch_scale', () => {
    const findings = validateCvars({ ch_scale: '1' }, 'q2pro')
    expect(findings.some((f) => f.subject.id === 'ch_scale')).toBe(false)
  })
})

describe('validateCvars — choice values only another engine accepts', () => {
  it('flags cl_async 2 as rejected on r1q2, accepted only by q2pro', () => {
    const findings = validateCvars({ cl_async: '2' }, 'r1q2')

    const found = findings.find((f) => f.subject.id === 'cl_async')
    expect(found).toBeDefined()
    expect(found?.level).toBe('warning')
    expect(found?.messageKey).toBe('config.validation.cvar.choiceRejected')
    expect(found?.params?.accepted).toBe('Q2PRO')
  })

  it('does not flag cl_async 2 on q2pro, which accepts it', () => {
    const findings = validateCvars({ cl_async: '2' }, 'q2pro')
    expect(findings.some((f) => f.subject.id === 'cl_async')).toBe(false)
  })
})
