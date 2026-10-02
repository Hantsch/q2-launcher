---
id: 205
title: module handlers are typed from a contract, and every declared handler is live
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want the module bus to be a contract the compiler enforces, like the shell
IPC already is, so that a renamed handler, a changed response shape or a wrong generic is a
compile error instead of a runtime failure at click time. And I want a declared handler that is
never registered, or registered but never called, to fail a test.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F03, F29, F30): 138 bus
handlers (config 35, replays 34, servers 31, downloads 21, mods 10, home 6, library 1) against 50
shell channels — 73 % of the IPC surface. `ModuleSetup.handle` types only the payload;
`callModule<T>` ends in `result as Outcome<T>` (125 hand-chosen generics across seven
`client.ts` files); `emit(type: string, payload: unknown)` and `onModuleEvent<T>` cast likewise.
Shared files export result types (`SaveProfileResult`, `ScanStartResult`) but nothing links them
to a handler name. Per-handler schemas live in three different places depending on the module
(shared `X_HANDLER_SCHEMAS` maps that main never registers from, main-only `schemas.ts`, inline
`z.void()`); `moduleInvokeSchema` hardcodes the eight module ids. Only replays has a
handler-coverage test; six declared handlers (`DOWNLOADS_HANDLERS.manifestGet`,
`SERVERS_HANDLERS.favouritesList/manualList/manualAdd/manualRemove/historyRead`) have no renderer
caller and `REPLAYS_HANDLERS.demosList` runs a full discovery for a caller that story 150 replaced.

This is the hottest area of the codebase: since 2026-08-01, 73 commits touched a module
`client.ts` and 108 touched `src/shared/modules`.

## Acceptance Criteria

- [ ] **AC1** — A per-module contract type exists in `src/shared/modules/<id>.ts` shaped like
      `IpcInvokeMap` (`'news.get': { req: void; res: NewsFeed }`, plus an events branch), with
      the request type derived from the existing zod schema via `z.infer` so no schema is
      rewritten.
- [ ] **AC2** — Main has `defineModule<H>(id)` whose `handle<K extends keyof H>` derives payload
      and result types and registers the schema from the contract's schema map, so a handler with
      a missing schema or a wrong result type is a compile error; renderer has
      `createModuleClient<H>(id)` whose `call('news.get')` infers `Promise<Outcome<NewsFeed>>`.
      Both are additive beside the existing `handle`/`callModule` (registry runtime untouched).
- [ ] **AC3** — `home` (6 handlers) is fully converted as the reference; at least one further
      module (`servers` or `replays`) is converted in this story; the remaining modules are listed
      as follow-up deliverables with no `callModule<` generic left in a converted module's client.
- [ ] **AC4** — `MainModuleRegistry` exposes `handlerTypes(moduleId)`; one parameterised test
      asserts, for every module, that the registered set equals `Object.values(X_HANDLERS)` in
      both directions.
- [ ] **AC5** — A renderer test asserts every handler constant is referenced by its module's
      `client.ts` (flow-only names on an explicit allowlist); `demos.list` is removed end to end
      and the six unused handlers are either wired or removed, each with a one-line reason in the
      story's Decisions.
- [ ] **AC6** — `moduleInvokeSchema`'s module-id enum derives from `MODULE_MANIFESTS`.
- [ ] **AC7** — docs/ARCHITECTURE.md "Adding a module" step 1 describes the contract type and
      `defineModule`/`createModuleClient`, and the "type safety per call is the module's own job"
      sentence is gone.

## Open Questions

- [ ] **Q1** — Where do config/downloads/mods request schemas live after this — shared (so the
      contract map can carry them) or main-only with the schema map typed against the contract?
      Persisted and manifest schemas stay in main either way.

## Plan

<!-- Filled by /refine 205. -->

## Deliverables

<!-- Filled by /refine 205. -->

## Model Hints

<!-- Filled by /refine 205. -->

## Acceptance Tests

<!-- Filled by /refine 205. -->

## Done

<!-- Filled by /build 205. -->
