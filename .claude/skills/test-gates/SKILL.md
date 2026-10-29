---
name: test-gates
description: "Which test runs where, and what a test in a blocking gate may do, so that green locally means green on CI. Use when: writing, moving or reviewing a test; adding a benchmark, a speed budget, a timing assertion, a sleep or a timeout; touching a test-runner config, a CI workflow or a release workflow; deciding whether a test belongs in the PR gate, the release smoke, release prep or the perf lane; a test is red on CI but green locally, flaky, or slow; a suite is over its time budget; quarantining or deleting a test. DO NOT USE FOR: how to structure a unit test in a given stack (the stack's own test skill); UI screenshot harness mechanics (ui-verify)."
---

<!-- tech-rules:managed 2.4.0 -->

# Test gates

A gate that blocks a merge or a release may only fail for a defect in the code - never for the
machine it runs on, the time of day, or the test that ran before it. Everything below serves one
promise: **green locally means green on CI**, and a red gate means a real defect.

Measured in two projects before these rules, every repeated "green here, red on GitHub" cycle came
from four causes:

- **Time.** Wall-clock budgets (a refresh budget of 150 ms, about 4.5x the 33 ms measured locally;
  the runner took 155 ms) and hidden ones: a 5 s default test timeout, a 1 s default
  `findBy`/`waitFor`. A hosted runner is 4-5x slower than a developer machine (same suite: 404 s
  on CI, 75 s locally).
- **Environment.** The runner's 8.3 temp path (`C:\Users\RUNNER~1\...`), its UTC zone, another
  Node major than the developer's, CRLF checkouts, a binary or fixture only one machine has.
- **The gate did not run before the push** - or ran in another shape than CI runs it.
- **The first CI signal came at release time**, so a sprint's worth of these arrived at once.

## The lanes

| Lane | Runs | Blocks | Holds | Budget |
| --- | --- | --- | --- | --- |
| `story` | per change, locally | that change | the tests the change touches | - |
| `pr` | every pull request on CI; the same command locally before the push | the merge | format, lint, typecheck, build, and the tests of the **core functionality** | 6 min on the CI runner, aim for 4 |
| `release` | the release workflow on CI | the release | the build or package that ships, then **smoke**: it starts and its core journeys work once | 6 min |
| `release-prep` | locally before a release is cut (`/release-prep`) | the decision to release | **everything**: all lanes above, the tests no faster lane holds, every e2e flow, other platforms, perf, packaging, the release dry run | no cap - fastest first |
| `perf` | an advisory CI job on pull requests, and release prep | nothing, ever | wall-clock budgets and benchmarks | - |

The PR lane proves the core still works on every merge, so it has to stay fast enough to run every
time. The release lane proves the artifact, not the code again: the PR lane already ran on that
commit, and running the unit suite a second time at release is how a flaky test blocks a release
for nothing. Release prep is the one place where everything runs, on purpose, before anyone
presses the button.

**The release lane may skip the PR lane only when the PR lane provably ran on the released
commit**: the release branch accepts changes only through pull requests, the PR lane is a required
check, and the branch must be up to date before merging (or a merge queue does that). Check it
(`gh api repos/<owner>/<repo>/rules/branches/<branch>` for rulesets,
`gh api repos/<owner>/<repo>/branches/<branch>/protection` for classic protection); unknown counts
as unprotected. Unprotected → the release lane runs the PR lane too.

### The lane map

Each project writes down which command is which lane - one table in its `CLAUDE.md`:

```markdown
## Test lanes

| Lane | Command | Where | Blocks | Budget |
| --- | --- | --- | --- | --- |
| pr | `npm run verify` | verify.yml on PRs into main | merge | 6 min |
| release | `npm run build && npm run test:smoke` | release.yml on push to main | release | 6 min |
| release-prep | `npm run test:full`, `npm run test:e2e`, `npm run package` | locally, `/release-prep` | release decision | - |
| perf | `npm run test:perf` | perf.yml, advisory | nothing | - |
```

- **Every lane row names commands that run exactly its tests** - release prep included, so a test
  moved out of the PR lane still has a command that runs it. A guard test fails when a test file is
  matched by no lane: a test no command runs is a test nobody runs.
- **Where a test belongs is decided by its file name, folder or tag** - `*.perf.test.ts`,
  `tests/full/`, `[Trait("Lane", "Smoke")]` - and the runner configs select by it. Never by a
  condition inside the test.
- **Without a table**, the lanes are what CI does: a command a `pull_request` workflow runs without
  `continue-on-error` is `pr`, a command the release workflow runs is `release`, an advisory job is
  advisory, and everything else is `release-prep`.
- **In an ai-scrum project** the profile's `test` is the whole non-perf suite (PR and release-prep
  tests), so `/build` and the sprint gate still run every unit test once.
- The architecture review decides the map (`/common:architecture-review tests`, plugin `common`),
  `/test-review` checks the suite against it, `/release-prep` runs it. Measured durations live in
  their reports, not in the table.

## What the PR lane holds: core functionality

Decide per test, in this order:

1. **Would a user or a caller notice if the behaviour broke?** No - it pins wiring, a constant, a
   mock's own return, or what another test already proves - then it belongs nowhere. Delete it and
   name the test that keeps the coverage.
2. **Does it measure speed?** Then it is `perf`, whatever else it checks (see below).
3. **Is it a core function** - what the product promises in its README or `CLAUDE.md`, and the
   contracts at its boundaries (file formats, persisted data, IPC/HTTP API, public surface)? Then
   `pr`, if it is cheap. Unit and integration level, well under a second each.
4. **Everything else** - exhaustive variants, realistic-scale scenarios, compatibility matrices,
   every e2e flow, other platforms - is `release-prep`. It still runs before every release; it just
   does not tax every merge.

E2E flows join the PR lane only when the lane map names them as core journeys and they fit the
budget. The release smoke picks a handful of them (one per product promise, at most about five).

## Rules for a test in a blocking lane

1. **No wall-clock assertion.** Never compare elapsed time against a number. Prove cost by what
   the code does, which no machine changes: bytes written, files read, calls made, rows touched,
   iterations. A counting fake (`writtenBytes`, `readPaths`) proves "saving one file costs one
   file" on every machine. A speed budget goes into the perf lane. Not a speed assertion: a stall
   detector that only checks that something happens *before the central wait timeout* - that is a
   hang detector.
2. **Timeouts detect hangs; they are not speed limits.** Set them once, centrally and generously
   (test 60 s, hooks 60 s, async waits such as `findBy`/`waitFor`/`vi.waitFor`/Playwright `expect`
   10 s, a `timeout-minutes` on every CI job). A per-test timeout may only be longer than the
   central one. Never lower one to express a speed expectation, and never raise one to rescue a
   slow test - move or fix the test instead.
3. **Fixed clock, zone and locale, set in the test config** - not in a shell, not in a CI step. A
   fixed `NOW`, a fake timer or `TimeProvider`, the zone pinned in the config file, an explicit
   locale wherever text is formatted.
4. **Canonical temp paths.** One helper creates temp directories and resolves them to their long
   form: Windows runners hand out 8.3 short names (`RUNNER~1`), and anything that compares paths
   then sees two folders. Node: `fs.promises.realpath` or `fs.realpathSync.native` - plain
   `fs.realpathSync` leaves the short name as it is. No hard-coded absolute paths, no reliance on
   path case or separators.
5. **No network, no real services, no real model.** Fakes, recorded fixtures, local servers the
   test starts itself.
6. **Hermetic.** Only what a clean checkout plus the install step provides. A gitignored fixture or
   a binary one machine happens to have makes a test green here and red there. A test that skips
   itself when something is missing is not a gate - it says nothing on the machine that lacks it.
7. **No order dependence, no leftover work.** Each test sets up what it reads. Background work the
   code starts (a debounced write, an index refresh) is awaited before teardown through an
   idle/dispose call the code exposes - a `sleep(100)` before deleting the temp folder is a race
   that the slower machine loses.
8. **No sleeping to wait.** Await the signal, or poll with the central timeout. A sleep is only
   acceptable to show that something did *not* happen, and then as short as the mechanism allows.
9. **No retries.** A test that passes on the second attempt is a flaky test with a green badge.
   Retries stay off in every blocking lane; release prep re-runs a failure once only to classify it.

## The perf lane

- Speed tests live in their own files or category: `*.perf.test.*` (JS/TS), a
  `[Trait("Lane", "Perf")]` (.NET), `@pytest.mark.perf` (Python). The blocking lanes exclude them
  **by configuration**, so the plain test command never runs them: Vitest/Jest `exclude`, .NET a
  `.runsettings` with `<TestCaseFilter>Lane!=Perf</TestCaseFilter>` that `Directory.Build.props`
  sets as `RunSettingsFilePath`, pytest `-m "not perf"` in `addopts`. A perf file in a project
  whose config does not exclude it yet is a blocking test again - add the exclusion first.
- **A budget overrun warns, it never fails.** The helper prints one marker line per budget,
  `PERF-BUDGET <name> measured=<ms> limit=<ms> ok|over`, which release prep and a workflow step can
  read. On GitHub Actions an overrun also becomes a `::warning` annotation: Vitest's test context
  `annotate(message, 'warning')` does that through the github-actions reporter (added automatically
  when `GITHUB_ACTIONS=true` and no reporter is configured - a config that sets `reporters` lists
  `github-actions` itself); any other stack greps the marker lines in a workflow step.
- Each budget records the measured value and where it was measured (`// measured locally: 33 ms`).
- A criterion about speed is still proven deterministically in a blocking lane (rule 1); the
  budget is an additional signal, never the proof.
- The perf lane runs as its own advisory CI job (`continue-on-error: true`) on pull requests and in
  release prep - never inside the PR job, never in the release job.

## Parity: one environment

- **One runtime version, in one file** - `.nvmrc` / `.node-version`, `global.json`,
  `.python-version` - set to the version the product actually runs on (for Electron: the Node that
  Electron bundles, `ELECTRON_RUN_AS_NODE=1 npx electron -p process.versions.node`). CI reads the
  file (`actions/setup-node` with `node-version-file`); no workflow carries a second, hand-written
  version. The test config warns when the local major differs.
- **Blocking lanes run on the platform the product ships for.** A platform that is not supported
  gets an advisory lane or none; it never blocks a merge.
- `.gitattributes` with `* text=auto eol=lf`, so a Windows checkout cannot redden a format check -
  plus `*.bat text eol=crlf` and `*.cmd text eol=crlf`, which `cmd.exe` misreads with bare LF.
- Release prep runs under the runner's conditions: `CI=true`, a clean checkout and install of what
  will be released, and on Windows a temp directory given by its 8.3 short name.

## Time budget

- **What is measured:** the blocking CI job's wall-clock from start to verdict, install included -
  the median of the last ten runs (`gh run list --workflow <file> --json startedAt,updatedAt,conclusion`).
  A local number is shown next to it multiplied by five, never instead of it.
- The PR lane and the release lane each fit **6 minutes** (aim for 4).
- **Fail fast:** format → lint → typecheck → unit and integration → build → smoke/e2e. A typo
  must fail in minute one, not after twenty minutes of flows.
- Measure per test with a machine-readable reporter. The slowest ten are the optimisation list.
- Over budget is a decision for the architecture review, never a reason to raise a timeout: move
  tests to release prep, share an expensive fixture, shard or parallelise, or make the setup
  cheaper.

## Flaky, brittle, pointless and red-on-CI tests

- **Flaky** - fails without a defect. That is a defect in the test. Fix its dependency (the rules
  above), or quarantine it: an entry `{ flow, reason, story, since }` in the project's quarantine
  list - the shape ai-scrum's `e2e-quarantine` and `ui-verify`'s runner use, with `flow` holding the
  test or flow name. The list only works when the runner reads it: the e2e runner treats an entry
  as expected-fail; Vitest's config excludes the listed files from the blocking lanes; .NET tags the
  test `[Trait("Lane", "Quarantine")]` and the blocking filter adds `Lane!=Quarantine`. Release prep
  runs quarantined tests and reports `expected-fail` / `unexpected-pass`. An entry is fixed or
  deleted within two sprints (30 days without ai-scrum). Never a retry, never a bare `skip`.
- **Brittle** - deterministic, but breaks on changes no user notices: a literal config value, an
  element or row count, a fixture ordinal, a call order, a full snapshot. Assert the outcome a user
  sees instead, or name the count in the story that owns it.
- **Pointless** - no defect a user could notice would make it fail: a tautology, a wiring check, a
  pinned constant or locale string, a mock asserting its own return, a duplicate. Delete it and name
  the test that keeps the coverage. A suite that is never pruned only grows slower.
- **Red on CI, green locally** - the test depends on its environment. In this order:
  1. classify the dependency: clock, zone, path, speed, order, artefact, runtime version;
  2. reproduce it under the runner's conditions (the release-prep settings above);
  3. fix the class, not this one test - every test with the same dependency;
  4. add the guard that keeps the class out (a lint rule, a guard test, a config default);
  5. never raise a number, add a retry or skip the test to get the run green.

## Enforcement

This skill makes Claude aware; it gates nothing, and `/tech-rules:setup` installs none of the
following. Each is something the project adds itself, and each catches only what it checks:

- **A lint rule against elapsed time in non-perf tests.** It catches the common shape -
  `Date.now() - start`, `performance.now() - t0` - not `t1 - t0` or `process.hrtime`; review
  catches the rest. ESLint, scoped to test files, ignoring `**/*.perf.test.*`, merged into any
  `no-restricted-syntax` entries the project already has (a second entry replaces the first):

  ```js
  'no-restricted-syntax': ['error', {
    selector: "BinaryExpression[operator='-'][right.type='Identifier'][left.type='CallExpression']" +
      "[left.callee.object.name=/^(Date|performance)$/][left.callee.property.name='now']",
    message: 'Elapsed wall-clock time in a gate test. Assert a deterministic cost, or move the budget into a *.perf.test.* file.',
  }]
  ```

  .NET: a guard test that scans test sources outside the perf category for `Stopwatch` and
  `DateTime.Now -`.
- **Guard tests on the CI wiring:** every workflow takes the runtime version from the version file;
  the PR job has no `continue-on-error`; the perf job is advisory; the release job runs the smoke
  lane; the default test command excludes the perf files; every test file belongs to a lane.
- **Central timeouts in the runner config**, so a new test inherits the hang detector instead of
  the runner's speed limit, and a `timeout-minutes` on every CI job.
- **A pre-push hook** that runs the PR lane (`git config core.hooksPath .githooks`, a
  `.githooks/pre-push` calling the lane's command) - the only thing that makes "the gate ran before
  the push" true. A plugin never writes it; the project decides.
- **A budget warning in the workflow:** a last step that emits `::warning` when the job ran longer
  than the lane's budget.

## Stack notes

**Vitest:** `exclude: [...configDefaults.exclude, '**/*.perf.test.*']`, `testTimeout` and
`hookTimeout` in the config, `process.env.TZ` set at the top of the config file (the workers
inherit it), a second config for the perf lane that includes only the perf files with
`fileParallelism: false`. Testing Library: `configure({ asyncUtilTimeout: 10_000 })` in the setup
file. `vi.waitFor` has no global default - wrap it once in the setup file.

**Playwright:** `retries: 0`, `forbidOnly: true`, `expect: { timeout: 10_000 }` (the default is
5 s), a central `timeout`, a suite-wide `globalTimeout`, one worker for a single-instance desktop
app. Flows assert user-visible outcomes, never durations.

**.NET / xUnit:** lanes as traits (`[Trait("Lane", "Perf")]`, `[Trait("Lane", "Smoke")]`), the
perf exclusion in the `.runsettings` above so `dotnet test` stays the PR lane, the perf lane as
`dotnet test --filter "Lane=Perf"` with a console logger that shows test output; the SDK pinned in
`global.json`; `TimeProvider` with a fake instead of `DateTime.Now`; no `Thread.Sleep` in tests.

## Review checklist

- [ ] No test in a blocking lane compares elapsed time against a number.
- [ ] No per-test timeout is shorter than the central one; no retry; no bare skip.
- [ ] Clock, zone, locale and temp paths come from the test config and helpers.
- [ ] Nothing depends on a file or binary a clean checkout lacks.
- [ ] Background work is awaited before teardown; no sleep waits for a result.
- [ ] Every new test would fail for a defect a user could notice, is not brittle, and is not a copy
      of another.
- [ ] A new test sits in the lane the lane map gives it; a speed check sits in a perf file whose
      exclusion the config already has.
- [ ] CI reads the runtime version from the version file; the PR lane fits its budget.
