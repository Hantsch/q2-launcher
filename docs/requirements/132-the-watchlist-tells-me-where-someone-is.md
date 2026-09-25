---
id: 132
title: the watchlist tells me where someone is
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

[[131]] can already say, for one watchlist entry, `offline` or a matched server with score and
ping. This story is where a user actually sees that list and acts on it — "watchlist ist eine
eigene liste wo der name steht" (concept §3), its own surface inside the `servers` module, one row
per entry.

Each row's actions reuse flows the module already has rather than reimplementing them: Join goes
through [[125]], Spectate through [[126]], opening the server detail through [[122]]. Editing an
entry's name or match mode, and removing it outright, round out the row's action set (GB-W4). None
of this is new machinery — the point of the watchlist is that it rides on the browser's existing
scan, detail and join paths, and this row is the last piece that turns [[131]]'s match data into
something clickable.

**No spectator/player distinction is shown anywhere on the row or in its detail link** (§6.4) — the
same protocol limitation [[122]]'s detail view already respects, restated here for consistency
rather than as a new decision. The row also states how current its information is, rendering
[[131]]'s "when this data is from" as visible text, so a user reading `offline` understands it means
"not found in the last data the launcher has", not "definitely not playing" (GB-W5b).

The whole surface is this milestone's concrete first consumer of [[130]]'s general gate: with no
valid code naming `watchlist`, none of it exists — no tab, no row, no menu entry pointing at it from
anywhere else in the app (§13.6, GB-X4, GB-W7). A code accepted through [[129]] is what makes the
tab appear at the next check of [[130]]'s mechanism; nothing about the watchlist itself has its own
separate unlock logic; it consumes [[130]]'s decision like any other gated feature would.

## Acceptance Criteria

- [ ] **AC1** — With `watchlist` unlocked via [[129]], a watchlist tab or surface exists inside the
      `servers` module.
- [ ] **AC2** — Each row shows the entry's name and either `offline` or the matched server(s) with
      score and ping, per [[131]].
- [ ] **AC3** — Each row offers Join, Spectate, open-detail, edit and remove actions, each of which
      reuses the corresponding existing flow ([[125]], [[126]], [[122]]) rather than a separate
      implementation.
- [ ] **AC4** — Nothing in a watchlist row or its detail link ever claims a player is, or is not,
      spectating.
- [ ] **AC5** — Each row states when its shown data is from (e.g. relative to the last scan that
      touched that server).
- [ ] **AC6** — With no valid `watchlist` code present, none of this — tab, rows, menu entries —
      renders anywhere in the app, per [[130]].
- [ ] **AC7** — A found entry's row offers a "re-check" action. It triggers [[131]]'s single
      `status` query to the last-seen server and shows the result: still there with updated score
      and ping, or [[131]] AC9's "left that server — run a full scan in the server browser".
- [ ] **AC8** — The watchlist tab carries [[129]]'s visible "experimental" marking.
- [ ] **AC9** — The surface lets the user add an entry (name + match mode). A refused pattern shows
      [[131]] AC7's reason at the input, and an entry [[131]] AC8 marked "too slow" shows that on
      its row.

## Open Questions

- [x] ~~**Q1 — Does a dedicated "re-check this entry" control exist?** (concept open point #16)~~
      answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Dedicated re-check control: **yes** (AC7). It only checks the last-seen server; if the
  player has moved, the row points to a full scan in the server browser. S24's measurement (a full
  two-stage pass costs seconds) settles open point #16's precondition (2026-09-25, planning).

## Plan

<!-- Filled by `/refine 132`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 132`. -->

## Model Hints

<!-- Filled by `/refine 132`. -->

## Acceptance Tests

<!-- Filled by `/refine 132`. -->

## Done

<!-- Filled by `/build 132`. -->
