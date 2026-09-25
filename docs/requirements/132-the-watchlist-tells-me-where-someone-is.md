---
id: 132
title: the watchlist tells me where someone is
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

[[131]] can already say, for one watchlist entry, `offline` or a matched server with score and
ping. This story is where a user actually sees that list and acts on it — "watchlist ist eine
eigene liste wo der name steht" (concept §3), its own surface inside the `servers` module, one row
per entry.

Each row's actions reuse flows the module already has rather than reimplementing them: Join goes
through [[125]], Spectate through [[126]], opening the server detail through [[122]]. Editing an
entry's name or match mode, and removing it outright, round out the row's action set (GB-W4). None
of this is new machinery — the point of the watchlist is that it rides on the browser's existing
scan, detail and join paths, and this row is the last piece that turns [[131]]'s match data into
something clickable.

**No spectator/player distinction is shown anywhere on the row or in its detail link** (§6.4) — the
same protocol limitation [[122]]'s detail view already respects, restated here for consistency
rather than as a new decision. The row also states how current its information is, rendering
[[131]]'s "when this data is from" as visible text, so a user reading `offline` understands it means
"not found in the last data the launcher has", not "definitely not playing" (GB-W5b).

The whole surface is this milestone's concrete first consumer of [[130]]'s general gate: with no
valid code naming `watchlist`, none of it exists — no tab, no row, no menu entry pointing at it from
anywhere else in the app (§13.6, GB-X4, GB-W7). A code accepted through [[129]] is what makes the
tab appear at the next check of [[130]]'s mechanism; nothing about the watchlist itself has its own
separate unlock logic; it consumes [[130]]'s decision like any other gated feature would.

## Acceptance Criteria

- [ ] **AC1** — With `watchlist` unlocked via [[129]], a watchlist tab or surface exists inside the
      `servers` module.
- [ ] **AC2** — Each row shows the entry's name and either `offline` or the matched server(s) with
      score and ping, per [[131]].
- [ ] **AC3** — Each row offers Join, Spectate, open-detail, edit and remove actions, each of which
      reuses the corresponding existing flow ([[125]], [[126]], [[122]]) rather than a separate
      implementation.
- [ ] **AC4** — Nothing in a watchlist row or its detail link ever claims a player is, or is not,
      spectating.
- [ ] **AC5** — Each row states when its shown data is from (e.g. relative to the last scan that
      touched that server).
- [ ] **AC6** — With no valid `watchlist` code present, none of this — tab, rows, menu entries —
      renders anywhere in the app, per [[130]].
- [ ] **AC7** — A found entry's row offers a "re-check" action. It triggers [[131]]'s single
      `status` query to the last-seen server and shows the result: still there with updated score
      and ping, or [[131]] AC9's "left that server — run a full scan in the server browser".
- [ ] **AC8** — The watchlist tab carries [[129]]'s visible "experimental" marking.
- [ ] **AC9** — The surface lets the user add an entry (name + match mode). A refused pattern shows
      [[131]] AC7's reason at the input, and an entry [[131]] AC8 marked "too slow" shows that on
      its row.

## Open Questions

- [x] ~~**Q1 — Does a dedicated "re-check this entry" control exist?** (concept open point #16)~~
      answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Dedicated re-check control: **yes** (AC7). It only checks the last-seen server; if the
  player has moved, the row points to a full scan in the server browser. S24's measurement (a full
  two-stage pass costs seconds) settles open point #16's precondition (2026-09-25, planning).
- **D-A, the surface is a second tab inside `ServersView`** ("Server list" | "Watchlist"), local
  `useState` in the view. The concept's architecture puts list, detail and watchlist inside
  `ServersView` (GB-A1), and a module view is the module's own file, not the shell.
- **D-B, locked = the exact pre-132 `ServersView`.** The tab strip (including the "Server list" tab)
  renders only when 130's `useFeatureUnlocked('watchlist')` is true. The Watchlist tab button and the
  panel each render through `<FeatureGate feature="watchlist">`. A lone "Server list" tab would itself
  hint that something is missing (GB-X4).
- **D-C, the experimental marking comes from `FeatureGate` only** (129 D3). 132 adds no badge of its
  own. AC8 is a test that finds `experimental-badge` inside the watchlist tab.
- **D-D, no new main/IPC work.** 132 is renderer-only over 131's `watchlist.*` handlers and the
  `watchlist.changed` event. 131 already fixes the snapshot shape, and 130 already hides the handlers
  when locked.
- **D-E, Join and Spectate render 125's `JoinServerButton`** (with 126's `mode` prop) for the
  match's `ServerListRow`. The row is looked up by address in the scan snapshot's `entries`, the same
  source 131 matches against (131 D-M). If the lookup fails (a race only), the match shows no
  Join/Spectate/detail buttons, because reimplementing join for a server with no row is what AC3
  forbids.
- **D-F, open-detail reuses 122's single "open" notion.** It switches to the list tab and sets the
  view's `selectedAddress` to the match's address. 122's decision says a second open mechanism would
  drift.
- **D-G, Join/Spectate/open-detail sit on each match; re-check/edit/remove sit on the entry.** An
  entry can match several servers (131 AC4), so "which server" belongs to the match line. They are
  plain buttons rather than a menu, so they are discoverable and e2e-selectable.
- **D-H, edit is inline in the row** (name input + mode select, Save/Cancel), with 131's refusal
  `reasonKey` shown at the input. The concept describes no dialog for it (unlike the address-book
  write).
- **D-I, remove needs no confirmation.** An entry is one name string and cheap to re-add, and a
  confirm dialog would be the only one in the servers list surfaces.
- **D-J, the "when" text per state (AC5):** found → per match "seen {{rel}}" from `seenAt`; offline →
  "not found in data from {{rel}}" from the snapshot's `asOf` ("no server data yet" when `asOf` is
  null); left → "checked {{rel}}" from `checkedAt`; too-slow → the too-slow sentence, because there is
  no data to date. All of these use the existing `formatRelativeTime` (`src/renderer/src/lib/format.ts`).
  A 30 s re-render tick keeps "seen 5 seconds ago" from freezing.
- **D-K, re-check shows only on `found` entries.** While it runs, `recheck: 'pending'` shows a
  "checking…" text and the button is disabled. `no-reply` shows "the server did not answer — last
  result kept" (131 D-L). A refused start (`{ ok: false, reasonKey }`, e.g. game running) shows that
  key inline on the row.
- **D-L, snapshot state is a module-local hook `useWatchlist()`** (`watchlist.read` on mount +
  `watchlist.changed` subscription), not a `useLauncher` slice. Only the panel reads it, and the store
  mirrors shell state.
- **D-M, AC4 is proven as a negative on the match markup.** A score-0/ping-0 match renders the same
  elements and attributes as any other match. No `servers.watchlist.*` string mentions spectating,
  and the only "Spectate" text in the row is 126's action label.
- **D-N, the e2e unlock goes through 129's real path.** Phase 1 (locked) redeems a `watchlist` code
  in Settings, signed with a throwaway key via `Q2L_UI_UNLOCK_PUBLIC_KEY` (129 D4). Phase 2 restarts
  over a copy of `state.json`, because 130 decides the gate at boot. The pathological-regex timing is
  not re-run in e2e (131 AC8 owns it). The too-slow row is proven with a seeded `tooSlow: true`
  entry, the persisted verdict of 131 D-H.
- **D-O, 132 owns the CHANGELOG line** for the watchlist (131 D-O).

## Plan

Renderer-only; builds on [[131]] (handlers + `WatchlistSnapshot`), [[130]] (`FeatureGate`,
`useFeatureUnlocked`), [[129]] (badge inside the gate, unlock flow), [[122]]/[[125]]/[[126]]
(`selectedAddress`, `JoinServerButton` with `mode`). Before D1, read the `## Done` sections of 131,
130, 125 and 126 for the exact exported names — the names below are the refined plans'.

1. **D1 — client + hook:** typed wrappers over 131's five handlers + event, `useWatchlist()`.
2. **D2 — watchlist panel:** add form, one row per entry with its four states, the "when" text,
   re-check/edit/remove; en.json keys. No Join/Spectate/detail yet (props for them).
3. **D3 — gated tab in `ServersView`:** tab strip via the gate, panel mounted with
   Join/Spectate (`JoinServerButton`) and open-detail (`selectedAddress`) wired; CHANGELOG.
4. **D4 — e2e flow `servers-watchlist`:** locked → redeem → restart → unlocked, over fake UDP
   servers.

Order D1 → D2 → D3 → D4. Nothing platform-specific (no parity gap).

## Deliverables

- **D1 — Watchlist client + `useWatchlist` hook.** Files: `src/renderer/src/modules/servers/client.ts`
  (add `readWatchlist()`, `addWatchlistEntry({ name, mode })`, `updateWatchlistEntry({ id, name,
  mode })`, `removeWatchlistEntry(id)`, `recheckWatchlistEntry(id)`, `onWatchlistChanged(listener)`
  over `callModule`/`onModuleEvent` with `SERVERS_WATCHLIST_HANDLERS` / `SERVERS_EVENTS.watchlistChanged`
  from `src/shared/modules/servers.ts` — mirror `startScan`/`onScanChanged` in the same file). New
  `src/renderer/src/modules/servers/watchlist/useWatchlist.ts`: returns `{ snapshot:
  WatchlistSnapshot | null, add, update, remove, recheck }`. It reads on mount and replaces the
  snapshot on every `watchlist.changed` and on every ok add/update/remove result. It unsubscribes on
  unmount. `add`/`update` return 131's `{ ok, reasonKey }` unchanged, so the caller can render the
  reason. Test `src/renderer/src/modules/servers/watchlist/useWatchlist.test.tsx` (mock `callModule`/
  `onModuleEvent` like the existing servers client tests): "loads the snapshot and follows
  watchlist.changed", "a refused add returns its reason and keeps the snapshot".
- **D2 — Watchlist panel.** New files under `src/renderer/src/modules/servers/watchlist/`:
  - `WatchlistPanel.tsx` (`data-testid="servers-watchlist"`): the add form plus the list. It takes
    `renderMatchActions(match: WatchlistMatch) => ReactNode` as a prop (D3 fills it; the default
    renders nothing). It re-renders on a 30 s interval for the relative times.
  - `WatchlistAddForm.tsx`: labelled name `<input data-testid="servers-watchlist-add-name">`, a mode
    `Select` (`servers-watchlist-add-mode`: exact/substring/regex) and a submit button
    (`servers-watchlist-add-submit`), disabled while the name is empty. A refusal renders
    `<p role="alert" data-testid="servers-watchlist-add-error">{t(reasonKey)}</p>` next to the input,
    and success clears the input. Mirror the add form + error in `ServersSettingsSection.tsx` and the
    input styling of `MasterSourceRow.tsx`.
  - `WatchlistRow.tsx` (`servers-watchlist-row-<id>`, `data-state=<state>`): the entry name and its
    mode.
    - Per state: `offline` → `servers.watchlist.offline` plus "not found in data from {{rel}}" (or
      "no server data yet" when `asOf` is null).
    - `found` → one line per match (`servers-watchlist-match-<id>-<address>`) with the server name
      (address as fallback), the player name as matched, score, ping, "seen {{rel}}", and
      `renderMatchActions(match)`.
    - `left` → `t(reasonKey)` plus "checked {{rel}}". `too-slow` → `servers.watchlist.tooSlow` ("This
      pattern was too slow to match and is skipped — edit it to try again").
    - `recheck`: `pending` → "checking…" and the re-check button is disabled. `no-reply` → "the server
      did not answer — last result kept".
    - Entry actions: re-check (`servers-watchlist-recheck-<id>`, `found` only; a refused
      `{ ok: false, reasonKey }` renders inline in `servers-watchlist-recheck-error-<id>`), edit
      (`servers-watchlist-edit-<id>`, inline name + mode + Save/Cancel, refusal at the input in
      `servers-watchlist-edit-error-<id>`), remove (`servers-watchlist-remove-<id>`, no confirm).
    - **No text or attribute anywhere in a row claims spectating or playing.**
  - Times go through `formatRelativeTime` from `src/renderer/src/lib/format.ts`. Colours use design
    tokens only, and the state is carried by text, not colour alone.
  - `src/renderer/src/i18n/locales/en.json`: the `servers.watchlist.*` UI keys (tab label, add form,
    the states, the "when" strings, re-check/no-reply/pending, edit/remove labels). Keep 131's reason
    keys as they are.
  - Test `WatchlistPanel.test.tsx` (mock the hook or `callModule`; mirror
    `ServersSettingsSection.test.tsx`):
    - "each row shows its name and offline or every match with score and ping"
    - "each state states when its data is from"
    - "re-check shows pending, then the updated match or the left-the-server reason"
    - "a refused pattern shows its reason at the input and a too-slow entry says so on its row"
    - "edit and remove call the watchlist handlers"
    - "a score-0 ping-0 match renders like any other and nothing in a row mentions spectating"
- **D3 — Gated Watchlist tab in `ServersView`.** Files: `src/renderer/src/modules/servers/ServersView.tsx`,
  new `src/renderer/src/modules/servers/ServersTabStrip.tsx`, a new
  `src/renderer/src/modules/servers/ServersView.watchlist.test.tsx` (or the existing ServersView test),
  and `CHANGELOG.md` (`### Added`, one short line). Mirror the plain-button tab strip in
  `src/renderer/src/modules/config/ConfigView.tsx` (`config-tab-strip`, `config-tab-<id>`, no
  `role="tab"`).
  - The strip (`servers-tab-strip`, buttons `servers-tab-list` / `servers-tab-watchlist`) renders
    only when `useFeatureUnlocked('watchlist')` is true. The Watchlist button is wrapped in
    `<FeatureGate feature="watchlist">`, so the gate's experimental badge sits inline after it.
  - The watchlist tab body is `<FeatureGate feature="watchlist"><WatchlistPanel … /></FeatureGate>`.
  - Locked: the view renders exactly as before this story, with no strip, no hidden element and no
    watchlist text.
  - `renderMatchActions`: look up the `ServerListRow` for `match.address` in the scan snapshot's
    `entries` the view already holds, and render 125's `JoinServerButton` (`mode="join"` and 126's
    `mode="spectate"`) for it. Also render an open-detail button
    (`servers-watchlist-open-detail-<address>`) that sets the tab to `list` and `selectedAddress` to
    the address, so 122's `ServerDetailView` opens. No row found → render nothing. Never call
    `play`/`launch:start` directly.
  - Tests:
    - "locked, the servers view has no tab strip and no watchlist text"
    - "unlocked, the watchlist tab carries the experimental badge"
    - "a match's Join and Spectate are 125's JoinServerButton for that server's row" (`vi.mock` the
      button and assert its props)
    - "open-detail switches to the list and opens that server's detail"
- **D4 — e2e flow `servers-watchlist`.** New `scripts/flows/servers-watchlist.mjs`.
  - Mirror `scripts/flows/unlock-code.mjs` (129 D4: `setup()` returning `{ env:
    { Q2L_UI_UNLOCK_PUBLIC_KEY } }`, code signing, restart over a copy of `state.json`),
    `scripts/flows/servers-scoped-refresh.mjs` (loopback UDP `bindResponder`, `writePopulatedFixture`)
    and `scripts/flows/servers-join.mjs` / `servers-spectate.mjs` (the launch stub fixture and the
    `main.log` assertions).
  - Phase 1 (locked):
    - (AC6) Open Servers and Settings. Assert there is no `servers-tab-strip` and no
      `servers-watchlist*` testid, and that the text "Watchlist" appears nowhere in the DOM.
    - Redeem a `watchlist` code for the displayed installation id through 129's Settings panel.
  - Phase 2 (restart, unlocked):
    - Two responders serve rosters. Responder A has a player named `Rocket`.
    - Seed one extra entry with `tooSlow: true` in `servers.watchlist` in the copied `state.json`.
    - (AC1, AC8) Open Servers. `servers-tab-watchlist` is visible and contains `experimental-badge`.
    - (AC9) Add a regex `(` and assert `servers-watchlist-add-error` shows the invalid-regex text.
      Add substring `rock` and exact `Nobody`. The seeded row shows the too-slow text.
    - Refresh the scan.
    - (AC2, AC5) The `rock` row shows a match on A with score, ping and "seen …". `Nobody` shows
      offline with its "not found in data from …" text.
    - (AC4) The match text contains no /spectat/i.
    - (AC7) Change A's score and click re-check: the updated score appears. Then drop `Rocket` from
      A's roster and re-check: the row shows the left-the-server / full-scan text.
    - Edit `Nobody` → `Rocket` and see the row become found. Remove it and see the row gone.
    - (AC3) Click open-detail: `servers-detail` shows A's address. Click Join, then after the stub
      exits click Spectate. Assert `main.log`'s `+connect` lines as 125's and 126's flows do.
  - Scope assertions to per-run names, and `shot()` each phase.

## Model Hints

- D1–D4 → default. No D carries a new execution path. The gate, the matcher and the join mechanics
  are already built by 130/131/125, and 132 composes them.
- Review: → default. The plausible wrong implementation (a watchlist row that calls `play({ connect })`
  itself instead of `JoinServerButton`) is caught by D3's mocked-button props test, and the gate
  negative is caught by D3's locked test plus D4's phase 1.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-watchlist.mjs` › "servers-watchlist" (phase 2: watchlist tab
  present after redeem + restart); unit `src/renderer/src/modules/servers/ServersView.watchlist.test.tsx`
  › "unlocked, the watchlist tab carries the experimental badge" (D3)
- AC2 → e2e `scripts/flows/servers-watchlist.mjs` › "servers-watchlist" (found row with score/ping,
  offline row); unit `src/renderer/src/modules/servers/watchlist/WatchlistPanel.test.tsx` › "each row
  shows its name and offline or every match with score and ping" (D2)
- AC3 → e2e `scripts/flows/servers-watchlist.mjs` › "servers-watchlist" (open-detail, Join, Spectate,
  edit, remove from a watchlist row); unit `ServersView.watchlist.test.tsx` › "a match's Join and
  Spectate are 125's JoinServerButton for that server's row" + › "open-detail switches to the list and
  opens that server's detail" (D3); unit `WatchlistPanel.test.tsx` › "edit and remove call the
  watchlist handlers" (D2)
- AC4 → unit `WatchlistPanel.test.tsx` › "a score-0 ping-0 match renders like any other and nothing in
  a row mentions spectating" (D2); e2e `servers-watchlist` (match text has no /spectat/i)
- AC5 → unit `WatchlistPanel.test.tsx` › "each state states when its data is from" (D2); e2e
  `servers-watchlist` ("seen …" / "not found in data from …")
- AC6 → e2e `scripts/flows/servers-watchlist.mjs` › "servers-watchlist" (phase 1: no strip, no
  watchlist testid, no "Watchlist" text in Servers or Settings); unit `ServersView.watchlist.test.tsx`
  › "locked, the servers view has no tab strip and no watchlist text" (D3)
- AC7 → e2e `servers-watchlist` (re-check → updated score, then left + full-scan text); unit
  `WatchlistPanel.test.tsx` › "re-check shows pending, then the updated match or the left-the-server
  reason" (D2)
- AC8 → e2e `servers-watchlist` (`experimental-badge` inside `servers-tab-watchlist`); unit
  `ServersView.watchlist.test.tsx` › "unlocked, the watchlist tab carries the experimental badge" (D3)
- AC9 → e2e `servers-watchlist` (regex `(` refused at the input; seeded too-slow row); unit
  `WatchlistPanel.test.tsx` › "a refused pattern shows its reason at the input and a too-slow entry
  says so on its row" (D2); unit `useWatchlist.test.tsx` › "a refused add returns its reason and keeps
  the snapshot" (D1)

Coverage gate: AC1 → D3+D4 · AC2 → D2+D4 · AC3 → D2+D3+D4 · AC4 → D2+D4 · AC5 → D2+D4 · AC6 → D3+D4
· AC7 → D1+D2+D4 · AC8 → D3+D4 · AC9 → D1+D2+D4.

## Done

<!-- Filled by `/build 132`. -->
