---
id: 253
title: An unassigned config profile tells me it is not used
status: done # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, when a config profile is not assigned to any installation I see a clear warning, so I know
the game is not using this config yet.

User feedback 2026-10-26: if a config is not assigned to an installation, show the user a warning/hint so
it is clear the config is not being used yet.

Today the only signals are the header button "0 of N assigned", a sentence in the engine-scope box and one
on the Care tab; the profile list shows nothing, and the Home profiles tile counts an unassigned profile as
in sync.

## Acceptance Criteria

- [x] **AC1** — Opening a profile that is assigned to no installation shows a warning banner stating that no
      installation uses this config.
- [x] **AC2** — The banner has an action that opens the assignment panel.
- [x] **AC3** — In the profile list, an unassigned profile's row carries a visible "Not assigned" marker (text,
      not colour only).
- [x] **AC4** — Assigning the profile to an installation removes the banner and the marker without a reload.
- [x] **AC5** — A profile assigned to at least one installation shows neither banner nor marker.

## Open Questions

## Decisions (Sprint)

- Placement decided at the cut (the user asked for "a warning/hint so it is clear"): a warning banner in the
  profile view with a direct "Assign…" action, plus a marker on the profile's row in the list. Refine may
  adjust wording, not drop either place.
- "Unassigned" means `profile.assignments.length === 0` on the store's profile — main's `list` already
  filters assignments to live installations, so an assignment to a removed installation does not count.
- Wording: banner title "No installation uses this config", body "The game does not load it until you
  assign it to an installation.", action "Assign…"; list marker "Not assigned" — states the effect in the
  player's terms and keeps the house's ellipsis convention for an action that opens a panel.
- Banner tone is `warning` (not `danger`) and it sits below the file banners — an unassigned profile is a
  legitimate state (a config in the making), less severe than a missing or unreadable file.
- "Assign…" opens the existing header `AssignmentsMenu` popover (made controllable), not a second
  assignment panel — one assignment surface; the header's "N of M assigned" trigger stays as it is.
- The new banner and the two existing file banners share one extracted `ProfileBanner` shape —
  `ProfileFileBanners` already hand-rolls it twice, and a third copy is what the refine rule forbids.
- The banner also shows with zero installations registered; the opened panel then shows its existing
  "No installations registered yet." line — it is still true that nothing uses the config.
- The 30-visible-editor-line floor (`scripts/flows/config-header-geometry.mjs`) is measured on the assigned
  `Plain Profile` and stays untouched; an unassigned profile gives those lines up for the banner on purpose.
- The Home profiles tile ("in sync" count) and the existing engine-scope/Care sentences are out of scope —
  no AC covers them and Home is another module; a follow-up story if the user wants it.
- Opening the popover from the banner keeps today's popover focus behaviour (no focus move) — parity with
  the header trigger; no AC asks for more.

## Plan

Renderer-only, config module. No IPC, no main change — assignment state already lives on the store's
`ConfigProfile.assignments`, and every assign/unassign lands in `useConfigProfiles` via `save`.

1. Extract the icon + title + body + actions banner shape from `ProfileFileBanners.tsx` into
   `components/ProfileBanner.tsx`; both existing banners use it with no visual change.
2. New `components/UnassignedProfileBanner.tsx` (warning tone, "Assign…" action), rendered in
   `ConfigView.tsx` after `ProfileFileBanners` when the selected profile has no assignments.
3. `AssignmentsMenu` becomes controlled (`open` / `onOpenChange`); `ConfigView` owns the state and passes
   it through `ConfigDetailHeader`; the banner's action sets it true.
4. `ConfigListScreen` rows get a `Badge tone="warning"` "Not assigned" marker for unassigned profiles.
5. One e2e flow on the fixture's unassigned `Imported Profile`: marker → open → banner → Assign… →
   assign → banner and marker gone; the assigned `Plain Profile` shows neither.
6. Systems doc + changelog line.

Order: D1 → D2. Stories 254/255 may touch the assignment surfaces; this story does not edit
`ProfileAssignmentsPanel.tsx`.

## Deliverables

- [x] **D1 — Unassigned banner in the profile view with an "Assign…" action, plus its tests.**
      Files: new `src/renderer/src/modules/config/components/ProfileBanner.tsx`,
      `src/renderer/src/modules/config/components/ProfileFileBanners.tsx`, new
      `src/renderer/src/modules/config/components/UnassignedProfileBanner.tsx`,
      `src/renderer/src/modules/config/AssignmentsMenu.tsx`,
      `src/renderer/src/modules/config/components/ConfigDetailHeader.tsx`,
      `src/renderer/src/modules/config/ConfigView.tsx`, `src/renderer/src/modules/config/locale/en.json`,
      the `src/renderer/src/i18n/__snapshots__/en.bundle.json` snapshot (`vitest -u`), new
      `src/renderer/src/modules/config/components/UnassignedProfileBanner.test.tsx`, new
      `scripts/flows/config-unassigned-warning.mjs`. - `ProfileBanner({ tone: 'warning' | 'danger', title, body?, children? (actions row), testId? })`:
      the layout `ProfileFileBanners` hand-rolls twice today (`rounded-sm border border-<tone>/35 bg-<tone>/8 p-3`, `TriangleAlert` icon in the tone, title `text-sm font-medium text-<tone>`, body
      `text-xs leading-relaxed text-ink-dim`, actions in a `flex gap-2` row). Rewrite both existing
      banners (missing file, diagnostic) on it with no visual change. Tokens only, no hex. - `UnassignedProfileBanner({ profile, onAssign })`: renders nothing when
      `profile.assignments.length > 0`; otherwise a warning `ProfileBanner` with
      `data-testid="config-unassigned-banner"`, title `config.assignment.unassignedBanner.title`
      "No installation uses this config", body `config.assignment.unassignedBanner.body` "The game does
      not load it until you assign it to an installation.", and a `Button variant="neutral" size="sm"`
      with a `Link2` icon, `data-testid="config-unassigned-assign"`, label
      `config.assignment.unassignedBanner.assign` "Assign…", `onClick={onAssign}`. - `AssignmentsMenu({ open, onOpenChange })`: controlled. The trigger calls `onOpenChange(!open)`;
      Escape and an outside pointerdown call `onOpenChange(false)`. The placement is computed in a
      `useLayoutEffect` when `open` turns true (same anchor math as today, cleared when it turns false),
      so an open request from outside the header lands at the header trigger. `ConfigDetailHeader`
      takes `assignmentsOpen` / `onAssignmentsOpenChange` and forwards them. - `ConfigView`: `const [assignmentsOpen, setAssignmentsOpen] = useState(false)`, reset to false when
      the selected profile id changes; render `<UnassignedProfileBanner profile={selected} onAssign={() => setAssignmentsOpen(true)} />` directly after `ProfileFileBanners`. `selected` is
      read from the store, so an assignment removes the banner without a reload. - Component test (`@testing-library/react`, plain props, no provider): "a profile with no assignments
      shows the not-used warning", "Assign… calls onAssign", "an assigned profile renders no banner". - e2e flow `config-unassigned-warning.mjs`, shaped like `scripts/flows/engine-badge-surfaces.mjs`
      (open a profile via `config-profile-row` filtered by name; the popover is the `panel-raised`
      ancestor of an installation row; `step`/`shot` helpers as there). Steps: (1) open
      `Imported Profile` (fixture `assignments: []`, `scripts/lib/fixture/controls.mjs`) →
      `config-unassigned-banner` visible, contains "No installation uses this config"; (2) click
      `config-unassigned-assign` → the assignments popover is visible; (3) tick the first installation's
      checkbox in the popover → `config-unassigned-banner` detaches with no navigation or reload;
      (4) back to the list, open `Plain Profile` (assigned) → `config-unassigned-banner` count is 0.

- [x] **D2 — "Not assigned" marker in the profile list, flow completion, docs and changelog.**
      Files: `src/renderer/src/modules/config/components/ConfigListScreen.tsx`,
      `src/renderer/src/modules/config/locale/en.json`, the
      `src/renderer/src/i18n/__snapshots__/en.bundle.json` snapshot, new
      `src/renderer/src/modules/config/components/ConfigListScreen.test.tsx`,
      `scripts/flows/config-unassigned-warning.mjs`, `docs/systems/config-module.md`, `CHANGELOG.md`. - In each `config-profile-row`, when `profile.assignments.length === 0`, render
      `<Badge tone="warning" data-testid="config-profile-unassigned">` (`Badge` from
      `src/renderer/src/components/ui/primitives.tsx`) with `config.list.notAssigned` "Not assigned",
      between the name block and the chevron, `shrink-0`; the name keeps `truncate`. Text, never colour
      only. The list reads `useConfigProfiles`, so the marker follows the store without a reload. - Component test (seed `useConfigProfiles` the way `ConfigView.profilesStore.test.tsx` does): "an
      unassigned profile's row carries a Not assigned text marker", "an assigned profile's row has no
      marker". - Flow: extend `config-unassigned-warning.mjs` — before step 1, on the list, the `Imported Profile`
      row contains `config-profile-unassigned` with text "Not assigned" and the `Plain Profile` row does
      not; after step 3, go back to the list → the `Imported Profile` row no longer contains it. - `docs/systems/config-module.md`, Renderer section: name `ProfileBanner.tsx`,
      `UnassignedProfileBanner.tsx` and the list's "Not assigned" marker beside the assignment surfaces. - `CHANGELOG.md` under `## Unreleased` → `### Added`: "Config profiles no installation uses now say
      so, with a one-click Assign."

## Model Hints

- No `deliverable-hard`: renderer-only, store-driven, one controlled-popover change that its own flow
  step exercises.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/config-unassigned-warning.mjs` › "config-unassigned-warning" (step 1);
  component `src/renderer/src/modules/config/components/UnassignedProfileBanner.test.tsx` › "a profile with
  no assignments shows the not-used warning"
- AC2 → e2e `scripts/flows/config-unassigned-warning.mjs` › "config-unassigned-warning" (step 2);
  component `src/renderer/src/modules/config/components/UnassignedProfileBanner.test.tsx` › "Assign… calls
  onAssign"
- AC3 → e2e `scripts/flows/config-unassigned-warning.mjs` › "config-unassigned-warning" (list step);
  component `src/renderer/src/modules/config/components/ConfigListScreen.test.tsx` › "an unassigned
  profile's row carries a Not assigned text marker"
- AC4 → e2e `scripts/flows/config-unassigned-warning.mjs` › "config-unassigned-warning" (step 3 and the
  return-to-list step)
- AC5 → e2e `scripts/flows/config-unassigned-warning.mjs` › "config-unassigned-warning" (step 4 and the
  Plain Profile list check); component
  `src/renderer/src/modules/config/components/UnassignedProfileBanner.test.tsx` › "an assigned profile
  renders no banner"; component `src/renderer/src/modules/config/components/ConfigListScreen.test.tsx` ›
  "an assigned profile's row has no marker"

Coverage: AC1 D1 · AC2 D1 · AC3 D2 · AC4 D1 (banner) + D2 (marker) · AC5 D1 (banner) + D2 (marker).

## Done

**Summary.** An unassigned config profile now shows a warning `ProfileBanner` ("No installation uses this config") with an "Assign…" action that opens the header `AssignmentsMenu` (made controlled), and a "Not assigned" `Badge` on its list row. Both follow `profile.assignments` from the store, so assigning clears them without a reload. The two file banners were rebuilt on the shared `ProfileBanner` with no visual change.

**Commit message:** `253: unassigned config profile warns — banner with Assign… action + "Not assigned" list marker`

**Verification (narrow gate).** `npm run lint`, `npm run typecheck` green; `npx vitest run --changed HEAD` green (154 files, 1246 tests); `npm run build:dev` then `ui:flows -- --affected scripts/flows/config-unassigned-warning.mjs --parallel=4 --shard=1/2` green (16/16, flow ran there) and `--shard=2/2` 15/16 — red `unsaved-diff` is pre-existing (see below). Full gate not run (sprint's).

- AC1 flow step 1 + "a profile with no assignments shows the not-used warning" — passed. AC2 flow step 2 + "Assign… calls onAssign" — passed. AC3 flow list step + "an unassigned profile's row carries a Not assigned text marker" — passed. AC4 flow step 3 + return-to-list — passed. AC5 flow step 4 + Plain Profile list check + "an assigned profile renders no banner" + "an assigned profile's row has no marker" — passed. No manual residue.
- Review (default tier, 1 cycle): PASS, no blocking findings.
- Pre-existing reds, not this story: `unsaved-diff` flow (bare `locator('select')` now resolves to the footer Map select from 252; red on stashed HEAD too); `scripts/flow-select.test.mjs` (game-dir-fs.ts / map-list.ts uncovered, shell-window row 14 > 12); `comments.test.ts` (useLauncher.ts, 252); repo-hygiene CRLF (ActionBar files, requirement 260); check-docs/tech-debt (ROADMAP links to missing S34 files).

**Decisions.**

- `ProfileBanner` also takes an optional `hint` prop — the diagnostic banner has a third muted line; needed for "no visual change".
- `ConfigView` closes the assignments popover in `backToList`, otherwise reopening the same profile id would pop it open (reset effect only fires on id change).
- `scripts/flows/areas.json`: registered the flow and the two new banner paths in the `config-profiles` row; dropped `home-dashboard-arrange` from that row to stay at the 12-flow cap (still in its Home rows).
- Flow ticks the popover row's `label` (the checkbox input is visually hidden).
- Changelog line carries the file's bold `**Config**` prefix.
- Unfixed reviewer nit: `AssignmentsMenu` with a null anchor rect would be `open` but render nothing (unlikely; old code did not open) — left as is. No component test drives `AssignmentsMenu` as a controlled component; AC2's open is covered by the flow.

tiers: D 2 / hard 0 · review default · cycles 1 · agents 5
