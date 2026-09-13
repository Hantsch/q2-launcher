import { describe, expect, it } from 'vitest'
import {
  bootstrapSummaryInputSchema,
  engineUpdateStatusInputSchema,
  setBleedingEdgeInputSchema,
  startBootstrapInputSchema,
  startEngineRollbackInputSchema,
  startEngineUpdateInputSchema,
} from './schemas'

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

/**
 * Story 092 D1: `engineUpdateStatus`/`engineUpdateStart`/`engineRollbackStart` all share
 * `engineInstallationInputSchema` - one required `installationId` string, `.strict()` against
 * extra keys.
 */
describe('engine installation-id schemas', () => {
  const schemas = {
    engineUpdateStatusInputSchema,
    startEngineUpdateInputSchema,
    startEngineRollbackInputSchema,
  }

  for (const [name, schema] of Object.entries(schemas)) {
    describe(name, () => {
      it('accepts a bare installation id', () => {
        expect(schema.safeParse({ installationId: 'inst-1' }).success).toBe(true)
      })

      it('rejects a non-string installationId', () => {
        expect(schema.safeParse({ installationId: 42 }).success).toBe(false)
      })

      it('rejects an empty installationId', () => {
        expect(schema.safeParse({ installationId: '' }).success).toBe(false)
      })

      it('rejects unknown extra keys', () => {
        expect(
          schema.safeParse({ installationId: 'inst-1', extra: 'nope' }).success,
        ).toBe(false)
      })

      it('rejects a missing installationId', () => {
        expect(schema.safeParse({}).success).toBe(false)
      })
    })
  }
})

/**
 * Story 092 D1: `engineSetBleedingEdge`'s payload adds `enabled: boolean` alongside
 * `installationId`, same `.strict()` convention as the schemas above.
 */
describe('setBleedingEdgeInputSchema', () => {
  it('accepts an installation id and enabled flag', () => {
    expect(
      setBleedingEdgeInputSchema.safeParse({ installationId: 'inst-1', enabled: true }).success,
    ).toBe(true)
  })

  it('rejects a non-string installationId', () => {
    expect(
      setBleedingEdgeInputSchema.safeParse({ installationId: 7, enabled: true }).success,
    ).toBe(false)
  })

  it('rejects a non-boolean enabled', () => {
    expect(
      setBleedingEdgeInputSchema.safeParse({ installationId: 'inst-1', enabled: 'yes' }).success,
    ).toBe(false)
  })

  it('rejects unknown extra keys', () => {
    expect(
      setBleedingEdgeInputSchema.safeParse({
        installationId: 'inst-1',
        enabled: true,
        extra: 'nope',
      }).success,
    ).toBe(false)
  })
})
