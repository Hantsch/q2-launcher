---
id: 091
title: Writes wait for a running game
status: draft
created: 2026-09-12
---

## Requirement

The [install-module concept](../concepts/install-module.md) fixes INST-J7: while an
installation's own Quake II process is running, no job may write into that installation's
files — the job reports why it is waiting and continues by itself once the process exits.
Nothing in the codebase implements this wait-then-continue mechanism today. The gap is
already visible: [[090]]'s retail-upgrade job can copy into an installation's folder while
that installation's game is running, and the update/rollback and repair stories about to be
built ([[092]], [[093]]) would inherit the same hole if this is not built first. This story
gives the job pipeline the one guard every writing job shares, and retrofits it onto the
existing retail-upgrade job so that pre-existing gap closes too.

## Acceptance Criteria

- [ ] **AC1** — Starting (or resuming into) the write phase of a job that targets an
      installation whose Quake II process is currently running does not touch that
      installation's files; the job instead enters a visible waiting state.
- [ ] **AC2** — The waiting state names the reason (the game is running) in the Downloads tab
      and wherever else that job's progress is shown, not just as a generic "queued" status.
- [ ] **AC3** — When the installation's process exits, a job waiting on it resumes its write
      phase on its own, without any user action.
- [ ] **AC4** — A job may still download/verify/extract into the cache while the target
      installation's game is running (per the existing "downloading while playing" setting);
      only the write into the installation's own folder is gated.
- [ ] **AC5** — [[090]]'s retail-upgrade job is retrofitted onto this guard: launching that
      installation's game while an upgrade job is copying into its folder is no longer
      possible, closing the gap the S19 review flagged.
- [ ] **AC6** — Cancelling a job that is in the waiting state removes its partial files exactly
      as cancelling any other job does; waiting is not a special case for cancel.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
