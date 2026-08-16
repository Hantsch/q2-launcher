---
id: 006
title: Keybinding editor with alternate binding layers
status: draft
created: 2026-08-16
---

## Requirement

As a user, I want to edit a profile's key bindings directly — assign, clear or rebind a
command on any key — and build alternate binding layers (hold or toggle) on top of the base
bindings, so I get the layered controls I'm used to from `q2-config-manager` without
hand-editing alias lines.

The overview tab (CFG-7, `OverviewKeyboardPanel.tsx`) is read-only by design; this story is
the editor it defers to. See
[docs/concepts/config-module.md §5](../concepts/config-module.md#5-feature-areas-carried-over-from-q2-config-manager-redesigned)
("Alternate binding layers") and CFG-8.

## Acceptance Criteria

- [ ] Any key shown in the overview tab can be bound to a command, cleared, or rebound
      directly from the UI.
- [ ] A layer (hold or toggle) can be created, and keys within it bound independently of the
      base layer.
- [ ] Toggle layers generate a self-rewriting alias pair; hold layers generate `+layer`/
      `-layer` alias halves — since Quake 2 has no native modifiers, this is the mechanism
      that makes a layer work at all.
- [ ] Binding a key inside a layer that carries a `+command` on the base layer (which would
      leave movement/action stuck on release once the layer remaps it) triggers a warning.
- [ ] Generated alias names respect `MAX_ALIAS_NAME` (32) and the engine's no-in-quote-escaping
      rule.
- [ ] Edits are saved on the profile and immediately reflected in the overview tab.

## Open Questions

- Where do layer-generated aliases live on disk — appended into the same per-profile file
  story 004 already writes, or a separate section/file in the write pipeline? Resolve during
  refine against story 004's existing writer.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
