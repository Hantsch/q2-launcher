---
id: 327
title: OpenTDM installs on a 64-bit Q2PRO
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Installing OpenTDM into an installation with a 64-bit Q2PRO is refused with `mods.error.noVariant`,
because the catalog has no variant for it and `contentOnly.packages` is empty (TD-007). A user on
the default 64-bit engine cannot install one of the catalog's mods.

## Acceptance Criteria

- [ ] **AC1** — On an installation with a 64-bit Q2PRO, OpenTDM is offered and installs.
- [ ] **AC2** — The installed OpenTDM is listed in the installation's mods and can be removed.
- [ ] **AC3** — A mod with genuinely no matching variant is still refused with
      `mods.error.noVariant`, shown with its reason.
- [ ] **AC4** — Row TD-007 is removed from `docs/TECH-DEBT.md`.

## Open Questions

- Which way: a content-only variant (if the 64-bit Q2PRO can run OpenTDM's game logic as shipped),
  or a 64-bit OpenTDM build mirrored like the other packages?

## Decisions (Sprint)

## Plan

## Deliverables

## Done
