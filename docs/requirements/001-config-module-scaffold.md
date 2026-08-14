---
id: 001
title: Config module scaffold and central profile store
status: draft
created: 2026-08-14
---

## Requirement

As a user, I want a real "Config" section in the launcher where I can create, rename and
delete config profiles, so I can start managing my Quake 2 configs from inside the launcher
instead of the separate, discontinued q2-config-manager app.

This is the foundation story for
[docs/concepts/config-module.md](../concepts/config-module.md): it wires the `config` module
in (currently a `PlannedModuleView` placeholder) and introduces the central profile store.
Profiles created here have no cvar/keybinding content yet — that lands in later stories. No
installation assignment yet either (story 002) and nothing is written to disk yet (story 004).

## Acceptance Criteria

- [ ] The Config nav item opens a real module view, not the "planned" placeholder.
- [ ] I can create a new profile, either empty or from the standard template, and give it a
      name.
- [ ] I can rename and delete an existing profile.
- [ ] The profile list persists across app restarts.
- [ ] The UI is built entirely from the launcher's existing design-system primitives (`Panel`,
      `SectionLabel`, `Button`, `Field`/`Input`, etc.) — nothing ported from
      q2-config-manager's CSS or components.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
