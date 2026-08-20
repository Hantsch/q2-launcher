---
sprint: S04
status: in-progress # planned | in-progress | done
branch: sprint/S04
milestone: Config module — authoring surfaces (Overview / Controls / Settings) + UI verification harness (docs/systems/config-module.md)
---

# Sprint S04 — Authoring surfaces, and a harness that can prove them

## Goal

The three surfaces you actually author a config in — the keyboard Overview, the bind tab (renamed
Controls) and Settings — behave and look like the prototypes: editing is the resting state, test
mode tells the truth about layers and physical keys, an entry carries its own type and order, and
both tables are dense, capped-width and readable. Built first, so the rest of the sprint can
verify itself: a committed harness that starts the real app, screenshots every screen and reports
accessibility findings.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 026 — A committed UI verification harness that drives the real app
- [x] 017 — Overview: editing is the default, no dedicated edit mode
- [x] 018 — Test mode: trigger keys switch layers, pressed keys light up, readout always visible
- [ ] 019 — Controls: type the entry, not the category, and let me order entries
- [ ] 020 — Controls: rename Advanced and rebuild it as the column grid prototype
- [ ] 021 — Settings: rebuild as the dense-rows prototype

## Notes

Six stories — the upper edge of the guideline. 026 is deliberately first and is the one that can
be dropped if the sprint runs long: it buys nothing functional, it buys the ability to accept the
other five without a manual pass from the user (`live-smoke-required: true` in
`.claude/ai-scrum.md`). Every S03 story had to be handed over as "built, live acceptance pending"
for exactly this reason.

Order is dependency-driven, not size-driven:

- **026 first** so 017–021 can be smoke-driven as they land instead of at the end.
- **017 before 018**: 017 removes the edit-mode toggle and makes a keycap click open the bind
  dialog, which changes what a click on a *trigger* keycap means; 018 then reuses that settled
  click semantics for its layer switching in test mode, and moves the readout into the header
  row 017 just emptied.
- **019 before 020** (stated in both stories): 019 is the entry-type/ordering data model,
  020 is the presentation of it. Building 020 first would mean laying out a model that is about
  to change.
- **021 last**: independent of everything above, pure layout against
  `docs/prototypes/settings/a-dense-rows.html`. Safe to cut into the next sprint if 019/020 turn
  out bigger than they read.

Scope boundary: the profile-as-a-file cluster (022 `<name>.cfg` standalone, 023 Raw File absorbs
Write targets, 024 syntax highlighting, 025 Validation→Care) is **deliberately not in this
sprint**. It is an on-disk/schema rework with migration questions for every existing saved
profile, and mixing it with five UI redesigns would make a live acceptance pass unreadable. It is
the natural S05.

Watch-outs carried over from S03's review:

- `AltLayer.overrides` is **derived state** — a generated mirror of the actions array
  (`applyActionLayerMirror`). Row identity is `action.id`, never rendered command text. 019
  touches the entry model, so this rule is load-bearing there.
- Alias/bind emission and engine limits live centrally in `src/shared/config/` — extend those,
  do not re-derive.
