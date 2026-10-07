---
sprint: S30
status: done # planned | in-progress | done
branch: sprint/S30 # set by /sprint
milestone: 10.10 — Demo browser polish (lean detail, context-aware action bar)
---

# Sprint S30 — Demo browser, part 5 — a lean detail and one main button

## Goal

The Demos view shows only what helps right now: no idle console field, no sort caption, and a detail
panel that reads at a glance — prominent name, facts in a fixed order, no provenance noise, editing
in place instead of a second form, favourite and star rating one click each. The action bar button
becomes the launcher's main control for the open tab — Play, Join on Servers, View on Demos, Stop
while a demo plays — and a missing-mod warning is asked once instead of shown forever. Timeline
controls answer a click at once and reach the game faster on Windows.

## Stories (in build order)

- [x] 176 — the Demos view shows only what helps right now
- [x] 177 — the demo detail reads at a glance
- [x] 178 — I edit a demo's details where I read them
- [x] 179 — I favourite and rate a demo with one click
- [x] 180 — the action bar button speaks for the tab I'm on
- [x] 181 — I join the selected server from the action bar
- [x] 182 — a missing-mod warning is asked once
- [x] 183 — a spike finds where demo-control latency comes from
- [x] 184 — the timeline answers my click at once
- [x] 185 — demo commands reach the game without waiting

## Notes

- Triggered by the user's UI/UX walk-through of the Demos tab after S29 (2026-09-30).
- Concept change: DEMO-13's "the detail view shows each value's source" is dropped for the detail
  panel ([[177]]); the precedence itself (sidecar > content > name > file time) stays.
- 177 → 178 → 179 all reshape `DemoDetailPanel.tsx`/`DemoNotesEditor.tsx`; build them in order.
  179 closes the roadmap follow-up on `quickEdit`'s lost write (favourite + rating back-to-back).
- Highest regression risk: 180 adds a shell seam (a module contributes the action bar's primary
  action) — CLAUDE.md says features never edit the shell, so its Q1 needs a recorded decision.
  It also moves demo playback's entry point, which many `replays-*` flows click
  (`replays-demo-play`); expect flow updates across the stage/timeline flows. 181 depends on 180.
- 182 depends on 180's confirmation dialog; main's eligibility re-check must keep refusing an
  unacknowledged mod-missing play.
- 183–185: the timeline feels delayed on Windows. Likely causes (from 133/169/174): the buffered
  logfile delivers ACK/POS in ~1.3 s bursts since 174's 200 ms tick, and the channel waits for each
  ACK before sending the next command. 183 measures on real Q2PRO first; 184 (instant timeline
  feedback) does not depend on it; 185 implements what 183 approves. If no lever works, 185 shrinks
  and 184's "waiting for the game…" state is the fallback (inform instead of fix).
- Every story's open questions go to the user in the clarification round — most are product
  choices (star scale, edit granularity, where the not-playable reason sits, remember scope).

## Regression gate

Ran on commit `852e616` (story 185, the last story commit).

| Command                      | Minutes | Result                                  |
| ---------------------------- | ------- | --------------------------------------- |
| `npm run build`              | < 1     | green                                   |
| `npm test`                   | 0.7     | green — 5968 passed, 8 skipped          |
| `npm run ui:verify`          | 2.2     | green — 60/60 screens, axe 0 violations |
| `npm run ui:flows` (e2e-all) | 40      | 113 flows, 107 passed, 6 failed         |

Failures:

- `replays-play-mvd2`, `replays-play-q2pro` → **story 185** (stale assertion on `logfile_flush 1` versus the
  new `logfile_flush 3`). Fixed in commit `040bacf`: both flows re-run green individually and `npm test` green.
  The 40-minute `ui:flows` suite was **not** re-run after the fix.
- `replays-extra-folders`, `servers-filter-search`, `servers-master-sources`, `servers-sort-order` →
  **pre-existing**: red at merge-base `759db2b` too; not fixed here. `replays-extra-folders` fails at an
  earlier step at the merge-base than on HEAD, i.e. it is unstable.
- `replays-archive-readonly` passed in the gate, although stories 178, 179 and 180 reported it red as
  pre-existing in their narrow gates.
