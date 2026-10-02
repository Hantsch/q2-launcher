import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STATE_SCHEMA_VERSION } from '@shared/constants'
import { EMPTY_DEMO_LIST_FILTER } from '@shared/replays/list-filter'
import { StateStore } from '../../services/state'
import { parseReplaysState, replaysState } from './persisted'

/**
 * Story 140 D2: `parseReplaysState`'s forgiving parse of the `replays` state key - mirrors
 * `parseServersState`'s envelope/row-level-drop convention (see that describe block above).
 */
describe('parseReplaysState (story 140 D2)', () => {
  it('a missing `replays` key yields the default, empty name-templates state', () => {
    const result = parseReplaysState(undefined)
    expect(result).toEqual({
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
      listFilter: EMPTY_DEMO_LIST_FILTER,
      modWarning: { enabled: true, trustedMods: [] },
    })
  })

  it('modWarning loads forgivingly and round-trips', () => {
    expect(parseReplaysState({}).modWarning).toEqual({ enabled: true, trustedMods: [] })
    expect(
      parseReplaysState({ modWarning: { enabled: 'no', trustedMods: 'x' } }).modWarning,
    ).toEqual({
      enabled: true,
      trustedMods: [],
    })
    const messy = parseReplaysState({
      modWarning: { enabled: false, trustedMods: ['OpenTDM', 'opentdm', 5, '../x', '', 'ctf'] },
    })
    expect(messy.modWarning).toEqual({ enabled: false, trustedMods: ['opentdm', 'ctf'] })
    expect(parseReplaysState(JSON.parse(JSON.stringify(messy)))).toEqual(messy)
  })

  it('a corrupt replays nameTemplates row is dropped, not the list', () => {
    const validUser = { id: 'u1', kind: 'user', template: '{map}_{date}' }
    const validShipped = { id: 's1', kind: 'shipped', shippedId: 'opentdm', template: null }
    const malformedShape = { id: 'bad-shape', kind: 'user' } // missing `template`
    const malformedText = { id: 'bad-text', kind: 'user', template: '{map}/{date}' } // path separator
    const unknownKind = { id: 'bad-kind', kind: 'mystery', template: 'x' }

    const result = parseReplaysState({
      nameTemplates: {
        entries: [validUser, validShipped, malformedShape, malformedText, unknownKind],
        removedShippedIds: [],
      },
    })

    expect(result.nameTemplates.entries).toEqual([validUser, validShipped])
  })

  it('an invalid envelope (not an object) falls back to the default state wholesale', () => {
    const result = parseReplaysState({ nameTemplates: 'not an object' })
    expect(result.nameTemplates).toEqual({ entries: [], removedShippedIds: [] })
  })

  it('duplicate entry ids are deduped, first occurrence wins', () => {
    const first = { id: 'dup', kind: 'user', template: '{map}' }
    const second = { id: 'dup', kind: 'user', template: '{host}' }

    const result = parseReplaysState({
      nameTemplates: { entries: [first, second], removedShippedIds: [] },
    })

    expect(result.nameTemplates.entries).toEqual([first])
  })

  it('a shipped entry whose override text is malformed is dropped', () => {
    const badOverride = {
      id: 's1',
      kind: 'shipped',
      shippedId: 'opentdm',
      template: '{map}\\{date}',
    }
    const result = parseReplaysState({
      nameTemplates: { entries: [badOverride], removedShippedIds: [] },
    })
    expect(result.nameTemplates.entries).toEqual([])
  })

  it('a foreign replays value falls back to the default replays state', () => {
    const result = parseReplaysState('not even an object')
    expect(result).toEqual({
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
      listFilter: EMPTY_DEMO_LIST_FILTER,
      modWarning: { enabled: true, trustedMods: [] },
    })
  })

  it('a malformed extra folder row is dropped, its siblings survive', () => {
    const good = { id: 'f1', path: 'C:\\Demos\\Extra', addedAt: '2026-01-01T00:00:00.000Z' }
    const emptyPath = { id: 'f2', path: '', addedAt: '2026-01-01T00:00:00.000Z' }
    const missingField = { id: 'f3', path: 'C:\\Demos\\Other' }

    const result = parseReplaysState({
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [good, emptyPath, missingField],
    })

    expect(result.extraFolders).toEqual([good])
  })

  // Story 152 D2.
  it('parseReplaysState keeps a valid listSort and drops a malformed one', () => {
    const base = {
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
    }

    const valid = parseReplaysState({ ...base, listSort: { column: 'players', direction: 'desc' } })
    expect(valid.listSort).toEqual({ column: 'players', direction: 'desc' })
    expect(valid.nameTemplates).toEqual(base.nameTemplates)
    expect(valid.extraFolders).toEqual([])

    const malformedColumn = parseReplaysState({
      ...base,
      listSort: { column: 'nope', direction: 'desc' },
    })
    expect(malformedColumn.listSort).toBeUndefined()
    expect(malformedColumn.nameTemplates).toEqual(base.nameTemplates)

    const malformedShape = parseReplaysState({ ...base, listSort: 'players-desc' })
    expect(malformedShape.listSort).toBeUndefined()

    const missingDirection = parseReplaysState({
      ...base,
      listSort: { column: 'players' },
    })
    expect(missingDirection.listSort).toBeUndefined()

    expect(parseReplaysState(undefined).listSort).toBeUndefined()
  })

  // Story 153 D3.
  it('the demo list filter round-trips through state.json', () => {
    const base = {
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
    }

    const filter = {
      ...EMPTY_DEMO_LIST_FILTER,
      search: 'frag',
      favouritesOnly: true,
      tags: ['clutch'],
    }
    const result = parseReplaysState({ ...base, listFilter: filter })

    expect(result.listFilter).toEqual(filter)
    expect(result.nameTemplates).toEqual(base.nameTemplates)
    expect(result.extraFolders).toEqual([])
  })

  // Story 153 D3.
  it('an invalid stored filter degrades to the empty filter', () => {
    const base = {
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
    }

    const malformedShape = parseReplaysState({ ...base, listFilter: 'frag' })
    expect(malformedShape.listFilter).toEqual(EMPTY_DEMO_LIST_FILTER)
    expect(malformedShape.nameTemplates).toEqual(base.nameTemplates)

    const malformedField = parseReplaysState({
      ...base,
      listFilter: { ...EMPTY_DEMO_LIST_FILTER, minRating: 99 },
    })
    expect(malformedField.listFilter).toEqual(EMPTY_DEMO_LIST_FILTER)

    const unknownKey = parseReplaysState({
      ...base,
      listFilter: { ...EMPTY_DEMO_LIST_FILTER, bogus: true },
    })
    expect(unknownKey.listFilter).toEqual(EMPTY_DEMO_LIST_FILTER)

    expect(parseReplaysState(undefined).listFilter).toEqual(EMPTY_DEMO_LIST_FILTER)
  })

  // Story 154 D2.
  it('a stored date filter with from after to parses to no date filter, the other filters survive', () => {
    const base = {
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
    }

    const stored = {
      ...EMPTY_DEMO_LIST_FILTER,
      mod: 'ctf',
      tags: ['clutch'],
      date: { kind: 'custom', from: '2026-01-12', to: '2026-01-05' },
    }
    const result = parseReplaysState({ ...base, listFilter: stored })

    expect(result.listFilter.date).toBeNull()
    expect(result.listFilter.mod).toEqual('ctf')
    expect(result.listFilter.tags).toEqual(['clutch'])
  })
})

describe('parseReplaysState modWarning', () => {
  it('modWarning is a zod schema that catches garbage', () => {
    for (const modWarning of ['x', [], null]) {
      expect(parseReplaysState({ modWarning }).modWarning).toEqual({
        enabled: true,
        trustedMods: [],
      })
    }
  })
})

describe('replays state section (story 142 D1)', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-replays-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('replays state round-trips through state.json and touches no other key', async () => {
    const before = await state.load()
    const extraFolders = [
      { id: 'f1', path: 'C:\\Demos\\Extra', addedAt: '2026-01-01T00:00:00.000Z' },
    ]

    replaysState(state).update((live) => ({ ...live, extraFolders }))
    await state.settle()

    const reloaded = new StateStore(filePath)
    const after = await reloaded.load()

    expect(replaysState(reloaded).get().extraFolders).toEqual(extraFolders)
    // No other top-level key was touched by setting replays state.
    expect({ ...after, replays: undefined }).toEqual({ ...before, replays: undefined })
  })

  it('a state.json without the replays key loads the default replays state, with no schema bump', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: STATE_SCHEMA_VERSION,
      }),
      'utf-8',
    )

    const reloaded = new StateStore(filePath)
    const doc = await reloaded.load()

    expect(replaysState(reloaded).get().extraFolders).toEqual([])
    expect(doc.schemaVersion).toBe(STATE_SCHEMA_VERSION)
  })
})
