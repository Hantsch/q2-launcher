---
id: 014
title: Show an alt-layer trigger's action on its own keycap, and switch layers by clicking it
status: in-progress
created: 2026-08-18
---

## Requirement

As a user, when I bind a key as an alt layer's trigger, I want that key's role to be obvious
directly on the keyboard overview — today I bound "-" as the "Test" layer's trigger and the
board gives no sign of it. The trigger key should stand out (distinct from a normal bound key)
and name the layer it leads to. Because releasing/toggling a trigger always returns to the base
layer, the same key should read "Base" while its own layer is the one currently shown — it is
a two-way switch, not a one-way jump. Clicking the trigger key on the board should switch which
layer is currently shown, the same as picking it from the layer switcher.

Confirmed while working through the feedback: the existing "Bound in an alt layer" legend/badge
should stay — it is not confusing once you know the rest of the keyboard isn't touched, only the
keys a layer actually overrides get rebound differently while that layer is active.

## Acceptance Criteria

- [x] A key that is a layer's trigger is visually distinct from both a normal bound key and a
      free key (e.g. its own color/highlight), on every layer view where that key is visible.
- [x] While viewing the base layer, a trigger key's label names the layer it switches into (e.g.
      "Test").
- [x] While viewing the layer that key triggers, the same key's label instead reads "Base" (or
      equivalent), reflecting that using it now returns to the base layer.
- [x] Clicking a trigger key on the board (outside of test/edit mode, or in whatever mode this
      ends up living) switches the currently shown/edited layer, equivalently to using the layer
      switcher from the companion story on selector placement.
- [x] A key that is simultaneously a trigger and carries its own base bind (flagged today as a
      conflict, trigger wins) still shows the trigger state as primary, per existing precedent.
- [x] The "Bound in an alt layer" legend entry is kept, unchanged in meaning.

## Open Questions

_None — all detail decisions were taken during sprint refinement, see below._

## Decisions (Sprint)

1. **Trigger colour = `strogg` (HUD green) tokens** (`border-strogg-700 bg-strogg-900/35 text-strogg-200`)
   — the only remaining semantic family clearly distinct from `flame` (bound) and `warning`
   (alt-layer override) that already exists as a `Badge` tone, so no new tone has to be invented.
2. **Legend gains a 4th badge "Layer trigger"** (tone `strogg`) — AC1 demands a distinct visual, and
   an undocumented colour on the board would be a colour-only status without a key.
3. **Trigger state wins over override/bound in the keycap's style cascade** — AC5 requires the
   trigger to read as primary, and the existing precedent is that the trigger bind is emitted last
   in `render.ts` and therefore wins in-game too.
4. **A trigger key that also carries a base bind shows that bind in the third (small, italic) label
   slot** — reuses the existing `baseReferenceLabel` slot, so the conflict stays visible without the
   trigger role losing primacy.
5. **Label goes into the second (command) slot as `→ Test` / `→ Base`** — that slot already carries
   "what this key does", which is exactly what the trigger label states; no new layout is needed.
6. **Click-to-switch lives in idle mode** (neither test nor edit mode active) — test mode must keep
   reading keypresses and edit mode must keep opening `KeyBindDialog` (that is how 011 reassigns or
   clears a trigger), and idle mode has no click meaning today, so it is the free slot AC4 asks for.
7. **Switching is delegated upward via a new `onSelectLayer` prop on `OverviewKeyboardPanel`**, wired
   to `ConfigView`'s existing `setActiveLayerId` — that is the same setter 013's relocated switcher
   uses, so both stories converge on one source of truth and 014 does not touch 013's layout.
8. **Clicking the active layer's own trigger selects `null` (base)** — AC3's "reads Base" and AC4's
   "switches like the switcher" only agree if the key is a two-way toggle, as the requirement says.
9. **Trigger lookup is trimmed and case-insensitive, first match in `layers` array order wins** —
   011 may write a trigger key from a live keypress rather than from the layout list, and no
   cross-layer trigger-collision rule exists today (out of scope to add one).
10. **A layer with a blank/absent `triggerKey` produces no trigger keycap** — 011 explicitly allows a
    trigger-less layer, and an empty string must not match the `''` spacer entries in `KeyDef`.
11. **The trigger resolution + label logic is extracted into a pure `lib/` helper with Vitest tests**
    — the config module has no renderer component-test harness, and introducing one is out of scope;
    a pure helper makes the AC2/AC3 label rules testable without it.
12. **`config.layersPanel.trigger` ("Trigger: {{key}}") and `legend.altLayer` stay verbatim** — AC6
    and 013's AC4 both require the existing legend/panel wording to be unchanged.

## Plan

Everything lives in the renderer config module; no IPC, no main, no shared-type change.

1. **New pure helper** `src/renderer/src/modules/config/lib/trigger-keys.ts`
   - `resolveTriggerLayer(key, layers, activeLayerId): TriggerInfo | null`
     with `TriggerInfo = { layerId, layerName, isActive }`; trims, ignores blanks,
     case-insensitive, first match wins.
   - `triggerSelectTarget(info): string | null` → `info.isActive ? null : info.layerId`.
   - Tests in `trigger-keys.test.ts` (mirror `lib/validation-scope.test.ts`).
2. **Keycap visuals + label** in `OverviewKeyboardPanel.tsx`
   - In `keyVisual()`: call the helper once per key; when a trigger is found it takes precedence
     over `hasOverride`/`bound` for `className`, for the command-label slot and for `title`.
   - `keyLabel()` gains the trigger branch: second slot = `→ {layer}` / `→ Base`, third slot keeps
     the existing base-bind reference when the trigger key also has a base bind.
   - Legend row: add a `strogg` `Badge` for "Layer trigger".
   - New i18n keys in `src/renderer/src/i18n/locales/en.json` under `config.overview`:
     `legend.trigger`, `trigger.toLayer`, `trigger.toBase`, `trigger.title`, `trigger.titleActive`.
3. **Click-to-switch** in `OverviewKeyboardPanel.tsx` + `ConfigView.tsx`
   - New required prop `onSelectLayer: (layerId: string | null) => void`; `ConfigView` passes
     `setActiveLayerId` (already in scope at the `OverviewKeyboardPanel` call site).
   - `capture()` gains a leading idle-mode branch: if neither mode is on **and** the key is a
     trigger, `onSelectLayer(triggerSelectTarget(info))`; otherwise the existing behaviour is
     untouched.
   - Cursor/hover: a trigger key is `cursor-pointer hover:border-strogg-300` in idle mode too
     (today idle is `cursor-default` for everything).

Order: D1 → D2 → D3. D2 and D3 both edit `OverviewKeyboardPanel.tsx`, so they must not run in
parallel.

## Deliverables

**D1 — Pure trigger-resolution helper + tests**
- Files: `src/renderer/src/modules/config/lib/trigger-keys.ts` (new),
  `src/renderer/src/modules/config/lib/trigger-keys.test.ts` (new).
- Mirror: `src/renderer/src/modules/config/lib/validation-scope.ts` / `.test.ts` for module shape
  and test style. `AltLayer` type from `src/shared/config/alt-layers.ts`.
- Acceptance: `npm test` green; tests cover — trigger of a non-active layer resolves with
  `isActive: false`; trigger of the active layer resolves with `isActive: true`; blank/absent
  `triggerKey` resolves to `null`; `''` never matches; lowercase/whitespace trigger key still
  matches an uppercase layout key; two layers on the same key → first in array order;
  `triggerSelectTarget` returns `null` for the active layer's trigger and the layer id otherwise.
- Covers: AC2, AC3 (the label-state rule), AC4 (the target rule).

**D2 — Trigger keycap appearance, label and legend entry**
- Files: `src/renderer/src/modules/config/OverviewKeyboardPanel.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Uses D1's helper. Only `keyVisual()`, `keyLabel()` and the legend row change; the mode toggles,
  the scaling effect, the capture readout and the numpad/mouse cluster code stay untouched.
- Acceptance: on the base-layer view a layer's trigger key renders in the `strogg` variant with
  `→ <layer name>` as its second label line; on that layer's own view the same key reads `→ Base`;
  a trigger key that also has a base bind still renders as a trigger with the base bind in the
  small italic third line; the "Bound in an alt layer" badge and its wording are unchanged and a
  4th "Layer trigger" badge is present; only semantic tokens are used (no hex, no raw palette
  class); the `title` attribute names the trigger role and its target so status is not colour-only.
- Covers: AC1, AC2, AC3, AC5, AC6.

**D3 — Click a trigger key on the board to switch the shown layer**
- Files: `src/renderer/src/modules/config/OverviewKeyboardPanel.tsx`,
  `src/renderer/src/modules/config/ConfigView.tsx`.
- Acceptance: with neither test nor edit mode active, clicking a trigger key switches the board
  (and the switcher's own selected state) to that layer; clicking the active layer's trigger goes
  back to Base; a non-trigger key clicked in idle mode still does nothing; test mode still captures
  and edit mode still opens `KeyBindDialog` when a trigger key is clicked; trigger keys show a
  pointer cursor and a hover affordance in idle mode, non-trigger keys do not.
- Covers: AC4.

## Model Hints

- `D1 → default`
- `D2 → deliverable-hard` — `keyVisual()`/`keyLabel()` are the single render path for **every**
  keycap on the board and the change inserts a new highest-priority branch ahead of the existing
  override/bound/free cascade, so a mistake silently regresses the whole keyboard overview.
- `D3 → default`
- `Review: → default` — three small, well-bounded renderer deliverables in one module, no IPC, no
  main-process and no persisted-data change.

## Test Plan (manual acceptance)

Run `npm run dev`, then in the app:

1. Config → pick a profile → **Overview** tab. Create an alt layer named `Test` and give it the
   `-` key as its trigger (via 011's flow: enter edit mode, click `-`, assign "switch into layer
   Test"). Leave edit mode.
2. On the **Base** view: `-` is green (distinct from orange bound keys and amber alt-layer keys) and
   its second label line reads `→ Test`. The legend below the board shows four entries, including
   **Layer trigger**, with "Bound in an alt layer" still worded as before.
3. Click `-` on the board (no mode active) → the board switches to the `Test` layer and the layer
   switcher now shows `Test` as selected.
4. On the `Test` view: `-` still renders green but now reads `→ Base`. Click it → back to the base
   layer, switcher back on `Base`.
5. Give `-` a base bind too (edit mode → click `-` while on Base → assign e.g. `+attack`). Reopen
   Base view: `-` still renders as a trigger (green, `→ Test`) with `+attack` in the small italic
   line under it; the layers panel still flags the trigger conflict as before.
6. Regression: start **Test mode**, click `-` → the capture readout appears (no layer switch).
   Stop test mode, start **Edit mode**, click `-` → `KeyBindDialog` opens (no layer switch).
7. Regression: click a free key and a normally bound key in idle mode → nothing happens, as today.

## Done

**Summary.** D1 added a pure helper `src/renderer/src/modules/config/lib/trigger-keys.ts`
(`resolveTriggerLayer`/`triggerSelectTarget`, with 8 Vitest cases in `trigger-keys.test.ts`
mirroring `validation-scope.ts`'s style) that answers "is this key some layer's trigger, and is
that layer the one currently shown" with the trimmed/case-insensitive/first-match semantics
decision 9 calls for. D2 wired that helper into `OverviewKeyboardPanel.tsx`'s `keyVisual()`/
`keyLabel()`: a trigger key now renders in the `strogg` variant
(`border-strogg-700 bg-strogg-900/35 text-strogg-200`), its second label line reads
`→ <layer>` / `→ Base` (new i18n keys `config.overview.trigger.toLayer`/`toBase`/`title`/
`titleActive`), a 4th "Layer trigger" legend badge was added
(`config.overview.legend.trigger`), and the `title` attribute names the trigger role and target
so the state is never colour-only. D3 added a leading idle-mode branch to `capture()`
(`onSelectLayer(triggerSelectTarget(trigger))` when neither test nor edit mode is active and the
clicked key is a trigger) and gave trigger keys a `cursor-pointer hover:border-strogg-300`
affordance in idle mode; `ConfigView.tsx` needed no change — its `onSelectLayer={setActiveLayerId}`
wiring from story 013 already covers this. No IPC, main, schema or persistence surface touched.

**Decisions** (implementation-detail calls made without a user to ask, verified against plan +
acceptance criteria — beyond the 12 already recorded under "Decisions (Sprint)" above, which the
implementation followed as written):
- The base-bind reference slot (`baseReferenceLabel`) now fires whenever `baseBound &&
  (trigger || hasOverride)`, not only `hasOverride && baseBound` as before — a trigger key's own
  base bind must stay visible under the trigger label (AC5, decision 4) independent of whether
  the active layer happens to also override that same key.
- The trigger arrow's second-line text uses a new, slightly lighter tint (`text-strogg-300/90`)
  than the keycap's own `text-strogg-200`, matching the existing pattern where the bound-command
  slot (`text-flame-300/90`) is a lighter tint than its keycap's `text-flame-200` — kept for
  visual-hierarchy consistency rather than reusing the exact keycap color for the label line.
- `resolveTriggerLayer` is called independently in both `keyVisual()` and `capture()` rather than
  computed once and threaded through — matches the existing pattern where `capture()` already
  reads `profile.binds` independently of `keyVisual()`'s own read of the same data; the review
  flagged this as a negligible, non-blocking duplication (see Verification below).

**Commit message:**
```
014: show trigger keys on the keyboard overview, click to switch layers
```

**Verification:**
- `npx tsc -p tsconfig.web.json --noEmit` — clean.
- `npx tsc -p tsconfig.node.json --noEmit` — clean.
- `npm run build` — green (main/preload/renderer all built).
- `npm test` — 26 files / 443 tests, all passed (8 new for `trigger-keys.test.ts`); no test
  weakened, skipped or deleted.
- Clean-agent code review — overall **PASS**. All six acceptance criteria PASS with file:line
  evidence; non-trigger-key rendering traced as algebraically identical to the pre-diff behavior
  (the deliverable-hard regression risk did not materialize); no scope creep; design-token and
  i18n hygiene confirmed (no hex/raw-palette classes, no hardcoded UI prose); the sprint decisions
  (trigger-wins-cascade, base-bind third slot, active-trigger-selects-null, trimmed/case-insensitive
  lookup, blank-triggerKey-no-keycap) spot-checked and honored. Four minor, explicitly
  non-blocking observations, left as-is:
  - `resolveTriggerLayer` runs twice per rendered key (`capture()` and `keyVisual()`) — negligible
    duplication, see Decisions above.
  - Two trigger-matching semantics now coexist: `resolveTriggerLayer`'s lenient trim/case-fold
    match (this story) vs. `alt-layers.ts`'s exact `findLayerByTriggerKey` (story 011) —
    intentional per decision 9, not accidental drift.
  - An already-invalid edge case (a layer's trigger key also appears in that same layer's own
    `overrides`, i.e. the existing `layer.selfbind` error state) doesn't surface the override
    command on the keycap — outside AC5's literal scope (AC5 is about a *base* bind conflict).
  - Trivial opacity mismatch between the legend swatch (`bg-strogg-900/40`, from the existing
    shared `Badge` component) and the keycap (`bg-strogg-900/35`, per decision 1's exact token
    choice) — cosmetic only, both are the same `strogg` semantic family.
  No re-review cycle was needed.
- **Live UI smoke (P2): not performed.** This environment has no way to interactively drive the
  Electron window — no Playwright installed in this project, no `ui-verify` harness scaffolded
  yet, and the available Playwright MCP tools only drive a browser page, not an Electron app. Per
  this project's P2 policy this is an expected limitation, not a failure: the story is **built,
  live acceptance pending**. The 7-step manual test plan above is ready for a human (or a future
  `ui-verify`-equipped session) to run via `npm run dev`.
