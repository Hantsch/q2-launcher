import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SERVERS_STATE, type ScanTarget } from '@shared/modules/servers'
import { runScan } from './scan-runner'
import {
  bindResponder,
  buildProfiles,
  closeResponders,
  type Responder,
} from './scan-fixture-responders'

/**
 * Story 115 D6 / AC2: the shipped scan defaults stay inside the budget they were measured against.
 *
 * `npm run measure:scan` (`scripts/measure/scan-pass.mjs`) measured story 114's real two-stage
 * scheduler over 100/200/300 loopback responders and story 115's `## Measurement (AC2)` records the
 * result; `DEFAULT_SERVERS_STATE.scan` was set from one row of that table. This test re-runs a
 * scaled-down population - the first 30 responders of the script's own seeded draw, same model:
 * 15% dead, 5% of the live ones dropping the first datagram of each query kind, 40% of the live ones
 * non-empty, a 5-30/30-150/150-400 ms delay mixture - through the real `runScan` and its real
 * `queryServer` over real `127.0.0.1` sockets, under whatever `DEFAULT_SERVERS_STATE.scan` currently
 * says, and asserts the full pass lands inside the recorded budget.
 *
 * The model (`scan-fixture-responders.ts`) mirrors the script's (seed, draw order, shares, buckets)
 * line for line on purpose, so this population is exactly the script's N=30 prefix; change one and
 * the other must follow. Every socket is bound on `127.0.0.1` (GB-A5).
 */

/**
 * The recorded budget: story 115 `## Measurement (AC2)`, the shipped row's (N=300, concurrency 24,
 * timeoutMs 1000, retries 1) full-pass median - a population a tenth that size must finish inside
 * what the full 300 needed. The 30-server pass itself is bounded below by one dead server's
 * `timeoutMs * (retries + 1)` in stage 1 plus one lossy server's retry wait in stage 2 (~3 s), so
 * this leaves roughly 2.5x headroom for a slow CI box; a scheduler that stopped running queries in
 * parallel would blow straight through it.
 */
const RECORDED_FULL_PASS_BUDGET_MS = 7527

const POPULATION_SIZE = 30

describe('scan measurement budget (story 115 D6)', () => {
  let responders: Responder[]

  beforeAll(async () => {
    responders = await Promise.all(buildProfiles(POPULATION_SIZE).map(bindResponder))
  })

  afterAll(async () => {
    await closeResponders(responders)
  })

  it("a full two-stage pass over the loopback population finishes inside the shipped defaults' budget", async () => {
    const settings = DEFAULT_SERVERS_STATE.scan
    const targets: ScanTarget[] = responders.map((responder) => ({
      address: responder.address,
      origins: [],
    }))
    let stage1Ok = 0
    let stage2Ok = 0

    const startedAt = performance.now()
    const result = await runScan({
      targets,
      settings,
      onServer: (row) => {
        if (!row.result.ok) return
        if (row.stage === 'stage1') stage1Ok += 1
        else stage2Ok += 1
      },
    })
    const fullPassMs = performance.now() - startedAt

    // It really was a two-stage pass over the wire, not something cheaper that happens to be fast.
    const answering = responders.filter(
      ({ profile }) => !profile.dead && (!profile.lossy || settings.retries >= 1),
    )
    const nonEmpty = answering.filter(({ profile }) => profile.clients > 0)
    expect(result.aborted).toBe(false)
    expect(result.stage1Done).toBe(POPULATION_SIZE)
    expect(stage1Ok).toBe(answering.length)
    expect(result.stage2Total).toBe(nonEmpty.length)
    expect(stage2Ok).toBe(nonEmpty.length)
    for (const responder of responders) {
      expect(responder.received.info).toBeGreaterThanOrEqual(1)
      expect(responder.received.status > 0).toBe(nonEmpty.includes(responder))
    }

    expect(RECORDED_FULL_PASS_BUDGET_MS).toBeGreaterThan(0)
    expect(fullPassMs).toBeLessThan(RECORDED_FULL_PASS_BUDGET_MS)
  }, 30_000)
})
