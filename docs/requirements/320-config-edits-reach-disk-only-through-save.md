---
id: 320
title: Config edits reach disk only through save, and every flag survives a reload
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Four overdue tech-debt rows (TD-009, TD-017, TD-022, TD-025) are one defect class: a config edit
reaches disk by a side path, or a saved value is lost on reload. A user's unsaved edit must never
land on disk because they did something unrelated, and what was saved must come back as it was.
TD-024 (config main-side test gaps) is closed in passing because the same code is touched.

## Acceptance Criteria

- [ ] **AC1** — With an unsaved `writeCatalogDefaults` toggle pending, adding an address-book entry
      writes the address book only; the profile file on disk keeps the toggle's old value (TD-009).
- [ ] **AC2** — Changing a switch bind writes through the same save path as every other edit:
      unsaved edits in the open profile stay unsaved, and an external edit of the file since load is
      reported, not overwritten (TD-017).
- [ ] **AC3** — A config action saved with `keepEmptyAlias` set still has it set after the profile
      is reloaded from disk (TD-022).
- [ ] **AC4** — When `saveNow` fails after a cancelled edit burst, the editor shows the value on
      disk, not the optimistic one; a stale `load()` does not mark the list loaded; a failed
      `load()` keeps its hint visible (TD-025).
- [ ] **AC5** — `withLiveAssignments` has one implementation with a unit test; the config main
      tests use no stale electron mock and no `vi.mock('./writer')` (TD-024).
- [ ] **AC6** — Rows TD-009, TD-017, TD-022, TD-024 and TD-025 are removed from `docs/TECH-DEBT.md`.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Done
