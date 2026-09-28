---
id: 140
title: I teach the browser a name pattern
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

The server a user plays on names its demos in a way the launcher has never seen. Instead of waiting
for a release, the user writes a template in the demos settings — e.g. `{date}_{map}_{p1}_vs_{p2}` —
and from the next scan on, those demos show their date, map and players (concept
`docs/concepts/demo-browser.md` §7, DEMO-9). The browser is expected to get better at this over
time; this is how the user gets ahead of it.

Templates use the syntax [[139]] settles and run through the same engine as the shipped patterns.
They live in the module's own state key ([[142]] introduces it) and are shown in the settings section
[[135]] created.

## Acceptance Criteria

- [ ] **AC1** — In the demos settings section the user can add, edit and remove name templates; the
      list persists across restarts.
- [ ] **AC2** — A template that is invalid under [[139]]'s syntax (unknown token, unclosed brace,
      no literal between two greedy tokens…) is rejected on entry with its reason shown next to the
      field, and is not saved.
- [ ] **AC3** — After a template is added, changed or removed, the next scan ([[144]]) re-derives
      name facts for every demo, even for files whose size and modification time did not change.
- [ ] **AC4** — User templates and shipped patterns are tried in the order decided in Q1, and that
      order is visible in the settings section.
- [ ] **AC5** — The template text is validated by a zod schema in main (length cap, printable
      characters) before it is stored.

## Open Questions

- [x] ~~**Q1 — Order** (§17.2): are user templates tried before or after shipped patterns?~~
      answered → Decisions (Sprint)
- [x] ~~**Q2 — Try it out** — should the editor show a live test against a sample file name (or
      against the user's actual demos)? Not in the concept; useful, but new scope.~~ answered →
      Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Order/overriding: shipped patterns are themselves defined as entries in the demos
  settings, editable like user templates, and the user can override any of them there — there
  is no separate "user templates run after/before shipped" split; editing an entry is how a
  user's version takes effect. AC4's "order decided in Q1" becomes: the settings section shows
  one ordered list (shipped + user-added), tried top to bottom, edited/reordered in place.
- Try-it-out live preview (Q2): out of scope for v1 — new scope beyond the concept and beyond
  what this story's acceptance criteria need; a template's effect is already visible from the
  next scan's results per AC3.

## Plan

<!-- Filled by /refine 140, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 140. -->

## Model Hints

<!-- Filled by /refine 140. -->

## Acceptance Tests

<!-- Filled by /refine 140. -->

## Done

<!-- Filled by /build 140. -->
