---
id: 093
title: Repair fixes exactly what it can
status: draft
created: 2026-09-12
---

## Requirement

The [install-module concept](../concepts/install-module.md) §11 (INST-R1–R3) redeems
`ValidationFix`'s `install-game-files`, reserved since the installation model was built for
"the install/update module". Repair reads `inspectInstallation`'s own findings — it never
invents a second diagnosis — and offers exactly what the manifest can supply (engine
executable, `pak2.pak`) plus, for missing or demo retail paks, the same retail-copy offer
[[088]]/[[090]] already built. Today the action bar's `Repair` state only navigates to the
Downloads tab; this story makes it do something.

## Acceptance Criteria

- [ ] **AC1** — An installation with a missing or unusable engine executable offers to
      re-install the pinned engine package as its repair action.
- [ ] **AC2** — An installation missing `pak2.pak` offers to download and extract the 3.20
      point release as its repair action.
- [ ] **AC3** — An installation whose `pak0.pak` is demo data where retail was expected offers
      the retail-copy action ([[088]]'s flow) as its repair.
- [ ] **AC4** — An installation missing retail `pak0`/`pak1` altogether offers the same
      retail-copy action; when no store installation is detected, it says so plainly instead of
      offering a picker with nothing in it.
- [ ] **AC5** — An installation not writable at its current location (e.g. under `Program
      Files`) offers the existing `set-write-dir` fix as its repair, unchanged.
- [ ] **AC6** — When `inspectInstallation` reports nothing repairable, the UI says so instead of
      showing an action that would do nothing.
- [ ] **AC7** — Every repair action is driven by re-reading `inspectInstallation`'s current
      findings at the moment it runs, not a snapshot taken earlier.
- [ ] **AC8** — Running a repair on an installation whose game is currently running waits per
      [[091]]'s guard rather than writing underneath it.
- [ ] **AC9** — After a repair completes, the installation's status is re-derived from
      `inspectInstallation`, never hand-set to "healthy".

## Open Questions

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
