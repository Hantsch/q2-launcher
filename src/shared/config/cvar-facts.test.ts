import { describe, expect, it } from 'vitest'
import { findCvar } from './cvar-catalog'
import {
  engineDisagreement,
  hasEngineFacts,
  isCvarSupported,
  noteForValue,
  resolveCvar,
} from './cvar-facts'

function must(name: string) {
  const def = findCvar(name)
  if (!def) throw new Error(`missing cvar def: ${name}`)
  return def
}

describe('resolveCvar', () => {
  it('resolves r_maxfps on r1q2: present, engine default 1000, min 5, clamps', () => {
    const resolved = resolveCvar(must('r_maxfps'), 'r1q2')
    expect(resolved.absent).toBe(false)
    expect(resolved.engineDefault).toBe('1000')
    expect(resolved.min).toBe(5)
    expect(resolved.clamps).toBe(true)
  })

  it('narrows cl_maxfps min/max per engine instead of using the def-level range', () => {
    const def = must('cl_maxfps')
    expect(def.min).toBe(0)
    expect(def.max).toBe(1000)

    const r1q2 = resolveCvar(def, 'r1q2')
    expect(r1q2.min).toBe(5)
    // r1q2 has no per-engine max override, so it falls back to the def's max.
    expect(r1q2.max).toBe(1000)

    const q2pro = resolveCvar(def, 'q2pro')
    expect(q2pro.min).toBe(10)
    expect(q2pro.max).toBe(125)
  })

  it('reports an absent cvar as unsupported', () => {
    const def = must('ch_scale')
    expect(resolveCvar(def, 'r1q2').absent).toBe(true)
    expect(resolveCvar(def, 'vanilla').absent).toBe(true)
    expect(isCvarSupported(def, 'r1q2')).toBe(false)
    expect(isCvarSupported(def, 'vanilla')).toBe(false)
    // q2pro does register it.
    expect(resolveCvar(def, 'q2pro').absent).toBe(false)
    expect(isCvarSupported(def, 'q2pro')).toBe(true)
  })
})

describe('noteForValue', () => {
  it('flags r_maxfps 0 as an error on r1q2 but only info on q2pro', () => {
    const def = must('r_maxfps')

    const r1q2Note = noteForValue(def, 'r1q2', '0')
    expect(r1q2Note).toBeDefined()
    expect(r1q2Note?.level).toBe('error')

    const q2proNote = noteForValue(def, 'q2pro', '0')
    expect(q2proNote).toBeDefined()
    expect(q2proNote?.level).toBe('info')
    expect(q2proNote?.level).not.toBe('error')
    expect(q2proNote?.level).not.toBe('warning')
  })

  it('surfaces the same r_maxfps 0 note through resolveCvar(...).valueNotes', () => {
    const def = must('r_maxfps')
    const r1q2 = resolveCvar(def, 'r1q2')
    expect(r1q2.valueNotes.find((n) => n.value === '0')?.level).toBe('error')
  })

  it('has no error/warning note for cl_maxfps 0 on q2pro either (info only)', () => {
    const def = must('cl_maxfps')
    const note = noteForValue(def, 'q2pro', '0')
    expect(note?.level).toBe('info')
    const r1q2Note = noteForValue(def, 'r1q2', '0')
    expect(r1q2Note?.level).toBe('error')
  })
})

describe('engineDisagreement', () => {
  it('reports r_maxfps 0 as a disagreement between r1q2 and q2pro', () => {
    const result = engineDisagreement(must('r_maxfps'), 'r1q2', 'q2pro', '0')
    expect(result?.engine).toBe('q2pro')
    expect(result?.absent).toBe(false)
    expect(result?.defaultDiffers).toBe(true)
    expect(result?.rangeDiffers).toBe(true)
    // The severity lives on r1q2, the engine in scope - q2pro's own note for 0
    // is a harmless "unlimited", so no foreign warning travels with the badge.
    expect(result?.valueMeaningDiffers).toBe(true)
    expect(result?.note).toBeUndefined()
  })

  it('carries the other engine severity when the warning is the foreign one', () => {
    const result = engineDisagreement(must('r_maxfps'), 'q2pro', 'r1q2', '0')
    expect(result?.note?.level).toBe('error')
  })

  it('still reports the structural difference at a value neither engine warns about', () => {
    const result = engineDisagreement(must('r_maxfps'), 'r1q2', 'q2pro', '125')
    expect(result?.note).toBeUndefined()
    expect(result?.defaultDiffers).toBe(true)
  })

  it('reports a cvar the other engine does not have as absent', () => {
    const result = engineDisagreement(must('con_alpha'), 'q2pro', 'r1q2', '1')
    expect(result?.absent).toBe(true)
  })

  it('makes no claim about the same engine or an engine without facts', () => {
    const def = must('r_maxfps')
    expect(engineDisagreement(def, 'r1q2', 'r1q2', '0')).toBeUndefined()
    expect(engineDisagreement(def, 'r1q2', 'yquake2', '0')).toBeUndefined()
    expect(engineDisagreement(def, 'yquake2', 'r1q2', '0')).toBeUndefined()
  })

  it('makes no claim when the cvar is absent on the engine in scope', () => {
    expect(engineDisagreement(must('con_alpha'), 'r1q2', 'q2pro', '1')).toBeUndefined()
  })
})

describe('hasEngineFacts', () => {
  it('is true only for the three engines the catalog carries facts for', () => {
    expect(hasEngineFacts('r1q2')).toBe(true)
    expect(hasEngineFacts('q2pro')).toBe(true)
    expect(hasEngineFacts('vanilla')).toBe(true)
    expect(hasEngineFacts('yquake2')).toBe(false)
    expect(hasEngineFacts('kmquake2')).toBe(false)
    expect(hasEngineFacts('unknown')).toBe(false)
  })
})
