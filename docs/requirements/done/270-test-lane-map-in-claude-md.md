---
id: 270
title: Test lane map in CLAUDE.md, Linux advisory exit condition, one meaning of e2e
status: done # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

A developer or agent wants one place that says which test lane blocks a PR or a release, on which
OS, and what "e2e" means — and wants the deliberate "Linux UI lanes are advisory" policy to carry an
exit condition — so that nobody reads five workflows and a 470-line script to learn the gates.

Comes after stories 264 and 265: the table is written once, with their final blocking/advisory values.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F08, F02, F14; P2):

- F08: `CLAUDE.md` has no `## Test lanes` section. Lane facts are spread over `.claude/ai-scrum.md:20-43`,
  `scripts/verify-release.mjs:1-45`, `linux-verify.yml:3-21` and `ui-flows.yml:3-5`. "e2e" means
  `ui:verify` for agents (`.claude/ai-scrum.md:29`, `e2e: npm run ui:verify`) but sharded `ui:flows`
  in CI (`ui-flows.yml:51`). `CONTRIBUTING.md` and `docs/UI-VERIFICATION.md` hold a partial map for
  humans.
- F02: `continue-on-error: ${{ github.actor != 'nektos/act' }}` is on 4 Linux jobs (`ci.yml:69`,
  `ui-flows.yml:22`, `linux-verify.yml:38`, `linux-update.yml:51`), pinned by
  `scripts/workflows.test.mjs:84-97`. The policy is deliberate (commit 586ea43) and documented in
  `docs/UI-VERIFICATION.md` (~1608), but has no exit condition; only `test (ubuntu-latest)` blocks
  Linux on GitHub.
- F14: `scripts/verify-release.mjs:387-394` acts only `ci.yml`, `linux-verify.yml`,
  `linux-update.yml`; `ui-flows.yml` is rehearsed separately by `npm run rehearse` (story 234).

Out of scope, by the judges' scoping: a new test-gates skill; restructuring `ai-scrum.md` beyond
replacing its "e2e" wording with a link; making any Linux lane blocking now; adding `ui-flows.yml`
to the act list (about +1400 s on a ~1000 s gate, against story 234's split).

## Acceptance Criteria

- [x] **AC1** — `CLAUDE.md` contains a `## Test lanes` section with a table of 6–8 rows and the
      columns lane, trigger, command, OS, blocking/advisory (`grep -n '^## Test lanes' CLAUDE.md`
      returns one match).
- [x] **AC2** — A test in `scripts/workflows.test.mjs` (or `repo-hygiene.test.mjs`) fails when a
      workflow file name or npm script named in the table no longer exists (seeded defect: rename
      `ui-flows.yml` in the table).
- [x] **AC3** — `CLAUDE.md` defines "e2e" once, naming both `ui:verify` and `ui:flows`;
      `.claude/ai-scrum.md` links to that definition next to its `e2e:` line and does not duplicate the table.
- [x] **AC4** — The Linux policy appears in the `CLAUDE.md` lane table only: the Linux lane is listed
      as manual / additional target (run by hand, never a PR or release gate), and the table states that
      the maintainer owns any change to that policy; no "N green runs" exit condition and no job named
      to flip. _(Reworded per the (User) decision below, which dropped the original "exit condition +
      first job to flip".)_
- [x] **AC5** — The header of `scripts/verify-release.mjs` states that `ui-flows.yml` is advisory
      on GitHub and rehearsed via `npm run rehearse` / `ci:local:flows`; `grep -n "ui-flows"
scripts/verify-release.mjs` returns a match within the first 45 lines.
- [x] **AC6** — `npm run lint` and `npm test` exit 0.

## Open Questions

- ~~Exit condition: "N consecutive green runs of `linux-verify`" (judge: make only the packaged
  AppImage job blocking after a stability window) or "quarantine set below M" (story 269)? Who owns
  the flip decision, given the owner reversed the policy recently (586ea43)?~~ answered → Decisions (Sprint)
- ~~The refuter notes the platform-parity rule concerns UI controls, not CI; does the policy belong
  in the lane table alone rather than under that rule?~~ answered → Decisions (Sprint)
- ~~Keep the drift test (AC2) at all? The judge allows it only as a small existence check.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Linux checks run manually only, not in the pipeline (see 269): the lane map lists Linux as manual/additional. Drop the 'N green linux-verify runs flips the AppImage job' exit condition accordingly; the user owns any later change. Keep a small existence-check drift test; the policy lives in the lane table only.

- The table is written from the workflows and `package.json` as they stand when 270 is built (last
  in S36, after 264/265/267/269/271), not copied from the plan's row sketch, because concurrent
  stories (269 above all) still change which Linux jobs exist; the drift test keeps it honest.
- AC3/AC4/AC5 are prose-presence criteria and are proven by the literal `grep` checks the ACs
  already name, run by `/build`, because unit tests pinning doc wording would be padding.
- `CONTRIBUTING.md` and `docs/UI-VERIFICATION.md` stay untouched, because the ACs require one table
  in `CLAUDE.md` and no second one only in `.claude/ai-scrum.md`.
- No `CHANGELOG.md` entry, because nothing user-visible changes.

## Plan

Docs plus one guard test; built last in S36 so the table carries the final values of 264/265/267/269/271.

1. `CLAUDE.md`: new `## Test lanes` section right after `## House rules` (whose last paragraph
   already points at it). One table, columns **Lane | Trigger | Command | OS | Blocks**, 6–8 rows.
   Expected shape — verify every cell against the workflow files and `package.json` at build time:
   - pr-unit — `ci.yml` on PR/push — lint, typecheck, `npm test`, audit (271) — Windows + Ubuntu — blocks merge
   - pr-ui — `ui-flows.yml` job `windows-verify`, PR into main — `npm run ui:verify` + core-journey flows (264) — Windows — blocks merge
   - release — `release.yml` on push to main / dispatch — green-`ci` guard (266), `npm test`, typecheck, packaged launch (264, advisory for 2 releases) — Windows — blocks publish
   - release-prep — local, `/release-prep` — `npm run verify:release`, `npm run rehearse` — Windows host + act — blocks the release decision
   - sprint gate — local, `/sprint` — `npm run ui:flows` (`--tier=smoke` / full, 265) — Windows — blocks the sprint
   - perf — manual — `npm run test:perf` (267) — any — advisory
   - linux — manual, additional target — `npm run ci:local:*` and any Linux workflow 269 leaves, on dispatch — Ubuntu — never a gate; maintainer owns any change
2. Under the table: one paragraph, the only definition of **e2e** — `ui:verify` (screens + axe) and
   `ui:flows` (journey flows; sharded in CI, `--affected` per story, full at the sprint gate).
3. `.claude/ai-scrum.md`: HTML comment next to `e2e: npm run ui:verify` linking `CLAUDE.md#test-lanes`.
4. `scripts/verify-release.mjs` header (first 45 lines): `ui-flows.yml` is advisory on GitHub and
   not acted here; rehearsed by `npm run rehearse` / `npm run ci:local:flows` (story 234).
5. `scripts/workflows.test.mjs`: `describe('lane map in CLAUDE.md')` — table shape + every named
   workflow file and npm script exists.
6. `npx prettier --write CLAUDE.md`, then lint + test + format:check.

## Deliverables

- [x] D1 — **Lane map, e2e definition and its drift guard.** Touches `CLAUDE.md`,
      `.claude/ai-scrum.md`, `scripts/verify-release.mjs`, `scripts/workflows.test.mjs`.
  - `CLAUDE.md`: add `## Test lanes` (exactly that heading, so the anchor is `#test-lanes`) directly
    after `## House rules`, whose last paragraph already says "Which command is which lane is this
    project's `## Test lanes` table". One markdown table with header
    `| Lane | Trigger | Command | OS | Blocks |` and 6–8 rows: pr-unit (`ci.yml`), pr-ui
    (`ui-flows.yml` job `windows-verify`), release (`release.yml`), release-prep (local:
    `npm run verify:release`, `npm run rehearse`), sprint gate (local: `npm run ui:flows`), perf
    (manual: `npm run test:perf`), linux (manual / additional target: `npm run ci:local:verify` and
    the other `ci:local:*` scripts). Fill trigger, command, OS and blocking from the actual
    `.github/workflows/*.yml` and `package.json` scripts at build time — a job with
    `continue-on-error` is advisory, one without blocks; never name a workflow file or `npm run`
    script that does not exist. The linux row says: Linux is an additional target, its checks run by
    hand and never gate a PR or release; the maintainer owns any change to that policy (no "N green
    runs" exit condition, no job to flip). Under the table one short paragraph that is the only
    definition of **e2e** in the file: both `npm run ui:verify` (screenshots + axe report) and
    `npm run ui:flows` (journey flows; sharded in CI, `--affected` per story, full at the sprint
    gate). Keep it short — every agent reads this file. Run `npx prettier --write CLAUDE.md`.
  - `.claude/ai-scrum.md`: next to the `e2e: npm run ui:verify` line add an HTML comment such as
    `<!-- what "e2e" means across lanes, and which lane blocks what: CLAUDE.md#test-lanes -->`.
    Do not copy the table; change nothing else in the profile.
  - `scripts/verify-release.mjs`: in the header comment, within the first 45 lines and next to the
    `linux (every PR workflow, through act …)` bullet, state that `ui-flows.yml` is advisory on
    GitHub and deliberately not acted here; it is rehearsed by `npm run rehearse` /
    `npm run ci:local:flows` (story 234). Comment only, no code change.
  - `scripts/workflows.test.mjs`: new `describe('lane map in CLAUDE.md', …)` reusing the file's
    `ROOT` and `WORKFLOWS_DIR`. Take the lines between `## Test lanes` and the next `## ` heading;
    table rows are lines starting with `|`, minus header and separator. Two tests:
    `"the lane map is one table with lane, trigger, command, OS and blocking columns"` — exactly one
    `^## Test lanes` line in `CLAUDE.md`, header cells Lane/Trigger/Command/OS/Blocks, 6–8 data rows;
    `"every workflow and npm script the lane map names exists"` — every backticked token ending in
    `.yml` exists in `.github/workflows/`, and every `npm run <name>` (name = the token after
    `run`, args dropped) is a key of `package.json` `scripts`. Seeded defect before finishing:
    rename `ui-flows.yml` in the table → the second test goes red; restore.
  - Acceptance: both tests green; `grep -c '^## Test lanes' CLAUDE.md` = 1;
    `head -45 scripts/verify-release.mjs | grep -n ui-flows` matches; `npm run lint`, `npm test`
    and `npm run format:check` exit 0.

## Model Hints

- D1 → default (docs plus a small parse-and-exists test; no runtime path).
- Review: → default

## Acceptance Tests

- AC1 → unit `scripts/workflows.test.mjs` › "the lane map is one table with lane, trigger, command, OS and blocking columns"
- AC2 → unit `scripts/workflows.test.mjs` › "every workflow and npm script the lane map names exists" (seeded defect: rename `ui-flows.yml` in the table)
- AC3 → check run by `/build`: `grep -c '^## Test lanes' CLAUDE.md` = 1 and the e2e paragraph under it names `ui:verify` and `ui:flows`; `grep -n 'CLAUDE.md#test-lanes' .claude/ai-scrum.md` matches and `grep -c '^|' .claude/ai-scrum.md` = 0
- AC4 → check run by `/build`: `sed -n '/^## Test lanes/,/^## [^T]/p' CLAUDE.md | grep -i linux` shows the row as manual / additional target, never a gate, maintainer-owned
- AC5 → check run by `/build`: `head -45 scripts/verify-release.mjs | grep -n ui-flows` matches
- AC6 → `npm run lint` and `npm test` exit 0 (the `/build` verify gate)

## Done

Added the `## Test lanes` table (7 rows) and the single **e2e** definition to CLAUDE.md, an ai-scrum.md pointer to it, the ui-flows.yml note in the verify-release.mjs header, and an existence-check drift test in scripts/workflows.test.mjs.

Commit: `270: CLAUDE.md test lane map + e2e definition, workflows.test drift guard`

Verification (narrow gate: lint, typecheck, build, `npx vitest run --changed HEAD` = scripts/workflows.test.mjs 19/19; no e2e mapped): all green. AC1/AC2 = the two named workflows.test.mjs tests, passed; seeded defect (ui-flows.yml renamed) turned the second red, restored. AC3-AC5 = literal greps, all match. AC6 lint + tests green; `format:check` red repo-wide already before this story (none of the four files).
Review 1 (default): FAIL on two cells, fixed: pr-ui command now `ui:flow -- <name>` each (workflow has no --tier=smoke); Linux wording says GitHub Linux jobs still trigger but are advisory only. Not re-reviewed (doc-only fix, tests re-run green).

Decisions: table written from the workflows as on HEAD; 269 left linux-verify/linux-update PR/push triggers, so the table lists them as advisory rather than claiming Linux is purely manual. Prettier re-wrapped 4 unrelated lines in workflows.test.mjs (formatting only). No changelog entry.

tiers: D 1 / hard 0 · review default · cycles 1 · agents 3

