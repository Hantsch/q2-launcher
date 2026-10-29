---
sprint: S36
status: in-progress # planned | in-progress | done
branch: dev # no sprint branch, by the user's call
milestone: 11.5 — tests review 2026-10-27
---

# Sprint S36 — A gate that blocks on the right things and costs less

## Goal

The Windows PR lane fails when a core journey breaks, the release publishes only a commit with a green `ci` run and launches the packaged app first, and the sprint gate costs about 25–30 minutes instead of about 130. The timing, sleep and quarantine weaknesses of the [tests review](../../reviews/2026-10-27-tests-review.md) are closed, and `CLAUDE.md` carries one map of which lane blocks what. Three user-feedback fixes ride along: `q2pro64.exe` is recognised, the server ping is a whole best-sample value, and demos play in R1Q2.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [ ] 271 — CI pins Node via a version file and the audit gate blocks (blocked: Node 22.12.0 pin unobserved — verify:release exceeded 10 min; resolve at the gate)
- [x] 267 — Timing-ratio tests leave the blocking unit lane
- [x] 272 — Test hygiene: skipped launch flow fails in CI, loose workflow pins, discovery guard, constant echoes
- [x] 266 — Release waits for a green CI run on its SHA
- [x] 273 — An installation with q2pro64.exe is recognised as Q2PRO
- [x] 274 — The server ping is the best sample in whole milliseconds
- [x] 275 — Demos play in an R1Q2 installation, with the controls it cannot offer disabled
- [x] 268 — Recorded-flaky flows wait on conditions, not sleeps
- [x] 269 — Linux fixture engine clears the quarantine
- [x] 265 — Flow smoke tier, failed-only confirmation re-run, per-flow seconds recorded
- [x] 264 — Windows PR lane blocks on core-journey flows and the release launches the packaged app
- [x] 270 — Test lane map in CLAUDE.md, Linux advisory exit condition, one meaning of e2e

## Notes

- Everything in one sprint by the user's call: nine tests-review stories plus three from user feedback 2026-10-29 (273–275), twelve in all, above the 3–6 guideline. Small CI/test-hygiene stories (271, 267, 272, 266) go first so the heavier ones build on a quiet gate.
- 265 before 264: 264 takes its flows from the smoke tier. 270 is last: its table needs the final blocking/advisory values of 264 and 265 (and 271's blocking audit).
- 264 AC2/AC5, 266 AC5 and 271 need real CI runs; they are the likely manual residue.
- 273–275 come after the quiet-gate stories and before the flow work, so 264/265 see their flows. 274 follows 267, which moves `scan-ping-accuracy.test.ts` out of the unit lane — 274 changes the median that test measures.
- 275 needs probing r1q2's console (which playback controls survive); the Linux rule and the protocol list are clarification-round questions. 273 asks which binary wins when both exist.
- 269's shard-race half and the exit-condition choice in 270 are open questions for the clarification round.

## Regression gate

<!-- Filled by `/sprint` phase 2b: the commands run, minutes taken, result, commit, and a verdict per failure. -->
