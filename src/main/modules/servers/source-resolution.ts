/**
 * Story 114 D4: resolving the configured source list into one address set, source by source,
 * isolated (AC3).
 *
 * This is the seam between the source list (`MasterSource[]`, story 111) and the two transport
 * seams that already know how to talk to a single source (`resolveUdpMasterSource`,
 * `resolveHttpListSource`). It adds no networking of its own — it only decides *which* sources are
 * queried at all (`enabled` only), *how* each one is dispatched (`type` picks the transport, and
 * for `http-list` the source's own URL picks `raw` mode), and how one source's failure is kept from
 * ever taking the others down with it.
 *
 * Both transport seams already document themselves as "never throws" for the failures they know
 * about, but a resolve call can still reject for a reason neither seam guards (e.g. a response body
 * that errors mid-read in `resolveHttpListSource`, since only the `fetch` call itself, not
 * `response.text()`/`arrayBuffer()`, is wrapped there). `Promise.allSettled` is used rather than
 * `Promise.all` specifically so such a rejection is caught right here, per source, instead of
 * rejecting the whole `resolveSources` call and losing every other source's addresses with it.
 */

import type { MasterSource } from '@shared/modules/servers'
import type { ScanSourceFailure } from '@shared/modules/servers'
import type { ParsedServerAddress } from '@shared/servers/address'
import { parseServerAddress } from '@shared/servers/address'
import { masterSourceFailureKey, type MasterSourceFailure } from '@shared/servers/master-records'
import type { FetchImpl } from '../downloads/fetcher'
import {
  dgramMasterUdp,
  resolveUdpMasterSource,
  systemClock,
  type Clock,
  type MasterUdpImpl,
} from './udp-master-source'
import { resolveHttpListSource, type HttpListRaw } from './http-list-source'

/**
 * Injectable seam for both transport kinds, passed straight through to
 * `resolveUdpMasterSource`/`resolveHttpListSource` so this module stays testable with no real UDP
 * socket or `fetch`. `fetchImpl` is required (mirroring `resolveHttpListSource`'s own option,
 * which has no Electron-based default); `udpImpl`/`clock` default the same way
 * `resolveUdpMasterSource` already defaults them.
 */
export interface ResolveSourcesDeps {
  fetchImpl: FetchImpl
  udpImpl?: MasterUdpImpl
  clock?: Clock
  quietPeriodMs?: number
  firstReplyTimeoutMs?: number
  signal?: AbortSignal
}

export interface ResolveSourcesResult {
  addresses: ParsedServerAddress[]
  failures: ScanSourceFailure[]
}

/** Common shape both transport results share: an address list on success, a `MasterSourceFailure`
 * reason on failure. Only the fields this module reads. */
type SourceOutcome =
  | { ok: true; addresses: ParsedServerAddress[] }
  | { ok: false; reason: MasterSourceFailure }

/**
 * `?raw=2` on the source's own URL means the bare packed-binary shape; anything else (including no
 * query string at all, or an unparsable URL) is the `?raw=1` text shape (D-I).
 */
function deriveHttpListRaw(url: string): HttpListRaw {
  try {
    return new URL(url).searchParams.get('raw') === '2' ? 2 : 1
  } catch {
    return 1
  }
}

async function resolveOneSource(
  source: MasterSource,
  deps: ResolveSourcesDeps,
): Promise<SourceOutcome> {
  if (source.type === 'udp-master') {
    // Stored addresses are already normalized `host:port` (`validateMasterSourceAddress`, story
    // 111) so this should never fail in practice; if it somehow does, it is reported the same way
    // any other transport failure is, rather than throwing out of a well-formed source list.
    const parsed = parseServerAddress(source.address)
    if (!parsed.ok) return { ok: false, reason: 'transport-error' }

    return resolveUdpMasterSource(
      { host: parsed.host, port: parsed.port },
      {
        udpImpl: deps.udpImpl ?? dgramMasterUdp,
        clock: deps.clock ?? systemClock,
        quietPeriodMs: deps.quietPeriodMs,
        firstReplyTimeoutMs: deps.firstReplyTimeoutMs,
        signal: deps.signal,
      },
    )
  }

  return resolveHttpListSource(source.address, {
    raw: deriveHttpListRaw(source.address),
    fetchImpl: deps.fetchImpl,
    signal: deps.signal,
  })
}

/**
 * Resolves every enabled source in `sources` independently and merges the results: every address
 * every source contributed (order preserved, no cross-source dedupe — that is the scan's job, not
 * this seam's), and one `ScanSourceFailure` per source that failed, whether by returning a failure
 * result or by its resolve call rejecting outright (AC3). A disabled source is skipped entirely —
 * no resolve call, no failure entry.
 */
export async function resolveSources(
  sources: readonly MasterSource[],
  deps: ResolveSourcesDeps,
): Promise<ResolveSourcesResult> {
  const enabled = sources.filter((source) => source.enabled)

  const settled = await Promise.allSettled(
    enabled.map((source) => resolveOneSource(source, deps)),
  )

  const addresses: ParsedServerAddress[] = []
  const failures: ScanSourceFailure[] = []

  settled.forEach((outcome, index) => {
    const source = enabled[index]!
    if (outcome.status === 'rejected') {
      failures.push({ sourceId: source.id, reasonKey: masterSourceFailureKey('transport-error') })
      return
    }
    if (outcome.value.ok) {
      addresses.push(...outcome.value.addresses)
    } else {
      failures.push({ sourceId: source.id, reasonKey: masterSourceFailureKey(outcome.value.reason) })
    }
  })

  return { addresses, failures }
}
