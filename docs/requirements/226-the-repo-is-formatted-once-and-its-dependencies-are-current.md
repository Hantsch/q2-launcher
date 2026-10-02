---
id: 226
title: the repo is formatted once and its dependencies are current
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want `npm run format` to be usable as intended, line endings to be
independent of each clone's git config, and the shipped Electron and the dev tree to carry no
known high-severity advisories, so that diffs stop carrying formatting churn and dependency
drift is caught weekly by a bot instead of at a release.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F57, F58; the
dependency items are a roadmap follow-up): `prettier --check .` reports 1,044 unformatted files
(1,411 with the configured `endOfLine: lf`, because the Windows worktree is CRLF under
`core.autocrlf=true` and `.gitattributes` is empty); `format:check` runs in no workflow;
`verify-release.mjs` pins `core.autocrlf` per snapshot and the project memory codifies "never
run prettier over globs here". The only patch in `patches/` (`jsdom++undici`) justifies itself
with "older Node versions" while `engines.node` is `>=22` and every workflow uses Node 22, so it
pins jsdom's nested undici for a solved problem and will break `postinstall` on the next jsdom
bump. `npm audit` reports 8 vulnerabilities (6 high, all fixable) including the pinned Electron
(sandbox advisory; 43.7.7 wanted) and `js-yaml`; 18 packages are outdated; there is no
dependabot or renovate configuration.

## Acceptance Criteria

- [ ] **AC1** — `.gitattributes` declares `* text=auto eol=lf` plus binary entries for images,
      fonts, archives and the vendored 7za; a fresh clone on Windows and Linux shows identical
      line endings in the worktree (`git ls-files --eol` has no `w/crlf` for text files).
- [ ] **AC2** — One commit runs `prettier --write .` over the whole repo and is listed in
      `.git-blame-ignore-revs`; `npm run format:check` is green and part of `ci.yml`.
- [ ] **AC3** — `patches/`, the `postinstall: patch-package` script and the `patch-package`
      devDependency are removed; `npm ci && npm test` is green on Node 22.
- [ ] **AC4** — `npm audit --omit=dev --audit-level=high` reports zero; Electron and the other
      "wanted" versions are updated and the lockfile committed; `verify:release` passes
      afterwards (packaging rehearsal, since Electron moved).
- [ ] **AC5** — `.github/dependabot.yml` exists: weekly, minor/patch grouped, Electron and Vite
      majors as separate PRs; the audit step runs in CI non-blocking for one sprint, then
      blocking (recorded as a follow-up with a date).
- [ ] **AC6** — The project memory note about not running prettier is deleted and the roadmap
      follow-up about dependencies is removed.

## Open Questions

- [ ] **Q1** — Land the format commit on `dev` right before a sprint branch is cut, to keep it
      out of every open diff? Timing to be agreed with the user.

## Plan

<!-- Filled by /refine 226. -->

## Deliverables

<!-- Filled by /refine 226. -->

## Model Hints

<!-- Filled by /refine 226. -->

## Acceptance Tests

<!-- Filled by /refine 226. -->

## Done

<!-- Filled by /build 226. -->
