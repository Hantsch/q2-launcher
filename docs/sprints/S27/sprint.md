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

- [ ] 150 — a demo row says what it is
- [ ] 151 — the demo list says what it's doing
- [ ] 152 — favourites first, then newest
- [ ] 153 — I search and filter my demos
- [ ] 154 — I filter demos by date
- [ ] 155 — I describe a demo the way I remember it
- [ ] 156 — I find a demo on disk
- [ ] 157 — I rename a demo and its notes move with it
- [ ] 158 — an archive entry says why it cannot be edited

## Notes

- Builds on S26's index, sidecar and precedence layer.
- Phase 10 is cut into three sprints (S26 data layer → S27 list/detail UI → S28 playback), so each
  sprint is refined against code the previous one has built and the regression gate runs three
  times instead of once.
- Numeric order is the build order; every `[[NNN]]` reference to a higher id is a "used later"
  mention, not a dependency.
