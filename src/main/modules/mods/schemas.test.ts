import { describe, expect, it } from 'vitest'
import { removalPreviewInputSchema, removeInputSchema, revealInputSchema } from './schemas'

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
      expect(removeInputSchema.safeParse({ ...base, modId, changedFiles: 'delete' }).success).toBe(false)
    }
    expect(removeInputSchema.safeParse({ ...base, changedFiles: 'maybe' }).success).toBe(false)
    expect(removeInputSchema.safeParse(base).success).toBe(false)
    expect(removalPreviewInputSchema.safeParse({ ...base, extra: 1 }).success).toBe(false)
  })
})
