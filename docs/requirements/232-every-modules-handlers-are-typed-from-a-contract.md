---
id: 232
title: every module's handlers are typed from a contract
status: ready # draft -> ready -> in-progress -> done
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

None open. The sizing comment (one story per module or per group) is answered under Decisions.

## Decisions (Sprint)

- Sizing: one story, cut into one D per module half (shared+main, then client) plus a mechanical
  schema-move D for config: every D stays within ~8 files and one layer, and only one D needs the
  hard tier, so the budget rule does not force a split.
- Build order library → mods → downloads → config → replays → close the gates: smallest first, so
  the pattern is re-proven on 1 and 10 handlers before the 35- and 33-handler modules.
- downloads' and mods' request schemas move into `src/shared/modules/<id>.ts` itself, as home,
  servers and replays already do; downloads' schemas import value constants from that file, so a
  sibling file would be a circular value import.
- config's request schemas move (`git mv`) to `src/shared/modules/config-schemas.ts`, which also
  holds `CONFIG_HANDLER_SCHEMAS`; `ConfigContract` in `config.ts` reads the map with `import type`
  only: merging would make a ~1450-line file, and a type-only back-reference is erased at runtime.
- A schema test follows its schema to shared (`mods/schemas.test.ts` → `src/shared/modules/mods.test.ts`,
  `downloads/schemas.test.ts` → appended to `src/shared/modules/downloads.test.ts`,
  `config/schemas.test.ts` → `src/shared/modules/config-schemas.test.ts`); tests that also need a
  main persisted schema (`schema-parity`, `persisted.test`, `profiles.ipc-schemas`,
  `index.raw-files`, `map-presence`) stay in main and only re-point their import, because shared
  cannot import main.
- Contract `req` is `z.infer`, as in 205; the one transforming request schema
  (`switchBindKeySchema`, string → string) has equal input and output types, so no client needs
  `z.input`.
- Contract `res` is the value main's handler returns today; a mismatch the compiler finds is fixed
  in the contract or at the client's callers, never with a cast.
- library converts in a single cross-layer D: one handler in three files, and splitting it costs
  more turns than it isolates.
- `callModule`/`onModuleEvent` stay exported from `moduleClient.ts` as `createModuleClient`'s
  engine (covered by `moduleClient.test.ts`); the renderer coverage test forbids every `client.ts`
  from naming them, which is AC2's claim, without rewriting the engine's own tests.
- The renderer test also forbids `as Outcome` in a client: a contract with a too-loose `res`
  plus a cast at the client is the one wrong conversion the compiler would not catch.
- Main `DECLARED` becomes `Record<Exclude<ModuleId, 'assets'>, readonly string[]>` with no
  `?? []` fallback: a module added to `MODULES` without a declared entry is then a compile error;
  `assets` stays excluded because it has no main half.
- AC2's main half gets a source test (every loaded module's `index.ts` binds `defineModule<…>` and
  its `setup` never destructures the raw `handle`), because typecheck alone cannot see a module
  that kept the untyped path.
- AC4 is proven by a file-location test: no `src/main/modules/<id>/schemas.ts` remains, and the
  persisted/manifest schema files stay in main.
- replays' `scan-service.ts` and `playback-control.ts` type their `emit` dependency as
  `BoundModule<ReplaysContract>['emit']`, exactly as servers' scan-service did in 205.
- AC5's regression proof is a per-module set of existing flows (below); `mods-view` is left out
  because it is quarantined for an unrelated reason (story 188).
- No CHANGELOG entry: nothing changes for the user.

## Plan

Reference implementation: story 205 (`home`, `servers`). Seam: `src/shared/modules/contract.ts`,
`src/main/modules/define-module.ts` (`defineModule<H>(id, schemas).bind(setup)`, `BoundModule`),
`createModuleClient<H>(id)` in `src/renderer/src/modules/moduleClient.ts`. Template files to mirror:
`src/shared/modules/home.ts` (contract + `satisfies` map), `src/main/modules/home/index.ts`,
`src/renderer/src/modules/home/client.ts`, `src/shared/modules/home.test.ts`.

Per module, same three moves: (a) request schemas into shared and a `X_HANDLER_SCHEMAS` map typed
with `satisfies Record<…, ZodTypeAny>`, plus a `XContract` type (`req` = `z.infer`, `res` = what
main returns, events where the module has them); (b) main registers through `defineModule`;
(c) client built with `createModuleClient`, exported function names/signatures unchanged.

1. library (D1) — 1 handler, all three moves.
2. mods (D2 shared+main, D3 client) — 10 handlers, 1 event; `catalog-schema.ts` stays main.
3. downloads (D4, D5) — 20 handlers; persisted/manifest schemas stay main.
4. config (D6 move schemas, D7 contract+main, D8 client) — 35 handlers.
5. replays (D9, D10) — 33 handlers, 4 events; schemas already shared.
6. Close the gates (D11): coverage tests over all modules without escapes, AC4 location test,
   ARCHITECTURE.md "planned in story 232" remnants gone.

Each D updates its module's doc under `docs/systems/` where the doc names `schemas.ts` or the
client's call style. Gate after each D: `npm run typecheck`, the module's tests; after D11 the
flows listed under Acceptance Tests.

## Deliverables

- **D1 — Convert `library` (shared + main + client).**
  `src/shared/modules/library.ts`: add `LIBRARY_HANDLER_SCHEMAS = { [LIBRARY_HANDLERS.stats]: z.void() }
satisfies Record<…, ZodTypeAny>` and `LibraryContract` (`stats` → `res: LibraryStats`, events `{}`).
  `src/main/modules/library/index.ts`: `defineModule<LibraryContract>('library',
LIBRARY_HANDLER_SCHEMAS).bind(setup)`; drop the inline `z.void()`. `src/renderer/src/modules/library/client.ts`:
  `createModuleClient<LibraryContract>('library')`, `getLibraryStats` unchanged in name/signature.
  Mirror `home.ts` / `home/index.ts` / `home/client.ts`. Test: new `src/shared/modules/library.test.ts`
  › "LibraryContract req types are derived from LIBRARY_HANDLER_SCHEMAS" (`expectTypeOf`, mirror
  `home.test.ts`) and › "LIBRARY_HANDLER_SCHEMAS has exactly one schema per LIBRARY_HANDLERS value";
  existing `src/main/modules/library/stats.test.ts` stays green.

- **D2 — `mods` contract + main half.**
  Move every export of `src/main/modules/mods/schemas.ts` into `src/shared/modules/mods.ts` and
  delete the main file (its only import, `isSafeGameName`, is already shared). Add
  `MODS_HANDLER_SCHEMAS` (`satisfies`) for all 10 `MODS_HANDLERS` and `ModsContract` (`res` = the
  value each handler in `src/main/modules/mods/index.ts` returns today, e.g. `ModsListResult`,
  `{ jobId: string }`, `null`; events `{ [MODS_EVENTS.installDecision]: ModInstallDecisionEvent }`).
  `src/main/modules/mods/index.ts`: `const { handle, emit } = defineModule<ModsContract>('mods',
MODS_HANDLER_SCHEMAS).bind(setup)`; drop the schema imports. `catalog-schema.ts` stays in main.
  Move `src/main/modules/mods/schemas.test.ts` → `src/shared/modules/mods.test.ts` (imports
  re-pointed); `src/main/modules/mods/map-presence.test.ts` imports `mapPresenceInputSchema` from
  `@shared/modules/mods`. `docs/systems/mods-module.md`: the `schemas.ts` line becomes the shared
  contract + schema map. Tests: `src/shared/modules/mods.test.ts` › "ModsContract req types are
  derived from MODS_HANDLER_SCHEMAS" and › "MODS_HANDLER_SCHEMAS has exactly one schema per
  MODS_HANDLERS value"; existing `src/main/modules/mods/*.test.ts` stay green.

- **D3 — `mods` client.**
  `src/renderer/src/modules/mods/client.ts`: `createModuleClient<ModsContract>('mods')`; every
  `callModule<…>` → `client.call(MODS_HANDLERS.x, …)`, `onModuleEvent<…>` → `client.on(MODS_EVENTS.installDecision, …)`;
  keep passing the handler constants. Exported names/signatures unchanged; a signature the inferred
  type proves wrong is corrected at its callers, never cast. Mirror `src/renderer/src/modules/home/client.ts`.
  Tests: existing mods renderer tests (`src/renderer/src/modules/mods/**/*.test.ts*`) stay green.

- **D4 — `downloads` contract + main half.**
  Move every export of `src/main/modules/downloads/schemas.ts` into `src/shared/modules/downloads.ts`
  (it already imports only `@shared/schemas` and constants from that same file — drop the
  self-import) and delete the main file. Manifest schemas (`src/main/services/content/manifest-schemas.ts`)
  and `src/main/modules/downloads/persisted.ts` stay in main. Add `DOWNLOADS_HANDLER_SCHEMAS`
  (`satisfies`) for all 20 `DOWNLOADS_HANDLERS` and `DownloadsContract` (`res` per handler from
  `src/main/modules/downloads/index.ts`; events `{}`). `index.ts`: register via
  `defineModule<DownloadsContract>('downloads', DOWNLOADS_HANDLER_SCHEMAS).bind(setup)`. Append
  `src/main/modules/downloads/schemas.test.ts`'s cases to `src/shared/modules/downloads.test.ts`
  and delete the main test. `docs/systems/install-module.md`: fix any mention of the main
  `schemas.ts`. Tests: `downloads.test.ts` › "DownloadsContract req types are derived from
  DOWNLOADS_HANDLER_SCHEMAS" and › "DOWNLOADS_HANDLER_SCHEMAS has exactly one schema per
  DOWNLOADS_HANDLERS value"; existing `src/main/modules/downloads/**/*.test.ts` stay green.

- **D5 — `downloads` client.**
  `src/renderer/src/modules/downloads/client.ts`: `createModuleClient<DownloadsContract>('downloads')`;
  all 20 `callModule<…>` → `client.call(DOWNLOADS_HANDLERS.x, …)`. Same rules as D3 (names and
  signatures unchanged, no cast, mirror `home/client.ts`). Tests: existing downloads renderer tests
  and `src/renderer/src/views/**` tests that use these functions stay green.

- **D6 — Move config's request schemas to shared (mechanical, no contract yet).**
  `git mv src/main/modules/config/schemas.ts src/shared/modules/config-schemas.ts`; its imports are
  already all `@shared/...` (the `@shared/modules/config` import stays `import type`). No schema
  body changes. Re-point imports: `src/main/modules/config/index.ts`,
  `index.raw-files.test.ts`, `persisted.test.ts`, `profiles.ipc-schemas.test.ts`,
  `schema-parity.test.ts` (to `@shared/modules/config-schemas`); `git mv
  src/main/modules/config/schemas.test.ts src/shared/modules/config-schemas.test.ts`. Fix the
  `schemas.ts` mention in the comment in `src/main/modules/config/picked-files.ts` and line ~41 of
  `docs/systems/config-module.md` (request schemas now in shared; `persisted.ts` stays main).
  Tests: `schema-parity.test.ts` snapshot unchanged (proves no schema behaviour moved), all
  `src/main/modules/config/**` and `config-schemas.test.ts` green.

- **D7 — `config` contract + main half.**
  In `src/shared/modules/config-schemas.ts` add `CONFIG_HANDLER_SCHEMAS` (`satisfies Record<…,
ZodTypeAny>`, one entry per `CONFIG_HANDLERS` value — 35) importing `CONFIG_HANDLERS` as a value
  from `./config`. In `src/shared/modules/config.ts` add `ConfigContract` with
  `import type { CONFIG_HANDLER_SCHEMAS } from './config-schemas'` (`req` = `z.infer<typeof
CONFIG_HANDLER_SCHEMAS[K]>`, `res` = the value each handler in `src/main/modules/config/index.ts`
  returns today, including in-band `DomainResult` types; events `{}` — config emits none).
  `src/main/modules/config/index.ts`: `defineModule<ConfigContract>('config',
CONFIG_HANDLER_SCHEMAS).bind(setup)`, drop the per-handler schema imports; it must stay under its
  600-line cap (`src/architecture.test.ts` LINE_CAPS). A mismatch the compiler finds is fixed in
  the contract (or in main if main is wrong), not with a cast. Tests: new cases in
  `src/shared/modules/config-schemas.test.ts` › "ConfigContract req types are derived from
  CONFIG_HANDLER_SCHEMAS" (`expectTypeOf` on a representative set incl. `setSwitchBind`) and ›
  "CONFIG_HANDLER_SCHEMAS has exactly one schema per CONFIG_HANDLERS value"; existing
  `src/main/modules/config/**/*.test.ts` stay green.

- **D8 — `config` client.**
  `src/renderer/src/modules/config/client.ts`: `createModuleClient<ConfigContract>('config')`; all
  35 `callModule<…>` → `client.call(CONFIG_HANDLERS.x, …)`. Same rules as D3. Tests: existing
  config renderer tests (`src/renderer/src/modules/config/**/*.test.ts*`) stay green.

- **D9 — `replays` contract + main half.**
  `src/shared/modules/replays.ts`: `REPLAYS_HANDLER_SCHEMAS` annotation → `satisfies`; add
  `ReplaysContract` for all 33 handlers (`res` from `src/main/modules/replays/index.ts`) and the 4
  `REPLAYS_EVENTS` payloads (`ReplaysPlaybackPosition`, `ReplaysPlaybackState`,
  `ReplaysPlaybackDisplay`, `ReplaysScanProgress`). `src/main/modules/replays/index.ts`:
  `defineModule<ReplaysContract>('replays', REPLAYS_HANDLER_SCHEMAS).bind(setup)`.
  `scan-service.ts` (dep `emit`, ~:90) and `playback-control.ts` (~:38) type `emit` as
  `BoundModule<ReplaysContract>['emit']` (mirror `src/main/modules/servers/scan-service.ts`); adjust
  their tests' fake `emit` types only. `docs/systems/replays-module.md` line ~43: the shared file
  also carries the contract. Tests: `src/shared/modules/replays.test.ts` › "ReplaysContract req
  types are derived from REPLAYS_HANDLER_SCHEMAS"; existing `src/main/modules/replays/**/*.test.ts`
  (incl. `stage.test.ts`'s schema identity check) stay green.

- **D10 — `replays` client.**
  `src/renderer/src/modules/replays/client.ts`: `createModuleClient<ReplaysContract>('replays')`;
  every `callModule<…>` → `client.call(REPLAYS_HANDLERS.x, …)`, the four `onModuleEvent<…>` →
  `client.on(REPLAYS_EVENTS.x, …)`. Same rules as D3. Tests: existing replays renderer tests stay
  green.

- **D11 — Close the gates + docs.**
  `src/renderer/src/modules/handler-coverage.test.ts`: delete `CONVERTED`; rename the second case
  to › "every module client is built with createModuleClient" — for every `./*/client.ts` in the
  glob: contains `createModuleClient<`, does not match `/\bcallModule\b/`, `/\bonModuleEvent\b/`
  or `/as Outcome/`. `src/main/modules/handler-coverage.test.ts`: `DECLARED` typed
  `Record<Exclude<ModuleId, 'assets'>, readonly string[]>` (no `Partial`, no `?? []`; narrow `id`
  in the `it.each`); add › "every module's main half binds defineModule" (for each `MODULES` id,
  `src/main/modules/<id>/index.ts` contains `defineModule<` and no `setup(...)` destructuring of
  `handle`, i.e. not `/setup\(\{[^}]*\bhandle\b/`); add › "request schemas live in shared,
  persisted and manifest schemas in main" (no `src/main/modules/*/schemas.ts` exists;
  `src/main/modules/{config,downloads,replays}/persisted.ts`, `src/main/modules/mods/catalog-schema.ts`,
  `src/main/services/content/manifest-schemas.ts` exist). `docs/ARCHITECTURE.md`: drop the
  "main-only `schemas.ts` … planned in story 232" sentence (~126), say every module is
  contract-typed (~328), drop "replays' client still calls `callModule`/`onModuleEvent` (planned in
  story 232)" (~410). `src/main/modules/architecture-doc.test.ts` › "the module seam has no
  unconverted-module remnants" (doc contains neither `planned in story 232` nor `not-yet-converted`).

## Model Hints

- D7 → deliverable-hard — 35 handlers whose `res` must be read off main's real return values
  (several in-band `DomainResult` unions, `z.ZodType<…>`-annotated and transforming schemas), and
  under a wall of compile errors the easy way out is a widened `res` or a cast that keeps every
  runtime test green while making the contract a lie for D8.
- Review: → default — the compile-time claims are enforced by `npm run typecheck`, the coverage
  claims by D11's source and registry tests (including the `as Outcome` ban that catches the
  loose-`res`-plus-cast shortcut), and no-behaviour-change by the existing suites and flows.

## Acceptance Tests

- AC1 → unit `src/shared/modules/library.test.ts` › "LibraryContract req types are derived from
  LIBRARY_HANDLER_SCHEMAS", "LIBRARY_HANDLER_SCHEMAS has exactly one schema per LIBRARY_HANDLERS
  value" (D1); unit `src/shared/modules/mods.test.ts` › "ModsContract req types are derived from
  MODS_HANDLER_SCHEMAS", "MODS_HANDLER_SCHEMAS has exactly one schema per MODS_HANDLERS value" (D2);
  unit `src/shared/modules/downloads.test.ts` › "DownloadsContract req types are derived from
  DOWNLOADS_HANDLER_SCHEMAS", "DOWNLOADS_HANDLER_SCHEMAS has exactly one schema per
  DOWNLOADS_HANDLERS value" (D4); unit `src/shared/modules/config-schemas.test.ts` ›
  "ConfigContract req types are derived from CONFIG_HANDLER_SCHEMAS", "CONFIG_HANDLER_SCHEMAS has
  exactly one schema per CONFIG_HANDLERS value" (D7); unit `src/shared/modules/replays.test.ts` ›
  "ReplaysContract req types are derived from REPLAYS_HANDLER_SCHEMAS" (D9)
- AC2 → unit `src/main/modules/handler-coverage.test.ts` › "every module's main half binds
  defineModule" (D11 over D1/D2/D4/D7/D9); unit `src/renderer/src/modules/handler-coverage.test.ts`
  › "every module client is built with createModuleClient" (D11 over D1/D3/D5/D8/D10); both
  backed by `npm run typecheck`
- AC3 → unit `src/main/modules/handler-coverage.test.ts` › "every module registers exactly its
  declared handlers" (D11: `DECLARED` without `Partial`); unit
  `src/renderer/src/modules/handler-coverage.test.ts` › "every handler constant is referenced by
  its module's client" and "every module client is built with createModuleClient" (D11: no
  `CONVERTED` list)
- AC4 → unit `src/main/modules/handler-coverage.test.ts` › "request schemas live in shared,
  persisted and manifest schemas in main" (D11, over D2/D4/D6); unit
  `src/main/modules/config/schema-parity.test.ts` snapshot unchanged (D6)
- AC5 → regression e2e (run each via `npm run ui:flow -- <name>`):
  library/config `scripts/flows/home-tile-states.mjs` › "home-tile-states" (D1, D8);
  mods `scripts/flows/mods-install.mjs` › "mods-install", `scripts/flows/mods-remove.mjs` ›
  "mods-remove", `scripts/flows/mod-update.mjs` › "mod-update", `scripts/flows/mods-catalog.mjs` ›
  "mods-catalog" (D3); downloads `scripts/flows/bootstrap-wizard.mjs` › "bootstrap-wizard",
  `scripts/flows/downloads-tab.mjs` › "downloads-tab", `scripts/flows/engine-update.mjs` ›
  "engine-update", `scripts/flows/repair.mjs` › "repair", `scripts/flows/settings-downloads-section.mjs`
  › "settings-downloads-section" (D5); config `scripts/flows/import-from-files.mjs` ›
  "import-from-files", `scripts/flows/raw-save-cascades.mjs` › "raw-save-cascades",
  `scripts/flows/controls-drag-reorder.mjs` › "controls-drag-reorder",
  `scripts/flows/settings-section-rename-add-cvar.mjs` › "settings-section-rename-add-cvar",
  `scripts/flows/care-fix-item.mjs` › "care-fix-item", `scripts/flows/unsaved-diff.mjs` ›
  "unsaved-diff" (D8); replays `scripts/flows/replays-demo-rows.mjs` › "replays-demo-rows",
  `scripts/flows/replays-edit-sidecar.mjs` › "replays-edit-sidecar",
  `scripts/flows/replays-incremental-scan.mjs` › "replays-incremental-scan",
  `scripts/flows/replays-play-q2pro.mjs` › "replays-play-q2pro", `scripts/flows/replays-timeline.mjs`
  › "replays-timeline", `scripts/flows/replays-name-templates.mjs` › "replays-name-templates",
  `scripts/flows/replays-stage.mjs` › "replays-stage" (D10); the same `Outcome` envelope is proven
  by the unchanged client signatures (`npm run typecheck`) and the existing module unit suites
- D11 docs → unit `src/main/modules/architecture-doc.test.ts` › "the module seam has no
  unconverted-module remnants"

No user-facing criterion: the story changes no surface, so the e2e lines are regression proof,
not acceptance of a user action. No manual residue.

## Done
