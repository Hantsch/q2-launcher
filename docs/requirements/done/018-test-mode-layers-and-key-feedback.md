---
id: 018
title: Test mode — trigger keys switch layers, pressed keys light up, readout always visible
status: done # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

Test mode is supposed to answer "what happens when I press this key". Today it lies in three
ways:

1. **Bug:** pressing the trigger key of an alt layer reports **"unbound"**, which is wrong — that
   key is exactly what activates the layer. The readout only looks at `profile.binds`, while a
   layer's trigger bind lives on `AltLayer.triggerKey` and is emitted by the alias generator
   (`alt-layers.ts` `triggerBind`), so it is invisible to the lookup.
2. Pressing the trigger key does not put the layer on the board. If it switches the layer in
   the game, it has to switch the board here too — otherwise the following key press is resolved
   against the wrong layer.
3. There is no feedback for what I am physically holding. Pressed keys should light up, several
   at once, so I can see the actual key combination the engine would see.

On top of that the readout strip should stop appearing and disappearing under the keyboard: it
belongs permanently in the right-hand column of the legend row, underneath the Start/Stop test
mode button.

## Acceptance Criteria

- [x] Pressing a layer's trigger key in test mode shows that layer's activation (layer name, mode
      hold/toggle, and the generated alias that fires) — never "unbound".
- [x] Pressing a trigger key switches the displayed board to that layer: for a `hold` layer while
      the key is held (back to base on release), for a `toggle` layer on each press.
- [x] While a layer is displayed, a following key press resolves through that layer's overrides
      first and falls back to the base bind, and the readout says which of the two it used.
- [x] Every physically pressed key/mouse button is visibly highlighted on its keycap while held,
      several simultaneously; release removes the highlight.
- [x] Losing window focus or leaving test mode clears all highlights and any hold-layer state —
      no keycap stays stuck lit.
- [x] The readout sits permanently in the legend row's right-hand column below the test-mode
      button, with a placeholder when nothing has been pressed yet; entering/leaving test mode
      does not shift the keyboard's layout.
- [x] A modifier-derived bind (story 016 `keyModifier`) is reported the same way as a hand-made
      layer, so Alt+R does not read as "unbound" either.

## Open Questions

- ~~Should the readout keep a short history (last 3 presses) instead of only the latest? A single
  slot loses the previous key the moment a hold layer's trigger is pressed together with a
  key.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Readout stays a single slot (latest press only), no history — simpler, and the
  simultaneous-key case is already covered by highlighting every physically held key on its
  keycap.

### Resolution model

1. **All new logic lands in one pure helper `lib/test-mode.ts`, the UI stays thin** — vitest here
   runs `environment: 'node'` with `include: ['src/**/*.{test,spec}.ts']`, so a `.tsx` cannot be
   tested at all (016 D13, 017's "no component test" decision); a pure resolver is the only way
   any of this becomes verifiable by `npm test`.
2. **Resolution order for a press is trigger → displayed layer's override → base bind → unbound**
   — a trigger key's role is what puts the layer on the board and therefore outranks its own bind,
   exactly the precedence 014 D3 already established for the keycap's appearance.
3. **The fired alias comes from `generateLayerAliases(layer, profile.binds).triggerBind.command`**
   (`src/shared/config/alt-layers.ts`), never re-derived — that function is what actually writes
   the config, so anything else would be a second, drift-prone implementation of AC 1.
4. **If `triggerBind` is `null`** (a layer whose generation reports `issues`, e.g. `layer.selfbind`)
   **the readout still names layer + mode and omits the alias** — reporting "unbound" for a key
   that is demonstrably a trigger is the exact bug this story exists to fix.
5. **AC 7 needs no extra code, only test coverage** — story 016 stores a modifier bind as an
   ordinary override inside an ordinary `mode: 'hold'` layer whose `triggerKey` is `ALT`/`CTRL`/
   `SHIFT` (`src/shared/config/modifier-layers.ts`), so decisions 2 and 3 already cover Alt+R; D1
   asserts it with a fixture instead of adding a special case.

### Layer switching in test mode

6. **The displayed layer in test mode is panel-local state (`testLayerId`), not a write to
   `ConfigView`'s `activeLayerId`** — a hold layer flipping the global selection would also move
   `LayersPanel` and would survive leaving test mode, which AC 5 forbids.
7. **`testLayerId` is seeded from the currently selected layer when test mode starts and dropped
   when it stops** — starting test mode must not silently change what you were looking at.
8. **A `hold` trigger's release restores the layer that was displayed before the press** (stored
   with the held trigger), not unconditionally `null` — in the normal flow that *is* base, which
   is what AC 2 asks for, and it stays truthful if you started on a layer.
9. **Exactly one hold trigger is tracked at a time; a second one replaces it** — Q2 has no nested
   layers (016 D1 already refuses two held modifiers), so a stack would model something the engine
   cannot do.
10. **A `toggle` trigger flips between its layer and base** via `triggerSelectTarget`
    (`lib/trigger-keys.ts`, kept alive by 017 for exactly this) — one mapping serves both the
    retired click path and the new physical-key path.
11. **`LayerSwitcher` shows the displayed layer while test mode is on and stays enabled**, its
    `onSelect` writing both `testLayerId` and `onSelectLayer` — a board on layer X above a switcher
    reading "Base" would be a worse lie than the one this story removes, and there is no reason to
    disable a control that can simply stay coherent.
12. **`keyVisual`/`keyLabel`/`capture` switch from `activeLayer` to a derived `displayedLayer`** —
    otherwise 013/014's override, dim and trigger visuals would keep describing the *selected*
    layer while the board claims to show another one. The `KeyBindDialog` mount keeps `activeLayer`:
    editing scope belongs to 017, not to test mode.

### Physical key feedback

13. **Pressed keys live in a `Set<string>` of Quake key names, fed by capturing-phase `keydown`/
    `keyup` on `window`** — the same listener style and `resolveQuakeKeyName` mapping the existing
    keydown effect already uses; nothing about key-name resolution changes.
14. **The pressed state is a ring (`ring-2 ring-inset ring-ink`) layered on top of the keycap's
    existing tone, not a fourth colour** — flame/warning/strogg are taken by bound/override/trigger
    (014 D1), and a shape change composes with all three instead of hiding one (`/design-tokens`:
    semantic token, never colour-only, no raw palette value).
15. **The legend gains a 5th entry "Pressed", rendered with the same ring classes on a neutral
    `Badge`** — a new keycap state without a legend key is exactly the colour-only-status failure
    the design rules call out (same reasoning as 014 D2).
16. **Physical mouse buttons highlight via capturing `mousedown`/`mouseup` on `window`**, mapping
    `event.button` 0/1/2/3/4 → `MOUSE1`/`MOUSE3`/`MOUSE2`/`MOUSE4`/`MOUSE5` — that is Quake's
    button numbering (middle is `MOUSE3`), and `MOUSE4`/`MOUSE5` already exist as keycaps.
17. **A mouse press only fills the readout when it did not land on a keycap** (keycaps get a
    `data-keycap` marker, the handler checks `closest('[data-keycap]')`) — 017 AC 4 keeps
    click-to-capture inside test mode, and without that check every keycap click would report
    `MOUSE1` instead of the key that was clicked.
18. **The wheel is excluded from the highlight and from the physical readout path** — `wheel` has
    no press/release, so "highlighted while held" (AC 4) has no meaning for it; `MWHEELUP`/
    `MWHEELDOWN` stay reachable by clicking their keycaps, exactly as today.
19. **`keydown`/`keyup` keep `preventDefault()` and keep ignoring `event.repeat`** — test mode
    grabs the keyboard on purpose, and auto-repeat would re-fire a toggle layer per repeat tick.

### Readout placement

20. **The readout moves out of the keyboard column into the legend row as a right-hand cell and
    renders unconditionally** (`justify-between`: badges left, readout right) — that is literally
    AC 6, and it makes "entering test mode does not shift the layout" true by construction instead
    of by tuning a height.
21. **Outside test mode the readout shows an inactive hint ("Start test mode to see what a key
    does") instead of the press placeholder** — a permanently visible strip inviting a keypress
    while nothing is listening would be a new lie in place of the old one.
22. **The readout becomes its own component `components/TestModeReadout.tsx` taking the resolved
    press as a prop** — `OverviewKeyboardPanel.tsx` is already the module's largest file and this
    story adds a state machine to it; the presentational half has no reason to live there
    (`/frontend-guidelines`).
23. **`CAPTURE_MAX_HEIGHT_REM` and the chain rendering (`resolveAliasChain` +
    `resolveCommandLabel`) move along unchanged** — the capped, internally scrolling strip is what
    keeps a long alias chain from resizing the row, and the move does not affect that reasoning.

### Scope

24. **This story builds on 017's merged state** (no `editMode`, two-branch `capture()`, uniform
    `cursor-pointer`, `trigger.layerLabel`) and does not re-add, re-remove or re-style the click
    path — 017 owns clicks, 018 owns physical presses.
25. **No IPC, no main-process and no shared-type change** — everything here is renderer display
    state over data `alt-layers.ts` and `modifier-layers.ts` already expose, so nothing belongs in
    `src/shared/ipc.ts` (`/electron-arch`: nothing crosses a process boundary).

## Plan

Renderer-only: one new pure helper, one new presentational component, and the state machine in the
panel. References are to the post-017 file state.

1. **`lib/test-mode.ts` (new, pure)**
   - `TestPress = { key } & ({ kind: 'trigger'; layerId; layerName; mode: AltLayerMode; alias: string | null } | { kind: 'override' | 'base'; command: string; layerName?: string } | { kind: 'unbound' })`.
   - `resolveTestPress(key, { binds, layers, actions }, displayedLayerId): TestPress` — order per
     decision 2; the trigger branch calls `generateLayerAliases` for `alias`.
   - `applyTriggerPress(state, press)` / `applyTriggerRelease(state, key)` over
     `state = { displayedLayerId: string | null; heldTrigger: { key; restoreLayerId } | null }` —
     hold sets and remembers, release restores, toggle uses `triggerSelectTarget`.
   - Tests in `test-mode.test.ts` (mirror `lib/trigger-keys.test.ts`).
2. **`components/TestModeReadout.tsx` (new)** — props `{ press, testMode, actions }`; renders the
   capped strip: key in a `stencil` span, then the trigger line (layer, mode, alias), or the
   resolved chain plus a base/layer source tag, or `noBind`, or placeholder / inactive hint.
3. **`OverviewKeyboardPanel.tsx`** — state and wiring:
   - `captured` becomes `press: TestPress | null`; new `pressedKeys`, `testLayerId`, `heldTrigger`.
   - `displayedLayer` derived from `testMode ? testLayerId : activeLayer?.id`, used by
     `keyVisual`/`keyLabel`/`capture`.
   - keydown effect: resolve → `setPress`, add to `pressedKeys`, trigger → `applyTriggerPress`.
     New keyup effect: remove from `pressedKeys`, `applyTriggerRelease`. New `blur` listener plus
     the test-mode-off and profile-switch effects: clear `pressedKeys`, `heldTrigger`,
     `testLayerId`, `press`.
   - mousedown/mouseup listeners per decisions 16-18; keycap buttons get `data-keycap`.
   - `keyVisual`: a pressed key appends `ring-2 ring-inset ring-ink` to the existing cascade.
   - Legend row: badges + the 5th "Pressed" badge left, `<TestModeReadout/>` right; the old
     `{testMode && (...)}` strip inside the keyboard column is deleted.
4. **i18n** (`src/renderer/src/i18n/locales/en.json`, node `config.overview`): add
   `legend.pressed`, `testMode.inactive`, `testMode.sourceBase`, `testMode.sourceLayer`,
   `testMode.triggerActivates`, `testMode.triggerAlias`, `testMode.mode.hold`,
   `testMode.mode.toggle`; keep `testMode.start/stop/noBind/placeholder`.
5. **Verify:** `npm run typecheck`, `npm test`, `npm run build`, then the live pass below (through
   026's harness if it has landed).

Order: D1 → D2 → D3 → D4 → D5 → D6. D3-D6 all edit `OverviewKeyboardPanel.tsx` and must not run in
parallel.

## Deliverables

### D1 — Pure test-mode resolver + layer-switch reducer (with tests) [x]

`resolveTestPress`, `applyTriggerPress`, `applyTriggerRelease` and the `TestPress` type.

- Files: `src/renderer/src/modules/config/lib/test-mode.ts` (new),
  `src/renderer/src/modules/config/lib/test-mode.test.ts` (new).
- Mirror: `lib/trigger-keys.ts` / `.test.ts` for module shape, key normalization and test style;
  `generateLayerAliases` and `AltLayer` from `src/shared/config/alt-layers.ts`.
- Acceptance: `npm test` green, covering — a hold layer's trigger resolves to `kind: 'trigger'`
  with `mode: 'hold'` and the `+`-prefixed alias; a toggle layer's trigger resolves with its
  dispatch alias; a layer whose `triggerBind` is `null` still resolves as `trigger` with
  `alias: null` (never `unbound`); with a layer displayed, a key with an override resolves
  `kind: 'override'` carrying the layer name and one without falls back to `kind: 'base'`; an
  unbound key resolves `unbound`; **a 016-style fixture (layer `Alt`, trigger `ALT`, override on
  `R`) reports the trigger for `ALT` and the override for `R`** (AC 7); `applyTriggerPress` on a
  hold trigger sets the layer and remembers the previous one, `applyTriggerRelease` restores it, a
  second hold press replaces the held trigger, and a toggle press flips layer↔base and is
  unaffected by a release.
- Covers: AC 1 (rule), AC 2 (rule), AC 3 (rule), AC 7.

### D2 — `TestModeReadout` component, telling the truth about the source [x]

The strip as its own presentational component, rendering all `TestPress` kinds plus the
placeholder and the outside-test-mode hint.

- Files: `src/renderer/src/modules/config/components/TestModeReadout.tsx` (new),
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: the current inline strip in `OverviewKeyboardPanel.tsx` (markup, `CAPTURE_MAX_HEIGHT_REM`,
  `resolveAliasChain`/`resolveCommandLabel` usage) — move it, do not redesign it;
  `components/LayerSwitcher.tsx` for the component's file shape.
- Acceptance: a trigger press renders layer name + hold/toggle + the alias; an override press
  renders the chain plus a "layer <name>" tag and a base press the same chain plus a "base" tag; an
  unbound press renders `noBind`; `press === null` in test mode renders the existing placeholder;
  outside test mode the inactive hint; a long chain scrolls inside the capped strip instead of
  growing it; every string comes from `t(...)`, no literal English in the component.
- Covers: AC 1 (surface), AC 3 (surface), AC 6 (content).

### D3 — Test mode drives the displayed layer [x]

`testLayerId`/`heldTrigger` state, `displayedLayer` replacing `activeLayer` in the keycap
renderers, keydown/keyup wired to D1's reducer, `LayerSwitcher` coherence, and the AC 5 teardown.

- Files: `src/renderer/src/modules/config/OverviewKeyboardPanel.tsx`.
- Mirror: the existing `testMode` keydown effect (capturing listener, `resolveQuakeKeyName`,
  `preventDefault`, `event.repeat` skip) for the new keyup and blur listeners.
- Acceptance: in test mode, holding a hold layer's trigger puts that layer on the board (its
  overrides visible, 014's trigger keycap intact) and releasing returns to what was shown before;
  a toggle layer's trigger switches to the layer on one press and back on the next; a key pressed
  while a layer is displayed reports `override` when that layer has one and `base` when it does
  not; `LayerSwitcher`'s highlighted entry always matches the board and picking an entry there
  works inside test mode too; stopping test mode, switching profiles or blurring the window
  restores the previously selected layer and drops the hold state; the `KeyBindDialog` mount still
  scopes to `activeLayer`.
- Covers: AC 2, AC 3, AC 5 (layer half).

### D4 — Pressed keys light up [x]

The `pressedKeys` set, the ring treatment in `keyVisual`, the legend entry, and clearing on
release, blur and mode exit.

- Files: `src/renderer/src/modules/config/OverviewKeyboardPanel.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: `keyVisual`'s existing `cn(...)` tone cascade — append a branch, do not restructure the
  ones above it; the legend's existing `Badge` row for the 5th entry.
- Acceptance: holding several keys at once highlights all of their keycaps simultaneously in every
  cluster (main board, nav, arrows, numpad, mouse block); releasing one removes only its own
  highlight; the highlight composes with the bound/override/trigger tones instead of replacing
  them; blurring the window or leaving test mode leaves no keycap lit; the legend shows a "Pressed"
  entry carrying the same treatment; no raw palette value or hex is introduced.
- Covers: AC 4 (keyboard), AC 5 (highlight half).

### D5 — Physical mouse buttons [x]

`mousedown`/`mouseup` listeners, the Quake button mapping, `data-keycap`, and the "a click on a
keycap wins the readout" rule.

- Files: `src/renderer/src/modules/config/OverviewKeyboardPanel.tsx`.
- Mirror: D4's `pressedKeys` handling — a mouse button is just another entry in the same set.
- Acceptance: in test mode, holding left/right/middle/back/forward highlights `MOUSE1`/`MOUSE2`/
  `MOUSE3`/`MOUSE4`/`MOUSE5` respectively and releasing clears them; a mouse press over empty panel
  space fills the readout with that button's bind; clicking a keycap still reports the *key* (not
  `MOUSE1`) while `MOUSE1` highlights; the wheel changes nothing; blur clears mouse highlights too.
- Covers: AC 4 (mouse).

### D6 — Readout moved into the legend row [x]

Legend row becomes badges-left / readout-right, the readout renders unconditionally, and the old
conditional strip under the keyboard is gone.

- Files: `src/renderer/src/modules/config/OverviewKeyboardPanel.tsx`.
- Mirror: the header row's own `flex flex-wrap items-center justify-between gap-3` pattern, so the
  readout lines up under the test-mode button cluster.
- Acceptance: the readout is visible with and without test mode, in the legend row's right-hand
  cell under the test-mode button; entering and leaving test mode does not move the keyboard by a
  pixel (the keyboard column contains no readout any more); at a narrow window width the strip
  wraps or scrolls instead of pushing the legend badges out of the row.
- Covers: AC 6.

## Model Hints

- D1 → default. Pure functions with a spelled-out test list and one existing shared function to call.
- D2 → default. A move plus new branches in a presentational component.
- **D3 → `deliverable-hard`.** Two overlapping state machines (hold/toggle layer display vs.
  013/014's selected-layer visuals) meet inside the same `keyVisual` cascade: swapping
  `activeLayer` for `displayedLayer` in the wrong place silently breaks 014's trigger keycap or
  013's switcher, and the AC 5 teardown has to cover four exit paths (mode off, blur, profile
  switch, key release).
- D4 → default. One class-list branch plus a set of pressed keys.
- D5 → default. Small listener with a fixed mapping table.
- D6 → default. Layout move of markup D2 already extracted.
- Review: → `story-review-hard`. Four of six deliverables edit the same hot component in sequence,
  on top of 017's fresh rewrite of it, and the failure mode (a stuck highlight, or the board
  showing one layer while the readout resolves against another) is invisible in a green build.

## Test Plan (manual acceptance)

Live pass through the running app (`npm run dev`, `live-smoke-required: true`). Precondition: a
profile with a hold layer (trigger `-`), a toggle layer (trigger `\`), an override on `R` inside
the hold layer, a base bind on `R`, and one key bound only in the base layer.

1. Config → profile → Overview. **Before** starting test mode: the readout strip sits in the legend
   row on the right, under the Start test mode button, showing the inactive hint. Note the
   keyboard's vertical position.
2. Start test mode. The keyboard has not moved; the readout now shows the "press a key" placeholder.
3. Hold `A` and `S` together → both keycaps show the pressed ring at once. Release `A` → only `S`
   stays lit. Release `S` → nothing lit.
4. Press and hold the hold layer's trigger `-` → the readout names the layer, `hold` and the `+…`
   alias (not "Not bound"), and the board switches to that layer. Still holding, press `R` → the
   readout shows the layer's override command, tagged as coming from that layer. Release `-` →
   board back to base; press `R` → the base bind, tagged base.
5. Press the toggle layer's trigger `\` → the readout names the layer, `toggle` and its dispatch
   alias; the board switches. Press it again → back to base.
6. Hold the left mouse button over empty panel space → `M1` lights up; release → clears. Then click
   a keycap → the readout reports that key, with `M1` only lit while the button is down.
7. While holding `-` and `A`, click another window (focus loss), then come back: no keycap is lit
   and the board is on base again.
8. Stop test mode → the layer selected before step 2 is displayed again, the readout shows the
   inactive hint, the keyboard has not moved.
9. Switch profile while test mode is on → test mode is off, nothing lit, readout reset.
10. 016 check: in the Controls tab assign an action by holding Alt and pressing `R` (auto-creates
    the `Alt` layer), return to Overview, start test mode, press `ALT` → the readout names the
    `Alt` layer, `hold` and its alias; keep holding and press `R` → the modifier override is
    reported, not "Not bound".

## Done

Test mode now resolves every physical key press through a pure resolver
(`lib/test-mode.ts`): trigger → displayed layer's override → base bind →
unbound, so a layer's own trigger key never reads "unbound" and a
016-style modifier bind (Alt+R) is reported the same way as a hand-made
layer. Pressing a hold layer's trigger puts that layer on the board for as
long as it is held (restoring the previous layer on release); a toggle
layer's trigger flips between its layer and base. Every physically held
key or mouse button (via `mousedown`/`mouseup`, Quake's MOUSE1-5
numbering) lights up its keycap with a ring that composes with the
existing bound/override/trigger tones; a 5th "Pressed" legend entry names
it. The readout moved into its own component (`TestModeReadout.tsx`) and
now lives permanently in the legend row's right-hand cell, unconditionally
rendered (inactive hint outside test mode, placeholder inside), so
entering/leaving test mode no longer shifts the keyboard.

A clean review (story-review-hard tier) found three confirmed bugs before
close, all fixed:
1. The `editHint` paragraph was unmounted (not just hidden) outside test
   mode, so the header column's height — and therefore the keyboard below
   it — shifted by one line when toggling test mode (AC 6). Fixed by
   keeping the paragraph mounted and toggling `invisible` instead.
2. `blur` only released a *held* trigger, leaving a *toggled* layer
   displayed and the readout stale after a focus loss. Fixed to fully
   tear down test-mode display state on blur (restores `activeLayer`,
   clears `press`/`pressedKeys`), matching stop-test-mode/profile-switch.
3. `pressedKeys` was a flat `Set` keyed by the resolved Quake name, so
   ShiftLeft/ShiftRight (and Ctrl/Alt) collapsed to one entry: releasing
   one physical modifier cleared the highlight — and ended a
   modifier-triggered hold layer — while its twin was still held. Fixed
   with a physical-code reference count per Quake key name.

A temporary Playwright flow (`scripts/flows/test-mode-018.mjs`, deleted
after use, not part of the permanent registry) drove the real Electron
app against the `Layered Profile` fixture (hold layer `Drops`, trigger
`ALT`, override on `1`/`2`): confirmed the keyboard's Y position is
pixel-stable across start/stop, two keys can be held and released
independently, holding `ALT` switches the board to `Drops` and the
readout names it correctly, and releasing `ALT` returns to base. A toggle
layer and the AC 7 modifier-bind path were not separately live-smoked
(no toggle-layer/Controls-tab-created-modifier fixture profile exists) —
both are covered by D1's unit tests, which exercise the exact same
resolver/reducer code the UI calls.

**Decisions**
- Decision 4's "`triggerBind` is null" branch is unreachable through the
  real `generateLayerAliases` (it returns `null` only when `triggerKey`
  itself is blank, which `resolveTestPress` can never match on) — kept
  the defensive branch as the story asks and exercised it with a mocked
  `generateLayerAliases` in one test, rather than skipping coverage or
  reshaping the resolver around an impossible case.
- The legend's "Bound in an alt layer" badge dim now also follows
  `displayedLayer` (not just `activeLayer`), one token beyond decision
  12's enumerated list — kept as a small, commented, in-scope coherence
  fix: without it the legend would call a layer "not in play" while its
  overrides are visibly on the board, the same lie AC 3 exists to remove.

**Commit message**

018: test mode reports trigger activation, drives the displayed layer, and highlights every physical press

**Verification:** `npm run build`, `npm test` (579/579), `npm run typecheck`
all green. Live smoke via a temporary `ui:flow` script against the real
Electron app, see above. `npm run ui:verify`'s overall exit code is 1
only because of the pre-existing, unrelated `config-raw` crash noted in
the sprint context — `config-overview` itself screenshots and audits
clean at both viewports.
