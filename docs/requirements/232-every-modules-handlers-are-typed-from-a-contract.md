---
id: 232
title: every module's handlers are typed from a contract
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

Story [[205]] introduced the typed module seam (`defineModule` in main, `createModuleClient` in the
renderer, request schemas carried by a shared contract map) and converted `home` and `servers`. The
other five modules (`config`, `downloads`, `mods`, `replays`, `library`) still register handlers by
string and call the bus through `callModule<T>` with a hand-written generic. Until they move, the
bus has two ways to do one thing, a handler's request type can still drift from its schema, and the
"every declared handler is live" test only covers the converted modules.

From the maintainer's perspective: one way to declare, register and call a module handler, for all
modules. The user sees no change.

## Acceptance Criteria

- [ ] **AC1** — `config`, `downloads`, `mods`, `replays` and `library` each have a shared contract
      type and a `*_HANDLER_SCHEMAS` map; request types are derived from the schemas.
- [ ] **AC2** — Each of those modules registers its handlers through `defineModule` and its renderer
      client is built with `createModuleClient`; no `callModule<` generic remains in any client.
- [ ] **AC3** — The bus-wide "registered handlers equal declared handlers" and "every handler constant
      is referenced by its client" tests cover all modules, without the `Partial` escape for modules
      that were not converted.
- [ ] **AC4** — Persisted and manifest schemas stay in main; only request schemas move to shared.
- [ ] **AC5** — Every existing flow that exercises these modules stays green, and the renderer sees
      the same `Outcome` envelope as before.

## Open Questions

<!-- Sizing: config has 35 handlers, replays 33, downloads 20, mods 10, library 1 (counts from
story 205's plan). One story per module, or one story per group, is a call for refine. -->

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
