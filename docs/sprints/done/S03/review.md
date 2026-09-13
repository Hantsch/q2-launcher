# Sprint S03 Review — Config module UX polish

## Overview

**Goal:** Fix the friction found while running S02's live acceptance pass — alt-layer trigger
reassignment via binding, a more usable alt-layers/keyboard-overview layout, on-keycap trigger
visibility, a raw config view with reveal-in-folder, and a dual-bind editor for Movement/Weapons/
Weapon dropping with modifier-layer auto-creation on capture.

| Story | Status | Commit |
| --- | --- | --- |
| 011 — Trigger assignable via key binding | done (built, live acceptance pending) | `da2c570` |
| 013 — Compact layers panel, switcher moved into overview | done (built, live acceptance pending) | `400bb17` |
| 014 — Trigger key visibility + click-to-switch | done (built, live acceptance pending) | `6444cbd` |
| 012 — Raw config view with reveal-in-folder | done (built, live acceptance pending) | `115437e` |
| 015 — Dual-bind editor (Movement/Weapons/Drops) | done (built, live acceptance pending) | `08b1e67` |
| 016 — Modifier-layer auto-creation on capture | **blocked** (AC5 unresolved) | `29b4f4f` (WIP) |

5 of 6 stories built and reviewed; story 016 is blocked on a genuine design gap, documented below.

## Implemented stories

**011 — Alt layer trigger assignable via key binding, not creation.** `AltLayer.triggerKey` is
now nullable end to end. A layer can be created without a trigger; the trigger is assigned,
moved, or cleared from the keyboard overview's key dialog on the base layer, via two new pure
helpers (`assignLayerTrigger`/`findLayerByTriggerKey`). The existing self-bind/conflict guards
are preserved unchanged.

**013 — Compact layers panel, switcher relocated.** The empty-layers state collapsed to one hint
line; the layer switcher was extracted into its own `LayerSwitcher` component and moved into the
keyboard overview's header, with the board now shown above the layers panel.

**014 — Trigger key visibility and click-to-switch.** A trigger key gets its own distinct keycap
styling (a new `strogg`-toned variant) showing `→ <layer>` / `→ Base`, plus a 4th legend entry.
Clicking a trigger key in idle mode switches the active layer directly, reusing the same
`onSelectLayer` path 013 introduced.

**012 — Raw config view with reveal-in-folder.** A new "Raw file" tab shows a profile's rendered
`.cfg` content per assigned installation, with an on-disk indicator per file and a reveal-in-
folder action that surfaces failures instead of swallowing them. The existing preview dialog was
reduced to reuse the same panel.

**015 — Dual-bind editor for Movement, Weapons and Weapon dropping.** The Advanced tab gained a
Primary/Secondary dual-bind editor for these three categories, backed by a new pure
collision-detection module (`bind-collision.ts`), a catalogue row model, and a reusable key
capture hook. The review-fix cycle caught and fixed two real bugs before this shipped: a
capture-lock UX issue, and a collision-check ordering bug that could have silently swapped bind
ownership between two actions.

**016 — Modifier-layer auto-creation on bind capture (blocked).** The pure modifier-resolution
and layer-upsert logic (D1/D2), the overwrite-warning UX (D4), and the layers-panel mode selector
(D5) are built and pass all three `story-review-hard` review cycles. AC5 — a Weapon-dropping row
must render the identical command whether its binding lives on the base layer or inside an
auto-created modifier layer — is not satisfied. See Blocked / open below.

## Findings & decisions

- **Live UI acceptance is pending for every story in this sprint.** Every story's own code
  verification (build/typecheck/test) passed, and every story went through clean-agent review,
  but the actual `npm run dev` walkthrough could not be performed in this environment (a
  mid-session Node/npm PATH interruption on 011, and more fundamentally: no Playwright or
  `_electron` harness is scaffolded in this repo at all, so no story after 011 could attempt it
  either). All five built stories are handed over as "built, live acceptance pending" — the user
  should run each story's `## Test Plan (manual acceptance)` steps before treating them as fully
  accepted.
- **A committed Playwright/`_electron` harness would materially change this sprint's outcome.**
  The roadmap's existing "Tooling" note about a committed Playwright driver
  ([docs/ROADMAP.md](../../ROADMAP.md)) is now directly actionable: with it, an autonomous sprint
  could close the P2 gap above instead of deferring it every time.
- **Story 015's review-fix cycle found two real, pre-ship bugs** (not just cosmetic
  findings): a capture-lock UX defect (Clear was required before a new capture could start on an
  already-bound slot) and a collision-check ordering bug where a cross-action key collision was
  misreported as a base-bind collision, so Replace could leave two actions silently pointing at
  the same key. Both are fixed and covered by tests. This validates keeping `story-review-hard` +
  a review-fix cycle mandatory for stories flagged as data-loss-risk, rather than trusting a
  green test suite alone.
- **Story 016's blocker is a schema-shape gap, not an implementation bug:** `AltLayer.overrides`
  stores a bare `command: string` with nothing identifying which catalogue row wrote it. Two
  Weapon-dropping rows can produce colliding/overlapping command text (the review's concrete
  repro: the "Grenades" ammo-drop row and the "Hand Grenades" weapon-drop row both render
  `drop grenades`), so any read-back/write-back that re-derives row identity from command text
  alone is not safe. Closing this needs a plan-level decision — e.g. a schema change to
  `AltLayer.overrides` to carry an explicit row/catalogue identity, or establishing (and
  enforcing) a stronger command-text uniqueness guarantee across `action-catalog.ts` — that a
  build session should not make unilaterally. Full three-cycle review history and both superseded
  fix attempts are recorded in
  [016's Done section](../../requirements/016-modifier-layer-on-bind-capture.md#done) for whoever
  picks this back up.
- **This sprint's stories were UX-friction fixes filed after S02's live acceptance pass, not new
  concept scope** — the config-module concept itself already reached full feature parity at the
  end of S02. That framing held throughout: no story here needed to touch
  [docs/systems/config-module.md](../../systems/config-module.md)'s scope, only its existing
  surfaces.

## Blocked / open

**016 — Modifier-layer auto-creation on bind capture.** Blocked on AC5. The question for the
user/next planning pass: should `AltLayer.overrides`' value shape change to carry explicit row
identity (a persisted-schema change touching `AltLayer`, `generateLayerAliases`, and every
existing saved profile's overrides), or is there an acceptable way to guarantee command-text
uniqueness across the action catalogue instead? Recommend routing this back through `/refine`
with that question decided up front, rather than a fourth blind implementation attempt. See the
story's `## Decisions (Sprint)` and `## Done` sections for the full technical context.
