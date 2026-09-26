---
id: 121
title: the list says what it's doing
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the Servers view ([[106]]) and the list is not just rows ([[118]]) — it has to be
honest about its own state: that a scan is running and how far it has got, that no source returned
anything at all, or that one particular source failed while the rest of the list is fine. A blank or
ambiguous list reads as broken; a list that says what it is doing does not.

This story covers those three explicit states (loading, empty, per-source error) plus the populated
list already covered by [[118]]/[[119]]/[[120]], and makes all four verifiable the way every other
screen in this app is: entries in the `ui:verify` registry, and a `ui:flow` script that exercises the
scan-to-select path against a local stub — never a real master or a real server. The data these
states describe comes from the scan engine in [[114]]; joining a selected server is out of scope here
and belongs to [[125]].

## Acceptance Criteria

- [x] **AC1** — While a scan from [[114]] is in progress, the list shows a loading state with live
      progress counts (e.g. servers found so far / servers still being queried).
- [x] **AC2** — When a completed scan returns no servers from any source, the list shows a stated
      empty state ("no source returned a server") that includes a link into source settings ([[111]]).
- [x] **AC3** — A failure on one source is shown attributed to that specific source, without hiding or
      blocking the rest of the list's results from sources that succeeded.
- [x] **AC4** — The populated, loading, empty and error list states are all present as entries in the
      `ui:verify` screen registry, and a full verification run against them holds zero axe violations
      (GB-A4).
- [x] **AC5** — A `ui:flow` script drives a scan-to-select flow (the scan → select portion of the
      concept's scan → select → join-dialog example; the join-dialog portion is [[125]]) entirely
      against a local stub fixture that serves the scan data — the script never touches a real master
      or a real game server (GB-A5).

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Decisions (Sprint)

- **No contract change: the counts come from `ServersScanState` as it is.** "Found so far" is
  `stage1Total`, the size of the address set once the sources have answered. "Still being queried"
  is `stage1Total − stage1Done`. Stage 2 adds "players: `stage2Done` of `stage2Total`". While
  `running` is true and `stage1Total` is still 0, the readout says the sources are being asked.
  Those fields are already pushed on every `scan.changed`, so AC1 needs no new main-side counter.
- **Rows stream in while a scan runs.** [[118]]'s Decisions hand per-row streaming to this story.
  A `scan.server` push triggers a coalesced `readScan()`: at most one read in flight, plus one
  trailing read if more pushes arrived meanwhile. The push carries a raw query result, not a merged
  row (ServersView's own doc comment), so re-reading the snapshot is the only correct merge. It is
  still push-driven, not polling (114 AC5).
- **The state is derived purely and decided on the unfiltered rows.** A pure `deriveListState` gives
  `loading` (running), `empty` (not running, `finishedAt !== null`, zero rows), `idle` (not
  running, never finished, zero rows) or `populated`. Source failures are a separate, stacked
  panel. The panel shows next to loading, empty or populated, because AC3 says a failure must never
  replace the rest of the list. The empty state keys off the snapshot's rows, not [[120]]'s visible
  subset. "Filters hide everything" is not "no source returned a server".
- **`idle` gets a one-line hint, not the empty state.** Before any scan has finished, "no source
  returned a server" would be a lie. A zero-row, never-scanned list therefore says it has not
  scanned yet (`servers.list.idle`) and is never blank.
- **A failure is attributed by the source's address.** `ScanSourceFailure` carries only
  `sourceId`, so the view resolves it through `listMasterSources()` to the address the user typed
  in Settings (`host:port` or URL). That is how the user recognises the source. It falls back to
  the raw `sourceId` if the source has since been deleted. The reason is `t(reasonKey)` (the
  existing `servers.source.error.*` keys), with an icon plus text, never colour alone.
- **"Link into source settings" is `setRoute(ROUTE_SETTINGS)` plus a scroll to
  `settings-section-servers`.** This is the exact pattern `UpdatePopover.tsx` `goToAbout` already
  uses. There is no settings sub-route to deep-link into, and inventing one would edit the shell,
  which CLAUDE.md forbids.
- **One shared loopback stub lib, used by the new screens and the new flow.** A new
  `scripts/lib/servers-stub.mjs` provides `dgram` game-server responders with an optional reply
  delay, plus an `http` list server whose body can be switched at runtime. Both bind to `127.0.0.1`
  only and are `unref()`'d. A source that fails deterministically is an `http-list` URL on a closed
  loopback port (connection refused → `transport-error`), which needs no server at all. Existing
  flows are not refactored onto the lib.
- **Three fixture variants for the four screens.** `servers-list-empty` has every source disabled
  and no favourites or manual servers. `servers-list` has only the loopback stub source enabled
  and hosts the populated and loading screens. `servers-list-error` has the stub source plus the
  dead loopback source. Screens in one variant share a session and last-known rows survive scans
  (114 D-K), so "empty" cannot share a variant with "populated". The error screen must also show
  rows beside the failure.
- **Loading is captured deterministically, and the screen fails if it misses.** The loading
  screen's `navigate` puts the stub responders into delayed-reply mode (below the seeded
  `timeoutMs`) and clicks refresh. It then *waits for* `servers-list-loading` with
  `data-found > 0`, so a screenshot of an idle list cannot pass as "loading". Every servers
  screen's `navigate` first waits for `data-running="false"` so registry order cannot matter.
- **One flow covers AC1/AC2/AC3/AC5 by switching the stub between rounds.** In round 1 the stub
  list serves an empty body, which is a real `empty-body` failure, so "no source returned a server"
  is literally true. The flow then checks the empty state and follows its link. In round 2 the stub
  serves the responder addresses. The flow sees the loading counts, then rows next to the dead
  source's attributed failure, and selects a row. This is cheaper than three flows with the same
  setup.

## Plan

Renderer + scripts only; no change to `src/shared` or `src/main`. Builds on the scan state from 114
and the row from [[118]]. It wraps whatever list [[119]]/[[120]] have put into `ServersView.tsx` by
the time it lands. Order: D1 → D2 → D3.

1. **D1 — the states in the view.** Add a pure `list-state.ts`, which derives the state and
   formats the progress readout. Add one `ServersListStatus.tsx` component with the loading, empty,
   idle and source-failure panels. Wire it into `ServersView.tsx` above the rows, with coalesced
   streaming re-reads on `scan.server`, source-name resolution and the settings link. Add the i18n
   keys, a CHANGELOG entry and unit/component tests.
2. **D2 — the `ui:verify` screens.** Add the loopback stub lib, three fixture variants and four
   registry entries (`servers-list-populated`, `-loading`, `-empty`, `-error`). Update the screen
   count in `docs/UI-VERIFICATION.md`. A run over the four screens must have zero axe violations.
3. **D3 — the flow.** Add `scripts/flows/servers-list-states.mjs`: empty → link → loading →
   populated plus attributed error → select, entirely on loopback.

Out of scope: the join dialog ([[125]]), the detail view ([[122]]), a "no filter match" message
([[120]]), and any change to the scan engine or its events.

## Deliverables

- [x] **D1 — the list says what it is doing (renderer).**
  - New `src/renderer/src/modules/servers/list-state.ts` (pure, no React), plus a colocated
    `list-state.test.ts`:
    - `deriveListState(state: ServersScanState, rowCount: number): 'loading' | 'empty' | 'idle' | 'populated'`:
      - `running` → `loading`
      - otherwise, `rowCount > 0` → `populated`
      - otherwise, `finishedAt !== null` → `empty`
      - else → `idle`
    - `describeScanProgress(state)` returns i18n `{ key, params }` entries:
      - `running && stage1Total === 0` → `servers.list.loading.sources` ("Asking the server lists…")
      - otherwise → `servers.list.loading.stage1` with `{ found: stage1Total, pending: stage1Total - stage1Done }`
        ("{{found}} servers found · {{pending}} still being queried")
      - plus, when `phase === 'stage2'`, `servers.list.loading.stage2` with
        `{ done: stage2Done, total: stage2Total }` ("Fetching players: {{done}} of {{total}}")
  - New `src/renderer/src/modules/servers/ServersListStatus.tsx`. Props: `listState`, `scanState`,
    `sourceLabels: Record<string, string>`, `onOpenSourceSettings`. It renders:
    - loading: `role="status"` `aria-live="polite"`, testid `servers-list-loading`, with
      `data-found`/`data-pending` attributes plus visible text from `describeScanProgress`, and a
      lucide spinner icon.
    - empty: testid `servers-list-empty`, text `servers.list.empty` ("No source returned a server"),
      and a `Button` with testid `servers-list-empty-settings` and label
      `servers.list.openSourceSettings` that calls `onOpenSourceSettings`.
    - idle: testid `servers-list-idle`, text `servers.list.idle` ("Not scanned yet. Refresh to
      scan.").
    - source failures: rendered whenever `scanState.sourceFailures.length > 0`, independent of the
      list state. The container has testid `servers-list-source-failures`. Each item has testid
      `servers-list-source-failure-<sourceId>`, an alert icon, and the visible text
      `servers.list.sourceFailed` ("{{source}}: {{reason}}"). `source` is
      `sourceLabels[id] ?? id` and `reason` is `t(reasonKey)`.
    - Semantic tokens only, and status is never colour-only (design-tokens).
  - `src/renderer/src/modules/servers/ServersView.tsx`:
    - Render `<ServersListStatus>` between the controls panel and the row list. `rowCount` is the
      unfiltered snapshot `entries.length`, not a filtered subset.
    - Subscribe to `onScanServer` (already exported from `./client`). Each push triggers a
      coalesced `readScan()` → `setEntries`, with at most one read in flight and one trailing read
      if pushes arrived during it. Keep the existing round-end re-read.
    - Resolve `sourceLabels` via `listMasterSources()` (id → address). Do it on mount, and again
      whenever `sourceFailures` contains an id that is not in the map.
    - `onOpenSourceSettings`: copy `UpdatePopover.tsx`'s `goToAbout`, i.e. `setRoute(ROUTE_SETTINGS)`
      and then two `requestAnimationFrame`s before scrolling `[data-testid="settings-section-servers"]`
      into view.
    - Update the file's doc comment.
    - Keep every existing testid.
  - `src/renderer/src/i18n/locales/en.json`: add a `servers.list.*` block with the keys above.
    Confirm the `servers.source.error.*` keys already cover every `MasterSourceFailure`.
  - `CHANGELOG.md`: one `### Added` line.
  - Files: `list-state.ts`, `list-state.test.ts`, `ServersListStatus.tsx`, `ServersListStatus.test.tsx`,
    `ServersView.tsx`, `ServersView.test.tsx` (all in `src/renderer/src/modules/servers/`), `en.json`,
    `CHANGELOG.md`.
  - Mirror: `src/renderer/src/components/shell/UpdatePopover.tsx` for the settings link, and the
    existing `ServersView.test.tsx` client mocks.
  - Tests:
    - `list-state.test.ts` › "derives loading, empty, idle and populated". This covers running with
      rows → loading, finished with zero rows → empty, never finished with zero rows → idle, and
      finished with rows → populated.
    - `list-state.test.ts` › "progress reports found and still-being-queried counts, then stage 2".
      For example `stage1Total 10, stage1Done 4` → found 10 / pending 6. It also covers
      `stage1Total 0` while running → the sources key.
    - `ServersListStatus.test.tsx` › "loading shows live counts".
    - `ServersListStatus.test.tsx` › "empty state says no source returned a server and offers the
      source-settings link" (the click calls `onOpenSourceSettings`).
    - `ServersListStatus.test.tsx` › "a failed source is named by its address with its reason".
      This asserts the address text, not the id.
    - `ServersView.test.tsx` › "a source failure is shown beside the rows from the other sources",
      where the snapshot has 2 rows and 1 failure, and both render.
    - `ServersView.test.tsx` › "a scan.server push refreshes the rows while the scan runs".
  - Acceptance: `npx vitest run src/renderer/src/modules/servers` passes and `npm run typecheck`
    is clean.

- [x] **D2 — the four list states in the `ui:verify` registry.**
  - New `scripts/lib/servers-stub.mjs` (Node only):
    - `startServerResponders(specs)`: each spec is `{ port, hostname, players, map }`. It binds
      `node:dgram` on `127.0.0.1:<port>` and answers `info`/`status` queries, with the bytes copied
      from `bindResponder` in `scripts/flows/servers-scoped-refresh.mjs`. It returns
      `{ setDelayMs(ms), close() }`.
    - `startListServer(port)`: an `http` server on `127.0.0.1` answering `?raw=1` text with the
      current address list. Mirror the format in `src/main/modules/servers/http-list-source.ts` and
      its test. It returns `{ setAddresses(list), close() }`, and an empty list means an empty body.
    - Every socket and server is `unref()`'d. Both functions are idempotent per port, so repeated
      `navigate` calls reuse the running stub.
    - Export the fixed ports and addresses as constants: 3 responder ports, 1 list port, and a
      `SERVERS_DEAD_LIST_URL` on a port nothing binds.
  - `scripts/lib/fixture.mjs`: add three variants modelled on the existing `servers-scan` branch
    (`writePopulatedFixture({ variant, stateOverrides: { servers } })`). All three keep
    `SERVERS_DISABLED_SOURCES`, so every shipped source is present but disabled. In every variant
    the scan autos are off and `timeoutMs`/`retries` are seeded short. Each variant then adds:
    - `servers-list-empty`: nothing else, so there are no favourites and no manual servers.
    - `servers-list`: the enabled stub `http-list` source `http://127.0.0.1:<listPort>/?raw=1`.
    - `servers-list-error`: that stub source plus an enabled `SERVERS_DEAD_LIST_URL` source.
  - `scripts/lib/screens.mjs`: add four entries, all with `BOTH_VIEWPORTS`. Every `navigate`
    starts the stubs it needs, clicks `nav-servers`, waits for `servers-scan-status`
    `data-running="false"`, and only then acts:
    - `servers-list-empty` (`servers-list-empty` variant): click `servers-refresh`, then wait for
      `servers-list-empty`.
    - `servers-list-populated` (`servers-list` variant): set the stub addresses to the 3 responders
      with delay 0, click refresh, then wait for idle and for a `servers-row-*` row.
    - `servers-list-loading` (`servers-list` variant): set the responder delay to about 80% of the
      seeded `timeoutMs`, click refresh, then wait for `servers-list-loading` with `data-found`
      greater than 0. The screenshot must be taken mid-scan, and the screen fails if loading never
      appears.
    - `servers-list-error` (`servers-list-error` variant): refresh, then wait for both
      `servers-list-source-failures` and a `servers-row-*` row.
    - Add the new testids to the header comment block.
  - `docs/UI-VERIFICATION.md`: update the registry screen count and add the four ids.
  - Files: `scripts/lib/servers-stub.mjs`, `scripts/lib/fixture.mjs`, `scripts/lib/screens.mjs`,
    `docs/UI-VERIFICATION.md`.
  - Mirror: the `servers-scan` variant in `fixture.mjs`, the `bindResponder` in
    `servers-scoped-refresh.mjs`, and `screens.mjs`'s `home-hero` entry (wait on a testid before the
    shot).
  - Acceptance: `npm run ui:verify -- --screens=servers-list-populated,servers-list-loading,servers-list-empty,servers-list-error`
    passes with 0 axe violations. Its PNGs visibly show the four states, with a spinner and counts
    on loading and a failure line plus rows on error. The full `npm run ui:verify` is still at 0
    violations.

- [x] **D3 — scan-to-select flow on a local stub.**
  - New `scripts/flows/servers-list-states.mjs` (flow name `servers-list-states`).
  - Setup: seed its own state with `writePopulatedFixture`, following the pattern in
    `servers-scoped-refresh.mjs`. The state is `SERVERS_DISABLED_SOURCES`, plus the stub list source
    and the dead source from `scripts/lib/servers-stub.mjs`, both enabled. There are no favourites,
    no manual servers and the autos are off. The flow starts the stubs by importing them from that
    lib.
  - Guard, before launch: assert that every *enabled* source and every responder in the seeded state
    is on `127.0.0.1` (GB-A5).
  - Steps:
    1. Round 1: the stub list serves an empty body. Open Servers and click refresh. Wait for
       `servers-list-empty`, then assert that `servers-list-source-failure-<deadId>` is visible and
       contains the dead URL (AC2/AC3).
    2. Click `servers-list-empty-settings`, then assert that `settings-section-servers` is visible
       in the viewport (AC2's link).
    3. Round 2: go back with `nav-servers`. Set the stub addresses to 2 responders with about 1500ms
       reply delay (below the seeded timeout), then click refresh. Assert that `servers-list-loading`
       is visible with `data-found="2"`, and that its text shows the counts (AC1).
    4. Wait for `data-running="false"`. Assert that both `servers-row-<addr>` rows are present and
       that the dead source's failure line is still shown next to them (AC3).
    5. Click one row and assert `data-selected="true"` (AC5's select).
  - Take one screenshot per phase.
  - Close the stubs in `finally`.
  - Files: `scripts/flows/servers-list-states.mjs`.
  - Mirror: `scripts/flows/servers-scoped-refresh.mjs` (the setup, and `waitForFinishedAtChange`).
  - Acceptance: `npm run ui:flow -- servers-list-states` passes.

## Model Hints

- D1, D2, D3 → default tier. D1 is one pure helper, one presentational component and bounded
  view wiring, with the coalesced re-read pinned by a named test. D2's one determinism risk, a
  loading shot of an idle list, is closed by the screen's own `waitFor` on
  `servers-list-loading[data-found>0]`, which is spelled out in the D. D3 follows an existing flow
  step for step.
- Review: → default. The plausible wrong implementation is a loading screen that never waits for
  the loading panel. It passes axe on an idle list, so a default reviewer checking D2's
  `navigate` against the D's explicit "must wait for `servers-list-loading` with `data-found > 0`"
  line catches it. Attribution-by-id-instead-of-address is caught by the D1 and D3 assertions on
  the address text.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-list-states.mjs` › flow "servers-list-states" (round 2:
  `servers-list-loading` is visible with `data-found="2"` and count text while replies are
  delayed). Also unit `src/renderer/src/modules/servers/list-state.test.ts` › "progress reports
  found and still-being-queried counts, then stage 2", plus `ServersListStatus.test.tsx` › "loading
  shows live counts" and `ServersView.test.tsx` › "a scan.server push refreshes the rows while the
  scan runs" (D1, D3).
- AC2 → e2e `scripts/flows/servers-list-states.mjs` › flow "servers-list-states" (round 1:
  `servers-list-empty` is shown after a completed zero-row scan, and its link lands on a visible
  `settings-section-servers`). Also unit `list-state.test.ts` › "derives loading, empty, idle and
  populated", plus `ServersListStatus.test.tsx` › "empty state says no source returned a server and
  offers the source-settings link" (D1, D3).
- AC3 → e2e `scripts/flows/servers-list-states.mjs` › flow "servers-list-states" (the dead source's
  failure line names its URL, and in round 2 it stands next to both rows from the stub source). Also
  unit `ServersListStatus.test.tsx` › "a failed source is named by its address with its reason" and
  `ServersView.test.tsx` › "a source failure is shown beside the rows from the other sources" (D1,
  D3).
- AC4 → e2e `npm run ui:verify -- --screens=servers-list-populated,servers-list-loading,servers-list-empty,servers-list-error`
  (the four registry entries, 0 axe violations), plus the full `npm run ui:verify` at 0 violations
  in the sprint gate (D2).
- AC5 → e2e `scripts/flows/servers-list-states.mjs` › flow "servers-list-states" (it covers scan →
  select, with the pre-launch guard asserting that every enabled source and responder is on
  `127.0.0.1`, and only the flow's own loopback stubs are started) (D3).

No `manual residue`.

Coverage gate: AC1 → D1+D3, AC2 → D1+D3, AC3 → D1+D3, AC4 → D2, AC5 → D3. Every AC has a D and a
named test.

## Done

Implemented the pure `list-state.ts` derivation/progress formatter, the `ServersListStatus.tsx`
loading/empty/idle/source-failure panels wired into `ServersView.tsx` with coalesced
`scan.server` re-reads and the settings-link navigation (mirroring `UpdatePopover.tsx`), plus the
new `servers.list.*` i18n keys. Added a loopback stub lib (`scripts/lib/servers-stub.mjs`), three
fixture variants and four `ui:verify` registry entries for the four list states, and a
`servers-list-states` `ui:flow` covering the scan→select path (empty → settings link → loading →
populated-with-attributed-error → select) entirely on `127.0.0.1` stubs.

Commit message: `121: the list says what it's doing`

Verification — narrow gate: `npm run build` green, `npm run typecheck` green, `npx vitest run
--changed HEAD` green (72 files / 557 tests), `npm run ui:flow -- servers-list-states` green,
`npm run ui:verify -- --screens=servers-list-populated,servers-list-loading,servers-list-empty,servers-list-error`
green with 0 axe violations across all 8 shots (4 screens × 2 viewports). AC → test mapping
verified: AC1 (flow round 2 loading counts + `list-state.test.ts`/`ServersListStatus.test.tsx`/
`ServersView.test.tsx` unit cases), AC2 (flow round 1 empty state + settings-link navigation +
their unit cases), AC3 (flow's dead-source failure named by URL alongside live rows + their unit
cases), AC4 (the four-screen `ui:verify` run above), AC5 (flow's loopback-only guard and
scan→select steps) — all present and passing. No `manual residue`.

Review: default-tier clean agent, verdict PASS. One confirmed finding fixed: the
`ServersView.test.tsx` "a scan.server push refreshes the rows..." test only asserted the
coalesced `readScan` call count, not that a new row actually rendered — tightened to assert a new
row appears via `findByTestId` after the coalesced read resolves; re-verified (typecheck +
`vitest run --changed HEAD`) green. No other findings.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 8
