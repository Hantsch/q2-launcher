import { describe, expect, it } from 'vitest'
import { actionTextSchema, setProfileActionsInputSchema, setSwitchBindInputSchema } from './schemas'

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
    categories: [{ id: 'c1', name: 'My Category', entryKind: 'bind' as const }],
    actions: [
      {
        id: 'a1',
        categoryId: 'c1',
        name: 'Jump forward',
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
})
