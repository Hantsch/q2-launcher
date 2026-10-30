---
sprint: S37
status: done # planned | in-progress | done
branch: sprint/S37
milestone: 11.6 — PR and release path, overdue tech debt
---

# Sprint S37 — A PR and a release that do not fail, and no overdue tech debt

## Goal

After a sprint, `npm run verify:release` passing means the PR and the release pass: Linux checks no longer run in PR or release workflows and are never red, a release starts only on dispatch and checks its own commit, doc-shape tests no longer block, and no test turns red on a schedule. Every overdue TECH-DEBT row (since S33 or earlier) is fixed or deleted.

## Stories (in build order)

- [x] 276 — Linux checks leave the PR and release path and are never red
- [x] 279 — Doc-shape tests leave the blocking unit lane
- [x] 280 — The packaged smoke's blocking switch is a decision, not a tripwire
- [x] 278 — A release runs only when the user starts it, and checks its own commit
- [x] 277 — verify:release checks exactly what a PR and a release check, cheap steps first
- [x] 325 — Tests and comments state what they check
- [x] 322 — Boot does not wait on file I/O, and a failed module has no live handlers
- [x] 323 — The update service is split into testable parts
- [x] 320 — Config edits reach disk only through save, and every flag survives a reload
- [x] 321 — Demo play, stop and stage restore end in a defined state
- [x] 326 — Platform decisions in playback stay behind the seam
- [x] 327 — OpenTDM installs on a 64-bit Q2PRO
- [x] 324 — Styles use tokens only, and UI kit controls keep their own rules

## Notes

- 276 first: it removes Linux from `ci.yml`, `release.yml` and `verify:release`, which the later stories then build on. 279 and 280 are independent and small.
- 278 before 277: 277 AC2 reads the blocking steps from the workflow files, so it must see the final shape of `release.yml` (own `ci` checks, dispatch only). 280 also touches `release.yml`, hence before 278.
- Open questions for the clarification round: 278 (drop the push trigger of `ci.yml`; drop the release job's repeated `npm test`), 279 (warning-only `check:docs` on PRs), 280 (does the packaged smoke block — the user's call).
- Tech debt by the user's call (2026-10-30): all 30 overdue rows, grouped into 320–327; TD-015 (inert) and TD-027 (covered by 279) were deleted. 13 stories, above the 3–6 guideline, like S36. The pipeline stories go first so the debt stories build on the new gate; 325 (test hygiene) leads the debt block, 324 (styles, visible in every screenshot) closes it.
- More open questions: 321 (Alt+Enter race: fix or manual residue), 324 (typography scale steps), 326 (cinema ABOVE ordering), 327 (content-only variant or 64-bit build).
- 276 AC6 and 277 AC4 change how the sprint process ends; they edit `.claude/ai-scrum.md` `## Notes`, not the plugin-managed commands.

## Regression gate

Ran on `sprint/S37`. Short suites and `e2e-all` on `7925f3e9` (+ `777569e0`, progress only); fixes verified on their own narrow re-run, no second full run.

| Command                                      | Result                                                                                                                                     | Minutes |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `npm run build`                              | green                                                                                                                                      | 0.3     |
| `npm test`                                   | red: 5 tests in 4 files, all attributed to sprint stories (below), fixed                                                                   | 0.9     |
| `npm run check:docs`                         | green                                                                                                                                      | 0.1     |
| `npm run format:check`                       | red: 7 story files (277, 278, 279, 280, 320, 322, 326) fixed in `ec513dc4`; `docs/ROADMAP.md` pre-existing, formatted in the review commit | 0.5     |
| `npm run lint` / `npm run typecheck`         | green                                                                                                                                      | 0.1     |
| `npm run ui:verify` (on `build:dev`)         | green: 116 shots, 0 critical / 0 serious / 1 moderate                                                                                      | 2.2     |
| `npm run ui:flows -- --parallel=4` (e2e-all) | green: 181/181, one launch                                                                                                                 | 22      |

| Failing test                                                          | Verdict                                             | Outcome                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `flow-select`: every area row selects at most 12                      | story 320, `aed718a8` (new flow in two config rows) | fixed in `1ce4139d` (own `config-switch-bind` row)                    |
| `flow-select`: every non-test src file is reached                     | story 322, `a66a5d4c` (`src/main/boot.ts` unmapped) | fixed in `1ce4139d`                                                   |
| `test-kit`: no test file exceeds 1,500 lines                          | story 321, `1acd4a72` (`demo-play.test.ts` 1503)    | fixed in `d6213a64` (split into `demo-play.volume.test.ts` + helpers) |
| `architecture`: per-file purity checks and tsconfig excludes are gone | story 324, `7925f3e9` (two style tests excluded)    | fixed in `19c57151` (moved to `src/test-support/`)                    |
| `error-keys`: every `fail()` literal resolves in en.json              | story 326, `3b933d2d` (`x11.authFamilyUnsupported`) | fixed in `90811196`                                                   |

Fix re-run: the five tests by name, `npm test` (7754 passed), lint, typecheck, `check:docs`, `build:dev`, `ui:flows --affected` both shards (6/6 + 6/6). No quarantine entries written; no unexpected pass.
