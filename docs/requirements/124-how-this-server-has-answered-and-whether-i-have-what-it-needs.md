---
id: 124
title: how this server has answered, and whether i have what it needs
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

[[122]] shows who is on a server right now; [[123]] shows the rules it plays by. This story answers
the two questions left once you're actually thinking about joining: has this server actually been
answering, and do I even have what it needs?

Reachability (GB-D4): the browser measures a round-trip every time it queries a server this session
— the stage-1 sweep, a scoped refresh, a manual detail-view refresh. Concept §9 item 5 asks for that
history, not just the latest number, because a single ping cannot tell "reliable" apart from
"answered once and has gone quiet since". The same section also requires a plain statement of
whether the *last* scan round got an answer at all — GB-N6 already establishes that a non-answering
server keeps its last known state rather than being shown as empty; this story is where that "stale"
fact becomes something the user actually reads in the detail view, next to the history that explains
it.

Local context (GB-D5): concept §9 item 6 wants a yes/no statement of whether the server's mod exists
in the active installation and whether its current map exists locally — deliberately only a
statement, never an offer to install. Installing a mod or a map is explicitly the `mods`/`assets`
modules' job (concept §2 "Deliberately not in v1": "Mod/map download from the detail view" — those
modules are scaffolded but not implemented, per CLAUDE.md's own status line). What this story must
not do is invent a detection mechanism to produce that yes/no: the concept flags this directly as
open point #14 — "what counts as 'the mod is there' before the `mods` module exists needs defining" —
and it is genuinely unresolved, not a gap this story's author gets to fill in silently. It is carried
forward below as an explicit Open Question rather than papered over with a guessed directory check.

Renders inside the same detail view [[122]] and [[123]] build out ([[106]] the container, [[108]]
the parsed protocol data this reads); GB-D6's per-field degradation applies here too. Out of scope:
the actions row (Join/Spectate/Favourite/Add-to-address-book/Copy-address), covered in sprint 9.6 by
[[125]]/[[126]]/[[127]] — this story states facts, it does not act on them.

## Acceptance Criteria

- [ ] **AC1** — The view shows the response times this server has measured during the current
      session as a history (more than just the single latest value), not only the most recent ping.
- [ ] **AC2** — The view states plainly whether the last scan round received an answer from this
      server at all.
- [ ] **AC3** — The view states yes/no whether the server's reported mod exists in the active
      installation, and does not offer to install it.
- [ ] **AC4** — The view states yes/no whether the server's current map exists locally, and does not
      offer to install it.

## Open Questions

- [ ] **Q1 — What counts as "the mod is there" before the `mods` module exists?** Concept open
      point #14, quoted directly: "what counts as 'the mod is there' before the `mods` module exists
      needs defining." The same question applies to the map-exists check in AC4 — there is no
      `assets` module yet either. Candidates nobody has decided between: a directory-existence check
      against the active installation's mod/map folders (cheap, but wrong the moment content is
      installed some other way), a manifest lookup against whatever the `mods`/`assets` modules
      eventually track (does not exist yet), or deferring the whole local-context section until one
      of those modules ships. This must be resolved in `/refine 124` before the story can leave
      draft — it decides what code AC3/AC4 actually run, not just how the result is displayed.

## Plan

<!-- Filled by `/refine 124`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 124`. -->

## Model Hints

<!-- Filled by `/refine 124`. -->

## Acceptance Tests

<!-- Filled by `/refine 124`. -->

## Done

<!-- Filled by `/build 124`. -->
