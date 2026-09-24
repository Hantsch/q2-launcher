import { describe, expect, it } from 'vitest'
import { readIntKey, splitInfostring } from './infostring'

describe('splitInfostring', () => {
  it('every serverinfo key is optional and nothing is defaulted', () => {
    // Leading and trailing backslash tolerance, and no backslash at all.
    expect(splitInfostring('\\gamename\\baseq2\\')).toEqual({ gamename: 'baseq2' })
    expect(splitInfostring('gamename\\baseq2')).toEqual({ gamename: 'baseq2' })
    expect(splitInfostring('\\gamename\\baseq2')).toEqual({ gamename: 'baseq2' })

    // Empty value kept as ''.
    expect(splitInfostring('\\key\\\\otherkey\\val')).toEqual({ key: '', otherkey: 'val' })

    // Dangling final key dropped entirely, not defaulted to ''.
    const danglingResult = splitInfostring('\\gamename\\baseq2\\dangling')
    expect(danglingResult).toEqual({ gamename: 'baseq2' })
    expect('dangling' in danglingResult).toBe(false)

    // Duplicate key: last wins.
    expect(splitInfostring('\\mapname\\q2dm1\\mapname\\q2dm2')).toEqual({ mapname: 'q2dm2' })

    // Empty line -> {}.
    expect(splitInfostring('')).toEqual({})

    // A gamename-less, version-less infostring with other realistic keys still yields a record
    // where those keys are actually absent, not present-with-undefined.
    const noGamenameOrVersion = splitInfostring('\\mapname\\q2dm1\\maxclients\\8\\hostname\\Test Server')
    expect(noGamenameOrVersion).toEqual({ mapname: 'q2dm1', maxclients: '8', hostname: 'Test Server' })
    expect('gamename' in noGamenameOrVersion).toBe(false)
    expect('version' in noGamenameOrVersion).toBe(false)
  })
})

describe('readIntKey', () => {
  it('returns undefined, never 0, for a missing or non-integer value', () => {
    const info = { empty: '', words: 'abc', float: '3.5', maxclients: '8', zero: '0' }

    expect(readIntKey(info, 'missing')).toBeUndefined()
    expect(readIntKey(info, 'empty')).toBeUndefined()
    expect(readIntKey(info, 'words')).toBeUndefined()
    expect(readIntKey(info, 'float')).toBeUndefined()
  })

  it('returns the parsed integer for a clean decimal value, including a real zero', () => {
    const info = { maxclients: '8', zero: '0' }

    expect(readIntKey(info, 'maxclients')).toBe(8)
    expect(readIntKey(info, 'zero')).toBe(0)
  })
})
