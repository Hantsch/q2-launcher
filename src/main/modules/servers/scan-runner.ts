import type { ScanServerPush, ScanTarget, ServersScanSettings } from '@shared/modules/servers'
import { parseServerAddress } from '@shared/servers/address'
import {
  queryServer as defaultQueryServer,
  type QueryServerOptions,
  type ServerQueryResult,
  type ServerUdpTarget,
} from './server-query'

/**
 * Story 114 D5: the two-stage sweep. One call runs one scan from start to finish (or abort); it
 * knows nothing about "already running" - single-flight is the service's job (D6, D-L).
 *
 * - **Stage 1 (`info`)** runs a concurrency-capped pool over every target. Each pool slot awaits
 *   only *its own* query, and `onServer` fires in that slot's continuation, so a row is delivered
 *   the moment its reply lands - never after an `await` on the whole stage (AC1).
 * - **Stage 2 (`status`)** starts once stage 1 has fully settled and runs the same pool over
 *   exactly {every target stage 1 reported worth checking} plus the selected address (AC2,
 *   widened). The selected address is queried in stage 2 whatever stage 1 said about it (empty,
 *   failed, or not in the address set at all - then it is queried with `origins: []`), and it goes
 *   first, since it is the server the user is looking at. Anything else stage 1 did not report
 *   worth checking is never queried again in this scan.
 * - **Worth checking** means a successful `info` reply whose `clients` count is *not known to be
 *   zero* - i.e. `clients > 0`, or `clients` absent entirely. Only a reply that positively reports
 *   `clients === 0` skips stage 2 (AC2's original efficiency case: a well-formed reply that really
 *   is empty). A reply with no player count at all is not evidence of anything - some real servers
 *   (e.g. a very long `hostname` that eats the classic `info` reply's fixed-size summary buffer,
 *   leaving no room for the trailing `clients/maxclients` field) always fail to report a count -
 *   and treating "we could not tell" as "assume empty" would permanently hide such a server's name,
 *   map and roster, which only `status`'s uncapped infostring can recover.
 * - **Nothing twice per stage.** The target list is deduped by normalized address up front (D3
 *   already does this; the runner does not rely on it), with origins merged.
 *
 * Inputs: the caller passes the already-built `ScanTarget[]` (D3's `buildScanAddressSet`) and
 * `ServersState['scan']` directly as `settings` - concurrency/timeoutMs/retries are read from there
 * and nowhere else (D-F). `minSpacingMs` is accepted as part of that object but not used here; the
 * pacing budget is story 115's.
 *
 * Source failures do not flow through the runner: D4 has produced them before a sweep can even
 * start, so the service (D6) records them in the scan state itself. There is no `onSourceFailure`.
 *
 * Failures of one target never stop the sweep: `queryServer` resolves (it never rejects) and a
 * failed result is streamed like any other; a rejecting injected `queryServer` is treated as a
 * `transport-error` result for that one target (AC3 at the runner's level).
 *
 * **Abort.** One internal `AbortController`, linked to the caller's `signal`, is handed to every
 * query, so an abort closes every in-flight socket through `queryServer`'s own handling. After an
 * abort no slot starts a new query, stage 2 never starts, results still landing are dropped (an
 * aborted query's `no-reply` is not a server's silence and must not mark a row stale), and every
 * slot stops waiting for its query immediately - `runScan` resolves promptly even if a query is slow
 * to honour the abort. The same controller stops the sweep if `onServer`/`onProgress` throws; that
 * error is rethrown once every slot has stopped, so no callback ever fires after `runScan` settled.
 */

export type QueryServerFn = (
  target: ServerUdpTarget,
  options: QueryServerOptions,
) => Promise<ServerQueryResult>

export interface ScanRunnerDeps {
  /** Defaults to the real `queryServer` (one UDP socket per query, D-E). */
  queryServer?: QueryServerFn
}

export type ScanStage = 'stage1' | 'stage2'

/** One query's outcome, delivered through `onServer` the moment it lands. Review fix (story 114):
 * alias of the shared `ScanServerPush` (`@shared/modules/servers`) so the renderer can import the
 * real `scan.server` payload type instead of re-declaring a copy of it by hand. */
export type ScanServerResult = ScanServerPush

/**
 * The counters `ServersScanState` carries, emitted through `onProgress` at the start of each stage
 * (with that stage's total) and after every result (always *after* that result's `onServer`).
 * `stage2Total` is `0` until stage 2 starts.
 */
export interface ScanProgress {
  phase: ScanStage
  stage1Done: number
  stage1Total: number
  stage2Done: number
  stage2Total: number
}

export interface RunScanOptions {
  /** The address set for this scan (D3's `buildScanAddressSet`). */
  targets: readonly ScanTarget[]
  /** `ServersState['scan']` (D-F). */
  settings: Pick<ServersScanSettings, 'concurrency' | 'timeoutMs' | 'retries'>
  /** Stage 2's "currently selected server" (D-G). Ignored if it does not parse. */
  selectedAddress?: string
  signal?: AbortSignal
  deps?: ScanRunnerDeps
  onServer: (row: ScanServerResult) => void
  onProgress?: (progress: ScanProgress) => void
}

/** The final counters, plus whether the sweep was cut short by an abort. */
export interface RunScanResult extends ScanProgress {
  aborted: boolean
}

function normalizeAddress(address: string): string | null {
  const parsed = parseServerAddress(address)
  return parsed.ok ? parsed.normalized : null
}

/** Dedupes by normalized address, merging origins; an unparseable address keeps its raw form so it
 * still gets a (failed) row rather than vanishing silently. */
function dedupeTargets(targets: readonly ScanTarget[]): ScanTarget[] {
  const byAddress = new Map<string, ScanTarget>()
  for (const target of targets) {
    const key = normalizeAddress(target.address) ?? target.address
    const existing = byAddress.get(key)
    if (existing === undefined) {
      byAddress.set(key, { address: key, origins: [...target.origins] })
      continue
    }
    for (const origin of target.origins) {
      if (!existing.origins.includes(origin)) existing.origins.push(origin)
    }
  }
  return [...byAddress.values()]
}

/** Whether an `info` reply is worth a stage-2 `status` query - everything except a *known* zero
 * (see the file doc comment's "Worth checking" section). */
function isWorthStage2(result: ServerQueryResult): boolean {
  if (!result.ok || result.kind !== 'info') return false
  const { clients } = result.reply
  return typeof clients !== 'number' || clients > 0
}

/**
 * Runs `work` over `items` with at most `concurrency` in flight. Each slot pulls the next item only
 * after its own previous one finished, and stops pulling once `signal` is aborted.
 */
async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const slot = async (): Promise<void> => {
    while (next < items.length && !signal.aborted) {
      const item = items[next] as T
      next += 1
      await work(item)
    }
  }
  const slots = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: slots }, slot))
}

/** Runs one two-stage sweep. See the file doc comment for the ordering and abort guarantees. */
export async function runScan(options: RunScanOptions): Promise<RunScanResult> {
  const { settings, onServer, onProgress } = options
  const query = options.deps?.queryServer ?? defaultQueryServer
  const concurrency = Number.isFinite(settings.concurrency) ? Math.max(1, Math.floor(settings.concurrency)) : 1

  const stage1Targets = dedupeTargets(options.targets)
  const progress: ScanProgress = {
    phase: 'stage1',
    stage1Done: 0,
    stage1Total: stage1Targets.length,
    stage2Done: 0,
    stage2Total: 0,
  }

  const controller = new AbortController()
  const internal = controller.signal
  const external = options.signal
  const onExternalAbort = (): void => controller.abort()
  if (external?.aborted === true) return { ...progress, aborted: true }
  external?.addEventListener('abort', onExternalAbort, { once: true })

  // Resolves on abort, so a slot stops waiting for a query that is slow to honour the signal.
  const aborted = new Promise<null>((resolve) => {
    internal.addEventListener('abort', () => resolve(null), { once: true })
  })
  const callbackFailure: { thrown: boolean; error?: unknown } = { thrown: false }

  const report = (fn: () => void): void => {
    if (callbackFailure.thrown) return
    try {
      fn()
    } catch (error) {
      callbackFailure.thrown = true
      callbackFailure.error = error
      controller.abort()
    }
  }

  const queryOne = async (stage: ScanStage, target: ScanTarget): Promise<ServerQueryResult | null> => {
    const parsed = parseServerAddress(target.address)
    let result: ServerQueryResult
    if (!parsed.ok) {
      result = { ok: false, reason: 'transport-error' }
    } else {
      const pending = query(
        { host: parsed.host, port: parsed.port },
        {
          kind: stage === 'stage1' ? 'info' : 'status',
          timeoutMs: settings.timeoutMs,
          retries: settings.retries,
          signal: internal,
        },
      ).catch((): ServerQueryResult => ({ ok: false, reason: 'transport-error' }))
      const landed = await Promise.race([pending, aborted])
      if (landed === null) return null
      result = landed
    }
    if (internal.aborted) return null
    return result
  }

  try {
    // Stage 1: info over the whole address set.
    report(() => onProgress?.({ ...progress }))
    const worthStage2 = new Set<string>()
    await runPool(stage1Targets, concurrency, internal, async (target) => {
      const result = await queryOne('stage1', target)
      if (result === null) return
      if (isWorthStage2(result)) worthStage2.add(target.address)
      progress.stage1Done += 1
      report(() => onServer({ stage: 'stage1', target, result }))
      report(() => onProgress?.({ ...progress }))
    })

    // Stage 2: status over exactly {selected} + {worth checking}, selected first.
    if (!internal.aborted) {
      const stage2Targets: ScanTarget[] = []
      const selected = options.selectedAddress === undefined ? null : normalizeAddress(options.selectedAddress)
      if (selected !== null) {
        const known = stage1Targets.find((target) => target.address === selected)
        stage2Targets.push(known ?? { address: selected, origins: [] })
      }
      for (const target of stage1Targets) {
        if (worthStage2.has(target.address) && target.address !== selected) stage2Targets.push(target)
      }

      progress.phase = 'stage2'
      progress.stage2Total = stage2Targets.length
      report(() => onProgress?.({ ...progress }))
      await runPool(stage2Targets, concurrency, internal, async (target) => {
        const result = await queryOne('stage2', target)
        if (result === null) return
        progress.stage2Done += 1
        report(() => onServer({ stage: 'stage2', target, result }))
        report(() => onProgress?.({ ...progress }))
      })
    }
  } finally {
    external?.removeEventListener('abort', onExternalAbort)
  }

  if (callbackFailure.thrown) throw callbackFailure.error
  return { ...progress, aborted: internal.aborted }
}
