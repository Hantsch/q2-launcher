---
id: 178
title: I edit a demo's details where I read them
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

The detail panel shows every field twice: once as the read-only facts list at the top and once as
the "Your notes" form below it (name, description, mod, game mode, map, date, rating, tags, sides).
That doubles the panel's height and makes me compare two places to know what the demo "is".

Instead, the facts I read are the facts I edit: the panel has **one** set of fields. By default they
read as text ([[177]]'s layout); an **Edit** action turns them into inputs in place, and **Save** /
**Cancel** end the edit. The separate notes form goes away. What the sidecar editor can do today
([[155]]) stays possible — only its place changes.

## Acceptance Criteria

- [ ] **AC1** — The panel no longer shows a separate "Your notes" form below the facts.
- [ ] **AC2** — The panel offers an Edit action; after pressing it, the name (in the header), map,
      mod, gamemode, players/sides and recorded date become editable in place, and a description
      and tags field appear.
- [ ] **AC3** — Save writes the changes to the demo's sidecar, the panel returns to reading mode
      showing the saved values, and the list row reflects them without a rescan.
- [ ] **AC4** — Cancel returns to reading mode with the values from before the edit; nothing is
      written.
- [ ] **AC5** — Save is disabled while nothing changed or while an entered date is invalid, as the
      current form does; the reason for an invalid date is visible text.
- [ ] **AC6** — Leaving a demo (selecting another row, closing the panel, switching module) with
      unsaved edits still asks to keep editing or discard, as today ([[155]]).
- [ ] **AC7** — An archive entry offers no Edit action as an enabled control: it stays visible,
      disabled, with the existing read-only reason as visible text ([[158]]).
- [ ] **AC8** — A saved description and tags are shown in reading mode (below the facts) when set,
      and omitted when empty.

## Open Questions

- Q1: Edit granularity — one Edit for the whole panel (recommended: one draft, one Save, matches
  today's store) or per-field inline editing (click a value, edit, Enter saves)?
- Q2: An empty field in edit mode shows the lower-source value as its placeholder today (e.g. "from
  the demo: q2rdm2"). Keep that cue in edit mode even though reading mode no longer shows provenance
  ([[177]])? Recommendation: keep the placeholder value, drop the "from the demo:" prefix.
- Q3: Where do the file actions (Reveal, Copy path, Rename) sit once the form is gone — directly
  under the facts, or in the header next to Favourite as icon buttons?
- Q4: File name, Length and Point of view are not sidecar fields — they stay read-only in edit mode.
  Confirm.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
