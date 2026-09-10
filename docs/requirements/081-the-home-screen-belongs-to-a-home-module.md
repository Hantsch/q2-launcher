---
id: 081
title: The home screen belongs to a home module
status: ready # draft -> ready -> in-progress -> done
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

## Decisions (Sprint)

- **(User)** Planned-module discovery: dropped entirely — the nav bar's planned-module screen
  (story 033) carries discovery alone; the home screen adds no pointer line.
- **(User)** `network` capability: not declared in this story — only when the feed lands in 082.
- **Nav entry:** the `home` manifest carries `nav: null`; the rail's existing hardcoded `nav-home`
  button (`TitleBar.tsx`) keeps the slot. Reason: a `nav` entry would render a second home button
  next to the hardcoded one and change the rail's geometry, which AC5 forbids.
- **Route resolution:** `resolveView` loses its `ROUTE_HOME → HomeView` special case and finds home
  through the generic `route → manifest → rendererModule(id).View` lookup (manifest `route: '/home'`
  = `ROUTE_HOME`). Reason: only that removes the shell's knowledge of what is on home (AC2) instead
  of moving the import one file further.
- **Unknown-route fallback:** a route with no manifest match still lands on home, but resolved
  through the same manifest lookup rather than a shell-owned component. Reason: a persisted stale
  `lastRoute` must not render nothing, and the fallback may not reintroduce a shell import (AC2).
- **Main half without handlers:** `src/main/modules/home/index.ts` is a `MainModule` with an empty
  `setup()`, registered in `MODULES`. Reason: `registry.manifests()` downgrades any manifest whose
  main half is not registered to `planned`, so the main half is required for AC1 even though this
  story adds no IPC — and adding channels now would be a contract without a consumer.
- **No `src/shared/modules/home.ts`:** step 1 of the module checklist is skipped in this story.
  Reason: there is no handler name or data shape to declare yet; 082 writes that file with the feed
  channels.
- **What the screen shows:** one placeholder block — an i18n'd title plus a one-sentence lead, no
  hero, no cards, no grid — inside the module's own `HomeView`. Reason: AC3/AC4 empty the screen
  while AC5/AC6/AC7 need a real, non-empty, axe-clean surface, and 083 (hero) plus 086 (dashboard)
  need a container to fill; no pre-cut hero/dashboard slots are scaffolded ahead of those stories.
- **Capabilities and status:** `capabilities: []`, `status: 'available'`. Reason: the module owns a
  real, registered screen after this story, and it touches neither installations nor the network.
- **i18n:** new `home.*` keys for the screen plus `module.home.title`/`description` for the
  manifest's `titleKey`/`descriptionKey`; `hero.*` and any other key orphaned by the deletion is
  removed, keys still used elsewhere (`empty.*`, `rail.*`, `module.<id>.*`) stay. Reason: the
  manifest shape requires the two module keys, and a dead key block is exactly the "half-alive"
  residue the story wants gone.
- **`ui:verify`:** the existing `home` screen entry in `scripts/lib/screens.mjs` is kept as is (id
  `home`, variant `populated`); the story adds only the round-trip flow script. Reason: the entry
  already covers AC7 and changing its id would silently drop the screen's history.

## Open Questions

- ~~With the planned-module cards gone, the home screen no longer advertises what the launcher
  will do. Does the nav bar's own planned-module screen (story 033) carry that discovery alone, or
  does the home screen keep one line pointing at it? (Concept open point 11.)~~ answered →
  Decisions (Sprint)
- ~~Does the `home` module declare the `network` capability already in this story, or only when the
  feed lands in 082?~~ answered → Decisions (Sprint)

## Plan

A pure ownership move, in the order of the module checklist in
[ARCHITECTURE.md](../ARCHITECTURE.md#adding-a-module), with the two dead surfaces deleted rather
than carried along.

1. **Manifest + main half.** `home` joins `ModuleId` and `MODULE_MANIFESTS`
   (`src/shared/types/module.ts`): `route: '/home'`, `nav: null`, `status: 'available'`,
   `capabilities: []`, `requiresInstallation: false`, `icon` = the lucide name the hardcoded
   `nav-home` button already uses. `src/main/modules/home/index.ts` mirrors
   `src/main/modules/library/index.ts` but with an empty `setup()`, and is added to `MODULES` in
   `src/main/modules/index.ts` so `registry.manifests()` reports it `available`.
2. **Renderer half.** `src/renderer/src/modules/home/HomeView.tsx` is the new, reduced screen (i18n
   title + lead only). It is registered in `RENDERER_MODULES`
   (`src/renderer/src/modules/index.ts`) as `{ id: 'home', View: HomeView }`.
3. **Shell gives it up.** `AppShell.tsx` drops the `HomeView` import, the `ROUTE_HOME` branch and
   the HomeView fallback; both now resolve through the existing manifest lookup.
   `src/renderer/src/views/HomeView.tsx` (with its inline `ModuleCard`) and
   `src/renderer/src/components/shell/HeroPanel.tsx` are deleted.
4. **Residue.** Orphaned `hero.*` (and any other now-unreferenced) keys leave
   `i18n/locales/en.json`; `home.*` and `module.home.*` come in. A source-scan guard test keeps the
   shell from importing a home component again.
5. **Verification.** Keep the `home` entry in `scripts/lib/screens.mjs`, add
   `scripts/flows/home-route-roundtrip.mjs` (home → config → home: screen renders, no console
   error, rail/titlebar/action-bar geometry unchanged), then `npm run ui:verify` at zero axe.

Order matters only between 1–3; step 3 does not typecheck before 1 and 2 exist.

## Deliverables

- **D1 — `home` is a registered module in shared + main.**
  Files: `src/shared/types/module.ts`, `src/main/modules/home/index.ts` (mirror
  `src/main/modules/library/index.ts`), `src/main/modules/index.ts`, plus its test
  `src/main/modules/home/index.test.ts` (mirror `src/main/modules/registry.test.ts`'s style).
  Acceptance: `getModuleManifest('home')` exists with `route: '/home'`, `nav: null`,
  `status: 'available'`, `capabilities: []`; a registry built from `MODULES` reports `home` as
  `available` (i.e. it is not downgraded to `planned`); no IPC channel is added.

- **D2 — the home route is rendered by the module, and the shell forgets it.**
  Files: `src/renderer/src/modules/home/HomeView.tsx` (new), `src/renderer/src/modules/index.ts`,
  `src/renderer/src/components/shell/AppShell.tsx`, delete
  `src/renderer/src/views/HomeView.tsx` and
  `src/renderer/src/components/shell/HeroPanel.tsx`; i18n `home.*` + `module.home.*` in
  `src/renderer/src/i18n/locales/en.json`. Tests:
  `src/renderer/src/modules/home/HomeView.test.tsx` (new) and the existing
  `src/renderer/src/components/shell/AppShell.test.tsx`; mirror
  `src/renderer/src/modules/index.test.ts` for the registration assertion.
  Acceptance: `resolveView('/home', modules)` returns the home module's `View` and an unknown route
  falls back to it; `AppShell.tsx` imports no home component; the rendered screen shows no module
  card, no planned-module title and no hero, and every visible string comes from `t()`.

- **D3 — no residue: dead i18n keys and a guard against the shell taking it back.**
  Files: `src/renderer/src/i18n/locales/en.json`, new
  `src/renderer/src/components/shell/shell-home-ownership.test.ts`.
  Acceptance: no `hero.*` key remains and no key removed here is referenced anywhere in `src`
  (keys still used elsewhere — `empty.*`, `rail.*`, `module.<id>.*` — are untouched); the guard test
  fails if any file under `src/renderer/src/components/shell/` or `src/renderer/src/views/`
  mentions `HeroPanel` or a home view, and if `HeroPanel.tsx` reappears.

- **D4 — the move is verified on the real surface.**
  Files: `scripts/flows/home-route-roundtrip.mjs` (new; mirror
  `scripts/flows/config-header-geometry.mjs` for the geometry-measuring pattern),
  `scripts/lib/screens.mjs` (only if the `home` entry needs an adjustment).
  Acceptance: `npm run ui:flow -- home-route-roundtrip` passes — home renders, navigating away and
  back re-renders it, zero console errors, and the rail/titlebar/action-bar bounding boxes are
  identical before and after; `npm run ui:verify` completes with the `home` screen shot and zero
  axe violations.

## Model Hints

- D2 → `deliverable-hard` — it deletes the shell's hardcoded home branch *and* the fallback every
  unknown/stale `lastRoute` lands on, so a mistake in `resolveView` breaks route resolution
  app-wide, not just the home screen.
- D1, D3, D4 → default.
- Review: → default — the story adds no logic and no IPC; its risk is concentrated in D2, which the
  guard test, `AppShell.test.tsx` and the round-trip flow all cover mechanically.

## Acceptance Tests

- AC1 → unit `src/main/modules/home/index.test.ts` › "the home module is registered and stays
  available" + unit `src/renderer/src/modules/home/HomeView.test.tsx` › "the home module provides
  the view for the home route" (D1, D2)
- AC2 → unit `src/renderer/src/components/shell/AppShell.test.tsx` › "the shell resolves the home
  route through the module registry" + unit
  `src/renderer/src/components/shell/shell-home-ownership.test.ts` › "no shell file imports a
  home-screen component" (D2, D3)
- AC3 → unit `src/renderer/src/components/shell/shell-home-ownership.test.ts` › "the hero panel and
  its carousel dots are gone" (asserts the file is absent, nothing references `HeroPanel`, and no
  `hero.*` i18n key remains) (D2, D3)
- AC4 → unit `src/renderer/src/modules/home/HomeView.test.tsx` › "the home screen shows no planned
  module" (D2)
- AC5 → e2e `scripts/flows/home-route-roundtrip.mjs` (`npm run ui:flow -- home-route-roundtrip`) ›
  "home survives navigating away and back with unchanged shell geometry" (D4)
- AC6 → unit `src/renderer/src/modules/home/HomeView.test.tsx` › "every string on the home screen is
  an i18n key" (renders with a key-echoing `t`, asserts the visible text is keys and that each key
  exists in `en.json`) (D2)
- AC7 → e2e `npm run ui:verify` › the `home` screen entry in `scripts/lib/screens.mjs` shoots and
  passes the axe gate at zero violations (D4)

## Done

_Filled by `/build 081`._
