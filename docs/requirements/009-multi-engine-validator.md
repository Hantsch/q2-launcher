---
id: 009
title: Multi-engine validator
status: draft
created: 2026-08-16
---

## Requirement

As a user, I want my profile validated against every engine my assigned installations actually
use, so I catch alias-name-length, loop-depth, buffer-size and per-engine cvar-meaning problems
before they cause a silent failure in-game.

See [docs/concepts/config-module.md §5](../concepts/config-module.md#5-feature-areas-carried-over-from-q2-config-manager-redesigned)
and CFG-10. No primary/portability two-tier severity — every engine reached through an
assignment is an equally-weighted error surface.

## Acceptance Criteria

- [ ] The validator runs against every distinct engine reached through the profile's assigned
      installations, each weighted equally.
- [ ] Findings cover: alias name length (`MAX_ALIAS_NAME` 32), alias loop depth
      (`ALIAS_LOOP_COUNT` 16), no in-quote escaping, per-engine command-buffer size
      (8192/65536/65536, EFBIG-on-overflow for Q2PRO), and the 1024-byte per-line
      `Cbuf_Execute` limit.
- [ ] A profile assigned to no installation, or only to installations outside
      {r1q2, Q2PRO, vanilla}, shows an explicit "nothing to validate against" state — never a
      silent pass or a default to r1q2's numbers.
- [ ] Validation results reflect the in-progress edit state, without requiring a save first.

## Open Questions

_None yet — exact finding-to-source (which cvar/bind/alias/message a finding points at) to be
worked out during refine against stories 003/006/008's data shapes._

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
