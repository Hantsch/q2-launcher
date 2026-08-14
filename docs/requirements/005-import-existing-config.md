---
id: 005
title: Import an existing config into a new profile
status: draft
created: 2026-08-14
---

## Requirement

As a user with an existing, hand-written `config.cfg`/`autoexec.cfg` on one of my
installations, I want to import it into a new profile, so I don't have to rebuild my settings
from scratch when switching to the launcher's config module.

Mirrors q2-config-manager's importer: `exec` references are resolved in the same order the
engine would load them, and anything the importer doesn't recognize is preserved unchanged
rather than dropped. Depends on story 001 (profile store exists); the imported profile is then
a normal profile usable with stories 002–004.

## Acceptance Criteria

- [ ] I can pick an installation to import an existing config from.
- [ ] `exec` references inside the imported file(s) are resolved in engine load order.
- [ ] Recognized cvars and key bindings populate the new profile's settings/keybinding state.
- [ ] Anything the importer doesn't understand is preserved unchanged and shown to me, not
      silently dropped.
- [ ] The result is an ordinary profile: I can rename it, assign it to installations, edit it
      further and save it like any profile created from scratch.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
