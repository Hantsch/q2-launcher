import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_WAIT_FRAMES } from '@shared/config/engine-limits'
import { ROUND_TRIP_FIXTURES, toggleEntryProfile } from '@shared/config/fixtures/profiles'
import { configProfileSchema } from './persisted'
import {
  setProfileActionsInputSchema,
  setProfileCvarsInputSchema,
  setProfileLayersInputSchema,
} from './schemas'

// Bind adoption mints ids on read; a counter keeps the snapshot reproducible.
let uuidCounter = 0
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return {
    ...actual,
    randomUUID: () => `uuid-${++uuidCounter}`,
  }
})

beforeEach(() => {
  uuidCounter = 0
})

const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

/** Serialised verdict; large payloads are hashed so the snapshot stays reviewable. */
function verdict(result: { success: boolean; data?: unknown }): string {
  const json = result.success ? JSON.stringify(result.data) : '-'
  const body = json.length > 2000 ? `sha1:${createHash('sha1').update(json).digest('hex')}` : json
  return `${result.success} ${body}`
}

function parseProfile(raw: unknown): string {
  const result = configProfileSchema.safeParse(wire(raw))
  return verdict(result)
}

const baseProfile = {
  id: 'p1',
  name: 'Malformed corpus',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const cat = { id: 'c1', name: 'Cat' }
const act = { id: 'a1', categoryId: 'c1', name: 'Act', kind: 'bind', commands: [] }
const withActions = (...actions: unknown[]) => ({
  ...baseProfile,
  categories: [cat],
  actions: actions,
})

describe('persisted profile parse is unchanged', () => {
  it('parses every round-trip fixture identically', () => {
    const out = ROUND_TRIP_FIXTURES.map((profile) => parseProfile(profile))
    expect(out.join('\n')).toMatchSnapshot()
  })

  it('degrades or drops malformed rows identically', () => {
    const corpus: Record<string, unknown> = {
      commandWithQuote: withActions({
        ...act,
        commands: [{ kind: 'raw', text: 'say "hi"' }],
      }),
      commandNonLatin1: withActions({
        ...act,
        commands: [{ kind: 'raw', text: 'say 世' }],
      }),
      emptyActionId: withActions({ ...act, id: '' }),
      emptyLayerId: {
        ...baseProfile,
        layers: [{ id: '', name: 'L', mode: 'hold', triggerKey: 'x', overrides: {} }],
      },
      triggerKeyNumber: {
        ...baseProfile,
        layers: [{ id: 'l1', name: 'L', mode: 'hold', triggerKey: 42, overrides: {} }],
      },
      legacyCategoryEntryKind: {
        ...baseProfile,
        categories: [{ ...cat, entryKind: 'alias' }],
        actions: [{ id: 'a1', categoryId: 'c1', name: 'Act', commands: [] }],
      },
      legacyCategoryEntryKindMangled: {
        ...baseProfile,
        categories: [{ ...cat, entryKind: 42 }],
        actions: [{ id: 'a1', categoryId: 'c1', name: 'Act', commands: [] }],
      },
      legacyKeyShape: withActions({
        ...act,
        key: 'a',
        keyModifier: 'ALT',
        secondaryKey: 'b',
        secondaryKeyModifier: 'CTRL',
      }),
      badModifier: withActions({ ...act, keys: [{ key: 'a', modifier: 'META' }] }),
      oneBadPartToggle: withActions({
        ...act,
        kind: 'toggle',
        parts: [{ commands: [{ kind: 'raw', text: 'x' }] }],
      }),
      malformedSubcategoryRow: {
        ...baseProfile,
        categories: [{ ...cat, subcategories: [{ id: 's1', name: 'Ok' }, { id: '' }, 7] }],
      },
      cvarsSevenOnSection: {
        ...baseProfile,
        cvarSections: [{ id: 's1', name: 'Sec', cvars: 7 }],
      },
      mangledBaseline: { ...baseProfile, baseline: { cvars: 7 } },
    }
    const out = Object.fromEntries(Object.entries(corpus).map(([k, v]) => [k, parseProfile(v)]))
    expect(JSON.stringify(out, null, 1)).toMatchSnapshot()
  })
})

type Schema = { safeParse: (v: unknown) => { success: boolean; data?: unknown } }
const run = (schema: Schema, payload: unknown): string => verdict(schema.safeParse(wire(payload)))

const okAction = (id = 'a1') => ({
  id,
  categoryId: 'c1',
  name: 'Act',
  kind: 'bind',
  commands: [],
})
const actionsPayload = (over: Record<string, unknown> = {}) => ({
  profileId: 'p1',
  categories: [cat],
  actions: [okAction()],
  ...over,
})
const actionWith = (over: Record<string, unknown>) =>
  actionsPayload({ actions: [{ ...okAction(), ...over }] })
const repeat = <T>(count: number, make: (i: number) => T): T[] =>
  Array.from({ length: count }, (_, i) => make(i))
const rawCommands = (count: number) => repeat(count, () => ({ kind: 'raw', text: 'x' }))

describe('IPC payload verdicts are unchanged', () => {
  it('actions payload verdicts', () => {
    const fixture = toggleEntryProfile
    const cases: Record<string, unknown> = {
      fixtureValid: {
        profileId: fixture.id,
        categories: fixture.categories,
        actions: fixture.actions,
      },
      name120: actionWith({ name: 'n'.repeat(120) }),
      name121: actionWith({ name: 'n'.repeat(121) }),
      commands64: actionWith({ commands: rawCommands(64) }),
      commands65: actionWith({ commands: rawCommands(65) }),
      keys64: actionWith({ keys: repeat(64, () => ({ key: 'a' })) }),
      keys65: actionWith({ keys: repeat(65, () => ({ key: 'a' })) }),
      keyLength20: actionWith({ keys: [{ key: 'k'.repeat(20) }] }),
      keyLength21: actionWith({ keys: [{ key: 'k'.repeat(21) }] }),
      actions500: actionsPayload({ actions: repeat(500, (i) => okAction(`a${i}`)) }),
      actions501: actionsPayload({ actions: repeat(501, (i) => okAction(`a${i}`)) }),
      categories64: actionsPayload({ categories: repeat(64, (i) => ({ id: `c${i}`, name: 'C' })) }),
      categories65: actionsPayload({ categories: repeat(65, (i) => ({ id: `c${i}`, name: 'C' })) }),
      subcategories64: actionsPayload({
        categories: [{ ...cat, subcategories: repeat(64, (i) => ({ id: `s${i}`, name: 'S' })) }],
      }),
      subcategories65: actionsPayload({
        categories: [{ ...cat, subcategories: repeat(65, (i) => ({ id: `s${i}`, name: 'S' })) }],
      }),
      framesZero: actionWith({ commands: [{ kind: 'wait', frames: 0 }] }),
      framesOne: actionWith({ commands: [{ kind: 'wait', frames: 1 }] }),
      framesMax: actionWith({ commands: [{ kind: 'wait', frames: MAX_WAIT_FRAMES }] }),
      framesOverMax: actionWith({ commands: [{ kind: 'wait', frames: MAX_WAIT_FRAMES + 1 }] }),
      emptyActionId: actionWith({ id: '' }),
      emptyCategoryId: actionsPayload({ categories: [{ id: '', name: 'C' }] }),
      oneParToggle: actionWith({
        kind: 'toggle',
        parts: [{ commands: [] }],
      }),
      twoPartToggle: actionWith({
        kind: 'toggle',
        parts: [{ commands: [] }, { commands: [] }],
      }),
      quoteInText: actionWith({ commands: [{ kind: 'raw', text: 'say "x"' }] }),
      quoteInMessage: actionWith({
        commands: [{ kind: 'message', channel: 'say', text: 'a"b' }],
      }),
      nonLatin1Text: actionWith({ commands: [{ kind: 'raw', text: '世' }] }),
    }
    const out = Object.fromEntries(
      Object.entries(cases).map(([k, v]) => [k, run(setProfileActionsInputSchema, v)]),
    )
    expect(JSON.stringify(out, null, 1)).toMatchSnapshot()
  })

  it('cvars payload verdicts', () => {
    const section = (over: Record<string, unknown> = {}) => ({
      id: 's1',
      name: 'Sec',
      cvars: ['a'],
      ...over,
    })
    const payload = (over: Record<string, unknown>) => ({
      profileId: 'p1',
      cvars: { a: '1' },
      ...over,
    })
    const cases: Record<string, unknown> = {
      valid: payload({
        cvarSections: [section({ subsections: [{ id: 'x', name: 'X', cvars: ['b'] }] })],
      }),
      noSections: payload({}),
      sectionName120: payload({ cvarSections: [section({ name: 'n'.repeat(120) })] }),
      sectionName121: payload({ cvarSections: [section({ name: 'n'.repeat(121) })] }),
      cvarSections64: payload({ cvarSections: repeat(64, (i) => section({ id: `s${i}` })) }),
      cvarSections65: payload({ cvarSections: repeat(65, (i) => section({ id: `s${i}` })) }),
      subsections64: payload({
        cvarSections: [
          section({ subsections: repeat(64, (i) => ({ id: `x${i}`, name: 'X', cvars: [] })) }),
        ],
      }),
      subsections65: payload({
        cvarSections: [
          section({ subsections: repeat(65, (i) => ({ id: `x${i}`, name: 'X', cvars: [] })) }),
        ],
      }),
      cvarNames512: payload({
        cvarSections: [section({ cvars: repeat(512, (i) => `c${i}`) })],
      }),
      cvarNames513: payload({
        cvarSections: [section({ cvars: repeat(513, (i) => `c${i}`) })],
      }),
      subsectionCvarNames512: payload({
        cvarSections: [
          section({ subsections: [{ id: 'x', name: 'X', cvars: repeat(512, (i) => `c${i}`) }] }),
        ],
      }),
      subsectionCvarNames513: payload({
        cvarSections: [
          section({ subsections: [{ id: 'x', name: 'X', cvars: repeat(513, (i) => `c${i}`) }] }),
        ],
      }),
      emptySectionId: payload({ cvarSections: [section({ id: '' })] }),
      emptyCvarName: payload({ cvars: { '': '1' } }),
    }
    const out = Object.fromEntries(
      Object.entries(cases).map(([k, v]) => [k, run(setProfileCvarsInputSchema, v)]),
    )
    expect(JSON.stringify(out, null, 1)).toMatchSnapshot()
  })

  it('layers payload verdicts', () => {
    const layer = (over: Record<string, unknown> = {}) => ({
      id: 'l1',
      name: 'L',
      mode: 'hold',
      triggerKey: 'x',
      overrides: { a: 'b' },
      ...over,
    })
    const cases: Record<string, unknown> = {
      valid: { profileId: 'p1', layers: [layer(), layer({ id: 'l2', triggerKey: null })] },
      layers64: { profileId: 'p1', layers: repeat(64, (i) => layer({ id: `l${i}` })) },
      layers65: { profileId: 'p1', layers: repeat(65, (i) => layer({ id: `l${i}` })) },
      emptyLayerId: { profileId: 'p1', layers: [layer({ id: '' })] },
      triggerKeyNumber: { profileId: 'p1', layers: [layer({ triggerKey: 42 })] },
      emptyTriggerKey: { profileId: 'p1', layers: [layer({ triggerKey: '' })] },
      badMode: { profileId: 'p1', layers: [layer({ mode: 'press' })] },
    }
    const out = Object.fromEntries(
      Object.entries(cases).map(([k, v]) => [k, run(setProfileLayersInputSchema, v)]),
    )
    expect(JSON.stringify(out, null, 1)).toMatchSnapshot()
  })
})
