import { describe, expect, it } from 'vitest'
import {
  ENGINE_DEFINITIONS,
  SUPPORTED_ENGINE_DEFINITIONS,
  engineLabel,
  isEngineSupported,
} from './engine'

describe('EngineDefinition.supported', () => {
  it('is set to a boolean on every table entry', () => {
    for (const definition of ENGINE_DEFINITIONS) {
      expect(typeof definition.supported).toBe('boolean')
    }
  })

  it('is true for exactly r1q2 and q2pro', () => {
    const supportedKinds = ENGINE_DEFINITIONS.filter((d) => d.supported).map((d) => d.kind)
    expect(supportedKinds).toEqual(['r1q2', 'q2pro'])
  })

  it('still lists all eight known kinds', () => {
    expect(ENGINE_DEFINITIONS.map((d) => d.kind)).toEqual([
      'r1q2',
      'q2pro',
      'yquake2',
      'kmquake2',
      'vkquake2',
      'q2rtx',
      'remaster',
      'vanilla',
    ])
  })
})

describe('SUPPORTED_ENGINE_DEFINITIONS', () => {
  it('yields exactly r1q2 and q2pro, in table order', () => {
    expect(SUPPORTED_ENGINE_DEFINITIONS.map((d) => d.kind)).toEqual(['r1q2', 'q2pro'])
  })
})

describe('isEngineSupported', () => {
  it('is true for r1q2 and q2pro', () => {
    expect(isEngineSupported('r1q2')).toBe(true)
    expect(isEngineSupported('q2pro')).toBe(true)
  })

  it('is false for the other six known engines', () => {
    for (const kind of [
      'yquake2',
      'kmquake2',
      'vkquake2',
      'q2rtx',
      'remaster',
      'vanilla',
    ] as const) {
      expect(isEngineSupported(kind)).toBe(false)
    }
  })

  it('is false for the fallback/sentinel kinds without throwing', () => {
    expect(() => isEngineSupported('custom')).not.toThrow()
    expect(() => isEngineSupported('unknown')).not.toThrow()
    expect(isEngineSupported('custom')).toBe(false)
    expect(isEngineSupported('unknown')).toBe(false)
  })
})

describe('engineLabel', () => {
  it('still returns each unsupported engine own label, not a generic string', () => {
    expect(engineLabel('yquake2')).toBe('Yamagi Quake II')
    expect(engineLabel('kmquake2')).toBe('KMQuake II')
    expect(engineLabel('vkquake2')).toBe('vkQuake2')
    expect(engineLabel('q2rtx')).toBe('Quake II RTX')
    expect(engineLabel('remaster')).toBe('Quake II (2023 Remaster)')
    expect(engineLabel('vanilla')).toBe('Quake II (original)')
  })
})
