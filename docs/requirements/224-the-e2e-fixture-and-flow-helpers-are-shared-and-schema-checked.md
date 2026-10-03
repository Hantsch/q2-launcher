---
id: 224
title: the e2e fixture and flow helpers are shared and schema-checked
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want the seeded `state.json` every flow depends on to be proven valid against
the real schema on every test run, and the helpers flows share to live in one place, so that a
schema or default change cannot silently desynchronise 136 flows and a protocol or test-id change
is one edit instead of fifteen to twenty-two.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F22, F52):
`scripts/lib/fixture.mjs` is 5,737 lines with 231 exports and 97 "Mirrors src/…" comments;
`STATE_SCHEMA_VERSION = 1` (comment: "currently 2") while src is at 5; `DEFAULT_SETTINGS`,
`WINDOW_STATE_FILE`, failure shapes and the controls seed are retyped by hand; variant dispatch
is a 20-branch if-chain; nothing validates a seeded file against the real zod schema — the
fixture relies on four migrations running silently on every launch. Across `scripts/flows`,
`buildStatusReplyBytes`/`buildInfoReplyBytes`/`bindResponder`/`closeResponder`/`decodeQueryKind`
appear in 15 servers flows (14 identical, 1 drifted), `waitForScan` in 22, `waitForDemosScanToFinish`
in 14 files in four variants, `rowFor` in 10, `libraryCard` in 7 — 595 module-level helpers in
total.

Depends on story 223 (quarantine and CI) so a fixture change is gated.

## Acceptance Criteria

- [ ] **AC1** — `src/main/services/fixture-parity.test.ts` writes every fixture variant into a
      temp dir and loads it through the real `StateStore`, asserting zero migration warnings and
      zero dropped rows; it fails when `STATE_SCHEMA_VERSION` or a default drifts.
- [ ] **AC2** — Plain literals both sides need (`STATE_SCHEMA_VERSION`, `DEFAULT_SETTINGS`, file
      names) come from one importable source (`src/shared/fixture-constants.json` or a tiny
      shared module) instead of being retyped.
- [ ] **AC3** — `fixture.mjs` is a facade over `scripts/lib/fixture/{core,installations,servers,
replays,news,controls}.mjs` with a `VARIANTS: Record<name, writer>` map; no file exceeds
      1,500 lines.
- [ ] **AC4** — UDP responder builders live in `scripts/lib/servers-stub.mjs`, scan-wait helpers
      in `scripts/lib/servers-flow.mjs`, the reconciled `waitForDemosScanToFinish` in
      `scripts/lib/replays-copy-in.mjs`; local copies are deleted.
- [ ] **AC5** — `scripts/flow-helper-duplication.test.mjs` fails when a function name is declared
      in more than three flow files.
- [ ] **AC6** — `ui:flows` (non-quarantined) is green after the change.

## Open Questions

- none

## Decisions (Sprint)

- **`populated`/`empty` stay seeded one schema version behind, but explicitly.** The fixture's
  stale `STATE_SCHEMA_VERSION = 1` becomes `LEGACY_SEED_SCHEMA_VERSION = 1` plus an exported
  `LEGACY_SEED_VARIANTS` list; every other variant uses the shared current version. Reason: AC1
  forbids migration *warnings* and dropped rows, not migrations, and seeding `populated` at the
  current version would mean hand-authoring the ~50 catalogue rows story 052 D6's migration
  materialises (see the comment block above `CONTROLS_SEED_SCHEMA_VERSION` in `fixture.mjs`).
- **AC2's source is `src/shared/fixture-constants.json`** (the AC's own name), holding `stateFile`,
  `windowStateFile`, `stateSchemaVersion`, `defaultSettings`; `constants.ts`/`settings.ts` read it,
  `fixture.mjs` imports it with `with { type: 'json' }`. Reason: plain Node scripts cannot import
  `.ts`, both TS projects already have `resolveJsonModule`, and Node ≥22.12 supports import attributes.
- **Structured mirrors (controls seed, failure shapes, template categories) stay mirrored.** Reason:
  AC2 names plain literals only; AC1's real-schema load is what catches drift in structured data.
- **The six named fixture files are a floor, not a cap.** A domain over 1,500 lines (or one the six
  do not name — mods, downloads, gamedata stubs) gets its own file under `scripts/lib/fixture/`.
  Reason: AC3's binding limit is the 1,500 lines, and the fixture is now 5,961 lines, not 5,737.
- **The facade re-exports every current export name unchanged.** Reason: ~100 flows and
  `harness.mjs`/`seed.mjs`/`flow.mjs` import from `fixture.mjs`; touching them is out of scope.
- **The parity test seeds into a temp dir via a `Q2L_UI_VERIFY_ROOT` env override in
  `scripts/lib/paths.mjs`.** Reason: every writer resolves through `variantUserDataDir()` →
  `UI_VERIFY_ROOT`; one override is smaller than threading a root through ~30 writers.
- **AC4's servers scan helpers go to a new `scripts/lib/servers-flow.mjs`; the demo-scan
  `waitForScan` (19 replays flows + `action-bar-view`) goes to `replays-copy-in.mjs`.** Reason: the
  survey showed `waitForScan` is the demo scan, not the server scan the AC assumed;
  `servers-lan-flow.mjs` stays as is.
- **The AC5 guard counts module-level `function` declarations and `const`/`let` bindings initialised
  with an arrow or function expression; flow-contract names (`default`, `setup`, `teardown`,
  `variant`, `expectExit`) are exempt; a binding from a call (`const fail = makeFail('x')`) is not
  a declaration.** Reason: `scripts/flow.mjs` consumes exactly those names, and a factory call keeps
  the body in one place.
- **The guard also fails when one whitespace-normalised helper body appears in more than three flow
  files under any name.** Reason: otherwise renaming identical copies would pass AC5 without
  removing the duplication.
- **Literal-only variants (prefix, testid, timeout, log path) are reconciled into one parameterised
  helper; `bindResponder`'s 12 variants become one `bindResponder(port, onQuery)` taking the
  per-flow reply logic as a callback.** Reason: AC4 asks for local copies to be deleted, and the
  differences are data, not behaviour.
- **The mechanical sweep Ds (D4, D5) exceed the ~8-file cap.** Reason: each touched flow gets the
  same delete-and-import edit, so turn count grows with the helper count, not the file count.
- **No CHANGELOG entry.** Reason: test infrastructure only, nothing user-visible.

## Plan

Order D1 → D2 → D3 → D4 → D5 → D6. D1 lands before D2 (the split carries the new imports), and
D3 after D2 (it imports the facade's `VARIANTS`/legacy exports).

1. **Shared literals (D1).** New `src/shared/fixture-constants.json`; `constants.ts` and
   `types/settings.ts` read it; `fixture.mjs` imports it and drops its hand-typed copies; the stale
   version becomes an explicit legacy constant with a correct comment.
2. **Split (D2).** `fixture.mjs` becomes a facade re-exporting `scripts/lib/fixture/*.mjs`; the
   20-branch `writeFixture` if-chain becomes `VARIANTS: Record<name, writer>`; output stays
   byte-identical (seed-tree hash before/after).
3. **Parity (D3).** `src/main/services/fixture-parity.test.ts` seeds every variant into a temp root,
   loads it through `StateStore` with `MODULE_MIGRATIONS` and every module section, and fails on a
   `log.warn`, a lost row, or a version or settings-default mismatch, with negative cases.
4. **Servers helpers (D4)** into `servers-stub.mjs` and a new `servers-flow.mjs`.
5. **Replays helpers (D5)** into `replays-copy-in.mjs` + new `flow-common.mjs` (`sleep`, `makeFail`).
6. **Remaining helpers + guard (D6).** The rest of the >3-file names go into `flow-common.mjs`, plus
   the duplication guard test.
7. Story end: `npm run ui:flows` (non-quarantined) is green (AC6).

## Deliverables

- [ ] **D1 — plain literals have one source.** Create `src/shared/fixture-constants.json` with
      `stateFile: "state.json"`, `windowStateFile: "window-state.json"`, `stateSchemaVersion: 5`,
      `defaultSettings` (copy of today's `DEFAULT_SETTINGS` in `src/shared/types/settings.ts:22`).
      `src/shared/constants.ts` derives `STATE_FILE`, `WINDOW_STATE_FILE`, `STATE_SCHEMA_VERSION`
      from it (keep the exported names and the `number` type); `src/shared/types/settings.ts` builds
      `DEFAULT_SETTINGS: LauncherSettings` from it (type-checked; `deepScanDrives` must not infer
      `never[]`). In `scripts/lib/fixture.mjs` import the JSON
      (`import c from '../../src/shared/fixture-constants.json' with { type: 'json' }`) and replace
      the hand-typed `STATE_FILE`, `WINDOW_STATE_FILE`, `DEFAULT_SETTINGS` and
      `CONTROLS_SEED_SCHEMA_VERSION = 5`. Rename the deliberately stale `STATE_SCHEMA_VERSION = 1`
      (fixture.mjs:52-56) to exported `LEGACY_SEED_SCHEMA_VERSION = 1` and export
      `LEGACY_SEED_VARIANTS` (the variants whose `state.json` uses it: `populated`, `empty` and any
      variant built on the populated state document); fix its comment (src is at 5, not 2) and keep
      the reason (story 052 D6's migration must run on every reseed). If `src/architecture.test.ts`
      or lint rejects a `.json` in `src/shared`, extend the purity rule to allow JSON data only.
      Test (new) `src/shared/fixture-constants.test.ts` › "src constants and the fixture read one
      source": asserts the three constants and `DEFAULT_SETTINGS` equal the JSON, and that
      `scripts/lib/fixture.mjs` (read as text) declares none of `STATE_FILE =`,
      `WINDOW_STATE_FILE =`, `DEFAULT_SETTINGS =`, `CONTROLS_SEED_SCHEMA_VERSION = 5`.
      Verify with `npm run typecheck` and `npm test`.
- [ ] **D2 — the fixture is a facade over domain files.** Move `scripts/lib/fixture.mjs`'s content
      into `scripts/lib/fixture/{core,installations,servers,replays,news,controls}.mjs` (core:
      the JSON import, `writeJson`, `windowStateDocument`, legacy constants, the `populated`/`empty`
      state builders). Add further domain files such as `mods.mjs` or `downloads.mjs` when a domain
      does not fit; no file may exceed 1,500 lines. `fixture.mjs` becomes a facade that re-exports
      **every** name it exports today (check with a before/after `Object.keys(await import(...))`
      diff) plus `VARIANTS`, a `Record<variantName, writer>` replacing the if-chain in
      `writeFixture` (fixture.mjs:3346-3406; keep the `writeImportFilesFixture()` pre-step and the
      unknown-variant error). `FIXTURE_VARIANTS` stays exported and contains exactly the keys of
      `VARIANTS`. Mind the existing circular import `harness.mjs` ↔ `fixture.mjs`
      (`variantUserDataDir`, `writeImportFilesFixture`): no top-level code may read an import before
      both modules have finished evaluating. Update the `fixture.mjs` pointers in
      `docs/UI-VERIFICATION.md` (lines ~293, 436, 555, 628, 789) to the file the content moved to.
      Proof of no behaviour change: before the move run `npm run ui:seed` and hash every file under
      `.ui-verify/fixture/` (skip the `replays-date-filter` variant, which uses `Date.now()`); after
      the move the hashes match. Test (new) `scripts/lib/fixture/fixture-layout.test.mjs` ›
      "every fixture file stays under 1,500 lines and every variant has a writer" (line count of
      `fixture.mjs` + every `fixture/*.mjs`; `VARIANTS` keys equal `FIXTURE_VARIANTS`; each value is
      a function; `writeFixture('nope')` throws).
- [ ] **D3 — every seeded state.json loads clean through the real StateStore.** (a)
      `scripts/lib/paths.mjs`: `UI_VERIFY_ROOT` honours `process.env.Q2L_UI_VERIFY_ROOT` when set
      (absolute path required, else throw `HarnessError`). (b) `scripts/lib/fixture.d.mts`: typings
      for what the test uses (`writeFixture`, `FIXTURE_VARIANTS`, `LEGACY_SEED_SCHEMA_VERSION`,
      `LEGACY_SEED_VARIANTS`). Mirror `scripts/lib/download-failures.d.mts`, imported the same way
      as in `src/main/modules/downloads/diagnostics.test.ts:21`. (c) New
      `src/main/services/fixture-parity.test.ts`: set the env var to a `mkdtemp` dir, dynamic-import
      the facade, and per variant (`it.each(FIXTURE_VARIANTS)`) run `writeFixture(variant)` (close
      or stop anything a writer starts, e.g. stub HTTP servers) and read the seeded raw
      `state.json`. Then construct `new StateStore(path, { migrations: MODULE_MIGRATIONS })` exactly
      as `src/main/context.ts:148` does, call `load()`, and access every module section the app
      registers (config `persisted.ts:693-698`, downloads `persisted.ts:194-197`, home, replays,
      servers, `services/unlock/persisted.ts`). Import their specs/loaders; do not redeclare them.
      Spy on the electron-log stub (`src/test-support/electron-log-stub.ts`) and assert zero `warn`
      or `error` calls. Put the comparisons in an exported pure checker
      `checkSeededState(raw, loaded, { legacy })` (in the test file or a sibling helper) that returns
      a list of problems. Its rules: schemaVersion must equal `STATE_SCHEMA_VERSION`, or
      `LEGACY_SEED_SCHEMA_VERSION` for `LEGACY_SEED_VARIANTS` (which must be
      `< STATE_SCHEMA_VERSION`). Every id-bearing row in `installations` and in each module section
      survives the load (no id lost). For non-legacy variants the parsed settings deep-equal the
      seeded settings, so a default key added or removed in src shows up as a difference. Negative
      tests on the checker: "a dropped installation row is reported", "a settings key the schema
      does not know is reported", "a stale schemaVersion on a current variant is reported".
      Tests: `src/main/services/fixture-parity.test.ts` › "every fixture variant loads through the
      real StateStore without warnings or dropped rows" + the three negative tests.
- [ ] **D4 — servers flow helpers live in two lib files.** `scripts/lib/servers-stub.mjs`: export
      its existing private `encodeLatin1`, `buildStatusReplyBytes`, `buildInfoReplyBytes`,
      `decodeQueryKind`. Add `bindResponder(port, onQuery)` (a UDP socket bound on 127.0.0.1, with
      the per-flow reply decision passed in as `onQuery(kind, msg, rinfo)`) and `closeResponder`.
      New `scripts/lib/servers-flow.mjs`: `scanStatusLocator`, `readFinishedAt`,
      `waitForFinishedAtChange`, and the servers `waitForRowCount`. Literals that differ between
      copies (timeouts, testids, error prefixes) become parameters. Delete the local copies in
      every `scripts/flows/servers-*.mjs` that declares them (~15 files; find them with
      `grep -lE "function (bindResponder|waitForFinishedAtChange|waitForRowCount)" scripts/flows`)
      and import instead. The one flow whose `build*ReplyBytes` differs keeps its behaviour through
      a parameter, not a local copy. Verify every touched flow with `npm run ui:flow -- <name>`.
- [ ] **D5 — replays flow helpers live in `replays-copy-in.mjs`.** New `scripts/lib/flow-common.mjs`
      with `sleep(ms)` and `makeFail(prefix)`, which returns a function that throws
      `new Error(prefix + ': ' + msg)` (match the existing `fail` copies' message shape).
      `replays-copy-in.mjs` and `harness.mjs` import `sleep` from it instead of keeping private
      copies. Add to `scripts/lib/replays-copy-in.mjs` (and update its header comment to say it
      holds the shared helpers of the replays flows): `waitForScan`, the reconciled
      `waitForDemosScanToFinish` (5 variants → one, with timeout and label as options), `rowFor`
      (testid/selector as a parameter), `commands(logPath)`, `windowLines`, `launchGeometry`, and
      the replays `waitForRowCount`. Delete the local copies in `scripts/flows/replays-*.mjs`,
      `action-bar-view.mjs`, the `demo-*` flow and the `mods` flow that declares `fail` (~22 files;
      locate them with `grep -lE "function (waitForScan|rowFor)|const (sleep|fail) =" scripts/flows`).
      `const fail = makeFail('<flow>')` replaces each `fail`. Verify every touched flow with
      `npm run ui:flow -- <name>`.
- [ ] **D6 — remaining shared helpers + duplication guard.** Move `libraryCard`, `railTile`,
      `simulateLaunch`, `invoke` and `readLog` into `scripts/lib/flow-common.mjs` (parameterise the
      drifted `libraryCard`/`railTile`/`invoke` variants) and delete their local copies in the
      installation/engine/job/repair/retail/servers/about/app/replays flows. New
      `scripts/flow-helper-duplication.test.mjs` › "no helper is declared in more than three flow
      files". It parses every `scripts/flows/*.mjs` (regex, or `acorn` if already a dependency) and
      collects module-level `function` declarations plus `const`/`let` bindings initialised with an
      arrow or `function` expression, exempting `default`, `setup`, `teardown`, `variant` and
      `expectExit`. It fails listing each name found in >3 files **and** each whitespace-normalised
      body found in >3 files under any name. A second test, › "the guard catches a fourth copy",
      runs the checker on four in-memory sources declaring the same helper and expects a failure.
      Verify touched flows with `npm run ui:flow -- <name>`.

## Model Hints

- D3 → deliverable-hard: the test must reproduce the app's real load path (`MODULE_MIGRATIONS` +
  every module's section spec, as `context.ts` wires them) and must provably fail on drift. A
  plausible-looking version that loads only the store-owned keys or never trips on a missing
  section passes vacuously, while 136 flows depend on it.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/services/fixture-parity.test.ts` › "every fixture variant loads through the
  real StateStore without warnings or dropped rows" (+ › "a dropped installation row is reported",
  › "a settings key the schema does not know is reported", › "a stale schemaVersion on a current
  variant is reported"). D3.
- AC2 → unit `src/shared/fixture-constants.test.ts` › "src constants and the fixture read one
  source". D1.
- AC3 → unit `scripts/lib/fixture/fixture-layout.test.mjs` › "every fixture file stays under 1,500
  lines and every variant has a writer". D2.
- AC4 → unit `scripts/flow-helper-duplication.test.mjs` › "no helper is declared in more than three
  flow files" (proves the local copies are gone), plus the touched flows run green via
  `npm run ui:flow -- <name>`. D4, D5, D6.
- AC5 → unit `scripts/flow-helper-duplication.test.mjs` › "no helper is declared in more than three
  flow files" and › "the guard catches a fourth copy". D6.
- AC6 → e2e-all `npm run ui:flows` (non-quarantined flows, `scripts/flows/quarantine.json`) green at
  story end. D2–D6.

## Done

<!-- Filled by /build 224. -->
