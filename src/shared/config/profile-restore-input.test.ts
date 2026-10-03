import { describe, expect, it } from 'vitest'
import { restoredToProfileFields, toRestoreInput } from './profile-restore-input'

const newId = (): string => 'id'

describe('toRestoreInput', () => {
  it('carries every RestoreProfilePartsInput field from a folded source', () => {
    const input = toRestoreInput(
      'main.cfg',
      {
        aliases: [
          { name: 'a', body: 'x', line: 1, comment: 'c', codeWidth: 3 },
          { name: 'b', body: 'y', line: 2, comment: '', codeWidth: 1, file: 'other.cfg' },
        ],
        binds: [
          { key: 'f', command: 'go', line: 3, comment: 'k' },
          { key: 'g', command: 'stop', line: 4, comment: '', file: 'other.cfg' },
        ],
        cvars: new Set([
          { name: 'p', value: '1', line: 5, comment: 'v', firstFile: 'first.cfg', firstLine: 2 },
          { name: 'q', value: '2', line: 6, comment: '', file: 'other.cfg' },
        ]),
      },
      {
        comments: [
          { text: 'hello', line: 7 },
          { text: 'bye', line: 8, file: 'other.cfg' },
        ],
        newId,
      },
    )

    expect(input.aliases).toEqual([
      { name: 'a', body: 'x', file: 'main.cfg', line: 1, comment: 'c', codeWidth: 3 },
      { name: 'b', body: 'y', file: 'other.cfg', line: 2, comment: '', codeWidth: 1 },
    ])
    expect(input.binds.map((bind) => bind.file)).toEqual(['main.cfg', 'other.cfg'])
    expect(input.cvars[0]).toEqual({
      name: 'p',
      value: '1',
      file: 'main.cfg',
      line: 5,
      comment: 'v',
      firstFile: 'first.cfg',
      firstLine: 2,
    })
    expect(input.cvars[1]).toEqual({
      name: 'q',
      value: '2',
      file: 'other.cfg',
      line: 6,
      comment: '',
    })
    expect('firstFile' in input.cvars[1]).toBe(false)
    expect(input.comments).toEqual([
      { text: 'hello', file: 'main.cfg', line: 7 },
      { text: 'bye', file: 'other.cfg', line: 8 },
    ])
    expect('layerAliases' in input).toBe(false)
    expect(input.newId).toBe(newId)

    const withLayers = toRestoreInput(
      '',
      { aliases: [], binds: [], cvars: [] },
      { comments: [], layerAliases: ['l'], newId },
    )
    expect(withLayers.layerAliases).toEqual(['l'])
  })
})

describe('restoredToProfileFields', () => {
  it('restoredToProfileFields carries all six fields', () => {
    const actions = [{ id: 'a' }] as never
    const categories = [{ id: 'c' }] as never
    const cvarSections = [{ id: 's' }] as never
    const layers = [{ alias: 'l' }] as never

    const fields = restoredToProfileFields(
      { sens: '4' },
      { f: 'go' },
      {
        actions,
        categories,
        cvarSections,
        layers,
      },
    )

    expect(fields).toEqual({
      cvars: { sens: '4' },
      binds: { f: 'go' },
      actions,
      categories,
      cvarSections,
      layers,
    })
    expect(Object.keys(fields).sort()).toEqual(
      ['actions', 'binds', 'categories', 'cvarSections', 'cvars', 'layers'].sort(),
    )
  })
})
