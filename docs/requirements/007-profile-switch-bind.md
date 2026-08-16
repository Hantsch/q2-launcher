---
id: 007
title: In-session profile-switch bind
status: draft
created: 2026-08-16
---

## Requirement

As a user with more than one profile assigned to an installation, I want a bindable key that
cycles to the next assigned profile during play and echoes its new name to the console, so I
can switch between profiles without restarting the game — without it ever changing my
installation's default profile.

See [docs/concepts/config-module.md §4](../concepts/config-module.md#4-core-terms--model) and
CFG-6. Reuses the self-rewriting alias-pair mechanism story 006 builds for toggle layers.

## Acceptance Criteria

- [ ] An installation with more than one assigned profile exposes a user-assignable key (no
      fixed default beyond suggesting F9) that cycles through its assigned profiles in order.
- [ ] Pressing the bound key in-game execs the next assigned profile's file and echoes the new
      profile's name to the console.
- [ ] The switch is session-only: the installation's designated default profile is unchanged,
      and the default is what loads on the next launch.
- [ ] The generated switch-bind alias/exec chain is written to disk on profile save, through
      the same backup-once/diff-skip write pipeline as story 004.
- [ ] An installation with 0 or 1 assigned profiles shows no switch-bind control.

## Open Questions

_None — direct numbered profile selection (bind 1–9) is explicitly out of scope per the
concept's open point 2._

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
