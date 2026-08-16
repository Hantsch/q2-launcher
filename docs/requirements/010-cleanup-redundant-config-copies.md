---
id: 010
title: Cleanup of redundant per-mod config copies
status: draft
created: 2026-08-16
---

## Requirement

As a user, I want to scan an installation for config file copies that are redundant now that
the search path makes the base file reachable, and remove them under my review, so old
manually-copied or `q2-config-manager`-era files don't shadow the profile the launcher now
manages.

See [docs/concepts/config-module.md §5](../concepts/config-module.md#5-feature-areas-carried-over-from-q2-config-manager-redesigned)
and CFG-11.

## Acceptance Criteria

- [ ] A cleanup scan, run per installation, lists mod-folder config file copies made redundant
      by the search path (duplicates of files already reachable via `baseq2`) — excluding the
      `autoexec.cfg` copies story 004's write pipeline intentionally places in "played" mod
      folders.
- [ ] The user reviews the found list before anything is deleted — no automatic/silent
      deletion.
- [ ] A confirmed removal is recoverable (same backup contract this module already uses for
      writes, adapted for a delete) rather than an unrecoverable disk delete.
- [ ] The scan and any removal only ever target `<installation.path>/baseq2` and mod folders
      already known to that installation, never an arbitrary path.

## Open Questions

_None yet — exact backup/undo mechanics for a delete (vs. this module's existing
write-time backup) to be resolved during refine._

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
