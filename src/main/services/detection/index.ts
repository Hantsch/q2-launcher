import { randomUUID } from 'node:crypto'
import type {
  DetectedInstallation,
  DetectionPhase,
  DetectionProgress,
  DetectionResult,
  ScanOptions,
  ValidationResult,
} from '@shared/types'
import { canonicalizePath, pathKey } from '../../lib/fs-utils'
import { scopedLogger } from '../../lib/logger'
import { inspectInstallation, suggestName } from '../inspector'
import { deepScan, listDrives } from './deep-scan'
import { collectFastCandidates, type CandidatePath } from './providers'

const log = scopedLogger('detect')

export interface DetectionDeps {
  emitProgress: (progress: DetectionProgress) => void
  /** True when an installation with this path key is already registered. */
  isRegistered: (key: string) => boolean
}

/**
 * Finds Quake II installations on this machine.
 *
 * Two passes: a fast one that asks the stores where they put things and probes a
 * short list of classic paths, and an optional deep scan the user has to ask for.
 * Both funnel into `inspectInstallation`, so a candidate is only reported if it
 * would also pass validation when added.
 */
export class DetectionService {
  private readonly deps: DetectionDeps
  private readonly running = new Map<string, { cancelled: boolean }>()

  constructor(deps: DetectionDeps) {
    this.deps = deps
  }

  cancel(scanId: string): void {
    const token = this.running.get(scanId)
    if (token) {
      token.cancelled = true
      log.info(`scan ${scanId} cancelled`)
    }
  }

  listDrives(): Promise<string[]> {
    return listDrives()
  }

  async scan(options: ScanOptions = {}): Promise<DetectionResult> {
    const scanId = options.scanId ?? randomUUID()
    const token = { cancelled: false }
    this.running.set(scanId, token)

    const startedAt = Date.now()
    const candidates: DetectedInstallation[] = []
    const seen = new Set<string>()

    const emit = (phase: DetectionPhase, ratio: number | null, currentPath?: string): void => {
      this.deps.emitProgress({
        scanId,
        phase,
        candidatesFound: candidates.length,
        ratio,
        ...(currentPath ? { currentPath } : {}),
      })
    }

    /** Inspects a raw path and keeps it if it looks like a real installation. */
    const consider = async (candidate: CandidatePath): Promise<void> => {
      const canonical = await canonicalizePath(candidate.path)
      const key = pathKey(canonical)
      if (seen.has(key)) return
      seen.add(key)

      const result = await inspectInstallation(canonical)
      if (!qualifies(result)) return

      candidates.push({
        rootPath: canonical,
        suggestedName: suggestName(canonical),
        engineKind: result.engineKind,
        executables: result.executables,
        source: candidate.source,
        gameDirs: result.gameDirs,
        alreadyRegistered: this.deps.isRegistered(key),
        ...(result.detectedVersion ? { detectedVersion: result.detectedVersion } : {}),
      })
    }

    try {
      emit('starting', 0)

      // --- pass 1: stores + classic paths ---------------------------------
      emit('stores', null)
      const fast = await collectFastCandidates()
      if (token.cancelled) return this.finish(scanId, candidates, true, startedAt, emit)

      emit('common-paths', 0)
      for (const [index, candidate] of fast.entries()) {
        if (token.cancelled) return this.finish(scanId, candidates, true, startedAt, emit)
        await consider(candidate)
        emit('common-paths', (index + 1) / fast.length, candidate.path)
      }

      // --- pass 2: optional deep scan --------------------------------------
      if (options.deepScan && !token.cancelled) {
        const drives = options.drives?.length ? options.drives : await listDrives()
        emit('deep-scan', null)
        const deepCandidates = await deepScan({
          drives,
          isCancelled: () => token.cancelled,
          onProgress: ({ currentPath }) => emit('deep-scan', null, currentPath),
        })
        for (const candidate of deepCandidates) {
          if (token.cancelled) break
          await consider(candidate)
        }
      }

      return this.finish(scanId, candidates, token.cancelled, startedAt, emit)
    } finally {
      this.running.delete(scanId)
    }
  }

  private finish(
    scanId: string,
    candidates: DetectedInstallation[],
    cancelled: boolean,
    startedAt: number,
    emit: (phase: DetectionPhase, ratio: number | null) => void,
  ): DetectionResult {
    emit(cancelled ? 'cancelled' : 'done', 1)
    const durationMs = Date.now() - startedAt
    log.info(
      `scan ${scanId} ${cancelled ? 'cancelled' : 'finished'}: ${candidates.length} candidate(s) in ${durationMs}ms`,
    )
    return { scanId, candidates, cancelled, durationMs }
  }
}

/**
 * A candidate is worth showing if the folder still exists and either holds the
 * base game or a recognisable engine. This keeps store folders for unrelated
 * games (matched only by a fuzzy name) out of the results.
 */
function qualifies(result: ValidationResult): boolean {
  if (result.status === 'missing') return false
  const missingBaseDir = result.checks.some(
    (check) => check.id === 'base-game-dir' && check.severity === 'error',
  )
  return !missingBaseDir || result.engineKind !== 'unknown'
}

export { listDrives }
