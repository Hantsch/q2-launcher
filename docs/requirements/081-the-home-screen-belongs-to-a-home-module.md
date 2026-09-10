---
id: 081
title: The home screen belongs to a home module
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

The home screen must stop being part of the shell. Today the shell owns the home route, the hero
that shows the active installation, and a grid of cards that is really the roadmap — three things
no other feature is allowed to do. Before anything new can be built there, the home screen has to
become a module like `config`, `library` and `downloads`, so that the news hero and the dashboard
that follow are added to a module and not to the shell.

Nothing user-facing should improve in this story. What must change is who owns the screen: after
it, the home route is rendered by a registered `home` module, the shell no longer knows what is on
it, and the surfaces that are about to be replaced (the dead hero with its four wired-to-nothing
carousel dots, and the planned-module cards) are gone rather than half-alive.

See [concepts/home-screen.md](../concepts/home-screen.md) §9 and §10 — the ownership move is a
recorded rule decision, not an incidental refactor.

## Acceptance Criteria

- [ ] **AC1** — A `home` module is registered like every other module (manifest entry, main half,
      renderer half) and renders the home route.
- [ ] **AC2** — `AppShell` contains neither `HomeView` nor `HeroPanel`; no shell file imports a
      home-screen component.
- [ ] **AC3** — The hero showing the active installation, including its four inert carousel dots,
      no longer appears anywhere in the app.
- [ ] **AC4** — The home screen shows no card, tile or placeholder for a planned module
      (Gamebrowser, Friendlist, Downloads, Mods, Assets).
- [ ] **AC5** — Navigating to home, away from home and back renders the module's screen with no
      console error and no visual regression in the surrounding shell (rail, titlebar, action bar
      keep their geometry).
- [ ] **AC6** — Every string the new screen shows is an i18n key in
      `src/renderer/src/i18n/locales/en.json`; no prose is hardcoded in a component.
- [ ] **AC7** — The home screen is an entry in the `ui:verify` screen registry and a full run stays
      at zero axe violations.

## Open Questions

- With the planned-module cards gone, the home screen no longer advertises what the launcher will
  do. Does the nav bar's own planned-module screen (story 033) carry that discovery alone, or does
  the home screen keep one line pointing at it? (Concept open point 11.)
- Does the `home` module declare the `network` capability already in this story, or only when the
  feed lands in 082?

## Plan

_Filled by `/refine 081`._

## Deliverables

_Filled by `/refine 081`._

## Model Hints

_Filled by `/refine 081`._

## Acceptance Tests

_Filled by `/refine 081`._

## Done

_Filled by `/build 081`._
