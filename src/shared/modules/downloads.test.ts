import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import { DEFAULT_SETTINGS, type LauncherSettings } from '../types'
import {
  ARCHIVE_CACHE_BUDGET_CHOICES_GB,
  DEFAULT_DOWNLOADS_SETTINGS,
  DOWNLOADS_HANDLERS,
  DOWNLOADS_HANDLER_SCHEMAS,
  type DownloadsContract,
  bootstrapSummaryInputSchema,
  engineUpdateStatusInputSchema,
  setBleedingEdgeInputSchema,
  startBootstrapInputSchema,
  startEngineRollbackInputSchema,
  startEngineUpdateInputSchema,
} from './downloads'

describe('downloads module contract (story 072 D2)', () => {
  it('DEFAULT_DOWNLOADS_SETTINGS carries the documented defaults', () => {
    expect(DEFAULT_DOWNLOADS_SETTINGS).toEqual({
      concurrentJobs: 2,
      archiveCacheBudgetGB: 5,
      downloadWhilePlayingAllowed: true,
    })
  })

  it('lists exactly the allowed archive-cache budget choices, in GB', () => {
    expect(ARCHIVE_CACHE_BUDGET_CHOICES_GB).toEqual([1, 2, 5, 10, 20])
  })

  it('downloads settings live outside LauncherSettings', () => {
    // The downloads module's settings are their own top-level `state.json` key
    // (`downloads`, `main/services/state.ts`), never merged into the shell's own
    // `LauncherSettings` shape - a module contributing settings must not be able to widen the
    // shell's closed settings type.
    const downloadsKeys = Object.keys(DEFAULT_DOWNLOADS_SETTINGS)
    const launcherSettingsKeys: (keyof LauncherSettings)[] = Object.keys(
      DEFAULT_SETTINGS,
    ) as (keyof LauncherSettings)[]

    for (const key of downloadsKeys) {
      expect(launcherSettingsKeys).not.toContain(key)
    }
  })
})

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
        expect(schema.safeParse({ installationId: 'inst-1', extra: 'nope' }).success).toBe(false)
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
    expect(setBleedingEdgeInputSchema.safeParse({ installationId: 7, enabled: true }).success).toBe(
      false,
    )
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

describe('downloads contract', () => {
  it('DownloadsContract req types are derived from DOWNLOADS_HANDLER_SCHEMAS', () => {
    type Handlers = DownloadsContract['handlers']
    expectTypeOf<Handlers['downloads.getSettings']['req']>().toEqualTypeOf<void>()
    expectTypeOf<Handlers['downloads.dismissFailure']['req']>().toEqualTypeOf<{ id: string }>()
    expectTypeOf<Handlers['engine.setBleedingEdge']['req']>().toEqualTypeOf<
      z.infer<(typeof DOWNLOADS_HANDLER_SCHEMAS)['engine.setBleedingEdge']>
    >()
    expectTypeOf<Handlers['repair.start']['req']['installationId']>().toEqualTypeOf<string>()
  })

  it('DOWNLOADS_HANDLER_SCHEMAS has exactly one schema per DOWNLOADS_HANDLERS value', () => {
    expect(Object.keys(DOWNLOADS_HANDLER_SCHEMAS).sort()).toEqual(
      Object.values(DOWNLOADS_HANDLERS).sort(),
    )
  })
})
