# Sprint S32 — Testplan (manual residue only)

Only what cannot be automated. Everything else is covered by the tests listed in `review.md`.

## 1. Story 223 AC3 — real GitHub-runner shard timings

**Why manual:** the wall time of a `ui-flows` shard is measurable only on a GitHub runner, which needs a
pull request into `main` (or a dispatch); agents may not push or open pull requests (org policy).
`timeout-minutes: 20` enforces the ceiling there, the local run took ~49 min in total for all flows.

**Preparation:** a branch with `.github/workflows/ui-flows.yml` pushed to GitHub, and a pull request
into `main` (your decision to open).

**Steps:**

1. Open the pull request; wait for the `ui-flows` job (4 shards) to finish.
2. Read each shard's duration in the Actions run.

**Expected:** every shard ends well under 20 minutes (~15 minutes was the design target) and no shard
is cancelled by the timeout. If one is, rebalance the shards or raise the count (story 234).

## 2. Story 223 AC6 — `windows-verify` on `windows-latest`

**Why manual:** the job runs on GitHub's `windows-latest` runner; it needs a pull request into `main` or
a dispatch on GitHub, which agents may not trigger. Its commands (build, `ui:verify`, three flows) ran
green on the local Windows host.

**Preparation:** same pull request as above (or a manual dispatch of `ui-flows.yml`).

**Steps:**

1. Open the `windows-verify` job of the run.
2. Check the steps `build`, `ui:verify` and the three flows, and download the screenshots artifact.

**Expected:** all steps green, screenshots uploaded. A red step on the runner only is a Windows-runner
difference to fix or quarantine (story 234).

## 3. Story 226 AC4 — `npm run verify:release`

**Why manual:** the run needs a working Docker daemon and exceeds an agent's 10-minute call ceiling; the
daemon was down in this sprint and nothing in S32 ran it, although 226 changed Electron to 43.7.7.
The same applies to the `act` rehearsals `npm run ci:local` and `npm run ci:local:flows` (story 223
AC5), which also were not observed.

**Preparation:** start Docker; a clean worktree on the commit to be released; run from a normal terminal.

**Steps:**

1. Run `npm run verify:release` and wait for it to finish.
2. Run `npm run ci:local`, then `npm run ci:local:flows`.
3. Note any flow that is red only under Linux.

**Expected:** `verify:release` exits 0; both `act` runs end green. A Linux-only red flow goes into
`scripts/flows/quarantine.json` with a reason (or is fixed) — see story 234.
