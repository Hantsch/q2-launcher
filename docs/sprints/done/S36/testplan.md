# Sprint S36 — manual residue

Only criteria that need a push and GitHub-hosted runners. Everything else is proven by tests (see [review.md](review.md#acceptance)).

## 264 AC2 — `windows-verify` is green three times in a row

- **Why manual:** needs real GitHub Windows runners.
- **Preparation:** push `dev` (or a PR from it) after the merge decision.
- **Steps:** let `ui-flows.yml` › `windows-verify` run on three consecutive pushes/PRs.
- **Expected:** three green runs; each of the 8 named flow steps passes.

## 264 AC3 — the Windows job stays within 15 minutes

- **Why manual:** runner timing exists only on GitHub.
- **Steps:** read the duration of the three runs above.
- **Expected:** each `windows-verify` job ≤ 15 min.

## 264 AC5 — a broken packaged app shows red in the release run

- **Why manual:** needs a real `release.yml` run.
- **Preparation:** a throwaway branch where the packaged app cannot start (e.g. a deliberately broken main entry).
- **Steps:** dispatch `release.yml` with `dry_run: true` on that branch.
- **Expected:** the packaged-smoke step is red (non-blocking until two releases past 0.8.0); record the run link in story 264's Done.

## 266 AC5 — release refuses a SHA without a green `ci` run

- **Why manual:** needs a live dispatch with `dry_run: false` (a dry run passes the guard by design).
- **Preparation:** a throwaway branch with an empty `## Unreleased`, so nothing can publish even if the guard were broken; a commit with no `ci` run on it.
- **Steps:** dispatch `release.yml` with `dry_run: false` on that branch.
- **Expected:** the `plan` job fails at the `ci-guard` step with the "no green ci run" reason; record the run link in story 266's Done.
