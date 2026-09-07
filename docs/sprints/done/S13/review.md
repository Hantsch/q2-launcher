# Sprint S13 Review — Order by hand, Care gets out of the way

## Overview

Goal: everything that has an order in Controls and Settings can be arranged by drag and drop with
a keyboard path kept, and Care turns from a dashboard of sections into a to-do list that shows one
calm block when there is nothing to do. Both stories were built, reviewed and merged onto
`sprint/S13`.

| Story | Status | Commit |
| --- | --- | --- |
| 054 — Order everything by drag and drop | done | `054: order everything by drag and drop` |
| 058 — Care says only what needs doing | done | `058: care says only what needs doing` |

## Implemented stories

**054 — Order everything by drag and drop.** Added `@dnd-kit` (`core`/`sortable`/`utilities`/
`modifiers`) as the renderer's first drag-and-drop dependency, behind one shared primitive
(`components/dnd/`). Controls rows now drag within and across sub-categories, onto another
category (chip drop, or a ~600ms spring-loaded switch to drag into that category's own grid),
and sub-category headers plus category chips reorder the same way. Settings sections,
sub-sections and cvars are drag-reorderable on the same primitive. The old inline move-up/down
buttons were replaced by a row kebab menu (Move up / Move down / Move to…) as the keyboard path,
alongside dnd-kit's own keyboard sensor. All reorders persist through the existing save/dirty/
Discard path; a genuine pre-existing bug was found and fixed in passing — `cvarSections` was never
captured by baseline/Discard and had drifted into a *required* schema field, silently dropping
every pre-story baseline on read.

**058 — Care says only what needs doing.** Care is now one derived to-do list. A new
`lib/care-items.ts` folds validation findings, out-of-sync files and tidy-up findings into one
grouped, errors-first list; a healthy profile renders a single "All clear" summary line per
checked area instead of four section panels with empty-state illustrations and a disabled button.
Five components were deleted outright (`ValidationPanel`, `PreservedLinesPanel`,
`CareSyncSection`, `CareTidyUpSection`, `RawConfigPanel`). The installation-wide redundant-copies
cleanup moved out of the profile's Care tab entirely, into a new per-installation dialog on the
Library installation row, reusing the existing scan → review → apply → undo flow unchanged. A
"Show in Controls" deep link was added next to the existing "Show in Aliases" link.

## Findings & decisions

Aggregated from both stories' `## Decisions (Sprint)` / Done sections and their review cycles —
input for future sprint planning:

- **Cross-category drops went beyond the story's own recommendation.** The user chose to allow
  dropping directly into another category's grid (not just onto its chip), which 054 implemented
  as a ~600ms hover-triggered "spring-load" switch mid-drag. This is the single most complex piece
  of interaction in the story; worth watching in practice for accidental category switches during
  fast drags.
- **Two structural gaps were found and fixed as pre-existing bugs, not new regressions:**
  `cvarSections` missing from baseline/Discard capture (054) and a nested-modal Escape/Tab-trap
  route that could strand the destructive cleanup flow's Undo affordance (058, found across two
  review cycles). Both are now covered by tests.
- **A file-reset incident during 054's build** (a subagent ran `git show HEAD:<path> >` on
  `ControlsTab.tsx`, silently discarding D4–D7's wiring) was caught before commit via a diff-stat
  check and fully reconstructed; disclosed in the story's Done section. Worth keeping in mind for
  future sprints: destructive shell one-liners inside a build agent are exactly the kind of action
  that needs a routine safety check (`git diff --stat` against HEAD) before moving on.
- **058 crossed a module boundary deliberately**: `CleanupPanel` (owned by `modules/config`) is now
  imported from the Library view — the first cross-module renderer import in this repo. Accepted
  because the `module:invoke` seam (`moduleId/type`) that `docs/ARCHITECTURE.md` actually guards is
  unaffected; Library only contributes the trigger UI. Worth a note in `ARCHITECTURE.md` if this
  pattern repeats.
- **Both stories carry small, disclosed scope trims**: 054's cross-category chip drop-onto a
  `Defaults`/`Other` reserved Settings bucket stays a silent no-op (pre-existing invariant, out of
  scope); 058's `care-fix-item` flow checks only that the fixed row disappears, not that the
  All-clear block reappears (the fixture profile has other pre-existing findings unrelated to this
  story).
- **Grip column width deviated from the Decisions section**: 054 named 20px, landed at 28px because
  an accessible `IconButton`-sized grip does not fit in 20px. A minor spec/implementation gap worth
  noting for future sizing decisions made before the component exists.

## Blocked / open

None. Both stories completed with status `done`; no story was blocked in refine or build.
