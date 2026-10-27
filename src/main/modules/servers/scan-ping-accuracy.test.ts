import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SERVERS_STATE, type ScanTarget } from '@shared/modules/servers'
import {
  buildInfoReplyBytes,
  buildStatusReplyBytes,
  formatInfoLine,
} from '@shared/servers/reply-fixtures'
import {
  bindResponder,
  buildProfiles,
  closeResponders,
  type Responder,
} from './scan-fixture-responders'
import { runScan } from './scan-runner'

/**
 * The ping a scan reports is the server's real round trip, even while the launcher is
 * busy, and sampling it costs next to nothing. Real `runScan`, real `queryServer`, real
 * `127.0.0.1` sockets, the shipped `DEFAULT_SERVERS_STATE.scan` settings, scanned together with
 * the same 30-responder population `scan-measurement.test.ts` uses.
 *
 * End-to-end accuracy is what this file proves. That the receive stamp is taken at arrival and not
 * when a reply is processed is proved by `server-query.test.ts` (fake socket that delays
 * processing): over real sockets the median of three samples hides a single late stamp.
 */

const POPULATION_SIZE = 30
const FIXED_DELAY_MS = 40
const TOLERANCE_MS = 5
const SCANS_UNDER_LOAD = 10
const ROW_LOAD_MS = 2
const SCANS_PER_ARM = 3
const MAX_SAMPLING_COST = 1.5

/**
 * The fixed-delay responder lives in a worker and spins on the clock for its delay: a `setTimeout`
 * delay drifts by the 15.6 ms Windows timer tick, and on the test's own event loop it would also
 * share the load it is meant to be measured against. Only the delay loop is written out here; the
 * reply bytes arrive pre-built.
 */
const FIXED_DELAY_WORKER = `
const { parentPort, workerData } = require('node:worker_threads')
const { createSocket } = require('node:dgram')
const { performance } = require('node:perf_hooks')
const { delayMs, infoBytes, statusBytes } = workerData
const socket = createSocket('udp4')
socket.on('error', () => {})
socket.on('message', (message, rinfo) => {
  const query = message.subarray(4).toString('latin1')
  const reply = query.startsWith('info') ? infoBytes : query.startsWith('status') ? statusBytes : null
  if (reply === null) return
  const until = performance.now() + delayMs
  while (performance.now() < until) {}
  socket.send(reply, rinfo.port, rinfo.address)
})
socket.bind(0, '127.0.0.1', () => parentPort.postMessage(socket.address().port))
`

async function startFixedDelayResponder(
  delayMs: number,
): Promise<{ worker: Worker; address: string }> {
  const worker = new Worker(FIXED_DELAY_WORKER, {
    eval: true,
    workerData: {
      delayMs,
      infoBytes: buildInfoReplyBytes(formatInfoLine('Fixed Delay Server', 'q2dm1', 2, 16)),
      statusBytes: buildStatusReplyBytes(
        '\\gamename\\baseq2\\hostname\\Fixed Delay Server\\mapname\\q2dm1\\clients\\2' +
          '\\maxclients\\16\\version\\3.20',
        ['0 20 "PlayerA"', '3 21 "PlayerB"'],
      ),
    },
  })
  const port = await new Promise<number>((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
  })
  return { worker, address: `127.0.0.1:${port}` }
}

function busyWait(ms: number): void {
  const until = performance.now() + ms
  while (performance.now() < until) {
    // spinning keeps the event loop blocked the way a busy renderer-feeding callback does
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]!
}

describe('scan ping accuracy', () => {
  let responders: Responder[]
  let populationTargets: ScanTarget[]
  let fixed: { worker: Worker; address: string }

  beforeAll(async () => {
    responders = await Promise.all(buildProfiles(POPULATION_SIZE).map(bindResponder))
    populationTargets = responders.map((responder) => ({ address: responder.address, origins: [] }))
    fixed = await startFixedDelayResponder(FIXED_DELAY_MS)
  })

  afterAll(async () => {
    await fixed?.worker.terminate()
    await closeResponders(responders ?? [])
  })

  it('a fixed-delay server reads within 5 ms of its delay over 10 scans under load', async () => {
    const targets: ScanTarget[] = [...populationTargets, { address: fixed.address, origins: [] }]
    const readings: number[] = []

    for (let scan = 0; scan < SCANS_UNDER_LOAD; scan++) {
      let reading: number | undefined
      const result = await runScan({
        targets,
        settings: DEFAULT_SERVERS_STATE.scan,
        onServer: (row) => {
          busyWait(ROW_LOAD_MS)
          if (row.stage === 'stage1' && row.target.address === fixed.address && row.result.ok) {
            reading = row.result.rttMs
          }
        },
      })
      expect(result.aborted).toBe(false)
      expect(reading).toBeDefined()
      readings.push(reading!)
    }

    expect(readings).toHaveLength(SCANS_UNDER_LOAD)
    for (const reading of readings) {
      expect(Math.abs(reading - FIXED_DELAY_MS)).toBeLessThanOrEqual(TOLERANCE_MS)
    }
  }, 120_000)

  it('sampling keeps a full scan within 1.5x of a single-sample scan', async () => {
    const fullPass = async (pingSamples?: number): Promise<number> => {
      const startedAt = performance.now()
      const result = await runScan({
        targets: populationTargets,
        settings: DEFAULT_SERVERS_STATE.scan,
        ...(pingSamples === undefined ? {} : { pingSamples }),
        onServer: () => {},
      })
      const elapsed = performance.now() - startedAt
      expect(result.aborted).toBe(false)
      expect(result.stage1Done).toBe(POPULATION_SIZE)
      return elapsed
    }

    const single: number[] = []
    const sampled: number[] = []
    for (let round = 0; round < SCANS_PER_ARM; round++) {
      single.push(await fullPass(1))
      sampled.push(await fullPass())
    }

    expect(median(sampled)).toBeLessThanOrEqual(MAX_SAMPLING_COST * median(single))
  }, 120_000)
})
