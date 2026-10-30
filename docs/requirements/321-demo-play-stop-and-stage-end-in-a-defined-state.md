---
id: 321
title: Demo play, stop and stage restore end in a defined state
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Overdue rows TD-008, TD-010, TD-011, TD-019, TD-029 and TD-030 are edge cases of demo playback in
the `replays` module: a play that fails without saying so, a stop that never finishes, a stage that
is not restored, a dialog that shows stale values. Each one leaves the user looking at a state that
does not match what happened.

## Acceptance Criteria

- [ ] **AC1** — "Play anyway" on a demo whose mod game directory is missing shows a play error with
      a reason; main does not fail with an unhandled ENOENT on `q2l_back.cfg` (TD-008).
- [ ] **AC2** — A second Play while one is starting is refused, and a failed `trustMod` does not
      start playback (TD-019); `replays.modWarning.error` is either shown somewhere or deleted.
- [ ] **AC3** — A stop whose kill succeeds without an `exit` event leaves Stopping within a bounded
      time and returns the UI to idle; a stop refused from the action bar shows the refusal (TD-011).
- [ ] **AC4** — Quitting the launcher while a staged demo runs restores the stage values in the
      config; a settings change during playback and a switch back from fullscreen restore the
      latest geometry, not a stale one (TD-010, TD-029). `+-X` in `vid_geometry` is parsed or
      refused, with a test.
- [ ] **AC5** — The replace dialog shows the current value; the missing-mod confirmation is cleared
      when the selection changes; Join is disabled for a server the filter hides (TD-030).
- [ ] **AC6** — Rows TD-008, TD-010, TD-011, TD-019, TD-029 and TD-030 are removed from
      `docs/TECH-DEBT.md`.

## Open Questions

- TD-010's "Alt+Enter can race a queued switch": fix it here, or record it as manual residue if
  the flow harness cannot reproduce it?

## Decisions (Sprint)

## Plan

## Deliverables

## Done
