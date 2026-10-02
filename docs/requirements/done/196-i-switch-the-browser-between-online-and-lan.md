---
id: 196
title: I switch the browser between online and LAN
status: done # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player at a LAN party I can switch the server browser from **Online** to **LAN** and see
only the Quake II servers on my local network; switched back to Online, I see only the servers
from the master sources, favourites and manual entries as today. The two views are never mixed:
on a LAN I search the LAN, otherwise I search online.

LAN is an option, not the default: the browser opens on Online, and nothing is broadcast on the
network unless the user chose LAN.

Idea taken from a review of ozy24/q2connect (LAN discovery by UDP broadcast).
Concept: [game-browser.md](../concepts/game-browser.md) §7 (discovery and scanning).

## Acceptance Criteria

- [x] **AC1** — The server list header carries an Online / LAN toggle. Online is selected when
      the launcher starts.
- [x] **AC2** — A scan in Online mode contacts the master sources and sends no LAN broadcast; a
      scan in LAN mode sends the broadcast and contacts no master source.
- [x] **AC3** — In LAN mode the list shows only servers that answered the broadcast: no
      favourites, manual servers, history entries or master results appear in it unless they
      answered it. Online mode never shows a server that only the LAN scan found.
- [x] **AC4** — A server that answers the broadcast more than once, or from several interfaces,
      appears once per `address:port`.
- [x] **AC5** — LAN rows stream in as they answer, with the same columns, markers, detail view and
      Join action as online rows, and a measured ping.
- [x] **AC6** — When no server answers within the scan window, the LAN list shows an explicit
      empty state naming the local network ("no server answered on the local network"), not an
      error and not the online empty state.
- [x] **AC7** — The hard rule holds in both modes: no LAN scan runs while a game is running; an
      automatic one is skipped and a manual one is refused, each with a visible reason.
- [x] **AC8** — Switching mode shows that mode's last result at once and does not discard the
      other mode's result; filter and sort apply to whichever list is shown.
- [x] **AC9** — If the broadcast cannot be sent at all (no usable network interface, socket
      refused), the LAN toggle stays visible and says so as visible text from an i18n key; it is
      never silently removed.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — — Is the toggle always visible, or does LAN first have to be switched on in the servers
  settings section? "An option, not the default" fits both. Recommendation: always visible,
  Online preselected - a toggle nobody can find is not an option.
- ~~**Q2**~~ answered → Decisions (Sprint) — — Is the chosen mode remembered across launches, or does every start open on Online
  (AC1 currently says the latter)?
- ~~**Q3**~~ answered → Decisions (Sprint) — — Which broadcast? q2connect sends `status` to `255.255.255.255:27910`, which leaves
  through the default route only. A multi-homed machine (Ethernet plus Wi-Fi, VPN adapters) would
  miss servers on the other interface. Per-interface directed broadcast is more reliable and is a
  small step more work; the refine has to decide.
- ~~**Q4**~~ answered → Decisions (Sprint) — One broadcast `status` gives players and ping in a single round, but a very full server
  may exceed an MTU (concept §6.4). Does LAN reuse the two-stage scan (`info` broadcast, then
  `status` per answer) so it behaves exactly like online, or is one stage enough on a LAN?
- ~~**Q5**~~ answered → Decisions (Sprint) — — Favourites and manual servers in LAN mode: AC3 says they stay out. A user who keeps a
  LAN server as a favourite might expect it there; if so, that is a separate story, not a quiet
  mix-in.
- ~~**Q6**~~ answered → Decisions (Sprint) — — Which ports are probed? q2connect uses only 27910. Servers on other ports are
  invisible to a broadcast.
- ~~**Q7**~~ answered → Decisions (Sprint) — The watchlist (gated) matches against stage-2 data: does it see LAN results, or only
  online ones? Recommendation: whichever list was scanned most recently feeds it, and the
  watchlist says which.

## Decisions (Sprint)

- **(User)** Toggle visibility: always visible
- **(User)** Remember mode: no, every start opens on Online
- **(User)** Broadcast: per-interface directed broadcast
- **(User)** Favourites/manual in LAN: stay out in LAN mode (AC3)
- **(User)** Ports: port 27910 only
- **D-A (Q4) Two stages:** LAN discovery broadcasts `info`; the discovered addresses then go through
  the unchanged `runScan` (unicast `info` + `status`) — same markers, player search, detail data as
  online, no MTU risk from a broadcast `status`, and zero change to the runner.
- **D-B (Q7) Watchlist stays online-only:** LAN stage-2 rows never reach `onStage2Row` — the watchlist
  finds players on public servers, and a LAN round must never flip its online matches to `offline`;
  a LAN-fed watchlist is a separate story.
- **D-C Mode lives in main, in memory:** `scan.setMode({ mode })` sets it (default `online`, never
  persisted); `start()`, `read()`, `readDetail()`, `overview()` and the auto cadence all act on the
  active mode's list — so the existing auto-refresh path follows the mode without a second code path.
- **D-D Two separate lists:** the scan service holds an online list and a LAN list (entries +
  status serverinfo each); a scan writes only into the list of the mode it started in, even if the
  mode is switched mid-scan — this is what makes AC3/AC8 structural, not filtered.
- **D-E A LAN round replaces the LAN list:** cleared at LAN-scan start, refilled as answers stream;
  nothing goes stale — "only servers that answered" (AC3) and a silent network ending in the empty
  state (AC6) require it.
- **D-F Scan window = existing settings:** each interface is re-broadcast `retries` times, `timeoutMs`
  apart, window ends after `(retries+1) × timeoutMs` — the concept makes cadence a setting, and no new
  setting is needed for it.
- **D-G Per-interface sockets:** one UDP socket per non-internal IPv4 interface, bound to that
  interface's address, `setBroadcast(true)`, sending to `address | ~netmask` port 27910 — the source
  address matches the subnet on multi-homed machines; one failing interface does not stop the others.
- **D-H AC9 failure keys:** `servers.lan.error.noInterface` (no usable IPv4 interface) and
  `servers.lan.error.socketRefused` (every socket failed to bind/broadcast/send); a partial failure is
  not a failure — at least one broadcast went out.
- **D-I AC9 text placement:** the last LAN round's failure text sits next to the toggle; the LAN button
  stays enabled so a retry after plugging in a cable needs no restart.
- **D-J Scoped refreshes in LAN mode:** "Refresh servers" = LAN scan; "Refresh favourites" is
  disabled with a visible i18n reason (refused in main too, `servers.scan.error.favouritesNotInLan`);
  "Refresh this server" works on the LAN list via unicast `status` — favourites stay out of LAN (User),
  and a control is never silently removed (CLAUDE.md).
- **D-K Switching into a never-scanned mode** runs the cadence's view-open auto-trigger decision for
  that mode — choosing LAN is the consent to broadcast, and routing it through `decideAutoTrigger`
  keeps AC7's skip-with-reason in one place.
- **D-L Selection is cleared on mode switch** — a selected online server must not keep its detail open
  over the LAN list.
- **D-M Favouriting a LAN row is allowed;** it then appears in Online as any favourite would — that is
  the user's explicit act, not a LAN result leaking (AC3 holds for scan results).
- **D-N No broadcast before the user chose LAN:** discovery runs only inside a LAN-mode `start()`; no
  interface probe at boot or view open (Requirement: "nothing is broadcast unless the user chose LAN").
- **D-O e2e seam:** harness-only `Q2L_UI_LAN_TARGETS` (gated by `isUiHarnessEnabled`, loopback
  `127.0.0.1:<port>` entries only; literal `none` = zero usable interfaces) replaces interface
  enumeration — loopback broadcast is not reliable on Windows, and this mirrors the existing
  `Q2L_UI_*` seams in `src/main/lib/ui-harness.ts`.
- **D-P Platform parity:** `os.networkInterfaces()` and directed broadcast behave the same on Windows
  and Linux, so there is no platform gap to disclose.

## Plan

Contract-first, main before renderer, e2e last (it needs the full surface).

1. **LAN discovery core** (`src/main/modules/servers/lan-discovery.ts`): enumerate interfaces →
   directed broadcast `info` on 27910 per interface (D-G), re-send per D-F, dedupe replies by
   `address:port` (AC4), stream each first answer with its RTT, return `{ failureKey | null }` (D-H).
   Harness override D-O lives in `ui-harness.ts`.
2. **Contract + scan service** (`src/shared/modules/servers.ts`, `scan-service.ts`): mode type,
   `ScanOrigin 'lan'`, `scan.setMode` handler + schema, `ServersScanState.mode`, snapshot `mode` +
   `lan { lastFinishedAt, failureKey }`; two lists (D-D), LAN sweep = discovery → `runScan` over the
   discovered targets (D-A) writing into the LAN list (D-E), no watchlist feed (D-B), favourites scope
   refused in LAN (D-J).
3. **Wiring** (`index.ts`, `scan-cadence.ts`): register `scan.setMode`, pass real discovery deps,
   `onModeChanged()` → view-open auto-trigger for a never-scanned mode (D-K).
4. **Renderer** (`ServersView.tsx` + new `ServersModeToggle.tsx`, `client.ts`, `list-state.ts`,
   `ServersListStatus.tsx`, `en.json`): Online/LAN toggle in the toolbar, Online on mount (User),
   LAN empty state (AC6), failure text by the toggle (AC9, D-I), favourites refresh disabled with
   reason (D-J), selection cleared on switch (D-L). CHANGELOG line.
5. **e2e** (`scripts/flows/servers-lan-*.mjs`, fixture + stub helpers): the real-surface proof.

## Deliverables

- **D1 — LAN discovery core + harness seam.** New `src/main/modules/servers/lan-discovery.ts`
  (mirror the injectable `udpImpl`/`Clock` seam of `server-query.ts`; reuse `buildInfoQuery(
INFO_QUERY_PROTOCOL_VERSION)` and the `info` reply parser `server-query.ts` already uses from
  `src/shared/servers/protocol.ts`). API: `discoverLanServers({ settings: { timeoutMs, retries },
signal, onReply, deps: { networkInterfaces?, udpImpl?, clock?, targetsOverride? } }) →
Promise<{ failureKey: string | null }>`, `onReply({ address, reply, rttMs })` called once per
  `address:port` (first answer wins; later answers from other interfaces/repeats ignored). Interface
  selection: IPv4, `internal === false`, broadcast = `address | ~netmask`, port **27910** only. One
  socket per interface bound to its address with `setBroadcast(true)`; re-send `retries` times
  `timeoutMs` apart; resolve after `(retries+1) × timeoutMs` or on abort; close every socket. Failure
  keys: no usable interface → `servers.lan.error.noInterface`; every socket bind/broadcast/send failed
  → `servers.lan.error.socketRefused`; any one broadcast sent → `null`. Harness seam in
  `src/main/lib/ui-harness.ts`: `UI_HARNESS_LAN_TARGETS_ENV = 'Q2L_UI_LAN_TARGETS'` and
  `uiHarnessLanTargets(input): string[] | 'none' | undefined` (mirror `uiHarnessSteamExecutable`;
  comma-separated, only `127.0.0.1:<port>` entries accepted, `none` = zero interfaces); under an
  override discovery sends unicast `info` to each target from one loopback socket, same dedupe.
  Tests in `lan-discovery.test.ts` (fake interfaces + fake udp): AC4 dedupe across two interfaces and
  repeated replies; directed-broadcast address per interface; internal/IPv6 skipped; both failure keys;
  partial failure → `null`; abort closes sockets. Parser cases in `src/main/lib/ui-harness.test.ts`
  (create if absent, mirror the module's existing test if one exists).
- **D2 — Contract + two-list scan service.** `src/shared/modules/servers.ts`: `ServersBrowseMode =
'online' | 'lan'`; `ScanOrigin` gains `'lan'`; handler id `scan.setMode` in `SERVERS_HANDLERS` with
  `scanSetModeInputSchema = z.object({ mode: z.enum(['online','lan']) })` added to the schema map;
  `ServersScanState.mode: ServersBrowseMode` (mode of the running/last scan); `ScanSnapshot` gains
  `mode` and `lan: { lastFinishedAt: string | null; failureKey: string | null }`; constants
  `SCAN_FAVOURITES_NOT_IN_LAN_REASON_KEY = 'servers.scan.error.favouritesNotInLan'` and the two
  `servers.lan.error.*` keys. `src/main/modules/servers/scan-service.ts`: hold an online list and a LAN
  list (each its own `entries` + `statusInfo` + `lastScanAt`); `setMode(mode)` (in memory, default
  `online`); `start()` resolves against the active mode and captures that list for the whole round
  (a mid-scan switch never redirects writes). LAN + scope `all`: clear the LAN list, call D1's
  `discoverLanServers` (new `ScanServiceDeps.lanDiscovery`), merge each reply into the LAN list as a
  `stage1` row (`origins: ['lan']`, emit `scan.server`, progress counts = answers so far), then
  `runScan` over the discovered targets into the LAN list, no `mergeStaleRound` for LAN, never call
  `resolveSources` and never call `onStage2Row`; store `lan.failureKey`/`lastFinishedAt`. LAN + scope
  `favourites` → `{ ok: false, reasonKey: SCAN_FAVOURITES_NOT_IN_LAN_REASON_KEY }`. LAN + scope
  `server` → unicast `status` into the LAN list. The game-running guard stays first and
  scope/mode-agnostic. `read()` in LAN mode: LAN rows only, `favourite` flag computed, **no**
  favourite/manual placeholders; `readDetail`/`overview` read the active list. Tests in
  `scan-service.test.ts`: online scan never calls `lanDiscovery` (AC2, D-N); LAN scan calls neither
  `fetchImpl` nor master `udpImpl` (AC2); LAN `read()` excludes favourites/manual/online rows and
  online `read()` excludes LAN-only rows (AC3); switching mode returns the other list unchanged (AC8);
  mid-scan switch keeps writes in the starting list; LAN round replaces the list; game-running refusal
  in LAN mode (AC7); favourites refused in LAN; LAN stage-2 rows do not reach `onStage2Row`.
- **D3 — IPC + cadence wiring.** `src/main/modules/servers/index.ts`: register `scan.setMode`
  (validated payload → `scanService.setMode` → `cadence.onModeChanged()`), wire real D1 discovery
  (with `uiHarnessLanTargets` override) into `ScanServiceDeps.lanDiscovery`.
  `src/main/modules/servers/scan-cadence.ts`: `onModeChanged()` — if the view is active and the active
  mode's `overview().lastScanAt` is `null`, run `tryAutoTrigger('open')` (so `decideAutoTrigger`'s
  game-running skip and `autoScanOnOpen` apply unchanged). Tests: `scan-cadence.test.ts` (never-scanned
  mode triggers; already-scanned mode does not; game running → skipped, AC7); `index.test.ts` (the
  handler exists and rejects an invalid mode).
- **D4 — Renderer toggle and LAN states.** New `src/renderer/src/modules/servers/ServersModeToggle.tsx`
  (mirror `src/renderer/src/modules/config/components/LayerSwitcher.tsx`: `role="group"`, two `Button`s
  with `aria-pressed`, testids `servers-mode-online`/`servers-mode-lan`, design tokens only) placed in
  `ServersView.tsx`'s `toolbar`; mode is local state initialised to `online` on every mount and never
  persisted; switching calls `client.setMode` (new in `client.ts`), clears selection, re-reads the
  snapshot. Under the toggle area, `servers-lan-failure` shows `t(snapshot.lan.failureKey)` when set
  (button stays enabled). In LAN mode `servers-refresh-favourites` is disabled with visible text
  `servers.lan.favouritesNotInLan`. `list-state.ts`: `deriveListState` gets the mode — LAN: `loading`
  while a `lan` scan runs, `lanEmpty` when `lan.lastFinishedAt` is set and there are no rows, `idle`
  otherwise. `ServersListStatus.tsx`: `servers-list-lan-empty` with `servers.list.lanEmpty` ("No server
  answered on the local network"), no source-settings link, no source failures in LAN mode.
  `en.json`: `servers.mode.{label,online,lan}`, `servers.list.lanEmpty`, `servers.lan.favouritesNotInLan`,
  `servers.lan.error.{noInterface,socketRefused}`, `servers.scan.error.favouritesNotInLan`.
  `CHANGELOG.md` under `## Unreleased` / `### Added`: one line ("Server browser: switch between Online
  and LAN to find servers on your local network."). Tests: `list-state.test.ts` (LAN states, AC6),
  `ServersView.test.tsx` (Online pressed on mount AC1, failure text visible AC9, favourites refresh
  disabled with reason in LAN).
- **D5 — e2e flows.** Mirror `scripts/flows/servers-list-states.mjs` (setup/teardown/variant shape,
  `startServerResponders`) and `scripts/flows/servers-no-scan-while-playing.mjs` (game-running
  fixture). `setup()` returns `{ env: { Q2L_UI_LAN_TARGETS: ... } }`. Add a fixture writer in
  `scripts/lib/fixture.mjs` (favourite + manual server + enabled stub `http-list` source, autos off,
  `SERVERS_SCAN_SETTINGS_SEED`) and a request counter on `startListServer` in
  `scripts/lib/servers-stub.mjs`. Flows: `servers-lan-mode` (Online pressed at start; LAN target =
  a responder in no source/favourite/manual, listed twice in the env → one row; list stub gets no
  request during the LAN scan; LAN row has name/map/players/ping, opens detail with Join; Online again
  shows its rows at once without the LAN-only row; back to LAN shows the LAN row at once; search filter
  applies to the LAN list), `servers-lan-empty` (target = a loopback port nothing binds →
  `servers-list-lan-empty`), `servers-lan-unavailable` (`Q2L_UI_LAN_TARGETS=none` → toggle still
  visible, `servers-lan-failure` shows the noInterface text), `servers-lan-no-scan-while-playing` (game
  running: switching to LAN does not scan and `servers-scan-blocked` is visible; LAN refresh refused
  with the visible reason).

## Model Hints

- D2 → deliverable-hard — it splits the single `entries` map that every online scan, `read()`,
  `readDetail()` and the stale merge depend on into two mode-captured lists; a mid-scan mode switch or
  a missed call site silently mixes LAN and online rows or breaks the existing online refresh paths.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-lan-mode.mjs` › "servers-lan-mode"; unit
  `src/renderer/src/modules/servers/ServersView.test.tsx` › "the mode toggle opens on Online"
- AC2 → unit `src/main/modules/servers/scan-service.test.ts` › "an online scan never runs LAN
  discovery" and › "a LAN scan contacts no master source"; e2e `scripts/flows/servers-lan-mode.mjs` ›
  "servers-lan-mode" (list stub receives no request during the LAN scan)
- AC3 → unit `src/main/modules/servers/scan-service.test.ts` › "the LAN list holds only broadcast
  answers" and › "the online list never holds a LAN-only server"; e2e
  `scripts/flows/servers-lan-mode.mjs` › "servers-lan-mode"
- AC4 → unit `src/main/modules/servers/lan-discovery.test.ts` › "a server answering twice or on two
  interfaces is reported once"; e2e `scripts/flows/servers-lan-mode.mjs` › "servers-lan-mode"
- AC5 → e2e `scripts/flows/servers-lan-mode.mjs` › "servers-lan-mode"
- AC6 → unit `src/renderer/src/modules/servers/list-state.test.ts` › "a finished LAN scan with no
  rows is the LAN empty state"; e2e `scripts/flows/servers-lan-empty.mjs` › "servers-lan-empty"
- AC7 → unit `src/main/modules/servers/scan-service.test.ts` › "a LAN scan is refused while the game
  runs" and `src/main/modules/servers/scan-cadence.test.ts` › "switching into a never-scanned mode is
  skipped while the game runs"; e2e `scripts/flows/servers-lan-no-scan-while-playing.mjs` ›
  "servers-lan-no-scan-while-playing"
- AC8 → unit `src/main/modules/servers/scan-service.test.ts` › "switching mode keeps the other mode's
  list"; e2e `scripts/flows/servers-lan-mode.mjs` › "servers-lan-mode"
- AC9 → unit `src/main/modules/servers/lan-discovery.test.ts` › "no usable interface reports
  noInterface" and › "every socket refused reports socketRefused"; e2e
  `scripts/flows/servers-lan-unavailable.mjs` › "servers-lan-unavailable"

## Done

Online/LAN toggle in the server browser (opens on Online, never persisted). LAN discovery broadcasts `info` per interface on 27910, then the normal info+status scan runs over the answers into a separate LAN list; online and LAN lists are never mixed, switching shows each mode's last result. Favourites refresh is disabled in LAN with a visible reason; broadcast failure text sits by the toggle.

Commit: `196: online/LAN switch in the server browser — per-interface LAN discovery, two-list scan service, mode toggle, LAN states, flows`

Verification (narrow gate): `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (170 files green after fixes) and `npm run ui:flow -- <servers-lan-mode|servers-lan-empty|servers-lan-unavailable|servers-lan-no-scan-while-playing>` all green. AC → test as in `## Acceptance Tests`, every named unit test and flow ran and passed (AC1–AC9). No manual residue. Review 1 (default): PASS with findings; fixed mount ordering (reset mode to online before announcing the view), mode-aware online empty state, reverted client.ts format churn. A one-off `profiles.test.ts` red in the first run was flaky and passed alone.

Decisions:

- `ScanServiceDeps.lanDiscovery` is an injectable function (`LanDiscoveryFn`); index.ts wraps D1 and injects the `Q2L_UI_LAN_TARGETS` override per round.
- Watchlist data is online-only via `scanService.read('online')` (D-B). Unfixed, documented: a watchlist recheck (`start({scope:'server'})`) in LAN mode runs against the LAN list and stays pending.
- LAN `server` refresh only updates an address the broadcast already found (keeps AC3). The `servers.scan.error.favouritesNotInLan` key exists but no UI path shows it (button disabled, reason in `servers-lan-favourites-reason`).
- Flow "at once" checks poll up to 1.5s for render latency, with no scan started. The LAN refresh refusal in the playing flow is asserted as a disabled button; main's refusal is unit-tested.
- Story 197 must reuse: `ServersBrowseMode`/`ScanSnapshot.mode`, `scanService.read(mode?)` (rows per list), the active-mode list in `read()/readDetail()/overview()`, and the view's `mode` state in `ServersView.tsx` (filters apply to the displayed list); `list-state.ts` `deriveListState` mode argument.
- Known pre-existing reds not touched: `layering.test.ts`, flow `servers-filter-search`.

tiers: D 5 / hard 1 · review default · cycles 1 · agents 8
