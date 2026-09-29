---
sprint: S27
status: in-progress # planned | in-progress | done
branch: sprint/S27
milestone: 10.4–10.5 — Demo list, detail, edit & file actions
---

# Sprint S27 — Demo browser, part 2 — list, search, detail and editing

## Goal

The Demos view shows every indexed demo as a row with explicit loading/empty/error states, favourites first then newest, full-text search and filters incl. date, and a detail view to describe, reveal, copy the path of and rename a demo — zip entries visibly read-only with their reason.

## Stories (in build order)

- [x] 150 — a demo row says what it is
- [x] 151 — the demo list says what it's doing
- [x] 152 — favourites first, then newest
- [x] 153 — I search and filter my demos
- [x] 154 — I filter demos by date
- [x] 155 — I describe a demo the way I remember it
- [x] 156 — I find a demo on disk
- [x] 157 — I rename a demo and its notes move with it
- [x] 158 — an archive entry says why it cannot be edited

## Notes

- Builds on S26's index, sidecar and precedence layer.
- Phase 10 is cut into three sprints (S26 data layer → S27 list/detail UI → S28 playback), so each
  sprint is refined against code the previous one has built and the regression gate runs three
  times instead of once.
- Numeric order is the build order; every `[[NNN]]` reference to a higher id is a "used later"
  mention, not a dependency.

## Regression gate

Ran after the last story (158), on the finished branch, commit `f872db8`.

- `npm run build` — green (~3s).
- `npm test` (full) — green: 373 files, 5496 passed, 8 skipped, 0 failed (~20s).
- `npm run ui:verify` (full) — **red**: `replays-date-filter-invalid@940x620` unreachable
  (`replays-demo-list` never became visible on the screen's second, narrower-viewport visit within
  the same session).
- `npm run ui:flows` (e2e-all) — **red**, 86/91 passed (~31 min): `replays-extra-folders`,
  `replays-list-scale`, `servers-filter-search`, `servers-master-sources`, `servers-sort-order`.

**Attribution and fixes:**
- `replays-date-filter-invalid@940x620` → **story 154, fixed** (commit `139cb8a`): the date-range
  picker's custom "From" field applied live on each keystroke (correctly, per AC2); typing "To"
  next into a value that made the pair invalid correctly rejected that edit, but the earlier
  from-only commit stayed applied and persisted to disk even though the picker showed a rejection.
  In the fixture, that abandoned value narrowed the list to zero rows, which the very next session
  visit's `navigate()` had no way to know about, so it timed out waiting for a list that had
  correctly swapped to the no-match state. Fixed by reverting to the pre-edit value on any popover
  close while the fields are in a rejected state.
- `replays-list-scale`, `servers-filter-search`, `servers-master-sources`, `servers-sort-order` →
  investigated per the flaky-first / pre-existing rule; `replays-list-scale` bisected to **story
  152, fixed** (commit `53f775d`): a keyboard-Tab-order side effect was ruled out — the real cause
  was the flow's own scale fixture (built for story 150 before sorting existed) clustering 3 000
  files' mtimes into the same fast-write-loop timestamp bucket and targeting the highest-numbered
  file as "last", which 152's new default order ("favourites first, then newest") now sorted to the
  *top* instead of the bottom the flow expected. Fixed in the fixture (deterministic, one-second-
  spaced mtimes; retargeted at the now-actually-oldest file), no product code changed. The other
  three (`servers-filter-search`, `servers-master-sources`, `servers-sort-order`) and
  `replays-extra-folders` reproduce identically at the sprint's merge-base with `dev` and are
  confirmed pre-existing, unrelated to any story in this sprint (the `servers` module has zero
  commits in this sprint's diff) — not fixed here.
- **A second regression surfaced by the story-154 fix agent's own verification**, not the gate
  suites themselves: `npm run ui:flow -- replays-date-filter`'s "the picker works by keyboard
  alone" step (a Tab-count bound) started failing after story 155 → **story 155, fixed** (commit
  `9bdf4eb`): 155's row-level quick favourite/rating controls each carried a standing `tabIndex={0}`,
  tripling every row's cost in the document's Tab order; with the fixture's rows plus the existing
  lap-around-to-start Chromium quirk this pushed the walk back to the date filter's trigger just
  over the flow's 40-press bound. Fixed with a roving-tabindex pattern (the quick controls now sit
  at `tabIndex={-1}`, reached from the row via Arrow keys) — each row costs exactly one Tab stop
  again, and the quick controls stay fully keyboard-operable.
- **Confirmation run** (after both fixes, on commit `53f775d`): `npm run build` — green; `npm test`
  — green (373/373, 5496 passed); `npm run ui:flows` — 87/91 passed (~31 min), same 4 pre-existing
  failures as above, `replays-list-scale` now green alongside it.

**Not fixed, named as a finding, not a regression:** the story-155 fix agent found that
`demo-editor-store.ts`'s `quickEdit` (fire-and-forget read-merge-write, no per-row queuing) can
race when a favourite toggle and a rating pick fire back-to-back — whichever write's stale-base
read resolves last silently drops the other field. Reproduced against the *original, unmodified*
row component too (so it predates story 155's own regression and is unrelated to it) — a
pre-existing flake worth its own story if `replays-row-quick-rating` starts flaking in CI.
