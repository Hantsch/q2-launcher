---
id: 272
title: "Test hygiene: skipped launch flow fails in CI, loose workflow pins, discovery guard, constant echoes"
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — With `CI` set and `resources/bin/7za.exe` absent, `launch-with-scope` fails; with
  `CI` unset it still logs and returns. A seeded defect (removing the CI branch) fails the named check.
- [ ] **AC2** — Every workflow job that runs flows including `launch-with-scope` runs
  `npm run fetch:7za` first (asserted in `scripts/workflows.test.mjs`).
- [ ] **AC3** — `scripts/flows/windows-build-on-linux.mjs` is unchanged (`git diff` empty for it).
- [ ] **AC4** — `scripts/workflows.test.mjs` no longer contains the xvfb-run regexp; it asserts that
  a step runs `ui:flows` with `--shard` and the matrix shard. The `fetch:7za`,
  `ELECTRON_DISABLE_SANDBOX`, `build:dev` and windows-verify `runs` assertions remain.
- [ ] **AC5** — A `scripts/repo-hygiene.test.mjs` case takes `git ls-files` filtered by
  `/\.(test|spec)\.[cm]?[jt]sx?$/` and fails for any file outside the two include globs (seeded
  defect: a `foo.test.cjs` makes it red; `.snap` files and `node_modules` are ignored).
- [ ] **AC6** — `grep -rn "expect(LIVE_WRITE_WINDOW_MS).toBe\|expect(MAX_FLOWS_PER_AREA).toBe" src
  scripts` returns nothing.
- [ ] **AC7** — The CSP pins still fail on a relaxed directive: `renderer-source.test.ts` keeps
  `PRODUCTION_CSP` verbatim and `layering.test.ts` keeps its `toContain` checks.
- [ ] **AC8** — `npm test` and `npm run lint` exit 0.

## Open Questions

- F16 scope: only the two named echoes, deleted while those files are touched anyway (judge), or the
  full 15–20 list (refuter's count) after a per-hit check? Not a campaign over all 33 hits.
- CSP: the judge proposes keeping one verbatim pin and reducing `layering.test.ts` to `toContain`;
  the refuter notes both pins are deliberate. Reduce, or leave all three and drop this item?
- F15: import the include globs from `vitest.config.ts` or repeat the patterns in the test?
- F12: throw in the flow under `process.env.CI`, or rely on the workflow `fetch:7za` step failing
  (already true) and leave the flow alone?

## Decisions (Sprint)

- **(User)** F16: only the two named echoes. CSP: keep all pins. F15: import the include globs from vitest.config.ts. F12: the flow throws under process.env.CI.

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine <id>` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine <id>`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine <id>`: small pieces, each with its own acceptance
(scrum-like) and the files it touches. `/build` implements them in order, in one go.
Every acceptance criterion above must be covered by at least one deliverable **and** by the
test named for it in `## Acceptance Tests` — the test is part of the deliverable that
implements the behaviour, never a clean-up afterwards. Refine checks both before
`status: ready`, build refuses to start without them.>

- [ ] D1 — <smallest useful, individually acceptable result; names the files it touches>
- [ ] D2 — ...

## Model Hints

<Agent tier per deliverable. Default is the cheap tier with `/build`'s effort — leave
unmarked. If a step needs more brainpower: "D3 (balancing formula) → deliverable-hard" (Opus +
high effort, agent in `.claude/agents/`) plus a one-sentence risk justification.
Plus one line for the code review, default: "Review: → default".>

## Acceptance Tests

<Leave empty. Filled by `/refine <id>`: one line per acceptance criterion above, naming the
automated test that proves it — level, file, and the test name it will carry. The tests are
written by the deliverables, not afterwards; `/build` re-checks this mapping and that the
tests pass before `status: done`. This section replaces the manual test plan: acceptance is
the suite, not a click list.

Example paths below; your real test layout and the commands that run it are in
`.claude/ai-scrum.md` (`e2e-story`, `test-story`).

- AC1 → e2e `tests/e2e/<flow>.spec.ts` › "<test name>" (real surface, per
  `ui-acceptance-required`)
- AC2 → unit `tests/core/<module>.test.ts` › "<test name>"
- AC3 → **manual residue:** <the real reason it cannot be automated — an OS dialog, a
  specific machine, a paid external service>. Goes into the sprint review; blocks nothing.>

## Done

<Leave empty. Filled by `/build <id>` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
