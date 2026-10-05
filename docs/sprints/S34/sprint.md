---
sprint: S34
status: in-progress # planned | in-progress | done
branch: sprint/S34
milestone: # roadmap milestone, set by /roadmap plan
---

# Sprint S34 — Codebase health closed, and the demo, install and server stories from user feedback

## Goal

The five open codebase-health drafts from the S32 review are closed (typed module handlers, a flow gate without
quarantine, release verification before a merge to main, shutdown/store/job edge cases, no known holes in the
layer and error-key rules). The demo browser, the add-installation flow and the server browser carry the
refinements from the latest user feedback.

## Stories (in build order)

- [x] 232 — every module's handlers are typed from a contract
- [x] 236 — the layer and error-key rules have no known holes
- [x] 235 — shutdown, state store and job edge cases are closed
- [x] 233 — the flow gate has no quarantined flows and catches cross-story breakage
- [ ] 234 — release verification and CI rehearsals run before a merge to main (blocked: Docker daemon down, D2 rehearsal not run)
- [x] 245 — the demo detail lists players by team
- [x] 243 — the demo detail is edited in place and saves itself
- [x] 242 — I browse my demos in their folders
- [ ] 238 — the demo list shows the selected installation's demos
- [ ] 244 — I select several demos and delete, tag or move them
- [ ] 241 — I comment a moment on the demo timeline
- [ ] 237 — I set the demo volume with a slider
- [ ] 239 — adding an installation is one flow wherever I start it
- [ ] 240 — the install folder is created for me and shown before install
- [ ] 249 — I pick mod and map when I start an installation
- [ ] 246 — an installation with several engines lets me choose one
- [ ] 247 — I filter servers by maximum ping
- [ ] 250 — scan now refreshes only the servers my filter shows
- [ ] 248 — I filter servers by several mods at once

## Notes

- Source: all open drafts except 102 (Linux Q2PRO build; its Q1–Q4 are still undecided).
- Build starts only after S32 and S33 are merged into `dev` (S33 builds on S32; 232–236 build on both).
- **Order.** The health stories come first so the typed handlers, the stricter layer rules and the unquarantined
  flow gate guard everything after them: 232 → 236 → 235 → 233, with 234 last of the group because it rehearses
  the release path on the finished tree. User stories follow by dependency: 245 before 243; 242 before 238 and
  244 (folder target); 239 before 240 (name field); 247 before 250 (the filter the scan follows).
- 19 stories is a large sprint (S33 had 16). Most user stories carry open questions (about 50 in total), so the
  clarification round will be long; 237, 241, 246, 248, 249 are independent and the first to cut if the sprint
  needs to shrink.

## Regression gate

<!-- Filled by `/sprint` phase 2b: the commands run, minutes taken, result, commit, and a verdict per failure. -->
