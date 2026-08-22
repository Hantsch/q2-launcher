import { describe, expect, it } from 'vitest'
import { pressReleasePairs } from '@shared/config/press-release'
import type { ConfigAction } from '@shared/modules/config'

function action(id: string, name: string): ConfigAction {
  return { id, categoryId: 'imported', name, kind: 'alias', commands: [] }
}

describe('pressReleasePairs', () => {
  it('pairs a matched +x/-x by base name', () => {
    const press = action('1', '+slow')
    const release = action('2', '-slow')

    const result = pressReleasePairs([press, release])

    expect(result.pairs).toEqual([{ base: 'slow', press, release }])
    expect(result.unmatched).toEqual([])
  })

  it('leaves a +x with no matching -x unmatched', () => {
    const press = action('1', '+slow')

    const result = pressReleasePairs([press])

    expect(result.pairs).toEqual([])
    expect(result.unmatched).toEqual([press])
  })

  it('leaves a -x with no matching +x unmatched', () => {
    const release = action('1', '-slow')

    const result = pressReleasePairs([release])

    expect(result.pairs).toEqual([])
    expect(result.unmatched).toEqual([release])
  })

  it('pairs multiple independent +x/-x sets in one list', () => {
    const slowPress = action('1', '+slow')
    const slowRelease = action('2', '-slow')
    const zoomPress = action('3', '+zoom')
    const zoomRelease = action('4', '-zoom')

    const result = pressReleasePairs([slowPress, zoomPress, slowRelease, zoomRelease])

    expect(result.pairs).toEqual([
      { base: 'slow', press: slowPress, release: slowRelease },
      { base: 'zoom', press: zoomPress, release: zoomRelease },
    ])
    expect(result.unmatched).toEqual([])
  })

  it('never considers a name with no leading +/- for pairing', () => {
    const plain = action('1', 'drop_shotgun')

    const result = pressReleasePairs([plain])

    expect(result.pairs).toEqual([])
    expect(result.unmatched).toEqual([plain])
  })

  it('mixes paired and unmatched entries in one list', () => {
    const press = action('1', '+slow')
    const release = action('2', '-slow')
    const lonelyPress = action('3', '+dj')
    const plain = action('4', 'drop_shotgun')

    const result = pressReleasePairs([press, lonelyPress, release, plain])

    expect(result.pairs).toEqual([{ base: 'slow', press, release }])
    expect(result.unmatched).toEqual([lonelyPress, plain])
  })
})
