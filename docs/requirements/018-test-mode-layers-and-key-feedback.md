---
id: 018
title: Test mode — trigger keys switch layers, pressed keys light up, readout always visible
status: draft # draft -> ready -> in-progress -> done
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

- [ ] Pressing a layer's trigger key in test mode shows that layer's activation (layer name, mode
      hold/toggle, and the generated alias that fires) — never "unbound".
- [ ] Pressing a trigger key switches the displayed board to that layer: for a `hold` layer while
      the key is held (back to base on release), for a `toggle` layer on each press.
- [ ] While a layer is displayed, a following key press resolves through that layer's overrides
      first and falls back to the base bind, and the readout says which of the two it used.
- [ ] Every physically pressed key/mouse button is visibly highlighted on its keycap while held,
      several simultaneously; release removes the highlight.
- [ ] Losing window focus or leaving test mode clears all highlights and any hold-layer state —
      no keycap stays stuck lit.
- [ ] The readout sits permanently in the legend row's right-hand column below the test-mode
      button, with a placeholder when nothing has been pressed yet; entering/leaving test mode
      does not shift the keyboard's layout.
- [ ] A modifier-derived bind (story 016 `keyModifier`) is reported the same way as a hand-made
      layer, so Alt+R does not read as "unbound" either.

## Open Questions

- Should the readout keep a short history (last 3 presses) instead of only the latest? A single
  slot loses the previous key the moment a hold layer's trigger is pressed together with a key.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
