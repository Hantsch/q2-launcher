---
id: 197
title: I save my filter as a quick filter
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player who looks for the same kind of server again and again, I can save the filter I have
just set up as a named quick filter of my own, and apply it again with one click later. A user
asked for custom filters; the simplest form is to keep the current selection - mod, gamemode, map,
empty, bots, waiting-for-opponent - under a name next to the built-in quick toggles.

Concept: [game-browser.md](../concepts/game-browser.md) §8, GB-L5, GB-P1.

## Acceptance Criteria

- [ ] **AC1** — While at least one filter criterion is active, the filter bar offers *Save as quick
      filter*, which asks for a name. With no criterion active the action is disabled and says why
      as visible text.
- [ ] **AC2** — A saved quick filter appears as a chip in the filter bar. Clicking it replaces the
      current filter with exactly the saved criteria.
- [ ] **AC3** — A chip shows pressed (flame edge plus check mark, never colour alone) whenever the
      current filter equals its criteria, and clicking it then clears the filter.
- [ ] **AC4** — A quick filter can be renamed and deleted from its chip; deleting it never
      changes the current filter.
- [ ] **AC5** — Saving under a name that is already taken, or an empty name, is refused with a
      reason; the user may overwrite the existing one explicitly.
- [ ] **AC6** — Quick filters survive a restart and are global to the launcher, not per
      installation, stored in the servers module's own state.
- [ ] **AC7** — A saved filter that names a mod or map no longer in the list still applies and
      shows the existing no-match state; it never breaks the bar and is never dropped silently.
- [ ] **AC8** — A damaged or unknown entry in the stored quick filters is skipped without losing
      the others and without an error toast.
- [ ] **AC9** — The built-in quick toggles (empty, waiting for opponent, bots) keep working
      unchanged next to the custom chips.

## Open Questions

- **Q1** — Does a quick filter include the free-text search, or only the structured criteria?
  With story 195 a quoted search could be a useful saved term (`"duel"`), but a search is usually
  a one-off. Recommendation: structured criteria only, search stays out.
- **Q2** — Does a quick filter also capture the sort? Not in the request; recommendation: no.
- **Q3** — Is there an upper bound on the number of quick filters (chip row width)? A cap of
  ~8 with a visible reason avoids a bar that wraps over the list.
- **Q4** — Chip order: creation order, or user-sortable? Recommendation: creation order, nothing
  to manage.
- **Q5** — Do quick filters apply in both Online and LAN mode (story 196)? They are plain criteria
  over rows, so yes unless the refine finds a reason against.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
