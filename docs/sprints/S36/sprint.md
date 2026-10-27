---
sprint: S36
status: planned # planned | in-progress | done
branch: # set by /sprint
milestone: 11.5 — tests review 2026-10-27
---

# Sprint S36 — A gate that blocks on the right things and costs less

## Goal

The Windows PR lane fails when a core journey breaks, the release publishes only a commit with a green `ci` run and launches the packaged app first, and the sprint gate costs about 25–30 minutes instead of about 130. The timing, sleep and quarantine weaknesses of the [tests review](../../reviews/2026-10-27-tests-review.md) are closed, and `CLAUDE.md` carries one map of which lane blocks what.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [ ] 271 — CI pins Node via a version file and the audit gate blocks
- [ ] 267 — Timing-ratio tests leave the blocking unit lane
- [ ] 272 — Test hygiene: skipped launch flow fails in CI, loose workflow pins, discovery guard, constant echoes
- [ ] 266 — Release waits for a green CI run on its SHA
- [ ] 268 — Recorded-flaky flows wait on conditions, not sleeps
- [ ] 269 — Linux fixture engine clears the quarantine
- [ ] 265 — Flow smoke tier, failed-only confirmation re-run, per-flow seconds recorded
- [ ] 264 — Windows PR lane blocks on core-journey flows and the release launches the packaged app
- [ ] 270 — Test lane map in CLAUDE.md, Linux advisory exit condition, one meaning of e2e

## Notes

- Everything in one sprint by the user's call: nine stories, above the 3–6 guideline. Small CI/test-hygiene stories (271, 267, 272, 266) go first so the heavier ones build on a quiet gate.
- 265 before 264: 264 takes its flows from the smoke tier. 270 is last: its table needs the final blocking/advisory values of 264 and 265 (and 271's blocking audit).
- 264 AC2/AC5, 266 AC5 and 271 need real CI runs; they are the likely manual residue.
- 269's shard-race half and the exit-condition choice in 270 are open questions for the clarification round.

## Regression gate

<!-- Filled by `/sprint` phase 2b: the commands run, minutes taken, result, commit, and a verdict per failure. -->
