---
id: 127
title: a server goes into my address book
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

Quake II's own multiplayer menu reads nine cvars, `adr0` through `adr8`, as its address book — a
mechanism that exists in the engine independently of this launcher and works whether or not the
launcher's own history or favourites ([[113]]) are ever consulted. A user who wants a server to show
up there, the way the game itself expects, needs a way to write one of those nine slots without
hand-editing a config file.

In this app, `adr0`–`adr8` are ordinary, non-catalogue cvars: the config module already round-trips
any cvar a profile's `.cfg` carries, catalogued or not, and an uncatalogued one like `adr0` lands in
the settings view's "Other" group today (confirmed against `CVAR_OTHER_GROUP_ID` in
`src/renderer/src/modules/config/lib/cvar-rows.ts`). Nothing about writing `adr0`–`adr8` needs new
config-module machinery — it needs a dialog that makes the write deliberate.

That deliberateness is the actual point of this story: writing directly into one of nine slots by
address is easy to get wrong (which slot? was it already in use?), so the action opens a dialog
showing every config profile (active one preselected) and the current value of all nine slots before
anything is written — an overwrite is something the user sees and chooses, not something that
happens to whatever slot 0 happened to be.

The write itself goes through the config module's own existing cvar-write path — the concept's
architecture note is explicit that "the game browser does not touch profile files itself" (§16
Config). Using that same path is also what makes the write behave like any other cvar edit: it marks
the profile dirty and leaves it exactly where the config module's own save/sync/care machinery
already expects an edited-but-unsaved profile to be, rather than inventing a second,
game-browser-owned notion of "this profile changed."

## Acceptance Criteria

- [ ] **AC1** — The "Add to address book" action (available from the list ([[118]]) and the detail
      view ([[122]]), per concept §9 item 7) opens a dialog listing every config profile, with the
      active profile preselected.
- [ ] **AC2** — The dialog shows the current value of all nine `adr0`–`adr8` slots for the selected
      profile before any write happens, so an empty vs. occupied slot is visibly distinguishable.
- [ ] **AC3** — Confirming a chosen slot writes the server's address into that profile's `adr<N>`
      cvar through the config module's existing `setCvars` write path (`CONFIG_HANDLERS.setCvars` /
      `module:invoke` under the `config` module's `module:config` namespace) — the game browser
      contract has no cvar-write handler of its own for this.
- [ ] **AC4** — After the write, the profile shows exactly the same dirty/unsaved-changes state the
      config module already shows for a manual cvar edit made in the Settings tab — no separate
      "written by the game browser" state exists.
- [ ] **AC5** — Switching the selected profile in the dialog re-reads and re-displays that profile's
      own nine slot values before a write is confirmed, rather than showing stale values from a
      previously selected profile.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 127`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 127`. -->

## Model Hints

<!-- Filled by `/refine 127`. -->

## Acceptance Tests

<!-- Filled by `/refine 127`. -->

## Done

<!-- Filled by `/build 127`. -->
