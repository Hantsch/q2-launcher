import { describe, expect, it } from 'vitest'
import type { AltLayer } from '@shared/config/alt-layers'
import { resolveTriggerLayer, triggerSelectTarget, type TriggerInfo } from './trigger-keys'

function layer(overrides: Partial<AltLayer> = {}): AltLayer {
  return {
    id: 'l1',
    name: 'Weapons',
    mode: 'hold',
    triggerKey: null,
    overrides: {},
    ...overrides,
  }
}

describe('resolveTriggerLayer', () => {
  it('resolves the trigger of a non-active layer with isActive: false', () => {
    const layers = [layer({ id: 'l1', name: 'Weapons', triggerKey: 'q' })]

    const result = resolveTriggerLayer('q', layers, null)

    expect(result).toEqual({ layerId: 'l1', layerName: 'Weapons', isActive: false })
  })

  it('resolves the trigger of the active layer with isActive: true', () => {
    const layers = [layer({ id: 'l1', name: 'Weapons', triggerKey: 'q' })]

    const result = resolveTriggerLayer('q', layers, 'l1')

    expect(result).toEqual({ layerId: 'l1', layerName: 'Weapons', isActive: true })
  })

  it('resolves a blank/absent triggerKey to null', () => {
    const layers = [
      layer({ id: 'l1', triggerKey: null }),
      layer({ id: 'l2', triggerKey: '   ' }),
    ]

    expect(resolveTriggerLayer('q', layers, null)).toBeNull()
  })

  it('never matches an empty string key, even against an equally blank layer key', () => {
    const layers = [layer({ id: 'l1', triggerKey: '' })]

    expect(resolveTriggerLayer('', layers, null)).toBeNull()
  })

  it('matches a lowercase/whitespace trigger key against an uppercase layout key', () => {
    const layers = [layer({ id: 'l1', triggerKey: ' q ' })]

    const result = resolveTriggerLayer('Q', layers, null)

    expect(result?.layerId).toBe('l1')
  })

  it('picks the first layer in array order when two layers share the same trigger key', () => {
    const layers = [
      layer({ id: 'first', triggerKey: 'q' }),
      layer({ id: 'second', triggerKey: 'q' }),
    ]

    const result = resolveTriggerLayer('q', layers, null)

    expect(result?.layerId).toBe('first')
  })
})

describe('triggerSelectTarget', () => {
  it('returns null for the active layer\'s own trigger (two-way toggle back to base)', () => {
    const info: TriggerInfo = { layerId: 'l1', layerName: 'Weapons', isActive: true }

    expect(triggerSelectTarget(info)).toBeNull()
  })

  it('returns the layer id when the layer is not currently active', () => {
    const info: TriggerInfo = { layerId: 'l1', layerName: 'Weapons', isActive: false }

    expect(triggerSelectTarget(info)).toBe('l1')
  })
})
