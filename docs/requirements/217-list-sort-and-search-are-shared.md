---
id: 217
title: list sort and search are shared
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want clicking a column header to cycle the same way in every list, and a quoted
search to mean "exactly this" in the demo list as it does in the server list. As the maintainer I
want one column-sort and one search-term implementation, so that a tweak is done and tested once
and the `null`-vs-`undefined` glue between persisted sort and view disappears.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F47):
`src/shared/servers/list-sort.ts` and `src/shared/replays/list-sort.ts` each define their own
`compareStrings`, `NATURAL_DIRECTION`, favourite-first comparator, unknown-last rule and a 9-line
`nextSort` identical except for the off-sentinel (`undefined` vs `null`); `player-sort.ts` and
config's `alias-rows.ts` add a third and fourth direction type. The servers persisted type is
`listSort?:` while handlers answer `?? null` and `ServersView` converts back. Servers' search
supports quoted exact match (story 195), replays' does not; each has its own
`matchesText`/`isFilterActive`.

## Acceptance Criteria

- [ ] **AC1** — `src/shared/list/sort.ts` exports `ListSort<C>`, `SortDirection`, a generic
      `nextSort`, `compareBy`/`createColumnSorter` with the favourite-first and unknown-last
      rules; `src/shared/list/search.ts` exports `matchesTerm` with plain and quoted modes; both
      are unit-tested.
- [ ] **AC2** — servers, replays, player-sort and alias-rows are re-expressed on top of them; the
      existing list-sort tests (118 + 219 lines) pass unchanged as the regression gate; no file
      outside `src/shared/list` declares its own `nextSort` or `compareStrings`.
- [ ] **AC3** — The "no sort" sentinel is `null` end to end (persisted type, handler, view); the
      `ServersView` mapping is deleted.
- [ ] **AC4** — The demo list accepts a quoted search term with the same semantics as the server
      list; the search placeholder says so (i18n key); a replays flow covers it.
- [ ] **AC5** — `servers-sort-order`, `replays-*` sort/filter flows pass.

## Open Questions

- none

## Plan

<!-- Filled by /refine 217. -->

## Deliverables

<!-- Filled by /refine 217. -->

## Model Hints

<!-- Filled by /refine 217. -->

## Acceptance Tests

<!-- Filled by /refine 217. -->

## Done

<!-- Filled by /build 217. -->
