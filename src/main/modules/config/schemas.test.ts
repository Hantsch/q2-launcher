import { describe, expect, it } from 'vitest'
import { configWriteFailuresSchema, parseConfigWriteFailures } from '../../lib/schemas'
import {
  actionTextSchema,
  setProfileActionsInputSchema,
  setSwitchBindInputSchema,
  syncStateInputSchema,
} from './schemas'

/**
 * Story 007's IPC payload schema for `setSwitchBind`. `configModule`'s handler
 * is a thin `safeParse` wrapper around this (see `index.ts`), so these cases
 * are what backs the "malformed payload returns
 * `fail('ipc.error.invalidPayload')`" acceptance line.
 */
describe('setSwitchBindInputSchema', () => {
  it('accepts a named key, normalizing case', () => {
    const upper = setSwitchBindInputSchema.parse({ installationId: 'i1', key: 'F9' })
    expect(upper).toEqual({ installationId: 'i1', key: 'F9' })

    const lower = setSwitchBindInputSchema.parse({ installationId: 'i1', key: 'f9' })
    expect(lower).toEqual({ installationId: 'i1', key: 'F9' })
  })

  it('accepts a single printable character', () => {
    const result = setSwitchBindInputSchema.parse({ installationId: 'i1', key: 'g' })
    expect(result).toEqual({ installationId: 'i1', key: 'g' })
  })

  it('accepts key: null as the "clear" case', () => {
    const result = setSwitchBindInputSchema.parse({ installationId: 'i1', key: null })
    expect(result).toEqual({ installationId: 'i1', key: null })
  })

  it('rejects a missing installationId', () => {
    expect(setSwitchBindInputSchema.safeParse({ key: 'F9' }).success).toBe(false)
  })

  it('rejects a key that is neither a known named key nor a single character', () => {
    expect(
      setSwitchBindInputSchema.safeParse({ installationId: 'i1', key: 'notakey' }).success,
    ).toBe(false)
  })

  it('rejects an empty key string', () => {
    expect(setSwitchBindInputSchema.safeParse({ installationId: 'i1', key: '' }).success).toBe(
      false,
    )
  })

  /**
   * Review finding, story 007: these four single characters are printable
   * ASCII, so a naive "is it one printable char" check would have accepted
   * them, but `switch-bind.ts`'s `sanitizeKeyName` strips every one of them
   * (`;` ends a step's command list, `$` triggers macro expansion, `"` cannot
   * be escaped, a bare space is not a key token) - accepting one here would
   * have let the schema call a key "valid" while the generator silently
   * reduced it to an empty key and rendered no chain at all.
   */
  it.each([';', '$', '"', ' '])('rejects the unusable single character %j', (key) => {
    expect(setSwitchBindInputSchema.safeParse({ installationId: 'i1', key }).success).toBe(false)
  })

  it('rejects a missing key field entirely', () => {
    expect(setSwitchBindInputSchema.safeParse({ installationId: 'i1' }).success).toBe(false)
  })
})

/**
 * Story 008's IPC payload schema for `setActions`. Strict, same convention as
 * `setSwitchBindInputSchema` above: a bad payload here is a caller bug and
 * `.parse()` is meant to throw.
 */
describe('actionTextSchema', () => {
  it('rejects text containing an em dash (outside latin-1)', () => {
    expect(actionTextSchema.safeParse('hello — world').success).toBe(false)
  })

  it('rejects text containing a literal double quote', () => {
    expect(actionTextSchema.safeParse('say "hi"').success).toBe(false)
  })

  it('accepts text built entirely from latin-1 high-bit code points', () => {
    const text = String.fromCharCode(0xe9) + String.fromCharCode(0xa0) + 'x'
    expect(actionTextSchema.safeParse(text).success).toBe(true)
  })
})

describe('setProfileActionsInputSchema', () => {
  const validPayload = {
    profileId: 'p1',
    categories: [{ id: 'c1', name: 'My Category' }],
    actions: [
      {
        id: 'a1',
        categoryId: 'c1',
        name: 'Jump forward',
        kind: 'bind' as const,
        commands: [{ kind: 'raw' as const, text: '+forward' }],
        key: 'W',
      },
    ],
  }

  it('accepts a well-formed categories/actions payload', () => {
    expect(setProfileActionsInputSchema.safeParse(validPayload).success).toBe(true)
  })

  it('rejects a payload where a raw command text contains an em dash', () => {
    const payload = {
      ...validPayload,
      actions: [
        {
          ...validPayload.actions[0],
          commands: [{ kind: 'raw', text: 'echo —' }],
        },
      ],
    }
    expect(setProfileActionsInputSchema.safeParse(payload).success).toBe(false)
  })

  it('rejects a payload where a message command text contains a literal quote', () => {
    const payload = {
      ...validPayload,
      actions: [
        {
          ...validPayload.actions[0],
          commands: [{ kind: 'message', channel: 'say', text: 'say "hi"' }],
        },
      ],
    }
    expect(setProfileActionsInputSchema.safeParse(payload).success).toBe(false)
  })

  it('accepts text entirely within U+00A0-U+00FF', () => {
    const text = Array.from({ length: 5 }, (_, i) => String.fromCharCode(0xa0 + i)).join('')
    const payload = {
      ...validPayload,
      actions: [
        {
          ...validPayload.actions[0],
          commands: [{ kind: 'raw', text }],
        },
      ],
    }
    expect(setProfileActionsInputSchema.safeParse(payload).success).toBe(true)
  })

  it('rejects a missing profileId', () => {
    const { profileId: _profileId, ...rest } = validPayload
    expect(setProfileActionsInputSchema.safeParse(rest).success).toBe(false)
  })

  /**
   * Story 019: `kind` is required here and nowhere defaulted. A renderer payload is never trusted,
   * and guessing a missing kind would silently retype the entry - the forgiving derive belongs to
   * the persisted schema (`main/lib/schemas.test.ts`), whose input is an old file, not a caller.
   */
  it('rejects an action row with no kind at all', () => {
    const { kind: _kind, ...action } = validPayload.actions[0]!
    expect(
      setProfileActionsInputSchema.safeParse({ ...validPayload, actions: [action] }).success,
    ).toBe(false)
  })

  it('rejects an action row whose kind is not one of the three', () => {
    const payload = {
      ...validPayload,
      actions: [{ ...validPayload.actions[0], kind: 'binding' }],
    }
    expect(setProfileActionsInputSchema.safeParse(payload).success).toBe(false)
  })

  it.each(['bind', 'message', 'alias'])('accepts kind: %s', (kind) => {
    const payload = {
      ...validPayload,
      actions: [{ ...validPayload.actions[0], kind }],
    }
    expect(setProfileActionsInputSchema.safeParse(payload).success).toBe(true)
  })

  it('accepts a category row carrying only id and name (story 019: no entryKind)', () => {
    const payload = { ...validPayload, categories: [{ id: 'c1', name: 'My Category' }] }
    const parsed = setProfileActionsInputSchema.parse(payload)
    expect(parsed.categories[0]).toEqual({ id: 'c1', name: 'My Category' })
  })
})

/**
 * Story 022 (D5): `syncState`'s IPC input schema, shape-identical to `write`'s
 * (`writeProfileInputSchema`) - same alias convention this file already uses
 * for `unassignProfileInputSchema`/`setDefaultProfileInputSchema`.
 */
describe('syncStateInputSchema', () => {
  it('accepts a well-formed profileId', () => {
    expect(syncStateInputSchema.safeParse({ profileId: 'p1' }).success).toBe(true)
  })

  it('rejects a missing profileId', () => {
    expect(syncStateInputSchema.safeParse({}).success).toBe(false)
  })

  it('rejects an empty profileId', () => {
    expect(syncStateInputSchema.safeParse({ profileId: '' }).success).toBe(false)
  })
})

/**
 * Story 022 (D5): the persisted map of write failures survived across a restart -
 * `<profileId>|<installationId|'own'>` -> the last failed/deferred write attempt. No engine logic
 * yet, just the round-trip and the forgiving-on-bad-data behavior described in
 * `main/lib/schemas.ts`'s doc comment on `configWriteFailuresSchema`.
 */
describe('configWriteFailuresSchema / parseConfigWriteFailures', () => {
  it('round-trips a well-formed map unchanged', () => {
    const value = {
      'p1|own': { messageKey: 'config.sync.error.locked', at: '2026-08-21T00:00:00.000Z' },
      'p1|i1': { messageKey: 'config.sync.error.permission', at: '2026-08-20T12:00:00.000Z' },
    }
    expect(parseConfigWriteFailures(value)).toEqual(value)
  })

  it('parses undefined/missing input to {}', () => {
    expect(parseConfigWriteFailures(undefined)).toEqual({})
  })

  it('parses a totally malformed value (a string) to {}', () => {
    expect(parseConfigWriteFailures('not a map')).toEqual({})
  })

  it('parses a totally malformed value (an array) to {}', () => {
    expect(parseConfigWriteFailures(['p1|own'])).toEqual({})
  })

  /**
   * Decision: a single malformed entry is dropped on its own rather than wiping the whole map -
   * there is no sensible fallback value for one corrupt failure entry (unlike, say,
   * `configPlayedModsSchema`'s per-entry `.catch(() => [])`), so it is filtered out before the
   * record schema ever sees it instead of being defaulted to a placeholder.
   */
  it('drops a single malformed entry, keeping the rest of an otherwise-valid map', () => {
    const value = {
      'p1|own': { messageKey: 'config.sync.error.locked', at: '2026-08-21T00:00:00.000Z' },
      'p1|i1': { messageKey: 42, at: '2026-08-20T12:00:00.000Z' },
      'p1|i2': 'not an object',
    }
    expect(parseConfigWriteFailures(value)).toEqual({
      'p1|own': { messageKey: 'config.sync.error.locked', at: '2026-08-21T00:00:00.000Z' },
    })
  })

  it('exposes the same behavior via configWriteFailuresSchema directly', () => {
    expect(configWriteFailuresSchema.parse(null)).toEqual({})
  })
})
