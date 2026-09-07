# Sprint S14 review — The editor's frame gets out of the way

## Overview

**Goal:** stop the config editor's chrome from costing attention — one header shape for every
tab, a category rail that reads as chips instead of nested toolbars, an Unsaved tab that states a
concrete diff, an engine badge wherever an installation is named, and the two grenade rows in
Controls > Weapons take a key again.

All five stories came out of the live acceptance pass on S11–S13, not new scope; 063 is the only
functional defect, the other four are chrome/UX corrections.

| Story | Status | Commit |
| --- | --- | --- |
| 063 — grenade rows take a key | done | `063: grenade rows take a key` |
| 061 — profile header is one row | done | `061: profile header is one row for every tab` |
| 062 — category rail is a clean chip row with an action menu | done | `062: category rail is one chip with an action menu` |
| 064 — unsaved changes read as a real diff | done | `064: unsaved changes read as a real diff` |
| 065 — installation name carries an engine badge | done | `065: installation name carries an engine badge everywhere it is shown` |

Build order followed the sprint plan (063 first — the only functional defect and, at sprint start,
the only story with an unknown cause; 061 before 062/064 since it reshapes the header frame those
render inside; 065 last).

## Implemented stories

**063 — grenade rows take a key.** Root cause: a keyless `kind: 'bind'`/`'message'` entry with a
body earned only an alias line, never an unbound line, so the file carried no signal that its key
slot was deliberately empty; the next file→state pass misread it as `kind: 'alias'`, permanently
inert. Fixed at the file contract (`render.ts#isUnboundEntry` emits the unbound line alongside the
alias line; `profile-restore.ts#inferKind` reads it back and merges the two lines into one entry),
covered by an adversarial round-trip pass, plus a Controls row-menu "Make bindable" repair action
for profiles already damaged by the bug, proven live by a `ui:flow` script.

**061 — profile header is one row.** Replaced the two-shape header (a separate identity block
below the back/actions row; Raw File's own folded variant) with one shared
`config-profile-header` for every tab: back left, identity centred (name, created, updated,
unsaved indicator), actions right — followed by one `config-tab-strip` row, position unchanged.
Raw File funds the header's row by merging its two toolbar rows and tightening the code editor's
padding; the 30-line floor from story 057 is measured, not assumed (31 lines at 1280x800).

**062 — category rail is a clean chip row with an action menu.** The category chip collapsed from
a box-in-a-box (grip + label + four permanent icon buttons) to one visual level: a single
bordered/backgrounded container with a borderless ghost label and a per-category action menu
(mirroring the row's own `ControlsRowMenu`) holding move up/down, rename and delete. Drag-and-drop
is the only pointer reorder mechanism now; the keyboard path for reordering moved into the menu.

**064 — unsaved changes read as a real diff.** `ProfileChange` gained a `details` array
(per-field `before`/`after`, derived structurally from the union of both sides' top-level keys —
not a hand-written field list), so an action or layer change no longer forces the user to compare
two long summary strings by eye. Every row now states a concrete before/after with a text
added/removed/changed marker, a bounded/scrollable value block for long command bodies, and
translated Settings labels. The change count/entry set behind the tab badge is unchanged (AC4).

**065 — installation name carries an engine badge.** Extracted one `EngineBadge` component
(the `r1q2` → flame / else → neutral tone expression previously repeated at six call sites) and
wired it into every surface that names an installation: rail, hero, library card, action bar, both
config-module installation lists, and the two installation dialogs. A third, long-named
unknown-engine fixture installation gives the badge's truncation and "unknown" labelling a real
e2e path.

## Findings & decisions

- **Regression caught and fixed before sprint close:** story 062's new per-category action menu
  gave every chip an accessible name of the shape `Actions for "<Category>"`. Three pre-existing
  `scripts/flows/*.mjs` scripts (`controls-drag-reorder.mjs`, `controls-subcategory.mjs`,
  `drop-message-checkbox.mjs`) selected a category chip with
  `getByRole('button', { name: '<Category>' })` (no `exact: true`), which now also substring-matches
  the new kebab's accessible name and throws a Playwright strict-mode violation. Found during the
  sprint review's own re-verification pass (not caught by any story's own build/review, since none
  of them re-ran every pre-existing flow script), fixed by pinning the three selectors to
  `exact: true`; committed as part of 065.
- **`controls-drag-reorder`'s chip-drop step is flaky under cold start**, independent of the
  selector fix above — it failed once on a cold run and then passed 8/8 on warm re-runs, both
  before and after the S14 diff (reproduced identically against the pre-sprint `dev` baseline at
  commit `413cdf9`). Not a regression from this sprint; worth hardening (e.g. a settle-wait before
  the first drag) as a follow-up, not a blocker.
- **`custom-action-row.mjs` fails identically on the pre-sprint `dev` baseline** ("expected 5 icon
  buttons in the Options cell, found 4") — confirmed pre-existing and unrelated to any S14 story,
  left untouched.
- **`controls-subcategory.mjs` also has a pre-existing failure one step past the chip-selection
  fix** (a sub-category move assertion timing out), reproduced identically on the `dev` baseline —
  pre-existing, unrelated to S14, left untouched.
- Two accepted trade-offs from 063, documented in its Done section: a pre-existing-file-only
  regression where a keyless single-`say` entry now restores as `kind: 'alias'` instead of the old
  `kind: 'message'` (repairable via 063's own "Make bindable" action); and AC3's keyed-round-trip
  coverage for the grenade rows resting partly on generic pre-existing bound-entry tests rather
  than a story-specific reload-from-disk fixture.
- 061 resolved one internal contradiction in its own refine output (two different readings of the
  tab-strip button padding) in favour of the denser `py-1` reading, consistent with the story's own
  "the header wastes vertical space" framing; recorded in its Done section.
- 061 also fixed a latent `Select`/`IconButton` sizing bug (a `cn()` override losing to
  `FIELD_BASE` for lack of tailwind-merge) at its one Raw File call site while closing the line
  budget.
- No story needed more than one review-fix round; none hit the `render.ts`/`profile-restore.ts`/
  `alias-render.ts` carry-over rule except 063, which is exactly the story the rule exists for.

## Blocked / open

None. All five stories are `done`; nothing is blocked.

## Acceptance

Every criterion below is proven by an automated test named in its story's Done section (also
summarized here); none required a manual walk-through.

- **063:** AC1/AC2 → e2e `ui:flow -- grenade-rows-take-a-key` + `catalog-binds.test.ts`. AC3 →
  `round-trip.test.ts` + `render.test.ts`. AC4 → `round-trip.test.ts` (four distinct `catalogId`s).
  AC5 → `round-trip.test.ts` regression case, written to fail first on the un-fixed code.
- **061:** AC1–AC5 → `scripts/flows/config-header-geometry.mjs` (single-row bound, identity
  uniqueness, cross-tab rect equality, the measured 30-line floor at 31 lines/18px margin, and the
  940x620 wrap/hit-test check).
- **062:** AC1–AC6 → `ControlsTab.category-menu.test.tsx` (unit) + unmodified
  `ControlsTab.category-drag.test.tsx`/`ControlsTab.dnd.test.tsx` (regression guard) + e2e
  `ui:flow -- controls-category-rename-reorder`.
- **064:** AC1–AC4 → `profile-diff.test.ts` (46 cases) + `ProfileChangeList.test.tsx` (5 cases) +
  e2e `ui:flow unsaved-diff`.
- **065:** AC1–AC5 → `EngineBadge.test.ts` + `InstallationProfilesPanel.test.ts` + e2e
  `ui:flow engine-badge-surfaces`.

No manual residue in any of the five stories — every acceptance criterion has an automated test,
so `testplan.md` is not written this sprint (per the profile's `testplan: optional` setting).

Full-suite state at sprint close: `npm run build`/`typecheck` green; `npm test` 2632/2633 (the one
failure, `import-reader.test.ts`'s 512-file-exec-limit case, is a pre-existing timeout flake under
full-suite parallel load, confirmed unrelated by a clean standalone 32/32 pass — not touched by
any S14 story); `npm run ui:verify` 34/34 screens, 68 shots, 0 axe violations, with the new
three-installation fixture in place.
