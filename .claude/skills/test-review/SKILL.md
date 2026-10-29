---
name: test-review
description: Test engineer review of this project's test suite against the test-gates rules - per test, whether it proves a function or measures speed, whether it is relevant, deterministic, robust, in the right lane and worth its runtime - and a report of what to delete, merge, move or fix. Invoked as /test-review [all | staged | branch [<base>] | <path>].
argument-hint: [all | staged | branch [<base>] | <path>]  (default: all)
disable-model-invocation: true
---

<!-- tech-rules:managed 2.4.0 -->

# Test review

You are the test engineer. You read the test suite the way a reviewer reads code: every test has
to earn its place by catching a defect a user or caller would notice, deterministically, in the
lane where it belongs, at a cost the lane can afford. You find the tests that do not - the ones
that measure the machine instead of the code, prove nothing, break on harmless changes, duplicate
each other or make the PR lane slow - and you write down what to do with each.

The yardstick is the `test-gates` skill, a `SKILL.md` next to this one in the same
`.claude/skills/` folder. Read it first, completely; do not review from memory. A deviation the
project records in its `CLAUDE.md` wins over the skill - check for one before reporting, and never
report the deviation itself.

**What this enforces: nothing.** It reads and writes one report. It changes no test, no source
file and no configuration. The lane decisions it prepares are made by the architecture review
(`/common:architecture-review tests`, from the per-user plugin `common@hantsch`), small fixes by
the change that fixes them.

## Scope

`$ARGUMENTS` selects what to review; default `all`.

| Argument | Reviewed |
| --- | --- |
| `all` | the whole suite: every test file, the runner configs, the CI workflows, the lane map |
| `staged` | the test files in `git diff --cached`, plus the configs and workflows if staged |
| `branch [<base>]` | the test files changed against the merge base with `<base>` (default: the default branch; pass the integration branch, e.g. `dev`, when the project has one) |
| a path | every test file under it |

For a diff scope, review whole test files that changed, and skip the measuring phase unless the user
asks for it.

## Phase 0 - ground and plan

1. Read `CLAUDE.md` (its `## Test lanes` table and every recorded deviation), `.claude/ai-scrum.md`
   if present (verify commands, `e2e-quarantine`, `roadmap-path`, `doc-language`), the CI workflow
   files, every test-runner config, the scripts or test projects that run tests, and the runtime
   version file (`.nvmrc`, `.node-version`, `global.json`, `.python-version`).
2. Record `git rev-parse --short HEAD`, the branch and whether the tree is dirty.
3. **Map the suite:** test roots; per area (directory or test project) its files, tests and lines;
   **which command runs which files** - from the runner configs' include/exclude and the scripts -
   and through that each file's current lane (by the table, or by `test-gates`' rule for a project
   without one); every file no command runs.
4. **Cut the areas by size, not by folder count:** about 4,000 test lines per agent, a large folder
   split, small ones merged. At most 8 agents per message; more areas run in further batches of 8.
5. Paths: the report is `<docs>/reviews/<date>-test-review.md` and the work directory
   `<docs>/reviews/<date>-test-review-work/`, where `<docs>` is the folder holding the profile's
   `roadmap-path`; without a profile, propose `docs/reviews/`. A run that stops resumes at the first
   area whose output file is missing. Report and findings are written in the profile's
   `doc-language` (default English).
6. Show the plan in one block and ask once: scope, the areas with their sizes and the batch count,
   whether to **measure** (Phase 1 runs the PR lane's test runner once, about that lane's minutes),
   and the paths. This is the only question of the run.

## Phase 1 - measure (only if confirmed)

Call the **test runner directly**, not a wrapper script such as `npm run verify` (a reporter flag
appended there reaches only its last sub-command, and the wrapper may build): Vitest
`npx vitest run --reporter=json --outputFile=<work>/tests.json`, Jest
`npx jest --json --outputFile=<work>/tests.json`, `dotnet test --logger "trx;LogFileName=<work>/tests.trx"`,
pytest `--durations=0 --junitxml=<work>/tests.xml`. One `Bash` call with `timeout: 600000`. If the
tool moves it to the background at the ceiling, stop it with `TaskStop` at once - a run left
behind can hold a single-instance lock - and record "PR lane runner over 10 minutes locally", which
is itself the budget finding; continue without per-test numbers.

Extract: total minutes, per-file and per-test durations, the 20 slowest tests, any failure. The
budget is measured on the runner (`test-gates`, Time budget): with `gh` available and
authenticated, the median wall-clock of the PR job's last ten runs
(`gh run list --workflow <file> --limit 10 --json startedAt,updatedAt,conclusion`); always show the
local minutes times five next to it, never instead of it.

## Phase 2 - evidence sweeps (yourself, by search)

Count each with the exact search you used, per area, with `file:line` for every hit:

- elapsed wall-clock compared against a number in a non-perf test (`Date.now() -`,
  `performance.now() -`, `process.hrtime`, `Stopwatch`, `time.perf_counter() -`, followed by a
  less-than);
- per-test or per-wait timeouts below the central ones; retries; skips without a recorded reason;
- the real clock, zone or locale: unfrozen `new Date()` / `DateTime.Now` in assertions,
  `toLocale*String()` without a locale, time-zone offsets hard-coded in expectations;
- temp directories created without resolving the long form (`mkdtemp(tmpdir())` without
  `fs.promises.realpath`, `Path.GetTempPath()` compared as a string);
- sleeps used to wait for a result (`setTimeout` in a promise, `Thread.Sleep`, `Task.Delay`,
  `time.sleep`);
- network or real services (`fetch(` to a non-local host, real API clients without a fake);
- dependencies a clean checkout lacks: skips on a missing binary or file, gitignored fixtures
  (`git check-ignore`);
- runtime parity: the version file exists, every workflow reads it, the local major matches;
- history: per test file, the commits whose subject names a test or CI fix -
  `git log --format=%s -- <file> | grep -iE '(^|[^a-z])(ci|flaky|flake|timeout)([^a-z]|$)|fix(es|ed)? (the )?tests?'`
  (a bare `ci` substring also matches "decision" and "cites") - and the age of every quarantine
  entry.

## Phase 3 - classify (one agent per area)

Per batch, all area agents in ONE message: `subagent_type: "general-purpose"`, `model: "sonnet"`,
`run_in_background: false`. Each prompt is self-contained: repo root and commit, the path of the
`test-gates` skill, the lane map (or "none, lanes by test-gates' default rule"), **the command →
files map from Phase 0 for its area**, its files, the evidence lines and the durations for its
area, and its output file `<work>/area-<name>.md`. The rules, verbatim:

- Open every test file of the area and read each test. Per test (or per group of tests that share
  one verdict), decide:
  - **kind** - `function` (proves behaviour a user or caller relies on), `perf` (measures speed),
    `env` (the result depends on the machine: clock, zone, path, speed, order, artefact, runtime
    version), `brittle` (deterministic, but breaks on a change no user notices: a literal config
    value, an element count, a fixture ordinal, a call order, a full snapshot), `wiring` (a
    registration, a constant, a mock's own return), `duplicate` (proves what a named neighbouring
    test proves);
  - **defect caught** - one line: which broken behaviour would make it fail. None → `wiring` or
    `duplicate`;
  - **lane now** (from the map you were given) and **lane it belongs in** - `pr`, `release`
    (smoke), `release-prep`, `perf`, or `delete` - by the order of questions in `test-gates`;
  - **cost** - its duration and setup weight, where measured.
- Report only what needs a change: one block per finding with `title`, `kind`, `files`
  (`file:line`), `evidence` (counted), `problem` (what it costs: a blocked release, budget
  minutes, noise), `recommendation` (delete and name the test that keeps the coverage / merge into
  X / move to lane Y / make deterministic: how / remove the environment dependency: how / assert
  the user-visible outcome instead / quarantine with reason), `effort` (S hours, M a day, L more).
- Severity: **blocks releases** (a `perf` or `env` test in a blocking lane, a flaky history),
  **costs time** (budget: slow, oversized setup, wrong lane), **noise** (`brittle`, `wiring`,
  `duplicate`).
- Instances of one cause are one finding. Change nothing; write only your output file; end it with
  `opened <n> of <m> files` and the list of files you could not open; return the path, the count
  per severity and that line.

## Phase 4 - the report

`<reviews>/<date>-test-review.md`:

1. **Verdict.** Commit, scope, tests and files reviewed (opened versus assigned); the PR lane's
   minutes - CI median and local times five - against its budget; counts per kind and per
   severity; the three to five causes behind most findings; what is good, concretely.
2. **Lane map.** The `CLAUDE.md` table against what the workflows and scripts actually run, every
   mismatch named, and every test file no lane runs. No table → the proposed one, filled from
   what exists.
3. **Blocks releases.** Every `perf` and `env` test in a blocking lane and every test with a flaky
   history, each with its fix - these go first.
4. **Budget.** The 20 slowest tests with their seconds and the move or change for each; the lane's
   projected time after those changes.
5. **Brittle, pointless and duplicate tests.** The rewrite, delete or merge list; every deletion
   names the test that keeps the coverage.
6. **Per area.** One table per area: `| Test | Kind | Lane now → belongs | Finding | Effort |`.
7. **Method and limits.** Searches used, agents, batches and minutes, measured or not, the commit
   and dirty state, the files no agent opened.

Delete the work directory once the report exists. In the chat, at most ten lines: the report path,
the counts per severity, the two things to do first, and the next step -
`/common:architecture-review tests` to decide lane moves and cut stories, or a direct fix for a
handful of small findings.

## Rules

- **Read-only.** No agent edits a test, a source file, a config or a workflow. The run writes only
  the work directory and the report, and commits nothing.
- **Measured, not imagined.** A finding without a location and a count is dropped. "Slow" names
  its seconds; "flaky" names the commits or runs that show it.
- **A deletion names its replacement.** Recommending to delete a test without naming the test that
  keeps the coverage - or saying that nothing needs to - is not a finding.
- **A documented deviation is not a finding.**
