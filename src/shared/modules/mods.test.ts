import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import {
  MODS_HANDLERS,
  MODS_HANDLER_SCHEMAS,
  type ModsContract,
  removalPreviewInputSchema,
  removeInputSchema,
  revealInputSchema,
  updateInputSchema,
  updatePreviewInputSchema,
} from './mods'

describe('mods schemas', () => {
  it('reveal input rejects a gamedir with a path separator', () => {
    const base = { installationId: 'inst-1' }
    expect(revealInputSchema.safeParse({ ...base, gameDir: 'rogue' }).success).toBe(true)
    for (const gameDir of ['../x', 'a/b', 'a\\b', '', 'C:\\x']) {
      expect(revealInputSchema.safeParse({ ...base, gameDir }).success).toBe(false)
    }
  })

  it('removal inputs reject an unsafe mod id and an unknown changedFiles choice', () => {
    const base = { installationId: 'inst-1', modId: 'rogue' }
    expect(removalPreviewInputSchema.safeParse(base).success).toBe(true)
    expect(removeInputSchema.safeParse({ ...base, changedFiles: 'keep' }).success).toBe(true)
    for (const modId of ['', '../x', 'a/b', 'a\\b', 'C:\\x', 'x'.repeat(129)]) {
      expect(removalPreviewInputSchema.safeParse({ ...base, modId }).success).toBe(false)
      expect(removeInputSchema.safeParse({ ...base, modId, changedFiles: 'delete' }).success).toBe(
        false,
      )
    }
    expect(removeInputSchema.safeParse({ ...base, changedFiles: 'maybe' }).success).toBe(false)
    expect(removeInputSchema.safeParse(base).success).toBe(false)
    expect(removalPreviewInputSchema.safeParse({ ...base, extra: 1 }).success).toBe(false)
  })

  it('update inputs are strict, reject an unsafe catalog id and an unknown policy', () => {
    const base = { installationId: 'inst-1', catalogId: 'rogue' }
    expect(updatePreviewInputSchema.safeParse(base).success).toBe(true)
    expect(updateInputSchema.safeParse({ ...base, changedPolicy: 'keep' }).success).toBe(true)
    expect(updateInputSchema.safeParse({ ...base, changedPolicy: 'overwrite' }).success).toBe(true)
    for (const catalogId of ['', '../x', 'a/b', 'a\\b', 'C:\\x', 'x'.repeat(129)]) {
      expect(updatePreviewInputSchema.safeParse({ ...base, catalogId }).success).toBe(false)
      expect(
        updateInputSchema.safeParse({ ...base, catalogId, changedPolicy: 'keep' }).success,
      ).toBe(false)
    }
    expect(updateInputSchema.safeParse({ ...base, changedPolicy: 'maybe' }).success).toBe(false)
    expect(updateInputSchema.safeParse(base).success).toBe(false)
    expect(updateInputSchema.safeParse({ ...base, changedPolicy: 'keep', path: '/' }).success).toBe(
      false,
    )
    expect(updatePreviewInputSchema.safeParse({ ...base, extra: 1 }).success).toBe(false)
  })
})

describe('ModsContract', () => {
  it('ModsContract req types are derived from MODS_HANDLER_SCHEMAS', () => {
    type Schemas = typeof MODS_HANDLER_SCHEMAS
    expectTypeOf<ModsContract['handlers']['list']['req']>().toEqualTypeOf<
      z.infer<Schemas['list']>
    >()
    expectTypeOf<ModsContract['handlers']['install']['req']>().toEqualTypeOf<
      z.infer<Schemas['install']>
    >()
    expectTypeOf<ModsContract['handlers']['catalog.get']['req']>().toEqualTypeOf<
      z.infer<Schemas['catalog.get']>
    >()
  })

  it('MODS_HANDLER_SCHEMAS has exactly one schema per MODS_HANDLERS value', () => {
    expect(Object.keys(MODS_HANDLER_SCHEMAS).sort()).toEqual(Object.values(MODS_HANDLERS).sort())
  })
})
