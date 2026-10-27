import { createSocket, type Socket } from 'node:dgram'
import {
  buildInfoReplyBytes,
  buildStatusReplyBytes,
  formatInfoLine,
} from '@shared/servers/reply-fixtures'

/**
 * Loopback responder population shared by the scan timing tests: the seeded draw `npm run
 * measure:scan` (`scripts/measure/scan-pass.mjs`) uses - 15% dead, 5% of the live ones dropping
 * the first datagram of each query kind, 40% of the live ones non-empty, a 5-30/30-150/150-400 ms
 * delay mixture. The model mirrors the script's (seed, draw order, shares, buckets) line for line
 * on purpose; change one and the other must follow. Every socket is bound on `127.0.0.1`.
 */

const SEED = 0x115
const DEAD_SHARE = 0.15
const LOSSY_SHARE = 0.05
const NON_EMPTY_SHARE = 0.4
const DELAY_BUCKETS = [
  { share: 0.7, minMs: 5, maxMs: 30 },
  { share: 0.25, minMs: 30, maxMs: 150 },
  { share: 0.05, minMs: 150, maxMs: 400 },
] as const

export interface Profile {
  index: number
  dead: boolean
  lossy: boolean
  clients: number
  delayMs: number
  hostname: string
}

export interface Responder {
  profile: Profile
  socket: Socket
  address: string
  received: { info: number; status: number }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildProfiles(count: number): Profile[] {
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
    const clients =
      clientsU < NON_EMPTY_SHARE ? 1 + Math.floor((clientsU / NON_EMPTY_SHARE) * 7) : 0
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

export function decodeQueryKind(message: Buffer): 'info' | 'status' | 'unknown' {
  const text = message.subarray(4).toString('latin1')
  if (text.startsWith('info')) return 'info'
  if (text.startsWith('status')) return 'status'
  return 'unknown'
}

export async function bindResponder(profile: Profile): Promise<Responder> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const line =
    `\\gamename\\baseq2\\hostname\\${profile.hostname}\\mapname\\q2dm${(profile.index % 8) + 1}` +
    `\\clients\\${profile.clients}\\maxclients\\16\\version\\3.20`
  const playerLines = Array.from(
    { length: profile.clients },
    (_, k) => `${k * 3} ${20 + k} "Player${k}"`,
  )
  const infoBytes = buildInfoReplyBytes(
    formatInfoLine(profile.hostname, `q2dm${(profile.index % 8) + 1}`, profile.clients, 16),
  )
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

export async function closeResponders(responders: readonly Responder[]): Promise<void> {
  await Promise.all(
    responders.map(
      (responder) => new Promise<void>((resolve) => responder.socket.close(() => resolve())),
    ),
  )
}
