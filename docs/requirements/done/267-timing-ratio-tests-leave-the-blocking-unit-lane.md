---
id: 267
title: Timing-ratio tests leave the blocking unit lane
status: done
created: 2026-10-27
---

## Requirement

As a maintainer, I want wall-clock budget assertions out of the blocking unit lane and out of flow
pass/fail, so a scheduler hiccup on a CI runner cannot turn the gate red while the timing checks stay
available.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F06; TD-049): both OS legs run
`src/main/modules/servers/scan-ping-accuracy.test.ts` (median within `TOLERANCE_MS = 5` on loopback
sockets with a busy-spinning worker, constants at :30-36; commit 6b7318e already widened it after a
flake) and `scan-measurement.test.ts` (`RECORDED_FULL_PASS_BUDGET_MS = 7527`, documented with about
2.5x headroom, :30-36). `scripts/flows/replays-folders-scale.mjs:15` fails the flow on
`MAX_NAVIGATION_MS = 1_000`. `scripts/rehearsal.test.mjs:110` asserts `launched.ms < 3000`, a
structural bound with no flake on record. `package.json` has only `test` and `test:watch`; there is
no perf lane. Windows has a 15.6 ms timer tick.

## Acceptance Criteria

- [x] **AC1** — `package.json` has a `test:perf` script that runs `scan-ping-accuracy.test.ts` and
      `scan-measurement.test.ts`, and `npm test` does not run them (`npx vitest list` under the
      `npm test` config shows neither file).
- [x] **AC2** — The functional assertions of both files (sample count, median ordering, result
      shape) remain in files that `npm test` runs, and those tests pass.
- [x] **AC3** — `replays-folders-scale.mjs` logs the navigation time and no longer fails on it: a
      search for `MAX_NAVIGATION_MS` in the flow returns nothing, while its row-count assertion
      (`MAX_MOUNTED_ROWS`) still fails when the mounted count exceeds 100.
- [x] **AC4** — `npm run test:perf` exits 0 on the maintainer's machine, and a seeded 3x slowdown in
      the ping path makes it exit non-zero (recorded in the Done section).
- [x] **AC5** — The perf lane has a named trigger (manual dispatch or schedule) in a workflow or in
      the release gate documentation, and `scripts/workflows.test.mjs` asserts it is not among the
      merge-blocking jobs.
- [x] **AC6** — `grep -n "267" docs/TECH-DEBT.md` matches within the TD-049 entry, which is closed or
      points at this story.

## Open Questions

- ~~Perf lane trigger: nightly workflow, manual only, or advisory in CI? The judge says a lane nobody
  runs lets the budgets rot; pick one.~~ answered → Decisions (Sprint)
- ~~`scan-measurement.test.ts` has a documented 2.5x headroom, guards a parallelism regression and has
  no flake on record (refuter). Move it too (finding) or leave it blocking and move only
  `scan-ping-accuracy`? AC1 assumes both.~~ answered → Decisions (Sprint)
- ~~`rehearsal.test.mjs:110` is structural and unflaky; the judge says leave it for last and convert
  only if it flakes. Out of scope here unless refine decides otherwise.~~ answered → Decisions (Sprint)
- ~~Never widen tolerances further (judge).~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** No nightly runs: the perf lane is manual-only (no scheduled workflow). Move both scan-ping-accuracy and scan-measurement out of the blocking lane.
- The manual trigger is a `perf.yml` workflow whose only event is `workflow_dispatch`, on
  `windows-latest`: it names the lane in a workflow (AC5) without a schedule or a PR run, and Windows
  is where the 15.6 ms tick the budgets must survive lives.
- Perf files are selected by name, `*.perf.test.ts`, excluded by `vitest.config.ts`'s `exclude` and
  run by a second config (`vitest.perf.config.ts`): `/test-gates` picks a lane by file name and
  runner config, never by a condition inside the test.
- A budget overrun fails `npm run test:perf` (AC4) instead of only warning, and the lane is not an
  advisory PR job; both deviate from `/test-gates` and get one row in `CLAUDE.md`'s Deviations
  table, because the user made the lane manual-only and a manual run is read by its exit code.
- The functional remainder lives in a new `scan-runner-loopback.test.ts`, so `npx vitest list` shows
  no `scan-ping-accuracy*` or `scan-measurement*` file (AC1 read literally); sample count and median
  ordering are already proven in the unit lane by `ping-samples.test.ts`.
- `rehearsal.test.mjs:110` stays as it is: structural, no flake on record, outside the finding.
- No tolerance or budget constant changes value (`TOLERANCE_MS`, `OUTLIER_TOLERANCE_MS`,
  `MAX_SAMPLING_COST`, `RECORDED_FULL_PASS_BUDGET_MS`): the files move, the numbers do not.
- TD-049 stays in `docs/TECH-DEBT.md`, rewritten to point at story 267: the flake leaves the gate,
  but a real-socket median still cannot see a late receive stamp, so the row is not done.

## Plan

1. **Perf lane plumbing + split (D1).** `vitest.config.ts` gains
   `exclude: [...configDefaults.exclude, '**/*.perf.test.*']`. New `vitest.perf.config.ts` spreads
   the base config and *replaces* `test.include`/`test.exclude`, with `fileParallelism: false` (no
   `mergeConfig`: it concatenates arrays, so the perf lane would run the whole suite).
   `package.json` gets `test:perf`; `tsconfig.node.json` includes the new config.
   `scan-ping-accuracy.test.ts` → `scan-ping-accuracy.perf.test.ts` (`git mv`);
   `scan-measurement.test.ts` → `scan-measurement.perf.test.ts` (budget only); the measurement
   pass's two-stage shape checks move, clock-free, to a new `scan-runner-loopback.test.ts`.
2. **Trigger, guard, docs (D2).** `.github/workflows/perf.yml` (dispatch only, Windows, shared
   `setup-node-electron` action with `electron: 'false'`, `npm run test:perf`).
   `scripts/workflows.test.mjs` asserts perf.yml's only event is `workflow_dispatch` and no
   push/pull_request workflow runs `test:perf`. `CLAUDE.md` Deviations row, TD-049 rewrite, one line
   in `docs/systems/servers-module.md`.
3. **Flow (D3).** `replays-folders-scale.mjs` drops `MAX_NAVIGATION_MS`; the two navigation times
   are only logged by the existing `step('measured: …')`; `assertFewRows` is untouched.

Order D1 → D2 → D3 (D2's guard needs D1's script). Story 274 builds later and edits the ping test
under its new name `scan-ping-accuracy.perf.test.ts`.

## Deliverables

- [x] D1 — **Perf lane and the split of the two timing files.** Touches `vitest.config.ts`, new
      `vitest.perf.config.ts`, `tsconfig.node.json`, `package.json`, and in
      `src/main/modules/servers/`: `scan-ping-accuracy.test.ts` → `scan-ping-accuracy.perf.test.ts`
      (`git mv`; content unchanged except the header comment's pointer to the measurement file),
      `scan-measurement.test.ts` → `scan-measurement.perf.test.ts`, new `scan-runner-loopback.test.ts`.
      - `vitest.config.ts`: add `exclude: [...configDefaults.exclude, '**/*.perf.test.*']` (import
        `configDefaults` from `vitest/config`) with a one-line comment that perf files run only via
        `npm run test:perf`.
      - `vitest.perf.config.ts`: import the base config and build a new one by object spread,
        replacing `test.include` with `['src/**/*.perf.test.ts']` and `test.exclude` with
        `configDefaults.exclude`, adding `fileParallelism: false`. Do **not** use `mergeConfig` (it
        concatenates `include`/`exclude`). Aliases, `setupFiles`, `define`, `testTimeout` carry over.
      - `package.json`: `"test:perf": "vitest run --config vitest.perf.config.ts"` next to `test`.
      - `tsconfig.node.json`: list `vitest.perf.config.ts` beside `vitest.config.ts`.
      - `scan-measurement.perf.test.ts`: today's file reduced to the budget — population setup,
        `runScan`, `result.aborted === false`, `stage1Done === POPULATION_SIZE`,
        `fullPassMs < RECORDED_FULL_PASS_BUDGET_MS`. Keep the budget comment; drop the
        `expect(RECORDED_FULL_PASS_BUDGET_MS).toBeGreaterThan(0)` constant echo.
      - `scan-runner-loopback.test.ts` (unit lane, no `performance.now`/`Date.now`): the same
        30-responder population (`scan-fixture-responders.ts`) through the real `runScan` with
        `DEFAULT_SERVERS_STATE.scan`, asserting the functional shape the measurement file asserts
        today: unaborted, `stage1Done`, `stage1Ok`/`stage2Ok`/`stage2Total` against the
        answering/non-empty profiles, every responder `received.info >= 1`, `received.status > 0`
        exactly for the non-empty ones. Test name: "a full two-stage pass over the loopback
        population answers every live server and queries status only for non-empty ones".
      - No tolerance or budget constant changes value.
      - Acceptance: `npx vitest list` prints no path containing `scan-ping-accuracy` or
        `scan-measurement` and does print `scan-runner-loopback.test.ts`;
        `npx vitest list --config vitest.perf.config.ts` prints exactly the two `.perf.test.ts`
        files; `npm test`, `npm run test:perf`, `npm run typecheck`, `npm run lint` exit 0.
      - AC4 seeded defect, recorded in Done and reverted: slow the ping path 3x (e.g. multiply the
        round trip where `server-query.ts` computes it by 3) and show `npm run test:perf` exits
        non-zero.
- [x] D2 — **Manual trigger, its guard, and the docs.** Touches new `.github/workflows/perf.yml`,
      `scripts/workflows.test.mjs`, `CLAUDE.md`, `docs/TECH-DEBT.md`, `docs/systems/servers-module.md`.
      - `perf.yml`: `name: perf`, `on: workflow_dispatch:` only (no `schedule`, `push`,
        `pull_request`); one job `perf`, `runs-on: windows-latest`, `timeout-minutes: 15`; steps
        `actions/checkout` (same pin style as `ci.yml`), `./.github/actions/setup-node-electron`
        with `electron: 'false'`, `run: npm run test:perf`. Header comment: manual-only by the
        maintainer's call (story 267); a red run blocks nothing. It must pass every existing check
        in `scripts/workflows.test.mjs` and `scripts/repo-hygiene.test.mjs` at build time (no own
        `setup-node`/`npm ci`, whatever pin or Node-version rules exist by then).
      - `scripts/workflows.test.mjs`: a `describe('perf lane', …)` with one test "the perf lane runs
        only on manual dispatch and no push or pull-request workflow runs it": perf.yml's `on` keys
        equal `['workflow_dispatch']`; its job has a step running `npm run test:perf`; across
        `loadWorkflows()`, no workflow whose `on` has `push` or `pull_request` has a step whose
        `run` contains `test:perf` or `vitest.perf.config`. Reuse `loadWorkflows`/`allSteps`.
      - `CLAUDE.md` `## Deviations` table: one row, skill `/test-gates` (perf lane). Deviation: the
        perf lane (`npm run test:perf`, `perf.yml`) runs on manual dispatch only, not as an advisory
        PR job, and a budget overrun fails the run instead of warning. Reason: the maintainer made
        the lane manual-only (story 267); a manual run is read by its exit code and blocks no merge
        or release. Keep the table prettier-aligned.
      - `docs/TECH-DEBT.md` TD-049: rewrite the item — the ping-accuracy test runs only in the
        manual perf lane (story 267); over real sockets it still cannot tell a late receive stamp
        from an arrival stamp (story 258 AC5's fake-socket test is the proof). Keep id, `since`,
        source and the table alignment.
      - `docs/systems/servers-module.md`: one line under `## Map`, near `server-query.ts` /
        `ping-samples.ts`: scan timing (ping accuracy, full-pass budget) is checked only by the
        manual perf lane `npm run test:perf`; the unit lane checks the scan's shape.
      - Acceptance: the new test passes and fails with a seeded `pull_request:` in perf.yml
        (recorded in Done, reverted); `grep -n "267" docs/TECH-DEBT.md` hits the TD-049 row;
        `npm test`, `npm run lint`, `npm run format:check` clean for the touched files.
- [x] D3 — **The folder-scale flow logs navigation time instead of failing on it.** Touches only
      `scripts/flows/replays-folders-scale.mjs`.
      - Delete `MAX_NAVIGATION_MS` and both `expect(openMs <= …)` / `expect(backMs <= …)` lines;
        the crumb-return `poll` drops its third argument and uses the default timeout. The existing
        `measured: open … ms, crumb … ms` step line stays as the log; reword the
        step "each render within a second" and the header's "navigates fast" so neither promises a
        time.
      - `MAX_MOUNTED_ROWS` and `assertFewRows` stay byte-identical.
      - Acceptance: `grep -n MAX_NAVIGATION_MS scripts/flows/replays-folders-scale.mjs` is empty;
        `npm run ui:flow -- replays-folders-scale` passes and prints the `measured:` line; a seeded
        `MAX_MOUNTED_ROWS = 1` makes it fail (recorded in Done, reverted).

## Model Hints

All Ds default tier: config plumbing, a file split, a dispatch-only workflow and a flow edit — no new
runtime path.

Review: → default

## Acceptance Tests

- AC1 → config check run by D1: `npx vitest list` lists no `scan-ping-accuracy*`/`scan-measurement*`
  file and `npx vitest list --config vitest.perf.config.ts` lists exactly the two `.perf.test.ts`
  files (output recorded in Done; a test pinning the config would only echo it).
- AC2 → unit `src/main/modules/servers/scan-runner-loopback.test.ts` › "a full two-stage pass over
  the loopback population answers every live server and queries status only for non-empty ones";
  sample count and median ordering → existing unit `src/main/modules/servers/ping-samples.test.ts` ›
  "takes three samples first and three more on disagreement" and "takes the middle of an odd count
  regardless of order".
- AC3 → e2e `scripts/flows/replays-folders-scale.mjs` › flow `replays-folders-scale` (passes, logs
  `measured: open … ms, crumb … ms`); empty grep and the seeded `MAX_MOUNTED_ROWS` failure recorded
  in Done.
- AC4 → perf `npm run test:perf` › `src/main/modules/servers/scan-ping-accuracy.perf.test.ts` › "a
  fixed-delay server reads within 5 ms of its delay over 10 scans under load, none beyond 10 ms"
  (green on this machine; red under the seeded 3x ping-path slowdown, recorded in Done).
- AC5 → unit `scripts/workflows.test.mjs` › "the perf lane runs only on manual dispatch and no push or
  pull-request workflow runs it".
- AC6 → doc check by D2: `grep -n "267" docs/TECH-DEBT.md` hits the TD-049 row (recorded in Done).

## Done

The two wall-clock timing tests (ping accuracy, full-pass budget) moved to a manual-only perf lane (`npm run test:perf`, `vitest.perf.config.ts`, `perf.yml` on `workflow_dispatch`, Windows); `npm test` excludes `*.perf.test.*`. The scan's functional shape stays in the unit lane (`scan-runner-loopback.test.ts`). The folder-scale flow logs navigation time instead of failing on it. TD-049 rewritten to point here; CLAUDE.md Deviations row added.

Commit message: `267: timing tests to manual perf lane, flow stops failing on navigation time`

Verification (narrow gate: `npx vitest run --changed HEAD`, `npm run ui:flows -- --affected scripts/flows/replays-folders-scale.mjs --parallel=4 --shard=1/2` and `2/2`): build, typecheck, lint green; unit 7630 passed; `test:perf` green (2 files, 3 tests); flow passed and printed `measured: open 64 ms, crumb 32 ms`.
- AC1 `npx vitest list` shows no scan-ping-accuracy*/scan-measurement*, perf config lists exactly the two `.perf.test.ts` files: passed.
- AC2 `scan-runner-loopback.test.ts` + `ping-samples.test.ts` named tests: passed.
- AC3 flow `replays-folders-scale` passed; `grep MAX_NAVIGATION_MS` empty; seeded `MAX_MOUNTED_ROWS = 1` failed the flow ("1 rows mounted, expected fewer than 1"), reverted.
- AC4 `npm run test:perf` exit 0; seeded 3x RTT at `server-query.ts:291` gave exit 1, reverted (git diff empty).
- AC5 `workflows.test.mjs` "the perf lane runs only on manual dispatch…" passed; seeded `pull_request:` in perf.yml made it fail, reverted.
- AC6 `grep -n 267 docs/TECH-DEBT.md` hits the TD-049 row.
- Review (default tier, 1 cycle): PASS.

Decisions: perf.yml dispatch-only on windows-latest; `runScan` needs `onServer`, so the perf test passes a no-op; prettier re-padded the unrelated house-rules table in CLAUDE.md (whitespace only) — kept. Unfixed minor finding: the loopback and perf files each declare `POPULATION_SIZE = 30` and the population setup (the mandated split; drift risk accepted). No changelog entry (no user-facing change). Pre-existing: CLAUDE.md references a `## Test lanes` section that does not exist.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 5
