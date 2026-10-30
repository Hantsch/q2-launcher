---
sprint: S37
status: in-progress # planned | in-progress | done
branch: sprint/S37
milestone: 11.6 — PR and release path, overdue tech debt
---

# Sprint S37 — A PR and a release that do not fail, and no overdue tech debt

## Goal

After a sprint, `npm run verify:release` passing means the PR and the release pass: Linux checks no longer run in PR or release workflows and are never red, a release starts only on dispatch and checks its own commit, doc-shape tests no longer block, and no test turns red on a schedule. Every overdue TECH-DEBT row (since S33 or earlier) is fixed or deleted.

## Stories (in build order)

- [x] 276 — Linux checks leave the PR and release path and are never red
- [x] 279 — Doc-shape tests leave the blocking unit lane
- [ ] 280 — The packaged smoke's blocking switch is a decision, not a tripwire
- [ ] 278 — A release runs only when the user starts it, and checks its own commit
- [ ] 277 — verify:release checks exactly what a PR and a release check, cheap steps first
- [ ] 325 — Tests and comments state what they check
- [ ] 322 — Boot does not wait on file I/O, and a failed module has no live handlers
- [ ] 323 — The update service is split into testable parts
- [ ] 320 — Config edits reach disk only through save, and every flag survives a reload
- [ ] 321 — Demo play, stop and stage restore end in a defined state
- [ ] 326 — Platform decisions in playback stay behind the seam
- [ ] 327 — OpenTDM installs on a 64-bit Q2PRO
- [ ] 324 — Styles use tokens only, and UI kit controls keep their own rules

## Notes

- 276 first: it removes Linux from `ci.yml`, `release.yml` and `verify:release`, which the later stories then build on. 279 and 280 are independent and small.
- 278 before 277: 277 AC2 reads the blocking steps from the workflow files, so it must see the final shape of `release.yml` (own `ci` checks, dispatch only). 280 also touches `release.yml`, hence before 278.
- Open questions for the clarification round: 278 (drop the push trigger of `ci.yml`; drop the release job's repeated `npm test`), 279 (warning-only `check:docs` on PRs), 280 (does the packaged smoke block — the user's call).
- Tech debt by the user's call (2026-10-30): all 30 overdue rows, grouped into 320–327; TD-015 (inert) and TD-027 (covered by 279) were deleted. 13 stories, above the 3–6 guideline, like S36. The pipeline stories go first so the debt stories build on the new gate; 325 (test hygiene) leads the debt block, 324 (styles, visible in every screenshot) closes it.
- More open questions: 321 (Alt+Enter race: fix or manual residue), 324 (typography scale steps), 326 (cinema ABOVE ordering), 327 (content-only variant or 64-bit build).
- 276 AC6 and 277 AC4 change how the sprint process ends; they edit `.claude/ai-scrum.md` `## Notes`, not the plugin-managed commands.

## Regression gate
