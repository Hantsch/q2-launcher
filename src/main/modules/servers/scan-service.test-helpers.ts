import { DEFAULT_SERVERS_STATE, type ServersState } from '@shared/modules/servers'
import { IDLE_LAUNCH_STATE, type LaunchState } from '@shared/types'
import type { LaunchHost } from '../../services/write-guard'
import type { QueryServerFn } from './scan-runner'
import type { ServerQueryResult } from './server-query'
import { type ScanService } from './scan-service'

/**
 * Story 114. The service is the one thing in this story that is genuinely stateful, so these
 * tests drive it through its public surface only (`start`/`read`/`overview`/`dispose`) with a fake
 * `queryServer` - never a real socket, never a real `fetch` - and assert on the emitted event
 * sequence and on `read()`/`overview()` snapshots, the same way `scan-runner.test.ts` asserts on
 * `runScan`'s own callbacks.
 *
 * Every state fixture below disables/empties `sources` so `resolveSources` never has an enabled
 * source to resolve (no `fetchImpl`/`udpImpl` fake needed at all) - the address set comes entirely
 * from `favourites`/`manualServers`, which is all `buildScanAddressSet` needs to produce targets.
 */

export type RecordedEvent = { type: string; payload: unknown }

/** Story 116: a controllable `LaunchHost`, mirroring `write-guard.test.ts`'s `fakeLaunch` -
 * `set()` updates `getState()` first and then notifies, the same order `LaunchService.setState` uses. */
export function fakeLaunch(initial: LaunchState = IDLE_LAUNCH_STATE): {
  host: LaunchHost
  set: (next: LaunchState) => void
  listenerCount: () => number
} {
  let current = initial
  const listeners = new Set<(next: LaunchState) => void>()
  const host: LaunchHost = {
    getState: () => current,
    onStateChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    host,
    set: (next) => {
      current = next
      for (const listener of [...listeners]) listener(next)
    },
    listenerCount: () => listeners.size,
  }
}

export const RUNNING: LaunchState = { phase: 'running', installationId: 'inst-1' }

export function recorder(): {
  emit: (type: string, payload: unknown) => void
  events: RecordedEvent[]
} {
  const events: RecordedEvent[] = []
  return { emit: (type, payload) => events.push({ type, payload }), events }
}

export function baseState(overrides: Partial<ServersState> = {}): ServersState {
  return {
    ...DEFAULT_SERVERS_STATE,
    sources: [],
    favourites: [],
    manualServers: [],
    history: [],
    ...overrides,
  }
}

export function manualEntry(address: string): ServersState['manualServers'][number] {
  return { address, origin: 'manual', addedAt: new Date().toISOString() }
}

/** A well-formed `info` reply reporting zero clients, so `runScan` never queues a stage 2 query for
 * it (a *known* empty reply, per `scan-runner.ts`'s `isWorthStage2`) - keeps every test below to a
 * single stage1-only row per target. */
export function infoOk(hostname = 'Host'): ServerQueryResult {
  return {
    ok: true,
    kind: 'info',
    reply: { ok: true, serverinfo: { hostname }, clients: 0 },
    rttMs: 7,
  }
}

export const noReply: ServerQueryResult = { ok: false, reason: 'no-reply' }

/** A `queryServer` fake whose replies are deferred promises resolved by hand - lets a test pause a
 * scan mid-flight (D-D) or leave it running forever (D-L) without any real timers. */
export function deferredQuery(): {
  fn: QueryServerFn
  calls: { address: string; resolve: (result: ServerQueryResult) => void }[]
} {
  const calls: { address: string; resolve: (result: ServerQueryResult) => void }[] = []
  const fn: QueryServerFn = (target) =>
    new Promise((resolve) => {
      calls.push({ address: `${target.host}:${target.port}`, resolve })
    })
  return { fn, calls }
}

export const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Polls `service.read().state.running` a few ticks at a time - the fixtures here never touch a
 * real timer, so a handful of microtask/macrotask flushes is always enough once every deferred
 * query has been resolved. */
export async function waitForIdle(service: ScanService, maxTicks = 20): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (!service.read().state.running) return
    await tick()
  }
  throw new Error('scan did not settle in time')
}
