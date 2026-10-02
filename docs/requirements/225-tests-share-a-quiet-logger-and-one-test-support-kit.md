---
id: 225
title: tests share a quiet logger and one test-support kit
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a test run to print only failures, and a new test to get its temp dir,
fake `AppContext`, installation/job/profile builders and typed client mocks from one place, so
that a shape change costs one edit instead of five to sixteen and mocks cannot silently drift
from the real client.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F53, F54, F71):
`src/main/lib/logger.ts` runs `log.initialize()` and sets `console.level = 'debug'` at import;
50 main files import it and only 4 tests mock it; vitest has no `setupFiles`/`silent`; a
dot-reporter run prints 622 `stdout |`/`stderr |` blocks and every test touching a module loads
`electron-log` + `electron`, which is why all four CI workflows carry the "Install Electron
binary" race workaround. `src/test-support/` has two files used by 12 of 444 tests; `mkdtemp`
is inlined 73–96 times with matching `rm` hooks; `fakeAppContext()` is hand-written 5 times,
`fakeState()` byte-identical in five job tests, `fakeLaunch` five times, `makeInstallation(overrides)`
in 10 renderer tests (one with a POSIX root), `makeJob` 6 times; 38 renderer tests
`vi.mock('./client')` hand-listing exports. Five test files exceed 2,000 lines as story-ordered
append logs (`round-trip.test.ts` 3,613 with 36 of 38 describes named after stories and helpers
re-invented 2,000 lines apart).

## Acceptance Criteria

- [ ] **AC1** — `src/test-support/setup.ts` is wired as `test.setupFiles` and silences the
      logger (mock `electron-log/main` or `console.level = false` under `VITEST`); a guard
      asserts the dot run emits zero `stdout |` blocks; main tests no longer need the Electron
      binary installed (CI workaround removed where it only served tests).
- [ ] **AC2** — `src/test-support/` provides `useTempDir(prefix)` with automatic cleanup,
      `fakeAppContext(overrides)`, and `fixtures.ts` with `makeInstallation`, `makeJob`,
      `makeConfigProfile`; `src/main/modules/downloads/test-support.ts` provides `fakeState`,
      `fakeLaunch`, `fakeExtractor`, `fakeManifest`, `fakeFetcher`; the builder sites are
      migrated (grep-zero for `function makeInstallation(` outside test-support).
- [ ] **AC3** — `src/renderer/src/test-support/mockClient(path, overrides)` uses
      `importOriginal` so a renamed client export fails typecheck in every test that mocks it;
      the 38 hand-listed mocks use it.
- [ ] **AC4** — `round-trip.test.ts` is split into `round-trip/` with a `helpers.ts` and
      behaviour-named files; story numbers appear only in `it()` names; no test file exceeds
      1,500 lines (soft cap in story 208's architecture test).
- [ ] **AC5** — docs/ARCHITECTURE.md gains a short "Testing" section: conventions, where the
      kit lives, real temp dirs over fs mocks, the size cap.
- [ ] **AC6** — Full `npm test` green with the same test count (minus deliberately merged
      duplicates, listed in Done).

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — Migrate the 73–96 `mkdtemp` sites now or opportunistically? Recommendation:
  builders now, temp dirs when a file is next touched.

## Decisions (Sprint)

- **(User)** mkdtemp migration: Builders now; temp dirs opportunistically when a file is next touched.
- **D-a** `useTempDir` ships with a test and at most the call sites a D already edits; no blanket
  `mkdtemp` sweep — this follows the (User) decision above.
- **D-b** Main tests stop needing the Electron binary through a vitest `resolve.alias` from
  `electron` to a stub plus a quiet `electron-log/main` stub, not one global `vi.mock`, because an
  alias also covers `src/main` files that import `electron` directly (22 of them), and per-file
  `vi.mock('electron')` (27 files) still overrides it.
- **D-c** "Main tests no longer need the binary" is proven by a guard that runs a child vitest
  with a `--require` preload that throws on any real `require('electron')`, since the local
  binary is always installed and cannot otherwise show the difference.
- **D-d** The quiet guard runs a fixed sample of known-noisy test files, not the whole suite,
  because a suite that spawns itself is recursive; the D additionally measures the full dot run at
  zero blocks once by hand.
- **D-e** Noise that is not the logger (React warnings, a test's own `console.*`) is fixed at the
  source or spied silent in that test, never by muting `console` globally, so a real failure still
  prints its diagnostics.
- **D-f** The "Install Electron binary" step is removed only from `ci.yml`'s `test` job and
  `release.yml`'s test job; the user-journey, `linux-verify` and `linux-update` jobs launch real
  Electron through Playwright and keep it.
- **D-g** `mockClient` is called as `vi.mock('./client', (importOriginal) => mockClient(importOriginal, {…}))`
  instead of the AC's literal `mockClient(path, overrides)`, because `vi.mock` is only hoisted
  and resolved relative to the test file when called in the test file itself; the AC's intent
  (typed overrides via `importOriginal`) is kept.
- **D-h** `mockClient` replaces every function export of the original with `vi.fn()` before
  applying overrides, so a non-overridden export never reaches the real `window.api` bridge.
- **D-i** The migration covers all 42 files that mock a `client` module today (the AC's "38" was
  the review's count), because AC3's guard is grep-based and would otherwise stay red.
- **D-j** `fixtures.ts` stays pure (imports only `src/shared`) and is added to
  `tsconfig.web.json`'s include, because its users are renderer tests and `src/test-support/`
  is otherwise node-project only.
- **D-k** The `function makeInstallation(` grep-zero is scoped to `src/`;
  `scripts/lib/fixture.mjs` is the e2e seed fixture, plain `.mjs` that cannot import TS.
- **D-l** `fakeLaunch` is migrated only inside `src/main/modules/downloads/`; the five copies in
  replays/servers/write-guard stay, because importing one module's test-support from another
  module's tests would be a cross-module import, and their shapes differ.
- **D-m** `makeConfigProfile` has no local copy to replace today; it is created and used in the
  renderer/main tests that build a `ConfigProfile` literal inline, up to the files its D already
  touches. Other sites move over opportunistically, the same rule as the temp dirs.
- **D-n** The 1,500-line cap applies to all seven test files over it (round-trip, config
  `index`, bootstrap `job`, `render`, `profile-restore`, `schemas`, `profiles`), because AC4 says
  "no test file". It lives in this story's own guard `scripts/test-kit.test.mjs`, not in story
  208's architecture test: 208 is built later, and its (User) decision kept size caps out of 208.
- **D-o** The cap is a hard failure with an empty allowlist. "Soft" is kept only as the
  allowlist's existence (a file may be listed with a reason in a later story).
- **D-p** `round-trip` becomes a directory per the AC; the six other files split into sibling
  `<name>.<behaviour>.test.ts` files plus one `<name>.test-helpers.ts`, following the existing
  `DownloadsView.failures.test.tsx` naming, so imports of the module under test stay unchanged.
- **D-q** Every split D proves it lost no test by comparing `npx vitest list` output for the old
  file and the new files, before and after (equal count; changed titles listed in Done), because
  AC6's single total count could hide a dropped test.
- **D-r** Review stays default: the plausible wrong implementation (tests dropped during a split)
  is caught mechanically by D-q's per-file list diff, not by reviewer judgement.

## Plan

Order follows dependencies: quiet run first (every later D's run is then readable), then the
kits, then the client-mock helper, then the splits, which reuse the kits. Last come the size
guard and the docs.

1. **Quiet + binary-free run (D1).** `src/test-support/setup.ts` as `test.setupFiles`; vitest
   aliases `electron` → `src/test-support/electron-stub.ts` and `electron-log/main` →
   `src/test-support/electron-log-stub.ts`; a guard spawns vitest over a sample with an
   electron-forbidding preload; the binary install step goes from the two test-only CI jobs.
2. **Main kit (D2, D3).** `useTempDir`, `fakeAppContext` (5 sites);
   `src/main/modules/downloads/test-support.ts` (5 job tests).
3. **Shared fixtures (D4, D5).** `src/test-support/fixtures.ts` with `makeInstallation`
   (10 sites), `makeJob` (6 sites), `makeConfigProfile`.
4. **Client mocks (D6–D9).** `src/renderer/src/test-support/mock-client.ts` + migrate 42 files
   by area.
5. **Splits (D10–D15).** The seven files over 1,500 lines, one D each (`schemas`+`profiles`
   share one). Each D carries D-q's list diff.
6. **Guard + docs (D16).** `scripts/test-kit.test.mjs` collects the grep/size guards (each
   earlier D adds its own assertion there as it lands); `docs/ARCHITECTURE.md` gets "Testing".

`scripts/test-kit.test.mjs` is created by D2 (the first D with a grep guard). Later Ds append
their `it()`. Format only touched files with prettier, never a glob (CRLF worktree).

## Deliverables

- **D1 — quiet, binary-free test run.** Create `src/test-support/setup.ts` and wire it as
  `test.setupFiles` in `vitest.config.ts`. Add `test.alias` (or `resolve.alias` under the test
  config only) mapping `electron` → `src/test-support/electron-stub.ts` (exports every name
  `src/main` imports from `electron` — grep `from 'electron'` — as inert stubs, so named imports
  resolve) and `electron-log/main` → `src/test-support/electron-log-stub.ts` (silent
  `initialize`, `scope()` returning no-op `info/warn/error/debug/verbose/silly/log`,
  `transports.file.getFile().path`, `errorHandler.startCatching`). Per-file
  `vi.mock('electron')` must keep winning; run the 27 files that use it. Remove remaining
  non-logger output at its source or with a local `vi.spyOn(console, …)` in that test, never a
  global console mute. Acceptance: `npx vitest run --reporter=dot 2>&1 | grep -cE "^(stdout|stderr) \|"`
  prints 0. Guard `scripts/quiet-test-run.test.mjs` › "a dot run of the noisy sample prints no
  stdout or stderr blocks and loads no real electron": spawns `npx vitest run --reporter=dot`
  over a fixed list of ~5 noisy files (one config module test, `src/main/modules/registry.test.ts`,
  one downloads job test, one renderer `.tsx` test), with
  `NODE_OPTIONS=--require <repo>/scripts/lib/forbid-electron.cjs` (new: hooks `Module._load` and
  throws on request `electron`); asserts exit 0 and zero `stdout |`/`stderr |` lines (per-test
  timeout 180 s). Delete the "Install Electron binary" step and its comment from
  `.github/workflows/ci.yml`'s `test` job and `release.yml`'s test job. Keep it in ci.yml's
  user-journey job, `linux-verify.yml` and `linux-update.yml`. Files: `vitest.config.ts`, the 3 stubs/setup
  files, `scripts/lib/forbid-electron.cjs`, the guard, 2 workflows.
- **D2 — `useTempDir` + `fakeAppContext`.** `src/test-support/temp-dir.ts`:
  `useTempDir(prefix): () => string` registers `beforeEach` mkdtemp under `os.tmpdir()` and
  `afterEach` `rm(…, { recursive: true, force: true })`, and returns a getter. Test
  `src/test-support/temp-dir.test.ts` › "useTempDir gives each test a fresh dir and removes it
  afterwards". `src/test-support/app-context.ts`: `fakeAppContext(overrides?: Partial<AppContext>)`
  (type from `src/main/modules/`'s `AppContext`). Build it as the union of the 5 hand-written
  copies in `src/main/modules/{home/index,registry,replays/index,replays/name-templates,servers/index}.test.ts`
  and migrate those 5. Create `scripts/test-kit.test.mjs` with
  "no main test defines its own fakeAppContext" (grep `function fakeAppContext(` under `src/`
  outside `src/test-support/` = 0).
- **D3 — downloads test-support.** `src/main/modules/downloads/test-support.ts` exporting
  `fakeState`, `fakeLaunch`, `fakeExtractor`, `fakeManifest`, `fakeFetcher`, lifted from
  `bootstrap/job.test.ts`, `engine/rollback-job.test.ts`, `engine/update-job.test.ts`,
  `repair/job.test.ts`, `retail/upgrade-job.test.ts`. A divergent copy becomes an `overrides`
  parameter, not a second helper. Migrate those 5 files. Leave `fakeLaunch` in replays/servers/
  `write-guard` alone. Add to `scripts/test-kit.test.mjs`: "downloads job tests define no local
  fakeState/fakeLaunch/fakeExtractor/fakeManifest/fakeFetcher" (grep under
  `src/main/modules/downloads/` outside `test-support.ts` = 0).
- **D4 — `makeInstallation`.** `src/test-support/fixtures.ts` (pure, imports only `src/shared`
  types) with `makeInstallation(overrides?)`, default root Windows-style (one current copy uses a
  POSIX root — that test passes its root as an override). Add `src/test-support/fixtures.ts` to
  `tsconfig.web.json` `include`. Migrate the 10 renderer sites:
  `components/installations/{InstallationTile,RemoveInstallationDialog,RunnerSection,SetInstallationIconDialog}.test.tsx`,
  `components/shell/ActionBar.test.tsx`, `components/ui/FailureBadge.test.tsx`,
  `modules/servers/join/{join-flow.test.ts,JoinServerButton.test.tsx,useJoinFlow.test.tsx}`,
  `modules/servers/ServersView.actionbar.test.tsx`. Guard in `scripts/test-kit.test.mjs`:
  "no test under src defines its own makeInstallation" (grep `function makeInstallation(` in
  `src/` outside `src/test-support/` = 0). `scripts/lib/fixture.mjs` is out of scope.
- **D5 — `makeJob` + `makeConfigProfile`.** Add both to `src/test-support/fixtures.ts`. Migrate
  `makeJob` in `components/shell/ActionBar.test.tsx`, `modules/downloads/bootstrap/{BootstrapWizard,RunningStep}.test.tsx`,
  `modules/downloads/{DownloadsView.failures,DownloadsView}.test.tsx`, `src/shared/types/jobs.test.ts`.
  `makeConfigProfile(overrides?)` returns a minimal valid `ConfigProfile` (from `src/shared`).
  Use it in at most 2 tests that build a `ConfigProfile` literal inline. Guard: "no test
  defines its own makeJob" (same grep shape).
- **D6 — `mockClient` helper + config/mods sites.** `src/renderer/src/test-support/mock-client.ts`:
  `mockClient<M>(importOriginal: () => Promise<M>, overrides?: Partial<M>): Promise<M>`. It
  replaces every function export with `vi.fn()`, then applies `overrides`. Usage is
  `vi.mock('./client', (importOriginal) => mockClient<typeof import('./client')>(importOriginal, {…}))`.
  Test `src/renderer/src/test-support/mock-client.test.ts` › "mockClient stubs every export and
  applies overrides" plus a `// @ts-expect-error` override key that does not exist (proves a
  renamed export fails `npm run typecheck`). Migrate the 9 `modules/config` + 3 `modules/mods`
  files (`grep -rlE "vi\.mock\(['\"][^'\"]*client['\"]" src/renderer/src/modules/{config,mods}`).
  Add guard "every renderer client mock goes through mockClient": each such `vi.mock(` call's
  factory contains `mockClient(`. While D7–D9 are open it is scoped to migrated dirs; D9 widens
  it to all of `src/renderer`.
- **D7 — client mocks: replays.** Migrate the 14 `src/renderer/src/modules/replays` files (same
  grep) to `mockClient`; extend the guard's scope to `replays`.
- **D8 — client mocks: downloads + home.** Migrate the 5 `modules/downloads` + 5 `modules/home`
  files; extend the guard scope.
- **D9 — client mocks: servers.** Migrate the 6 `modules/servers` files. Widen the guard to all
  of `src/renderer`.
- **D10 — split `round-trip.test.ts`.** `src/main/modules/config/round-trip.test.ts` (3,613
  lines) → `src/main/modules/config/round-trip/helpers.ts` (the helpers re-invented across the
  file, deduplicated) + behaviour-named `round-trip/*.test.ts` files, each ≤ 1,500 lines (aim
  ~1,000). `describe()` titles name behaviour; story/review refs move into `it()` titles. Run
  `npx vitest list <old>` before and `npx vitest list src/main/modules/config/round-trip/` after:
  equal test count, renamed titles listed for Done. Guard: "round-trip describes carry no story
  numbers" (no `describe(` line in `round-trip/` matching `/story \d{3}/i`).
- **D11 — split `config/index.test.ts`** (3,231) into sibling `index.<behaviour>.test.ts` +
  `index.test-helpers.ts` in `src/main/modules/config/`, each ≤ 1,500. `vitest list` diff as in D10.
- **D12 — split `downloads/bootstrap/job.test.ts`** (2,784) into sibling `job.<behaviour>.test.ts`
  in `src/main/modules/downloads/bootstrap/`, reusing `../test-support.ts` from D3; each ≤ 1,500;
  `vitest list` diff.
- **D13 — split `config/render.test.ts`** (2,457) → `render.<behaviour>.test.ts` +
  `render.test-helpers.ts` in `src/main/modules/config/`; each ≤ 1,500; `vitest list` diff.
- **D14 — split `src/shared/config/profile-restore.test.ts`** (2,396) →
  `profile-restore.<behaviour>.test.ts` + helpers in `src/shared/config/`. The helpers stay pure
  (shared layer: no node/DOM/electron). Each ≤ 1,500; `vitest list` diff.
- **D15 — split `src/main/lib/schemas.test.ts`** (1,752) and trim/split
  `src/main/modules/config/profiles.test.ts` (1,518) the same way; each result ≤ 1,500;
  `vitest list` diff.
- **D16 — size cap + Testing docs.** Add to `scripts/test-kit.test.mjs`: "no test file exceeds
  1,500 lines". It walks `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.mjs` and has an empty
  `ALLOWED_OVER_CAP` map (file → reason). Add a short `## Testing` section to `docs/ARCHITECTURE.md`
  (≤ 30 lines): `setup.ts` + stubs (quiet, no binary), where the kit lives (`src/test-support/`,
  `src/renderer/src/test-support/`, `downloads/test-support.ts`), `mockClient` usage, real temp
  dirs via `useTempDir` over fs mocks, behaviour-named files with story numbers in `it()` only,
  and the 1,500-line cap with its guard. Add guard "ARCHITECTURE.md has a Testing section naming
  the kit, useTempDir and the 1,500-line cap": it checks for the `## Testing` heading and the
  strings `src/test-support/`, `useTempDir` and `1,500` under it. Run the full `npm test` and `npm run typecheck`; record
  the total test count vs. the pre-story count and any deliberately merged duplicates in Done.

## Model Hints

- D1 → deliverable-hard: the global alias/stub for `electron` and `electron-log/main` changes
  module resolution for all ~444 test files at once. A stub missing a named export, or an alias
  that beats a per-file `vi.mock('electron')`, breaks or silently weakens tests far from the
  diff, and the forbid-electron preload has to catch the CJS `require` that `electron-log`
  makes inside `node_modules`.
- All other Ds → default.

Review: → default

## Acceptance Tests

- AC1 → unit `scripts/quiet-test-run.test.mjs` › "a dot run of the noisy sample prints no stdout
  or stderr blocks and loads no real electron" (D1); CI proof: `ci.yml` `test` job runs
  `npm test` without the install step (D1).
- AC2 → unit `src/test-support/temp-dir.test.ts` › "useTempDir gives each test a fresh dir and
  removes it afterwards" (D2); `scripts/test-kit.test.mjs` › "no main test defines its own
  fakeAppContext" (D2), › "downloads job tests define no local fakeState/fakeLaunch/fakeExtractor/fakeManifest/fakeFetcher"
  (D3), › "no test under src defines its own makeInstallation" (D4), › "no test defines its own
  makeJob" (D5).
- AC3 → unit `src/renderer/src/test-support/mock-client.test.ts` › "mockClient stubs every export
  and applies overrides" + its `@ts-expect-error` line under `npm run typecheck` (D6);
  `scripts/test-kit.test.mjs` › "every renderer client mock goes through mockClient" (D6–D9).
- AC4 → unit `scripts/test-kit.test.mjs` › "no test file exceeds 1,500 lines" (D16, after
  D10–D15), › "round-trip describes carry no story numbers" (D10).
- AC5 → unit `scripts/test-kit.test.mjs` › "ARCHITECTURE.md has a Testing section naming the
  kit, useTempDir and the 1,500-line cap" (D16)
- AC6 → suite gate: full `npm test` green (D16), with the per-split `vitest list` count diffs
  (D10–D15) and the total count before/after recorded in Done.

No criterion describes a user action through the UI, so no `ui:flow` line applies.

## Done

<!-- Filled by /build 225. -->
