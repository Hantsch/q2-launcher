import { createSocket, type Socket } from 'node:dgram'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_MASTER_SOURCES,
  SERVERS_EVENTS,
  SERVERS_HANDLERS,
  type ScanSnapshot,
  type ServersScanState,
  type ServersState,
} from '@shared/modules/servers'
import { buildInfoReplyBytes, buildStatusReplyBytes } from '@shared/servers/reply-fixtures'
import type { AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { MainModuleRegistry } from '../registry'
import { serversModule } from './index'
import type { ScanServerResult } from './scan-runner'

/**
 * Story 114 D8: the real-socket integration proof. D1-D7 (address-set merge, `queryServer`,
 * `resolveSources`, `runScan`, `ScanService`, the `scan.*` handlers) are all unit-tested against
 * stub seams or fake timers; nothing yet has driven the whole stack - real UDP loopback sockets,
 * the real module handlers, a real `StateStore` - end to end. There is no renderer view for this
 * story yet, so this file is the acceptance evidence D-M/D-N call for in place of an e2e test.
 *
 * Three throwaway `node:dgram` responders on `127.0.0.1` stand in for three kinds of real server:
 * one populated (answers `info` and `status`), one empty (answers `info` with `clients\0`, and
 * must never see a `status` query), and one that never answers at all (proves a dead target
 * doesn't hang or break the sweep). Every configured master/list source is disabled, so the whole
 * address set comes from favourites + manual servers - and one address is deliberately listed as
 * both, to prove the union is deduped rather than swept twice.
 */

const POPULATED_HOSTNAME = 'Populated Server'
const POPULATED_INFO_LINE =
  `\\gamename\\baseq2\\hostname\\${POPULATED_HOSTNAME}\\mapname\\q2dm1\\clients\\3\\maxclients\\8\\version\\3.20`
const POPULATED_PLAYER_LINES = ['3 25 "PlayerOne"', '0 -1 "PlayerTwo"']

const EMPTY_HOSTNAME = 'Empty Server'
const EMPTY_INFO_LINE =
  `\\gamename\\baseq2\\hostname\\${EMPTY_HOSTNAME}\\mapname\\q2dm2\\clients\\0\\maxclients\\8\\version\\3.20`

/** Small scan budget: fast enough for a test, but the dead target still gets a real timeout +
 * one real retry (2 sends, ~2 * `timeoutMs`) rather than being faked away. */
const SCAN_SETTINGS = { concurrency: 4, timeoutMs: 300, retries: 1, minSpacingMs: 0 }

/** Classifies an inbound query datagram as `info`/`status`/other, the same way a real server's
 * wire parser would - by the ASCII command token right after the 4-byte OOB prefix. */
function decodeQueryKind(message: Buffer): 'info' | 'status' | 'unknown' {
  const text = message.subarray(4).toString('latin1')
  if (text.startsWith('info')) return 'info'
  if (text.startsWith('status')) return 'status'
  return 'unknown'
}

async function bindResponder(): Promise<{ socket: Socket; port: number }> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const address = socket.address()
  return { socket, port: address.port }
}

describe('servers scan real-socket integration (story 114 D8)', () => {
  let filePath: string
  let state: StateStore
  let registry: MainModuleRegistry
  let emitted: Array<{ type: string; payload: unknown }>

  let populated: { socket: Socket; port: number }
  let empty: { socket: Socket; port: number }
  let dead: { socket: Socket; port: number }
  let emptyReceivedKinds: string[]
  let populatedReceivedKinds: string[]
  let deadReceivedCount: number

  let populatedAddress: string
  let emptyAddress: string
  let deadAddress: string

  beforeEach(async () => {
    populated = await bindResponder()
    empty = await bindResponder()
    dead = await bindResponder()

    populatedReceivedKinds = []
    emptyReceivedKinds = []
    deadReceivedCount = 0

    populated.socket.on('message', (message: Buffer, rinfo) => {
      const kind = decodeQueryKind(message)
      populatedReceivedKinds.push(kind)
      if (kind === 'info') {
        populated.socket.send(buildInfoReplyBytes(POPULATED_INFO_LINE), rinfo.port, rinfo.address)
      } else if (kind === 'status') {
        populated.socket.send(
          buildStatusReplyBytes(POPULATED_INFO_LINE, POPULATED_PLAYER_LINES),
          rinfo.port,
          rinfo.address,
        )
      }
    })

    empty.socket.on('message', (message: Buffer, rinfo) => {
      const kind = decodeQueryKind(message)
      emptyReceivedKinds.push(kind)
      // Only ever answers `info` - stage 1 must find it empty and never ask it again, so it must
      // never see a `status` query at all (AC2). If it somehow did, it stays silent for it.
      if (kind === 'info') {
        empty.socket.send(buildInfoReplyBytes(EMPTY_INFO_LINE), rinfo.port, rinfo.address)
      }
    })

    // The "dead" target: bound (so sends to it don't bounce as an immediate ICMP error) but never
    // replies to anything - the real-world "server that doesn't answer" case.
    dead.socket.on('message', () => {
      deadReceivedCount += 1
    })

    populatedAddress = `127.0.0.1:${populated.port}`
    emptyAddress = `127.0.0.1:${empty.port}`
    deadAddress = `127.0.0.1:${dead.port}`

    filePath = join(tmpdir(), `q2-launcher-state-servers-scan-integration-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()

    const nowIso = new Date().toISOString()
    const seededState: ServersState = {
      // AC4: every configured master/list source is disabled - the address set below comes
      // entirely from favourites + manual servers.
      sources: DEFAULT_MASTER_SOURCES.map((source) => ({ ...source, enabled: false })),
      favourites: [{ address: populatedAddress, addedAt: nowIso }],
      manualServers: [
        // AC6: the same address as the favourite above, under manual origin too - the union must
        // dedupe this to one target, not sweep it twice.
        { address: populatedAddress, origin: 'manual', addedAt: nowIso },
        { address: emptyAddress, origin: 'manual', addedAt: nowIso },
        { address: deadAddress, origin: 'manual', addedAt: nowIso },
      ],
      history: [],
      scan: SCAN_SETTINGS,
    }
    state.setServersState(seededState)

    emitted = []
    const appContext = {
      state,
      broadcast: {
        emit: (_channel: string, detail: unknown) => {
          const { type, payload } = detail as { moduleId: string; type: string; payload: unknown }
          emitted.push({ type, payload })
        },
      },
    } as unknown as AppContext

    registry = new MainModuleRegistry()
    await registry.register(serversModule, appContext)
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
    await Promise.all(
      [populated, empty, dead].map(
        (responder) => new Promise<void>((resolve) => responder.socket.close(() => resolve())),
      ),
    )
  })

  async function waitForScanToFinish(): Promise<ScanSnapshot> {
    for (let i = 0; i < 500; i++) {
      const outcome = (await registry.invoke({
        moduleId: 'servers',
        type: SERVERS_HANDLERS.scanRead,
        payload: undefined,
      })) as { ok: true; value: ScanSnapshot }
      if (!outcome.value.state.running) return outcome.value
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('scan did not finish within the polling budget')
  }

  it(
    'sweeps favourites+manual servers over real sockets, streaming rows, deduping the union, ' +
      'skipping stage 2 for an empty server, and surviving a dead target',
    async () => {
      const started = await registry.invoke({
        moduleId: 'servers',
        type: SERVERS_HANDLERS.scanStart,
        payload: undefined,
      })
      expect(started).toEqual({ ok: true, value: { ok: true } })

      const snapshot = await waitForScanToFinish()

      // --- AC1: a scan over real sockets streams rows as they arrive -------------------------
      // The first `scan.server` for the populated address (stage 1) must land *before* the
      // sweep's own transition into stage 2 - which only happens once every stage-1 query
      // (including the slow, never-answering one) has settled. That ordering is only possible if
      // the populated row was actually streamed out mid-stage, not held back until the whole
      // stage finished.
      const firstPopulatedStage1Index = emitted.findIndex(
        (event) =>
          event.type === SERVERS_EVENTS.scanServer &&
          (event.payload as ScanServerResult).stage === 'stage1' &&
          (event.payload as ScanServerResult).target.address === populatedAddress,
      )
      const stage2StartIndex = emitted.findIndex(
        (event) =>
          event.type === SERVERS_EVENTS.scanChanged &&
          (event.payload as ServersScanState).phase === 'stage2',
      )
      expect(firstPopulatedStage1Index).toBeGreaterThanOrEqual(0)
      expect(stage2StartIndex).toBeGreaterThanOrEqual(0)
      expect(firstPopulatedStage1Index).toBeLessThan(stage2StartIndex)

      // --- AC2: an empty server is not asked a second time -----------------------------------
      expect(emptyReceivedKinds).toContain('info')
      expect(emptyReceivedKinds).not.toContain('status')
      // At most `retries + 1` info sends for the empty responder's own stage-1 query.
      expect(emptyReceivedKinds.length).toBeLessThanOrEqual(SCAN_SETTINGS.retries + 1)

      // The dead target got queried (proving it's part of the swept set) but never held up the
      // rest of the sweep or crashed it - the scan still finished (`waitForScanToFinish` above).
      expect(deadReceivedCount).toBeGreaterThan(0)

      // --- AC6: the union is deduped -----------------------------------------------------------
      // The populated address was listed as both a favourite and a manual server; it must appear
      // exactly once in the final entries, and its responder must only ever have seen exactly one
      // `info` query (not two, one per origin).
      const populatedEntries = snapshot.entries.filter((entry) => entry.address === populatedAddress)
      expect(populatedEntries).toHaveLength(1)
      expect(populatedReceivedKinds.filter((kind) => kind === 'info')).toHaveLength(1)

      // --- AC4: the favourite is queried although every source is disabled --------------------
      const populatedEntry = populatedEntries[0]!
      expect(populatedEntry.origins).toContain('favourite')
      expect(populatedEntry.origins).toContain('manual')
      expect(populatedEntry.status).toBe('online')

      // --- AC5: every result arrives as an emitted event rather than a read -------------------
      // Reconstruct the populated server's final row purely by folding over the collected
      // `scan.server` events - `scan.read` above was only used to detect completion, never as the
      // source of this assertion's data.
      const populatedServerEvents = emitted.filter(
        (event) =>
          event.type === SERVERS_EVENTS.scanServer &&
          (event.payload as ScanServerResult).target.address === populatedAddress,
      )
      // One stage-1 (`info`) row, then one stage-2 (`status`) row - stage 1 found it non-empty.
      expect(populatedServerEvents).toHaveLength(2)
      const lastPopulatedEvent = populatedServerEvents[populatedServerEvents.length - 1]!
      const lastPopulatedResult = (lastPopulatedEvent.payload as ScanServerResult).result
      expect(lastPopulatedResult.ok).toBe(true)
      if (lastPopulatedResult.ok && lastPopulatedResult.kind === 'status') {
        expect(lastPopulatedResult.reply.serverinfo.hostname).toBe(POPULATED_HOSTNAME)
        expect(lastPopulatedResult.reply.players).toHaveLength(POPULATED_PLAYER_LINES.length)
        expect(lastPopulatedResult.rttMs).toBeGreaterThanOrEqual(0)
      }

      // The empty server's row came from a single stage-1 `info` event, and must report zero
      // clients through the same emitted-event path - not just an absence of a stage-2 event.
      const emptyServerEvents = emitted.filter(
        (event) =>
          event.type === SERVERS_EVENTS.scanServer &&
          (event.payload as ScanServerResult).target.address === emptyAddress,
      )
      expect(emptyServerEvents).toHaveLength(1)
      const emptyResult = (emptyServerEvents[0]!.payload as ScanServerResult).result
      expect(emptyResult.ok).toBe(true)
      if (emptyResult.ok && emptyResult.kind === 'info') {
        expect(emptyResult.reply.clients).toBe(0)
      }
    },
    15000,
  )
})
