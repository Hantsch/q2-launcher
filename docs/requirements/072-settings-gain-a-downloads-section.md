---
id: 072
title: Settings learn to host a module's own section, starting with Downloads
status: draft
created: 2026-09-08
---

## Requirement

The downloads module needs three settings of its own (concurrency limit, archive-cache budget,
download-while-playing), but `LauncherSettings` is a closed shape and "a feature is a module —
never edit the shell" forbids editing the Settings view for every module that needs a value. This
story resolves that once: the Settings view learns to render sections contributed by modules,
and the downloads module is the first to use it. The mechanism is meant to be reused by mods and
assets later, per [concepts/install-module.md §12](../concepts/install-module.md).

## Acceptance Criteria

- [ ] **AC1** — The Settings view renders a section contributed by the downloads module,
      alongside the existing shell-owned sections, without `LauncherSettings` gaining any
      downloads-specific fields.
- [ ] **AC2** — The section offers a concurrent-jobs limit, an archive-cache budget, and a
      download-while-playing toggle.
- [ ] **AC3** — The section shows the current archive-cache size.
- [ ] **AC4** — Clearing the cache states what will be deleted (size, item count) before the
      user confirms.
- [ ] **AC5** — When the cache exceeds its budget, the oldest archives are evicted first; an
      archive belonging to a running job is never evicted.
- [ ] **AC6** — The module's settings values, the archive cache location, and the mechanism for
      module-contributed sections all persist across an app restart.

## Open Questions

- Default and allowed range for the concurrent-jobs setting, and the default archive-cache
  budget and download-while-playing value — none of these were decided in the concept. (concept
  open point 9)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
