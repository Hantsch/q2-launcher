import { describe, expect, it } from 'vitest'
import { bootstrapSummaryInputSchema, startBootstrapInputSchema } from './schemas'

/**
 * Story 089 D1: covers the widened `BootstrapDataSource` (`'free-download' | 'store-copy' |
 * 'existing-folder'`, `@shared/modules/downloads`) at the schema layer - an unknown value is still
 * rejected, and `'existing-folder'` now requires `copySourcePath` the same way `'store-copy'`
 * already does (`refineCopySource`).
 */
describe('startBootstrapInputSchema', () => {
  const base = {
    engine: 'q2pro',
    targetPath: 'C:\\Games\\Quake II',
    includeVideoAndPlayers: false,
  }

  it('rejects an unknown dataSource value', () => {
    const result = startBootstrapInputSchema.safeParse({ ...base, dataSource: 'bogus' })
    expect(result.success).toBe(false)
  })

  it("rejects 'existing-folder' without a copySourcePath", () => {
    const result = startBootstrapInputSchema.safeParse({ ...base, dataSource: 'existing-folder' })
    expect(result.success).toBe(false)
  })

  it("accepts 'existing-folder' with a copySourcePath", () => {
    const result = startBootstrapInputSchema.safeParse({
      ...base,
      dataSource: 'existing-folder',
      copySourcePath: 'C:\\Games\\Retail Quake II',
    })
    expect(result.success).toBe(true)
  })
})

describe('bootstrapSummaryInputSchema', () => {
  const base = {
    engine: 'q2pro',
    targetPath: 'C:\\Games\\Quake II',
    includeVideoAndPlayers: false,
  }

  it('rejects an unknown dataSource value', () => {
    const result = bootstrapSummaryInputSchema.safeParse({ ...base, dataSource: 'bogus' })
    expect(result.success).toBe(false)
  })

  it("rejects 'existing-folder' without a copySourcePath", () => {
    const result = bootstrapSummaryInputSchema.safeParse({ ...base, dataSource: 'existing-folder' })
    expect(result.success).toBe(false)
  })
})
