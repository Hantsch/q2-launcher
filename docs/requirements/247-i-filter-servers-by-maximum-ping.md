---
id: 247
title: I filter servers by maximum ping
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player who only wants to play where my connection is good, I can hide every server whose ping
is above a limit I choose, e.g. "< 100 ms".

User feedback 2026-10-04: filter by max ping, e.g. < 200; larger makes no sense — "I only want to play
on servers where I have a good ping".

Today ping is measured per server on every scan (`rttMs`) and the list can be sorted by ping, but
`ServerListFilter` has no ping field.

Concept: [game-browser.md](../systems/game-browser.md), [servers-module.md](../systems/servers-module.md).

## Acceptance Criteria

- [ ] **AC1** — The filter bar has a "Max ping" select with Any, < 50, < 100, < 150 and < 200 ms;
      Any is the default.
- [ ] **AC2** — With a limit set, only servers whose last measured ping is below the limit are shown.
- [ ] **AC3** — Servers without a measured ping (no answer, stale) are hidden while a limit is set.
- [ ] **AC4** — The filter count ("showing N of M") and Clear include the ping limit.
- [ ] **AC5** — The ping limit is part of a saved quick filter, and a quick filter saved before this
      story still loads and applies (as "Any").
- [ ] **AC6** — The limit works the same in Online and LAN mode.

## Open Questions

- **Q1** — Are the steps right, or does the user want a free number? Recommendation: fixed steps,
  matching "> 200 makes no sense".
- **Q2** — Should a server that drops above the limit during an auto-refresh vanish immediately, or
  stay until the next manual action? Recommendation: vanish — the list is live everywhere else.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
