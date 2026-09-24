---
id: 116
title: no scan runs while the game does
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user who is actually playing Quake II never has the launcher compete with the game for the
network path or the CPU in the background — no auto-refresh fires while a session is live, and if
that same user alt-tabs back to the launcher and hits "refresh" out of habit, the launcher says why
it won't, instead of quietly doing it anyway or quietly doing nothing. This is the one rule in the
whole scan story that is not a setting: "kein autoscan während das spiel läuft auf jeden fall"
(game-browser.md §3), restated as a permanent non-goal (§2) and as GB-N5. It sits on top of
[[114]]'s scheduler and [[115]]'s cadence settings — the cadence decides *when* a scan is due, this
story decides that a due scan still does not run if a game is live, no matter what the cadence says.

The launcher already knows whether a game is running — `LaunchService` tracks `LaunchState.phase`
(`starting` / `running` count as an active session; `handed-off` does not, since the launcher loses
track of a Steam-handed-off process, per `src/shared/types/launch.ts`), and
`InstallationWriteGuard` already reads exactly that state to defer installation writes. This story
reuses that existing launch-state awareness for the scan guard rather than inventing a second way to
ask "is the game running" — the answer already exists in one place.

The second half of this story is what happens to a server the scan couldn't reach this round,
whether because a scan was skipped or because that one server simply timed out: it keeps showing
what the launcher last knew about it, marked stale, and is never redrawn as an empty server just
because this round has no fresher answer (GB-N6). An empty-looking row that is actually just old
data is worse than no data, because it tells the user the opposite of the truth.

## Acceptance Criteria

- [ ] **AC1** — An auto-refresh that comes due while a game session is active (launch phase
      `starting` or `running`) is skipped for that round, not queued to run once the session ends;
      the view states the reason visibly.
- [ ] **AC2** — A manual scan attempted while a game session is active is refused, showing the same
      visible reason as AC1, not silently ignored and not queued.
- [ ] **AC3** — A server that receives no reply this scan round (skipped round, or that one server
      timing out) keeps showing its last known data, visibly flagged as stale — it is never shown
      with zero players or as absent.
- [ ] **AC4** — The moment the active game session ends, scanning resumes on its normal cadence
      without any user action — no stale "still blocked" state survives past the session's end.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 116`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 116`. -->

## Model Hints

<!-- Filled by `/refine 116`. -->

## Acceptance Tests

<!-- Filled by `/refine 116`. -->

## Done

<!-- Filled by `/build 116`. -->
