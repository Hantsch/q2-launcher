---
id: 280
title: The packaged smoke's blocking switch is a decision, not a tripwire
status: done # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

Story 264 made the release job's packaged launch smoke non-blocking, and `scripts/workflows.test.mjs`
› "the packaged smoke step's continue-on-error matches the released count" reads `CHANGELOG.md`:
once the second release past 0.8.0 is in it, the next PR goes red until someone edits
`release.yml`. A test that turns red on its own schedule is a planned red PR.

Whether the packaged smoke blocks a release is decided once by the user and pinned, and no test
changes its verdict because a release happened.

## Acceptance Criteria

- [x] **AC1** — No test's verdict depends on how many releases `CHANGELOG.md` lists.
- [x] **AC2** — The packaged smoke step blocks or does not block the release as the user decided,
      and a workflows test pins that.
- [x] **AC3** — When it does not block, a failing smoke ends the step with a `::warning::`
      annotation, not a red step.

## Open Questions

~~Does the packaged launch smoke block the release from now on, or stay a warning for good?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** does the packaged smoke block the release: blocking, as an explicit documented decision
- The block is pinned structurally, not by a release count: the smoke step carries no `continue-on-error` and its `run` swallows no failure (`|| true`, `|| exit 0`, `::warning::`) — that is the only reading of "blocking" a YAML test can see.
- AC3 holds vacuously under the (User) decision (the smoke never runs non-blocking); it is covered by the same test that forbids a warning-swallowing `run`, so no warning path is built for a mode that does not exist.
- `packagedSmokeMustBlock` and both tests that use it are deleted, not kept as a helper: nothing else reads it (grep), and a dormant count-based switch is exactly the tripwire AC1 forbids.
- `CLAUDE.md` `## Test lanes` release row and `docs/UI-VERIFICATION.md` (packaged-smoke paragraph) are updated in the same D, because both still promise the 2-release switch; no `CHANGELOG.md` entry — CI gating changes nothing a user sees.
- One deliverable, default tier: three YAML/test lines and two doc sentences, no runtime code.

## Plan

1. `.github/workflows/release.yml` › job `release` › step "Packaged launch smoke": drop
   `continue-on-error: true` and the "Advisory until the tripwire…" comment; replace it with a
   one-line comment stating the decision (blocking, story 280).
2. `scripts/workflows.test.mjs`: delete `packagedSmokeMustBlock` (l.34-45) and the tests
   "the packaged smoke turns blocking after two releases past 0.8.0" and
   "the packaged smoke step's continue-on-error matches the released count"; add one test in
   `describe('release packaged launch smoke')` pinning the step as blocking.
3. Docs that still promise the switch: `CLAUDE.md` `## Test lanes` release row ("Blocks" cell)
   and `docs/UI-VERIFICATION.md` (~l.1627-1632, "non-blocking until two releases…").

Order: one D. Stories 276/278 also edit `scripts/workflows.test.mjs` — touch only the
`release packaged launch smoke` describe block and the helper.

## Deliverables

- **D1 — The packaged smoke blocks the release, pinned by a structural test.**
  Files: `.github/workflows/release.yml`, `scripts/workflows.test.mjs`, `CLAUDE.md`,
  `docs/UI-VERIFICATION.md`.
  - `release.yml`, job `release`, step `Packaged launch smoke`: remove `continue-on-error: true`
    and the comment above it ("Advisory until the tripwire in scripts/workflows.test.mjs…");
    put `# Blocking by decision: a packaged app that does not launch is not released (story 280).`
    in its place. Leave the `run:` line unchanged.
  - `scripts/workflows.test.mjs`: delete the exported `packagedSmokeMustBlock` function (with its
    JSDoc) and the two tests that use it (`"the packaged smoke turns blocking after two releases
    past 0.8.0"`, `"the packaged smoke step's continue-on-error matches the released count"`).
    Drop any import that becomes unused (e.g. `readFileSync`/`ROOT` only if nothing else uses
    them — the lane-map describe still does). In `describe('release packaged launch smoke')`,
    reusing its existing `smokeStep()` helper, add test
    `"the packaged smoke step fails the release when the app does not launch"`: the step exists,
    `continue-on-error` is undefined (or `false`), and its `run` contains none of `|| true`,
    `|| exit 0`, `::warning::`. The test must not read `CHANGELOG.md`.
  - `CLAUDE.md` `## Test lanes`, row `release`, "Blocks" cell: replace
    "Yes; the packaged smoke is non-blocking for the first 2 releases" with
    "Yes, including the packaged smoke". Keep the table aligned (prettier formats it).
  - `docs/UI-VERIFICATION.md` paragraph starting "`.github/workflows/release.yml` runs
    `about-release-notes`…": replace "It is non-blocking until two releases after 0.8.0 and
    blocking from then on (tripwire test in `scripts/workflows.test.mjs`)." with "It blocks the
    release — a decision, pinned by `scripts/workflows.test.mjs` (story 280)."
  - Acceptance: `npx vitest run scripts/workflows.test.mjs` green; `grep -n packagedSmokeMustBlock`
    over the repo finds nothing outside `docs/`; `npm run format` leaves no diff.

## Model Hints

- D1 → default.
- Review: → default

## Acceptance Tests

- AC1 → unit `scripts/workflows.test.mjs` › "the packaged smoke step fails the release when the
  app does not launch" — together with the deletion of `packagedSmokeMustBlock` and its two
  tests, no test in the file reads `CHANGELOG.md` for a release count (review checks the diff).
- AC2 → unit `scripts/workflows.test.mjs` › "the packaged smoke step fails the release when the
  app does not launch"
- AC3 → unit `scripts/workflows.test.mjs` › "the packaged smoke step fails the release when the
  app does not launch" — vacuous under the (User) decision "blocking"; the test forbids a
  `::warning::`/`|| true` swallow, so no non-blocking mode exists.

## Done

**Summary.** The packaged launch smoke blocks the release by the user's decision. `release.yml` lost `continue-on-error` and the advisory comment; `packagedSmokeMustBlock` and its two CHANGELOG-count tests are gone, replaced by one structural test. `CLAUDE.md` test-lanes row and `docs/UI-VERIFICATION.md` no longer promise the 2-release switch.

**Commit message:** `280: packaged smoke blocks the release - structural workflows test, count-based tripwire removed`

**Verification (narrow gate).** `npm run typecheck`, `npm run lint`, `npx vitest run --changed HEAD` (17/17 in scripts/workflows.test.mjs), `npx prettier --check` on changed files, `npm run check:docs`: all green. No e2e (no UI change, no e2e-mapped criterion). Review (default tier, 1 cycle): PASS.
- AC1, AC2, AC3 -> `scripts/workflows.test.mjs` › "the packaged smoke step fails the release when the app does not launch": ran, passed. No manual residue.

**Decisions.**
- Blocking is pinned structurally (no `continue-on-error`, no `|| true` / `|| exit 0` / `::warning::` in `run`); AC3 is vacuous under that decision.
- No CHANGELOG entry (CI gating, nothing user-visible); no systems doc touched.
- Unfixed review notes: the test's denylist misses exotic swallows (`|| :`, `set +e`, step-level `if:`) and job-level `continue-on-error` is not checked; marginal for the story scope.
- `npm run format` by the D1 agent reformatted 9 unrelated files; reverted with `git checkout`, and its wrap of this story's D1 text was restored.

tiers: D 1 / hard 0 · review default · cycles 1 · agents 3
