---
sprint: S13
status: done # planned | in-progress | done
branch: sprint/S13
milestone: Config, round three
---

# Sprint S13 — Order by hand, Care gets out of the way

## Goal

Everything that has an order in Controls and Settings — rows, sub-categories, categories, cvar
sections and their cvars — can be arranged by clean drag and drop with a keyboard path kept, and
Care turns from a dashboard of sections into a to-do list that shows one calm block when there is
nothing to do.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 054 — Order everything by drag and drop
- [x] 058 — Care says only what needs doing

## Notes

**Deliberately last and deliberately small.** 054 depends on the final row/section structure from
S11 (052, 053, 056) and S12 (059) — drag and drop is built once against the finished model rather
than twice. 058 depends on 057's decision about where the per-installation file rows live (Care's
Files group is the recommended home) and closes the milestone.

**054 adds the renderer's first drag-and-drop dependency** — a library decision (dnd-kit
recommended) that goes to the user in the clarification round, together with the CSP check story
046 made necessary for any component that styles itself at runtime.

**058 is UX consolidation, not new validation logic.** The rules, their honesty (stories 009/025)
and the tidy-up operations stay as they are; what changes is that nothing is rendered that has
nothing to say. Where the installation-wide redundant-copies cleanup goes is a user decision.

This closes "Config, round three". 032 (downloads badge) stays blocked on the downloads module.
