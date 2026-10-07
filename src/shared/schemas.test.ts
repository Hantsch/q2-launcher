import { describe, expect, it } from 'vitest'
import { absolutePathSchema } from './schemas'

describe('absolutePathSchema', () => {
  it('absolutePathSchema accepts drive, UNC and posix absolute paths', () => {
    for (const p of ['C:\\x', 'c:/x', '\\\\server\\share\\x', '/home/x']) {
      expect(absolutePathSchema.safeParse(p).success, p).toBe(true)
    }
  })

  it('absolutePathSchema rejects relative, drive-relative, empty and NUL paths', () => {
    for (const p of ['', 'relative\\x', './x', '..\\x', 'C:x', 'C:', '/home/\0x']) {
      expect(absolutePathSchema.safeParse(p).success, JSON.stringify(p)).toBe(false)
    }
  })
})
