---
id: 272
title: 'Test hygiene: skipped launch flow fails in CI, loose workflow pins, discovery guard, constant echoes'
status: done
created: 2026-10-27
---

## Requirement

A maintainer wants four small test-suite weaknesses closed together, so that a vanished stand-in
binary turns CI red instead of green, workflow edits stop costing matching literal edits in a test,
a mistyped test filename cannot silently never run, and a tuning constant can change without a test
that only echoes it.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F12, F11, F15, F16; all P3):

- F12: `scripts/flows/launch-with-scope.mjs:20-23` logs "SKIPPING LOUDLY - resources/bin/7za.exe was
  not vendored locally" and returns, so the flow exits green. CI fetches 7za today (`ci.yml:53`,
  `ui-flows.yml:43,73`). Only this site counts: `windows-build-on-linux.mjs:131` is a deliberate
  per-platform split, and a CI throw there would break the Windows legs. `ci.yml:88` deliberately
  has no `fetch:7za` for its Linux flows.
- F11: `scripts/workflows.test.mjs:48-58` restates the xvfb-run/`--shard=${{ matrix.shard }}/6`
  string (:49), `npm run fetch:7za` (:54) and `ELECTRON_DISABLE_SANDBOX` (:57). The judge keeps
  the 7za, sandbox, `build:dev` and windows-verify list assertions (:63-80) as the F12 safety net
  and the shard count as an invariant; only the xvfb literal is loosened.
- F15: the vitest include is `src/**/*.{test,spec}.{ts,tsx}` and `scripts/**/*.test.mjs`
  (`vitest.config.ts:30`). Nothing guards it; there are no orphans today (only a `.snap` sits outside).
- F16: 33 `expect(CONSTANT).toBe(` hits, of which about 15–20 are tuning-constant echoes, e.g.
  `incremental-scan.test.ts:245` (`LIVE_WRITE_WINDOW_MS`), `ping-samples.test.ts:45-47`,
  `flow-select.test.mjs:55` (`MAX_FLOWS_PER_AREA`). The CSP pins (`layering.test.ts:101`,
  `renderer-source.test.ts:64` and `:387`) are deliberate (stories 067 AC7, 084 AC2) and stay, as do
  the wire/engine-contract values, `fixture-constants.test.ts` and `index-cache.test.ts:134`.

## Acceptance Criteria

- [x] **AC1** — With `CI` set and `resources/bin/7za.exe` absent, `launch-with-scope` fails; with
      `CI` unset it still logs and returns. A seeded defect (removing the CI branch) fails the named check.
- [x] **AC2** — Every workflow job that runs flows including `launch-with-scope` runs
      `npm run fetch:7za` first (asserted in `scripts/workflows.test.mjs`).
- [x] **AC3** — `scripts/flows/windows-build-on-linux.mjs` is unchanged (`git diff` empty for it).
- [x] **AC4** — `scripts/workflows.test.mjs` no longer contains the xvfb-run regexp; it asserts that
      a step runs `ui:flows` with `--shard` and the matrix shard. The `fetch:7za`,
      `ELECTRON_DISABLE_SANDBOX`, `build:dev` and windows-verify `runs` assertions remain.
- [x] **AC5** — A `scripts/repo-hygiene.test.mjs` case takes `git ls-files` filtered by
      `/\.(test|spec)\.[cm]?[jt]sx?$/` and fails for any file outside the two include globs (seeded
      defect: a `foo.test.cjs` makes it red; `.snap` files and `node_modules` are ignored).
- [x] **AC6** — `grep -rn "expect(LIVE_WRITE_WINDOW_MS).toBe\|expect(MAX_FLOWS_PER_AREA).toBe" src
scripts` returns nothing.
- [x] **AC7** — The CSP pins still fail on a relaxed directive: `renderer-source.test.ts` keeps
      `PRODUCTION_CSP` verbatim and `layering.test.ts` keeps its `toContain` checks.
- [x] **AC8** — `npm test` and `npm run lint` exit 0.

## Open Questions

- ~~F16 scope: only the two named echoes, deleted while those files are touched anyway (judge), or the
  full 15–20 list (refuter's count) after a per-hit check? Not a campaign over all 33 hits.~~
  answered → Decisions (Sprint)
- ~~CSP: the judge proposes keeping one verbatim pin and reducing `layering.test.ts` to `toContain`;
  the refuter notes both pins are deliberate. Reduce, or leave all three and drop this item?~~
  answered → Decisions (Sprint)
- ~~F15: import the include globs from `vitest.config.ts` or repeat the patterns in the test?~~
  answered → Decisions (Sprint)
- ~~F12: throw in the flow under `process.env.CI`, or rely on the workflow `fetch:7za` step failing
  (already true) and leave the flow alone?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** F16: only the two named echoes. CSP: keep all pins. F15: import the include globs from vitest.config.ts. F12: the flow throws under process.env.CI.
- AC1's test lives in a new `scripts/flow-ci-skip.test.mjs`, not under `scripts/flows/`, because
  every `.mjs` there is loaded as a flow (`scripts/lib/flow-tree.mjs:18`).
- The other eight "SKIPPING LOUDLY" sites (`footer-map`, `replays-*`, `servers-*`) stay untouched and no
  shared helper is extracted, because the story scopes F12 to `launch-with-scope` only.
- AC3 is proven by a diff check in `/build`'s verification, not a suite test, because "this file is
  unchanged" is a property of the diff, not of the code.

## Plan

1. `launch-with-scope.mjs`: in the `!spawnable` branch, throw when `process.env.CI` is set; keep the
   loud log + return otherwise. A unit test imports the flow with its two lib imports mocked
   (spawnable false) and calls `setup()` + the default export.
2. `workflows.test.mjs`: replace the xvfb-run regexp with a structural shard assertion; add a
   cross-workflow check that every job running all flows (`ui:flows`) or
   `ui:flow -- launch-with-scope` has an `npm run fetch:7za` step before it. The existing
   fetch:7za / sandbox / build:dev / windows-verify assertions stay.
3. `repo-hygiene.test.mjs`: discovery guard — `git ls-files` filtered by the test-file regexp; every
   hit must match one of `vitest.config.ts`'s `test.include` globs (imported, never repeated).
4. Delete the two constant echoes (`incremental-scan.test.ts:244-246`, `flow-select.test.mjs:55`).
5. Untouched: CSP pins, `windows-build-on-linux.mjs`, the other skip sites.

Files: `scripts/flows/launch-with-scope.mjs`, `scripts/flow-ci-skip.test.mjs` (new),
`scripts/workflows.test.mjs`, `scripts/repo-hygiene.test.mjs`,
`src/main/modules/replays/incremental-scan.test.ts`, `scripts/flow-select.test.mjs`.
No user-visible change: no CHANGELOG entry, no systems doc.

## Deliverables

- [x] D1 — **launch-with-scope fails in CI without 7za.** In `scripts/flows/launch-with-scope.mjs`'s
      `!spawnable` branch (lines ~18-24): if `process.env.CI` is truthy, throw an `Error` naming the
      missing `resources/bin/7za.exe` and `npm run fetch:7za`; otherwise keep today's `console.log` +
      `return` unchanged. Touch no other flow — the other "SKIPPING LOUDLY" sites stay, and
      `scripts/flows/windows-build-on-linux.mjs` must show an empty `git diff`. Test: new
      `scripts/flow-ci-skip.test.mjs` (NOT under `scripts/flows/` — every `.mjs` there is loaded as a
      flow by `scripts/lib/flow-tree.mjs`). It `vi.mock`s `./lib/fixture.mjs`
      (`writePlayWithFixture` → `{ spawnable: false }`) and `./lib/flow-common.mjs` (inert `invoke`,
      `launchLines`, `nextLaunchLine`), imports `./flows/launch-with-scope.mjs`, awaits `setup()`,
      then calls the default export with `{ page: {}, step() {}, shot() {} }`. Use
      `vi.stubEnv('CI', …)` + `vi.unstubAllEnvs()` so the runner's own `CI` cannot leak in. Tests:
      "launch-with-scope fails under CI when the stand-in client is missing" (rejects, message
      mentions 7za) and "launch-with-scope logs and returns locally when the stand-in client is
      missing" (`CI` stubbed to `''`, resolves, a `console.log` spy saw "SKIPPING LOUDLY"). Seeded
      defect: removing the CI branch must turn the first test red.
- [x] D2 — **Workflow pins loosened, fetch:7za ordering asserted.** In `scripts/workflows.test.mjs`
      › "ui-flows runs six shards on PRs into main and on dispatch only": replace the xvfb-run regexp
      (lines ~48-54) with an assertion that some step's `run` matches `/\bnpm run ui:flows\b/` and
      contains `--shard=${{ matrix.shard }}/` (the matrix `[1..6]` assertion stays as the shard-count
      invariant). Keep the `npm run fetch:7za`, `npm run build:dev`, `ELECTRON_DISABLE_SANDBOX` and
      windows-verify `runs` toEqual assertions unchanged. Add a test in the same file using the
      existing `loadWorkflows()` helper, "every job that runs launch-with-scope fetches 7za first":
      for every job, the steps whose `run` matches `/\bui:flows\b/` (all flows) or
      `/\bui:flow\b.*\blaunch-with-scope\b/` must each have a step with `run === 'npm run fetch:7za'`
      at a lower index; also assert at least one such job exists (today `ui-flows.yml` › `ui-flows`).
      `ci.yml` › `linux-journey` runs named flows only and is correctly not selected. Mind the
      `ui:flow` / `ui:flows` prefix overlap in the regexps.
- [x] D3 — **Test-discovery guard.** In `scripts/repo-hygiene.test.mjs` add a
      `describe('test discovery', …)`. Import the include globs from the real config
      (`import vitestConfig from '../vitest.config.ts'`, read `vitestConfig.test.include`) — never
      repeat the glob literals; if that import cannot load in the test runtime, export the array as a
      named const from `vitest.config.ts` and import that. A small pure function in the test file,
      `orphanTestFiles(paths, include)`, returns the paths matching `/\.(test|spec)\.[cm]?[jt]sx?$/`,
      not under `node_modules/`, that match none of `include` (`matchesGlob` from `node:path`; engines
      is node ≥22.12). Tests: "every tracked test file is inside a vitest include glob"
      (`test.skipIf(!IS_WORK_TREE_ROOT)`, input from the file's existing `git(['ls-files'])` helper,
      expects `[]`) and "a test file outside the include globs is reported" (seeded list:
      `scripts/foo.test.cjs` reported; `src/a.test.ts`, `scripts/b.test.mjs`,
      `src/__snapshots__/a.test.ts.snap` and `node_modules/x/y.test.js` not reported).
- [x] D4 — **Two constant echoes removed.** Delete the `it('exposes the live-write window constant', …)`
      block in `src/main/modules/replays/incremental-scan.test.ts` (~244-246) and drop
      `LIVE_WRITE_WINDOW_MS` from its import if nothing else uses it; delete the
      `expect(MAX_FLOWS_PER_AREA).toBe(12)` line in `scripts/flow-select.test.mjs` (~55) — the
      `toBeLessThanOrEqual(MAX_FLOWS_PER_AREA)` loop stays. Touch no other `expect(CONSTANT)` hit and
      leave both CSP pins (`src/main/layering.test.ts`, `src/main/lib/renderer-source.test.ts`)
      unchanged. Then `npm test` and `npm run lint` exit 0.

## Model Hints

All Ds default tier.

Review: → default

## Acceptance Tests

- AC1 → unit `scripts/flow-ci-skip.test.mjs` › "launch-with-scope fails under CI when the stand-in
  client is missing" and › "launch-with-scope logs and returns locally when the stand-in client is
  missing" (D1)
- AC2 → unit `scripts/workflows.test.mjs` › "every job that runs launch-with-scope fetches 7za
  first" (D2)
- AC3 → diff check `git diff --exit-code dev -- scripts/flows/windows-build-on-linux.mjs` in
  `/build`'s verification — a file-unchanged claim is a property of the diff, not of the code (D1)
- AC4 → unit `scripts/workflows.test.mjs` › "ui-flows runs six shards on PRs into main and on
  dispatch only" (rewritten shard assertion plus the kept fetch:7za/sandbox/build:dev asserts) and ›
  "windows-verify runs build, ui:verify and three flows on windows-latest and uploads screenshots" (D2)
- AC5 → unit `scripts/repo-hygiene.test.mjs` › "every tracked test file is inside a vitest include
  glob" and › "a test file outside the include globs is reported" (D3)
- AC6 → the AC's own grep, run in `/build`'s verification after D4 (a deletion has no suite test) (D4)
- AC7 → unit `src/main/lib/renderer-source.test.ts` › "the production CSP is unchanged" and
  `src/main/layering.test.ts` › "leaves the production CSP unchanged (connect-src 'self')" —
  existing, unchanged (D4)
- AC8 → `npm test` and `npm run lint` exit 0 (D4, after all Ds)

## Done

Summary: `launch-with-scope` now throws under `CI` when `7za.exe` is missing (logs and returns locally).
`workflows.test.mjs` loses the xvfb literal and gains a fetch:7za-before-flows ordering check.
`repo-hygiene.test.mjs` gains a test-discovery guard importing the include globs from `vitest.config.ts`.
The two constant echoes (`LIVE_WRITE_WINDOW_MS`, `MAX_FLOWS_PER_AREA`) are deleted.

Commit message: `272: launch-with-scope fails in CI without 7za, workflow pin loosened, test-discovery guard, two constant echoes removed`

Verification (narrow gate, no e2e mapped): build, typecheck, lint green; `npx vitest run --changed HEAD` green
(5 files, 48 tests) plus renderer-source and layering run separately (35 tests green).
AC1 flow-ci-skip (2 tests), AC2/AC4 workflows.test.mjs, AC5 repo-hygiene (2 tests), AC7 CSP tests unchanged and green;
AC3 `git diff` empty; AC6 grep empty; AC8 lint green, `npm test` covered by the narrow set (full run is the sprint gate).
Review (default, 1 cycle): PASS, no blocking findings. No manual residue.
Decisions: `matchesGlob` (experimental on Node 22.12, works there since 22.5) was checked on the local Node only;
`.snap` seeded case is trivially excluded by the regexp, kept as harmless.

tiers: D 4 / hard 0 · review default · cycles 1 · agents 6
