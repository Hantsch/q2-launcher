// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { useOverlayRegistry } from './overlay-registry'

const stage = { x: 100, y: 100, width: 400, height: 300 }

function box(x: number, y: number, width: number, height: number): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect
  return el
}

afterEach(() => {
  useOverlayRegistry.setState({ entries: {} })
})

describe('overlay registry', () => {
  it('a modal always occludes', () => {
    const { register, unregister, occludes } = useOverlayRegistry.getState()
    expect(occludes(stage)).toBe(false)
    register('modal', { element: null, always: true })
    expect(occludes(stage)).toBe(true)
    unregister('modal')
    expect(occludes(stage)).toBe(false)
  })

  it('a toast outside the stage does not occlude', () => {
    const { register, unregister, occludes } = useOverlayRegistry.getState()
    register('toasts', { element: box(600, 500, 300, 80) })
    expect(occludes(stage)).toBe(false)
    unregister('toasts')
  })

  it('a menu over the stage occludes', () => {
    const { register, unregister, occludes } = useOverlayRegistry.getState()
    register('menu', { element: box(450, 350, 256, 200) })
    expect(occludes(stage)).toBe(true)
    unregister('menu')
    expect(occludes(stage)).toBe(false)
  })
})
