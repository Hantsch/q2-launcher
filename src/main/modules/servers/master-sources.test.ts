import { describe, expect, it } from 'vitest'
import { DEFAULT_SERVERS_STATE, type MasterSource } from '@shared/modules/servers'
import { parseServersState } from '../../lib/schemas'
import { addSource, removeSource, reorderSources, updateSource } from './master-sources'

/**
 * Story 111 D3: the four pure master-source ops. Everything here is list in, list-or-reason out -
 * no `StateStore`, no `AppContext` (that round trip is `index.test.ts`).
 *
 * The last describe is the one that guards the story's real risk: story 110's `parseServersState`
 * *drops* a row with an unnormalized address or a duplicate id rather than failing loudly, so a
 * mutation that produced one would look fine until the next start and then silently lose a source.
 */

const udp: MasterSource = {
  id: 'a',
  type: 'udp-master',
  address: 'master.q2servers.com:27900',
  enabled: true,
}
const http: MasterSource = {
  id: 'b',
  type: 'http-list',
  address: 'https://q2servers.com/?raw=1',
  enabled: true,
}
const third: MasterSource = {
  id: 'c',
  type: 'udp-master',
  address: 'master.quakeservers.net:27900',
  enabled: false,
}

function list(): MasterSource[] {
  return [{ ...udp }, { ...http }, { ...third }]
}

/** A deterministic id minter, so an expectation can name the id it is about to get. */
function mints(...ids: string[]): () => string {
  let next = 0
  return () => ids[Math.min(next++, ids.length - 1)]!
}

function expectOk(result: ReturnType<typeof addSource>): MasterSource[] {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('expected an accepted result')
  return result.sources
}

describe('addSource', () => {
  it('appends an enabled source with a main-minted id and the normalized address', () => {
    const sources = expectOk(
      addSource(list(), { type: 'udp-master', address: 'master.example.com' }, mints('minted-1')),
    )

    expect(sources).toHaveLength(4)
    expect(sources.map((source) => source.id)).toEqual(['a', 'b', 'c', 'minted-1'])
    // The port default is filled in on the way into state, not left for the reader.
    expect(sources[3]).toEqual({
      id: 'minted-1',
      type: 'udp-master',
      address: 'master.example.com:27900',
      enabled: true,
    })
  })

  it('stores an http-list url whole, query string included', () => {
    const sources = expectOk(
      addSource(
        [],
        { type: 'http-list', address: '  https://example.com/list?raw=1  ' },
        mints('minted-1'),
      ),
    )

    expect(sources[0]?.address).toBe('https://example.com/list?raw=1')
  })

  it('refuses a malformed address with its own reason code and returns no list', () => {
    expect(addSource(list(), { type: 'udp-master', address: 'master.example.com:99999' })).toEqual({
      ok: false,
      reason: 'port-out-of-range',
    })
    expect(addSource(list(), { type: 'http-list', address: 'not a url' })).toEqual({
      ok: false,
      reason: 'invalid-url',
    })
    expect(addSource(list(), { type: 'http-list', address: 'ftp://example.com/list' })).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    })
  })

  it('refuses an address already in the list, after normalization', () => {
    // `master.q2servers.com` normalizes onto the stored `master.q2servers.com:27900`.
    expect(addSource(list(), { type: 'udp-master', address: 'master.q2servers.com' })).toEqual({
      ok: false,
      reason: 'duplicate-address',
    })
  })

  it('never mints an id that is already taken, even when the minter repeats itself', () => {
    const sources = expectOk(
      addSource(list(), { type: 'udp-master', address: 'master.example.com' }, mints('a', 'fresh')),
    )

    expect(sources[3]?.id).toBe('fresh')
    expect(new Set(sources.map((source) => source.id)).size).toBe(4)
  })

  it('falls back to a derived free id rather than writing a duplicate one', () => {
    const sources = expectOk(
      addSource(list(), { type: 'udp-master', address: 'master.example.com' }, mints('a')),
    )

    expect(sources[3]?.id).toBe('source-1')
    expect(new Set(sources.map((source) => source.id)).size).toBe(4)
  })

  it('leaves the list it was given untouched', () => {
    const original = list()
    addSource(original, { type: 'udp-master', address: 'master.example.com' }, mints('minted-1'))
    expect(original).toEqual(list())
  })
})

describe('removeSource', () => {
  it('drops exactly the named source and keeps the rest in order', () => {
    const sources = expectOk(removeSource(list(), { id: 'b' }))
    expect(sources.map((source) => source.id)).toEqual(['a', 'c'])
  })

  it('refuses an unknown id instead of silently doing nothing', () => {
    expect(removeSource(list(), { id: 'nope' })).toEqual({ ok: false, reason: 'not-found' })
  })

  it('leaves the list it was given untouched', () => {
    const original = list()
    removeSource(original, { id: 'b' })
    expect(original).toEqual(list())
  })
})

describe('updateSource - address edit', () => {
  it('re-validates and normalizes the new address in place, keeping id, position and enabled', () => {
    const sources = expectOk(
      updateSource(list(), { id: 'c', type: 'udp-master', address: 'master.other.net' }),
    )

    expect(sources[2]).toEqual({
      id: 'c',
      type: 'udp-master',
      address: 'master.other.net:27900',
      // `enabled: false` survives an address edit - an edit is not a re-enable.
      enabled: false,
    })
  })

  it('can change a source type along with its address', () => {
    const sources = expectOk(
      updateSource(list(), { id: 'a', type: 'http-list', address: 'https://example.com/list' }),
    )

    expect(sources[0]).toEqual({
      id: 'a',
      type: 'http-list',
      address: 'https://example.com/list',
      enabled: true,
    })
  })

  it('refuses a malformed address', () => {
    expect(updateSource(list(), { id: 'a', type: 'http-list', address: 'nope' })).toEqual({
      ok: false,
      reason: 'invalid-url',
    })
  })

  it('refuses an unknown id', () => {
    expect(
      updateSource(list(), { id: 'nope', type: 'udp-master', address: 'master.example.com' }),
    ).toEqual({ ok: false, reason: 'not-found' })
    expect(updateSource(list(), { id: 'nope', enabled: false })).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('refuses an address another source already holds, but allows a no-op re-save of its own', () => {
    expect(
      updateSource(list(), { id: 'a', type: 'udp-master', address: 'master.quakeservers.net' }),
    ).toEqual({ ok: false, reason: 'duplicate-address' })

    const sources = expectOk(
      updateSource(list(), { id: 'a', type: 'udp-master', address: 'master.q2servers.com' }),
    )
    expect(sources[0]?.address).toBe('master.q2servers.com:27900')
  })
})

describe('updateSource - enabled toggle', () => {
  it('disabling keeps the source in the list with its type and address intact', () => {
    const sources = expectOk(updateSource(list(), { id: 'b', enabled: false }))

    expect(sources).toHaveLength(3)
    expect(sources[1]).toEqual({ ...http, enabled: false })
  })

  it('re-enabling touches nothing else either', () => {
    const sources = expectOk(updateSource(list(), { id: 'c', enabled: true }))
    expect(sources[2]).toEqual({ ...third, enabled: true })
  })
})

describe('updateSource - payload shape', () => {
  it('refuses a payload that is neither shape, or both at once', () => {
    // Unreachable over IPC (D1's zod union rejects both first) - defended anyway, because this
    // function is also callable directly.
    expect(updateSource(list(), { id: 'a' } as never)).toEqual({ ok: false, reason: 'empty' })
    expect(
      updateSource(list(), {
        id: 'a',
        type: 'udp-master',
        address: 'master.example.com',
        enabled: false,
      } as never),
    ).toEqual({ ok: false, reason: 'empty' })
  })
})

describe('reorderSources', () => {
  it('applies a full permutation of the current ids', () => {
    const sources = expectOk(reorderSources(list(), { ids: ['c', 'a', 'b'] }))
    expect(sources).toEqual([{ ...third }, { ...udp }, { ...http }])
  })

  it('accepts the empty permutation of an empty list', () => {
    expect(reorderSources([], { ids: [] })).toEqual({ ok: true, sources: [] })
  })

  it('refuses anything that is not exactly the stored id set', () => {
    // Missing one, an extra one, a duplicate, and an unknown id at the right length.
    expect(reorderSources(list(), { ids: ['a', 'b'] })).toEqual({
      ok: false,
      reason: 'invalid-reorder',
    })
    expect(reorderSources(list(), { ids: ['a', 'b', 'c', 'd'] })).toEqual({
      ok: false,
      reason: 'invalid-reorder',
    })
    expect(reorderSources(list(), { ids: ['a', 'a', 'b'] })).toEqual({
      ok: false,
      reason: 'invalid-reorder',
    })
    expect(reorderSources(list(), { ids: ['a', 'b', 'zzz'] })).toEqual({
      ok: false,
      reason: 'invalid-reorder',
    })
  })

  it('leaves the list it was given untouched', () => {
    const original = list()
    reorderSources(original, { ids: ['c', 'b', 'a'] })
    expect(original).toEqual(list())
  })
})

describe('every accepted list survives parseServersState unchanged', () => {
  function roundTrip(sources: MasterSource[]): MasterSource[] {
    return parseServersState({ ...DEFAULT_SERVERS_STATE, sources }).sources
  }

  it('an added source is not dropped on the next load', () => {
    const sources = expectOk(
      addSource(list(), { type: 'udp-master', address: 'MASTER.example.com' }, mints('minted-1')),
    )
    expect(roundTrip(sources)).toEqual(sources)
  })

  it('an added source with a colliding minted id is not dropped on the next load', () => {
    // A duplicate id is what `parseServersState`'s dedupe would silently swallow.
    const sources = expectOk(
      addSource(list(), { type: 'http-list', address: 'https://example.com/list' }, mints('a')),
    )
    expect(roundTrip(sources)).toEqual(sources)
  })

  it('an edited address and a disabled source are not dropped on the next load', () => {
    const edited = expectOk(
      updateSource(list(), { id: 'a', type: 'http-list', address: 'https://example.com/list?raw=1' }),
    )
    expect(roundTrip(edited)).toEqual(edited)

    const disabled = expectOk(updateSource(edited, { id: 'b', enabled: false }))
    expect(roundTrip(disabled)).toEqual(disabled)
  })

  it('a reordered list keeps its order on the next load', () => {
    const sources = expectOk(reorderSources(list(), { ids: ['c', 'a', 'b'] }))
    expect(roundTrip(sources)).toEqual(sources)
  })
})
