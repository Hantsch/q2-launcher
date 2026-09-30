---
id: 167
title: demo actions are bindable in my profile
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

In fullscreen the engine covers the launcher, and the timeline ([[165]]) is out of reach. So the same
actions — pause, jump back/forward, speed up/down — are **bindable commands in the config profile's
Controls tab**, and work in-game because they are engine commands (concept
`docs/concepts/demo-browser.md` §3, §12.2, DEMO-28). The user binds them there; **the launcher never
rebinds keys on its own** — visible and permanent instead of silently changed. Q2PRO's
`scr_demobar` shows the position in-game.

They become entries in the config module's action catalog (`src/shared/config/action-catalog.ts`),
with i18n labels like every other action. What a demo action means in an **r1q2 profile**, where
seek does not exist, is concept open point §17.10.

## Acceptance Criteria

- [x] **AC1** — The Controls tab offers the demo actions (at least pause, jump back, jump forward,
      speed up, speed down) as bindable actions in their own category.
- [x] **AC2** — Binding one writes the corresponding engine command into the profile like every
      other bind, and a unit test pins each action's command text.
- [x] **AC3** — Relative speed steps work in-game with the same steps the timeline uses ([[165]]
      Q1).
- [x] **AC4** — No launcher code writes a demo bind into a profile without the user binding it.
- [x] **AC5** — In an r1q2 profile, seek-based actions follow the rule decided in Q1, and if shown
      disabled, they carry the reason as visible text.
- [x] **AC6** — Labels and descriptions are i18n keys (`config.actionCatalog.*`), with the literal
      ASCII `label` the config writer needs.

## Open Questions

- [ ] ~~**Q1 — r1q2 profiles** (§17.10): hide seek actions, or show them disabled with "Seeking needs~~ answered → Decisions (Sprint)
      Q2PRO"?
- [x] ~~**Q2 — `scr_demobar`** — should the profile's Settings tab expose it (and `cl_demosnaps`) as~~
      ~~cvars, or is that left to the console field ([[166]])?~~ answered → Decisions (Sprint)
- [x] ~~**Q3 — Only during demos** — demo binds do nothing in a live game; is that acceptable, or~~
      ~~should they be marked "demo playback only" in the Controls tab?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** r1q2 profiles: Seek actions are shown disabled with the visible reason "Seeking needs Q2PRO" (i18n key), not hidden.
- **(User, sprint-level)** Playback goes through Q2PRO only for now; no r1q2 playback support.
- **Q2 — `scr_demobar`/`cl_demosnaps` are not exposed in the Settings tab by this story** — Q2PRO's
  defaults (`scr_demobar 1`, `cl_demosnaps 10`) already give the in-game position bar and backward
  seek, so a cvar row adds nothing the AC needs; the console field ([[166]]) covers ad-hoc changes and
  a Settings row can be a later story.
- **Q3 — Demo binds are acceptable outside demos and are marked by their category, not per row** —
  outside a demo they are harmless (`seek` answers "Not playing a demo.", `timescale` is
  cheat-locked online), so the seeded category is named "Demo playback" and every action's
  description says it only works while a demo plays; no extra per-row badge.
- **Own category = a new template category `demo`** ("Demo playback"), seeded by `STANDARD_TEMPLATE`
  and by a new state migration for existing profiles, with every demo action **unbound**
  (`commands: []`, no key) — categories and rows are profile data since story 052, so this is the only
  way the actions appear, and seeding them unbound keeps AC4.
- **"r1q2 profile" = the profile's assigned engines (`engine-scope.ts#assignedEngineKinds`) are
  non-empty and none is `q2pro`** — an unassigned or mixed profile keeps the actions enabled, because
  they work on the Q2PRO installation it may be launched on.
- **Speed up/down read the live `timescale`** via Q2PRO's `if` (`if $timescale == 2 then timescale 4;
  …`), not an alias state machine — only that stays in step with a speed the timeline ([[165]]) set.
  Consequence: speed actions are Q2PRO-only as well and, in an r1q2 profile, get the same treatment
  as seek (disabled, visible reason "Speed steps need Q2PRO"); pause stays enabled everywhere (plain
  `pause`). This extends the user's seek rule to the other Q2PRO-only command rather than inventing a
  new one.
- **Step values are imported, never copied**: jump and speed steps come from the shared step constants
  [[165]] defines (Q1 there; placeholders ±10 s / ±60 s, 0.25×–4×). One jump pair per jump size there.

## Plan

Build after [[165]] (its shared step constants are an input). Four deliverables, shared → main →
renderer:

1. **Catalog (D1, shared):** new `ActionCategoryId` `'demo'`, a `DEMO_ACTIONS` list
   (pause, jump back/forward per jump size), a `'demo'` `CatalogRowKind` appended **last** in
   `allCatalogRows()` (bind adoption's first-match order stays as is), `demo` added to
   `TEMPLATE_ACTION_CATEGORIES` so `STANDARD_TEMPLATE` seeds it unbound, labels in `comment-labels.ts`,
   English strings in `en.json`.
2. **Speed steps (D2, shared, hard):** `demo-speed.ts` builds the speed-up/speed-down command text as
   a Q2PRO `if` chain over the timeline's speed steps (up = descending checks, down = ascending, so a
   step never cascades), added to `DEMO_ACTIONS`; a small command-buffer simulation test proves one
   step per press and clamping at both ends; round-trip through the writer and read-back.
3. **Migration (D3, main):** next `STATE_SCHEMA_VERSION` step adds the `demo` category and unbound
   demo rows to existing profiles, only if absent — never re-adds the other template categories.
4. **Controls tab (D4, renderer):** demo rows render with their labels; in an r1q2 profile the seek and
   speed rows are disabled with the reason as visible text; e2e flow binds a jump action and checks the
   written file, then checks the r1q2 disabled state.

Nothing auto-binds: template, migration and render only ever produce `commands: []`/no key for demo
rows (unbound rows are written as the existing `//bind "…"` placeholder comment, never a `bind`).

## Deliverables

- [x] **D1 — demo actions in the catalog (shared).** Add `'demo'` to `ActionCategoryId` and a
  `DEMO_ACTIONS: Action[]` list in `src/shared/config/action-catalog.ts`: `pause` (`pause`),
  `jumpBack`/`jumpForward` (`seek -<s>` / `seek +<s>` with the short jump step) and, if the step
  constants define a long jump, `jumpBackLong`/`jumpForwardLong`. Jump seconds come from the shared
  step constants story 165 created (check 165's `## Done`; expected `src/shared/demos/playback-steps.ts`)
  — import them, never copy numbers; if 165 left none, create that file with 165's values and make
  165's timeline import it. Each entry: `labelKey: 'config.actionCatalog.demo<Name>.label'`,
  `descriptionKey` (text ends "Only works while a demo is playing."), plain-ASCII `label` identical to
  the en.json string. Add a `'demo'` kind + `buildDemoRows()` to `src/shared/config/catalog-rows.ts`
  (mirror `buildWeaponRows`), appended **last** in `allCatalogRows()`. Add
  `{ id: 'demo', labelKey: 'config.controls.categories.demo', label: 'Demo playback' }` to
  `TEMPLATE_ACTION_CATEGORIES` in `src/shared/modules/config.ts` (STANDARD_TEMPLATE then seeds the rows
  unbound via `buildTemplateActions`; do **not** add anything to `STANDARD_TEMPLATE.binds`). Register
  the list in `src/shared/config/comment-labels.ts` and wherever `alias-import.ts`'s `CategoryKey`
  union/`templateCategory` enumerates categories. Strings in `src/renderer/src/i18n/locales/en.json`
  (`config.actionCatalog.*`, `config.controls.categories.demo`). Tests: in
  `src/shared/config/action-catalog.test.ts` › "each demo action's command text is pinned" (literal
  expected strings per id) and › "demo labels are config.actionCatalog keys with an ASCII label";
  `comment-labels.test.ts` already pins label vs en.json — extend its list; in
  `src/shared/config/render.test.ts` › "the template
  seeds the demo category unbound and binds no demo command". Leave speed up/down to D2.

- [x] **D2 — speed up/down step through the timeline's speeds (shared).** New
  `src/shared/config/demo-speed.ts` exporting `speedUpCommand(steps)` / `speedDownCommand(steps)` over
  the speed steps from the shared step constants (see D1; e.g. `[0.25, 0.5, 1, 2, 4]`). Command text is
  a Q2PRO `if` chain in one bind body: speed up checks steps **descending**
  (`if $timescale == 2 then timescale 4; if $timescale == 1 then timescale 2; …`), speed down
  **ascending** — so a set value is never re-matched by a later check in the same press; at the top/bottom
  step nothing matches (clamp). Before writing it, verify against q2pro source (master, matching pinned
  build r3834): `Cmd_If_f`'s numeric `==` and `then` argument joining, and that `$` inside a quoted
  `bind`/`alias` body is **not** expanded at definition time (id's `inquote` rule) — record the
  citation in the file's doc comment. No `"` inside the body (Q2 cannot nest quotes; see
  `src/shared/config/alt-layers.ts`), total well under 1024 bytes. Add `speedUp`/`speedDown` entries
  (ids `demoSpeedUp`/`demoSpeedDown`, i18n like D1) to `DEMO_ACTIONS`. Tests in
  `src/shared/config/demo-speed.test.ts`: › "speed up and speed down move exactly one timeline step per
  press" — a tiny simulator (split on `;`, expand `$timescale` per command at execution, evaluate
  `==`) walks every step both ways and asserts clamping at both ends; › "a bound speed action
  survives write and read-back" — render a profile with `bind` to the speed command via
  `src/shared/config/render.ts` and read it back through the existing parse/`bind-adoption.ts` path,
  asserting the same catalog row and command. If read-back splits the body at `;`, emit the command as
  a generated alias instead, mirroring the drop aliases in `src/shared/config/alias-render.ts`.

- [x] **D3 — existing profiles get the demo category (main).** New step in `MIGRATIONS`
  (`src/main/services/migrations.ts`) at the next free version (4 unless another S28 story took it;
  bump `STATE_SCHEMA_VERSION` in `src/shared/constants.ts`): append the `demo` category
  (`{ id, name: label, nameKey: labelKey }`) if no category with id `demo` exists, and one unbound
  action (`kind: 'bind'`, `commands: []`, `categoryId: 'demo'`, `name: nameForCatalogRow(row)`,
  `catalogId`) per demo catalog row the profile lacks; set `dirty: true`. Mirror
  `materialiseTemplateCategories` but do **not** re-run it (it would re-add a template category the
  user deleted). Pure, never throws. Tests in `src/main/services/migrations.test.ts`: › "the demo
  migration adds the demo category and unbound demo rows once" (idempotent on a second run, existing
  categories/actions untouched, a deleted movement category stays deleted) and › "the demo migration
  writes no bind" (no key, empty commands, `binds` unchanged).

- [x] **D4 — demo rows in the Controls tab, disabled with reason on r1q2 (renderer).** Register
  `buildDemoRows()`/`DEMO_ACTIONS` in `src/renderer/src/modules/config/lib/controls-row-entries.ts`
  (`buildCatalogRowIndex`) and in `src/renderer/src/modules/config/components/ActionEditor.tsx`'s
  list enumeration. New pure `src/renderer/src/modules/config/lib/demo-action-availability.ts`:
  `demoActionUnavailableReason(catalogId, engines): string | undefined` returning
  `config.controls.demo.seekNeedsQ2pro` ("Seeking needs Q2PRO") for jump rows and
  `config.controls.demo.speedNeedsQ2pro` ("Speed steps need Q2PRO") for speed rows when `engines` is
  non-empty and has no `'q2pro'`, else undefined (pause always available). `ControlsTab.tsx` gets
  `assignedEngineKinds(profile, installations)` (`lib/engine-scope.ts`, as `SettingsTab.tsx` does) and,
  for an unavailable row, disables its bind slots (no key capture by mouse or keyboard; an existing key
  stays shown, is not removed) and renders the reason as visible text in the row (mirror
  `CvarRow.tsx`'s `config.cvar.notOnEngine` value-cell text), plus `aria-disabled`. Keep existing row
  heights (no new sub-44px control; if one appears, add a CLAUDE.md deviation row). Tests:
  `src/renderer/src/modules/config/lib/demo-action-availability.test.ts` › "seek and speed rows are
  unavailable only when no assigned engine is Q2PRO"; e2e `scripts/flows/demo-actions-bind.mjs` (mirror
  `scripts/flows/drop-message-checkbox.mjs` for selectors/key capture, `raw-save-cascades.mjs` for
  reading the written cfg): on a Q2PRO-assigned fixture profile open Controls, select the "Demo
  playback" chip, see all demo rows, bind a key to jump forward, save, assert the profile file on disk
  holds `bind <key> "seek +<s>"`, then unbind and save back (flow ends where it started); on an
  r1q2-only profile assert the jump and speed rows' bind slots are disabled and "Seeking needs Q2PRO" /
  "Speed steps need Q2PRO" are visible, and pause is enabled. Assign fixture profiles in
  `scripts/lib/fixture.mjs` only if no suitable pair exists.

## Model Hints

- D2 → deliverable-hard: the speed chain looks correct on disk but dies in-game if check order
  cascades, if `$timescale` is expanded at bind time instead of per press, or if the `;`-body is split
  on read-back — three engine-rule subtleties no e2e can observe without a real Q2PRO.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/demo-actions-bind.mjs` › "demo-actions-bind" (Demo playback chip shows
  pause, jumps, speed up/down); unit `src/shared/config/render.test.ts` › "the template seeds the demo
  category unbound and binds no demo command"; unit `src/main/services/migrations.test.ts` › "the demo
  migration adds the demo category and unbound demo rows once" (D1, D3, D4)
- AC2 → unit `src/shared/config/action-catalog.test.ts` › "each demo action's command text is pinned";
  e2e `scripts/flows/demo-actions-bind.mjs` › "demo-actions-bind" (bound key lands as
  `bind <key> "seek +<s>"` in the written file) (D1, D2, D4)
- AC3 → unit `src/shared/config/demo-speed.test.ts` › "speed up and speed down move exactly one
  timeline step per press" and `src/main/modules/config/round-trip.test.ts` › "a bound speed action survives write and read-back" (D2; moved to main because the real cfg parser is main-only);
  manual residue: pressing the bound key inside a running Q2PRO demo — needs the licensed Quake II game
  data and a real engine, which CI and the flow fixture do not have.
- AC4 → unit `src/shared/config/render.test.ts` › "the template seeds the demo category unbound and
  binds no demo command"; unit `src/main/services/migrations.test.ts` › "the demo migration writes no
  bind" (D1, D3)
- AC5 → unit `src/renderer/src/modules/config/lib/demo-action-availability.test.ts` › "seek and speed
  rows are unavailable only when no assigned engine is Q2PRO"; e2e `scripts/flows/demo-actions-bind.mjs`
  › "demo-actions-bind" (r1q2 profile: disabled slots, visible reason text) (D4)
- AC6 → unit `src/shared/config/action-catalog.test.ts` › "demo labels are config.actionCatalog keys
  with an ASCII label"; unit `src/shared/config/comment-labels.test.ts` (existing label-vs-en.json pin,
  extended to demo rows) (D1, D2)

## Done

Adds a "Demo playback" template category (pause, jump ±10 s and ±60 s, speed up/down) to the config catalog, seeded unbound for new profiles and by state migration v4 for existing ones. Speed steps use a Q2PRO `if $timescale` chain over the timeline's `SPEED_STEPS`; the Controls tab disables seek and speed rows with visible reason text in r1q2-only profiles.

Commit message: `167: demo actions bindable in profile - demo category (unbound), speed if-chain, migration v4, r1q2 disabled-with-reason`

Verification (narrow gate): `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (3534 passed), later full `npx vitest run` (5695 passed) green; flows `demo-actions-bind`, `controls-extra-keys`, `controls-drag-reorder`, `controls-subcategory`, `settings-section-rename-add-cvar`, `controls-category-rename-reorder`, `drop-message-checkbox`, `raw-save-cascades`, `config-header-geometry` green (last three only after `ui:seed`; first red was leftover state from back-to-back runs, not the story). Full gate is the sprint's. Review 1 (default): PASS.
AC map: AC1 flow demo-actions-bind + render.test/migrations.test; AC2 action-catalog.test pinned commands + flow; AC3 demo-speed.test + round-trip.test (manual residue: pressing the key in a running Q2PRO demo); AC4 render.test + migrations.test no-bind; AC5 demo-action-availability.test + flow; AC6 action-catalog.test + comment-labels.test.

Decisions:
- Non-`+` binds go through the existing generated-alias path (`bind y "seek_10"` + `alias seek_10 seek +10`), so the flow resolves the bind via that alias, not a literal `bind y "seek +10"`.
- Speed rows carry their four `if` checks as separate commands (`Action.commands`), like drop rows; alias names come out long/cut off but distinct and working.
- Read-back test lives in `src/main/modules/config/round-trip.test.ts` (parser is main-only). q2pro r3834 source not fetchable; doc comment cites master and states the gap.
- Reason text replaces the dash in the Options cell (truncated otherwise); fixture gained a 4th "Q2PRO Profile"; `controls-category-rename-reorder` expected rail extended by Demo playback.
- Left unfixed (review): a conflict/layer marker wins over the reason on a disabled row with a conflicting key; speed rows' long command text truncates the name column; `alias-import.ts` unchanged (demo never a guess target).
- Gate regression fix: demo rows were named by their raw command, so `seek -10`/`seek +10` (and 60) derived the same alias name and Care reported 3 duplicate-name rows (care-duplicate-name) - demo rows are now named by their label (`CatalogRow.name`); the `controls-seed` fixture schema mirror was still 2 so the v4 migration seeded demo rows into the Care-clear profile (config-care-clear) - now 4.

tiers: D 5 / hard 1 · review default · cycles 1 · agents 8
