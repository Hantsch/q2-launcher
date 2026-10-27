---
id: 257
title: I join a server with double-click or Enter and move through the list with arrow keys
status: done # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, I move through the server list with the arrow keys and join with Enter or a double-click,
so joining is fast with mouse or keyboard.

User feedback 2026-10-26: double-click on a server joins it, can be disabled in the settings, default on;
with a server selected, arrow up/down selects another server, Enter joins.

Today there is no double-click and no arrow-key handling in the servers module; Enter/Space toggle
selection.

## Acceptance Criteria

- [x] **AC1** — Double-clicking a server row joins that server (same flow as the Join action).
- [x] **AC2** — The Servers settings have a "Double-click joins" switch, on by default, persisted.
- [x] **AC3** — With the switch off, double-clicking only selects the row.
- [x] **AC4** — With a server selected and the list focused, Arrow Down/Up selects the next/previous visible
      row, keeps it scrolled into view and updates the detail pane.
- [x] **AC5** — Arrow keys stop at the first and last row (no wrap).
- [x] **AC6** — Enter on the selected row joins that server, regardless of the double-click switch.
- [x] **AC7** — Arrow keys and Enter typed in a filter or search field do not move the selection or join.

## Open Questions

## Decisions (Sprint)

- **(User)** Double-click joins; a Servers setting switches it off; default on.
- **(User)** Enter always joins the selected server — the setting covers double-click only.
- The switch persists as `doubleClickJoins` in the existing `ServersScanSettings` bag (get/patch
  channels unchanged) — one boolean does not justify a second settings channel pair, and the forgiving
  parse already defaults missing keys.
- The switch sits in the Servers settings section under its own "Server list" sub-heading, not under
  "Scan" — it is not a scan knob.
- Double-click and Enter go through the same guard as the action bar's Join (`joinAction`): when Join
  is disabled (no installation, invalid address) they only select, because the action bar already
  shows the reason as visible text.
- Enter on a focused but unselected row selects it (as today); Enter on the selected row joins — AC6
  names "the selected row", and a Tab landing on a row must not start a game.
- Space keeps selecting only; it never joins — one key per meaning.
- Arrow keys and Enter are handled on the row elements (`onKeyDown`), never by a window/document
  listener — so filter, search and dialog inputs cannot trigger them (AC7) by construction.
- Arrow navigation is relative to the focused row and moves focus with the selection (roving focus),
  scrolling with `scrollIntoView({ block: 'nearest' })` — keyboard focus and selection never diverge.
- A double-click on the row's copy-address button neither selects nor joins — it is a separate control
  whose click already stops propagation.
- Built on story 256's non-toggling selection: a click (and the first click of a double-click) only
  selects, never deselects — the sprint orders 256 first for exactly this.

## Plan

Depends on story 256 (selection never clears, detail pane always shown) being built first.

1. **Setting (shared + main):** add `doubleClickJoins: boolean` (default `true`) to
   `ServersScanSettings`, its zod schema, `DEFAULT_SERVERS_STATE.scan`, the strict patch schema, and
   main's forgiving parse (`.catch(true)`), so old `state.json` files and every existing flow fixture
   (which seed `scan` without the key) keep working.
2. **Settings switch (renderer):** a `Switch` in `ServersSettingsSection.tsx` under a new "Server
   list" sub-heading, patched through the existing `patchScanSettings`.
3. **Double-click join:** `ServersView` reads `getScanSettings` on mount; one `joinIfAllowed(row)`
   helper carries `joinAction`'s guard and calls `useJoinFlow().start`; `ServerRow` gets an
   `onActivate(address)` prop fired on `onDoubleClick`, passed only while the setting is on.
4. **Keyboard:** row `onKeyDown` — Enter on the selected row → `joinIfAllowed`; Enter on an unselected
   row → select; ArrowUp/Down → neighbour in `visible`, clamped (no wrap), selected, focused, scrolled
   into view (`block: 'nearest'`), `preventDefault`.
5. Two new e2e flows plus a step in `servers-scan-settings.mjs` prove the user-facing ACs;
   `docs/systems/servers-module.md` and `CHANGELOG.md` are updated in the Ds that change behaviour.

## Deliverables

- **D1 — `doubleClickJoins` is a persisted servers setting, default on.** In
  `src/shared/modules/servers.ts` add `doubleClickJoins: boolean` to `ServersScanSettings` (doc
  comment: whether double-clicking a server row joins it), to `serversScanSettingsSchema`, to
  `DEFAULT_SERVERS_STATE.scan` (`true`) and as `z.boolean().optional()` to the strict scan-settings
  patch schema `scanPatchSettingsInputSchema` (next to `autoScanOnOpen`). In `src/main/modules/servers/persisted.ts` add it
  to `serversScanSettingsForgivingSchema` with `.catch(DEFAULT_SERVERS_STATE.scan.doubleClickJoins)`
  (mirror `autoScanOnOpen` there). Fix any existing test that asserts the exact scan-settings shape. No
  IPC channel changes. Tests in `src/main/modules/servers/persisted.test.ts`: "a scan block without
  doubleClickJoins reads as on", "a non-boolean doubleClickJoins falls back to on"; and in the test that
  already covers the scan patch schema (find it via `autoScanOnOpen` in `*.test.ts`): "the scan patch
  accepts doubleClickJoins".
- **D2 — The Servers settings show a "Double-click joins" switch.** In
  `src/renderer/src/modules/servers/ServersSettingsSection.tsx`, after the scan block, add a block with
  `SectionLabel` `module.servers.settings.list.heading` ("Server list") and a `Switch` wrapped in
  `<div data-testid="servers-list-settings-double-click-joins">`, label key
  `module.servers.settings.list.doubleClickJoins.label` ("Double-click a server to join it"), wired
  exactly like the `autoScanOnOpen` switch (`checked={scanSettings?.doubleClickJoins ?? true}`,
  `disabled={!scanSettings}`, `onChange={(doubleClickJoins) => void applyScanPatch({ doubleClickJoins })}`).
  The keys go into `src/renderer/src/i18n/locales/en.shell.json` next to the other
  `module.servers.settings.*` keys; refresh `src/renderer/src/i18n/__snapshots__/en.bundle.json`.
  Tests: `ServersSettingsSection.test.tsx` › "the double-click switch is on by default and patches
  doubleClickJoins"; extend `scripts/flows/servers-scan-settings.mjs` with a step that switches
  `servers-list-settings-double-click-joins` off, reads `state.json` for `scan.doubleClickJoins ===
  false`, and switches it back on (the flow reverts what it changes).
- **D3 — Double-clicking a row joins it while the setting is on.** In
  `src/renderer/src/modules/servers/ServersView.tsx`: read the setting with
  `useModuleQuery(getScanSettings)` (from `../../lib/useModuleQuery`; not-yet-loaded counts as on);
  extract `joinIfAllowed(row)` holding the same conditions `joinAction` disables on (address parses via
  `parseServerAddress`, an installation is active) and then calling `startJoinRef.current(row)`, and
  make `joinAction.run` use it too — one guard, not two. In `ServerRow.tsx` add an optional
  `onActivate?: (address: string) => void` prop fired from the outer div's `onDoubleClick`; the copy
  `IconButton` stops `onDoubleClick` propagation as it does `onClick`. `ServersView` passes `onActivate`
  only while `doubleClickJoins` is on, so with it off a double-click is two selecting clicks. Tests:
  `ServerRow.test.tsx` › "double-click calls onActivate with the row address", "double-click on the copy
  button does not activate"; `ServersView.test.tsx` › "double-click joins when the setting is on",
  "double-click only selects when the setting is off". New flow
  `scripts/flows/servers-double-click-join.mjs` (fixture, loopback responder and join proof — connect
  cfg plus `launching` log line — mirrored from `scripts/flows/servers-actionbar-join.mjs`; one
  no-password `baseq2` server suffices): double-click its `servers-row-<address>` → join proven; then
  Settings → switch `servers-list-settings-double-click-joins` off → back to Servers → double-click the
  row → `data-selected="true"` and no new `launching` line. Update `docs/systems/servers-module.md`
  (joining from the list: double-click, the setting) and add one line to `CHANGELOG.md` under
  `## Unreleased` covering double-click, Enter and arrow keys together.
- **D4 — Arrow keys move the selection, Enter joins.** In
  `src/renderer/src/modules/servers/ServerRow.tsx` replace the inner `role="button"`'s `onKeyDown`:
  Space → `onSelect`; Enter → `onSelect` when not selected, else `onJoin(address)`; ArrowDown/ArrowUp →
  `preventDefault()` + `onNavigate(address, 1 | -1)` (new required props). In `ServersView.tsx`:
  `onJoin` → `joinIfAllowed` (the guard D3 extracted; independent of `doubleClickJoins`); `onNavigate`
  → index of the address in `visible`, target clamped to `[0, visible.length - 1]` (no wrap, no-op at
  the ends), select it, then after the render `focus()` its row element (`servers-row-<address>`) and
  call `scrollIntoView({ block: 'nearest' })` (guarded — jsdom lacks it). No window/document key
  listener. Tests: `ServerRow.test.tsx` › "Enter on an unselected row selects it", "Enter on the selected
  row joins", "arrow keys call onNavigate"; `ServersView.test.tsx` › "ArrowDown selects the next visible
  row and shows its details", "arrow keys stop at the first and last row", "Enter in the search field
  does not join". New flow `scripts/flows/servers-keyboard-nav.mjs` (fixture from
  `servers-actionbar-join.mjs`, plus enough extra loopback responders via `makeResponderBinder` that the
  list overflows its scroll area): click the first row, ArrowDown repeatedly → `data-selected` moves
  and the detail pane shows the new server, the selected row's bounding box lies inside the list's
  scroll container; ArrowUp on the first row and ArrowDown on the last keep the selection; focus the
  filter search field, press ArrowDown and Enter → selection unchanged, no `launching` line; switch the
  setting off via `invoke` (module handler `scan.patchSettings`), then Enter on the selected row → a `launching` line
  appears. Add the keys to the same `docs/systems/servers-module.md` paragraph.

## Model Hints

No `deliverable-hard`: each D is a bounded one-layer change reusing an existing pattern (scan
settings bag, `Switch` wiring, join flow, row props).

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-double-click-join.mjs` › "servers-double-click-join" (double-click
  step); unit `ServersView.test.tsx` › "double-click joins when the setting is on" (D3)
- AC2 → e2e `scripts/flows/servers-scan-settings.mjs` › "servers-scan-settings" (double-click switch
  step); unit `ServersSettingsSection.test.tsx` › "the double-click switch is on by default and patches
  doubleClickJoins" (D2); unit `src/main/modules/servers/persisted.test.ts` › "a scan block without
  doubleClickJoins reads as on" (D1)
- AC3 → e2e `scripts/flows/servers-double-click-join.mjs` › "servers-double-click-join" (switch-off
  step); unit `ServersView.test.tsx` › "double-click only selects when the setting is off" (D3)
- AC4 → e2e `scripts/flows/servers-keyboard-nav.mjs` › "servers-keyboard-nav" (arrow + scroll step);
  unit `ServersView.test.tsx` › "ArrowDown selects the next visible row and shows its details" (D4)
- AC5 → e2e `scripts/flows/servers-keyboard-nav.mjs` › "servers-keyboard-nav" (ends step); unit
  `ServersView.test.tsx` › "arrow keys stop at the first and last row" (D4)
- AC6 → e2e `scripts/flows/servers-keyboard-nav.mjs` › "servers-keyboard-nav" (Enter with the setting
  off); unit `ServerRow.test.tsx` › "Enter on the selected row joins" (D4)
- AC7 → e2e `scripts/flows/servers-keyboard-nav.mjs` › "servers-keyboard-nav" (search-field step);
  unit `ServersView.test.tsx` › "Enter in the search field does not join" (D4)

## Done

Servers list: double-click joins (new persisted `doubleClickJoins` scan setting, default on, switch under Settings > Servers > "Server list"); Enter on the selected row joins independent of the setting; ArrowUp/Down move selection and focus through the visible rows (clamped, scrolled into view). All keys are handled on the row element.

Commit message: `257: servers list — double-click joins (setting, default on), Enter joins, arrow keys move selection`

Verification (narrow gate, run twice: before and after the review fixes): `npm run build:dev`, `npm run typecheck`, `npm run lint`, `npx vitest run --changed HEAD` (183 files / 1610 tests) and `npm run ui:flows -- --affected scripts/flows/servers-double-click-join.mjs scripts/flows/servers-keyboard-nav.mjs scripts/flows/servers-scan-settings.mjs --parallel=4 --shard=1/2` and `2/2` (23/23 flows each) all green. Full gate not run (sprint's).
AC -> test, all passed: AC1 servers-double-click-join flow + "double-click joins when the setting is on"; AC2 servers-scan-settings flow + ServersSettingsSection "the double-click switch is on by default…" + persisted "a scan block without doubleClickJoins reads as on"; AC3 servers-double-click-join (switch-off) + "double-click only selects when the setting is off"; AC4 servers-keyboard-nav + "ArrowDown selects the next visible row…"; AC5 servers-keyboard-nav + "arrow keys stop at the first and last row"; AC6 servers-keyboard-nav (Enter, setting off) + ServerRow "Enter on the selected row joins"; AC7 servers-keyboard-nav + "Enter in the search field does not join". No manual residue.
Review (clean agent, default tier): PASS with test-quality findings, all fixed in one cycle — filtered-navigation test, AC6 flow now remounts the view so the setting is really off, settings-loaded awaits in tests, blocked-join-guard test, deduplicated `renderWithInstallation`, CHANGELOG formatter churn reverted and entry shortened. Deliverable ticks do not exist in this story (D list is bullets).

Decisions:
- `joinBlockedReason(row, hasInstallation)` is one guard shared by the action bar's Join and the double-click/Enter path; with Join disabled they only select.
- Sibling tests `ServersView.actionbar.test.tsx` / `ServersView.watchlist.test.tsx` got a `getScanSettings` mock (ServersView now queries it).
- New flows registered in the `servers-join` row of `scripts/flows/areas.json` (6 of 12).
- "Server list" heading duplicates the `servers.tabs.list` value: added a justified `DUPLICATE_EXCEPTIONS` entry in `i18n/keys.test.ts` instead of changing the spec'd text.
- `scroll-mt-9` on the focusable row so the sticky list header never covers a keyboard-scrolled row; `v1..v5-full.expected.json` state fixtures carry the new default.
- Space keeps selecting only; Enter on an unselected row selects.

tiers: D 4 / hard 0 · review default · cycles 1 · agents 9
