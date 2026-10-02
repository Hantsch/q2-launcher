---
id: 205
title: module handlers are typed from a contract, and every declared handler is live
status: done # draft -> ready -> in-progress -> done
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

- [x] **AC1** — A per-module contract type exists in `src/shared/modules/<id>.ts` shaped like
      `IpcInvokeMap` (`'news.get': { req: void; res: NewsFeed }`, plus an events branch), with
      the request type derived from the existing zod schema via `z.infer` so no schema is
      rewritten.
- [x] **AC2** — Main has `defineModule<H>(id)` whose `handle<K extends keyof H>` derives payload
      and result types and registers the schema from the contract's schema map, so a handler with
      a missing schema or a wrong result type is a compile error; renderer has
      `createModuleClient<H>(id)` whose `call('news.get')` infers `Promise<Outcome<NewsFeed>>`.
      Both are additive beside the existing `handle`/`callModule` (registry runtime untouched).
- [x] **AC3** — `home` (6 handlers) is fully converted as the reference; at least one further
      module (`servers` or `replays`) is converted in this story; the remaining modules are listed
      as follow-up deliverables with no `callModule<` generic left in a converted module's client.
- [x] **AC4** — `MainModuleRegistry` exposes `handlerTypes(moduleId)`; one parameterised test
      asserts, for every module, that the registered set equals `Object.values(X_HANDLERS)` in
      both directions.
- [x] **AC5** — A renderer test asserts every handler constant is referenced by its module's
      `client.ts` (flow-only names on an explicit allowlist); `demos.list` is removed end to end
      and the six unused handlers are either wired or removed, each with a one-line reason in the
      story's Decisions.
- [x] **AC6** — `moduleInvokeSchema`'s module-id enum derives from `MODULE_MANIFESTS`.
- [x] **AC7** — docs/ARCHITECTURE.md "Adding a module" step 1 describes the contract type and
      `defineModule`/`createModuleClient`, and the "type safety per call is the module's own job"
      sentence is gone.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — Where do config/downloads/mods request schemas live after this — shared (so the
  contract map can carry them) or main-only with the schema map typed against the contract?
  Persisted and manifest schemas stay in main either way.

## Decisions (Sprint)

- **(User)** request schema location: Shared, carried by the contract map; persisted/manifest schemas stay in main.
- The second converted module is `servers` (not `replays`): it is the only module with a
  feature-gated handler map (`SERVERS_WATCHLIST_HANDLERS`, `options.feature`), so it proves
  `defineModule` against the hardest shape, and five of the six dead handlers live there.
- config, downloads, mods, replays and library are follow-up deliverables FU1–FU5, not built here:
  AC3 asks for only two conversions, and config/downloads/mods each carry a main→shared schema
  move (User decision) that is a story's worth of work on its own.
- `defineModule<H>(id, schemas)` takes the contract's schema map as a second argument: a type
  parameter cannot carry runtime schemas, and a global id→map registry would make main import
  every module's contract to register one.
- `defineModule` is a binder over the existing `ModuleSetup` (`defineModule(...).bind(setup)`),
  so the registry runtime stays untouched as AC2 requires.
- Contract `req` is `z.infer` (the parsed output the handler receives) and the client sends the
  same type; neither home's nor servers' schemas use `.transform/.default/.catch`, so input and
  output coincide (a follow-up module whose schema transforms must use `z.input` on the client).
- Contract `res` is the success value `R`; handlers return `Outcome<R>` (story 204's compile-time
  envelope), and the client call resolves to `Outcome<R>`.
- The existing `X_HANDLER_SCHEMAS` maps become the contract schema maps; their `: Record<…,
ZodTypeAny>` annotation turns into `satisfies Record<…, ZodTypeAny>`, because the annotation
  erases the per-key schema type `z.infer` needs.
- Converted clients keep passing the handler constant (`client.call(HOME_HANDLERS.newsGet)`), so
  the AC5 reference test is one plain constant-reference check for converted and unconverted
  modules alike.
- `DOWNLOADS_HANDLERS.manifestGet` → removed: no renderer or flow caller, and the manifest is
  fetched internally by every handler that needs it (`downloads/index.ts:185`, `:694`).
- `SERVERS_HANDLERS.favouritesList` → removed: favourites reach the renderer as scan targets with
  origin `favourite`, and `favourites.add/remove` already answer the full list.
- `SERVERS_HANDLERS.manualList/manualAdd/manualRemove` → removed: no UI adds servers by hand and
  none is planned in the roadmap; the persisted `manualServers` slice and its scan merge
  (`address-set.ts`) stay so existing data still scans and a later story only re-adds handlers.
- `SERVERS_HANDLERS.historyRead` → kept, on the flow-only allowlist: `scripts/flows/servers-join.mjs`
  reads it to prove a join is recorded.
- `REPLAYS_HANDLERS.demosList` → removed end to end: the view reads `index.read` since stories
  144/150, and `listDemos` has no caller.
- The renderer reference test reads client sources via `import.meta.glob('./*/client.ts', { query:
'?raw', eager: true })`, so it stays in the web project and needs no node-only tsconfig exclude.
- The bus-wide coverage test registers modules with an all-unlocked `FeatureGate`, and servers'
  declared set is `SERVERS_HANDLERS ∪ SERVERS_WATCHLIST_HANDLERS`, because locked handlers are
  never registered by design (story 130).
- AC7 is proven by a doc test, mirroring `replays/name-template-doc.test.ts`, because a docs
  criterion with no test is an unverifiable promise under P1.
- No CHANGELOG entry: nothing changes for the user.

## Plan

Depends on 204 (handlers return `Outcome<R>`, registry passes it through) and 206 (in-band result
types are `DomainResult`). Order:

1. **Typed seam, additive** — `src/shared/modules/contract.ts` (contract helper types),
   `src/main/modules/define-module.ts` (`defineModule`), `createModuleClient` in
   `src/renderer/src/modules/moduleClient.ts`. Old `handle`/`callModule` untouched. (D1, D2)
2. **Remove the dead** before any contract names them — five servers/downloads handlers (D3),
   `demos.list` end to end (D4).
3. **Convert** home as the reference (D5), then servers main (D6) and servers client (D7).
4. **Make it enforced** — `registry.handlerTypes()` + bus-wide registered-vs-declared test (D8),
   renderer reference test + no-`callModule<`-in-converted-clients test (D9),
   `moduleInvokeSchema` enum from `MODULE_MANIFESTS` (D10).
5. **Docs** — ARCHITECTURE.md module-seam paragraph and "Adding a module" step 1, with a doc
   test (D11).

Follow-ups (not built in this story, listed for the sprint review to cut into a story):

- **FU1 config** (35 handlers) — move `src/main/modules/config/schemas.ts` request schemas into
  `src/shared/modules/config.ts` as `CONFIG_HANDLER_SCHEMAS`, then convert main + client.
- **FU2 downloads** (20 after D3) — move request schemas from `src/main/modules/downloads/schemas.ts`
  to shared; `sha256Schema`, `httpsUrlSchema`, `harnessLoopback*`, `manifestPackageSchema`,
  `manifestEnvelopeSchema` stay main (manifest schemas).
- **FU3 mods** (10) — move `src/main/modules/mods/schemas.ts` to shared; `catalog-schema.ts` stays
  main.
- **FU4 replays** (33 after D4) — schemas already shared (`REPLAYS_HANDLER_SCHEMAS`); convert main
  - client.
- **FU5 library** (1) — trivial; add `LIBRARY_HANDLER_SCHEMAS` and convert.

## Deliverables

- **D1 — Contract types + `defineModule` (shared + main, additive).**
  New `src/shared/modules/contract.ts` (types only, no zod runtime import beyond `import type`):
  `ModuleContract = { handlers: Record<string, { req: unknown; res: unknown }>; events:
Record<string, unknown> }`; `ContractSchemas<H> = { [K in keyof H['handlers']]:
ZodType<H['handlers'][K]['req']> }` (every key required, so a missing schema is a compile
  error); `HandlerReq<H,K>`, `HandlerRes<H,K>`, `EventPayload<H,E>`; and
  `PayloadArgs<Req> = [Req] extends [void | undefined] ? [] : [payload: Req]`.
  New `src/main/modules/define-module.ts`: `defineModule<H extends ModuleContract>(id: ModuleId,
schemas: ContractSchemas<H>)` returning `{ id, schemas, bind(setup: ModuleSetup) }`; `bind`
  yields `handle<K extends keyof H['handlers'] & string>(type: K, handler: (p: HandlerReq<H,K>) =>
Outcome<HandlerRes<H,K>> | Promise<Outcome<HandlerRes<H,K>>>, options?: { feature?: FeatureName
})` — it calls `setup.handle(type, schemas[type], handler, options)`, nothing else — and
  `emit<E extends keyof H['events'] & string>(type: E, payload: EventPayload<H,E>)` over
  `setup.emit`. `src/main/modules/types.ts` and `registry.ts` are not changed.
  Tests, `src/main/modules/define-module.test.ts`: "defineModule registers each handler with its
  contract schema" (a fake `ModuleSetup` records `(type, schema)` and the schema instance is the
  map's); "a bad payload never reaches a defineModule handler" (register via a real
  `MainModuleRegistry`, invoke with a wrong payload → `ipc.error.invalidPayload`); "a missing
  schema or a wrong result type does not compile" — `// @ts-expect-error` lines for: a schema map
  missing a key, a handler returning `Outcome<number>` where `res` is `string`, an unknown handler
  type, an `emit` with a wrong payload. `npm run typecheck` fails if any of those compiles, so the
  lines are the proof. Also `src/shared/modules/contract.test.ts` › "a contract's req is the
  schema's z.infer" (`expectTypeOf`).

- **D2 — `createModuleClient` (renderer, additive).**
  In `src/renderer/src/modules/moduleClient.ts`, beside the unchanged `callModule`/`onModuleEvent`:
  `createModuleClient<H extends ModuleContract>(id: ModuleId)` returning `call<K extends keyof
H['handlers'] & string>(type: K, ...args: PayloadArgs<HandlerReq<H,K>>):
Promise<Outcome<HandlerRes<H,K>>>` and `on<E extends keyof H['events'] & string>(type: E,
listener: (p: EventPayload<H,E>) => void): () => void`. Implement over `callModule`/`onModuleEvent`
  (the one remaining cast stays inside `moduleClient.ts`). Types from `@shared/modules/contract`.
  Tests, `src/renderer/src/modules/moduleClient.test.ts`: "createModuleClient infers Outcome<Res>
  per handler" (`expectTypeOf` on a local test contract) plus `@ts-expect-error` for a missing
  required payload, a payload on a void handler, an unknown type; "createModuleClient sends the
  module:invoke envelope" (mock `../lib/bridge`'s `invoke`, assert `{ moduleId, type, payload }`,
  and no `payload` key for a void handler); "on filters by moduleId and type".

- **D3 — Remove five dead handlers (servers + downloads).**
  Remove `favouritesList`, `manualList`, `manualAdd`, `manualRemove` from `SERVERS_HANDLERS`,
  their entries in `SERVERS_HANDLER_SCHEMAS` and their input schemas
  (`src/shared/modules/servers.ts`), their `handle(...)` registrations
  (`src/main/modules/servers/index.ts` ~276, ~305–325), and the now-orphaned
  `src/main/modules/servers/manual-servers.ts` + its test (check `listFavourites` in
  `favourites.ts`: delete only if it becomes unused). Keep `historyRead`, `ManualServerEntry`, the
  persisted `manualServers` slice and its merge in `address-set.ts`. Remove
  `DOWNLOADS_HANDLERS.manifestGet` (`src/shared/modules/downloads.ts:23`), its registration
  (`src/main/modules/downloads/index.ts:150–163`) and `manifestGetInputSchema` if unused;
  `manifestService.getManifest` stays (used at `:185`, `:694`). Locale keys stay. Update the tests
  that exercised them: `src/main/modules/servers/index.test.ts` (~313–342, ~418–495: keep the
  `history.read` assertions), `src/shared/modules/servers.test.ts` (~41–47, ~226–300),
  `src/main/modules/downloads/index.test.ts` (~208–260; keep any `manifestUnavailable` coverage by
  moving it to a handler that still fetches the manifest, if one exists in that file). Test: the
  existing suites stay green; `servers.test.ts` › "SERVERS_HANDLERS lists exactly the live handlers"
  (the pinned value list without the four).

- **D4 — Remove `demos.list` end to end.**
  Delete `REPLAYS_HANDLERS.demosList` (`src/shared/modules/replays.ts:42`) and its
  `REPLAYS_HANDLER_SCHEMAS` entry (`:574`); the handler (`src/main/modules/replays/index.ts`
  ~460–480, plus any helper only it used — `discoverDemos` itself stays, the scan uses it);
  `listDemos` in `src/renderer/src/modules/replays/client.ts:91–93` (and the stale comment in
  `ReplaysView.test.tsx:20`). In `src/main/modules/replays/index.test.ts`: drop `'demos.list'` from
  the pinned list (~84), the `describe('demos.list')` cases (~144–200 — keep "startup sweeps
  _launcher of every installation", moving it out of that describe), and the `payloadFor` entry
  (~723). Test: `src/main/modules/replays/index.test.ts` › "demos.list is gone: invoking it answers
  modules.error.notImplemented".

- **D5 — Convert `home` (reference).**
  `src/shared/modules/home.ts`: `HOME_HANDLER_SCHEMAS` → `satisfies Record<…>`; add `HomeContract
extends ModuleContract` with handlers `[HOME_HANDLERS.x]: { req: z.infer<typeof
HOME_HANDLER_SCHEMAS[...]>; res: … }` (`news.get`/`news.refresh` → `NewsFeed`, `slide.openUrl` →
  `null`, `layout.*` → `HomeLayout`) and events `{ [HOME_EVENTS.newsChanged]: NewsFeed }`.
  Shared exports only the type and the map; `defineModule` is called in main.
  `src/main/modules/home/index.ts`: `const { handle, emit } = defineModule<HomeContract>('home',
HOME_HANDLER_SCHEMAS).bind(setup)`; drop the per-handler schema imports. `src/renderer/src/
modules/home/client.ts`: `const client = createModuleClient<HomeContract>('home')`; each
  function becomes `client.call(HOME_HANDLERS.x, …)` / `client.on(HOME_EVENTS.newsChanged, …)`;
  exported function names and signatures unchanged. Tests: existing `home/index.test.ts`,
  `home/client.test.ts`, `shared/modules/home.test.ts` stay green; `home.test.ts` › "HomeContract
  req types are derived from HOME_HANDLER_SCHEMAS" (`expectTypeOf`).

- **D6 — Convert `servers` main half.**
  `src/shared/modules/servers.ts`: `SERVERS_HANDLER_SCHEMAS` and `SERVERS_WATCHLIST_HANDLER_SCHEMAS`
  → `satisfies`; add `ServersContract` covering both maps (`req` via `z.infer`, `res` = the value
  type each handler's main code returns today, e.g. `FavouriteServerEntry[]`, the 206
  `DomainResult` types) plus `SERVERS_EVENTS` payloads; export `SERVERS_CONTRACT_SCHEMAS = {
...SERVERS_HANDLER_SCHEMAS, ...SERVERS_WATCHLIST_HANDLER_SCHEMAS }`.
  `src/main/modules/servers/index.ts`: register every handler through
  `defineModule<ServersContract>('servers', SERVERS_CONTRACT_SCHEMAS).bind(setup)`, watchlist ones
  keeping `{ feature: 'watchlist' }`; every `emit(...)` goes through the typed `emit`. Fix any
  real mismatch the compiler now finds in the contract, not with a cast. Tests: existing
  `servers/index.test.ts` and `scan-integration.test.ts` stay green.

- **D7 — Convert `servers` client.**
  `src/renderer/src/modules/servers/client.ts`: `createModuleClient<ServersContract>('servers')`;
  every `callModule<…>` and `onModuleEvent<…>` becomes `client.call(SERVERS_HANDLERS.x, …)` /
  `client.on(SERVERS_EVENTS.x, …)`; exported names and signatures unchanged (a signature the
  inferred type proves wrong is corrected at its callers). Tests: existing
  `servers/client.test.ts` and servers component tests stay green; e2e regression flows below.

- **D8 — `handlerTypes()` + bus-wide coverage test (main).**
  `src/main/modules/registry.ts`: `handlerTypes(moduleId: ModuleId): string[]` (types registered
  under `moduleId/`, sorted). `src/main/modules/index.ts`: export the `MODULES` list. Replace
  replays' pinned `Object.values(REPLAYS_HANDLERS)` assertion (`replays/index.test.ts` ~73–108)
  with the new test. New `src/main/modules/handler-coverage.test.ts`: `it.each` over `MODULES`
  with a declared map `Record<…, readonly string[]>` (config → `CONFIG_HANDLERS`, …, servers →
  `SERVERS_HANDLERS ∪ SERVERS_WATCHLIST_HANDLERS`); register each module in a
  `MainModuleRegistry` with an all-unlocked `FeatureGate` and a fake `AppContext` (reuse the kit in
  `src/test-support/` and the fakes the per-module `index.test.ts` files already build — extract
  one shared fake there rather than a seventh copy), then assert `handlerTypes(id)` equals the
  declared set in both directions. Tests: `registry.test.ts` › "handlerTypes lists a module's
  registered types only"; `handler-coverage.test.ts` › "every module registers exactly its
  declared handlers".

- **D9 — Renderer reference test.**
  New `src/renderer/src/modules/handler-coverage.test.ts`: load every `./*/client.ts` via
  `import.meta.glob(..., { query: '?raw', import: 'default', eager: true })`; for each module's
  shared `X_HANDLERS` (and `SERVERS_WATCHLIST_HANDLERS`), assert each key appears as
  `X_HANDLERS.key` in that module's client source, except `FLOW_ONLY = { servers: ['historyRead'] }`
  (comment: read by `scripts/flows/servers-join.mjs`). Second case: `CONVERTED = ['home',
'servers']` clients contain no `callModule<` and no `onModuleEvent<`. Tests: › "every handler
  constant is referenced by its module's client"; › "a converted module's client has no
  callModule generic".

- **D10 — `moduleInvokeSchema` id enum from manifests.**
  `src/shared/ipc-schemas.ts:258`: `moduleId: z.enum(MODULE_MANIFESTS.map((m) => m.id) as
[ModuleId, ...ModuleId[]])` (import from `./types/module`). Test in `src/shared/ipc-schemas.test.ts`
  (create if absent) › "moduleInvokeSchema accepts exactly the manifest ids" (every manifest id
  parses; `'nope'` fails; the enum's `options` equal the manifest ids).

- **D11 — ARCHITECTURE.md.**
  `docs/ARCHITECTURE.md`: "The IPC contract" module-seam paragraph (~77–80) says request schemas
  live in the module's shared contract map (main-only `schemas.ts` is the pre-conversion state of
  FU1–FU3); "Adding a module" step 1 describes the contract type + schema map, step 3 `defineModule`,
  step 4 `createModuleClient`; delete "Type safety per call is the module's own job, which is what
  its typed client is for." and say the contract gives it. Test, mirroring
  `src/main/modules/replays/name-template-doc.test.ts`: `src/main/modules/architecture-doc.test.ts`
  › "Adding a module names defineModule and createModuleClient" (both names present in that
  section; the old sentence absent).

## Model Hints

- D1 → deliverable-hard — the generic signatures are the whole story: a too-loose type (a
  `string` fallback on `K`, `Outcome<unknown>` accepted as a return, `PayloadArgs` distributing
  over a union) still passes every runtime test and makes AC2's "compile error" silently untrue
  for D5–D7 and FU1–FU5.
- Review: → default — the compile-error claims are pinned by `@ts-expect-error` lines that
  `npm run typecheck` fails on, and the coverage claims by D8/D9's tests, so there is no
  plausible wrong implementation left that passes tests and a default review.

## Acceptance Tests

- AC1 → unit `src/shared/modules/contract.test.ts` › "a contract's req is the schema's z.infer"
  (D1); unit `src/shared/modules/home.test.ts` › "HomeContract req types are derived from
  HOME_HANDLER_SCHEMAS" (D5)
- AC2 → unit `src/main/modules/define-module.test.ts` › "defineModule registers each handler with
  its contract schema", "a bad payload never reaches a defineModule handler", "a missing schema or
  a wrong result type does not compile" (D1, enforced by `npm run typecheck`); unit
  `src/renderer/src/modules/moduleClient.test.ts` › "createModuleClient infers Outcome<Res> per
  handler", "createModuleClient sends the module:invoke envelope" (D2)
- AC3 → unit `src/renderer/src/modules/handler-coverage.test.ts` › "a converted module's client has
  no callModule generic" (D9, over D5/D7); follow-ups FU1–FU5 listed in `## Plan`; regression e2e
  `scripts/flows/news-feed.mjs` › "news-feed", `scripts/flows/home-dashboard-arrange.mjs` ›
  "home-dashboard-arrange", `scripts/flows/servers-join.mjs` › "servers-join",
  `scripts/flows/servers-watchlist.mjs` › "servers-watchlist", `scripts/flows/servers-quick-filters.mjs`
  › "servers-quick-filters" (D5–D7: the converted modules still work through the real surface)
- AC4 → unit `src/main/modules/registry.test.ts` › "handlerTypes lists a module's registered types
  only"; unit `src/main/modules/handler-coverage.test.ts` › "every module registers exactly its
  declared handlers" (D8)
- AC5 → unit `src/renderer/src/modules/handler-coverage.test.ts` › "every handler constant is
  referenced by its module's client" (D9); unit `src/main/modules/replays/index.test.ts` ›
  "demos.list is gone: invoking it answers modules.error.notImplemented" (D4); unit
  `src/shared/modules/servers.test.ts` › "SERVERS_HANDLERS lists exactly the live handlers" (D3);
  reasons in `## Decisions (Sprint)`
- AC6 → unit `src/shared/ipc-schemas.test.ts` › "moduleInvokeSchema accepts exactly the manifest
  ids" (D10)
- AC7 → unit `src/main/modules/architecture-doc.test.ts` › "Adding a module names defineModule and
  createModuleClient" (D11)

No user-facing criterion: this story changes no surface, so the e2e lines above are regression
proof, not acceptance of a user action.

## Done

Typed module seam shipped: `ModuleContract` types (`shared/modules/contract.ts`), `defineModule<H>(id, schemas).bind(setup)` in main, `createModuleClient<H>(id)` in the renderer, both additive beside `handle`/`callModule`. `home` and `servers` are fully converted (no `callModule<`/`onModuleEvent<` left); six dead handlers and `demos.list` are gone; `registry.handlerTypes()` backs a bus-wide registered-vs-declared test and a renderer reference test; `moduleInvokeSchema` ids derive from `MODULE_MANIFESTS`; ARCHITECTURE.md describes the seam.

Commit message: `205: typed module contract (defineModule/createModuleClient), home+servers converted, dead handlers removed, handler-coverage tests`

Verification (narrow gate): `npm run build`, `npm run typecheck` green; `npx vitest run --changed HEAD` (183 files, 2434 tests) plus an explicit run of src/main/modules, src/shared and the touched renderer module dirs (336 files, 4728 passed, 1 skipped) green; flows via `npm run ui:flow -- <name>`: news-feed, home-dashboard-arrange, servers-join, servers-watchlist, servers-quick-filters all green. AC -> test as walked (all ran and passed): AC1 contract.test.ts + home.test.ts; AC2 define-module.test.ts (3 tests, `@ts-expect-error` proven by typecheck) + moduleClient.test.ts; AC3 renderer handler-coverage.test.ts + 5 flows; AC4 registry.test.ts + main handler-coverage.test.ts; AC5 renderer handler-coverage.test.ts, replays index.test.ts, servers.test.ts; AC6 ipc-schemas.test.ts; AC7 architecture-doc.test.ts. No manual residue. Review 1 (default tier): PASS; two comment-only findings fixed (stale `manual.*` mention, undocumented tuple cast), the rest accepted below. Full regression gate pending (sprint's).

Decisions:
- `ExplicitContract` and `SingleKey` guards in contract.ts reject string-keyed contracts and union handler types, so a missing type argument cannot silently fall back to `string`; a contract must be a `type` alias (an `interface` does not satisfy the `Record` bound).
- `scan-service.ts`'s `emit` is typed `BoundModule<ServersContract>['emit']` instead of `(string, unknown)` so the typed emit is assignable.
- `handler-coverage.test.ts` (main) declares `Partial<Record<ModuleId, ...>>` because `assets` has no main half; a second test asserts the map's keys equal the loaded `MODULES`. The shared `stubbedAppContext()` / `ALL_UNLOCKED_FEATURE_GATE` live in src/test-support/app-context.ts.
- Removing `manifestGet` left no handler producing `downloads.error.manifestUnavailable`; its "key never prose" assertion was dropped with it (the `none-pinned` path stays covered in engine-options.test.ts); the locale key stays.
- `moduleClient.test.ts` stubs `globalThis.q2` (the file's existing seam) rather than mocking `../lib/bridge`.
- Accepted review notes: renderer reference regex also matches comments; pre-existing `as MasterSourcesResult`/`QuickFiltersResult` casts in servers/index.ts are untouched; "(story 205)" trailing pointers in comments.

tiers: D 11 / hard 1 · review default · cycles 1 · agents 13
