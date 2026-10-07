import {
  SERVERS_DEAD_LIST_URL,
  SERVERS_STUB_FAVOURITE_PORT,
  serversStubListUrl,
} from '../servers-stub.mjs'
import { writePopulatedFixture } from './populated.mjs'

// --- servers.ts ServersState fixture (story 115) ----------------------------
// Mirrors src/shared/modules/servers.ts's `ServersState`/`ServersScanSettings`/
// `DEFAULT_MASTER_SOURCES` (hardcoded, not imported - see this file's own header comment).
//
// GB-A5 (this project's own testing rule): no test or `ui:flow`/`ui:verify` run may ever touch a
// real master or game server. The `populated` variant's fresh boot falls back to
// `DEFAULT_SERVERS_STATE` - whose three `DEFAULT_MASTER_SOURCES` are all `enabled: true` and point
// at real internet hosts (`master.q2servers.com`, `master.quakeservers.net`, `q2servers.com`) -
// which is exactly what story 111's own `servers-master-sources` flow needs to find there (a fresh
// profile's three defaults, enabled). Story 115 D5's `servers-scan-settings` flow instead triggers
// a real `scan.start` (AC3), so it gets its OWN dedicated fixture variant (`servers-scan`, below)
// rather than mutating `populated`'s shared `servers` key: every shipped source present (never
// silently deleted from the user's view) but disabled, plus one manual server on a dead,
// unused-looking loopback port that only ever needs to time out harmlessly - the same safety
// property `scan-integration.test.ts`'s own seed uses, minus the real dgram responder this fixture
// doesn't need.
export const SERVERS_DISABLED_SOURCES = [
  {
    id: 'default-q2servers-udp',
    type: 'udp-master',
    address: 'master.q2servers.com:27900',
    enabled: false,
  },
  {
    id: 'default-quakeservers-udp',
    type: 'udp-master',
    address: 'master.quakeservers.net:27900',
    enabled: false,
  },
  {
    id: 'default-q2servers-http',
    type: 'http-list',
    address: 'https://q2servers.com/?raw=1',
    enabled: false,
  },
]

/** A manual server address on a fixed, dead loopback port - nothing listens on it, so a scan
 * against it always times out locally and never reaches the real internet. */
export const SERVERS_MANUAL_SERVER_ADDRESS = '127.0.0.1:27921'

/** Mirrors src/shared/modules/servers.ts's `ServersScanSettings`. Deliberately non-default on
 * every field except `autoRefreshIntervalMs` (which happens to coincide with
 * `DEFAULT_SERVERS_STATE.scan`'s own 60000 - every other field still tells "the fixture's seeded
 * values" apart from "whatever the default would have rendered anyway", same discipline as
 * `DOWNLOADS_SETTINGS_SEED` above). `timeoutMs: 500`/`retries: 0` is the shortest combination the
 * Settings `<Select>` can actually show - `500` is `SCAN_TIMEOUT_CHOICES_MS`'s (servers.ts) own
 * lowest choice, deliberately not the schema's raw `MIN_SCAN_TIMEOUT_MS` (250) floor, which the
 * `<Select>` has no option for and would leave the control showing no matching value at boot - so
 * the one dead loopback target still fails fast (~500ms, no retry) without the flow's own boot-side
 * assertion breaking against a value the UI cannot render. Exported so
 * `scripts/flows/servers-scan-settings.mjs` asserts against the exact seeded literals. */
export const SERVERS_SCAN_SETTINGS_SEED = {
  concurrency: 4,
  timeoutMs: 500,
  retries: 0,
  minSpacingMs: 15000,
  autoScanOnOpen: false,
  autoRefreshEnabled: true,
  autoRefreshIntervalMs: 60000,
}

/**
 * Story 121 D2: `servers-list-empty`'s fixture - the same shape `servers-scan` documents above
 * (every shipped source present but disabled, autos off), but with no manual/favourite servers and
 * no enabled source at all - a scan genuinely finds nothing, an honest empty result rather than a
 * stub source involved.
 */
export function writeServersListEmptyFixture() {
  return writePopulatedFixture({
    variant: 'servers-list-empty',
    stateOverrides: {
      servers: {
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [],
        manualServers: [],
        history: [],
        scan: { ...SERVERS_SCAN_SETTINGS_SEED },
      },
    },
  })
}

/**
 * Story 121 D2: `servers-list-populated`/`servers-list-loading`'s shared fixture - the same
 * disabled shipped sources as `servers-list-empty`, plus one enabled `http-list` source pointing at
 * the loopback stub list server (`scripts/lib/servers-stub.mjs`). The screens themselves start the
 * stub responders/list server and feed it addresses at runtime (`navigate()`); this fixture only
 * ever seeds the URL the source will fetch.
 */
export function writeServersListFixture() {
  return writePopulatedFixture({
    variant: 'servers-list',
    stateOverrides: {
      servers: {
        sources: [
          ...SERVERS_DISABLED_SOURCES,
          {
            id: 'fixture-servers-list-http',
            type: 'http-list',
            address: serversStubListUrl(),
            enabled: true,
          },
        ],
        favourites: [],
        manualServers: [],
        history: [],
        scan: { ...SERVERS_SCAN_SETTINGS_SEED },
      },
    },
  })
}

/**
 * Story 121 D2: `servers-list-error`'s fixture - the same stub `http-list` source as
 * `servers-list`, plus a second enabled `http-list` source pointing at `SERVERS_DEAD_LIST_URL` (a
 * loopback port nothing binds), so one source succeeds and the other deterministically fails with a
 * transport error - AC3's proof that a source failure never hides the rest of the list.
 */
export function writeServersListErrorFixture() {
  return writePopulatedFixture({
    variant: 'servers-list-error',
    stateOverrides: {
      servers: {
        sources: [
          ...SERVERS_DISABLED_SOURCES,
          {
            id: 'fixture-servers-list-http',
            type: 'http-list',
            address: serversStubListUrl(),
            enabled: true,
          },
          {
            id: 'fixture-servers-list-http-dead',
            type: 'http-list',
            address: SERVERS_DEAD_LIST_URL,
            enabled: true,
          },
        ],
        favourites: [],
        manualServers: [],
        history: [],
        scan: { ...SERVERS_SCAN_SETTINGS_SEED },
      },
    },
  })
}

/**
 * Story 196 D5: the `servers-lan` fixture - a favourite (stub responder A), the usual manual
 * server (dead), and the enabled stub `http-list` source (which serves responder B), so Online has
 * rows from every origin. The LAN-only responder is deliberately in none of them: only a LAN scan
 * (`Q2L_UI_LAN_TARGETS`) can surface it. Autos are off unless `autoScanOnOpen` is asked for.
 */
export function writeServersLanFixture({ autoScanOnOpen = false } = {}) {
  return writePopulatedFixture({
    variant: 'servers-lan',
    stateOverrides: {
      servers: {
        sources: [
          ...SERVERS_DISABLED_SOURCES,
          {
            id: 'fixture-servers-lan-http',
            type: 'http-list',
            address: serversStubListUrl(),
            enabled: true,
          },
        ],
        favourites: [
          {
            address: `127.0.0.1:${SERVERS_STUB_FAVOURITE_PORT}`,
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        manualServers: [
          {
            address: SERVERS_MANUAL_SERVER_ADDRESS,
            origin: 'manual',
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        history: [],
        scan: { ...SERVERS_SCAN_SETTINGS_SEED, autoScanOnOpen, autoRefreshEnabled: false },
      },
    },
  })
}

export function writeServersScanFixture() {
  // Reuses the populated fixture's side effects under its own userData dir, with the `servers` key
  // `populatedStateDocument()` does not carry added back on top.
  return writePopulatedFixture({
    variant: 'servers-scan',
    stateOverrides: {
      servers: {
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [],
        manualServers: [
          {
            address: SERVERS_MANUAL_SERVER_ADDRESS,
            origin: 'manual',
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        history: [],
        scan: { ...SERVERS_SCAN_SETTINGS_SEED },
      },
    },
  })
}
