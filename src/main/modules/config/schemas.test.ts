import { describe, expect, it } from 'vitest'
import { setSwitchBindInputSchema } from './schemas'

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
