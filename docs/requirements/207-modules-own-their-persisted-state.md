---
id: 207
title: modules own their persisted state
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a module's persisted state — its schema, its forgiving parse, its
defaults, its migrations and its tests — to live in the module, registered with the shell at
setup, so that adding a module no longer means editing three shell files and two shell tests,
the shell can be typechecked and tested without every module, and the dependency direction the
architecture doc promises is true again.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F02, F33, F08):
`src/main/lib/schemas.ts` (1,655 lines, 55 commits since August — ~13 % of all commits touch
this one file) holds persisted schemas for installations and config (~905 lines), downloads,
home layout, servers, unlock and replays, importing five module contracts plus
`../modules/servers/history-log`. `LauncherStateDocument` has 13 sections with hand-written
getter/setter pairs. Five shell files import from `src/main/modules/` (`index.ts`,
`renderer-source.ts`, `lib/schemas.ts`, `services/state.ts`, `services/installations.ts`), each
with a comment arguing the target "is pure and cannot cycle"; `setEngineState` on the shell
library service wraps downloads' `installation-state` although generic `setModuleData` exists.
Migrations come in two mechanisms: four versioned `MIGRATIONS` steps that all rewrite
`configProfiles` (a 354-line config file in the shell) and ~200 lines of parse-time
`migrateLegacy*` rewrites that run on every load; the other nine sections follow a third rule
("new top-level key, no bump"). docs/ARCHITECTURE.md still says a module "never touches the state
file" and "`MIGRATIONS` is empty at v1" (it is at v5).

Depends on stories 202 (mutators) and 203 (forgiving helper).

## Acceptance Criteria

- [ ] **AC1** — Step one (small, safe): the pure helpers the shell imports from modules
      (`isSafeNewsImageFileName`, `getNewsImagesCacheDir`, `capServerHistory`, `pruneFailures`,
      engine `installation-state`) move to `src/main/lib/` or `src/shared/`; `setEngineState`
      becomes a downloads-module function over `setModuleData` (with the `detectedVersion`
      mirror kept in one write); `git grep -n "from '.*modules/" src/main/index.ts src/main/lib src/main/services`
      returns nothing.
- [ ] **AC2** — `AppContext.state` offers `section<T>({ key, parse, defaults })` returning a
      typed `{ get(), update(fn) }` that a module registers in `setup()`; an unknown key in
      `state.json` is kept verbatim across load/save so a disabled module loses nothing.
- [ ] **AC3** — downloads, home, servers, unlock and replays each have
      `src/main/modules/<id>/persisted.ts` (schema + parse + defaults) and `persisted.test.ts`;
      the matching code and tests are removed from `lib/schemas.ts`/`schemas.test.ts`, which
      afterwards hold only installations, settings and window state (target ≤ 400 lines).
- [ ] **AC4** — Config's four `MIGRATIONS` steps and the parse-time legacy normalisers move to
      `src/main/modules/config/persisted-migrations.ts`, composed by the shell's migration runner;
      the shell's `migrations.ts` carries no config imports.
- [ ] **AC5** — docs/ARCHITECTURE.md's state section states the two-tier migration rule
      (additive optional key → forgiving parse; shape change → `MIGRATIONS` step + version bump;
      no new parse-time rewrites) and "Adding a module" lists the `persisted.ts` step; the
      "`MIGRATIONS` is empty" and "never touches the state file" sentences are corrected.
- [ ] **AC6** — Existing `state.json` files from every schema version the fixture covers load
      with identical results before and after (the migration tests and the e2e fixture variants
      are the gate).

## Open Questions

- [ ] **Q1** — Should pure UI preferences (`servers.listSort`, `replays.listSort`/`listFilter`,
      `homeLayout`) move to a separate `ui-state.json` store in the same move, as
      docs/ARCHITECTURE.md already argues for window state? The review's value judge says drop it
      from this story; decide at refine.
- [ ] **Q2** — Does the section API return the mutators from story 202, or does 202 land them on
      `StateStore` first and 207 re-home them?

## Plan

<!-- Filled by /refine 207. -->

## Deliverables

<!-- Filled by /refine 207. -->

## Model Hints

<!-- Filled by /refine 207. -->

## Acceptance Tests

<!-- Filled by /refine 207. -->

## Done

<!-- Filled by /build 207. -->
