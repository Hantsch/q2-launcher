---
name: release-prep
description: Run everything before a release - every test lane, all e2e flows, other platforms, the perf lane, packaging and the release dry run - on a clean checkout under CI-like conditions, fastest first, and write a release-readiness report with a GO / NO-GO verdict. Invoked as /release-prep [<release branch>].
argument-hint: [<release branch>]  (default: the branch the release workflow runs on)
disable-model-invocation: true
---

<!-- tech-rules:managed 2.4.0 -->

# Release prep

The pull request lane proves the core on every merge and the release lane smoke-tests the
artifact - both stay small on purpose (the `test-gates` skill next to this one). This is the one
place where **everything** runs: every lane, every flow, every platform the project still tests,
the perf budgets and the packaging, on a clean checkout of what will be released, under the
conditions of the CI runner. Its output is a report and a verdict the user decides on.

Read `test-gates` first, completely - it defines the lanes, the runner conditions and what counts
as flaky.

**What this enforces: nothing, and it changes nothing in the repository.** It runs commands in a
throwaway worktree and writes one report. It does not fix a red test, edit a file, commit, tag,
push or publish.

## Phase 0 - plan

1. Read `CLAUDE.md` (the `## Test lanes` table and recorded deviations), `.claude/ai-scrum.md` if
   present (`## Verify` commands, `e2e-all`, `e2e-cleanup`, `e2e-quarantine`, `changelog-path`,
   `roadmap-path`, `doc-language`), the CI workflows, the scripts or test projects, and the runtime
   version file.
2. **The release branch:** `$1`; otherwise the branch the release workflow triggers on
   (`on.push.branches`); otherwise ask.
3. **The run list is everything the project can run**, not only what CI runs: every lane in the
   map (without one, the lanes by `test-gates`' default rule, and the proposed table goes into the
   report), plus every test command no lane names - a flows runner, a platform suite, packaging, a
   release dry run.
   - **Split wrapper commands into their parts and run each distinct command once**, crediting it
     to every lane that contains it: `npm run verify` = format + lint + typecheck + test + build,
     and the build then is not run three times. A filter of another command (`shot` and `a11y`
     when `verify:ui` runs both) is never a step of its own.
   - Each step is marked **blocking** (it belongs to `pr`, `release` or `release-prep` and is not
     quarantined or on a platform the map marks advisory) or **advisory** (perf, advisory
     platforms).
4. **Order: fastest and most fundamental first**, so a cheap failure arrives in minute one:
   format → lint → typecheck → PR lane tests → build → package → release smoke → release-prep tests
   → e2e flows → other platforms → perf → release dry run. A step whose input another step
   produces waits for it.
5. **Where it runs - a clean checkout by default.** A temporary worktree outside the repository:
   `git fetch`, `git worktree add --detach <dir> origin/<release branch>`, then
   `git -C <dir> merge --no-edit <HEAD sha>` - the merge result is what will be released, and a
   merge can break what both sides pass alone. A merge conflict means nothing runs: report it as
   the result. Then the project's clean install in the worktree (`npm ci`, `dotnet restore`) - it
   costs minutes, and it is what keeps a gitignored fixture or a stale build from passing here.
   The current working tree instead is an opt-out the user picks in the plan question, and the
   report says so in its verdict line.
6. **Conditions** - the runner's, as far as this machine can provide them. Environment variables
   do not survive between `Bash` calls, so every command is prefixed with them:
   - `CI=true`;
   - publish credentials removed (`env -u GH_TOKEN -u GITHUB_TOKEN -u CSC_LINK -u NPM_TOKEN ...`)
     and packaging told never to publish (electron-builder `--publish never`): with `CI` set,
     electron-builder otherwise uploads into a draft release whenever a token is present. A
     packaging command that cannot be told is skipped and named;
   - on Windows, `TEMP=<short> TMP=<short>`, `<short>` being the 8.3 name of a fresh directory
     whose name is longer than eight characters, the form hosted runners hand out
     (`C:\Users\RUNNER~1\...`):
     `powershell -NoProfile -Command "(New-Object -ComObject Scripting.FileSystemObject).GetFolder('<dir>').ShortPath"`.
     If the result equals the long path, the volume has no short names - the report says this
     condition could not be emulated;
   - the runtime version against the version file: a different major is a warning at the top of
     the report, and the plan question offers to stop so the user can switch first.
7. Show the plan in one block and ask once: the steps in order, each with its lane, blocking or
   advisory, and its last measured minutes (from the previous report; "no estimate" otherwise);
   the worktree or the opt-out; the conditions; and the report path -
   `<docs>/releases/<date>-release-prep.md`, `<docs>` being the folder of the profile's
   `roadmap-path`, without a profile `docs/releases/`.

## Phase 1 - run

Logs go into a work directory next to the worktree. Per step:

1. A status line before it: step, command, last minutes, log path.
2. The command once, in the worktree, with the condition prefix, its output into
   `<work>/<n>-<step>.log`:
   - **Short steps** (an estimate under eight minutes): one `Bash` call with `timeout: 600000`,
     `<prefix> <cmd> > <log> 2>&1; echo "exit=$?" >> <log>`.
   - **Long steps** (an estimate of eight minutes or more, and every e2e, flow or platform suite
     without an estimate): `run_in_background: true` from the start,
     `<prefix> <cmd> 2>&1 | tee <log>; echo "exit=${PIPESTATUS[0]}" >> <log>` - a bare pipe would
     report `tee`'s exit code. End the turn with exactly that one task in flight; its exit
     notification resumes the run. Never poll, never sleep.
   - **A short step the tool moves to the background at the ten-minute ceiling is still that one
     run** - wait for its notification the same way. Never launch it a second time: a second
     instance collides with the first.
   - A single-instance app (Electron) or a fixed port: run the profile's `e2e-cleanup`, or stop
     leftover instances, before each e2e step.
3. Read only the runner's summary - `tail -n 40` of the log, the `exit=` line, or the reporter's
   result file - never the whole log.
4. A status line after it: result and minutes. **A red step is reported at once and the run goes
   on** with every step that does not depend on it, so the report is complete; the user can stop
   whenever they like. A step that depends on a red one is recorded as `blocked by <step>`.
5. **A failing test is re-run once, alone** (only those tests, never the suite): red again →
   `red`; green → `flaky` - still a finding, never a pass. A test on the project's quarantine
   list that fails is `expected-fail`; one that passes is `unexpected-pass`.
6. **The perf lane** runs with a reporter that keeps console output - Vitest `--reporter=verbose`
   (inside an agent session the default reporter hides passing tests' output); .NET a console
   logger with detailed verbosity. Its `PERF-BUDGET ... over` lines are collected as warnings and
   never turn the verdict red.

Also check, without running anything long: the user-facing changelog (`changelog-path`, or a
`CHANGELOG.md` with an `## Unreleased` section) has entries for this release; nothing a step
wrote landed in the original working tree (`git status --short` there); the release dry run runs
only if the project documents it as writing nothing.

Finally remove the worktree (`git worktree remove --force <dir>`) and the work directory - after
copying what the report quotes.

## Phase 2 - the report

`<docs>/releases/<date>-release-prep.md`, in the profile's `doc-language` (default English):

1. **Verdict** - `GO`, `GO with warnings` or `NO-GO`, then the commit (or the merge it tested),
   the release branch, clean checkout or working tree, the conditions emulated, total minutes.
   - `NO-GO`: any **blocking** step that is red, and any test in a blocking step that stays red on
     its isolated re-run; a merge conflict; a red build, package or release dry run.
   - `GO with warnings`: flaky tests, perf overruns, an advisory step red, a lane over its budget,
     a runtime version mismatch, an expired quarantine entry, a condition that could not be
     emulated, a run on the working tree instead of a clean checkout.
   - `GO`: none of that.
2. **Steps** - `| Step | Command | Lanes | Blocking | Result | Minutes | Budget |`, in run order.
3. **Failures** - per red step its failing tests with `file:line`, the first error line, the
   verdict (`red` / `flaky`), and the class from `test-gates` (clock, zone, path, speed, order,
   artefact, runtime version) when the error shows one.
4. **Warnings** - perf overruns (`| Budget | Measured | Limit |`), lanes over budget, flaky tests,
   quarantine entries with their age, tests skipped for a missing dependency, the runtime version.
5. **Release checks** - merge, changelog, the original tree untouched, dry run.
6. **Next steps** - what to fix first, in order. A lane over its budget points to
   `/common:architecture-review tests`; flaky, brittle or pointless tests to `/test-review` - and
   so does a newest `*-test-review.md` older than the previous release, or none at all.

In the chat: the verdict line, the steps table, the three most important items and the report
path.

## Rules

- **Changes nothing in the repository.** No source, test, config or workflow edit, no commit, no
  tag, no push, no publish. A red test is reported, never fixed or weakened here.
- **Each step once.** The only re-run is the isolated re-run of failing tests that tells red from
  flaky. No re-run "to be sure", no second launch of a step the tool moved to the background, no
  second full run after a fix - after a fix, run the skill again.
- **The verdict follows the rules above**, not a judgment call: a red blocking step is `NO-GO`
  however small it looks.
