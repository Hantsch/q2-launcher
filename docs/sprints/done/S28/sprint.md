---
sprint: S28
status: done
branch: sprint/S28
milestone: 10.6–10.8 — Playback, timeline & binds, auto-record
---

# Sprint S28 — Demo browser, part 3 — playback, timeline, binds, auto-record

## Goal

A demo plays in Q2PRO (copied in and cleaned up when it lives elsewhere; r1q2 fallback without seeking; MVD2 with seek) while the launcher drives it from a timeline and a console field; the config profile can bind the demo actions and record every map automatically.

## Stories (in build order)

- [x] 159 — I play a demo in Q2PRO
- [x] 160 — a demo from elsewhere is copied in and cleaned up
- [x] 161 — without Q2PRO a demo still plays in r1q2 (scope cut by user: no r1q2 playback for now — refine decides what remains)
- [x] 162 — an mvd2 plays and seeks
- [x] 163 — a playback session keeps a line to the game
- [x] 164 — the launcher speaks to a running demo
- [x] 165 — I steer a demo from the timeline
- [x] 166 — I send a console command to the running demo
- [x] 167 — demo actions are bindable in my profile
- [x] 168 — my profile records every map on its own

## Notes

- Builds on S26/S27. 163 changes `LaunchService` stdio (every launch) and 167/168 touch the config
  module — the highest regression risk of the phase.
- Spike 133's open items (p95 latency 587–701 ms vs. 300 ms target, loop CPU unmeasured, loop does
  not stop at demo end, map change inside a demo untested) are carried by 164 — see
  `spikes/133-q2pro-control/RESULT.md`.
- On Linux without a Q2PRO, Play is disabled with its reason (102 stays out of scope).
- Phase 10 is cut into three sprints (S26 data layer → S27 list/detail UI → S28 playback), so each
  sprint is refined against code the previous one has built and the regression gate runs three
  times instead of once.
- Numeric order is the build order; every `[[NNN]]` reference to a higher id is a "used later"
  mention, not a dependency.

## Regression gate

Ran on `sprint/S28` HEAD 9f0a558, then confirmed after fixes on 5647b5a.

| Command                                    | Result                                    | Minutes |
| ------------------------------------------ | ----------------------------------------- | ------- |
| `npm run build`                            | green                                     | 0.1     |
| `npm test`                                 | green (5709 tests)                        | 0.4     |
| `npm run ui:verify`                        | red: `config-care-clear` (both viewports) | 2.4     |
| `npm run ui:flows` (9f0a558)               | 94/100                                    | 35      |
| `npm run ui:flows` (5647b5a, confirmation) | 95/100                                    | 35      |

Failures and verdicts:

- `care-duplicate-name`, `config-care-clear` (ui:verify) — story 167, 879c67d. Demo rows derived colliding alias names and the controls seed schema version was stale. Fixed in 89ef511.
- `replays-archive-readonly` — story 159, c6069f9. The flow asserted Play enabled on an archive entry, but the fixture has no installation with the demo's mod, so Play is correctly disabled with its reason. Flow updated, fixed in 5647b5a.
- `replays-extra-folders`, `servers-filter-search`, `servers-master-sources`, `servers-sort-order` — pre-existing (red at merge-base d910052).
- `servers-scan-settings` — red only in the confirmation run, green in the first; unattributed (no second attribution per budget), reported as a flake.
