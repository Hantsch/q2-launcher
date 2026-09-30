---
id: 181
title: I join the selected server from the action bar
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

On the Servers tab the action bar button should do what the tab is about: **Join** the selected
server. With no server selected it is disabled. It runs the same join flow the server detail's Join
button runs today ([[125]]): address check, mod-mismatch warning with "join anyway", password
prompt, then launch with `+connect`.

Uses the seam from [[180]].

## Acceptance Criteria

- [ ] **AC1** — On the Servers tab with no server selected, the action bar button reads "Join" and
      is disabled.
- [ ] **AC2** — With a server selected, the button reads "Join" and is enabled; pressing it launches
      the game connected to that server.
- [ ] **AC3** — Joining from the action bar runs the full join flow: a mod mismatch shows the same
      warning with "join anyway", a password-protected server asks for the password first.
- [ ] **AC4** — The installation-level states still win (missing, broken, installing, write-locked,
      running), as in [[180]] AC6.
- [ ] **AC5** — Leaving the Servers tab turns the button back into "Play".

## Open Questions

- ~~Q1: The server detail pane has its own prominent Join (`JoinServerButton prominent`). Remove it
  now that the action bar joins (recommended: one primary join, same reasoning as [[180]] AC7), or
  keep both? The watchlist's dense per-row Join buttons stay either way.~~ answered → Decisions (Sprint)
- ~~Q2: Spectate — does the action bar offer it (split button / secondary), or does spectating stay
  in the detail pane only? Recommendation: stay in the detail pane.~~ answered → Decisions (Sprint)
- ~~Q3: With a server selected but no active installation, the reason `servers.join.noInstallation`
  shows where — the same readout slot as [[180]]'s Q2?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Detail pane Join: keep BOTH, the server detail pane's prominent Join stays alongside the action bar's
- **(User)** Spectate: stays in the detail pane only
- **(User)** servers.join.noInstallation: shows in the same readout slot as 180's
- **"Selected server" = the server open in the visible sub-tab's detail pane** — `selectedAddress`
  on the list tab, `watchlistDetailAddress` on the watchlist tab; the watchlist tab with no detail
  open counts as "no server selected". Reason: the detail pane is the only visible notion of
  "selected" on either sub-tab, and the two addresses are already kept separate (story 132).
- **The action bar joins with the list row (`entries.find(address)`), not the detail pane's fetched
  row** — reason: it is the same row the watchlist's per-row Join already uses, and ServersView owns
  it while the detail row is private state of `ServerDetailView`.
- **One join flow, extracted into a hook (`useJoinFlow`) that both `JoinServerButton` and the
  action-bar contribution use** — reason: AC3 demands "the same" flow, and two copies of the
  mismatch/password sequence would drift.
- **The join dialogs are hosted by `ServersView`** (mounted exactly while the Servers tab is open)
  — reason: the action bar is shell and must not import servers UI; the seam only carries label,
  state, reason and the press callback.
- **An unparseable address disables the action bar Join and shows the address-rejection reason in
  the readout slot** (pre-checked, not on click) — reason: the action bar has no inline error slot
  next to the button, and CLAUDE.md wants a disabled control to carry its reason as visible text.
- **No server selected shows no reason text**, only the disabled "Join" — reason: mirrors [[180]]
  AC2 (disabled "View" with nothing selected), and the empty detail pane already says what to do.
- **No active installation on the Servers tab: the button reads "Join" (disabled) and, with a server
  selected, the readout slot shows `servers.join.noInstallation`** — reason: AC4 does not list
  "no installation" among the winning states, and a "Play" label beside a join-specific reason
  would contradict itself; if [[180]]'s seam does not consult the contribution without an
  installation, D2 extends `resolvePrimaryAction` for exactly that case (forced disabled).
- **Label key is the existing `servers.join.action`** — reason: same word as the detail pane's and
  watchlist's Join, no new string needed.

## Plan

Depends on [[180]]'s seam (a module view contributes `{ label, disabled, reason, onPress }` for the
action bar while mounted; shell keeps installation-level states). Read 180's `## Done` / the
seam's code before starting — the names below follow whatever 180 shipped.

1. **D1 — extract the flow.** Move `JoinServerButton`'s state + two modals into
   `join/useJoinFlow.tsx` (`start(row)`, `addressError`, `dialogs`). `JoinServerButton` becomes a
   thin consumer, behaviour unchanged (existing tests stay green untouched).
2. **D2 — Servers contributes Join.** `ServersView` resolves the selected row for the active
   sub-tab, calls `useJoinFlow()` once, renders its `dialogs`, and publishes the contribution via
   180's seam: label `servers.join.action`; disabled with no row; disabled + reason for an invalid
   address or no active installation; `onPress` → `start(row)`. Unmount clears it (AC5 comes from
   the seam). The detail pane's prominent Join and Spectate stay (User decisions). Unit tests +
   one new ui:flow + CHANGELOG entry.

Files: `src/renderer/src/modules/servers/join/{useJoinFlow.tsx,JoinServerButton.tsx}`,
`src/renderer/src/modules/servers/ServersView.tsx`, possibly
`src/renderer/src/components/shell/ActionBar.tsx` (no-installation case only), tests,
`scripts/flows/servers-actionbar-join.mjs`, `CHANGELOG.md`. Renderer only — no IPC, no main.

## Deliverables

- **D1 — `useJoinFlow` hook, `JoinServerButton` on top of it (no behaviour change).**
  Create `src/renderer/src/modules/servers/join/useJoinFlow.tsx` exporting
  `useJoinFlow(): { start(row: ServerListRow): void; addressError: string | null; dialogs: ReactNode }`.
  Move into it, verbatim in behaviour, everything stateful from
  `src/renderer/src/modules/servers/join/JoinServerButton.tsx`: address check
  (`parseServerAddress`/`serverAddressRejectionKey`), mod mismatch (`modMismatch` from
  `join-flow.ts`, only when an active installation exists), password prompt (`needsJoinPassword`,
  `parseUserinfoValue`), and the final `useLauncher.getState().play(undefined, { connect, userinfo })`.
  The row must be taken as a `start()` argument and kept in state for the pending steps (not closed
  over from a render), so a later caller can pass any row. `dialogs` is the mismatch `Modal` + the
  password `Modal` with all existing `data-testid`s unchanged (`servers-join-mismatch`,
  `-mismatch-confirm`, `-mismatch-cancel`, `servers-join-password`, `-password-submit`,
  `-password-cancel`). `JoinServerButton` keeps its props (`row`, `prominent`), its button,
  `servers-join-no-installation` text and `servers-join-refused` error, and renders `dialogs`.
  Tests: `src/renderer/src/modules/servers/join/JoinServerButton.test.tsx` must pass **unchanged**;
  add `src/renderer/src/modules/servers/join/useJoinFlow.test.tsx` (mirror the mocking in
  `JoinServerButton.test.tsx`) with "start() with a mismatching, password-protected row asks both
  before play()" and "start() uses the row it was given, not an earlier one".

- **D2 — Servers tab contributes "Join" to the action bar.** In
  `src/renderer/src/modules/servers/ServersView.tsx`: derive the selected row —
  `activeTab === 'watchlist'` → `watchlistDetailAddress`, else `selectedAddress`; row =
  `entries.find(e => e.address === address)` (the existing `resolveServer`). Call `useJoinFlow()`
  once and render its `dialogs` in the view. Publish the primary-action contribution through
  [[180]]'s seam (use its hook/API exactly as shipped): label key `servers.join.action`;
  disabled with no row (no reason text); disabled with reason
  `serverAddressRejectionKey(...)` if `parseServerAddress(row.address)` fails; disabled with reason
  `servers.join.noInstallation` when `useActiveInstallation()` is null and a row exists;
  otherwise enabled, `onPress` → `start(row)`. The contribution must update when the selection,
  sub-tab or installation changes and disappear on unmount (leaving Servers → "Play").
  Installation-level states (missing/broken/installing/write-locked/running) must keep winning —
  that is the seam's job; do not re-implement them here. If the seam ignores contributions when
  there is no installation, extend `resolvePrimaryAction` in
  `src/renderer/src/components/shell/ActionBar.tsx` so that with no installation a present
  contribution supplies label + readout reason while the button stays disabled. Do **not** remove
  `ServerDetailHeader`'s prominent `JoinServerButton` or any Spectate control.
  Tests (all in this D):
  - unit `src/renderer/src/modules/servers/ServersView.actionbar.test.tsx` (mirror the setup of
    `ServersView.watchlist.test.tsx`): "no selection contributes a disabled Join",
    "a selected server contributes an enabled Join that starts the join flow for that row",
    "the watchlist tab contributes the detail pane's server, not the list selection",
    "no active installation contributes a disabled Join with the noInstallation reason".
  - unit `src/renderer/src/components/shell/ActionBar.test.tsx`: "installation states win over the
    Servers Join contribution" (missing → Locate, broken → Repair, job → Install, write lock,
    running), "no installation shows the contribution's label disabled with its reason in the
    readout".
  - e2e `scripts/flows/servers-actionbar-join.mjs` (mirror `scripts/flows/servers-join.mjs`: same
    two loopback responders B = baseq2/no password, A = ctf/needpass; fixture
    `writeJoinFixture({ servers, variant: 'servers-actionbar-join' })`; `export const variant =
    'servers-actionbar-join'`). Steps: open `nav-servers`, refresh; assert `actionbar-play` reads
    "Join" and is disabled; select B → enabled, press → newest `launching` line in `main.log` has
    `+connect <B>`; select B then A, press `actionbar-play` → `servers-join-mismatch` appears,
    confirm → `servers-join-password`, submit `hunter2 x` → newest line ends
    `+exec q2launcher-connect.cfg +connect <A>` and `hunter2` appears nowhere in the log; click
    `nav-home` → `actionbar-play` reads "Play".
  - `CHANGELOG.md` `### Added`: one short line — Join the selected server straight from the big
    button.

## Model Hints

- D1 → default
- D2 → default
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-actionbar-join.mjs` › step "no server selected: Join is
  disabled"; unit `src/renderer/src/modules/servers/ServersView.actionbar.test.tsx` › "no selection
  contributes a disabled Join"
- AC2 → e2e `scripts/flows/servers-actionbar-join.mjs` › step "Join from the action bar connects to
  the selected server"; unit `ServersView.actionbar.test.tsx` › "a selected server contributes an
  enabled Join that starts the join flow for that row" and › "the watchlist tab contributes the
  detail pane's server, not the list selection"
- AC3 → e2e `scripts/flows/servers-actionbar-join.mjs` › step "mismatch then password then join,
  password never logged"; unit `src/renderer/src/modules/servers/join/useJoinFlow.test.tsx` ›
  "start() with a mismatching, password-protected row asks both before play()" and › "start() uses
  the row it was given, not an earlier one"; unchanged `JoinServerButton.test.tsx` proves the
  detail/watchlist Join still runs the same flow
- AC4 → unit `src/renderer/src/components/shell/ActionBar.test.tsx` › "installation states win over
  the Servers Join contribution" (state rendering, not a user action — seeding a broken/installing
  installation into the Servers e2e fixture adds nothing the unit case does not prove)
- AC5 → e2e `scripts/flows/servers-actionbar-join.mjs` › step "leaving Servers turns the button
  back into Play"
- Decision "no installation" → unit `ServersView.actionbar.test.tsx` › "no active installation
  contributes a disabled Join with the noInstallation reason" and `ActionBar.test.tsx` › "no
  installation shows the contribution's label disabled with its reason in the readout"

Run target: `npm run ui:flow -- servers-actionbar-join`

## Done
