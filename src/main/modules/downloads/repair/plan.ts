import type { RepairOffer, RepairOfferKind, RepairPlan } from '@shared/modules/downloads'
import type { EngineKind, ValidationCheck, ValidationResult } from '@shared/types'
import type { InspectOptions } from '../../../services/inspector'

/**
 * Story 093 D2: `buildRepairPlan`'s mapping from `inspectInstallation`'s verdict to the offers a
 * repair dialog (D3) can show. Message keys, not `ValidationCheck.id`, are the switch - several
 * different sentences share one `id` (`'base-paks'` covers `pak0Missing`, `pak0NotRetail`,
 * `retailPaksMissing` and `pointReleaseMissing` alike, see `main/services/inspector.ts`), and the
 * mapping cares about the sentence, not the check that produced it.
 */
const EXECUTABLE_MISSING_KEYS = new Set<string>([
  'validation.noExecutable',
  'validation.executableMissing',
])

/**
 * `validation.pak0NotRetail`, `validation.pak0Missing`, `validation.baseDirMissing` and
 * `validation.retailPaksMissing` all mean the same thing to a repair dialog: the base retail paks
 * are absent or wrong, and the fix is to copy them in from a verified retail source. The narrower
 * `validation.pointReleaseMissing` (pak0/pak1 present and retail, only pak2.pak missing) gets its
 * own, more specific offer below instead.
 */
const RETAIL_COPY_KEYS = new Set<string>([
  'validation.pak0NotRetail',
  'validation.pak0Missing',
  'validation.baseDirMissing',
  'validation.retailPaksMissing',
])

function offerKindFor(finding: ValidationCheck, canSupplyEngine: boolean): RepairOfferKind | undefined {
  if (EXECUTABLE_MISSING_KEYS.has(finding.messageKey)) {
    // Only offer to reinstall the engine when the manifest can actually supply this
    // installation's recorded engine - never promise a fix the job could not fulfil.
    return canSupplyEngine ? 'reinstall-engine' : undefined
  }
  if (finding.messageKey === 'validation.pointReleaseMissing') return 'install-point-release'
  if (RETAIL_COPY_KEYS.has(finding.messageKey)) return 'retail-copy'
  if (finding.messageKey === 'validation.notWritable') return 'set-write-dir'

  // `validation.engineUnknown` (files present but not recognised) and every other finding
  // (`validation.rootMissing`, `validation.pak0MissingButPaksPresent`, ...) offer nothing here -
  // overwriting binaries the launcher cannot identify would be wrong; `select-executable` stays
  // the right fix for that case, and it is out of this dialog's scope (see `RepairOfferKind`'s
  // doc comment in `@shared/modules/downloads`).
  return undefined
}

export interface BuildRepairPlanOptions {
  /** Whether the manifest can supply a build for this installation's *recorded* `engineKind` - the
   * sole gate on the `reinstall-engine` offer. */
  canSupplyEngine: boolean
}

/**
 * Story 093 D2: pure mapping from one `inspectInstallation` verdict to a `RepairPlan` - no
 * filesystem access, no I/O. `findings` always carries every check the inspection produced, even
 * when none of them map to an offer (AC6: "nothing repairable" still shows what is wrong).
 */
export function buildRepairPlan(
  installationId: string,
  result: Pick<ValidationResult, 'checks'>,
  options: BuildRepairPlanOptions,
): RepairPlan {
  const offers: RepairOffer[] = []

  for (const finding of result.checks) {
    const kind = offerKindFor(finding, options.canSupplyEngine)
    if (!kind) continue
    offers.push({
      kind,
      messageKey: finding.messageKey,
      ...(finding.params ? { params: finding.params } : {}),
    })
  }

  return { installationId, offers, findings: result.checks }
}

/**
 * Story 093 D2 (AC7): the fresh-inspect-then-map order `repair.plan`'s handler wraps. Never reads
 * `Installation.checks` or any other stored snapshot - `deps.inspect` is called on every single
 * invocation, exactly once, with whatever the installation record currently says its executable/
 * write-dir overrides are. `buildRepairPlan` itself stays pure; this is the only place in the
 * deliverable that performs I/O.
 */
export interface RepairPlanDeps {
  inspect(rootPath: string, options: InspectOptions): Promise<ValidationResult>
  /** Whether the manifest can supply a build for the given engine kind. */
  canSupplyEngine(engine: EngineKind): Promise<boolean>
}

export interface RepairPlanInstallation {
  id: string
  rootPath: string
  /**
   * The installation's *recorded* engine kind (`Installation.engineKind`), not whatever a fresh
   * inspection detects. A missing/unusable executable is exactly the case the fresh inspection
   * cannot identify an engine from - `r1q2`/`q2pro`'s only markers are their own executables, so
   * once the exe is gone `classifyEngine` reports `'unknown'` and gating on that would make
   * `reinstall-engine` unreachable for the very installations AC1 is about. The record is what the
   * launcher remembers the engine to be; that is what the manifest is asked to supply again.
   */
  engineKind: EngineKind
  /**
   * Story 093 finding fix (AC1): `Installation.recordedEngineKind` - a one-way memory of the engine,
   * set once when positively known and never overwritten by revalidation, unlike `engineKind` above
   * (which a fresh inspection *does* clobber to `'unknown'` the moment the executable goes missing,
   * outside the narrow `lastFailure`-scoped exception in `InstallationsService.applyInspection`).
   * Preferred over `engineKind` when present; falling back to `engineKind` keeps this working for
   * installations that predate the field or were never bootstrapped/imported through a path that
   * sets it.
   */
  recordedEngineKind?: EngineKind
  executablePath?: string
  writeDirPath?: string
}

export async function resolveRepairPlan(
  deps: RepairPlanDeps,
  installation: RepairPlanInstallation,
): Promise<RepairPlan> {
  const result = await deps.inspect(installation.rootPath, {
    ...(installation.executablePath ? { executablePath: installation.executablePath } : {}),
    ...(installation.writeDirPath ? { writeDirPath: installation.writeDirPath } : {}),
  })

  const canSupplyEngine = await deps.canSupplyEngine(
    installation.recordedEngineKind ?? installation.engineKind,
  )
  return buildRepairPlan(installation.id, result, { canSupplyEngine })
}
