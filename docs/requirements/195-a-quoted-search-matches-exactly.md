---
id: 195
title: a quoted search matches exactly
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player searching the server list, I can put my search term in quotes to find only the
servers where it matches whole, instead of every server whose name merely contains it. Searching
for `ffa` finds every server with "ffa" somewhere in it; searching for `"ffa"` finds the server
that is called exactly that. Without quotes, search behaves as it does today.

Idea taken from a review of ozy24/q2connect, whose search does the same.
Concept: [game-browser.md](../concepts/game-browser.md) §8, GB-L5.

## Acceptance Criteria

- [ ] **AC1** — A search term wrapped in double quotes matches a row only when the quoted text
      equals the server name, the address, or a player name in full, case-insensitively.
- [ ] **AC2** — A search term without quotes behaves exactly as before: case-insensitive substring
      on name, address and (where fetched) player names.
- [ ] **AC3** — Quotes with surrounding whitespace (` "ffa" `) count as quoted; whitespace inside
      the quotes is part of the term.
- [ ] **AC4** — A term with an opening quote and no closing one (`"ffa`), or empty quotes (`""`),
      is treated as plain substring text, never as an error and never as "match everything".
- [ ] **AC5** — Player names are matched exactly only where stage 2 has fetched the roster, as
      for the unquoted search; a server without a fetched roster never matches on a player name.
- [ ] **AC6** — The search field tells the user that quotes mean "exact" (placeholder or hint, an
      i18n key), so the feature is discoverable without documentation.

## Open Questions

- **Q1** — Double quotes only, or also single quotes as q2connect does? Single quotes occur inside
  server and player names (`o'brien`), so accepting them risks false exact searches.
  Recommendation: double quotes only.
- **Q2** — Does the exact match see Quake's high-bit "green" characters as their plain ASCII
  equivalents (concept open point 10)? Whatever the answer, it must be the same one the
  unquoted search uses.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
