import { describe, expect, it } from 'vitest'
import { revealInputSchema } from './schemas'

describe('mods schemas', () => {
  it('reveal input rejects a gamedir with a path separator', () => {
    const base = { installationId: 'inst-1' }
    expect(revealInputSchema.safeParse({ ...base, gameDir: 'rogue' }).success).toBe(true)
    for (const gameDir of ['../x', 'a/b', 'a\\b', '', 'C:\\x']) {
      expect(revealInputSchema.safeParse({ ...base, gameDir }).success).toBe(false)
    }
  })
})
