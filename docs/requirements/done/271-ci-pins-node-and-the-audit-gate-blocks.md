---
id: 271
title: CI pins Node via a version file and the audit gate blocks
status: done # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

A maintainer wants CI to run the Node version developers run, and wants a high-severity dependency
advisory to fail the PR — so that a pass on "22.latest" cannot hide a failure on the supported
floor, and a calendar promise made in a step name does not silently expire.

Today ([review 2026-10-27](../../reviews/2026-10-27-tests-review.md), F09 and F10; P2):

- F09: the composite action defaults `node-version` to `'22'`
  (`.github/actions/setup-node-electron/action.yml:5-8`); 9 jobs in 5 workflows use it (ci 2,
  linux-update 1, linux-verify 1, release 3, ui-flows 2). There is no `.nvmrc`, `.node-version`,
  `.tool-versions` or volta entry; `package.json:11-13` has only the floor `>=22.12.0`. The
  refuter rates the risk low: floating 22.x is normal `setup-node` behaviour.
- F10: `ci.yml:30-33` is the step `Audit (non-blocking until 2026-10-09)` with
  `continue-on-error: true`, ubuntu leg only — 18 days past its date. `docs/ROADMAP.md:56` records
  the promise (story 226). `scripts/repo-hygiene.test.mjs:128-134` pins the opposite: line 132
  asserts `continue-on-error` is `true`, and the test also requires the roadmap to contain
  `2026-10-09`, so flipping the gate is a two-file change.

Run `npm audit --audit-level=high` first. If it is not clean, fix or document an override with an
expiry before the gate blocks; a gate must not go blocking while red.

## Acceptance Criteria

- [ ] **AC1** — `npm audit --audit-level=high` exits 0 on the lockfile at the time of the change (or
      each remaining advisory has a documented override with an expiry date).
- [ ] **AC2** — The audit step in `ci.yml` is named `Audit` (no date) and has no `continue-on-error`;
      `grep -n continue-on-error .github/workflows/ci.yml` shows only the Linux job at line 69.
- [ ] **AC3** — `scripts/repo-hygiene.test.mjs` no longer asserts `continue-on-error` is `true` on
      the audit step and no longer requires `2026-10-09` in the roadmap; a named test fails when
      `continue-on-error` is added back to the audit step (seeded defect).
- [ ] **AC4** — A `.node-version` file exists at the repo root with a version `>= 22.12.0`.
- [ ] **AC5** — `.github/actions/setup-node-electron/action.yml` uses `node-version-file:
.node-version`; `grep -n "default: '22'" .github/actions/setup-node-electron/action.yml` returns
      nothing.
- [ ] **AC6** — `docs/ROADMAP.md` no longer lists the audit follow-up as open; `npm test` and
      `npm run lint` exit 0.

## Open Questions

- ~~Which version to pin: exactly `22.12.0` (exercises the floor) or a current 22.x (less drift from
  developers)? The judge gives 22.12.0 only as an example.~~ answered → Decisions (Sprint)
- ~~Add a `workflows.test.mjs` assertion for the pin? The judge says skip it or fold it into the
  literal-restating rework of story 272, since it deepens that problem.~~ answered → Decisions (Sprint)
- ~~A scheduled audit job so a new transitive advisory does not block unrelated PRs (judge: bigger
  cut, can be left out) versus the blocking step in the PR lane.~~ answered → Decisions (Sprint)
- ~~A dated-comment scanner for calendar promises (judge: optional, P3) versus only the "no
  `continue-on-error` in ci.yml" assertion.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Pin changed to 22.22.2 with `engines` raised to `>=22.22.2`: under verify:release on 22.12.0 vitest workers failed to start (jsdom 30 / undici 8 need >=22.19).
- **(User)** Pin exactly 22.12.0; the audit is a blocking step in the PR lane; no pin assertion in workflows.test.mjs; no scheduled audit job.
- No dated-comment scanner; the seeded-defect test on the audit step's `continue-on-error` is the
  only new assertion — AC3 asks for exactly that, the scanner is an optional P3 outside the ACs.
- AC1 is met by `npm audit fix` (no `--force`), plus one override (`node-gyp > undici`, TD-054) where no in-range fix exists: on 2026-10-29 all 4 high
  advisories (electron, undici, vite, zod) report "fix available via `npm audit fix`".
- AC2's "line 69" is the `linux-journey` job's `continue-on-error`; deleting the audit step's line
  moves it to line 68 — the criterion's intent (only the Linux job keeps one) is what is checked.
- AC6's roadmap half is already true: the dated audit promise left `docs/ROADMAP.md` in the S36
  planning commit (bc2819e), which is why `repo-hygiene.test.mjs` › "ci runs a non-blocking audit
  with a dated follow-up" is red at HEAD; D2 replaces that test.
- Risk accepted with the (User) pin: dev dependencies declare newer engines than the floor
  (`jsdom@30` `^22.22.2`, its `undici` `>=22.19.0`); `npm ci` only warns (no `engine-strict`), so
  D3 proves 22.12.0 through the act-run CI job and stops for the user if it is red rather than
  silently changing a binding pin.

## Plan

Order: clean the audit (D1) before the gate blocks (D2) — a gate must not go blocking while red;
pin Node (D3) last so its CI proof also runs the now-blocking audit on the pinned version.

1. **D1 — clean the audit.** `npm audit fix` (no `--force`) on `package-lock.json` (plus any
   `package.json` range npm moves). High advisories at refine time: electron 43.0.0–43.8.0,
   undici, vite 7.0.0–7.3.6, zod <4.6.6 — all fixable in range. Electron's bump changes the
   binary, so build + test + `ui:verify`. One `### Security` changelog line.
2. **D2 — the gate blocks.** `ci.yml` step renamed `Audit`, `continue-on-error` removed; the red
   hygiene test is replaced by one asserting the step blocks; roadmap asserts dropped.
3. **D3 — pin Node.** `.node-version` = `22.12.0`; the composite action drops its unused
   `node-version` input (no caller passes it; all 9 jobs take the default) and reads
   `node-version-file: .node-version`; `CONTRIBUTING.md` points at the file. Proof:
   `npm run verify:release` (act runs ci.yml through the action, i.e. on 22.12.0).

Pre-existing, not this story: `repo-hygiene.test.mjs` › "every text file is LF in the worktree" is
red locally because four plugin-written templates (`docs/requirements/README.md`,
`docs/requirements/_TEMPLATE.md`, `docs/sprints/README.md`, `docs/sprints/_TEMPLATE/sprint.md`) are
CRLF in the worktree but LF in the index — the sprint owns that; no D touches it.

No `docs/systems/` doc covers CI (they are per module), so no doc D.

## Deliverables

- [ ] D1 — **The lockfile has no high advisory.** Run `npm audit fix` (never `--force`); expected
      changes are `package-lock.json` and, if npm moved a range, `package.json`. Then
      `npm audit --audit-level=high` must exit 0. If an advisory remains with no in-range fix, add an
      `overrides` entry in `package.json` plus a row in `docs/TECH-DEBT.md` with an expiry date;
      never leave one undocumented. Electron moves past 43.8.0, so run `npm run build`, `npm test`,
      `npm run typecheck`, `npm run lint` and `npm run ui:verify`. In `scripts/repo-hygiene.test.mjs`
      › "the lockfile carries no advisory-affected electron or js-yaml" raise the electron floor
      (`atLeast(..., '43.7.7')`) to the version the lockfile now carries, so a downgrade cannot bring
      the advisory back. Add one line under `## Unreleased` → `### Security` in `CHANGELOG.md` (≤15
      words, no internals, e.g. "Electron updated for a certificate-trust security advisory.").
      Files: `package-lock.json`, `package.json` (if moved), `scripts/repo-hygiene.test.mjs`,
      `CHANGELOG.md`, `docs/TECH-DEBT.md` (only on an override).
- [ ] D2 — **The CI audit blocks a PR.** In `.github/workflows/ci.yml` job `test`, rename the step
      `Audit (non-blocking until 2026-10-09)` to `Audit` and delete its `continue-on-error: true`
      (keep `if: matrix.os == 'ubuntu-latest'` and `run: npm audit --audit-level=high`). In
      `scripts/repo-hygiene.test.mjs` (`describe('dependency automation')`) replace the test "ci runs
      a non-blocking audit with a dated follow-up" by "the ci audit step blocks a PR": load `ci.yml`
      with `js-yaml` as the existing test does, find the step in `jobs.test.steps` whose `run` is
      `npm audit --audit-level=high`, assert it exists, its `name` is `Audit` and
      `step['continue-on-error']` is `undefined`. No roadmap assertions. Seeded defect: re-add
      `continue-on-error: true` locally, see the test fail, revert. Afterwards
      `grep -n continue-on-error .github/workflows/ci.yml` shows only the `linux-journey` job line.
      Files: `.github/workflows/ci.yml`, `scripts/repo-hygiene.test.mjs`.
- [ ] D3 — **CI runs the pinned Node.** Create `.node-version` at the repo root containing
      `22.12.0` (one line, LF). In `.github/actions/setup-node-electron/action.yml` remove the
      `node-version` input and give `actions/setup-node@v4` `node-version-file: .node-version` (keep
      `cache: npm`); `grep -rn "node-version" .github/workflows` must stay empty (no caller passes
      it). In `CONTRIBUTING.md` replace "Requires Node 22+." by a sentence naming `.node-version` as
      the version CI runs (the floor stays `engines` `>=22.12.0` in `package.json`). No new test in
      `scripts/workflows.test.mjs` (user decision). Proof under the real pin: `npm run verify:release`
      green (act runs ci.yml through the action on 22.12.0, including the now-blocking audit). If it
      is red only because of 22.12.0 (e.g. `jsdom@30` declares `^22.22.2`), do **not** change the
      pin — stop and return it as a user question (alternative: pin 22.22.2 and raise `engines`).
      Files: `.node-version` (new), `.github/actions/setup-node-electron/action.yml`,
      `CONTRIBUTING.md`.

## Model Hints

All Ds default tier — lockfile, config and one test rewrite; the 22.12.0 risk is caught by D3's
`verify:release` proof and an explicit stop, not by more reasoning.

Review: → default

## Acceptance Tests

- AC1 → command `npm audit --audit-level=high` exits 0 (D1); kept honest afterwards by the
  blocking CI step (D2) and unit `scripts/repo-hygiene.test.mjs` › "the lockfile carries no
  advisory-affected electron or js-yaml" (electron floor raised in D1).
- AC2 → unit `scripts/repo-hygiene.test.mjs` › "the ci audit step blocks a PR" (D2).
- AC3 → unit `scripts/repo-hygiene.test.mjs` › "the ci audit step blocks a PR" (D2); seeded
  defect: re-adding `continue-on-error: true` turns it red.
- AC4 → CI `npm run verify:release` › ci.yml `test` job, Node set up from `.node-version` (D3):
  `actions/setup-node` fails the job on a missing or malformed file.
- AC5 → CI `npm run verify:release` (D3) — the action's only Node source is
  `node-version-file`; no pin assertion in `workflows.test.mjs` (user decision).
- AC6 → `npm test` and `npm run lint` exit 0 (every D); the only test reading the roadmap's audit
  promise is replaced in D2.

## Done

Done in the S36 gate after the user repinned Node to 22.22.2.

- D1: electron 43.8.4, vite 7.3.7, zod 4.6.7, vitest 4.1.12; `npm audit --audit-level=high` exits 0. `npm audit fix` crashes here, so versions were bumped per package. Override `node-gyp > undici ^8.12.3` documented as TD-054 (expiry 2027-01-31); undici 8 needs Node >=22.19, above the 22.12.0 pin (dev-only, node-gyp).
- D2: audit step renamed `Audit`, `continue-on-error` removed; test "the ci audit step blocks a PR" added, seeded defect turns it red. Only `linux-journey` keeps `continue-on-error` (line 68).
- D3: `.node-version` = 22.22.2 and `engines` `>=22.22.2` (user decision after 22.12.0 failed vitest workers under act, `8eda5b0`); action uses `node-version-file`, CONTRIBUTING updated.
- Four CRLF templates converted to LF so the hygiene test passes.
- Verify: build, typecheck, lint, `npm test` green; `npm run verify:release` GREEN on `8eda5b0` (ci.yml under act on Node v22.22.2, blocking audit).
- Review: default tier, run by the sprint orchestrator after unblocking — PASS; minor CONTRIBUTING wrap and the overrides wording fixed.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 3
