---
id: 135
title: a demos module exists with its own nav entry
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user opens the launcher and sees a **"Demos"** entry in the primary navigation, at the same level
as Library, Config and Servers — one place for every demo they have. Today that place does not
exist; the demo browser concept (`docs/concepts/demo-browser.md`) describes everything it will
eventually do, but nothing is registered with the app yet.

This story is the foundation only, the same way [[106]] was for the servers module: a module that
exists, is reachable, has its own IPC namespace, settings slot and i18n block — so every later demo
story has a home to land in rather than create.

Naming is decided in the concept (§3): the UI says **"Demos"**, the code and module id say
**`replays`**, because "demo" already means the shareware installation and the UI fixture data in
this repo. The module will write sidecars, renames and temporary copies into installation folders
and run a scan, so beyond the `game-lifecycle` capability the concept names (§14) it probably also
needs `mutates-installation` and `long-running-jobs` — refine confirms (Q1).

## Acceptance Criteria

- [ ] **AC1** — A `replays` module is registered per the 5-step checklist in
      [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module): a shared contract file
      under `src/shared/modules/`, the `ModuleId` entry **and** the hardcoded `moduleId` z.enum in
      `src/shared/ipc-schemas.ts`, a `MODULE_MANIFESTS` row, a main half under
      `src/main/modules/replays/` and a renderer half — with no edit to any shell file.
- [ ] **AC2** — The manifest's `nav` is `{ section: 'primary', order: … }`; the nav label reads
      "Demos" and clicking it routes to the module's (placeholder) view.
- [ ] **AC3** — The manifest declares exactly the capabilities decided in Q1.
- [ ] **AC4** — The module's `ipcNamespace` (`module:replays`) is owned by this module the same way
      every other module's namespace is (a handler registered outside it is rejected).
- [ ] **AC5** — The renderer module contributes a `settingsSection` that renders in the Settings
      view, even though it shows no controls yet — the slot [[140]] and [[142]] fill.
- [ ] **AC6** — A top-level `replays` block exists in `src/renderer/src/i18n/locales/en.json`; every
      string this story shows comes from it.
- [ ] **AC7** — Every `module:invoke` handler for `replays` — in this and every later demo story — is
      backed by a module-local zod schema before it is implemented, and the renderer never sends a
      filesystem path to open, play or edit a demo: it names a demo by an id main resolved itself
      (concept §14 "Paths"). Restated here as binding for every later demo story.

## Open Questions

- [ ] **Q1 — Capabilities.** `game-lifecycle` only (concept §14), or also `mutates-installation`
      (sidecars, rename, temp copies inside installation folders) and `long-running-jobs` (scan)?
- [ ] **Q2 — Nav order and icon** (concept open point §17.16): where "Demos" sits relative to
      Servers, and which inline-SVG icon it uses.

## Plan

<!-- Filled by /refine 135, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 135. -->

## Model Hints

<!-- Filled by /refine 135. -->

## Acceptance Tests

<!-- Filled by /refine 135. -->

## Done

<!-- Filled by /build 135. -->
