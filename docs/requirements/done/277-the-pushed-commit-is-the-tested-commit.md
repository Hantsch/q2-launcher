---
id: 277
title: verify:release checks exactly what a PR and a release check, cheap steps first
status: done
created: 2026-10-29
---

## Requirement

On 2026-10-29 the S36 PR went red on `fca1c8e` — the sprint review commit, made after the
regression gate and `verify:release`, which nothing had tested. The user's goal: after every
sprint the project is releasable, and opening a PR or starting a release does not fail.

The user decided that nothing runs by itself — no git hook, no watcher; the sprint process runs
the checks (`.claude/ai-scrum.md` `## Notes`: `verify:release` is the sprint's last step, after
`/roadmap check`). For that step to mean "the PR and the release will pass", `verify:release` has
to run every blocking check those run, fail within minutes on a cheap one, and say afterwards
which commit it verified.

Today it misses the `ci` audit step and the core-journey flows `windows-verify` blocks on, and it
reaches the format check only inside act, after about eight minutes.

## Acceptance Criteria

- [x] **AC1** — `npm run check` runs the format check, typecheck, lint and unit tests, in that
      order, and stops at the first failure.
- [x] **AC2** — `npm run verify:release` runs every blocking step of the PR workflows and the
      release job on Windows — the `ci` audit included, `windows-verify`'s `ui:verify` and every
      flow it runs. The list is read from the workflow files, so a blocking step added to a PR
      workflow and missing from `verify:release` fails a test.
- [x] **AC3** — `verify:release` runs `npm run check` before `ui:verify` and any packaging, and
      stops there on the first failure; a seeded format error fails it in under three minutes.
- [x] **AC4** — `verify:release` leaves a local, uncommitted record of the commit it verified,
      the `origin/main` it merged into and the result; `npm run verify:release -- --status` says
      whether the current `HEAD` is that verified commit and whether `origin/main` has moved
      since.
- [x] **AC5** — `CLAUDE.md` `## Test lanes` names `npm run check` and the `--status` call in the
      `release-prep` row.

## Open Questions

## Decisions (Sprint)

- Build after 276, 280 and 278 (sprint order): the drift test reads the workflow files as those stories leave them, so it needs no knowledge of their final shape.
- `npm run check` is a plain `&&` chain in `package.json`: `&&` already means "in order, stop at the first failure", a script would add nothing.
- `verify:release` does not execute `run:` blocks from the YAML (they carry `${{ }}` expressions and GitHub-only steps); it keeps its own step list, and a coverage table maps every blocking workflow `run` to a local step or to a stated reason it cannot run locally — the drift test reads the workflows and fails on an unmapped one.
- The `windows-verify` flow names are read from `ui-flows.yml` at run time, not copied: a flow added there runs locally without touching the script.
- "Blocking" for the drift test: every step of a job in a `pull_request`-triggered workflow or in `release.yml`, minus a job or step whose `continue-on-error` is literally `true`; a job-level `uses: ./.github/workflows/<x>.yml` (as 278 may add) counts with the called workflow's steps — this reads whatever shape 276/278 leave.
- The packaged launch smoke (`package:dir:smoke` + `ui:flow -- about-release-notes --app=…`) joins `verify:release`, because story 280 made it a blocking release step.
- `check` runs in the merge-tree snapshot right after `npm ci` and before the Electron binary install (unit tests use the electron stub); `npm ci` and `check` are gates, later steps keep the existing "run on, report all" behaviour so one run shows every later failure.
- AC3's "under three minutes" is proven by cost, not a clock (`/test-gates`): a test asserts that only `npm ci` precedes the `check` gate and that a failing `check` invokes no later step; no wall-clock assertion in the unit lane.
- The record is `/.verify-release/last-run.json`, git-ignored before the first write so the record never dirties the tree the next run snapshots.
- `--status` counts HEAD as verified when `HEAD^{tree}` equals the recorded verified tree, so "verified with uncommitted changes, then committed exactly those" reads as verified — the PR runs on the tree, not the sha.
- `--status` fetches `origin` (otherwise it cannot know whether `origin/main` moved); exit 0 = green record, HEAD verified, `origin/main` unchanged; 1 = any of those false or the fetch failed; 2 = no record — so the sprint-end step reads it by exit code.
- `.claude/ai-scrum.md` `## Notes` sprint-end steps get `npm run check` first and `--status` as the proof under the verdict line, because the sprint notes put 277's process change there, not in the plugin-managed commands.
- AC5 gets no new prose assertion: story 279 takes doc-shape tests out of the blocking lane, and the existing lane-map rule ("every workflow and npm script the lane map names exists") already proves the `check` script the row names exists.
- No `CHANGELOG.md` entry and no `docs/systems/` doc: a local release gate changes nothing a user sees, and no systems doc describes `verify:release`.

## Plan

Builds after 276 (act/Linux phase gone from `verify-release.mjs`), 280 (packaged smoke blocking)
and 278 (`release.yml` dispatch-only with its own checks).

1. **D1** `package.json`: `check` = `format:check && typecheck && lint && test`.
2. **D2** Split `scripts/verify-release.mjs`: ordered step plan + coverage table move into a pure
   `scripts/lib/verify-release-plan.mjs`; the script keeps the I/O (snapshot, merge tree, spawn,
   summary). New host order: `npm ci` (gate) → `check` (gate) → audit → release plan → Electron
   binary → `fetch:7za` → `build:dev` → `ui:verify` → every `windows-verify` flow (read from
   `ui-flows.yml`) → `package:dir:smoke` + packaged smoke → `release.mjs --dry-run`. Drift test
   reads every blocking workflow `run` and fails on one the table does not map.
3. **D3** Record + `--status`: written at the end of every run that computed the merge tree;
   `--status` compares HEAD's tree and `origin/main` against it.
4. **D4** `CLAUDE.md` release-prep row and `.claude/ai-scrum.md` `## Notes` sprint-end steps.

Order D1 → D2 → D3 → D4 (D2 runs `check`, D3 sits on D2's split, D4 documents both).

## Deliverables

- **D1 — `npm run check` runs the cheap checks in order.** Files: `package.json`,
  `scripts/verify-release.test.mjs` (new).
  - Add `"check": "npm run format:check && npm run typecheck && npm run lint && npm test"` (all
    four scripts exist, unchanged).
  - Test › "npm run check runs format, typecheck, lint and tests in that order and stops at the
    first failure": read `package.json`, split `scripts.check` on `&&`, expect exactly
    `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test` in that order, and no
    `;` or `||` (which would not stop).

- **D2 — `verify:release` runs every blocking PR/release step, `check` first, and a test fails on
  drift.** Files: `scripts/lib/verify-release-plan.mjs` (new, pure: no spawn, no fs),
  `scripts/lib/workflow-yaml.mjs` (new), `scripts/verify-release.mjs`,
  `scripts/workflows.test.mjs` (import only), `scripts/verify-release.test.mjs`. Mirror the
  pure/I-O split of `scripts/lib/rehearsal.mjs` + `scripts/rehearse.mjs`. `loadYaml`,
  `loadWorkflows`, `allSteps` move from `scripts/workflows.test.mjs` into
  `scripts/lib/workflow-yaml.mjs` and both test files import them — no copy.
  - `hostSteps(ctx)` returns the ordered `[{ label, gate, kind }]` (`kind` = what
    `verify-release.mjs` executes): `npm ci` (gate), `npm run check` (gate),
    `npm audit --audit-level=high`, release plan (`release.mjs --print-plan`, existing code),
    Electron binary (`node_modules/electron/install.js`, existing), `npm run fetch:7za`,
    `npm run build:dev`, `npm run ui:verify`, one step per `windows-verify` flow,
    `npm run package:dir:smoke` (env `CSC_IDENTITY_AUTO_DISCOVERY=false`), packaged smoke
    `npm run ui:flow -- about-release-notes --app="<snapshot>/release/smoke/win-unpacked/Q2 Launcher.exe"`,
    `release.mjs --dry-run --version <planned>` (existing). `runPhase` moves into the plan module
    with its semantics: a failed gate skips the rest; other failures run on and are reported.
  - `windowsVerifyFlows(uiFlowsDoc)`: the names of `ui-flows.yml` › `windows-verify` steps whose
    `run` is `npm run ui:flow -- <name>` (no further args). `verify-release.mjs` loads the
    snapshot's `ui-flows.yml` with `js-yaml` and passes the doc in.
  - `COVERAGE`: entries `{ match: RegExp, step: '<hostSteps label>' }` or
    `{ match: RegExp, local: false, reason: '<one sentence>' }`. Blocking runs with no local
    equivalent (the publishing `release.mjs` call, git identity, ci guard / sha refusal,
    `$GITHUB_OUTPUT` path resolution, fast-forward dev, …) get `local: false` + reason. Every
    regex is anchored (`^…$`) to one command shape — no catch-all.
  - `blockingRuns(workflows)`: every `run` of every step in jobs of workflows with a
    `pull_request` trigger, plus every job of `release.yml`; drops jobs/steps whose
    `continue-on-error` is literally `true`; a job-level `uses: ./.github/workflows/<x>.yml`
    contributes `<x>`'s jobs. `uncovered(runs, coverage)` returns runs matched by no entry.
  - `verify-release.mjs` keeps snapshot, merge tree, `runnerEnv()`, summary; executes
    `hostSteps`; header comment rewritten to the new order.
  - Tests in `scripts/verify-release.test.mjs`: "every blocking step of the PR workflows and the
    release job has a local step or a stated reason" (real `.github/workflows`: `uncovered` empty,
    every `step` label exists in `hostSteps`); "a blocking step added to a PR workflow and missing
    from verify:release is reported" (synthetic workflow with an extra
    `npm run brand-new-gate` step → `uncovered` names it); "verify:release runs every flow
    windows-verify runs" (real `ui-flows.yml`); "check runs right after npm ci and before
    ui:verify and any packaging, and gates the rest" (index order, `gate: true` on both, only
    `npm ci` before `check`); "a failing check runs no later step" (`runPhase` with a stub runner
    failing on `check`: two invocations, the rest `skipped`). No wall-clock assertion.

- **D3 — `verify:release` leaves a record and `--status` reads it.** Files:
  `scripts/lib/verify-release-record.mjs` (new, pure), `scripts/verify-release.mjs`,
  `scripts/verify-release.test.mjs`, `.gitignore`.
  - `.gitignore`: `/.verify-release/` with a one-line comment — it must be ignored, or the record
    dirties the tree the next run snapshots (`git add -A`).
  - Record `/.verify-release/last-run.json` (path overridable by env `VERIFY_RELEASE_RECORD`),
    written once the merge tree was computed, green or red:
    `{ headSha, verifiedTree, includedUncommitted, base, baseSha, result: 'green'|'red', failed: [labels], finishedAt }`.
  - `statusVerdict(record, { headTree, headSha, baseSha, fetchFailed })` → `{ exitCode, lines }`:
    0 when `result` is green, `headTree === verifiedTree` and `baseSha` unchanged; otherwise 1 with
    one line per reason (red result, HEAD's tree differs, `origin/main` moved from X to Y, fetch
    failed so `origin/main` is unknown).
  - `npm run verify:release -- --status`: reads the record (missing → exit 2, "no verify:release
    record"), `git fetch --quiet origin`, `git rev-parse HEAD`, `HEAD^{tree}`, `origin/main`,
    prints the verdict lines (verified sha, base sha, result) and exits with its code. Runs
    nothing else.
  - Tests: "the status is verified only for a green record of the current tree on an unchanged
    origin/main" (table: green/red × tree equal/different × base equal/moved × fetch failed); "a
    run that verified uncommitted changes counts as verified once exactly those are committed"
    (equal tree, different `headSha` → 0); "--status without a record says so and exits 2" (spawn
    `node scripts/verify-release.mjs --status` with `VERIFY_RELEASE_RECORD` at a missing temp
    path; exits before any fetch).

- **D4 — The lane map and the sprint end name the cheap check and the status call.** Files:
  `CLAUDE.md`, `.claude/ai-scrum.md`.
  - `CLAUDE.md` `## Test lanes`, `release-prep` row, Command cell: `npm run check`, then
    `npm run verify:release`, then `npm run verify:release -- --status`. Keep column and row
    count.
  - `.claude/ai-scrum.md` `## Notes`, sprint-end list: step 2 runs `npm run check` before
    `release-verify` so a cheap failure is fixed first; step 4 — after the green run
    `npm run verify:release -- --status` must exit 0, and its output goes under the
    `releasable: yes` line. Touch nothing else in that file.

## Model Hints

- D2 → deliverable-hard: it restructures a 460-line script that no test runs into a pure plan plus
  I/O while changing step order and gates, and the coverage semantics (blocking filter,
  reusable-workflow `uses:`, anchored matches) decide whether the drift test can ever go red — a
  too-broad match silently covers every future step.
- Review: → default

## Acceptance Tests

- AC1 → unit `scripts/verify-release.test.mjs` › "npm run check runs format, typecheck, lint and
  tests in that order and stops at the first failure"
- AC2 → unit `scripts/verify-release.test.mjs` › "every blocking step of the PR workflows and the
  release job has a local step or a stated reason", › "a blocking step added to a PR workflow and
  missing from verify:release is reported", › "verify:release runs every flow windows-verify runs"
- AC3 → unit `scripts/verify-release.test.mjs` › "check runs right after npm ci and before
  ui:verify and any packaging, and gates the rest", › "a failing check runs no later step" (the
  three-minute bound proven by cost: only `npm ci` precedes the gate)
- AC4 → unit `scripts/verify-release.test.mjs` › "the status is verified only for a green record of
  the current tree on an unchanged origin/main", › "a run that verified uncommitted changes counts
  as verified once exactly those are committed", › "--status without a record says so and exits 2"
- AC5 → existing lane-map rule › "every workflow and npm script the lane map names exists"
  (`scripts/workflows.test.mjs`, or wherever story 279 moves it under `npm run check:docs`) —
  proves the scripts the row names exist; no new prose assertion (see Decisions).

## Done

**Summary.** `npm run check` (format, typecheck, lint, tests; `&&` chain). `verify:release` split into a pure plan (`scripts/lib/verify-release-plan.mjs`: ordered steps, gates, coverage table, blocking-run reader) and I/O; new order npm ci (gate), check (gate), audit, release plan, Electron, 7za, build, ui:verify, every windows-verify flow, packaged smoke, dry run. A drift test fails on a blocking workflow run no local step or stated reason covers. Record in `.verify-release/last-run.json` plus `-- --status` (exit 0/1/2). Lane map and sprint-end notes updated.

**Commit message:** `277: verify:release runs every blocking PR/release step, check first, leaves a record, --status`

**Verification (narrow gate).** typecheck, lint, prettier on changed files, `npx vitest run --changed HEAD` (633 files, 7654 tests), `npm run check:docs` (69 tests) all green; no e2e criteria. Review: stage 1 default, PASS with gaps, one fix cycle (extra blockingRuns/anchoring tests, `--status` uses `record.base`, corrupt record exits 2), re-verified green. AC1-AC4 -> the named tests in `scripts/verify-release.test.mjs`, all passed; AC5 -> lane-map rule in `scripts/project-docs.docs.test.mjs` (docs lane), passed. No manual residue. `verify:release` itself not run (phase-4 gate).

**Decisions.**
- `verifiedTree` is the tree of the verified working-tree snapshot before merging `origin/main`, so committing exactly the verified changes reads as verified.
- `src/architecture.test.ts` lint assertion moved to `package.json` check script + plan module (stale after the split).
- Windows-only `IS_WIN` guard on the release phase dropped (supported host is Windows; spec lists the dry run unconditionally).
- Step-level composite actions (`setup-node-electron`) are not expanded by the drift test; multi-line release scripts are matched by first/main/last line (known narrow spot).
- Run record is not written when checkout/merge-tree fails before the tree exists.
- `.gitignore` kept LF (repo-hygiene test).

tiers: D 4 / hard 1 · review default · cycles 1 · agents 8
