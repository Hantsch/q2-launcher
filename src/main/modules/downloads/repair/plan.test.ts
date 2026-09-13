import { describe, expect, it, vi } from 'vitest'
import type { ValidationCheck, ValidationResult } from '@shared/types'
import { buildRepairPlan, resolveRepairPlan } from './plan'

/**
 * Story 093 D2: `buildRepairPlan` - pure mapping from a fresh `inspectInstallation` verdict to a
 * `RepairPlan`, and `resolveRepairPlan` - the thin orchestrator `repair.plan`'s handler wraps,
 * proven here to always re-inspect rather than trust a caller-supplied snapshot (AC7). Mirrors
 * `engine/update-status.test.ts`'s style: no filesystem, only pure/fake I/O.
 */

function check(messageKey: string, extra: Partial<ValidationCheck> = {}): ValidationCheck {
  return { id: 'base-paks', severity: 'warn', messageKey, ...extra }
}

function resultOf(checks: ValidationCheck[]): Pick<ValidationResult, 'checks'> {
  return { checks }
}

describe('buildRepairPlan', () => {
  it('offers reinstall-engine for a missing executable when the manifest can supply the recorded engine', () => {
    const plan = buildRepairPlan('inst-1', resultOf([check('validation.noExecutable')]), {
      canSupplyEngine: true,
    })

    expect(plan.offers).toEqual([{ kind: 'reinstall-engine', messageKey: 'validation.noExecutable' }])
    expect(plan.findings).toHaveLength(1)
  })

  it('offers nothing for a missing executable when the manifest cannot supply the recorded engine', () => {
    const plan = buildRepairPlan('inst-1', resultOf([check('validation.executableMissing')]), {
      canSupplyEngine: false,
    })

    expect(plan.offers).toEqual([])
    expect(plan.findings).toHaveLength(1)
  })

  it('offers install-point-release for pointReleaseMissing', () => {
    const plan = buildRepairPlan('inst-1', resultOf([check('validation.pointReleaseMissing')]), {
      canSupplyEngine: false,
    })

    expect(plan.offers).toEqual([
      { kind: 'install-point-release', messageKey: 'validation.pointReleaseMissing' },
    ])
  })

  it('offers retail-copy for pak0NotRetail alone', () => {
    const plan = buildRepairPlan('inst-1', resultOf([check('validation.pak0NotRetail')]), {
      canSupplyEngine: false,
    })

    expect(plan.offers).toEqual([{ kind: 'retail-copy', messageKey: 'validation.pak0NotRetail' }])
  })

  it('offers retail-copy for both pak0Missing and retailPaksMissing', () => {
    const plan = buildRepairPlan(
      'inst-1',
      resultOf([check('validation.pak0Missing'), check('validation.retailPaksMissing')]),
      { canSupplyEngine: false },
    )

    expect(plan.offers).toEqual([
      { kind: 'retail-copy', messageKey: 'validation.pak0Missing' },
      { kind: 'retail-copy', messageKey: 'validation.retailPaksMissing' },
    ])
  })

  it('offers set-write-dir for notWritable', () => {
    const plan = buildRepairPlan(
      'inst-1',
      resultOf([check('validation.notWritable', { params: { path: 'C:\\Games\\Q2' } })]),
      { canSupplyEngine: false },
    )

    expect(plan.offers).toEqual([
      {
        kind: 'set-write-dir',
        messageKey: 'validation.notWritable',
        params: { path: 'C:\\Games\\Q2' },
      },
    ])
  })

  it('offers nothing for engineUnknown alone', () => {
    const plan = buildRepairPlan(
      'inst-1',
      resultOf([check('validation.engineUnknown', { id: 'engine-identified', severity: 'warn' })]),
      { canSupplyEngine: true },
    )

    expect(plan.offers).toEqual([])
  })

  it('returns an empty offer list while still carrying the findings when nothing is repairable', () => {
    const findings = [check('validation.engineUnknown'), check('validation.pak0MissingButPaksPresent')]
    const plan = buildRepairPlan('inst-1', resultOf(findings), { canSupplyEngine: true })

    expect(plan.offers).toEqual([])
    expect(plan.findings).toEqual(findings)
  })
})

describe('resolveRepairPlan', () => {
  it('always re-inspects rather than reading a stored/cached checks snapshot', async () => {
    // The installation's own "stored" checks say everything is fine - if the handler ever reads
    // this instead of calling `deps.inspect`, the resulting plan would offer nothing. A fresh
    // inspection disagrees (a missing executable), and that is what must win.
    const staleChecks: ValidationCheck[] = []
    const freshResult: ValidationResult = {
      status: 'invalid',
      checks: [check('validation.noExecutable', { id: 'executable', severity: 'error' })],
      gameDirs: [],
      executables: [],
      engineKind: 'q2pro',
      checkedAt: new Date().toISOString(),
    }

    const inspect = vi.fn().mockResolvedValue(freshResult)
    const canSupplyEngine = vi.fn().mockResolvedValue(true)

    const installation = {
      id: 'inst-1',
      rootPath: 'C:\\Games\\Q2',
      engineKind: 'q2pro' as const,
      // A stale, would-be "stored" verdict - deliberately not passed to `resolveRepairPlan` at
      // all, since the type it accepts carries no `checks` field: there is nothing for the
      // implementation to read even by accident.
      checks: staleChecks,
    }

    const plan = await resolveRepairPlan({ inspect, canSupplyEngine }, installation)

    expect(inspect).toHaveBeenCalledTimes(1)
    expect(inspect).toHaveBeenCalledWith('C:\\Games\\Q2', {})
    expect(canSupplyEngine).toHaveBeenCalledWith('q2pro')
    expect(plan.offers).toEqual([{ kind: 'reinstall-engine', messageKey: 'validation.noExecutable' }])
    expect(plan.findings).toEqual(freshResult.checks)
  })

  it('gates reinstall-engine on the recorded engine kind, not a fresh inspection that can no longer identify one', async () => {
    // r1q2/q2pro have no marker other than their own executable (see `inspector.ts`'s
    // `classifyEngine`): once that executable is truly gone, a fresh inspection reports
    // `engineKind: 'unknown'`. Gating `canSupplyEngine` on that fresh value would make
    // `reinstall-engine` unreachable for exactly the installations AC1 is about - so the gate
    // must ask about `installation.engineKind`, the record, instead.
    const freshResult: ValidationResult = {
      status: 'invalid',
      checks: [check('validation.noExecutable', { id: 'executable', severity: 'error' })],
      gameDirs: [],
      executables: [],
      engineKind: 'unknown',
      checkedAt: new Date().toISOString(),
    }
    const inspect = vi.fn().mockResolvedValue(freshResult)
    const canSupplyEngine = vi.fn().mockResolvedValue(true)

    const plan = await resolveRepairPlan(
      { inspect, canSupplyEngine },
      { id: 'inst-3', rootPath: 'C:\\Games\\Q2', engineKind: 'r1q2' },
    )

    expect(canSupplyEngine).toHaveBeenCalledWith('r1q2')
    expect(plan.offers).toEqual([{ kind: 'reinstall-engine', messageKey: 'validation.noExecutable' }])
  })

  it('offers reinstall-engine from recordedEngineKind when a fresh inspection can no longer identify the engine at all', async () => {
    // Story 093 finding fix (AC1): unlike the previous test, the fresh inspection here reports
    // `engineKind: 'unknown'` *and* the installation's own (live) `engineKind` field has already
    // been overwritten to `'unknown'` by a prior `validate()` - exactly what happens after the
    // executable disappears and the app restarts (`InstallationsService.applyInspection`). Only
    // `recordedEngineKind`, the one-way memory, still says what this installation actually is.
    const freshResult: ValidationResult = {
      status: 'invalid',
      checks: [check('validation.noExecutable', { id: 'executable', severity: 'error' })],
      gameDirs: [],
      executables: [],
      engineKind: 'unknown',
      checkedAt: new Date().toISOString(),
    }
    const inspect = vi.fn().mockResolvedValue(freshResult)
    const canSupplyEngine = vi.fn().mockResolvedValue(true)

    const plan = await resolveRepairPlan(
      { inspect, canSupplyEngine },
      { id: 'inst-4', rootPath: 'C:\\Games\\Q2', engineKind: 'unknown', recordedEngineKind: 'q2pro' },
    )

    expect(canSupplyEngine).toHaveBeenCalledWith('q2pro')
    expect(plan.offers).toEqual([{ kind: 'reinstall-engine', messageKey: 'validation.noExecutable' }])
  })

  it('passes the installation executable/write-dir overrides through to inspect', async () => {
    const freshResult: ValidationResult = {
      status: 'ok',
      checks: [],
      gameDirs: [],
      executables: [],
      engineKind: 'r1q2',
      checkedAt: new Date().toISOString(),
    }
    const inspect = vi.fn().mockResolvedValue(freshResult)
    const canSupplyEngine = vi.fn().mockResolvedValue(false)

    await resolveRepairPlan(
      { inspect, canSupplyEngine },
      {
        id: 'inst-2',
        rootPath: 'C:\\Games\\Q2',
        engineKind: 'r1q2',
        executablePath: 'C:\\Games\\Q2\\r1q2.exe',
        writeDirPath: 'C:\\Games\\Q2-write',
      },
    )

    expect(inspect).toHaveBeenCalledWith('C:\\Games\\Q2', {
      executablePath: 'C:\\Games\\Q2\\r1q2.exe',
      writeDirPath: 'C:\\Games\\Q2-write',
    })
  })
})
