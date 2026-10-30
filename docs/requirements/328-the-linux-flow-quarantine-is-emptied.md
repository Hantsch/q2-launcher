---
id: 328
title: The Linux flow quarantine is emptied
status: draft
created: 2026-10-30
---

## Requirement

Twenty flows have been quarantined on Linux since S34 (`scripts/flows/quarantine.json`, story 234):
most because the Linux fixture's engine package is a Windows Q2PRO, the rest because they assume the
Windows control loop or Windows window handling. They prove nothing on Linux, so Linux parity of
installing, repairing and replay playback is unchecked. The quarantine should shrink to zero, each
flow either passing on Linux or asserting the platform difference explicitly.

## Acceptance Criteria

- [ ] **AC1** — The Linux fixture offers an engine package the Linux wizard accepts, and the twelve
      wizard/bootstrap flows quarantined for that reason pass on Linux.
- [ ] **AC2** — The remaining eight quarantined flows pass on Linux or assert the Linux behaviour.
- [ ] **AC3** — `scripts/flows/quarantine.json` has no entry with `platform: linux`.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
