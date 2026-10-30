---
id: 276
title: Linux checks leave the PR and release path and are never red
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

Linux is not a supported platform: it is an additional target, qualified by hand. The user decided
on 2026-10-29:

- Linux checks leave every PR and release workflow; they never block a PR or a release.
- A Linux check is never red — at most yellow (a warning).
- Linux checks run locally after a sprint, and sprints still take Linux into account: the result
  is part of the sprint review, its findings become TECH-DEBT rows or follow-ups.
- `verify:release` stops running Linux workflows under act (the open question of the first draft).

Today the `ubuntu-latest` leg of `ci.yml` `test`, the `linux-journey` job, the Linux shards of
`ui-flows.yml`, `linux-verify.yml` and `linux-update.yml` trigger on push/PR (advisory, but shown
red), `verify:release` runs ~11 of its ~17 minutes as Linux workflows under act and treats them as
blocking, and a failed `build-linux` refuses the whole release.

The `linux-user-journey` flow that `windows-verify` runs on Windows is a Windows check and stays.
The release `plan` job runs on an Ubuntu runner but checks nothing about Linux; it stays.

## Acceptance Criteria

- [ ] **AC1** — No workflow triggered by `push` or `pull_request` runs a Linux check: `ci.yml`
      `test` runs on `windows-latest` only (the audit and the format check move to that leg),
      and `linux-journey`, the Linux `ui-flows` shards, `linux-verify.yml` and `linux-update.yml`
      run only on `workflow_dispatch`.
- [ ] **AC2** — A failing Linux check on a manual GitHub run ends with a green job and a
      `::warning::` annotation naming what failed — never a red job.
- [ ] **AC3** — `npm run verify:linux` runs every Linux check locally (act + Docker): the Linux
      unit tests, the Linux journey flows, `linux-verify`, `linux-update`, the Linux flow shards
      and the AppImage build. It prints a failure as a warning and exits 0; it exits non-zero only
      when it could not run (no act, no Docker).
- [ ] **AC4** — `npm run verify:release` runs no Linux workflow and no act step.
- [ ] **AC5** — A failing `build-linux` does not stop a release: the release publishes the
      Windows assets, the run ends green with a warning naming the missing AppImage, and
      `release.mjs` accepts a release without Linux assets.
- [ ] **AC6** — After the regression gate, `/sprint` runs `npm run verify:linux` once and the
      review records it as advisory (green / yellow with the failing checks); a Linux finding
      becomes a TECH-DEBT row or a follow-up, never a gate fix or a merge blocker. It has
      finished before `verify:release` starts (no two Docker/Electron runs at once). Recorded in
      `.claude/ai-scrum.md` `## Notes` (`sprint.md` is plugin-managed).
- [ ] **AC7** — `CLAUDE.md` `## Test lanes`: the `linux` row reads local, after the sprint gate,
      `npm run verify:linux`, advisory; the `pr-unit`, `pr-ui` and `release` rows and the text
      below the table mention no Linux job.
- [ ] **AC8** — `scripts/workflows.test.mjs` fails when a `push` or `pull_request` workflow gets
      a Linux job or an `ubuntu-latest` test leg back, or when a manual Linux job can end red.

## Open Questions

## Decisions (Sprint)

- **Linux jobs move into one new dispatch-only `.github/workflows/linux.yml`** (`unit`, `journey`,
  `flows`) instead of `if:`-gating them inside `ci.yml`/`ui-flows.yml` — AC8's rule "a push/PR
  workflow has no Linux job" is then a plain file-level check.
- **"Never red" is step-level, not job-level:** every step of a Linux job carries
  `continue-on-error: ${{ github.actor != 'nektos/act' }}`, later steps skip via
  `!contains(steps.*.outcome, 'failure')`, and a last `if: always()` step prints one `::warning::`
  per failed step — job-level `continue-on-error` leaves the job itself red, which AC2 forbids.
- **Job-level `timeout-minutes` on Linux jobs becomes step-level** — a timed-out job is red.
- **Under act the Linux steps stay strict** (the existing `nektos/act` convention), so
  `verify:linux` gets a real exit code per run and turns it into a warning itself.
- **The Linux unit job runs `fetch:7za` + `npm test` only** — audit, format, typecheck and lint
  are OS-independent and run on the Windows leg.
- **`release.mjs` publishes Linux assets only as a complete set:** none or a partial set (or a
  missing `RELEASE_EXTRA_ASSETS_DIR` directory) stages nothing, collects `'win'` and prints a
  `::warning::` naming the missing files — a half Linux set would break Linux auto-update.
- **The `latest.yml` collision refusal and the Windows asset check stay hard** — they guard every
  installed Windows client, not Linux.
- **`verify:linux` runs on a snapshot of the working tree** (as `git add -A` would commit it), not
  on the merge with `origin/main` — its verdict is advisory per sprint, not per PR merge.
- **`verify:linux` builds the AppImage at the planned release version**; when the plan refuses
  (e.g. empty `## Unreleased`) that check is a warning "skipped: <reason>", never an exit 1.
- **The snapshot code is extracted to `scripts/lib/snapshot.mjs`** — `verify:release` and
  `verify:linux` would otherwise hold two copies of the throwaway-index checkout.
- **`ci:local`, `ci:local:verify`, `ci:local:update`, `ci:local:flows`, `ci:local:all` are
  removed** — `verify:linux` is the one entry point; the old ones ran from the working tree
  (copying `node_modules`) and two of them target moved or Windows-only jobs.
- **`npm run rehearse` runs `verify:release`; `--linux` runs `verify:linux` before it**, and the
  shard parser and 15-minute shard margin go — a Linux shard can no longer make anything red, and
  the 20-min job timeout that margin guarded is gone.
- **`verify:release` on a non-Windows host also drops its `package:linux` step** — AC4 is "no
  Linux check", and the release dry run now takes D2's Windows-only path.
- **The release lane row names no AppImage/build-linux; the `linux` row says the release's
  AppImage build is best-effort** — AC7 keeps Linux jobs out of the PR/release rows.
- **AC6/AC7 are proven in the lane-map `describe` of `scripts/workflows.test.mjs`** — the existing
  home of lane-map rules, which story 279 moves to `check:docs` as a whole.
- **No CHANGELOG entry** — CI and local tooling only, nothing a user sees.

## Plan

Build order D1 → D5; every D is scripts/CI/docs only (no app code). Stories 278/280/277/279 build
on the result (278/280 edit `release.yml`, 277 restructures `verify-release.mjs`, 279 moves the
lane-map doc tests) — keep each change narrow so they rebase cleanly.

1. **D1 — PR path loses Linux, Linux jobs can't go red.** New dispatch-only `linux.yml`
   (`unit`/`journey`/`flows`) takes the ubuntu leg of `ci.yml` `test`, `ci.yml` `linux-journey` and
   `ui-flows.yml` `ui-flows`; `linux-verify.yml`/`linux-update.yml` drop push/PR triggers; every
   Linux job gets the advisory step pattern + a `scripts/linux-advisory.mjs` warning step.
2. **D2 — release survives a failed `build-linux`.** `build-linux` gets the D1 pattern, the
   release job runs whatever `build-linux` did, `release.mjs` publishes Windows-only with a
   warning when the Linux set is missing or incomplete.
3. **D3 — `npm run verify:linux`.** act runs every Linux job + the AppImage build on a working-tree
   snapshot; failures print as warnings, exit 0; exit 1 only without act/Docker. Snapshot code
   extracted to `scripts/lib/snapshot.mjs`.
4. **D4 — `verify:release` and `rehearse` lose act.** No act/Docker preflight, no Linux phase,
   no build-linux rehearsal, release dry run Windows-only; `rehearse --linux` → `verify:linux`.
5. **D5 — process + docs.** `CLAUDE.md` lane map, `.claude/ai-scrum.md` Notes (verify:linux after
   the regression gate, advisory, before verify:release), `CONTRIBUTING.md`,
   `docs/UI-VERIFICATION.md`, remove the `ci:local*` scripts.

Affected: `.github/workflows/{ci,ui-flows,linux,linux-verify,linux-update,release}.yml`,
`scripts/{linux-advisory,verify-linux,verify-release,rehearse,release}.mjs`,
`scripts/lib/{snapshot,verify-linux,rehearsal}.mjs`, their tests, `scripts/workflows.test.mjs`,
`package.json`, `CLAUDE.md`, `.claude/ai-scrum.md`, `CONTRIBUTING.md`, `docs/UI-VERIFICATION.md`.
No `docs/systems/` doc covers CI/release tooling.

## Deliverables

- [ ] **D1 — No push/PR workflow runs a Linux job; a manual Linux job ends green with warnings.**
  Files: `.github/workflows/ci.yml`, `.github/workflows/ui-flows.yml`, `.github/workflows/linux.yml`
  (new), `.github/workflows/linux-verify.yml`, `.github/workflows/linux-update.yml`,
  `scripts/linux-advisory.mjs` (new), `scripts/linux-advisory.test.mjs` (new),
  `scripts/workflows.test.mjs`.
  - `ci.yml` `test`: `runs-on: windows-latest`, no matrix; Audit and Format check lose their
    `if:` (run on Windows); drop the ubuntu-only `fetch:7za` step; leave the triggers alone
    (story 278 changes them). Remove the `linux-journey` job.
  - `ui-flows.yml`: remove the `ui-flows` job; keep `windows-verify` and the triggers; fix the
    header comment.
  - New `linux.yml`, `on: workflow_dispatch` only, three ubuntu jobs: `unit` (setup-node-electron
    with `electron: 'false'`, `npm run fetch:7za`, `npm test`), `journey` (the three flow steps of
    the old `linux-journey` job with its xvfb/libs/build steps), `flows` (the old `ui-flows`
    6-shard matrix, `fail-fast: false`). Move job comments along, shortened.
  - `linux-verify.yml`, `linux-update.yml`: `on: workflow_dispatch` only (drop `push`,
    `pull_request` and their `paths`); fix the header comments that justify PR/push triggers.
  - **Advisory pattern, every Linux job in these three files:** no job-level `continue-on-error`
    and no job-level `timeout-minutes` (move a timeout onto the long step); every step has an `id`
    and `continue-on-error: ${{ github.actor != 'nektos/act' }}`; every step after the first has
    `if: ${{ !contains(steps.*.outcome, 'failure') }}` (an `if:` without a status function implies
    `success()`, which a continue-on-error failure leaves true — the `contains` does the skip); an
    upload that was `if: failure()` becomes
    `if: ${{ always() && contains(steps.*.outcome, 'failure') }}`; the LAST step is `if: always()`,
    `continue-on-error: true`, `env: { STEPS: ${{ toJSON(steps) }}, CHECK: <file>/<job> }`,
    `run: node scripts/linux-advisory.mjs`.
  - `scripts/linux-advisory.mjs`: exports a pure `advisoryLines(check, stepsJson)` returning one
    `::warning::Linux check <check> failed: <step id>` line per step whose `outcome` is `failure`
    (none when all passed); the CLI prints them from `STEPS`/`CHECK` and always exits 0. Test
    `scripts/linux-advisory.test.mjs` › "every failed step is named in a warning and a clean run
    prints nothing".
  - `scripts/workflows.test.mjs`: replace `describe('Linux jobs are advisory on GitHub')`; move the
    `ui-flows` shard test to `linux.yml` (dispatch only, 6 shards). A job is a Linux job when its
    `runs-on` (or a `matrix.os` value it resolves to) contains `ubuntu`; `release.yml` `plan` is
    allowlisted ("checks nothing about Linux") and `release.yml` itself is covered by D2's test
    (one-line comment: excepted until story 278 makes it dispatch-only). New tests: "no push or
    pull-request workflow runs a Linux job" (every job of a workflow whose `on` has `push` or
    `pull_request` runs on Windows), "a manual Linux job cannot end red" (the advisory pattern
    above, checked per Linux job: step ids, step `continue-on-error`, no job-level
    `continue-on-error`/`timeout-minutes`, last step runs `linux-advisory.mjs` with
    `if: always()`), "the ci test job runs audit, format check, typecheck, lint and tests on
    windows-latest". Keep `windows-verify` pinned as blocking.
  - Accept: `npm test` green; if act is installed,
    `act workflow_dispatch -W .github/workflows/linux.yml -n` lists `unit`, `journey`, `flows`
    without an expression error.

- [ ] **D2 — A failed `build-linux` does not stop a release.**
  Files: `.github/workflows/release.yml`, `scripts/release.mjs`, `scripts/release.test.mjs`,
  `scripts/workflows.test.mjs` (`describe('release workflow')`).
  - `release.yml` `build-linux`: the advisory step pattern — every step an `id` and
    `continue-on-error: ${{ github.actor != 'nektos/act' }}`, later steps
    `if: ${{ !contains(steps.*.outcome, 'failure') }}`, last step `if: always()`,
    `continue-on-error: true`,
    `env: { STEPS: ${{ toJSON(steps) }}, CHECK: release.yml/build-linux }`,
    `run: node scripts/linux-advisory.mjs` (exists since D1; prints one `::warning::` per failed
    step). Upload: `if-no-files-found: warn`. Do not touch `plan`, the triggers or the packaged
    smoke (stories 278/280).
  - `release` job: keep `needs: [plan, build-linux]`, add
    `if: ${{ !cancelled() && needs.plan.result == 'success' }}`; the "Download the Linux
    artifacts" step gets `continue-on-error: true`.
  - `scripts/release.mjs` (`stageExtraAssetsFrom`, `buildAndCollectAssets`): a set-but-missing
    `RELEASE_EXTRA_ASSETS_DIR`, an empty one, or one lacking any file of
    `expectedAssets(version, 'linux')` (`scripts/lib/release/artifacts.mjs`) stages NO Linux file,
    collects `'win'`, and logs `::warning::release <version> has no Linux assets: missing <file>,
    <file>` (the AppImage named). A complete Linux set is staged and collected with `'all'` as
    today. The `latest.yml` collision refusal and the Windows asset refusal stay. Update the doc
    comments that say a missing Linux file refuses the release (and any `ci:local` mention).
  - Tests in `scripts/release.test.mjs` (the `describe('runRelease - one run publishes both
    platforms')` area, reuse its `deps` builder; `stageExtraAssetsFrom` against real temp dirs):
    "a release without Linux assets publishes the Windows set and warns naming the AppImage", "an
    incomplete Linux set is not published and is named in the warning"; a missing Windows file
    still refuses. Replace the existing test that expects a throw for a non-directory source.
  - `scripts/workflows.test.mjs`: "build-linux cannot end red and the release runs after it
    fails" (the pattern on `build-linux`; the `release` job's `if` has `!cancelled()` and
    `needs.plan.result`; the download step has `continue-on-error: true`); narrow "the release
    pipeline stays blocking" so only those steps (and the packaged smoke as it is today) are exempt.

- [ ] **D3 — `npm run verify:linux` runs every Linux check locally and only warns.**
  Files: `scripts/verify-linux.mjs` (new CLI), `scripts/lib/verify-linux.mjs` (new, pure),
  `scripts/verify-linux.test.mjs` (new), `scripts/lib/snapshot.mjs` (new),
  `scripts/verify-release.mjs` (only: import from `lib/snapshot.mjs`), `package.json`
  (`"verify:linux": "node scripts/verify-linux.mjs"`).
  - `scripts/lib/snapshot.mjs`: lift from `verify-release.mjs` the working-tree snapshot
    (`read-tree HEAD` + `add -A` into a throwaway `GIT_INDEX_FILE`, `write-tree`, `commit-tree`
    when it differs from HEAD's tree) and `checkoutTree(tree, dir, gitConfig, indexFile)`;
    `verify-release.mjs` imports them, behaviour unchanged.
  - `scripts/lib/verify-linux.mjs` (pure, no spawn/fs): `linuxRuns(workflows)` → `{ workflow,
    job }[]` = every job running on `ubuntu` in a workflow whose `on` is `workflow_dispatch` only,
    except `release.yml` (its `build-linux` becomes the `appimage` run, its `plan` never runs);
    `preflight({ act, docker })` → error text or null; `verdict(results)` → `{ lines, exitCode }`:
    all passed → `verify:linux: GREEN`, any failed/skipped → `verify:linux: YELLOW` plus one
    `warning: <workflow> <job>: <reason>` line each; `exitCode` 0 either way.
  - `scripts/verify-linux.mjs`: `resolveAct`/`dockerRunning`/`removeStaleActContainers` from
    `scripts/lib/act.mjs` (missing act/Docker → print how to fix, exit 1 before anything runs);
    snapshot the working tree into `tmpdir()/q2-launcher-verify-linux/linux` with
    `core.autocrlf=false` (warn when it includes uncommitted changes); per run, from the snapshot:
    `act workflow_dispatch -W .github/workflows/<file> -j <job> --concurrent-jobs 1
    --artifact-server-path <dir> --container-options "--privileged --shm-size=2g"`. The `appimage`
    run writes `buildLinuxWorkflowText(release.yml, plannedVersion, sha)`
    (`scripts/lib/build-linux-workflow.mjs`) into the snapshot exactly as `verify-release.mjs`'s
    `writeBuildLinuxWorkflow` does, with the version from `node scripts/release.mjs --print-plan`
    run in the snapshot with `GIT_DIR` = the repo's `.git`; a refused plan makes that run
    `skipped: <reason>`. A non-zero act exit → failed. Print the verdict lines, exit with
    `verdict().exitCode`. Header comment: what it runs, that it is advisory, ~40 min, run after
    the sprint's regression gate and never concurrently with `verify:release`.
  - Tests `scripts/verify-linux.test.mjs` (real workflow files via `js-yaml`): "verify:linux runs
    every Linux job of the workflows and the AppImage build" (the set equals `linux.yml`
    unit/journey/flows, `linux-verify.yml` verify, `linux-update.yml` update, appimage), "a failed
    or skipped Linux check is a warning and exits 0", "missing act or Docker is the only non-zero
    exit".

- [ ] **D4 — `verify:release` and `rehearse` run no act step.**
  Files: `scripts/verify-release.mjs`, `scripts/verify-release.test.mjs` (new),
  `scripts/lib/rehearsal.mjs`, `scripts/rehearse.mjs`, `scripts/rehearsal.test.mjs`.
  - `scripts/verify-release.mjs`: remove the act/Docker preflight, the `LINUX_DIR` checkout, the
    `linux` phase (ci.yml, linux-verify.yml, linux-update.yml, build-linux rehearsal),
    `writeBuildLinuxWorkflow`, `extractLinuxAssets`, the non-Windows `package:linux` host step, the
    `ARTIFACT_DIR`/`RELEASE_ARTIFACT_DIR`/`LINUX_ASSETS_DIR`/`SHM` constants and the imports of
    `./lib/act.mjs` and `./lib/build-linux-workflow.mjs`. The release dry run runs without
    `RELEASE_EXTRA_ASSETS_DIR` and without the `existsSync(LINUX_ASSETS_DIR)` condition
    (`release.mjs` then publishes Windows-only with a warning). Rewrite the header comment: host
    phase + release dry run only; Linux is `npm run verify:linux`.
  - `scripts/verify-release.test.mjs` › "verify:release starts no act run and needs no Docker": its
    source imports neither `./lib/act.mjs` nor `./lib/build-linux-workflow.mjs` and names no
    `.github/workflows/` file.
  - `scripts/lib/rehearsal.mjs` / `scripts/rehearse.mjs`: commands = `verify:release`; `--linux`
    runs `verify:linux` first, then `verify:release` (never concurrently). Remove `ci:local`,
    `ci:local:flows`, the shard parser, `MARGIN_SECONDS`/`marginOk` and the shard handling in
    `statusView`/`finalStatus`; the skip line names `verify:linux`. Update header comments; adjust
    `scripts/rehearsal.test.mjs` (drop the shard/margin tests; the opt-in tests name
    `verify:linux`).

- [ ] **D5 — The lane map, the sprint end and the docs describe the Linux lane.**
  Files: `CLAUDE.md`, `.claude/ai-scrum.md`, `CONTRIBUTING.md`, `docs/UI-VERIFICATION.md`,
  `package.json`, `scripts/workflows.test.mjs` (`describe('lane map in CLAUDE.md')`),
  `scripts/linux-update-e2e.mjs` (comment only).
  - `CLAUDE.md` `## Test lanes`: `pr-unit` command "format, typecheck, lint, unit tests, audit",
    OS Windows, Blocks "Yes"; `pr-ui` OS Windows, Blocks "Yes for `windows-verify`"; `release`
    names no Linux job or AppImage, OS Windows (leave its `plan`/`ci-guard` wording to story
    278); `linux` row: Trigger "local, after the sprint's regression gate", Command
    `npm run verify:linux`, OS "Linux (act, Docker)", Blocks "No — advisory: green or yellow,
    never red; the release's AppImage build is best-effort". Replace the paragraph below the
    table: Linux is an additional target, its checks run locally (`npm run verify:linux`) and on
    manual dispatch only, never red, never gating; the maintainer owns that policy — no Linux job
    names in it.
  - `.claude/ai-scrum.md` `## Notes`, the sprint-end list: a step before the roadmap check — after
    the regression gate, `npm run verify:linux` once (one background `Bash`,
    `2>&1 | tee <sprints>/$1/gate-verify-linux.log`), finished before `verify:release` starts; the
    review records it as advisory (green / yellow with the failing checks); a Linux finding becomes
    a TECH-DEBT row or a follow-up, never a gate fix or a merge blocker. Fix the `release-verify`
    comment ("Needs Docker until story 276" → needs no Docker).
  - `CONTRIBUTING.md` (the verify:release phase table, the `ci:local*` table, the rehearse text)
    and `docs/UI-VERIFICATION.md` (the `ci:local:flows`/rehearse paragraph) → `verify:linux`.
  - `package.json`: remove `ci:local`, `ci:local:verify`, `ci:local:flows`, `ci:local:update`,
    `ci:local:all`; `scripts/linux-update-e2e.mjs`: fix its `ci:local` comment.
  - Tests in the lane-map describe of `scripts/workflows.test.mjs`: "the linux lane runs
    verify:linux locally and blocks nothing, and no PR or release lane names a Linux job" (linux
    row: trigger contains `local`, command `npm run verify:linux`, Blocks starts with `No`;
    `pr-unit`/`pr-ui`/`release` rows match none of `/ubuntu|linux-|AppImage|Linux/`; the text below
    the table names none of `linux-journey`, `linux-verify`, `linux-update`, `ui-flows`,
    `build-linux`, `linux.yml`), "the sprint end runs verify:linux before verify:release and
    records it as advisory" (`.claude/ai-scrum.md` `## Notes`: `npm run verify:linux` appears
    before `verify:release` in the sprint-end paragraph, together with `advisory` and
    `TECH-DEBT`). The existing "every workflow and npm script the lane map names exists" stays
    green.

## Model Hints

- D1 → deliverable-hard: "never red" rests on GitHub/act expression semantics no unit test runs —
  step `outcome` vs `conclusion` under `continue-on-error`, the implicit `success()` in an `if:`,
  `steps.*.outcome` object filters under act, a job-level timeout turning a job red — while jobs
  move across five workflow files at once.
- Review: → default

## Acceptance Tests

- AC1 → unit `scripts/workflows.test.mjs` › "no push or pull-request workflow runs a Linux job"
  and › "the ci test job runs audit, format check, typecheck, lint and tests on windows-latest" (D1)
- AC2 → unit `scripts/workflows.test.mjs` › "a manual Linux job cannot end red" and
  `scripts/linux-advisory.test.mjs` › "every failed step is named in a warning and a clean run
  prints nothing" (D1)
- AC3 → unit `scripts/verify-linux.test.mjs` › "verify:linux runs every Linux job of the workflows
  and the AppImage build", › "a failed or skipped Linux check is a warning and exits 0",
  › "missing act or Docker is the only non-zero exit" (D3)
- AC4 → unit `scripts/verify-release.test.mjs` › "verify:release starts no act run and needs no
  Docker" (D4)
- AC5 → unit `scripts/release.test.mjs` › "a release without Linux assets publishes the Windows set
  and warns naming the AppImage", › "an incomplete Linux set is not published and is named in the
  warning"; `scripts/workflows.test.mjs` › "build-linux cannot end red and the release runs after
  it fails" (D2)
- AC6 → unit `scripts/workflows.test.mjs` › "the sprint end runs verify:linux before verify:release
  and records it as advisory" (D5)
- AC7 → unit `scripts/workflows.test.mjs` › "the linux lane runs verify:linux locally and blocks
  nothing, and no PR or release lane names a Linux job" (D5)
- AC8 → the AC1/AC2 `scripts/workflows.test.mjs` tests (D1) and the AC5 workflows test (D2)

No criterion is a user action in the app, so no e2e flow. GitHub's rendering of a green job is run
by no test; the structural tests pin the step pattern that produces it (hence D1's tier).

## Done
