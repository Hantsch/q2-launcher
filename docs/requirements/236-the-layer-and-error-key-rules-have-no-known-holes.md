---
id: 236
title: the layer and error-key rules have no known holes
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

Stories [[204]], [[206]], [[208]] and [[209]] made the module bus, the refusal shape and the layer
rules a test and a linter. Their reviews named the places where the rule is still only a convention:

- [[209]]: modules still call `lib/paths.userDataDir()`, `lib/net/fetcher` and `lib/native-image`
  directly (narrow electron-backed shell libs), not through `app`, and no test enforces that either way.
- [[208]]: oxlint's builtin `paths` list is shorter than the architecture test's predicate, so lint
  and test disagree about which node builtins are forbidden in shared and renderer code.
- [[206]]: `${reason}` key templates remain in `master-source-address.ts`, playback-console, userinfo,
  master-records and installations, and the error-key scan does not cover `fail(\`...\`)` templates.
- [[204]]: the AC2 grep for `.value.ok` was narrowed to a listed set of 7 files; a few shared comments
  still point at old paths.
- [[225]]: `parseMissingKeyHandler` in the renderer i18n now renders an unknown unlock feature id as
  the id itself; whether that deserves a translated fallback was not decided.

The maintainer wants these rules enforced by the same test or linter that already guards their
neighbours, so a future change cannot reopen a hole unnoticed.

## Acceptance Criteria

- [ ] **AC1** — Either modules reach user-data dir, fetcher and native-image only through `app`, or
      `src/architecture.test.ts` lists them as an allowlisted edge with a reason per entry.
- [ ] **AC2** — The set of node builtins forbidden by `.oxlintrc.json` equals the architecture test's,
      checked by a test that compares the two.
- [ ] **AC3** — No `fail()` or refusal key is built from a template; the error-key scan covers
      `fail(\`...\`)` and the five remaining `${reason}` sites use literal key records.
- [ ] **AC4** — The `.value.ok` check covers all of `src/renderer`, not a listed set of files, and no
      comment points at a path that no longer exists.
- [ ] **AC5** — An unknown unlock feature id renders through a translated fallback (decided in
      refine), with a unit test.

## Open Questions

None — the two refine questions (AC1 route, AC5 fallback) are decided below.

## Decisions (Sprint)

- **AC1: allowlist, not move.** Modules keep importing `lib/paths`, `lib/net/fetcher` and
  `lib/native-image`; each edge becomes a named `ALLOWED` entry (story `236`) — docs/ARCHITECTURE.md
  (§ Adding a module, step 4) already names these three as the sanctioned narrow shell libs, so the
  hole is the missing test, and moving ~12 call sites through `app` would change behaviour for no gain.
- **AC1: the rule is generic and direct-edge.** "Electron-backed shell file" = a production file under
  `src/main` outside `src/main/modules` whose own imports include `electron` (static or `import()`);
  only a module's direct import of such a file needs an entry, because transitive reach through shell
  services is the designed route.
- **AC1: type-only imports are allowlisted too** (`FetchImpl`), with a "type only" reason — the
  scanner does not distinguish `import type`, and teaching it to is more surface than three entries.
- **AC2: one list, checked against Node.** `.oxlintrc.json`'s `paths` (both overrides) becomes the full
  list of bare builtin names and is the set `isNodeOrElectron` uses; a test asserts both overrides
  equal that set and that every bare name in the running Node's `builtinModules` is in it — comparing
  to `builtinModules` directly would flake between CI (Node 22) and dev machines (Node 25).
- **AC3: one literal record per site**, mirroring `SERVER_ADDRESS_REJECTION_KEYS` in
  `src/shared/servers/address.ts` (`as const satisfies Record<Union, \`ns.${string}\`>`); no shared
  helper, because a record of literals cannot be generated without reintroducing a template.
- **AC3: the template ban covers all of `src/main` and `src/shared`** (not only modules), so
  `ipc/installations.ts` is inside it; key-shaped `return \`a.b.${x}\`` builders count as templates.
  `labelKey` templates (`runner.kind.*`, gamemode, config group names) are labels, not refusals, and
  stay out of scope as story 206 already decided.
- **AC4: the renderer-wide check targets the double-envelope tells.** `.value.ok` on an
  `Outcome<DomainResult>` is the shape story 206 keeps by design (7 legitimate reads today), so the
  check scans every renderer production file for what only a nested `Outcome` has — `.value.error`
  and `.value.value` — plus `Outcome<Outcome` across `src`; no file list remains.
- **AC4: "a path that no longer exists" means rooted paths of this repo** (`src/main|renderer|shared|
  preload|test-support/…`, `docs/…`, `scripts/…`, and `main/|renderer/|shared/…` read under `src/`),
  plus `` `path`'s `symbol` `` mentions whose symbol must still be in that file; elided (`.../`) and
  sibling-relative (`lib/x.ts`) forms and the predecessor project's `src/core/…` are not checked —
  they cannot be resolved without guessing.
- **AC4: a comment pointing at a moved story file becomes a trailing `(story NNN)`**, per CLAUDE.md's
  comment rule, instead of a `done/` path.
- **AC5: a translated fallback that keeps the id.** Known features get a label
  (`settings.unlock.feature.watchlist`); an unknown id renders `settings.unlock.feature.unknown`
  ("Unknown feature ({{id}})") — translated text for the user, the id kept for support.
  `parseMissingKeyHandler` stays as is: the panel passes the fallback as `defaultValue`.
- **Systems docs:** only D6 changes behaviour a systems doc describes (`docs/systems/unlock-codes.md`);
  D3/D5 edits in module files keep keys and behaviour identical, so no module doc changes.
- **Changelog:** AC5 is user-visible — one `### Fixed` line; AC1–AC4 are internal and get none.

## Plan

Test-and-lint story; no IPC or contract change. Order: D1 → D2 (both edit `src/architecture.test.ts`),
then D3, D4, D5, D6 independently.

1. **D1** layer rule for electron-backed shell libs + allowlist entries.
2. **D2** full builtin list in `.oxlintrc.json`, predicate reads it, equality test.
3. **D3** five `${reason}` key templates → literal records; error-key scan bans `fail(\`…\`)` and
   key-shaped template returns across main + shared.
4. **D4** renderer-wide nested-`Outcome` check.
5. **D5** comment-path test + fix the stale comments it finds.
6. **D6** unlock feature labels with a translated fallback, test, systems doc, changelog.

Verify per D: `npm run typecheck`, `npm run lint`, `npx vitest run --changed HEAD`; after D6 the full
`npm test`. No flow is needed: no criterion is a user action.

## Deliverables

- **D1 — A module reaches an electron-backed shell lib only through an allowlisted edge.**
  In `src/architecture.test.ts` add the test "a main module reaches an electron-backed shell lib only
  through an allowlisted edge": compute `ELECTRON_BACKED` = production files under `src/main` but not
  under `src/main/modules` whose `scanImports` contains `electron` or `electron/…` (the scanner already
  catches `await import('electron')`); assert the set contains `src/main/lib/paths.ts`,
  `src/main/lib/net/fetcher.ts`, `src/main/lib/native-image.ts` (the rule must bite); then
  `offenders(edge => moduleOf(edge.from, MAIN_MODULES) !== undefined && ELECTRON_BACKED has edge.to
  (compare without extension, as edges resolve) && !isAllowed(edge))` must be `[]`. Add one `ALLOWED`
  entry per current production edge, story `'236'`, grouped with the existing `.map` pattern and a
  reason per target: `lib/paths` ← `config/index.ts`, `downloads/index.ts`, `home/news/news-service.ts`,
  `home/news/feed-cache.ts`, `mods/catalog-service.ts`, `replays/index-cache.ts` (reason: "reads the
  user-data dir through the narrow shell lib"); `lib/net/fetcher` ← `downloads/bootstrap/ports.ts`,
  `servers/scan-service.ts` ("uses the shell's electron.net fetch"), and type-only
  `downloads/repair/job.ts`, `downloads/bootstrap/job.ts`, `downloads/engine/update-job.ts` ("type only:
  FetchImpl is the injected fetch seam"); `lib/native-image` ← `home/images/fetch-image.ts` ("decodes a
  news image through the shell's nativeImage"). Re-derive the list from the failing test rather than
  trusting this one; `downloads/bootstrap/job.test-helpers.ts` needs an entry only if `isTestFile` does
  not exempt it (the "every allowlist entry still matches a real import" test decides). Update the
  `app` doc comment in `src/main/modules/types.ts` (~line 49) and the sentence in docs/ARCHITECTURE.md
  (~line 394–396) to say these edges are listed in `ALLOWED` in `src/architecture.test.ts`.
  Files: `src/architecture.test.ts`, `src/main/modules/types.ts`, `docs/ARCHITECTURE.md`.

- **D2 — oxlint and the architecture test forbid the same node builtins.**
  In `.oxlintrc.json` replace the `paths` array of both the `src/shared/**` and `src/renderer/**`
  overrides with the full list of bare builtin names (every `require('node:module').builtinModules`
  entry without a `node:` prefix, `_`-prefixed ones included; generate it on the dev machine, sorted).
  In `src/test-support/source-tree.ts` export `FORBIDDEN_NODE_BUILTINS`, read once from that list
  (JSONC: strip comments and trailing commas exactly like `readTsconfig` in `src/architecture.test.ts`
  / the existing oxlint test ~line 443), and make `isNodeOrElectron` use it instead of
  `new Set(builtinModules)` (keep the `node:` prefix and `electron` branches). In
  `src/architecture.test.ts` add "oxlint forbids exactly the node builtins the architecture test
  forbids": the shared override's `paths`, the renderer override's `paths` and
  `FORBIDDEN_NODE_BUILTINS` are equal as sets, and every `builtinModules` entry of the running Node
  without a `node:` prefix is in `FORBIDDEN_NODE_BUILTINS` (failure message names the missing builtin).
  `npm run lint` and the existing "src/renderer imports no electron, node: or src/main" test must stay
  green. Files: `.oxlintrc.json`, `src/test-support/source-tree.ts`, `src/architecture.test.ts`.

- **D3 — No fail() or refusal key is built from a template.**
  Replace the five templates with literal records, mirroring `SERVER_ADDRESS_REJECTION_KEYS` +
  `serverAddressRejectionKey` in `src/shared/servers/address.ts` (~224–240: `const X = {…} as const
  satisfies Record<Union, \`ns.${string}\`>`, lookup returns `(typeof X)[Union]`):
  (1) `src/shared/servers/master-source-address.ts:117` `masterSourceAddressRejectionKey` →
  `MASTER_SOURCE_ADDRESS_REJECTION_KEYS` (`servers.sources.reject.*`); if
  `MASTER_SOURCES_REFUSAL_KEYS` in `src/main/modules/servers/master-sources.ts` (~48–67) repeats those
  entries, spread the shared record there instead of keeping two copies;
  (2) `src/main/modules/replays/playback-console.ts:22` → `CONSOLE_LINE_ERROR_KEYS` in
  `src/shared/replays/console-line.ts` next to `ConsoleLineReason` (`replays.console.error.*`);
  (3) `src/shared/launch/userinfo.ts:60` → `USERINFO_REJECTION_KEYS` (`launch.userinfo.reject.*`);
  (4) `src/shared/servers/master-records.ts:75` → `MASTER_SOURCE_FAILURE_KEYS`
  (`servers.source.error.*`); (5) `src/main/ipc/installations.ts:210` `runner.unavailable.${kind}` →
  `RUNNER_UNAVAILABLE_KEYS` keyed by the kinds that reach that branch (`RunnerKind` minus the
  `steam`/`proton` arms above it, `src/shared/types/runner.ts:11`). Keys and values stay identical.
  In `src/main/error-keys.test.ts`: count `fail(` followed by a backtick as a template (do not report
  other non-literal `fail(` arguments as unknown); count a key-shaped template return
  (`return \`<lower>.<…>${`) as a template; apply "no refusal key is built from a template" — rename it
  "no fail() or refusal key is built from a template" — to every scanned file of `src/main` and
  `src/shared` (drop `scopedToModules`); add the new records to the resolve list in "every reasonKey
  and refuse() literal resolves in en.json" and their lookup shapes to `COVERED_ARGUMENTS`; extend
  "a misspelled reasonKey literal fails the scan" with `fail(\`a.${b}\`)` and `return \`a.b.${c}\``
  each counting 1 template. Files: the five sites, `src/shared/replays/console-line.ts`,
  `src/main/modules/servers/master-sources.ts` (only if it duplicated), `src/main/error-keys.test.ts`.

- **D4 — The nested-Outcome check covers all of src/renderer.**
  In `src/architecture.test.ts` add "no renderer file unwraps a nested Outcome": over every production
  file under `src/renderer` (no list), `stripComments(text)` has no match of `/\.value\.(?:error|value)\b/`
  (only an `Outcome` inside `Outcome.value` has those; a `DomainResult` has `ok`/`reasonKey`), and no
  production file under `src` contains `Outcome<Outcome`. Make it bite: run the same predicate over the
  strings `'if (!r.value.ok) show(r.value.error)'` (flagged) and `'if (!r.value.ok) show(r.value.reasonKey)'`
  (not flagged). Today both scans are empty; `.value.ok` reads in `UnlockCodePanel.tsx`,
  `DemoFileActions.tsx`, `useWatchlist.ts`, `WatchlistAddForm.tsx`, `WatchlistRow.tsx` are
  `Outcome<DomainResult>` reads and stay. Files: `src/architecture.test.ts`.

- **D5 — No source comment points at a path that no longer exists.**
  In `src/architecture.test.ts` add "every repo path named in a source comment exists": for every
  production file under `src`, take its comment text (block and line comments — add a small
  `commentsOf` next to `stripComments` in `src/test-support/source-tree.ts`), find tokens
  `(?<![\w@./:-])((?:src/(?:main|renderer|shared|preload|test-support)|docs|scripts)/[\w./-]+\.(?:tsx?|mjs|json|md|yml))`
  resolved from the repo root and `(?<![\w@./:-])((?:main|renderer|shared)/[\w./-]+\.(?:tsx?|json))`
  resolved under `src/` (for `renderer/` also try `src/renderer/src/`); skip tokens containing `...`;
  each must exist. Also, for each `` `<rooted path>`'s `<identifier>` `` mention, the file must contain
  the identifier. Then fix what it reports. Known today: `src/renderer/src/modules/config/RawFileTab.tsx`
  (`docs/requirements/061-…` → trailing `(story 061)`), `src/shared/modules/servers.ts`
  (`docs/requirements/116-…` → `(story 116)`), `src/shared/config/fixtures/profiles.ts`
  (`src/main/modules/config/round-trip.test.ts` — repoint to the current test file or drop the path);
  and `main/lib/schemas.ts` mentions whose symbol moved to `src/main/modules/config/persisted.ts` /
  `src/main/modules/home/persisted.ts` (`normalizeConfigProfile`, `parseHomeLayout`) in
  `src/shared/config/aliases/modifier-layers.ts`, `src/shared/modules/home.ts`, and check the other
  `lib/schemas.ts` mentions (`src/shared/config/render/render.ts`, `src/shared/config/syntax/cfg-layout.ts`,
  `src/shared/ipc-schemas.ts`, `src/shared/schemas.ts`) point where the named thing lives. Comment-only
  edits; no story narrative added. Files: `src/architecture.test.ts`, `src/test-support/source-tree.ts`,
  the comment fixes above.

- **D6 — An unknown unlock feature id renders through a translated fallback.**
  In `src/renderer/src/i18n/locales/en.shell.json` under `settings.unlock` add
  `feature: { watchlist: "Server watchlist", unknown: "Unknown feature ({{id}})" }`. In
  `src/renderer/src/components/unlock/UnlockCodePanel.tsx` (lines ~139 and ~159, today
  `t(\`unlock.feature.${feature}\`, { defaultValue: feature })`) render one local
  `featureLabel(feature)` = `t(\`settings.unlock.feature.${feature}\`, { defaultValue:
  t('settings.unlock.feature.unknown', { id: feature }) })` in both places; `parseMissingKeyHandler`
  in `src/renderer/src/i18n/index.ts` stays unchanged. Tests in
  `src/renderer/src/components/unlock/UnlockCodePanel.test.tsx`: "an unknown feature id renders the
  translated fallback" (`servers-pro` → "Unknown feature (servers-pro)", both in the accepted result and
  in the code list) and "a known feature id renders its label" (`watchlist` → "Server watchlist");
  update existing assertions that expected the raw id. Update the bundle snapshot
  (`src/renderer/src/i18n/__snapshots__/en.bundle.json`) via the test run. In
  `docs/systems/unlock-codes.md` § Unlockable features add: a gated feature gets a
  `settings.unlock.feature.<name>` label; an unlisted name shows "Unknown feature (<name>)". Add under
  `CHANGELOG.md` `## Unreleased` → `### Fixed`: "- **Settings** — Unlock codes name their features
  instead of showing an internal id." Files: the six named.

## Model Hints

All Ds default tier: each is a bounded test/lint or literal-record change whose failure mode is a red
test, not a silent regression.

Review: → default

## Acceptance Tests

- AC1 → unit `src/architecture.test.ts` › "a main module reaches an electron-backed shell lib only through an allowlisted edge" (D1)
- AC2 → unit `src/architecture.test.ts` › "oxlint forbids exactly the node builtins the architecture test forbids" (D2)
- AC3 → unit `src/main/error-keys.test.ts` › "no fail() or refusal key is built from a template", › "a misspelled reasonKey literal fails the scan" (template bite cases) and › "every reasonKey and refuse() literal resolves in en.json" (new records resolve) (D3)
- AC4 → unit `src/architecture.test.ts` › "no renderer file unwraps a nested Outcome" (D4) and › "every repo path named in a source comment exists" (D5)
- AC5 → unit `src/renderer/src/components/unlock/UnlockCodePanel.test.tsx` › "an unknown feature id renders the translated fallback" and › "a known feature id renders its label" (D6)

No criterion describes a user action through the UI; no manual residue.

## Done
