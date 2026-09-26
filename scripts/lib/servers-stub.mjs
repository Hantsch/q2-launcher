// Story 121 D2: loopback-only stubs for the servers-list screens (`servers-list-populated`,
// `servers-list-loading`, `servers-list-error`, `scripts/lib/screens.mjs`) - a small set of fake
// Quake II game servers (dgram `info`/`status` responders) and a fake `http-list` master source
// (a plain HTTP server answering `?raw=1`). Never a real master or game server (GB-A5).
//
// The dgram wire format (`info`/`status` query + reply bytes) is copied verbatim from
// `scripts/flows/servers-scoped-refresh.mjs`'s `bindResponder`, which itself mirrors
// `src/main/modules/servers/scan-integration.test.ts`'s `bindResponder`/`decodeQueryKind` - see
// that file's own header comment for why this is copied rather than imported (`scripts/*.mjs`
// cannot `import` `src/**/*.ts` at runtime).
//
// The `?raw=1` list body format (one `host:port` per line, an empty body being the whole-body
// `empty-body` failure) mirrors `src/shared/servers/http-list.ts`'s `parseHttpListText`.

import { createSocket } from 'node:dgram'
import { createServer } from 'node:http'

const OOB_PREFIX = Buffer.from([0xff, 0xff, 0xff, 0xff])

function encodeLatin1(text) {
  const bytes = Buffer.alloc(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

function buildInfoReplyBytes(serverinfoLine) {
  // A real `info` reply is not an infostring but Quake II's `"%16s %8s %2i/%2i\n"` summary line
  // (`src/shared/servers/reply-fixtures.ts`'s `formatInfoLine`) - only these four keys survive.
  const parts = serverinfoLine.split('\\').slice(1)
  const kv = {}
  for (let i = 0; i + 1 < parts.length; i += 2) kv[parts[i]] = parts[i + 1]
  const count = (value) => (/^\d+$/.test(value ?? '') ? value : '0') // `%2i` always prints a number
  const line =
    `${(kv.hostname ?? '').padStart(16)} ${(kv.mapname ?? '').padStart(8)} ` +
    `${count(kv.clients).padStart(2)}/${count(kv.maxclients).padStart(2)}\n`
  return Buffer.concat([OOB_PREFIX, encodeLatin1(`info\n${line}`)])
}

function buildStatusReplyBytes(serverinfoLine, playerLines) {
  const players = playerLines.map((line) => `\n${line}`).join('')
  return Buffer.concat([OOB_PREFIX, encodeLatin1(`print\n${serverinfoLine}${players}`)])
}

function decodeQueryKind(message) {
  const text = message.subarray(4).toString('latin1')
  if (text.startsWith('info')) return 'info'
  if (text.startsWith('status')) return 'status'
  return 'unknown'
}

// --- fixed ports/defaults ---------------------------------------------------
//
// Chosen to avoid every port already used by another scripts/lib or scripts/flows fixture -
// `scripts/lib/fixture.mjs`'s `SERVERS_MANUAL_SERVER_ADDRESS` (27921) and
// `scripts/flows/servers-master-sources.mjs`'s hardcoded master addresses (27900) both grepped
// clean against this range.

/** Three fake game servers, each with a distinct hostname/map/roster so the rendered rows are
 * visibly distinguishable in a screenshot. */
export const SERVERS_STUB_RESPONDERS = [
  { port: 27950, hostname: 'Fixture Stub Server A', map: 'q2dm1', players: ['5 20 "Alpha1"'] },
  { port: 27951, hostname: 'Fixture Stub Server B', map: 'q2dm2', players: ['7 15 "Bravo1"'] },
  { port: 27952, hostname: 'Fixture Stub Server C', map: 'q2dm3', players: [] },
]

/** The stub `http-list` server's fixed port - a fixture writer (`scripts/lib/fixture.mjs`) needs
 * this value at seed time, before the app (and therefore before `startListServer`) ever runs, so
 * it has to be a fixed constant rather than an ephemeral bound port. */
export const SERVERS_STUB_LIST_PORT = 27953

/** A fixed loopback port nothing ever binds - a request against it deterministically fails with a
 * connection-refused/transport error (`resolveHttpListSource`'s `transport-error`), never reaching
 * the real internet (GB-A5). */
export const SERVERS_DEAD_LIST_URL = 'http://127.0.0.1:27954/?raw=1'

/** The `?raw=1` URL for the stub list server on `port` (default: `SERVERS_STUB_LIST_PORT`). */
export function serversStubListUrl(port = SERVERS_STUB_LIST_PORT) {
  return `http://127.0.0.1:${port}/?raw=1`
}

// --- per-port instance caches (idempotent across repeated `navigate()` calls) -------------------
//
// Screens sharing a fixture variant (e.g. `servers-list-populated`/`servers-list-loading`, both on
// the `servers-list` variant) each call `startServerResponders`/`startListServer` from their own
// `navigate()`. Whichever runs first in a given `ui:verify` invocation binds the real socket; every
// later call for the same port reuses it instead of throwing `EADDRINUSE`.

const responderInstances = new Map()
const listServerInstances = new Map()

/**
 * Binds one dgram responder per `spec` (`{ port, hostname, map, players }`), answering both `info`
 * and `status` queries with that spec's own hostname/map/roster. `clients` in the `info` reply is
 * always `players.length`.
 *
 * Returns `{ setDelayMs(ms), close() }`. `setDelayMs(ms)` makes every responder in THIS call wait
 * `ms` milliseconds (via `setTimeout`) before replying - used by `servers-list-loading` to force a
 * screenshot mid-scan. `close()` unbinds every responder this call touched and forgets it, so a
 * later call for the same port rebinds fresh.
 *
 * Every socket is `.unref()`'d so it never keeps the Node process alive on its own.
 */
export async function startServerResponders(specs) {
  const active = []

  for (const spec of specs) {
    let responder = responderInstances.get(spec.port)
    if (!responder) {
      const socket = createSocket('udp4')
      await new Promise((resolve, reject) => {
        socket.once('error', reject)
        socket.bind(spec.port, '127.0.0.1', () => resolve())
      })
      socket.unref()
      responder = { socket, spec, delayMs: 0 }
      socket.on('message', (message, rinfo) => {
        const kind = decodeQueryKind(message)
        if (kind !== 'info' && kind !== 'status') return
        const infoLine =
          `\\gamename\\baseq2\\hostname\\${responder.spec.hostname}\\mapname\\${responder.spec.map}` +
          `\\clients\\${responder.spec.players.length}\\maxclients\\8\\version\\3.20`
        const reply =
          kind === 'info'
            ? buildInfoReplyBytes(infoLine)
            : buildStatusReplyBytes(infoLine, responder.spec.players)
        const send = () => socket.send(reply, rinfo.port, rinfo.address)
        if (responder.delayMs > 0) setTimeout(send, responder.delayMs)
        else send()
      })
      responderInstances.set(spec.port, responder)
    } else {
      // A later call for the same port may carry different content - keep the responder answering
      // with whatever spec was passed most recently.
      responder.spec = spec
    }
    active.push(responder)
  }

  return {
    setDelayMs(ms) {
      for (const responder of active) responder.delayMs = ms
    },
    close() {
      for (const responder of active) {
        responderInstances.delete(responder.spec.port)
        responder.socket.close()
      }
    },
  }
}

/**
 * Binds (or reuses) an HTTP server on `port` answering a `?raw=1` query with the current address
 * list as plain text, one `host:port` per line - the exact shape `parseHttpListText`
 * (`src/shared/servers/http-list.ts`) reads. A non-`raw=1` request gets a 404 (never exercised by
 * this repo's own `http-list-source.ts`, which always appends `?raw=1`/`?raw=2` itself).
 *
 * Returns `{ setAddresses(list), close() }`. An empty `list` produces an empty response body,
 * which `parseHttpListText` deterministically reports as `empty-body`.
 */
export async function startListServer(port = SERVERS_STUB_LIST_PORT) {
  let instance = listServerInstances.get(port)
  if (!instance) {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      if (url.searchParams.get('raw') !== '1') {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(instance.addresses.join('\n'))
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => resolve())
    })
    server.unref()
    instance = { server, addresses: [] }
    listServerInstances.set(port, instance)
  }

  return {
    setAddresses(list) {
      instance.addresses = list
    },
    close() {
      listServerInstances.delete(port)
      instance.server.close()
    },
  }
}
