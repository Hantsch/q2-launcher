---
id: 256
title: Server details are always shown
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, the server detail pane is always visible next to the list, so the layout does not jump and
clicking a server never makes its details disappear.

User feedback 2026-10-26: always show the game info, do not hide it when clicking the server again
(initially empty when nothing was clicked yet); a server cannot be deselected.

Today `ServersView.tsx` toggles selection on click (`current === address ? null : address`) and only
renders `ServerDetailView` when something is selected; the pane has a close button.

## Acceptance Criteria

- [ ] **AC1** — With no server selected, the Servers view shows the detail pane with an empty-state text.
- [ ] **AC2** — Clicking a server shows its details in the pane.
- [ ] **AC3** — Clicking the selected server again keeps it selected and its details shown.
- [ ] **AC4** — The detail pane has no close button.
- [ ] **AC5** — The list keeps its width whether or not a server is selected (no layout jump).
- [ ] **AC6** — The same holds in Online and LAN mode.

## Open Questions

## Decisions (Sprint)

- **(User)** The detail pane is always there; empty until the first server is chosen; a server cannot be
  deselected; clicking the selected server again keeps its details.
- `ServerDetailView` takes `address: string | null` and renders its title bar plus an empty state for
  `null`, so the empty and the filled pane share one title bar instead of a second copy of it.
- The empty-state text reuses today's hint wording ("Select a server to see who's playing and join.")
  under a new key `servers.detail.empty`, and the below-list hint `servers.list.selectedHint` is
  removed, because the same prompt twice on one screen is noise.
- Switching Online/LAN and a filter that hides the selected server still clear the selection (the pane
  falls back to its empty state), because the user rule forbids deselecting by click, while those clears
  keep "Refresh this server" off a server the user can no longer see.
- The close button is removed from `ServerDetailView` itself (AC4), so the watchlist tab's pane loses it
  too; that tab keeps its own "Server details" open/close toggle and show-on-demand layout, because the
  feedback was about the server list and the toggle still closes it.
- Below the `@4xl` container width the list and the always-present pane stack (list on top, pane under
  it) as they do today with a server open, because the user asked for the pane to always be there.
- No `deliverable-hard` and a default review: one renderer view's layout and selection rule, fully
  observable by the named unit and flow tests.

## Plan

Renderer-only change in the servers module; no IPC, no main.

1. `ServersView.tsx`: the list tab always uses the split grid (its classes no longer depend on the
   selection); the detail slot is always rendered; a row click sets the selection (no toggle). Remove
   the below-list `selectedHint` paragraph. Mode change and the filter-hides-selection effect keep
   clearing the selection.
2. `ServerDetailView.tsx`: drop `onClose` and the close `IconButton`; `address: string | null`; for
   `null` skip both read effects and render the title bar + `EmptyState` (`servers-detail-empty`). The
   watchlist tab passes its address as today, minus `onClose`.
3. Locale: add `servers.detail.empty`, remove `servers.detail.close` and `servers.list.selectedHint`;
   refresh the en bundle snapshot.
4. Unit tests (ServersView, ServerDetailView) for AC1–AC5; e2e flows `servers-detail.mjs` (Online) and
   `servers-lan-mode.mjs` (LAN) lose their close step and assert empty state, re-click and width.
5. `docs/systems/servers-module.md` one sentence on the always-present pane; CHANGELOG entry.

Order: D1 (behaviour + unit tests), then D2 (the flows D1's removed close button breaks).

## Deliverables

- **D1 — The list tab's detail pane is always present and a click never deselects.**
  Files: `src/renderer/src/modules/servers/ServersView.tsx`, `ServerDetailView.tsx`, `locale/en.json`
  (same folder), `src/renderer/src/i18n/__snapshots__/en.bundle.json` (regenerate with `npx vitest run
  -u` on the bundle test), `ServersView.test.tsx`, `ServerDetailView.test.tsx`,
  `docs/systems/servers-module.md`, `CHANGELOG.md`.
  - `ServersView`: the list tab's grid always gets the split classes (`detailSplit(true)`); the
    watchlist tab keeps `detailSplit(watchlistDetailAddress !== null)`. The list's `DETAIL_PANE` div
    renders unconditionally with `<ServerDetailView address={selectedAddress} …/>` (refresh callback
    guards `selectedAddress !== null`). `handleToggleRowSelected` becomes a plain
    `setSelectedAddress(address)`. Delete the `servers.list.selectedHint` paragraph. Give the list
    column div (the first grid slot) `data-testid="servers-list-column"`. Keep the mode-change clear
    and the filter-hides-selection effect unchanged.
  - `ServerDetailView`: remove the `onClose` prop, the `X` import and the close `IconButton`;
    `address: string | null`; both effects return early on `null`; for `null` render the existing
    title bar, then an `EmptyState` (lucide `Server` icon, `title={t('servers.detail.empty')}`) inside
    an element with `data-testid="servers-detail-empty"`. `data-testid="servers-detail"` stays on the
    section in both states. Update the watchlist tab's call site (no `onClose`).
  - Locale `servers/locale/en.json`: add `detail.empty` = "Select a server to see who's playing and
    join."; remove `detail.close` and `list.selectedHint`.
  - Tests: in `ServersView.test.tsx` replace "selecting a row opens its detail and the close button
    closes it" with the AC2 and AC3 tests named under `## Acceptance Tests`, and add the AC1 and AC5
    tests there (AC5: the grid wrapper's `className` is identical before and after a row click); in
    `ServerDetailView.test.tsx` replace "the close button calls onClose" with the AC4 test, drop the
    close-button expectation near line 118 and every `onClose` prop. Existing "a filtered-out selected
    row is deselected" stays green.
  - Systems doc `docs/systems/servers-module.md`, Renderer section: one sentence that the list tab's
    detail pane is always present (empty state until a server is chosen; a click selects, never
    deselects).
  - `CHANGELOG.md` `## Unreleased` › `### Changed`: "Server details stay on screen; clicking a server
    no longer hides them."
- **D2 — The Online and LAN flows prove the always-present pane on the real app.**
  Files: `scripts/flows/servers-detail.mjs`, `scripts/flows/servers-lan-mode.mjs`. Uses D1's test ids
  `servers-detail`, `servers-detail-empty`, `servers-list-column`, `servers-row-<address>` (carries
  `data-selected`).
  - `servers-detail.mjs`: after the scan, before the first row click, add step "AC1: the detail pane
    shows its empty state before any server is chosen" (`servers-detail` and `servers-detail-empty`
    visible) and record `servers-list-column`'s `boundingBox().width`. The existing step "clicking
    server A opens the detail pane with its header fields" stays as AC2's proof. Replace the final
    "closing the pane" step with: "AC3: clicking the selected server again keeps its details"
    (click server B's row again → its `data-selected` is `"true"` and `servers-detail-field-name`
    still reads "Fixture Server B"); "AC4: the detail pane has no close button"
    (`servers-detail-close` count is 0); "AC5: the list keeps its width with a server selected"
    (width equals the recorded one within 1px). Update the header comment's selector list and the
    closing `console.log`.
  - `servers-lan-mode.mjs`: in step "AC4: the LAN row opens the detail with Join" assert
    `servers-detail-empty` is visible before the click and drop the `servers-detail-close` click; add
    step "story 256: on LAN the pane is always shown and a re-click keeps the details" (click the LAN
    row again → `servers-detail-join` still visible, `servers-detail-close` count 0).
  - Run: `npm run ui:flow -- servers-detail` and `npm run ui:flow -- servers-lan-mode`.

## Model Hints

All Ds default tier.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-detail.mjs` › step "AC1: the detail pane shows its empty state
  before any server is chosen" (+ unit `src/renderer/src/modules/servers/ServersView.test.tsx` ›
  "with no server selected the detail pane shows its empty state")
- AC2 → e2e `scripts/flows/servers-detail.mjs` › step "clicking server A opens the detail pane with
  its header fields" (+ unit `src/renderer/src/modules/servers/ServersView.test.tsx` › "selecting a
  row shows its details in the pane")
- AC3 → e2e `scripts/flows/servers-detail.mjs` › step "AC3: clicking the selected server again keeps
  its details" (+ unit `src/renderer/src/modules/servers/ServersView.test.tsx` › "clicking the
  selected row again keeps it selected and its details shown")
- AC4 → e2e `scripts/flows/servers-detail.mjs` › step "AC4: the detail pane has no close button"
  (+ unit `src/renderer/src/modules/servers/ServerDetailView.test.tsx` › "the pane has no close
  button")
- AC5 → e2e `scripts/flows/servers-detail.mjs` › step "AC5: the list keeps its width with a server
  selected" (+ unit `src/renderer/src/modules/servers/ServersView.test.tsx` › "the list grid keeps its
  classes whether or not a server is selected")
- AC6 → e2e `scripts/flows/servers-lan-mode.mjs` › step "story 256: on LAN the pane is always shown and
  a re-click keeps the details"; Online is the `servers-detail.mjs` steps above.

## Done
