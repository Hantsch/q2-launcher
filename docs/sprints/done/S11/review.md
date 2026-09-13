# Sprint S11 Review — Controls reflects the file's structure

## Overview

Goal: Controls becomes an editor of *my* config rather than a catalogue with my config laid over
it — categories and sub-categories on screen are the ones my file has, every row and category can
be renamed/moved/deleted, extra keys group under the primary row, and a `drop_` alias is a drop
wherever it lives.

| Story | Status | Commit |
| --- | --- | --- |
| 052 — Controls shows my categories, the template only seeds them | done | `220d89a` profile-owned categories, template-only seeds |
| 053 — Sub-categories come from the file, and Controls shows them | done | `706d862` sub-categories come from the file |
| 056 — Extra keys group under the primary row | done | `dc990fb` extra keys fold into indented sub-rows under one Key column |
| 055 — A `drop_` alias is a drop, with two toggles instead of two checkboxes | done | `418d21d` drop_ alias is a drop, with two toggles |

All four stories in the sprint list are done. No blocked stories.

## Implemented stories

**052** — Categories are now ordinary, persisted, ordered data on the profile: the three former
built-ins (Movement / Weapons / Weapon dropping) lost their special-case status and became a
seed template. Every category can be renamed, deleted (with a delete-or-move-entries choice) and
reordered from the rail; rows render only for entries the profile actually has. An unbound
catalogue-derived row now survives Save/reload as a commented-out bind line in the file, and a
one-time migration materialises every catalogue row into existing profiles so nothing disappears.

**053** — Categories can now hold sub-categories (a second header level), sourced from and written
back to the file as second-level section banners. Controls shows them as group headers with
ungrouped entries first; sub-categories can be created, renamed, reordered, deleted (entries stay
in the parent) and entries can be moved in/out via the action editor. Foreign two-level configs
(`.: Main Key's :.` / `##### 1st row #####`-style decoration) are recognised on import instead of
being flattened into a `Main / Sub` category name.

**056** — The grid's Primary/Secondary columns became one Key column: the first key is the main
row, every further key is an indented sub-row (key cap, conflict marker, clear), folding behind a
"+n" chevron once there are two or more extras. Clearing the primary key promotes the next one;
"add key" starts capture for a new slot. Every key of every entry is now editable in Controls, not
only in Care's tidy-up view.

**055** — Any entry whose alias name starts with `drop_` and whose body contains a `drop <item>`
command is now recognised as a drop in any category, imported or created, via one shared
recognition module (`drop-entries.ts`). The two stacked checkboxes became two icon toggle buttons
("Drop ammo too" / "Announce to team") in Controls, and — per the user's decision, a deviation from
the story's own "no" recommendation — the same toggles were added to the Aliases tab row action
cluster.

## Findings & decisions

- **Carry-over risk materialised as expected.** All three file-format-touching stories (052, 053,
  055) needed at least one review-fix cycle against story 042's round-trip fixed-point property;
  052 and 053 each caught one real defect this way (052: category ordering lost for block-disjoint
  categories, fixed via a new `ord` tag; 053: a foreign outer header with unrecognised decoration
  silently dropped its sub-category markers, fixed via `mirroredWrapTitle` recognition). The
  sprint's "budget an adversarial re-render pass, don't trust a diff read" note paid off — worth
  keeping as standing practice for any story touching `render.ts`/`profile-restore.ts`.
- **056 needed three review cycles**, the most of any story this sprint: cycle 1 found a raw/
  compacted key-index bug that could destroy binds on a plain row; the cycle-1 fix introduced a
  second index-mismatch regression in collision self-exclusion, caught by cycle 2 and fixed with a
  new `rawKeyIndex` helper. Two index spaces (raw file-order slots vs. compacted UI-visible slots)
  are an easy place to reintroduce this class of bug — any future change to key-slot rendering
  should treat that boundary as load-bearing.
- **055's Open Questions answer deviated from the story's own recommendation**: the user chose to
  show the drop toggles in the Aliases tab too (recommendation was "no, Controls is the editor").
  Refine and build both honoured this; it is now the documented behaviour, not a residual gap.
  Follow-on: the Aliases tab currently has no message-edit affordance for a drop row short of
  delete+recreate (documented as accepted in 055's Done section) — worth a small story if it comes
  up in acceptance.
- **Disclosed residual limitations, not silently absorbed** (each has a one-line reason in its
  story's Done section — read there for detail, not repeated in full here):
  - 052: an empty category does not survive rebuild-from-file.
  - 053: an empty sub-category's banner is written into every per-block section, adding cosmetic
    noise to fresh-template profiles; a duplicate sub-category id / hand-deleted-name edge case is
    unreachable via the UI.
  - 056: `ActionEditor`/`MessageEditor` still read the raw slot-0 index (self-healing, no data
    loss); the Options track landed 10px narrower rather than wider as the acceptance criteria
    implied; `appendKeySlot` is unused dead code; a minor DOM-wrapper markup deviation; a cosmetic
    sub-row width mismatch.
  - 055: the ammo toggle is one-way-removable on 6 fixture entries where the item drops its own
    ammo (a direct consequence of the story's own ammo-recognition rule, not a bug); every
    `drops`-category entry is renamed `drop_*` regardless of body shape (cosmetic, self-correcting).
- **Pre-existing, unrelated test-environment issue observed during 055's build**: 6 jsdom-based
  test files (2 of them new, added by this story) fail to *start* under the current vitest/jsdom
  combination due to a `webidl.util.markAsUncloneable` environment bug, confirmed identical
  before and after this story across three verification passes. `npm test` still reports
  81/81 files and 2217/2217 tests passing (exit 0) — this is an environment gap, not a regression,
  and is worth a standalone look outside this sprint's scope. (052's build separately reported 2
  Node-version-only failures on Node 20 that are fully green under Node ≥22, the project's
  supported version.)

## Blocked / open

None. All four stories are done; no open user decision is outstanding.
