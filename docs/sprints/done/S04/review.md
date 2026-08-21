# Sprint S04 Review — Authoring surfaces, and a harness that can prove them

## Overview

**Goal:** the three surfaces you actually author a config in — Overview, Controls (renamed from
Advanced) and Settings — behave and look like the prototypes, and a committed harness can prove
it without a manual pass. Both landed: all six stories are done, and the harness (026) was used
to live-smoke every subsequent story as it built.

| Story | Status | Commit |
| --- | --- | --- |
| 026 — UI verification harness | done | `aa7b5ee` |
| 017 — Overview: editing is the default | done | `910b7ad` |
| 018 — Test mode: layers + key feedback | done | `662a868` |
| 019 — Controls: entry types + ordering | done | `b918001` |
| 020 — Controls: column-grid redesign | done | `c431f2d` |
| 021 — Settings: dense-rows redesign | done | `aea3c9b` |

No story was blocked. `npm run build`, `npm run typecheck` and `npm test` are green after every
story (697 tests at the end of the sprint); every story went through a clean-agent review
(`story-review-hard` for 018–021) with at least one fix cycle for 019, 020 and 021 before PASS.

## Implemented stories

- **026 — UI verification harness.** `npm run ui:verify` builds/launches the real Electron app
  from an isolated `--user-data-dir` fixture, screenshots every screen at two viewports, runs
  axe-core, and exposes a scriptable flow API — one command, documented in
  `docs/UI-VERIFICATION.md`. Used for live-smoke on every story below instead of a manual pass.
- **017 — Overview edit-by-default.** The edit-mode toggle is gone; any keycap click outside
  test mode opens the bind dialog directly. The trigger-keycap collision with 013/014's
  click-to-switch-layer was resolved by retiring that click behaviour entirely — layer switching
  now only happens inside test mode (018).
- **018 — Test mode.** Pressing a layer's trigger key in test mode now correctly reports and
  drives the displayed layer (the "unbound" bug is fixed), every physically held key/mouse
  button highlights simultaneously, and the readout is a permanent single-slot fixture in the
  legend row.
- **019 — Controls entry types + ordering.** `entryKind` moved off the category and onto the
  entry (`bind` | `message` | `alias`); an alias has no key slot and cannot be bound through the
  UI; a binding can reference an alias by name with suggestions; entries reorder by hand and the
  order round-trips through persistence and IPC. Purely the data model — no visual change.
- **020 — Controls column-grid redesign.** "Advanced" is renamed "Controls" and rebuilt against
  the column-grid prototype: capped width, sticky headers, always-visible bind cells, profile-
  wide conflict detection, a scrollable category rail, and a whole-profile "Restore defaults".
- **021 — Settings dense-rows redesign.** Rebuilt against the dense-rows prototype: grouped by
  real cvar group with sticky headers, a value-vs-default column with a changed-accent marker,
  inline engine caveats, and an "Advanced" collapse for rarely used cvars — autosave and the
  story 009 facts layer are unchanged.

## Findings & decisions

Aggregated from each story's `## Decisions (Sprint)` and the build agents' reports — relevant
input for future sprint planning:

- **017/018 click-semantics split is load-bearing.** Outside test mode a trigger keycap behaves
  like any other keycap now; layer-switching-by-interaction lives entirely in test mode. Any
  future Overview feature must respect that split rather than reintroduce a click-to-switch path.
- **`AltLayer.overrides` derived-state rule held** through 019's entry-model rework — alias
  entries are excluded at the single derive site (`applyActionLayerMirror`), row identity stayed
  `action.id`. No regression of the S03 carry-over rule.
- **019's migration is forgiving, not versioned**, per the user's decision: `kind` is derived
  from a legacy category's `entryKind` on read, no `STATE_SCHEMA_VERSION` bump. The persisted
  schema still accepts and drops a legacy `entryKind` field so an old `state.json` doesn't lose
  rows.
- **Two review-caught regressions worth naming for future stories:** 019's first fix cycle
  introduced a bug where the stale-bind cleanup matched by key/slot instead of value, risking
  deletion of unrelated legitimate binds (caught and fixed in a second cycle); 021's first pass
  had a "Reset all" that wrote engine defaults instead of clearing catalogue keys. Both were
  caught by `story-review-hard`, not by tests — the review step earned its keep this sprint.
- **Design-tokens deviation, recorded in `CLAUDE.md`:** 020/021 keep the prototypes' compact row
  sizing (40px row, 30px/26px controls) rather than the design-tokens skill's 44px touch floor,
  because this is a desktop mouse-and-keyboard app with no touch surface.
- **The harness (026) found real product bugs by existing**, not just UI bugs in the stories it
  was built to verify: a pre-existing crash in `RawConfigPanel.tsx` on the `config-raw` route
  (double-unwrapped `Outcome`) makes `ui:verify`'s overall exit code `1` even on an otherwise
  clean run. Filed as a gap, not fixed here (out of scope for the stories that found it).
- **New backlog story filed from using the harness in anger:** 027, "UI verification runs in
  one session per fixture, without stealing focus" — the harness currently starts the app 56
  times per full run (~2 minutes, focus-stealing), against 3 in the sister project's harness.
  Not yet sprinted; a good S05 candidate alongside the profile-as-a-file cluster.

## Blocked / open

None of the six stories were blocked. Two follow-ups were filed as new draft requirements
instead of being fixed inline, since both were outside the scope of the stories that surfaced
them:

- **`RawConfigPanel.tsx` config-raw crash** (found during 026's own build) — needs a story of
  its own; currently only noted as a known-issue in the roadmap's S04 gaps.
- **Story 027** (harness session/focus performance) — drafted, not refined or sprinted.

Everything else in this sprint's scope is done and passed its automated verification plus a
harness-driven live smoke; see `testplan.md` for the manual acceptance steps to run on a real
desktop before calling S04 accepted.
