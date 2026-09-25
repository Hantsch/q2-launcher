---
id: 124
title: how this server has answered
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

[[122]] shows who is on a server right now; [[123]] shows the rules it plays by. This story answers
the question left once you're actually thinking about joining: has this server actually been
answering?

Reachability (GB-D4): the browser measures a round-trip every time it queries a server this session
— the stage-1 sweep, a scoped refresh, a manual detail-view refresh. Concept §9 item 5 asks for that
history, not just the latest number, because a single ping cannot tell "reliable" apart from
"answered once and has gone quiet since". The same section also requires a plain statement of
whether the *last* scan round got an answer at all — GB-N6 already establishes that a non-answering
server keeps its last known state rather than being shown as empty; this story is where that "stale"
fact becomes something the user actually reads in the detail view, next to the history that explains
it.

**Not in this story:** local context (GB-D5, concept §9 item 6 — does the server's mod and current
map exist locally). Without a `mods`/`assets` module there is no honest definition of "the mod is
there", and stock maps live inside `pak0.pak`, which nothing in the launcher reads yet. It is
deferred to the mods/assets modules (see Decisions); the detail view ships without that section.

Renders inside the same detail view [[122]] and [[123]] build out ([[106]] the container, [[108]]
the parsed protocol data this reads); GB-D6's per-field degradation applies here too. Out of scope:
the actions row (Join/Spectate/Favourite/Add-to-address-book/Copy-address), covered in milestone 9.6
by [[125]]/[[126]]/[[127]] — this story states facts, it does not act on them.

## Acceptance Criteria

- [ ] **AC1** — The view shows the response times this server has measured during the current
      session as a history (more than just the single latest value), not only the most recent ping.
- [ ] **AC2** — The view states plainly whether the last scan round received an answer from this
      server at all.

## Open Questions

- [x] ~~**Q1 — What counts as "the mod is there" before the `mods` module exists?** (concept open
      point #14)~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Local mod/map availability before the `mods`/`assets` modules exist: **deferred** — the
  former AC3/AC4 (mod exists / map exists, yes/no) are cut from this story and move to the
  mods/assets modules (2026-09-25, planning).

## Plan

<!-- Filled by `/refine 124`. -->

## Deliverables

<!-- Filled by `/refine 124`. -->

## Model Hints

<!-- Filled by `/refine 124`. -->

## Acceptance Tests

<!-- Filled by `/refine 124`. -->

## Done

<!-- Filled by `/build 124`. -->
