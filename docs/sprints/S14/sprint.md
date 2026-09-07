---
sprint: S14
status: in-progress # planned | in-progress | done
branch: sprint/S14
milestone: Config, round three — live-acceptance findings
---

# Sprint S14 — The editor's frame gets out of the way

## Goal

The config editor's chrome stops costing attention: one header shape for every tab, a category
rail that reads as chips instead of nested toolbars, an Unsaved tab that says what a Save will
write, an engine badge wherever an installation is named — and the two grenade rows in Controls >
Weapons can take a key again.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 063 — Hand grenades and Grenade Launcher can be bound to a key
- [ ] 061 — Profile header is one row: back left, identity centred, actions right
- [ ] 062 — Controls category rail is a clean chip row with an action menu
- [ ] 064 — Unsaved changes read as a real diff
- [ ] 065 — Installation name carries an engine badge everywhere it is shown

## Notes

**All five come out of the live acceptance pass on S11–S13**, i.e. from using the surfaces those
sprints built, not from new scope. Four are chrome/UX corrections, one (063) is a real bug.

**063 goes first** because it is the only functional defect in the list and its cause is not yet
known — the report's screenshot never reached the repo (see the story's Open Questions). If the
reproduction turns out to sit in shared bind/adoption code rather than in the renderer, the
carry-over rule for `alias-references.ts`/`alias-render.ts`-adjacent code applies to it: an
adversarial re-render/round-trip pass, not just a green unit test.

**061 before 064**: 061 moves the profile identity and `UnsavedIndicator` into a single header row,
which is the frame 064's change list renders inside. Building them the other way round would rework
064's layout once.

**061 supersedes a story-057 decision** (the Raw File tab's own folded header, taken to buy editor
height). The replacement must re-verify 057's AC1 — at least 30 editor lines at 1280x800 — with the
shared one-row header, rather than assume it.

**062 removes controls, it does not add any**: the category move-up/move-down buttons go, because
ordering has been drag-and-drop since 054. The keyboard path 054 kept must stay reachable — dropping
the arrows must not drop keyboard reordering with them.

**Two open questions are for the user, in the clarification round**: whether 065's engine badge is
wanted on every surface that names an installation (filed that way) or only in the config module;
and the missing screenshots for 063 and 064.
