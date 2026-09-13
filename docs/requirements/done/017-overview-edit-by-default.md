---
id: 017
title: Overview — editing is the default, no dedicated edit mode
status: done # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

On the profile's Overview tab, editing a bind is what I do 95% of the time. Having to arm
"Start edit" first is a toll on every single change. Clicking a keycap should open the bind
dialog straight away — the edit toggle disappears entirely. Test mode stays an explicit mode,
because it grabs the physical keyboard and therefore cannot be the resting state.

The one collision this creates has to be resolved deliberately: a layer's trigger keycap
currently switches the displayed layer on click (story 014), and that role has to survive
next to "a click edits this key".

## Acceptance Criteria

- [x] The Overview header has no edit-mode toggle any more; only Start/Stop test mode remains.
- [x] Clicking any keycap outside test mode opens `KeyBindDialog` for that key — scoped to the
      base layer or, with a layer selected, to that layer's overrides, exactly as edit mode did.
- [x] Outside test mode, a layer's trigger keycap behaves like any other keycap: a click opens
      `KeyBindDialog` for its own bind. Click-to-switch-layer is retired as a click behaviour
      (013/014); the board still switches to a layer, but only as part of test mode (018).
- [x] Starting test mode suspends editing (a keycap click captures instead of opening the dialog);
      stopping test mode returns to editing without any further click.
- [x] Keycap hover/cursor affordance reflects "click edits" everywhere it applies — no keycap
      looks clickable while doing nothing, and none looks inert while being editable.
- [x] Switching profiles resets test mode; there is no edit-mode state left to reset.

## Open Questions

- ~~The trigger keycap's second affordance: a small pencil in the keycap corner, a context menu,
  or a modifier-click? Pick one and use it consistently — it is the only key on the board with
  two actions.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Trigger keycap collision resolved by narrowing scope, not by adding a second
  affordance: outside test mode a click always opens the bind dialog, exactly like every other
  keycap. Click-to-switch-layer is no longer a click behaviour at all — it only happens in test
  mode, via 018's trigger-key-press mechanics (physical key press switches the displayed board).
  This removes the need for any pencil/context-menu/modifier-click affordance in edit mode.
- **`triggerSelectTarget` (and its test) stays** in `lib/trigger-keys.ts` even though 017 removes
  its only call site — 018 needs exactly that mapping for the physical-key path, so deleting and
  re-adding it inside one sprint would be churn; a comment marks it as reserved for 018.
- **The trigger keycap's `→ {layer}` / `→ Base` inline label is replaced by the plain layer name**
  — the arrow was the click-to-switch affordance and would now promise a navigation that no longer
  happens on click (AC5).
- **The trigger tooltip always names the layer the key triggers** (`trigger.title`), so
  `trigger.titleActive` ("Layer trigger: Base") is dropped — it only existed to describe the
  click-back-to-base behaviour that is retired.
- **Every keycap gets the same `cursor-pointer` unconditionally, and the hover border keeps the
  keycap's own tone** (strogg for a trigger, flame otherwise) — one uniform "this is clickable"
  signal without flattening the trigger/bound/override colour identity from 013/014.
- **The removed toggle's discoverability is replaced by one static hint line** under the overview
  subtitle ("Click a key to edit its bind"), shown outside test mode — nothing else in the header
  would otherwise tell a first-time user that a keycap is editable.
- **Layer switching stays available via `LayerSwitcher`** (013) — retiring click-to-switch removes
  a shortcut, not a capability, so no replacement control is planned.
- **No component test is added.** Vitest here runs `environment: 'node'` with
  `include: ['src/**/*.{test,spec}.ts']` and no jsdom/RTL; wiring a renderer test stack is its own
  story, and this change adds no new pure logic — acceptance is the live UI pass (026 harness).
- **`editMode` stays plain component state right up to its removal** — no store migration, the
  panel keeps owning `testMode`/`captured`/`editingKey` exactly where 018 expects to find them.

## Plan

Single-file change plus i18n. `OverviewKeyboardPanel.tsx` owns everything (state, header buttons,
keycap render, dialog mount); `lib/trigger-keys.ts` is left as-is.

1. **Kill the mode.** Remove `editMode` state (`:85`), its reset in the profile-switch effect
   (`:90-95`), the Pencil toggle button (`:334-347`) and the `setEditMode(false)` inside the
   test-mode toggle (`:348-361`). Drop the now-unused `Pencil` import.
2. **Rewrite `capture(def)` (`:156-170`)** into two branches only: `testMode` → `setCaptured(...)`
   (unchanged), otherwise → `setEditingKey({ key, label })`. This deletes the
   `resolveTriggerLayer`/`triggerSelectTarget` click branch (014) — a trigger keycap falls through
   to the edit branch like any other key. `onSelectLayer` stays a prop: `LayerSwitcher` uses it.
   Update the handler's doc comment to the new two-state rule.
3. **Affordance in `keyVisual()` (`:224-228`)**: replace the `testMode || editMode` condition with
   an unconditional `cursor-pointer`, hover border `strogg-300` for a trigger keycap and
   `flame-400` otherwise. Bound/override/dim classes untouched.
4. **Trigger labels**: in `keyLabel` (`:242-247`) render `trigger.layerName` via a new
   `config.overview.trigger.layerLabel` instead of `trigger.toLayer`/`toBase`; in `keyVisual`'s
   `title` use `trigger.title` unconditionally. `TriggerInfo.isActive` keeps its other uses.
5. **i18n (`src/renderer/src/i18n/locales/en.json`, node `config.overview`)**: remove
   `editMode.start/stop`, `trigger.toLayer`, `trigger.toBase`, `trigger.titleActive`; add
   `trigger.layerLabel` and `editHint`. No other locale exists.
6. **Header/hint**: render `editHint` as a second `<p class="text-xs text-ink-muted">` under the
   subtitle while `!testMode`; the header's right-hand cluster keeps only the test-mode button.
7. Verify: `npm run typecheck`, `npm run build`, `npm test` (`trigger-keys.test.ts` must stay
   green — its pure logic is untouched), then the live UI pass below.

## Deliverables

### D1 — Edit mode is gone; a keycap click opens the bind dialog

Remove `editMode` state, the pencil toggle and the trigger-click branch; `capture()` becomes
"test mode → capture keypress, otherwise → open `KeyBindDialog`". Dialog scoping (base vs.
`activeLayer` overrides) is already handled by the existing `<KeyBindDialog layer={activeLayer} …/>`
mount and must not change. Profile switch keeps resetting `testMode`/`captured`/`editingKey`.

- Files: `src/renderer/src/modules/config/OverviewKeyboardPanel.tsx`,
  `src/renderer/src/i18n/locales/en.json` (drop `config.overview.editMode.*`).
- Pattern to mirror: the panel's own `testMode` toggle button — it stays unchanged as the only
  mode control.
- Acceptance: the header shows only Start/Stop test mode; clicking any keycap (including a
  layer's trigger key) outside test mode opens `KeyBindDialog` for that key, scoped to the
  selected layer; clicking one inside test mode still only fills the readout; stopping test mode
  makes the next click edit again with no intermediate step; switching profiles leaves test mode;
  no `editMode` identifier remains in the file; `npm run typecheck` + `npm test` green.

### D2 — Affordance and trigger keycap labels tell the truth

Uniform clickable affordance on every keycap, a trigger keycap that no longer advertises a layer
switch on click, and the hint line that replaces the removed button.

- Files: `src/renderer/src/modules/config/OverviewKeyboardPanel.tsx` (`keyVisual`, `keyLabel`,
  header block), `src/renderer/src/i18n/locales/en.json` (remove `trigger.toLayer`,
  `trigger.toBase`, `trigger.titleActive`; add `trigger.layerLabel`, `editHint`).
- Pattern to mirror: the existing `cn(...)` tone cascade in `keyVisual` — extend its last branch,
  do not restructure the ones above it; semantic tokens only, no raw palette values
  (`/design-tokens`).
- Acceptance: every keycap renders `cursor-pointer` with a hover border in its own tone (trigger =
  strogg, otherwise flame), in both modes; a trigger keycap shows the layer name without an arrow
  and its `title` reads "Layer trigger: <layer>" whether or not that layer is displayed; its base
  bind still shows on the reference line (014); the hint "Click a key to edit its bind" is visible
  outside test mode and gone inside it; no removed i18n key is referenced anywhere
  (`grep -rn "toLayer\|toBase\|titleActive\|editMode" src/renderer` is empty).

## Model Hints

- D1 → default. Two-branch handler in a single file, no new logic path.
- D2 → default. Class-list and label edits in the file the same agent just touched.
- Review: → default. The whole story is one component file plus i18n keys, and the one real risk
  (a 014 trigger visual silently lost) is spelled out in D2's acceptance and visible in the diff.

## Test Plan (manual acceptance)

Live pass through the running app (`npm run dev`, `live-smoke-required: true`).

1. Config → open a profile → **Overview**. The header right of the layer switcher holds **only**
   "Start test mode" — no "Start editing". Under the subtitle: "Click a key to edit its bind".
2. Click key `1`. `KeyBindDialog` opens immediately. Assign a command, save — the keycap shows it.
3. With at least one alt layer (create it in the Layers panel, give it trigger key `-` via 011's
   flow) select that layer in the **LayerSwitcher**. Click a key → the dialog edits that layer's
   *override*, not the base bind.
4. Click the trigger keycap `-` while the layer is selected: the bind dialog opens for `-` and the
   board does **not** switch layer. Repeat on Base — same result.
5. Hover across a free key, a bound key, an override key and the trigger key: all show a pointer
   cursor and a hover border, none is inert. The trigger keycap shows the layer name (no `→`) and
   its tooltip reads "Layer trigger: <layer>".
6. **Start test mode.** The hint line disappears. Click any keycap → readout only, no dialog.
   Press a physical key → the readout updates. **Stop test mode** → click a keycap → the dialog
   opens again with no extra step.
7. Start test mode, switch profiles in the sidebar and come back: test mode is off, no dialog is
   open, and a keycap click edits.

## Done

Editing is now the Overview's resting state: the edit-mode toggle is gone, and a keycap click
opens `KeyBindDialog` directly, scoped to base or the selected layer's overrides exactly as before.
Test mode is the only remaining explicit mode and still suspends editing while it runs. The trigger
keycap's click-to-switch-layer (013/014) is retired — a trigger key opens its own bind dialog like
any other key, its inline label lost the `→` arrow, and its tooltip always reads "Layer trigger:
<layer>". Every keycap now shows an unconditional pointer cursor and a tone-appropriate hover
border (strogg for trigger, flame otherwise), and a static hint ("Click a key to edit its bind")
replaces the removed toggle's discoverability, shown outside test mode only.

**Decisions:**
- Fixed two UI-verification harness files (`scripts/lib/screens.mjs`,
  `scripts/flows/open-keycap-dialog.mjs`) that clicked the now-removed "Start editing" button —
  a direct, necessary consequence of this story's change, not a separate deliverable. Verified via
  `npm run ui:flow -- open-keycap-dialog` and `npm run ui:shot`.
- `triggerSelectTarget` (and its test) intentionally left in place in `lib/trigger-keys.ts` per the
  story's sprint decision — reserved for story 018.

**Verification:**
- `npm run build` — pass. `npm test` — 568/568 pass. `npm run typecheck` — pass (node + web).
- Live smoke: ran `npm run ui:flow -- open-keycap-dialog` (confirms header has only "Start test
  mode", hint line visible, keycap click opens `KeyBindDialog` with no edit-mode step) and
  `npm run ui:shot` (26/28 screens written; the only 2 errors are `config-raw` at both viewports —
  the pre-existing, unrelated `RawConfigPanel.tsx` double-unwrapped-`Outcome` crash noted by the
  orchestrator before this story started; not touched, not caused by this change). `config-overview`
  screenshot confirms header/hint rendering matches the acceptance criteria.
- Code review (clean agent, default tier): verdict PASS. All 6 acceptance criteria PASS with
  file:line evidence; all sprint decisions (trigger label, tooltip, cursor affordance, hint
  placement, `triggerSelectTarget` retained, no component test added) verified; no weakened tests,
  no scope creep beyond the harness fix explained above. No fixes needed — zero review-fix cycles.

**Commit message:** `017: overview editing is the default, no edit-mode toggle`
