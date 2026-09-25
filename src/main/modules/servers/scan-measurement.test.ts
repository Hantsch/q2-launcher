import { createSocket, type Socket } from 'node:dgram'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SERVERS_STATE, type ScanTarget } from '@shared/modules/servers'
import { buildInfoReplyBytes, buildStatusReplyBytes } from '@shared/servers/reply-fixtures'
import { runScan } from './scan-runner'

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
 * The model below mirrors the script's (seed, draw order, shares, buckets) line for line on purpose,
 * so this population is exactly the script's N=30 prefix; change one and the other must follow.
 * Every socket is bound on `127.0.0.1` (GB-A5).
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
const SEED = 0x115
const DEAD_SHARE = 0.15
const LOSSY_SHARE = 0.05
const NON_EMPTY_SHARE = 0.4
const DELAY_BUCKETS = [
  { share: 0.7, minMs: 5, maxMs: 30 },
  { share: 0.25, minMs: 30, maxMs: 150 },
  { share: 0.05, minMs: 150, maxMs: 400 },
] as const

interface Profile {
  index: number
  dead: boolean
  lossy: boolean
  clients: number
  delayMs: number
  hostname: string
}

interface Responder {
  profile: Profile
  socket: Socket
  address: string
  received: { info: number; status: number }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildProfiles(count: number): Profile[] {
  const rand = mulberry32(SEED)
  const profiles: Profile[] = []
  for (let i = 0; i < count; i++) {
    const deadU = rand()
    const lossyU = rand()
    const clientsU = rand()
    const bucketU = rand()
    const delayU = rand()
    const dead = deadU < DEAD_SHARE
    const lossy = !dead && lossyU < LOSSY_SHARE
    const clients = clientsU < NON_EMPTY_SHARE ? 1 + Math.floor((clientsU / NON_EMPTY_SHARE) * 7) : 0
    let acc = 0
    let bucket: (typeof DELAY_BUCKETS)[number] = DELAY_BUCKETS[DELAY_BUCKETS.length - 1]!
    for (const candidate of DELAY_BUCKETS) {
      acc += candidate.share
      if (bucketU < acc) {
        bucket = candidate
        break
      }
    }
    const delayMs = Math.round(bucket.minMs + delayU * (bucket.maxMs - bucket.minMs))
    profiles.push({ index: i, dead, lossy, clients, delayMs, hostname: `Measure Server ${i}` })
  }
  return profiles
}

function decodeQueryKind(message: Buffer): 'info' | 'status' | 'unknown' {
  const text = message.subarray(4).toString('latin1')
  if (text.startsWith('info')) return 'info'
  if (text.startsWith('status')) return 'status'
  return 'unknown'
}

async function bindResponder(profile: Profile): Promise<Responder> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const line =
    `\\gamename\\baseq2\\hostname\\${profile.hostname}\\mapname\\q2dm${(profile.index % 8) + 1}` +
    `\\clients\\${profile.clients}\\maxclients\\16\\version\\3.20`
  const playerLines = Array.from({ length: profile.clients }, (_, k) => `${k * 3} ${20 + k} "Player${k}"`)
  const infoBytes = buildInfoReplyBytes(line)
  const statusBytes = buildStatusReplyBytes(line, playerLines)
  const responder: Responder = {
    profile,
    socket,
    address: `127.0.0.1:${socket.address().port}`,
    received: { info: 0, status: 0 },
  }
  const dropped = { info: false, status: false }
  socket.on('error', () => {})
  socket.on('message', (message: Buffer, rinfo) => {
    const kind = decodeQueryKind(message)
    if (kind === 'unknown') return
    responder.received[kind] += 1
    if (profile.dead) return
    if (profile.lossy && !dropped[kind]) {
      dropped[kind] = true
      return
    }
    const bytes = kind === 'info' ? infoBytes : statusBytes
    setTimeout(() => socket.send(bytes, rinfo.port, rinfo.address), profile.delayMs)
  })
  return responder
}

describe('scan measurement budget (story 115 D6)', () => {
  let responders: Responder[]

  beforeAll(async () => {
    responders = await Promise.all(buildProfiles(POPULATION_SIZE).map(bindResponder))
  })

  afterAll(async () => {
    await Promise.all(
      responders.map((responder) => new Promise<void>((resolve) => responder.socket.close(() => resolve()))),
    )
  })

  it(
    "a full two-stage pass over the loopback population finishes inside the shipped defaults' budget",
    async () => {
      const settings = DEFAULT_SERVERS_STATE.scan
      const targets: ScanTarget[] = responders.map((responder) => ({ address: responder.address, origins: [] }))
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
    },
    30_000,
  )
})
