---
id: 215
title: main-owned data is read through one query hook
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want every renderer panel that reads a list from main and applies its own
mutations to use one query hook and one mutation hook, so that cancellation, error mapping,
optimistic apply and subscription are implemented once, behave the same in every view, and have a
place to grow caching later. As a user I want the server list not to re-sort hundreds of rows on
every unrelated state change.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F19, F48, F61):
`let cancelled = false` appears 36 times in 26 non-test renderer files, always wrapping a
one-shot IPC read with `if (cancelled) return` and a cleanup. `useWatchlist` and
`useQuickFilters` are the same hook under two names; `ServersSettingsSection` and
`ReplaysSettingsSection` carry a near-verbatim 15-line `mutate` (transport Outcome → domain
ok/reason → i18n prefix → set list) that differs only in setter name and prefix — one disables
controls while busy, the other does not. A generic `useTileData` (loading/error/retry) exists
only under `modules/home/components/`. `ServersView` (558 lines, 13 `useState`, 0 `useMemo`)
recomputes `sortServerRows`/`filterServers` on every render while `ReplaysView` memoises the same
chain. The renderer has five Zustand stores and five contexts with no written rule for which to
use; docs/ARCHITECTURE.md says "one Zustand store".

Depends on story 206 (refusal shape) for the mutation hook's error mapping.

## Acceptance Criteria

- [ ] **AC1** — `src/renderer/src/lib/useModuleQuery.ts` exports
      `useModuleQuery<T>(read, { subscribe?, deps? })` → `{ state, data, error, reload }` and
      `useModuleMutation<T, R>(apply, toKey)` → `{ run, busy, error }`; both are unit-tested for
      unmount-before-resolve, StrictMode double mount, a refused mutation and a transport failure.
- [ ] **AC2** — First wave migrated: `useWatchlist`, `useQuickFilters`, both `*SettingsSection`
      list blocks, `NameTemplatesList`, and `useTileData` (which becomes a thin alias or is
      deleted); second wave: `ServersView`, `ModsView`, `DownloadsView`. The count of
      `let cancelled = false` in `src/renderer/src` (non-test) drops below 10, with the remaining
      sites listed in the story's Done section with a reason each.
- [ ] **AC3** — `ServersView` memoises `sortedRows`/`visible`; `useServerScan()` and a shared
      `useListSort(get, set)` (used by servers and replays) are extracted with their own tests;
      `ServersView` is under 350 lines.
- [ ] **AC4** — docs/ARCHITECTURE.md's renderer section gets a "State" paragraph: main-owned data
      → `useModuleQuery` or the mirrored store; cross-view renderer state → a module Zustand
      store; subtree handles → context; otherwise component state. The "one Zustand store"
      sentence is corrected.
- [ ] **AC5** — Every servers, replays, mods and downloads flow stays green.

## Decisions (Sprint)

- **(User)** Q1: Cache-free hook for now.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Is a tiny cache (same `read` key → shared in-flight promise) wanted now, or is the
      hook deliberately cache-free until a story needs it?

## Plan

<!-- Filled by /refine 215. -->

## Deliverables

<!-- Filled by /refine 215. -->

## Model Hints

<!-- Filled by /refine 215. -->

## Acceptance Tests

<!-- Filled by /refine 215. -->

## Done

<!-- Filled by /build 215. -->
