---
id: 167
title: demo actions are bindable in my profile
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

In fullscreen the engine covers the launcher, and the timeline ([[165]]) is out of reach. So the same
actions — pause, jump back/forward, speed up/down — are **bindable commands in the config profile's
Controls tab**, and work in-game because they are engine commands (concept
`docs/concepts/demo-browser.md` §3, §12.2, DEMO-28). The user binds them there; **the launcher never
rebinds keys on its own** — visible and permanent instead of silently changed. Q2PRO's
`scr_demobar` shows the position in-game.

They become entries in the config module's action catalog (`src/shared/config/action-catalog.ts`),
with i18n labels like every other action. What a demo action means in an **r1q2 profile**, where
seek does not exist, is concept open point §17.10.

## Acceptance Criteria

- [ ] **AC1** — The Controls tab offers the demo actions (at least pause, jump back, jump forward,
      speed up, speed down) as bindable actions in their own category.
- [ ] **AC2** — Binding one writes the corresponding engine command into the profile like every
      other bind, and a unit test pins each action's command text.
- [ ] **AC3** — Relative speed steps work in-game with the same steps the timeline uses ([[165]]
      Q1).
- [ ] **AC4** — No launcher code writes a demo bind into a profile without the user binding it.
- [ ] **AC5** — In an r1q2 profile, seek-based actions follow the rule decided in Q1, and if shown
      disabled, they carry the reason as visible text.
- [ ] **AC6** — Labels and descriptions are i18n keys (`config.actionCatalog.*`), with the literal
      ASCII `label` the config writer needs.

## Open Questions

- [ ] **Q1 — r1q2 profiles** (§17.10): hide seek actions, or show them disabled with "Seeking needs
      Q2PRO"?
- [ ] **Q2 — `scr_demobar`** — should the profile's Settings tab expose it (and `cl_demosnaps`) as
      cvars, or is that left to the console field ([[166]])?
- [ ] **Q3 — Only during demos** — demo binds do nothing in a live game; is that acceptable, or
      should they be marked "demo playback only" in the Controls tab?

## Plan

<!-- Filled by /refine 167, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 167. -->

## Model Hints

<!-- Filled by /refine 167. -->

## Acceptance Tests

<!-- Filled by /refine 167. -->

## Done

<!-- Filled by /build 167. -->
