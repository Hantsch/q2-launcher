---
id: 098
title: I update when I choose to
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-13
---

## Requirement

[[097]] knows an update exists; the user has to be able to see that and act on it — or not.
A launcher that updates itself behind the user's back is a launcher that interrupts a game
night, and a launcher that only mentions it in a settings page buried three clicks deep is one
nobody updates at all. The middle is a single affordance in the titlebar, left of the Downloads
button in the same utility row ([TitleBar.tsx](../../src/renderer/src/components/shell/TitleBar.tsx)),
that appears only when there is something to update and says what it is.

The user decides both _whether_ and _when_. Choosing to update downloads the release and then
waits — the launcher restarts into the new version only on a second, deliberate confirmation.
Dismissing it leaves the launcher running exactly as before; nothing is installed, nothing
nags again in the same session.

One hard rule: the launcher never restarts itself out from under a running game or an in-flight
download job. Those are the two cases where a restart destroys work the user can see, and both
already have state the launcher tracks.

## Acceptance Criteria

- [ ] **AC1** — When [[097]]'s state says an update is available, an update control appears in
      the titlebar's utility row, immediately left of the Downloads button; when no update is
      available it is not there at all.
- [ ] **AC2** — The control names the available version before the user commits to anything, and
      offers a way to see what changed ([[099]]'s notes) rather than only a version number.
- [ ] **AC3** — Starting the update downloads the release with visible progress, and the launcher
      stays fully usable while it downloads.
- [ ] **AC4** — Nothing is installed and nothing restarts until the user confirms a second time,
      after the download has finished.
- [ ] **AC5** — Dismissing the update leaves the launcher running unchanged and does not show the
      prompt again in the same session; the control remains reachable for the user to come back to.
- [ ] **AC6** — Restart-and-install is refused, with a readable reason, while a game launched by
      this launcher is running or a download job is in flight — it does not kill either.
- [ ] **AC7** — A failed download (offline, checksum/signature mismatch, cancelled) leaves the
      installed launcher untouched and says why, with the update still offerable afterwards.
- [ ] **AC8** — After a successful restart the launcher runs the new version, and the update
      control is gone.

## Open Questions

- **What exactly is "the control"?** A `size-8` icon-only button matching the Downloads button
  (CLAUDE.md's titlebar deviation), a button that widens to show the version, or an icon plus a
  popover carrying version, notes link and the two actions. Recommendation: icon button with a
  popover, since AC2–AC4 need three pieces of information and two staged actions, which do not
  fit a tooltip.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
