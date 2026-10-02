---
id: 204
title: the module bus returns one Outcome envelope and every error key resolves
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a module handler that returns `Outcome<T>` to arrive in the renderer as
`Outcome<T>`, not `Outcome<Outcome<T>>`, so that no client needs a flattener, a forgotten flatten
can no longer treat a failure as success, and the type tells the truth. And I want every error
key main can send to be proven present in the locale by a test, not by discipline.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F04 part 1–2, F31):
`MainModuleRegistry.invoke` wraps every handler return in `ok(...)` unconditionally while config
(46 `fail()` sites), downloads (44), replays (62) and mods (33) handlers already return their own
`Outcome`. Clients cope four ways: 21 per-function flatteners in `config/client.ts` (each with a
copied "double-unwrap gotcha" comment), 7 in downloads, mods flattens unconditionally in its
`call<T>` wrapper (a latent bug for plain-value handlers), replays exposes
`Promise<Outcome<Outcome<NameTemplatesView>>>` to components, and 13+ component sites unwrap
`.value.ok` by hand. The replays client records a shipped user-facing crash from this. Separately,
all 88 `fail('…')` literal keys in main currently resolve in `en.json`, but nothing enforces it;
mods has no typed error keys (12 `'mods.error.*'` literals, outcomes typed `key: string`,
`'downloads.error.diskWrite'` borrowed), and `toMetadataWarnings` builds
`config.import.warning.${reason}` from a widened `string`.

## Acceptance Criteria

- [x] **AC1** — `src/shared/types/common.ts` exports `isOutcome(value)`; `MainModuleRegistry.invoke`
      passes a handler's own `Outcome` through and wraps only plain values; `ModuleSetup.handle`'s
      handler type is `(p: T) => R | Outcome<R> | Promise<…>`. Registry tests cover both shapes
      and a handler that returns `fail(...)`.
- [x] **AC2** — Every client flattener (`result.ok ? result.value : result` and the mods `call<T>`
      unwrap) and every component-side `.value.ok` unwrap is deleted; `git grep -n 'double-unwrap'`
      and `git grep -n '\.value\.ok' src/renderer` return nothing; replays' client signatures are
      single-envelope.
- [x] **AC3** — A test (`src/renderer/src/i18n/error-keys.test.ts` or in main) scans
      `src/main/**/*.ts` for `fail('…')` literals and exported error-key constants and asserts each
      resolves to a leaf in `en.json`; it fails on a deliberately misspelled key.
- [x] **AC4** — mods has `MODS_ERROR_KEYS`/`ModsErrorKey` mirroring downloads; all mods job
      outcomes are typed with it; `mods.error.diskWrite` exists instead of borrowing downloads'.
- [x] **AC5** — `toMetadataWarnings` is typed on `RestoreWarningReason` with a
      `Record<RestoreWarningReason, key>` and a test that every reason resolves.
- [x] **AC6** — Every existing module client test and the module index tests pass; no flow
      changes (the wire shape for plain-value handlers is unchanged).

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — The review's value judge recommends typing `handle`'s return so the compiler, not a
  runtime `isOutcome` sniff, enforces the single envelope — i.e. require every handler to
  return `Outcome<R>` and convert the few plain-value handlers. Which is it: sniff-and-wrap
  (zero handler edits) or compile-time (safer, ~20 handler edits)?

## Decisions (Sprint)

- **(User)** envelope enforcement: Compile-time: every handler returns `Outcome<R>`; convert plain-value handlers.
- **D-a** AC1 is read through the (User) decision: `ModuleSetup.handle`'s handler type is
  `(p: T) => Outcome<R> | Promise<Outcome<R>>` (no `R |` arm), and `invoke` returns the handler's
  `Outcome` as-is — reason: the binding decision replaces AC1's "wraps only plain values" arm.
- **D-b** `isOutcome` is still exported and used in `invoke` as a runtime guard: a non-`Outcome`
  return (only reachable through a cast) is logged and answered with
  `fail('modules.error.handlerFailed', { moduleId, type })`, never wrapped — reason: fail closed
  surfaces a bypassed type in tests instead of shipping a silent double meaning.
- **D-c** `isOutcome` is strict: `ok === true` with an own `value` key, or `ok === false` with an
  `error` object carrying a string `key` — reason: in-band domain unions like `{ ok: true; list }`
  or `{ ok: true }` (`DemoFileActionResult`) must not be mistaken for an envelope.
- **D-d** Plain-value handlers are converted by wrapping their return in `ok(...)`; a void handler
  returns `ok(undefined)` — reason: the wire shape stays byte-identical, which AC6 requires.
- **D-e** In-band domain unions (`QuickFiltersResult`, `WatchlistMutationResult`,
  `ManualServerAddResult`, `MasterSourcesResult`, `ScanStartResult`, `DemoFileActionResult`,
  `ExtraFoldersResult`, `ReplaysStageResult`, shell `RedeemResult`) are returned as
  `ok(domainResult)` unchanged — reason: story 206 AC2 reshapes exactly these into `DomainResult`,
  so converting them here would be done twice.
- **D-f** Consequently AC2's `.value.ok` grep-zero targets the double-envelope unwraps: after this
  story `git grep -n '\.value\.ok' src/renderer` may only hit reads of a D-e domain result
  (today: `UnlockCodePanel.tsx`, `DemoFileActions.tsx`, `useQuickFilters.ts`, `useWatchlist.ts`,
  `WatchlistAddForm.tsx`, `WatchlistRow.tsx`, and the explanatory comment in
  `ServersSettingsSection.tsx`), and `git grep -n 'Outcome<Outcome' src` must be zero — reason: an
  `Outcome<DomainResult>` read is the shape 206 keeps by design, while a nested envelope is the
  defect this story removes; the compiler then rejects any leftover `.value.ok` on a non-union `T`.
- **D-g** The error-key test lives in main as `src/main/error-keys.test.ts` — reason:
  `tsconfig.node.json` already includes `en.json` and has node types for `fs`, whereas a renderer
  test using `node:fs` needs a new `tsconfig.web.json` exclusion.
- **D-h** The scanner is a pure function in that test file taking source text and a list of key
  patterns (today: `fail(` with a single/double-quoted literal, whitespace and newlines allowed
  before it) — reason: story 206 AC4 adds a `reasonKey` pattern to the same scanner.
- **D-i** The scan asserts a floor of at least 80 found `fail` literal keys (88 today) — reason: a
  regex that matches nothing would otherwise pass "every key resolves" vacuously.
- **D-j** Exported error-key constants are covered by importing each `*_ERROR_KEYS` array
  explicitly and asserting, by scanning `src/shared`+`src/main`, that the set of
  `export const <NAME>_ERROR_KEYS` names equals the imported set — reason: a new list that nobody
  wired into the test fails instead of being skipped silently.
- **D-k** `fail()` calls with a variable or template-literal key are out of scope for the scan —
  reason: AC3 names literals; keys assembled from strings are 206's sweep.
- **D-l** `MODS_ERROR_KEYS`/`ModsErrorKey` live in `src/shared/modules/mods.ts`, mirroring
  `DOWNLOADS_ERROR_KEYS` in `src/shared/modules/downloads.ts`, and contain exactly the
  `mods.error.*` keys mods sends today plus `mods.error.diskWrite` — reason: AC4 says mirror
  downloads, and a closed set is only honest if it equals what is sent.
- **D-m** `mods.error.diskWrite`'s English text reuses downloads' `diskWrite` wording — reason: same
  failure, same remedy; the user sees no change.
- **D-n** The `Record<RestoreWarningReason, …>` (`RESTORE_WARNING_KEYS`) lives in
  `src/shared/config/profile-restore.ts` next to the union, and its values are literal keys the
  restore-warning case in `src/main/error-keys.test.ts` checks against `en.json` — reason: one test
  file owns "every key main sends resolves", and the record must be shared so it is a typed
  constant, not a template.

## Plan

Order: main contract first (D1–D2), then clients (D3–D4), then keys (D5–D7). `/build` verifies
once after the last D, so a temporarily broken wire between D1 and D4 is expected.

1. **D1 — envelope contract.** `isOutcome` in `src/shared/types/common.ts`; `handle`'s handler type
   requires `Outcome<R>`; `ModuleHandler` returns `Outcome<unknown>`; `invoke` passes through with
   the D-b guard. Registry tests for ok/fail pass-through, the guard, a thrown handler, and a
   `@ts-expect-error` plain-value registration. ARCHITECTURE.md's module-bus paragraph gains one
   sentence on the envelope.
2. **D2 — plain-value handlers.** The compiler lists them (servers ~31, home 6, library 1,
   replays' linux playback channel, and any plain path in config/downloads/mods/replays); wrap in
   `ok(...)` per D-d/D-e. Main module tests that asserted `ok(ok(x))` / called handlers directly
   are updated to the single envelope.
3. **D3 — config, downloads, home, mods clients.** Delete every flattener and the mods `call<T>`
   unwrap; `callModule<Outcome<X>>` becomes `callModule<X>`; the "double-unwrap" comments go;
   client tests mock the single envelope.
4. **D4 — replays client and its components.** Single-envelope signatures, `flattenOutcome` and the
   sidecar flattening deleted, `playback-store.ts`/`useDemoPlay.ts`/`NameTemplatesList.tsx`/
   `DemoTimeline.tsx`/`useStageReport.ts` read one envelope.
5. **D5 — mods error keys** (AC4). **D6 — restore-warning record** (AC5). **D7 — error-key test**
   (AC3, and the D6 record).

No user-visible change, so no CHANGELOG entry. No systems doc covers the module bus (its doc is
ARCHITECTURE.md, updated in D1).

## Deliverables

- **D1 — the registry passes a handler's `Outcome` through.** Files:
  `src/shared/types/common.ts` (add `isOutcome(value: unknown): value is Outcome<unknown>` — strict:
  `ok === true` with an own `value` key, or `ok === false` with an `error` object whose `key` is a
  string; `{ ok: true }` and `{ ok: true, list: [] }` are NOT outcomes), new
  `src/shared/types/common.test.ts` (unit cases for those shapes), `src/main/modules/types.ts`
  (`ModuleHandler = (payload: unknown) => Promise<Outcome<unknown>> | Outcome<unknown>`;
  `handle: <T, R>(type, schema: ZodType<T>, handler: (payload: T) => Outcome<R> | Promise<Outcome<R>>, options?)`
  — no plain-`R` arm; update the doc comment), `src/main/modules/registry.ts` (`invoke`: `const
result = await entry.handler(parsed.data)`; if `isOutcome(result)` return it; else
  `log.error(...)` and return `fail('modules.error.handlerFailed', { moduleId, type })`; the
  throw path is unchanged), `src/main/modules/registry.test.ts` (tests: "a handler's ok outcome
  arrives as one envelope", "a handler's fail outcome passes through unchanged", "a handler that
  returns a non-Outcome is answered with handlerFailed", "a handler that throws is answered with
  handlerFailed", plus a `// @ts-expect-error` line registering a plain-value handler so the
  compile-time rule is under test), `docs/ARCHITECTURE.md` (the `module:invoke` paragraph near
  "Module request traffic goes through one shell-owned channel": one sentence — every handler
  returns `Outcome<R>`, the registry passes it through unchanged, so a client receives exactly
  `Outcome<R>`). Typecheck failures in module `index.ts` files are expected and fixed by D2.
- **D2 — every module handler returns `Outcome<R>`.** Run `npm run typecheck` after D1: every error
  in a `handle(...)` call is a plain-value handler. Wrap its return in `ok(...)` (import from
  `@shared/types`); a handler with no return value returns `ok(undefined)`; a handler that returns
  an in-band union like `{ ok: true; snapshot } | { ok: false; reasonKey }` returns
  `ok(thatUnion)` unchanged — do NOT convert those unions to `fail()` (story 206 does). Known
  sites: `src/main/modules/servers/index.ts` (~31 handlers), `src/main/modules/home/index.ts` (6),
  `src/main/modules/library/index.ts` (1), `src/main/modules/replays/playback-channel/linux-channel.ts`;
  fix any further site in config/downloads/mods/replays `index.ts` the compiler names. Tests:
  update `src/main/modules/servers/index.test.ts` (~17 assertions), `src/main/modules/replays/index.test.ts`
  (~3), `src/main/modules/home/index.test.ts` and any other module test that asserted `ok(ok(x))`
  through `invoke` or a plain value from a direct handler call, to the single envelope. Do not
  change what the renderer receives for these handlers (the wire is identical).
- **D3 — config, downloads, home and mods clients take one envelope.** Files:
  `src/renderer/src/modules/config/client.ts` (21 flatteners `result.ok ? result.value : result`
  and the 8 "double-unwrap gotcha" comments — delete; each becomes `return callModule<X>(...)`
  where it was `callModule<Outcome<X>>`), `src/renderer/src/modules/downloads/client.ts` (7
  flatteners), `src/renderer/src/modules/home/client.ts` (1), `src/renderer/src/modules/mods/client.ts`
  (delete the `call<T>` wrapper; every function calls `callModule<T>('mods', …)` directly),
  `src/renderer/src/modules/home/client.test.ts` (mocks become single-envelope), and new
  `client.test.ts` files for config, downloads and mods (mirror the mock setup of
  `home/client.test.ts`), each with two tests: "a handler ok arrives as the function's value" and
  "a handler fail arrives as the function's fail" (one representative ex-flattener function each). No exported client signature changes (they were already `Promise<Outcome<X>>`). Check
  done: `git grep -n 'double-unwrap'` is empty.
- **D4 — replays client and its readers take one envelope.** Files:
  `src/renderer/src/modules/replays/client.ts` (every `Promise<Outcome<Outcome<X>>>` becomes
  `Promise<Outcome<X>>` with `callModule<X>`; delete `flattenOutcome` and the sidecar double-layer
  comment/flattening), a new `src/renderer/src/modules/replays/client.test.ts` (mirror
  `home/client.test.ts`; tests "a handler ok arrives as the function's value" and "a handler fail
  arrives as the function's fail", using `listNameTemplates`), and the callers the compiler then flags:
  `playback-store.ts` (lines reading `result.value.ok`/`result.value.error` read `result.ok`/
  `result.error`), `useDemoPlay.ts`, `NameTemplatesList.tsx` (one error state from one `fail`;
  rewrite the two-shapes comment), `components/DemoTimeline.tsx`, `useStageReport.ts`, and their
  existing tests' mocks. Leave `DemoFileActions.tsx`'s `.value.ok` (a `DemoFileActionResult`
  domain union, story 206). Check done: `git grep -n 'Outcome<Outcome' src` is empty, and
  `git grep -n '\.value\.ok' src/renderer` only hits `UnlockCodePanel.tsx`, `DemoFileActions.tsx`,
  `useQuickFilters.ts`, `useWatchlist.ts`, `WatchlistAddForm.tsx`, `WatchlistRow.tsx`,
  `ServersSettingsSection.tsx` (comment).
- **D5 — mods has a closed error-key set.** Files: `src/shared/modules/mods.ts` (add
  `MODS_ERROR_KEYS = [...] as const` and `type ModsErrorKey = (typeof MODS_ERROR_KEYS)[number]`,
  mirroring `DOWNLOADS_ERROR_KEYS`/`DownloadsErrorKey` in `src/shared/modules/downloads.ts`; the
  members are exactly the 9 distinct `'mods.error.*'` literals sent today from `src/main/modules/mods/`
  plus `'mods.error.diskWrite'`), `src/main/modules/mods/install-job.ts`, `update-job.ts`,
  `remove-job.ts` (every `key: string` in a job outcome/status union and every
  `failed(key: string, …)` helper parameter becomes `ModsErrorKey`; `'downloads.error.diskWrite'`
  becomes `'mods.error.diskWrite'`), `engine-target.ts`, `index.ts` (literals typed through
  `ModsErrorKey`), `src/renderer/src/i18n/locales/en.json` (add `mods.error.diskWrite` with the
  same English text as `downloads.error.diskWrite`), and the mods job tests that asserted
  `'downloads.error.diskWrite'`. Test: in `src/main/modules/mods/install-job.test.ts` (or the
  existing test covering the disk-write failure) › "a disk write failure reports mods.error.diskWrite".
- **D6 — restore warnings map through a typed record.** Files: `src/shared/config/profile-restore.ts`
  (export `RESTORE_WARNING_KEYS: Record<RestoreWarningReason, string>` with one literal
  `'config.import.warning.<reason>'` value per reason — the keys already exist in `en.json`),
  `src/main/modules/config/import.ts` (`toMetadataWarnings` takes
  `readonly { reason: RestoreWarningReason; … }[]` and reads `RESTORE_WARNING_KEYS[warning.reason]`
  — no template string), `src/main/modules/config/import.test.ts` (existing warning tests still
  pass). The resolve check for the record is in D7.
- **D7 — every error key main sends is proven to resolve.** New file `src/main/error-keys.test.ts`
  (mirror the `stringAt` lookup of `src/renderer/src/i18n/gamemode-keys.test.ts`; import
  `../renderer/src/i18n/locales/en.json`). Contents: a pure `scanKeys(source: string, patterns:
RegExp[]): string[]` with today's one pattern — `fail(` then optional whitespace/newlines then a
  `'…'` or `"…"` literal; a walk over every non-test `src/main/**/*.ts` via `node:fs`. Tests:
  "every fail() literal in main resolves in en.json" (also asserts at least 80 keys were found);
  "every exported *_ERROR_KEYS member resolves" (imports `DOWNLOADS_ERROR_KEYS` and
  `MODS_ERROR_KEYS`, and asserts the set of `export const <NAME>_ERROR_KEYS` names found by
  scanning `src/shared` + `src/main` equals the imported set); "every restore warning reason
  resolves" (iterates `RESTORE_WARNING_KEYS`); "a misspelled key is reported" (feeds
  `fail('mods.error.dsikWrite')` source text through `scanKeys` + the resolver and expects exactly
  that key in the missing list). A key resolves when the dotted path ends at a non-empty string.

## Model Hints

No `deliverable-hard`: every D is compiler-guided once D1 tightens `handle` and the client
generics drop the extra `Outcome`; the runtime wire is then proven by the module flows.

Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/registry.test.ts` › "a handler's ok outcome arrives as one
  envelope", "a handler's fail outcome passes through unchanged", "a handler that returns a
  non-Outcome is answered with handlerFailed" (+ the `@ts-expect-error` plain-value registration,
  checked by `npm run typecheck`); unit `src/shared/types/common.test.ts` › "isOutcome accepts
  envelopes and rejects domain unions" (D1).
- AC2 → structural: `git grep -n 'double-unwrap'` and `git grep -n 'Outcome<Outcome' src` empty,
  `git grep -n '\.value\.ok' src/renderer` limited to the D-f list (D3, D4); typecheck proves no
  leftover nested read; unit `src/renderer/src/modules/{config,downloads,home,mods,replays}/client.test.ts`
  › "a handler ok arrives as the function's value", "a handler fail arrives as the function's
  fail" (D3, D4).
- AC3 → unit `src/main/error-keys.test.ts` › "every fail() literal in main resolves in en.json",
  "every exported *_ERROR_KEYS member resolves", "a misspelled key is reported" (D7).
- AC4 → typecheck (`ModsErrorKey` on every mods job outcome) + unit
  `src/main/modules/mods/install-job.test.ts` › "a disk write failure reports mods.error.diskWrite"
  (D5) + unit `src/main/error-keys.test.ts` › "every exported *_ERROR_KEYS member resolves" (D7).
- AC5 → typecheck (`RESTORE_WARNING_KEYS: Record<RestoreWarningReason, …>`) + unit
  `src/main/error-keys.test.ts` › "every restore warning reason resolves" (D6, D7).
- AC6 → unit: full `npm test` (module `index.test.ts` and `client.test.ts` files, updated in D2–D4);
  e2e `npm run ui:flow -- servers-watchlist`, `servers-quick-filters`, `servers-master-sources`,
  `replays-name-templates`, `replays-stage`, `replays-timeline`, `mods-install`, `downloads-tab`,
  `home-tile-states`, `import-from-files` — all unchanged and green; the sprint gate's
  `npm run ui:flows` covers the rest.

## Done

Module handlers now return `Outcome<R>` (compile-time, per the (User) decision); the registry passes it through with a fail-closed `isOutcome` guard, so clients receive a single envelope. All flatteners, the mods `call<T>` unwrap and the replays `flattenOutcome` are gone; mods has a closed `MODS_ERROR_KEYS` set; restore warnings map through `RESTORE_WARNING_KEYS`; `src/main/error-keys.test.ts` proves every fail() literal and exported error-key list resolves in en.json.

Commit message: `204: module bus returns one Outcome envelope; flatteners gone; error keys proven to resolve (MODS_ERROR_KEYS, restore-warning record)`

Verification (narrow gate): build and typecheck green; full `npm test` 6399 passed, 1 red = `scripts/repo-hygiene.test.mjs` (CRLF in 4 files this story does not touch: scripts/flow.mjs, scripts/lib/harness.mjs, TitleBar.tsx, done/199; pre-existing, not fixed here). e2e green: servers-watchlist, servers-quick-filters, servers-master-sources, replays-name-templates, replays-stage, replays-timeline, mods-install, import-from-files, home-tile-states. `downloads-tab` red ("4 archives" vs expected 2) identically on bare HEAD (stash-checked): pre-existing fixture/cache-state issue. AC to test: AC1 registry.test.ts + common.test.ts; AC2 grep-zero + typecheck + config/downloads/mods/replays client.test.ts; AC3/AC4/AC5 error-keys.test.ts + install-job.test.ts; AC6 module tests + flows above. No manual residue.

Decisions: (1) job failure keys are `ModJobFailureKey = ModsErrorKey | DownloadsErrorKey` (install) and own unions for update/remove, since jobs pass through staging/installation keys from other namespaces. (2) error-keys test also lists UPDATE_ERROR_KEYS and APP_UPDATE_ERROR_KEYS (found by the D-j equality scan). (3) The wire for handlers that already returned an Outcome did change (double to single envelope), so scripts/flows/home-tile-states.mjs, which faked the old shape, was corrected; no other flow faked it. (4) Review 1 found a real double envelope (home slide.openUrl wrapped an Outcome in ok()); fixed with a behaviour test, audit of all ok() wrappers found no other; stale nested renderer mocks flattened. Unfixed: stale unused `renameDemo` mock in DemoDetailPanel.test.tsx:32 (cast, never used); pre-existing prettier drift in several index.ts files left alone. No second review pass after the fix (verified by full npm test + 3 flows). No CHANGELOG entry (no user-visible change).

tiers: D 7 / hard 0 · review default · cycles 1 · agents 10
